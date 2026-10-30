/**
 * 知识库服务未启动（engine_down）时确定性停止；回复里没有本轮依据的「已保存」或历史报错要附核对说明。
 * 运行：node --test tests/engine-down.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);
const require = createRequire(import.meta.url);
const loop = require('../desktop/ai-chat-loop.js');
const PROMPT = '基于文献库中TPMS换热器的相关内容，让综述agent给我写一篇1000字的文献综述';

function loadData() {
  const ctx = createContext({ console, URL });
  runInContext(readFileSync(new URL('./assets/js/data.js', root), 'utf8'), ctx, { filename: 'data.js' });
  return ctx;
}

test('engineDownNotice names the endpoint and says nothing was saved', () => {
  const ctx = loadData();
  const msg = ctx.engineDownNotice('http://127.0.0.1:8765');
  assert.ok(msg.startsWith('知识库服务未启动（127.0.0.1:8765）'));
  assert.ok(msg.includes('设置 → AI 与知识库引擎'));
  assert.equal(ctx.isEngineDownResult('search_knowledge', { code: 'engine_down' }), true);
  assert.equal(ctx.isEngineDownResult('search_knowledge', { code: 'ok' }), false);
  const guide = ctx.standingChatGuidance();
  assert.ok(guide.includes('engine_down'));
  assert.ok(guide.includes('只陈述本轮事实'));
});

test('chat loop stops on engine_down without asking the model again', async () => {
  let chats = 0;
  const notice = '知识库服务未启动（127.0.0.1:8765）。测试';
  const out = await loop.runAiChatLoop({
    chat: async () => {
      chats += 1;
      return {
        ok: true, content: '',
        toolCalls: [
          { id: 'a', function: { name: 'search_knowledge', arguments: JSON.stringify({ query: 'TPMS', mode: 'search' }) } },
          { id: 'b', function: { name: 'save_document', arguments: '{}' } }
        ]
      };
    },
    invokeTool: async (name) => name === 'search_knowledge'
      ? { ok: true, code: 'engine_down', count: 0, stop: true, user_message: notice }
      : { ok: true, savedPath: 'X:/should-not-run.md' },
    messages: [{ role: 'user', content: PROMPT }],
    autoApprove: true
  });
  assert.equal(chats, 1);
  assert.equal(out.stopped, 'engine_down');
  assert.equal(out.finalText, notice);
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'search_knowledge');
});

test('claims of saved drafts or old errors without this turn evidence get a note', async () => {
  const ctx = loadData();
  for (const fn of [loop.unverifiedClaimNote, ctx.unverifiedClaimNote]) {
    assert.ok(fn('上一轮我已经写好了一版 1000 字综述。', []).includes('并未保存'));
    assert.ok(fn('存档报错：Bridge.saveWritingDoc is not a function', []).includes('历史信息'));
    assert.equal(fn('已保存：F:/a/b.md', [{ name: 'save_document', result: { ok: true, savedPath: 'F:/a/b.md' } }]), '');
    assert.equal(fn('文稿未保存，请先启动服务。', []), '');
  }
  const out = await loop.runAiChatLoop({
    chat: async () => ({ ok: true, content: '上一轮已经写好综述，直接用即可。', toolCalls: [] }),
    invokeTool: async () => ({ ok: true }),
    messages: [{ role: 'user', content: PROMPT }]
  });
  assert.ok(out.finalText.includes('（系统核对）'));
});

test('search_knowledge returns stop + user_message when RAG is unreachable', async () => {
  const ctx = loadData();
  ctx.state = { project: '', aiAgent: '', rag: { status: 'ok', docs: 266 } };
  ctx.Bridge = {
    ragSearch: async () => ({ ok: false, error: 'connect ECONNREFUSED 127.0.0.1:8765' }),
    ragAsk: async () => ({ ok: false, error: 'connect ECONNREFUSED 127.0.0.1:8765' })
  };
  runInContext(readFileSync(new URL('./assets/js/ai-tools.js', root), 'utf8'), ctx, { filename: 'ai-tools.js' });
  runInContext(`setDB(freshData()); DB.settings.kbEngine = 'rag_snowz'; DB.settings.ragEndpoint = 'http://127.0.0.1:8765';`, ctx);
  const res = await runInContext(`AI_TOOL_IMPL.search_knowledge({ query: 'TPMS 换热器', mode: 'search' })`, ctx);
  assert.equal(res.code, 'engine_down');
  assert.equal(res.stop, true);
  assert.ok(res.user_message.startsWith('知识库服务未启动（127.0.0.1:8765）'));
  assert.equal(ctx.state.rag.status, 'fail');
  assert.equal(ctx.resolveKnowledgeIndex('rag_snowz', ctx.state.rag).knowledge_index_status, 'engine_down');
});
