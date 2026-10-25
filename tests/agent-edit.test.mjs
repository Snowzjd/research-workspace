/**
 * Agent 编辑：预置补齐不能盖掉用户改过的文案，改名要带着任务 / 项目 / 派单记录走，
 * 新派单的系统提示读的是改完之后的 prompt。
 *
 * 运行：node --test tests/agent-edit.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);

function loadData() {
  const ctx = createContext({ console });
  runInContext(readFileSync(new URL('./assets/js/data.js', root), 'utf8'), ctx, { filename: 'data.js' });
  runInContext(readFileSync(new URL('./assets/js/agent-jobs.js', root), 'utf8'), ctx, { filename: 'agent-jobs.js' });
  return ctx;
}

/** 与 Bridge.load 一样：freshData 打底，已存档覆盖，再走 migrate。 */
function reload(ctx, saved) {
  const fresh = ctx.freshData();
  return ctx.migrate({
    ...fresh,
    ...JSON.parse(JSON.stringify(saved)),
    settings: { ...(fresh.settings || {}), ...((saved && saved.settings) || {}) }
  });
}

const PRESET_VERSION = 'writing-3@2026-10';

test('preset version string is unchanged', () => {
  const src = readFileSync(new URL('./assets/js/data.js', root), 'utf8');
  assert.match(src, /const AGENTS_PRESET_VERSION = 'writing-3@2026-10'/);
});

test('edited preset role, tags, and prompt survive reload', () => {
  const ctx = loadData();
  const saved = ctx.freshData();
  saved.agentsPresetVersion = PRESET_VERSION;
  const paper = saved.agents.find(a => a.presetKey === 'writing-paper');
  paper.role = '我改过的论文职责';
  paper.tags = ['自定义', '投稿'];
  paper.prompt = '请用口语写，不要套模板。';
  const loaded = reload(ctx, saved);
  const again = loaded.agents.find(a => a.presetKey === 'writing-paper');
  assert.equal(again.role, '我改过的论文职责');
  assert.equal(JSON.stringify(again.tags), JSON.stringify(['自定义', '投稿']));
  assert.equal(again.prompt, '请用口语写，不要套模板。');
  assert.equal(loaded.agents.filter(a => a.presetKey === 'writing-paper').length, 1);
});

test('clearing a preset prompt stays empty across reload', () => {
  const ctx = loadData();
  const saved = ctx.freshData();
  saved.agentsPresetVersion = PRESET_VERSION;
  const review = saved.agents.find(a => a.presetKey === 'writing-review');
  review.prompt = '';
  const loaded = reload(ctx, saved);
  assert.equal(loaded.agents.find(a => a.presetKey === 'writing-review').prompt, '');
});

test('old data without presetKey keeps the edited prompt and only gains the key', () => {
  const ctx = loadData();
  const saved = ctx.freshData();
  saved.agentsPresetVersion = PRESET_VERSION;
  saved.agents.forEach(a => { delete a.presetKey; });
  saved.agents.find(a => a.name === '科研写作·专利').prompt = '权利要求先写独立项。';
  const loaded = reload(ctx, saved);
  const patent = loaded.agents.find(a => a.name === '科研写作·专利');
  assert.equal(patent.presetKey, 'writing-patent');
  assert.equal(patent.prompt, '权利要求先写独立项。');
});

test('first upgrade injects a missing preset but does not overwrite one already edited', () => {
  const ctx = loadData();
  const saved = ctx.freshData();
  delete saved.agentsPresetVersion;
  saved.agents.find(a => a.name === '科研写作·论文').prompt = '已经改过';
  saved.agents = saved.agents.filter(a => a.name !== '科研写作·专利');
  const loaded = reload(ctx, saved);
  assert.equal(loaded.agentsPresetVersion, PRESET_VERSION);
  assert.equal(loaded.agents.find(a => a.presetKey === 'writing-paper').prompt, '已经改过');
  assert.equal(loaded.agents.filter(a => a.presetKey === 'writing-patent').length, 1);
});

test('deleted preset is not put back once the version mark is set', () => {
  const ctx = loadData();
  const saved = ctx.freshData();
  saved.agentsPresetVersion = PRESET_VERSION;
  saved.agents = saved.agents.filter(a => a.presetKey !== 'writing-review');
  const loaded = reload(ctx, saved);
  assert.equal(loaded.agents.some(a => a.presetKey === 'writing-review' || a.name === '科研写作·综述'), false);
});

test('renamed preset is not duplicated on reload', () => {
  const ctx = loadData();
  const saved = ctx.freshData();
  saved.agentsPresetVersion = PRESET_VERSION;
  const paper = saved.agents.find(a => a.presetKey === 'writing-paper');
  paper.name = '我的论文助手';
  paper.prompt = '改名后的提示词';
  const loaded = reload(ctx, saved);
  const hits = loaded.agents.filter(a => a.presetKey === 'writing-paper' || a.name === '科研写作·论文' || a.name === '我的论文助手');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, '我的论文助手');
  assert.equal(hits[0].prompt, '改名后的提示词');
});

test('rename cascades tasks, project links, jobs, templates, and chats', () => {
  const ctx = loadData();
  const data = ctx.freshData();
  data.tasks = [{ t: '写引言', agent: '科研写作·论文' }, { t: '别的', agent: '科研写作·综述' }];
  data.projects = [{
    name: '换热器',
    agents: ['科研写作·论文', '科研写作·综述'],
    owner: { n: '我', agent: '科研写作·论文' }
  }];
  data.agentJobs = [{ id: 'j1', agent: '科研写作·论文', task: '写摘要' }];
  data.templates = [{ name: '自定义', tasks: [['整理文献', '科研写作·论文'], { t: '补权利要求', agent: '科研写作·专利' }] }];
  data.chats = { p1: [{ role: 'user', agent: '科研写作·论文', content: 'hi' }] };
  const n = ctx.renameAgentRefs(data, '科研写作·论文', '论文甲');
  assert.ok(n >= 5);
  assert.equal(data.tasks[0].agent, '论文甲');
  assert.equal(data.tasks[1].agent, '科研写作·综述');
  assert.equal(JSON.stringify(data.projects[0].agents), JSON.stringify(['论文甲', '科研写作·综述']));
  assert.equal(data.projects[0].owner.agent, '论文甲');
  assert.equal(data.agentJobs[0].agent, '论文甲');
  assert.equal(JSON.stringify(data.templates[0].tasks[0]), JSON.stringify(['整理文献', '论文甲']));
  assert.equal(data.templates[0].tasks[1].agent, '科研写作·专利');
  assert.equal(data.chats.p1[0].agent, '论文甲');
  const builtin = runInContext('PROJECT_TEMPLATE.tasks[1][1]', ctx);
  assert.equal(builtin, '科研写作·综述');
});

test('renaming the review preset updates the builtin template in this session', () => {
  const ctx = loadData();
  ctx.renameAgentRefs(ctx.freshData(), '科研写作·综述', '综述甲');
  assert.equal(runInContext('PROJECT_TEMPLATE.tasks[1][1]', ctx), '综述甲');
});

test('new dispatch system prompt uses the updated role, tags, and prompt', () => {
  const ctx = loadData();
  const text = ctx.buildAgentSystemPrompt(
    { name: 'TPMS换热器', id: 'tpms' },
    { name: '科研写作·论文', role: '改过的职责', tags: ['口语', '投稿'], prompt: '先列三点再动笔。' }
  );
  assert.match(text, /改过的职责/);
  assert.match(text, /口语、投稿/);
  assert.match(text, /先列三点再动笔。/);
  assert.match(text, /【你的身份】科研写作·论文/);
});

test('detail footer says 派任务 and edit is wired from detail and staff cards', () => {
  const actions = readFileSync(new URL('./assets/js/actions.js', root), 'utf8');
  const jobs = readFileSync(new URL('./assets/js/agent-jobs.js', root), 'utf8');
  assert.equal(actions.includes('启动执行'), false);
  assert.equal(actions.includes('停止执行'), false);
  assert.match(actions, /data-act="agent-run"[^>]*>\$\{icon\('send'\)\}派任务/);
  assert.match(actions, /data-act="agent-edit"/);
  assert.match(actions, /case 'agent-save'/);
  assert.match(actions, /function saveAgentEdits/);
  assert.match(actions, /renameAgentRefs\(DB, oldName, newName\)/);
  assert.match(jobs, /data-act="agent-edit"/);
  const cardEdits = jobs.split('data-act="agent-edit"').length - 1;
  assert.equal(cardEdits, 2);
});
