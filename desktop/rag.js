/* ==========================================================================
   外部 RAG 服务客户端（只在 Electron 主进程里发请求）
   --------------------------------------------------------------------------
   渲染进程不能直接请求 RAG：RAG_Snowz 没有 CORS，浏览器里的 fetch 会被拦下。
   知识库页和 AI 助手都走 IPC，由这里转发到本机回环地址。

   RAG_Snowz（engine = rag_snowz，默认 http://127.0.0.1:8765，无鉴权）：
     GET  {base}/health
     POST {base}/v1/search   { query, top_k, strategy, method }
     POST {base}/v1/ask      { query, top_k, strategy, method, use_llm:false }
   默认 strategy=fixed_length，method=pg_fts:bm25_rerank。
   检索命中用 hits[]，问答必须带 citations[]（source_relative_path 等）。
   这不是向量索引，不要把 docs / chunks 说成向量条数。
   不发送 Authorization。索引由 RAG 服务自己维护，这里不调用 /reindex。

   通用 HTTP 引擎（engine = http，兼容旧接入）：
     GET  {base}/health
     POST {base}/search
     POST {base}/reindex
   可选 Bearer 令牌只留在主进程，不进数据文件。
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = 'rag-token.bin';
const DEFAULT_BASE = 'http://127.0.0.1:8765';
const SNOWZ_STRATEGY = 'fixed_length';
const SNOWZ_METHOD = 'pg_fts:bm25_rerank';
let dirOverride = null;

function electronMods() {
  try { return require('electron'); } catch (_) { return null; }
}

function dir() {
  if (dirOverride) return dirOverride;
  const e = electronMods();
  if (!e || !e.app || typeof e.app.getPath !== 'function') return '';
  return e.app.getPath('userData');
}
function tokenPath() { return path.join(dir(), TOKEN_FILE); }

function isSnowz(cfg) {
  const engine = String((cfg && (cfg.engine || cfg.dialect)) || '');
  return engine === 'rag_snowz';
}

/* 令牌只存在主进程：加密落盘，渲染层永远拿不到明文。RAG_Snowz 不使用它。 */
function saveToken(plain) {
  const s = String(plain == null ? '' : plain).trim();
  try {
    if (!dir()) return { ok: false, error: '当前环境没有用户数据目录，无法保存令牌' };
    if (!s) {
      try { fs.rmSync(tokenPath(), { force: true }); } catch (_) {}
      return { ok: true, stored: false };
    }
    const e = electronMods();
    const safeStorage = e && e.safeStorage;
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(tokenPath(), safeStorage.encryptString(s));
      return { ok: true, stored: true, encrypted: true };
    }
    fs.writeFileSync(tokenPath(), Buffer.from(s, 'utf8'));
    return { ok: true, stored: true, encrypted: false };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function readToken() {
  try {
    if (!dir() || !fs.existsSync(tokenPath())) return '';
    const buf = fs.readFileSync(tokenPath());
    const e = electronMods();
    const safeStorage = e && e.safeStorage;
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(buf); } catch (_) { return ''; }
    }
    return buf.toString('utf8');
  } catch (_) { return ''; }
}

function state() {
  const has = !!readToken();
  let encrypted = false;
  try {
    const e = electronMods();
    encrypted = !!(e && e.safeStorage && e.safeStorage.isEncryptionAvailable());
  } catch (_) {}
  return { stored: has, encrypted };
}

function normalizeBase(endpoint) {
  let s = String(endpoint || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/v1\/(search|ask|health)$/i, '');
  s = s.replace(/\/(search|health|reindex)$/i, '');
  s = s.replace(/\/v1$/i, '');
  return s.replace(/\/+$/, '');
}

/* 把底层网络错误翻译成能直接照着做的提示 */
function hintFor(raw, url) {
  const m = String(raw || '');
  if (/ECONNREFUSED/i.test(m)) return `无法连接 ${url}：目标端口没有服务在监听。请先在本机启动 RAG 服务（RAG_Snowz 默认 http://127.0.0.1:8765），或在「设置 → AI 与知识库引擎」里更正地址。`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return `无法解析 ${url} 的主机名，请检查地址是否写错。`;
  if (/ETIMEDOUT|timeout|AbortError|超时/i.test(m)) return `${url} 响应超时。服务可能未启动，或正在处理较大的检索。`;
  if (/CERT|SSL|TLS/i.test(m)) return `与 ${url} 建立安全连接失败（证书问题）。本机服务请使用 http://127.0.0.1 地址。`;
  return `请求 ${url} 失败：${m || '未知错误'}`;
}

async function request(endpoint, pathname, { method = 'GET', body, timeout = 15000, auth = true } = {}) {
  const base = normalizeBase(endpoint);
  if (!base) return { ok: false, error: '未配置 RAG 服务地址' };
  const url = base + pathname;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  /* RAG_Snowz 无鉴权。只有通用 HTTP 引擎才附带主进程里的 Bearer。 */
  if (auth) {
    const tk = readToken();
    if (tk) headers.Authorization = 'Bearer ' + tk;
  }

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

function asList(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  return [v];
}

function readAskMeta(j) {
  const askDefault = j && j.ask_default;
  let askMode = '';
  let llmRequired = null;
  if (askDefault && typeof askDefault === 'object') {
    askMode = String(pick(askDefault, ['mode', 'name', 'type']) || '');
    if ('llm_required' in askDefault) llmRequired = !!askDefault.llm_required;
  } else if (typeof askDefault === 'string') {
    askMode = askDefault;
  }
  if (j && 'llm_required' in j) llmRequired = !!j.llm_required;
  return { askMode, llmRequired };
}

async function health(cfg = {}) {
  const snowz = isSnowz(cfg);
  const endpoint = cfg.endpoint || (snowz ? DEFAULT_BASE : '');
  const r = await request(endpoint, '/health', { timeout: 8000, auth: !snowz });
  if (!r.ok) return r;
  const j = r.json || {};
  const docs = Number(pick(j, ['docs', 'documents']) || 0);
  const chunks = Number(pick(j, ['chunks_fixed_length', 'chunks', 'chunk_count']) || 0);
  const candidates = Number(pick(j, ['default_candidate_n', 'candidate_n', 'candidates']) || 0);
  const indexedReported = Number(pick(j, ['indexed', 'indexed_count', 'count', 'total']) || 0);
  const ask = readAskMeta(j);
  return {
    ok: true,
    /* snowz 是全文检索，不是向量索引。indexed 只留给通用 HTTP 引擎的上报值。 */
    indexed: snowz ? 0 : (indexedReported || docs || 0),
    docs: snowz ? (docs || indexedReported || 0) : (docs || 0),
    chunks: chunks || 0,
    candidates: candidates || 0,
    askMode: ask.askMode,
    llmRequired: ask.llmRequired,
    model: pick(j, ['model', 'embedding_model', 'embeddingModel']) || (snowz ? SNOWZ_METHOD : ''),
    updatedAt: pick(j, ['updated_at', 'updatedAt', 'last_indexed']) || '',
    version: pick(j, ['version']) || '',
    engine: snowz ? 'rag_snowz' : 'http'
  };
}

/* 检索结果字段容错。RAG_Snowz 的原文位置在 source_relative_path。 */
function normalizeHit(h, i) {
  const o = (h && typeof h === 'object') ? h : { text: String(h) };
  const rel = String(pick(o, ['source_relative_path', 'sourceRelativePath', 'path', 'file', 'source', 'file_path', 'document_path']) || '');
  const ext = (rel.match(/\.([A-Za-z0-9]{1,8})$/) || [, ''])[1].toLowerCase();
  const rawScore = Number(pick(o, ['score', 'similarity', 'relevance', 'distance']) || 0);
  const snippet = String(pick(o, ['snippet', 'text', 'content', 'chunk', 'excerpt']) || '');
  const blockIds = asList(pick(o, ['block_ids', 'blockIds']));
  const spans = pick(o, ['source_spans', 'sourceSpans']);
  return {
    id: pick(o, ['chunk_id', 'chunkId', 'id', 'doc_id']) || `hit-${i}`,
    title: String(pick(o, ['title', 'name', 'doc_title', 'file_name']) || (rel ? rel.split(/[\\/]/).pop() : '未命名资料')),
    path: rel,
    source_relative_path: rel,
    snippet,
    text: snippet,
    score: Number.isFinite(rawScore) ? rawScore : 0,
    docType: String(pick(o, ['doc_type', 'type', 'category']) || ''),
    page: pick(o, ['page', 'page_no', 'pageNumber']) || null,
    source_hash: String(pick(o, ['source_hash', 'sourceHash']) || ''),
    block_ids: blockIds,
    source_spans: spans == null ? [] : spans,
    chunk_id: String(pick(o, ['chunk_id', 'chunkId']) || ''),
    document_id: String(pick(o, ['document_id', 'documentId', 'doc_id']) || ''),
    ext
  };
}

function pickArray(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return null;
  for (const k of ['hits', 'results', 'citations', 'data', 'items', 'documents']) {
    const v = json[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (const k2 of ['hits', 'results', 'items']) {
        if (Array.isArray(v[k2])) return v[k2];
      }
    }
  }
  return null;
}

function snowzBody(query, topK, cfg) {
  return {
    query,
    top_k: Math.min(Math.max(Number(topK) || 8, 1), 50),
    strategy: String((cfg && cfg.strategy) || SNOWZ_STRATEGY),
    method: String((cfg && cfg.method) || SNOWZ_METHOD)
  };
}

async function search(cfg = {}) {
  const q = String(cfg.query || '').trim();
  if (!q) return { ok: false, error: '检索内容为空' };
  const snowz = isSnowz(cfg);
  const endpoint = cfg.endpoint || (snowz ? DEFAULT_BASE : '');
  const top_k = Math.min(Math.max(Number(cfg.topK != null ? cfg.topK : cfg.top_k) || 8, 1), 50);
  const r = await request(endpoint, snowz ? '/v1/search' : '/search', {
    method: 'POST',
    body: snowz ? snowzBody(q, top_k, cfg) : { query: q, top_k, filters: cfg.filters || {} },
    timeout: snowz ? 30000 : 20000,
    auth: !snowz
  });
  if (!r.ok) return r;
  const arr = pickArray(r.json);
  if (!arr) return { ok: false, error: snowz ? 'RAG_Snowz 响应中找不到 hits 数组（检查 /v1/search 的返回结构）' : 'RAG 服务响应中找不到 results 数组（检查 /search 的返回结构）' };
  const j = r.json || {};
  return {
    ok: true,
    count: arr.length,
    tookMs: Number(pick(j, ['took_ms', 'tookMs', 'elapsed_ms', 'latency_ms']) || 0) || null,
    model: pick(j, ['model', 'method', 'embedding_model']) || (snowz ? SNOWZ_METHOD : ''),
    strategy: snowz ? SNOWZ_STRATEGY : '',
    engine: snowz ? 'rag_snowz' : 'http',
    results: arr.map(normalizeHit)
  };
}

function extractAnswer(json) {
  if (!json || typeof json !== 'object') return '';
  if (typeof json.answer === 'string') return json.answer;
  if (json.answer && typeof json.answer === 'object') {
    return String(pick(json.answer, ['text', 'content', 'answer', 'extract']) || '');
  }
  return String(pick(json, ['text', 'extract', 'content', 'output']) || '');
}

function extractCitations(json) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.citations)) return json.citations;
  if (json.answer && typeof json.answer === 'object' && Array.isArray(json.answer.citations)) return json.answer.citations;
  if (Array.isArray(json.sources)) return json.sources;
  return null;
}

async function ask(cfg = {}) {
  const q = String(cfg.query || '').trim();
  if (!q) return { ok: false, error: '提问内容为空' };
  if (!isSnowz(cfg)) {
    return { ok: false, error: '抽取式问答仅 RAG_Snowz 引擎提供。请在「设置 → AI 与知识库引擎」选择 RAG_Snowz。' };
  }
  const endpoint = cfg.endpoint || DEFAULT_BASE;
  const top_k = Math.min(Math.max(Number(cfg.topK != null ? cfg.topK : cfg.top_k) || 8, 1), 50);
  const r = await request(endpoint, '/v1/ask', {
    method: 'POST',
    /* 契约默认抽取式，不把 use_llm 打开。 */
    body: Object.assign(snowzBody(q, top_k, cfg), { use_llm: false }),
    timeout: 60000,
    auth: false
  });
  if (!r.ok) return r;
  const cites = extractCitations(r.json);
  if (!cites) return { ok: false, error: 'RAG_Snowz /v1/ask 响应缺少 citations 数组' };
  const j = r.json || {};
  return {
    ok: true,
    answer: extractAnswer(j),
    citations: cites.map(normalizeHit),
    count: cites.length,
    tookMs: Number(pick(j, ['took_ms', 'tookMs', 'elapsed_ms', 'latency_ms']) || 0) || null,
    useLlm: false,
    mode: 'extractive',
    engine: 'rag_snowz',
    model: SNOWZ_METHOD
  };
}

async function reindex(cfg = {}) {
  if (isSnowz(cfg)) {
    return {
      ok: false,
      error: 'RAG_Snowz 的索引由本机服务自己维护，工作台不调用 /reindex。用「测试连接」查看文档数与片段数。'
    };
  }
  const r = await request(cfg.endpoint, '/reindex', { method: 'POST', body: {}, timeout: 120000, auth: true });
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
  search, health, ask, reindex, state, saveToken, readToken, isSnowz, normalizeBase,
  DEFAULT_BASE, SNOWZ_STRATEGY, SNOWZ_METHOD,
  /* 测试用：允许注入数据目录 */
  __setDir: d => { dirOverride = d; }
};
