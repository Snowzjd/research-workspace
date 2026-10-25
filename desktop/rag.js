/* ==========================================================================
   外部 RAG 服务客户端
   --------------------------------------------------------------------------
   本软件自身不做向量化，也不内置嵌入模型。
   知识库的语义检索能力全部来自用户自建 / 第三方的 RAG 服务，按以下契约调用：

     GET  {base}/health                  → { ok, indexed, model, updated_at }
     POST {base}/search   {query, top_k, filters}
                                         → { took_ms, results: [{ id, title, path,
                                              snippet, score, doc_type, page }] }
     POST {base}/reindex                 → { ok, added, updated, removed }

   字段名做了容错（title|name、path|file|source、snippet|text|content…），
   方便对方少改代码。服务不可用时由渲染层退回「资料名称匹配」。
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const TOKEN_FILE = 'rag-token.bin';
let dirOverride = null;

function dir() { return dirOverride || app.getPath('userData'); }
function tokenPath() { return path.join(dir(), TOKEN_FILE); }

/* 令牌只存在主进程：加密落盘，渲染层永远拿不到明文 */
function saveToken(plain) {
  const s = String(plain == null ? '' : plain).trim();
  try {
    if (!s) {
      try { fs.rmSync(tokenPath(), { force: true }); } catch (_) {}
      return { ok: true, stored: false };
    }
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(tokenPath(), safeStorage.encryptString(s));
      return { ok: true, stored: true, encrypted: true };
    }
    fs.writeFileSync(tokenPath(), Buffer.from(s, 'utf8'));
    return { ok: true, stored: true, encrypted: false };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function readToken() {
  try {
    if (!fs.existsSync(tokenPath())) return '';
    const buf = fs.readFileSync(tokenPath());
    if (safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(buf); } catch (_) { return ''; }
    }
    return buf.toString('utf8');
  } catch (_) { return ''; }
}

function state() {
  const has = !!readToken();
  let encrypted = false;
  try { encrypted = safeStorage.isEncryptionAvailable(); } catch (_) {}
  return { stored: has, encrypted };
}

function normalizeBase(endpoint) {
  let s = String(endpoint || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

/* 把底层网络错误翻译成能直接照着做的提示 */
function hintFor(raw, url) {
  const m = String(raw || '');
  if (/ECONNREFUSED/i.test(m)) return `无法连接 ${url}：目标端口没有服务在监听。请先启动你的 RAG 服务，或在「设置 → 数据与同步」里更正地址。`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return `无法解析 ${url} 的主机名，请检查地址是否写错。`;
  if (/ETIMEDOUT|timeout|AbortError|超时/i.test(m)) return `${url} 响应超时。服务可能未启动，或索引过大正在处理中。`;
  if (/CERT|SSL|TLS/i.test(m)) return `与 ${url} 建立安全连接失败（证书问题）。若为本地自签证书服务，请改用 http。`;
  return `请求 ${url} 失败：${m || '未知错误'}`;
}

async function request(endpoint, pathname, { method = 'GET', body, timeout = 15000 } = {}) {
  const base = normalizeBase(endpoint);
  if (!base) return { ok: false, error: '未配置 RAG 服务地址' };
  const url = base + pathname;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tk = readToken();
  if (tk) headers.Authorization = 'Bearer ' + tk;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}

    if (!res.ok) {
      const detail = json && (json.error || json.detail || json.message);
      return {
        ok: false,
        status: res.status,
        error: `RAG 服务返回 HTTP ${res.status}${detail ? '：' + detail : ''}`,
        raw: String(text || '').slice(0, 300)
      };
    }
    if (json === null) {
      return { ok: false, error: 'RAG 服务返回的不是 JSON —— 地址可能指向了网页而不是接口', raw: String(text || '').slice(0, 200) };
    }
    return { ok: true, status: res.status, json };
  } catch (err) {
    const raw = (err && err.name === 'AbortError') ? '超时' : String((err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message) || err);
    return { ok: false, error: hintFor(raw, url) };
  } finally {
    clearTimeout(timer);
  }
}

const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
};

async function health({ endpoint } = {}) {
  const r = await request(endpoint, '/health', { timeout: 8000 });
  if (!r.ok) return r;
  const j = r.json || {};
  return {
    ok: true,
    indexed: Number(pick(j, ['indexed', 'indexed_count', 'count', 'documents', 'total']) || 0),
    model: pick(j, ['model', 'embedding_model', 'embeddingModel']) || '',
    updatedAt: pick(j, ['updated_at', 'updatedAt', 'last_indexed']) || '',
    version: pick(j, ['version']) || ''
  };
}

/* 检索结果字段容错：对方用 name/text/content 也能接上 */
function normalizeHit(h, i) {
  const o = (h && typeof h === 'object') ? h : { text: String(h) };
  const p = String(pick(o, ['path', 'file', 'source', 'file_path', 'document_path']) || '');
  const ext = (p.match(/\.([A-Za-z0-9]{1,6})$/) || [, ''])[1].toLowerCase();
  const rawScore = Number(pick(o, ['score', 'similarity', 'relevance', 'distance']) || 0);
  return {
    id: pick(o, ['id', 'doc_id', 'chunk_id']) || `hit-${i}`,
    title: String(pick(o, ['title', 'name', 'doc_title', 'file_name']) || (p ? p.split(/[\\/]/).pop() : '未命名资料')),
    path: p,
    snippet: String(pick(o, ['snippet', 'text', 'content', 'chunk', 'excerpt']) || ''),
    score: Number.isFinite(rawScore) ? rawScore : 0,
    docType: String(pick(o, ['doc_type', 'type', 'category']) || ''),
    page: pick(o, ['page', 'page_no', 'pageNumber']) || null,
    ext
  };
}

function pickArray(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return null;
  for (const k of ['results', 'hits', 'data', 'items', 'documents']) {
    const v = json[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.results)) return v.results;
  }
  return null;
}

async function search({ endpoint, query, topK, filters } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: '检索内容为空' };
  const top_k = Math.min(Math.max(Number(topK) || 8, 1), 50);
  const r = await request(endpoint, '/search', {
    method: 'POST',
    body: { query: q, top_k, filters: filters || {} },
    timeout: 20000
  });
  if (!r.ok) return r;
  const arr = pickArray(r.json);
  if (!arr) return { ok: false, error: 'RAG 服务响应中找不到 results 数组（检查 /search 的返回结构）' };
  const j = r.json || {};
  return {
    ok: true,
    count: arr.length,
    tookMs: Number(pick(j, ['took_ms', 'tookMs', 'elapsed_ms', 'latency_ms']) || 0) || null,
    model: pick(j, ['model', 'embedding_model']) || '',
    results: arr.map(normalizeHit)
  };
}

async function reindex({ endpoint } = {}) {
  const r = await request(endpoint, '/reindex', { method: 'POST', body: {}, timeout: 120000 });
  if (!r.ok) {
    if (r.status === 404 || r.status === 405) {
      return { ok: false, error: '该 RAG 服务未提供 /reindex 端点。重建索引请在服务端执行，或让服务实现 POST /reindex。' };
    }
    return r;
  }
  const j = r.json || {};
  return {
    ok: true,
    added: Number(pick(j, ['added', 'indexed', 'created']) || 0),
    updated: Number(pick(j, ['updated']) || 0),
    removed: Number(pick(j, ['removed', 'deleted']) || 0),
    indexed: Number(pick(j, ['indexed', 'total', 'count']) || 0),
    tookMs: Number(pick(j, ['took_ms', 'tookMs']) || 0) || null
  };
}

module.exports = {
  search, health, reindex, state, saveToken, readToken,
  /* 测试用：允许注入数据目录 */
  __setDir: d => { dirOverride = d; }
};
