/**
 * 项目内容 API：按 ID 读写相对文件夹、流程节点、详细计划；部分更新；
 * 编辑窗无效进度不能落成 50%。
 *
 * 运行：node --test tests/project-api.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);

function loadData() {
  const ctx = createContext({ console });
  runInContext(readFileSync(new URL('./assets/js/data.js', root), 'utf8'), ctx, { filename: 'data.js' });
  return ctx;
}

function loadTools() {
  const ctx = loadData();
  ctx.state = { project: '' };
  ctx.__writes = 0;
  ctx.persist = () => { ctx.__writes += 1; };
  ctx.logActivity = () => {};
  ctx.esc = (s) => String(s == null ? '' : s);
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
    DB.settings.rootDir = 'D:\\\\ResearchWorkspace';
    const p = makeProject({ name: 'alpha', folder: 'alpha_dir', displayName: '甲项目', goal: '原来的目标', subtitle: '原来的简介' });
    p.intro = '原来的长简介';
    p.plan = ['原计划一', '原计划二'];
    p.nodes = [
      { l: '建模', s: 'done', d: '10.01' },
      { l: '仿真', s: 'current', d: '10.15' },
      { l: '写作', s: 'todo', d: '' }
    ];
    p.flow = ['建模', '仿真', '写作'];
    p.stage = '仿真';
    p.progress = 33;
    p.next = '整理数据';
    DB.projects.push(p);
    state.project = p.id;
  `, ctx);
}

test('invalid progress is not the range midpoint 50', () => {
  const ctx = loadData();
  assert.equal(ctx.parseProjectProgress('abc'), null);
  assert.equal(ctx.parseProjectProgress(''), null);
  assert.equal(ctx.parseProjectProgress('   '), null);
  assert.equal(ctx.parseProjectProgress('50%'), null);
  assert.equal(ctx.parseProjectProgress(NaN), null);
  assert.equal(ctx.parseProjectProgress(Infinity), null);
  assert.equal(ctx.parseProjectProgress(undefined), null);
  assert.equal(ctx.parseProjectProgress(null), null);
  assert.equal(ctx.parseProjectProgress(true), null);
  assert.equal(ctx.parseProjectProgress(80), 80);
  assert.equal(ctx.parseProjectProgress('80'), 80);
  assert.equal(ctx.parseProjectProgress(80.4), 80);
  assert.equal(ctx.parseProjectProgress(150), 100);
  assert.equal(ctx.parseProjectProgress(-4), 0);
  assert.equal(ctx.parseProjectProgress(0), 0);

  const bad = ctx.editorProgressControl(Number.NaN);
  assert.equal(bad.unset, true);
  assert.equal(bad.value, 0);
  assert.notEqual(bad.value, 50);
  assert.equal(ctx.editorProgressControl(undefined).unset, true);
  assert.equal(ctx.editorProgressControl('').unset, true);
  assert.equal(ctx.editorProgressControl(48).value, 48);
  assert.equal(ctx.editorProgressControl(48).unset, false);
  assert.equal(ctx.editorProgressControl(50).value, 50);

  const untouched = ctx.progressFromEditor(48, '50', false);
  assert.equal(untouched.progress, 48);
  assert.equal(untouched.changed, false);
  const untouchedBad = ctx.progressFromEditor(Number.NaN, '50', false);
  assert.equal(Number.isNaN(untouchedBad.progress), true);
  assert.notEqual(untouchedBad.progress, 50);
  const moved = ctx.progressFromEditor(48, '60', true);
  assert.equal(moved.progress, 60);
  assert.equal(moved.changed, true);
  const movedBad = ctx.progressFromEditor(33, 'nope', true);
  assert.equal(movedBad.rejected, true);
  assert.equal(movedBad.progress, 33);
});

test('edit dialog does not assign the range default on save', () => {
  const src = readFileSync(new URL('./assets/js/actions.js', root), 'utf8');
  assert.equal(src.includes('progress: +v.progress'), false);
  assert.match(src, /progressFromEditor\(/);
  assert.match(src, /data-progress-unset/);
  assert.match(src, /progressTouched/);
  assert.match(src, /editorProgressControl\(/);
});

test('agent can set folder, nodes, and plan by project id, then re-read the same record', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const id = runInContext('state.project', ctx);
  const saved = await tool(ctx, 'update_project', {
    project: id,
    id_only: true,
    folder: 'tpms_disk',
    goal: '把压降降下来',
    nodes: [
      { label: '建模', state: '已完成', date: '10.05' },
      { l: '仿真', s: 'current', d: '10.20' },
      { name: '写作', status: '待开始' }
    ],
    plan: ['补一组工况', '写方法章']
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.saved, true);
  assert.equal(saved.project_id, id);
  assert.equal(saved.record.folder, 'tpms_disk');
  assert.equal(saved.record.folder_kind, 'relative');
  assert.equal(saved.record.project_folder, 'D:\\ResearchWorkspace\\tpms_disk');
  assert.equal(saved.record.goal, '把压降降下来');
  assert.equal(saved.record.stage, '仿真');
  assert.equal(JSON.stringify(saved.record.plan), JSON.stringify(['补一组工况', '写方法章']));
  assert.equal(JSON.stringify(saved.record.nodes.map(n => n.l)), JSON.stringify(['建模', '仿真', '写作']));
  assert.equal(saved.record.nodes[0].s, 'done');
  assert.equal(saved.record.nodes[1].s, 'current');
  assert.equal(saved.record.progress, 33);

  const again = await tool(ctx, 'get_project_context', { project: id, id_only: true });
  assert.equal(again.ok, true);
  assert.equal(JSON.stringify(again.project), JSON.stringify(saved.record));
  assert.equal(again.project_folder, saved.record.project_folder);
});

test('partial update leaves folder, nodes, plan, goal, and progress unchanged', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const id = runInContext('state.project', ctx);
  await tool(ctx, 'update_project', {
    project: id,
    folder: 'tpms_disk',
    plan: ['补一组工况'],
    goal: '把压降降下来'
  });
  const before = await tool(ctx, 'get_project_context', { project: id, id_only: true });
  const patched = await tool(ctx, 'update_project', { project: id, subtitle: '新的一句话' });
  assert.equal(patched.ok, true);
  assert.equal(patched.record.subtitle, '新的一句话');
  assert.equal(patched.record.folder, before.project.folder);
  assert.equal(patched.record.goal, before.project.goal);
  assert.equal(patched.record.progress, before.project.progress);
  assert.equal(patched.record.stage, before.project.stage);
  assert.equal(patched.record.intro, '原来的长简介');
  assert.equal(JSON.stringify(patched.record.nodes), JSON.stringify(before.project.nodes));
  assert.equal(JSON.stringify(patched.record.plan), JSON.stringify(before.project.plan));
  assert.equal(patched.record.display_name, '甲项目');
});

test('invalid progress does not become 0 or 50, and a real progress still saves', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const before = runInContext('P(state.project).progress', ctx);
  for (const progress of ['abc', '', '50%', NaN, null]) {
    const bad = await tool(ctx, 'update_project', { progress });
    if (progress == null) {
      assert.equal(bad.ok, false);
    } else {
      assert.equal(bad.ok, false);
      assert.equal(bad.progress_unchanged, true);
    }
    assert.equal(runInContext('P(state.project).progress', ctx), before);
  }
  const ok = await tool(ctx, 'update_project', { progress: 80, project: 'alpha' });
  assert.equal(ok.ok, true);
  assert.equal(ok.saved, true);
  assert.equal(ok.record.progress, 80);
  assert.equal(ok.record.folder, 'alpha_dir');
  const zero = await tool(ctx, 'update_project', { progress: 0 });
  assert.equal(zero.record.progress, 0);
});

test('explicit progress wins over the node completion ratio', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const id = runInContext('state.project', ctx);
  const saved = await tool(ctx, 'update_project', {
    project: id,
    nodes: [
      { l: '甲', s: 'done' },
      { l: '乙', s: 'done' },
      { l: '丙', s: 'current' },
      { l: '丁', s: 'todo' }
    ],
    progress: 12
  });
  assert.equal(saved.record.progress, 12);
  assert.equal(saved.record.stage, '丙');
  const derived = await tool(ctx, 'update_project', {
    project: id,
    nodes: [
      { l: '甲', s: 'done' },
      { l: '乙', s: 'todo' },
      { l: '丙', s: 'todo' },
      { l: '丁', s: 'todo' }
    ]
  });
  assert.equal(derived.record.progress, 25);
  assert.equal(derived.record.nodes.find(n => n.s === 'current').l, '乙');
});

test('empty plan clears only the plan, and folder_name is the same relative field', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const id = runInContext('state.project', ctx);
  const cleared = await tool(ctx, 'update_project', { project: id, detailed_plan: [] });
  assert.equal(cleared.ok, true);
  assert.equal(JSON.stringify(cleared.record.plan), '[]');
  assert.equal(cleared.record.goal, '原来的目标');
  assert.equal(cleared.record.folder, 'alpha_dir');
  const renamed = await tool(ctx, 'update_project', { project: id, folder_name: 'alias_dir' });
  assert.equal(renamed.record.folder, 'alias_dir');
  assert.equal(JSON.stringify(renamed.record.plan), '[]');
});

test('absolute folder is rejected and does not copy or retarget the project', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const id = runInContext('state.project', ctx);
  const bad = await tool(ctx, 'update_project', { project: id, folder: 'D:\\outside\\proj' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /相对文件夹名|junction/);
  assert.equal(runInContext('P(state.project).folder', ctx), 'alpha_dir');
  assert.equal(JSON.stringify(runInContext('P(state.project).plan', ctx)), JSON.stringify(['原计划一', '原计划二']));
});

test('id_only does not update a different project by display name', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const id = runInContext('state.project', ctx);
  runInContext(`
    const other = makeProject({ name: 'beta', folder: 'beta_dir' });
    other.goal = '乙的目标';
    DB.projects.push(other);
  `, ctx);
  const miss = await tool(ctx, 'update_project', { project: '甲项目', id_only: true, goal: '不该写上' });
  assert.equal(miss.ok, false);
  assert.equal(runInContext('P(state.project).goal', ctx), '原来的目标');
  const hit = await tool(ctx, 'get_project_context', { project: id, id_only: 'true' });
  assert.equal(hit.project.id, id);
  const missing = await tool(ctx, 'get_project_context', { project: 'no-such-id', id_only: true });
  assert.equal(missing.ok, false);
});

test('save survives the same migrate path the app uses on startup', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const id = runInContext('state.project', ctx);
  await tool(ctx, 'update_project', {
    project: id,
    id_only: true,
    folder: 'linked_name',
    stage: '归档',
    plan: ['留下这一条'],
    progress: 41,
    display_name: '显示甲'
  });
  const raw = JSON.parse(JSON.stringify(runInContext('DB', ctx)));
  const loaded = ctx.migrate(raw);
  const p = loaded.projects.find(x => x.id === id);
  assert.equal(p.folder, 'linked_name');
  assert.equal(p.displayName, '显示甲');
  assert.equal(p.progress, 41);
  assert.equal(JSON.stringify(p.plan), JSON.stringify(['留下这一条']));
  assert.equal(p.stage, '归档');
  assert.equal(p.nodes.find(n => n.s === 'current').l, '归档');
  assert.equal(p.goal, '原来的目标');
  assert.equal(p.subtitle, '原来的简介');
});

test('flow settlement promotes one current and does not invent 50', () => {
  const ctx = loadData();
  const promoted = ctx.settleFlowNodes(
    [{ l: '旧', s: 'current', d: '' }],
    [{ l: '甲', s: 'done', d: '' }, { l: '乙', s: 'todo', d: '' }, { l: '丙', s: 'todo', d: '' }, { l: '丁', s: 'todo', d: '' }]
  );
  assert.equal(promoted.nodes.find(n => n.s === 'current').l, '乙');
  assert.equal(promoted.progress, 25);
  const many = ctx.settleFlowNodes([], [
    { l: '甲', s: 'current', d: '' },
    { l: '乙', s: 'current', d: '' }
  ]);
  assert.equal(many.nodes.filter(n => n.s === 'current').length, 1);
  assert.equal(many.nodes[0].s, 'current');
  assert.equal(many.nodes[1].s, 'todo');
  const done = ctx.settleFlowNodes([], [
    { l: '甲', s: 'done', d: '' },
    { l: '乙', s: 'done', d: '' }
  ]);
  assert.equal(done.progress, 100);
  assert.equal(done.nodes.some(n => n.s === 'current'), false);
  assert.equal(done.stage, '乙');
});

test('HTTP routes forward exact id reads and partial patches', () => {
  const src = readFileSync(new URL('./desktop/api-server.js', root), 'utf8');
  assert.match(src, /oneProject/);
  assert.match(src, /id_only: true/);
  assert.match(src, /method === 'PATCH'/);
  assert.match(src, /get_project_context/);
  assert.match(src, /update_project/);
});
