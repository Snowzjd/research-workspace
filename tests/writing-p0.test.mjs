/**
 * 写作 P0：saveWritingDoc 桥、空根目录提示、search mode 与综述 Agent 自动切换。
 * 运行：node --test tests/writing-p0.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);

function loadTools() {
  const ctx = createContext({ console });
  runInContext(readFileSync(new URL('./assets/js/data.js', root), 'utf8'), ctx, { filename: 'data.js' });
  ctx.state = { project: '', aiAgent: '' };
  ctx.persist = () => {};
  ctx.logActivity = () => {};
  ctx.esc = (s) => String(s == null ? '' : s);
  ctx.__asks = 0;
  ctx.__searches = 0;
  ctx.Bridge = {
    saveWritingDoc: async (payload) => {
      ctx.__saved = payload;
      return { ok: true, relPath: payload.relPath, absPath: 'C:/ws/' + payload.relPath };
    },
    ragAsk: async () => { ctx.__asks += 1; return { ok: false, error: 'ask-down' }; },
    ragSearch: async () => { ctx.__searches += 1; return { ok: false, error: 'search-down' }; }
  };
  runInContext(readFileSync(new URL('./assets/js/ai-tools.js', root), 'utf8'), ctx, { filename: 'ai-tools.js' });
  return ctx;
}

function tool(ctx, name, args) {
  ctx.__toolArgs = args || {};
  return runInContext(`AI_TOOL_IMPL[${JSON.stringify(name)}](__toolArgs)`, ctx);
}

function seedProject(ctx) {
  runInContext(`
    setDB(freshData());
    const p = makeProject({ id: 'pmvgt6e8u1h7', name: 'TPMS换热器', folder: 'TPMS换热器', displayName: 'TPMS 换热器' });
    DB.projects.push(p);
    state.project = p.id;
    DB.settings.kbEngine = 'rag_snowz';
    DB.settings.ragEnabled = true;
    DB.settings.ragEndpoint = 'http://127.0.0.1:8765';
  `, ctx);
}

const BODY = '这是一段超过二十个字的正文，用来确认保存路径与根目录校验。';

test('Bridge.saveWritingDoc forwards to the preload mirror', async () => {
  const seen = [];
  const ctx = createContext({
    console,
    window: {
      workspace: {
        isDesktop: true,
        saveWritingDoc: async (payload) => {
          seen.push(payload);
          return { ok: true, absPath: 'C:/ws/a.md', relPath: payload.relPath };
        }
      }
    }
  });
  runInContext(readFileSync(new URL('./assets/js/api.js', root), 'utf8'), ctx, { filename: 'api.js' });
  ctx.__payload = { relPath: 'TPMS/写作/综述.md', content: '正文' };
  const r = await runInContext('Bridge.saveWritingDoc(__payload)', ctx);
  assert.equal(r.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].relPath, 'TPMS/写作/综述.md');

  ctx.window.workspace.saveWritingDoc = undefined;
  const missing = await runInContext('Bridge.saveWritingDoc({ relPath: "x" })', ctx);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /saveWritingDoc/);
});

test('save_document refuses an empty root and does not invent a path', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  let called = 0;
  ctx.Bridge.saveWritingDoc = async () => { called += 1; return { ok: true }; };
  const res = await tool(ctx, 'save_document', { title: 'TPMS 综述', kind: 'review', content: BODY });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'root_missing');
  assert.match(res.error, /尚未设置工作区根目录/);
  assert.match(res.error, /设置 → 数据与同步/);
  assert.match(res.error, /更改/);
  assert.match(res.error, /不会猜测盘符/);
  assert.match(res.error, /TPMS 换热器/);
  assert.match(res.error, /TPMS换热器/);
  assert.equal(called, 0);

  const main = readFileSync(new URL('./desktop/main.js', root), 'utf8');
  assert.match(main, /writingRootMissingError/);
  assert.match(main, /不会猜测盘符/);
  assert.equal(main.includes('suggestedRoot'), true);
  assert.match(main, /不借用 suggestedRoot/);
});

test('save_document reaches Bridge.saveWritingDoc once a root is set', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  runInContext(`DB.settings.rootDir = 'D:\\\\ResearchWorkspace'`, ctx);
  const res = await tool(ctx, 'save_document', { title: 'TPMS 综述', kind: 'review', content: BODY });
  assert.equal(res.ok, true);
  assert.equal(ctx.__saved.relPath, 'TPMS换热器/写作/TPMS 综述.md');
  assert.equal(ctx.__saved.projectFolder, 'TPMS换热器');
  assert.equal(ctx.__saved.projectName, 'TPMS 换热器');
});

test('search_knowledge mode=search skips ask and warns when unique docs are under 3', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  ctx.Bridge.ragAsk = async () => { ctx.__asks += 1; return { ok: true, answer: '不该走问答', citations: [] }; };
  ctx.Bridge.ragSearch = async () => {
    ctx.__searches += 1;
    return {
      ok: true,
      results: [
        { document_id: 'doc-a', source_relative_path: 'lit/a.pdf', text: '甲', block_ids: [1] },
        { document_id: 'doc-a', source_relative_path: 'lit/a.pdf', text: '甲-2', block_ids: [2] },
        { document_id: 'doc-a', source_relative_path: 'lit/a.pdf', text: '甲-3', block_ids: [3] },
        { document_id: '', source_relative_path: 'lit/a.pdf', text: '没有 id 的同路径', block_ids: [4] }
      ]
    };
  };
  const spec = runInContext(`AI_TOOLS.find(t => t.function && t.function.name === 'search_knowledge')`, ctx);
  assert.match(spec.function.description, /mode=search/);
  assert.match(spec.function.description, /document_id/);
  assert.equal(JSON.stringify(spec.function.parameters.properties.mode.enum), '["search","ask"]');

  const searched = await tool(ctx, 'search_knowledge', { query: 'TPMS heat exchanger', mode: 'search' });
  assert.equal(ctx.__asks, 0);
  assert.equal(ctx.__searches, 1);
  assert.equal(searched.mode, 'search');
  assert.equal(searched.count, 4);
  assert.equal(searched.unique_docs, 1);
  assert.equal(JSON.stringify(searched.document_ids), '["doc-a"]');
  assert.match(searched.warning, /少于 3/);
  assert.match(searched.warning, /英文术语/);

  ctx.__asks = 0;
  ctx.__searches = 0;
  ctx.Bridge.ragSearch = async () => ({
    ok: true,
    results: [
      { document_id: 'd1', source_relative_path: 'a.pdf', text: 'a' },
      { document_id: 'd2', source_relative_path: 'b.pdf', text: 'b' },
      { document_id: 'd3', source_relative_path: 'c.pdf', text: 'c' }
    ]
  });
  const wide = await tool(ctx, 'search_knowledge', { query: 'gyroid', mode: 'search' });
  assert.equal(wide.unique_docs, 3);
  assert.equal(wide.warning, undefined);
  assert.equal(ctx.__asks, 0);
});

test('omitted mode still asks, and the review agent prefers search', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  ctx.Bridge.ragAsk = async () => {
    ctx.__asks += 1;
    return {
      ok: true,
      answer: '见引用',
      citations: [{ document_id: 'only', source_relative_path: 'one.pdf', text: '句', block_ids: [1] }]
    };
  };
  ctx.Bridge.ragSearch = async () => { throw new Error('默认问答不应检索'); };
  const asked = await tool(ctx, 'search_knowledge', { query: '结论' });
  assert.equal(asked.mode, 'ask');
  assert.equal(asked.unique_docs, 1);
  assert.match(asked.warning, /少于 3/);

  ctx.Bridge.ragSearch = async () => {
    ctx.__searches += 1;
    return { ok: true, results: [{ document_id: 'd1', source_relative_path: 'a.pdf', text: 'a' }] };
  };
  runInContext(`state.aiAgent = '科研写作·综述'`, ctx);
  const reviewed = await tool(ctx, 'search_knowledge', { query: 'TPMS' });
  assert.equal(reviewed.mode, 'search');
  assert.equal(ctx.__searches, 1);

  const stillAsk = await tool(ctx, 'search_knowledge', { query: 'TPMS', mode: 'ask' });
  assert.equal(stillAsk.mode, 'ask');

  runInContext(`state.aiAgent = ''`, ctx);
  ctx.__asks = 0;
  ctx.__searches = 0;
  ctx.Bridge.ragAsk = async () => { throw new Error('列文献不应走问答'); };
  ctx.Bridge.ragSearch = async () => {
    ctx.__searches += 1;
    return { ok: true, results: [{ document_id: 'd9', source_relative_path: 'lit/z.pdf', text: 'z' }] };
  };
  const listed = await tool(ctx, 'search_knowledge', { query: 'TPMS 换热器文献清单' });
  assert.equal(listed.mode, 'search');
  assert.equal(ctx.__asks, 0);
  assert.equal(ctx.__searches, 1);

  ctx.Bridge.ragAsk = async () => {
    ctx.__asks += 1;
    return { ok: true, answer: '短问答', citations: [] };
  };
  ctx.Bridge.ragSearch = async () => { throw new Error('短问答不应检索'); };
  const qa = await tool(ctx, 'search_knowledge', { query: '什么是 TPMS' });
  assert.equal(qa.mode, 'ask');
  assert.equal(ctx.__asks, 1);

  runInContext(`state.aiAgent = '科研写作·论文'`, ctx);
  ctx.Bridge.ragSearch = async () => {
    ctx.__searches += 1;
    return { ok: true, results: [{ document_id: 'd2', source_relative_path: 'm.pdf', text: 'm' }] };
  };
  const paperish = await tool(ctx, 'search_knowledge', { query: '方法' });
  assert.equal(paperish.mode, 'search');
});

test('writing-review prompt requires multi-query search before a draft', () => {
  const ctx = loadTools();
  const review = ctx.freshData().agents.find(a => a.presetKey === 'writing-review');
  assert.match(review.prompt, /mode=search/);
  assert.match(review.prompt, /多个 document_id/);
  assert.match(review.prompt, /文献清单/);
  assert.match(review.prompt, /大纲/);
  assert.match(review.prompt, /请用户确认/);
  assert.match(review.prompt, /禁止只根据一篇综述二手扩写/);
  assert.equal(runInContext('AGENTS_PRESET_VERSION', ctx), 'writing-3@2026-10');

  const saved = ctx.freshData();
  const agent = saved.agents.find(a => a.presetKey === 'writing-review');
  agent.prompt = '用户改过的开头，保留。\n' + runInContext('WRITING_REVIEW_WORKFLOW_BEFORE', ctx);
  const edited = ctx.freshData();
  edited.agents.find(a => a.presetKey === 'writing-review').prompt = '【工作流】\n1. 我自己的综述流程，不要覆盖。';

  const upgraded = ctx.migrate(saved);
  const again = upgraded.agents.find(a => a.presetKey === 'writing-review');
  assert.match(again.prompt, /用户改过的开头，保留。/);
  assert.match(again.prompt, /mode=search/);
  assert.equal(again.prompt.includes('检索工作台已登记的文献与资料'), false);

  const kept = ctx.migrate(edited);
  assert.equal(
    kept.agents.find(a => a.presetKey === 'writing-review').prompt,
    '【工作流】\n1. 我自己的综述流程，不要覆盖。'
  );
  assert.equal(kept.agentsPresetVersion, 'writing-3@2026-10');
});

test('review wording and @agent switch the current identity', () => {
  const ctx = loadTools();
  runInContext('setDB(freshData())', ctx);
  const review = (text) => ctx.agentNamedInText(text);
  assert.equal(review('让综述 agent 写约 1000 字的 TPMS 换热器综述').presetKey, 'writing-review');
  assert.equal(review('用综述 agent 整理文献').presetKey, 'writing-review');
  assert.equal(review('让综述 agent 基于知识库写 TPMS 换热器综述，先给文献清单和分类框架，先不要成文').presetKey, 'writing-review');
  assert.equal(review('请用 writing-review 来写').name, '科研写作·综述');
  assert.equal(review('@科研写作·综述 开始').name, '科研写作·综述');
  assert.equal(review('科研写作·综述 先给提纲').presetKey, 'writing-review');
  assert.equal(review('写个综述，主题是 TPMS 换热器').presetKey, 'writing-review');
  assert.equal(review('写一篇 TPMS 换热器综述').presetKey, 'writing-review');
  assert.equal(review('@科研写作·论文 写方法，不要写成综述').presetKey, 'writing-paper');
  assert.equal(review('请用 writing-paper 写个综述').presetKey, 'writing-paper');
  assert.equal(review('今天把任务勾掉'), null);
  assert.equal(review('综述'), null);
  assert.equal(review('这篇综述的结论是什么'), null);
  assert.equal(review('不要写成综述'), null);
  assert.equal(review('今天综述课取消了'), null);
  assert.equal(review('帮我翻译这篇综述的摘要'), null);
  assert.equal(review('写得像综述'), null);
  assert.equal(review('我在读一篇综述'), null);
  assert.equal(review('科研写作课上提到了综述这两个字'), null);

  runInContext(`DB.agents.find(a => a.presetKey === 'writing-review').name = '我的综述助手'`, ctx);
  assert.equal(review('让综述 agent 写一下').name, '我的综述助手');
  assert.equal(review('请 我的综述助手 列文献').presetKey, 'writing-review');
  assert.equal(review('科研写作·综述'), null);

  const dom = createContext({
    console,
    document: { getElementById() { return null; }, body: { classList: { toggle() {} } }, querySelector() { return null; } },
    location: { search: '', hash: '' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  });
  dom.window = { workspace: null };
  for (const file of ['assets/js/icons.js', 'assets/js/data.js', 'assets/js/api.js', 'assets/js/ui.js']) {
    runInContext(readFileSync(new URL('./' + file, root), 'utf8'), dom, { filename: file });
  }
  runInContext('function projectView(){ return ""; }', dom);
  runInContext(readFileSync(new URL('./assets/js/agent-jobs.js', root), 'utf8'), dom, { filename: 'agent-jobs.js' });
  runInContext(readFileSync(new URL('./assets/js/app.js', root), 'utf8'), dom, { filename: 'app.js' });
  runInContext(`
    setDB(freshData());
    DB.projects = [{ id: 'pmvgt6e8u1h7', name: 'TPMS换热器', folder: 'TPMS换热器', displayName: 'TPMS 换热器' }];
    state.project = 'pmvgt6e8u1h7';
    state.aiAgent = '科研写作·综述';
    state.aiKey = { stored: false };
  `, dom);
  const html = dom.aiIdentityHTML();
  assert.match(html, /当前身份 · 科研写作·综述/);
  assert.match(html, /data-act="ai-pick-agent"/);
  assert.match(html, /科研写作·综述/);
  runInContext(`state.aiAgent = ''`, dom);
  const idle = dom.aiIdentityHTML();
  assert.match(idle, /综述 agent/);
  assert.match(idle, /写个综述/);
  assert.equal(idle.includes('说「综述」、writing-review'), false);
  runInContext(`state.aiAgent = '科研写作·综述'`, dom);
  const staff = dom.staffPanelHTML();
  assert.match(staff, /staff-row is-current/);
  assert.match(staff, /ai-id-tag">当前/);
});
