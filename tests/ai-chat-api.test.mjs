/**
 * POST /api/ai/chat：鉴权、综述身份、search_knowledge 循环、删除确认。
 * 运行：node --test tests/ai-chat-api.test.mjs
 * 用法与风险：tests/ai-chat-api.md
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, test, before, after } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);
const require = createRequire(import.meta.url);
const api = require('../desktop/api-server.js');
const loop = require('../desktop/ai-chat-loop.js');

const PROBE_B = '让综述 agent 基于知识库写 TPMS 换热器综述，先给文献清单和分类框架，先不要成文';

function loadWorkspace() {
  const ctx = createContext({ console });
  runInContext(readFileSync(new URL('./assets/js/data.js', root), 'utf8'), ctx, { filename: 'data.js' });
  ctx.state = { project: '', aiAgent: '', rag: { status: 'unknown', indexed: 0, docs: 0, chunks: 0 } };
  runInContext(readFileSync(new URL('./assets/js/ai-tools.js', root), 'utf8'), ctx, { filename: 'ai-tools.js' });
  runInContext(`
    setDB(freshData());
    const p = makeProject({ id: 'pmvgt6e8u1h7', name: 'TPMS换热器', folder: 'TPMS换热器', displayName: 'TPMS 换热器' });
    DB.projects.push(p);
    DB.chats = {};
    state.project = '';
    state.aiAgent = '';
  `, ctx);
  return ctx;
}

function extractBridgeArg(code) {
  const marker = 'window.__RW_API__(';
  const i = String(code).indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < code.length; k++) {
    const ch = code[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(code.slice(start, k + 1));
    }
  }
  return null;
}

function toolReply(id, name, args, content) {
  return {
    ok: true,
    content: content || '',
    toolCalls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  };
}

test('knowledge health keeps a real zero and does not coerce unknown to 0', () => {
  const aligned = api.knowledgeFields({
    knowledge_indexed: 266,
    knowledge_index_status: 'ok',
    knowledge_docs: 266,
    knowledge_chunks: 33383,
    knowledge_index_kind: 'docs'
  }, true);
  assert.equal(aligned.knowledge_indexed, 266);
  assert.equal(aligned.knowledge_index_kind, 'docs');

  const builtin = api.knowledgeFields({
    knowledge_indexed: 0,
    knowledge_index_status: 'builtin',
    knowledge_docs: 0,
    knowledge_chunks: 0,
    knowledge_index_kind: 'none'
  }, true);
  assert.equal(builtin.knowledge_indexed, 0);

  const external = api.knowledgeFields({
    knowledge_indexed: null,
    knowledge_index_status: 'external',
    knowledge_docs: null,
    knowledge_chunks: null,
    knowledge_index_kind: 'docs'
  }, true);
  assert.equal(external.knowledge_indexed, null);
  assert.equal(external.knowledge_index_status, 'external');

  assert.equal(api.knowledgeFields({}, false).knowledge_index_status, 'external');
  assert.equal(api.knowledgeFields({}, false).knowledge_indexed, null);
  assert.equal(api.knowledgeFields({}, true).knowledge_index_status, 'unknown');

  const src = readFileSync(new URL('./desktop/api-server.js', root), 'utf8');
  assert.equal(src.includes('diag.knowledge_indexed || 0'), false);
  assert.match(src, /version: '3\.1\.0'/);
  const actions = readFileSync(new URL('./assets/js/actions.js', root), 'utf8');
  assert.match(actions, /resolveKnowledgeIndex/);
  assert.match(actions, /__ai_prepare__/);
  assert.match(actions, /AI_MAX_ROUNDS = 6/);
  assert.equal(loop.AI_CHAT_MAX_ROUNDS, 6);
  assert.equal(loop.AI_CHAT_MAX_TOOL_CALLS, 12);
});

test('destructive tools stay behind confirm even when autoApprove is on', async () => {
  assert.equal(loop.decideToolExecution('delete_task', { task_id: 'tk1' }, true).run, false);
  assert.equal(loop.decideToolExecution('delete_task', { task_id: 'tk1', confirm: 'true' }, true).run, false);
  assert.equal(loop.decideToolExecution('delete_project', { project: 'a', confirm: true }, true).run, true);
  assert.equal(loop.decideToolExecution('delete_task', { task_id: 'tk1', dry_run: 'true' }, true).reason, 'dry_run');
  assert.equal(loop.decideToolExecution('create_task', { title: 'x' }, false).run, false);
  assert.equal(loop.decideToolExecution('search_knowledge', { query: 'q' }, false).run, true);

  let invoked = 0;
  const blocked = await loop.runAiChatLoop({
    autoApprove: true,
    messages: [{ role: 'user', content: '删掉它' }],
    chat: async () => toolReply('d1', 'delete_task', { task_id: 'tk1' }, '我来删'),
    invokeTool: async () => { invoked += 1; return { ok: true, deleted: '不应该发生' }; }
  });
  assert.equal(invoked, 0);
  assert.equal(blocked.stopped, 'needs_confirm');
  assert.equal(blocked.toolCalls[0].executed, false);
  assert.equal(blocked.toolCalls[0].result.needsConfirm, true);
  assert.equal(blocked.rounds, 1);

  let previews = 0;
  let previewStep = 0;
  const preview = await loop.runAiChatLoop({
    autoApprove: true,
    messages: [{ role: 'user', content: '预览删除' }],
    chat: async () => {
      previewStep += 1;
      if (previewStep > 1) return { ok: true, content: '只是预览，没有删除', toolCalls: [] };
      return toolReply('d2', 'delete_project', { project: 'TPMS换热器', dry_run: true });
    },
    invokeTool: async (_name, args) => {
      previews += 1;
      assert.equal(args.dry_run, true);
      assert.equal(args.confirm, undefined);
      return { ok: true, dryRun: true, tool: 'delete_project' };
    }
  });
  assert.equal(previews, 1);
  assert.equal(preview.toolCalls[0].executed, true);
  assert.equal(preview.toolCalls[0].result.dryRun, true);

  let chats = 0;
  let tools = 0;
  const capped = await loop.runAiChatLoop({
    messages: [{ role: 'system', content: 'cap' }],
    chat: async () => {
      chats += 1;
      return toolReply('s' + chats, 'search_knowledge', { query: 'q' + chats, mode: 'search' });
    },
    invokeTool: async () => { tools += 1; return { ok: true, mode: 'search' }; }
  });
  assert.equal(chats, loop.AI_CHAT_MAX_ROUNDS);
  assert.equal(tools, loop.AI_CHAT_MAX_ROUNDS);
  assert.equal(capped.capped, true);
  assert.equal(capped.stopped, 'cap');

  let batchTools = 0;
  const batch = await loop.runAiChatLoop({
    messages: [{ role: 'user', content: '很多' }],
    chat: async () => ({
      ok: true,
      content: '',
      toolCalls: Array.from({ length: 20 }, (_, i) => ({
        id: 'b' + i,
        type: 'function',
        function: { name: 'search_knowledge', arguments: JSON.stringify({ query: 'q' + i, mode: 'search' }) }
      }))
    }),
    invokeTool: async () => { batchTools += 1; return { ok: true }; }
  });
  assert.equal(batchTools, loop.AI_CHAT_MAX_TOOL_CALLS);
  assert.equal(batch.capped, true);
});

describe('POST /api/ai/chat', { concurrency: false }, () => {
  let dir = '';
  let port = 0;
  let full = '';
  let read = '';
  let vm = null;
  let diag = {};
  let script = [];
  const seen = { tools: [], finish: [] };

  function fakeWindow() {
    return {
      isDestroyed() { return false; },
      webContents: {
        executeJavaScript(code) {
          const payload = extractBridgeArg(code);
          if (!payload) return Promise.resolve({ ok: false, error: 'bad bridge' });
          return Promise.resolve(onRenderer(payload));
        }
      }
    };
  }

  function onRenderer(payload) {
    const tool = payload.tool;
    const args = payload.args || {};
    if (tool === '__diag__') return diag;
    if (tool === '__ai_prepare__') {
      vm.__probeArgs = args;
      return runInContext('prepareAiProbe(__probeArgs)', vm);
    }
    if (tool === '__ai_finish__') {
      seen.finish.push(args);
      vm.__probeArgs = args;
      return runInContext('finishAiProbe(__probeArgs)', vm);
    }
    seen.tools.push({ tool, args });
    if (tool === 'search_knowledge') {
      return {
        ok: true,
        mode: args.mode || 'missing',
        query: args.query,
        count: 1,
        unique_docs: 1,
        results: [{ document_id: 'd1', source_relative_path: 'lit/tpms.pdf', text: '片段' }]
      };
    }
    if (tool === 'delete_task' || tool === 'delete_project' || tool === 'delete_todo') {
      return { ok: true, deleted: '不应该执行' };
    }
    return { ok: true, tool };
  }

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rw-ai-chat-'));
    vm = loadWorkspace();
    diag = {
      ok: true,
      version: '3.1.0',
      tools_count: 1,
      projects_count: 1,
      tasks_count: 0,
      knowledge_indexed: 266,
      knowledge_index_status: 'ok',
      knowledge_docs: 266,
      knowledge_chunks: 33383,
      knowledge_index_kind: 'docs',
      knowledge_engine: 'rag_snowz'
    };
    api.setWindow(fakeWindow());
    api.setChat(async (cfg) => {
      const next = script.shift();
      if (!next) return { ok: false, error: '测试脚本用尽' };
      return next(cfg);
    });
    const started = await api.start({ userDataDir: dir, port: 39017, log() {} });
    assert.equal(started.ok, true);
    port = api.info().port;
    full = api.info().tokenFull;
    read = api.info().tokenRead;
    assert.ok(full && read && full !== read);
  });

  after(() => {
    api.setChat(null);
    api.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function call(path, { method = 'GET', token, body } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  test('health reports fetched RAG docs and unknown stays null', async () => {
    const ok = await call('/api/health');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.knowledge_indexed, 266);
    assert.equal(ok.json.knowledge_docs, 266);
    assert.equal(ok.json.knowledge_index_status, 'ok');
    assert.equal(ok.json.knowledge_index_kind, 'docs');
    assert.equal(ok.json.knowledge_engine, 'rag_snowz');

    diag = {
      ok: true,
      knowledge_indexed: null,
      knowledge_index_status: 'external',
      knowledge_docs: null,
      knowledge_chunks: null,
      knowledge_index_kind: 'docs',
      knowledge_engine: 'rag_snowz'
    };
    const pending = await call('/api/health');
    assert.equal(pending.json.knowledge_indexed, null);
    assert.equal(pending.json.knowledge_index_status, 'external');

    api.setWindow({ isDestroyed: () => true });
    const down = await call('/api/health');
    assert.equal(down.json.windowReady, false);
    assert.equal(down.json.knowledge_indexed, null);
    assert.equal(down.json.knowledge_index_status, 'external');
    api.setWindow(fakeWindow());
    diag = {
      ok: true,
      knowledge_indexed: 266,
      knowledge_index_status: 'ok',
      knowledge_docs: 266,
      knowledge_chunks: 33383,
      knowledge_index_kind: 'docs',
      knowledge_engine: 'rag_snowz'
    };
  });

  test('chat requires the full token and drives probe B', async () => {
    const anon = await call('/api/ai/chat', { method: 'POST', body: { projectId: 'pmvgt6e8u1h7', message: 'hi' } });
    assert.equal(anon.status, 401);

    const reader = await call('/api/ai/chat', {
      method: 'POST',
      token: read,
      body: { projectId: 'pmvgt6e8u1h7', message: PROBE_B, autoApprove: true }
    });
    assert.equal(reader.status, 403);
    assert.equal(seen.tools.length, 0);

    const method = await call('/api/ai/chat', { method: 'GET', token: full });
    assert.equal(method.status, 405);

    const missing = await call('/api/ai/chat', { method: 'POST', token: full, body: { message: PROBE_B } });
    assert.equal(missing.status, 400);
    assert.match(missing.json.error, /projectId/);

    seen.tools = [];
    seen.finish = [];
    script = [
      (cfg) => {
        assert.match(cfg.messages[0].content, /科研写作·综述/);
        assert.match(cfg.messages[0].content, /mode=search/);
        assert.match(cfg.messages[0].content, /文献清单/);
        assert.match(cfg.messages[0].content, /请用户确认/);
        const spec = (cfg.tools || []).find(t => t.function && t.function.name === 'search_knowledge');
        assert.match(spec.function.description, /必须显式传入 mode/);
        return toolReply('c1', 'search_knowledge', { query: 'TPMS 换热器', mode: 'search' }, '先检索中文文献。');
      },
      () => toolReply('c2', 'search_knowledge', { query: 'TPMS heat exchanger', mode: 'search' }, '再检索英文文献。'),
      () => ({
        ok: true,
        content: '文献清单：\n1. lit/tpms.pdf（document_id d1）\n分类框架：\n- 结构\n- 换热\n尚未成文，先不要展开正文。',
        toolCalls: []
      })
    ];
    const res = await call('/api/ai/chat', {
      method: 'POST',
      token: full,
      body: { projectId: 'pmvgt6e8u1h7', message: PROBE_B }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.switched, true);
    assert.equal(res.json.switchReason, 'message');
    assert.equal(res.json.agent.presetKey, 'writing-review');
    assert.equal(res.json.agent.name, '科研写作·综述');
    assert.equal(res.json.rounds, 3);
    assert.equal(res.json.capped, false);
    assert.equal(seen.tools.length, 2);
    assert.equal(seen.tools[0].args.mode, 'search');
    assert.equal(seen.tools[0].args.query, 'TPMS 换热器');
    assert.equal(seen.tools[1].args.mode, 'search');
    assert.equal(seen.tools[1].args.query, 'TPMS heat exchanger');
    assert.match(res.json.finalText, /文献清单/);
    assert.match(res.json.finalText, /分类框架/);
    assert.match(res.json.finalText, /尚未成文/);
    assert.equal(res.json.finalText.includes('## '), false);
    assert.equal(res.json.messages[0].role, 'user');
    assert.equal(res.json.messages[0].content, PROBE_B);
    assert.equal(res.json.toolCalls.length, 2);
    assert.equal(res.json.toolCalls.every(c => c.executed && c.name === 'search_knowledge'), true);
    assert.equal(seen.finish.length, 1);
    assert.equal(vm.state.aiAgent, '');
    assert.equal(vm.state.project, '');
    assert.equal(runInContext('DB.chats["pmvgt6e8u1h7"]', vm), undefined);

    seen.tools = [];
    script = [
      () => toolReply('del', 'delete_task', { task_id: 'tk1' }, '删掉任务')
    ];
    const denied = await call('/api/ai/chat', {
      method: 'POST',
      token: full,
      body: { projectId: 'TPMS 换热器', message: '删掉那个任务', autoApprove: true }
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.json.stopped, 'needs_confirm');
    assert.equal(denied.json.toolCalls[0].executed, false);
    assert.equal(denied.json.toolCalls[0].result.needsConfirm, true);
    assert.equal(seen.tools.length, 0);
    assert.equal(vm.state.aiAgent, '');
  });
});
