/**
 * RAG_Snowz 主进程客户端：/health、/v1/search、/v1/ask。
 * 用假的 HTTP 响应，不连接本机 8765，也不写入任何语料。
 *
 * 运行：node --test tests/rag-snowz.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test, afterEach } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);
const require = createRequire(import.meta.url);
const rag = require('../desktop/rag.js');

const realFetch = globalThis.fetch;
let tmp = null;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
  rag.__setDir(null);
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  };
}

function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    const entry = {
      url: String(url),
      method: opt.method || 'GET',
      headers: opt.headers || {},
      body: opt.body ? JSON.parse(opt.body) : undefined
    };
    calls.push(entry);
    return handler(entry);
  };
  return calls;
}

test('snowz health reads docs and chunks and does not call them a vector index', async () => {
  const calls = installFetch(() => jsonResponse({
    ok: true,
    docs: 266,
    chunks_fixed_length: 33383,
    default_candidate_n: 14000,
    ask_default: { mode: 'extractive', llm_required: false }
  }));
  const h = await rag.health({ endpoint: 'http://127.0.0.1:8765', engine: 'rag_snowz' });
  assert.equal(h.ok, true);
  assert.equal(h.docs, 266);
  assert.equal(h.chunks, 33383);
  assert.equal(h.candidates, 14000);
  assert.equal(h.indexed, 0);
  assert.equal(h.askMode, 'extractive');
  assert.equal(h.llmRequired, false);
  assert.equal(h.engine, 'rag_snowz');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/health');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].body, undefined);
});

test('snowz search posts /v1/search without a bearer token', async () => {
  tmp = mkdtempSync(join(tmpdir(), 'rag-snowz-'));
  rag.__setDir(tmp);
  writeFileSync(join(tmp, 'rag-token.bin'), 'should-not-be-sent');
  const calls = installFetch(() => jsonResponse({
    hits: [{
      source_relative_path: 'notes/heat.md',
      source_hash: 'abc123',
      block_ids: ['p1', 'p2'],
      source_spans: [[0, 12]],
      chunk_id: 'c1',
      document_id: 'd1',
      text: '片段正文',
      score: 2.5
    }]
  }));
  const r = await rag.search({
    endpoint: 'http://127.0.0.1:8765/v1/search',
    engine: 'rag_snowz',
    query: '换热',
    topK: 4
  });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/v1/search');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(calls[0].body, {
    query: '换热',
    top_k: 4,
    strategy: 'fixed_length',
    method: 'pg_fts:bm25_rerank'
  });
  assert.equal(r.results[0].source_relative_path, 'notes/heat.md');
  assert.deepEqual(r.results[0].block_ids, ['p1', 'p2']);
  assert.deepEqual(r.results[0].source_spans, [[0, 12]]);
  assert.equal(r.results[0].chunk_id, 'c1');
  assert.equal(r.results[0].document_id, 'd1');
  assert.equal(r.results[0].text, '片段正文');
  assert.equal(r.results[0].score, 2.5);
});

test('snowz ask is extractive and requires citations', async () => {
  const calls = installFetch((entry) => {
    if (entry.url.endsWith('/v1/ask')) {
      return jsonResponse({
        answer: '抽取式回答',
        citations: [{
          source_relative_path: 'reports/a.md',
          block_ids: [3],
          source_spans: [[4, 9]],
          text: '引用句'
        }],
        use_llm: false
      });
    }
    return jsonResponse({ hits: [] });
  });
  const r = await rag.ask({
    endpoint: '127.0.0.1:8765',
    engine: 'rag_snowz',
    query: '结论是什么',
    useLlm: true
  });
  assert.equal(r.ok, true);
  assert.equal(r.useLlm, false);
  assert.equal(r.mode, 'extractive');
  assert.equal(r.answer, '抽取式回答');
  assert.equal(r.citations[0].source_relative_path, 'reports/a.md');
  assert.deepEqual(r.citations[0].block_ids, [3]);
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/v1/ask');
  assert.equal(calls[0].body.use_llm, false);
  assert.equal(calls[0].body.strategy, 'fixed_length');
  assert.equal(calls[0].body.method, 'pg_fts:bm25_rerank');
  assert.equal(calls[0].headers.Authorization, undefined);

  installFetch(() => jsonResponse({ answer: '没有引用' }));
  const missing = await rag.ask({ endpoint: 'http://127.0.0.1:8765', engine: 'rag_snowz', query: 'x' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /citations/);
});

test('snowz reindex does not hit the network', async () => {
  let called = 0;
  globalThis.fetch = async () => { called += 1; return jsonResponse({}); };
  const r = await rag.reindex({ endpoint: 'http://127.0.0.1:8765', engine: 'rag_snowz' });
  assert.equal(r.ok, false);
  assert.match(r.error, /不调用 \/reindex/);
  assert.equal(called, 0);
});

test('unreachable snowz returns a readable error', async () => {
  globalThis.fetch = async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8765');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  const h = await rag.health({ endpoint: 'http://127.0.0.1:8765', engine: 'rag_snowz' });
  assert.equal(h.ok, false);
  assert.match(h.error, /8765/);
  assert.equal(h.error.includes('0.0.0.0'), false);
});

test('generic http engine still uses /search and can send a stored bearer', async () => {
  tmp = mkdtempSync(join(tmpdir(), 'rag-http-'));
  rag.__setDir(tmp);
  writeFileSync(join(tmp, 'rag-token.bin'), 'local-token');
  const calls = installFetch(() => jsonResponse({
    took_ms: 12,
    results: [{ title: '旧接口', path: 'C:/docs/a.pdf', snippet: '片段', score: 0.5, page: 2 }]
  }));
  const r = await rag.search({ endpoint: 'http://127.0.0.1:8000', query: 'q', topK: 3, filters: { doc_type: '论文' } });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/search');
  assert.equal(calls[0].headers.Authorization, 'Bearer local-token');
  assert.equal(calls[0].body.top_k, 3);
  assert.deepEqual(calls[0].body.filters, { doc_type: '论文' });
  assert.equal(r.results[0].path, 'C:/docs/a.pdf');
  assert.equal(r.results[0].page, 2);
  const refused = await rag.ask({ endpoint: 'http://127.0.0.1:8000', engine: 'http', query: 'q' });
  assert.equal(refused.ok, false);
});

function loadTools() {
  const ctx = createContext({ console });
  runInContext(readFileSync(new URL('./assets/js/data.js', root), 'utf8'), ctx, { filename: 'data.js' });
  ctx.state = { project: '' };
  ctx.persist = () => {};
  ctx.logActivity = () => {};
  ctx.esc = (s) => String(s == null ? '' : s);
  ctx.Bridge = {
    ragSearch: async () => ({ ok: false, error: 'search-down' }),
    ragAsk: async () => ({ ok: false, error: 'ask-down' })
  };
  runInContext(readFileSync(new URL('./assets/js/ai-tools.js', root), 'utf8'), ctx, { filename: 'ai-tools.js' });
  return ctx;
}

function tool(ctx, name, args) {
  ctx.__toolArgs = args || {};
  return runInContext(`AI_TOOL_IMPL[${JSON.stringify(name)}](__toolArgs)`, ctx);
}

test('fresh settings point at loopback RAG_Snowz and old untouched installs migrate', () => {
  const ctx = loadTools();
  const fresh = ctx.freshData().settings;
  assert.equal(fresh.kbEngine, 'rag_snowz');
  assert.equal(fresh.ragEndpoint, 'http://127.0.0.1:8765');
  assert.equal(fresh.ragEnabled, true);
  const cfg = ctx.ragClientConfig({ kbEngine: 'rag_snowz', ragEndpoint: '' });
  assert.equal(cfg.engine, 'rag_snowz');
  assert.equal(cfg.endpoint, 'http://127.0.0.1:8765');
  assert.equal(cfg.topK, 8);
  assert.equal(cfg.snowz, true);
  assert.equal(cfg.external, true);

  const legacy = ctx.freshData();
  legacy.settings.kbEngine = 'builtin';
  legacy.settings.ragEnabled = false;
  legacy.settings.ragEndpoint = 'http://127.0.0.1:8000';
  const migrated = ctx.migrate(legacy);
  assert.equal(migrated.settings.kbEngine, 'rag_snowz');
  assert.equal(migrated.settings.ragEndpoint, 'http://127.0.0.1:8765');
  assert.equal(migrated.settings.ragEnabled, true);

  const custom = ctx.freshData();
  custom.settings.kbEngine = 'http';
  custom.settings.ragEnabled = true;
  custom.settings.ragEndpoint = 'http://127.0.0.1:9000';
  const kept = ctx.migrate(custom);
  assert.equal(kept.settings.kbEngine, 'http');
  assert.equal(kept.settings.ragEndpoint, 'http://127.0.0.1:9000');
});

test('assistant prefers ask and keeps citation paths; search is the fallback', async () => {
  const ctx = loadTools();
  runInContext(`
    setDB(freshData());
    DB.settings.kbEngine = 'rag_snowz';
    DB.settings.ragEnabled = true;
    DB.settings.ragEndpoint = 'http://127.0.0.1:8765';
  `, ctx);
  ctx.Bridge.ragAsk = async (cfg) => {
    ctx.__ask = cfg;
    return {
      ok: true,
      answer: '见引用。',
      citations: [{
        source_relative_path: 'lit/paper.md',
        block_ids: ['b8'],
        source_spans: [[1, 2]],
        text: '原文',
        score: 1.25
      }]
    };
  };
  ctx.Bridge.ragSearch = async () => { throw new Error('ask 成功时不应再检索'); };
  const asked = await tool(ctx, 'search_knowledge', { query: '换热' });
  assert.equal(asked.ok, true);
  assert.equal(asked.mode, 'ask');
  assert.equal(asked.answer, '见引用。');
  assert.equal(asked.citations[0].source_relative_path, 'lit/paper.md');
  assert.deepEqual(asked.citations[0].block_ids, ['b8']);
  assert.equal(ctx.__ask.engine, 'rag_snowz');
  assert.equal(ctx.__ask.endpoint, 'http://127.0.0.1:8765');

  ctx.Bridge.ragAsk = async () => ({ ok: false, error: 'ask 不可用' });
  ctx.Bridge.ragSearch = async (cfg) => {
    ctx.__search = cfg;
    return {
      ok: true,
      results: [{ title: '片段', path: 'lit/note.md', source_relative_path: 'lit/note.md', snippet: '正文', score: 0.4, block_ids: [1] }]
    };
  };
  const searched = await tool(ctx, 'search_knowledge', { query: '换热' });
  assert.equal(searched.mode, 'search');
  assert.equal(searched.results[0].source_relative_path, 'lit/note.md');
  assert.equal(searched.ask_error, 'ask 不可用');
  assert.equal(ctx.__search.engine, 'rag_snowz');
});

test('knowledge page renders ask text, relative path, and block ids', () => {
  const ctx = createContext({
    console,
    document: { getElementById() { return null; }, body: { classList: { toggle() {} } } },
    location: { search: '', hash: '' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  });
  ctx.window = { workspace: null };
  for (const file of ['assets/js/icons.js', 'assets/js/data.js', 'assets/js/api.js', 'assets/js/ui.js']) {
    runInContext(readFileSync(new URL('./' + file, root), 'utf8'), ctx, { filename: file });
  }
  runInContext('function projectView(){ return ""; }', ctx);
  runInContext(readFileSync(new URL('./assets/js/app.js', root), 'utf8'), ctx, { filename: 'assets/js/app.js' });
  runInContext(`
    setDB(freshData());
    DB.kbDocs = [];
    state.q = '换热';
    state.rag = { status: 'ok', indexed: 0, docs: 266, chunks: 33383, model: 'pg_fts:bm25_rerank', askMode: 'extractive', error: '' };
    state.ragResults = [{
      title: 'heat.md', source_relative_path: 'notes/heat.md', path: 'notes/heat.md',
      snippet: '片段正文', score: 2.5, block_ids: ['p1'], ext: 'md', docType: ''
    }];
    state.ragAnswer = { text: '抽取回答', citations: state.ragResults };
    state.ragMeta = { model: 'pg_fts:bm25_rerank', tookMs: 12, mode: 'ask' };
  `, ctx);
  const html = ctx.knowledgeView();
  assert.match(html, /data-act="kb-ask"/);
  assert.match(html, /data-act="kb-search"/);
  assert.match(html, /抽取回答/);
  assert.match(html, /notes\/heat\.md/);
  assert.match(html, /块 p1/);
  assert.match(html, /\/v1\/ask/);
  assert.equal(html.includes('向量索引 266'), false);
  assert.match(html, /文档 266/);
  assert.match(html, /片段 33383/);
});
