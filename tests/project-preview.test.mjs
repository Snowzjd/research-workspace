/**
 * 首页点开项目后，内容预览留在当前页，不跳到项目页。
 * 运行：node --test tests/project-preview.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);

function loadViews() {
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
    body: { appendChild() {}, classList: { toggle() {} } }
  };
  const ctx = createContext({
    console,
    document,
    location: { search: '', hash: '' },
    window: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams,
    setTimeout,
    clearTimeout
  });
  ctx.window = ctx;
  for (const file of [
    'assets/js/icons.js',
    'assets/js/data.js',
    'assets/js/api.js',
    'assets/js/ui.js',
    'assets/js/ai-tools.js',
    'assets/js/agent-jobs.js',
    'assets/js/project-view.js',
    'assets/js/app.js'
  ]) {
    runInContext(readFileSync(new URL(file, root), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}

function seed(ctx) {
  runInContext(`
    setDB(freshData());
    const a = makeProject({ name: 'alpha', displayName: '甲项目', goal: '看甲的内容' });
    const b = makeProject({ name: 'beta', displayName: '乙项目', goal: '看乙的内容' });
    DB.projects.push(a, b);
    DB.tasks.push({ id: 'tk-a', t: '甲的任务', p: a.id, st: 'doing', agent: 'Engineer', tool: 'Fluent', due: '今天', pri: 'high', dir: '' });
    state.route = 'project';
    state.project = a.id;
    state.projectTab = 'tasks';
  `, ctx);
}

test('home shows the selected project preview without leaving home', () => {
  const ctx = loadViews();
  seed(ctx);
  const picked = runInContext(`showProjectOnHome(DB.projects[1].id)`, ctx);
  assert.equal(picked, true);
  assert.equal(runInContext('state.route', ctx), 'home');
  assert.equal(runInContext('state.project === DB.projects[1].id', ctx), true);
  assert.equal(runInContext('state.projectTab', ctx), 'overview');
  assert.equal(runInContext('DB.workspace.project', ctx), '乙项目');

  const html = ctx.homeView();
  const preview = html.slice(html.indexOf('id="project-preview"'));
  assert.match(html, /id="project-preview"/);
  assert.match(preview, /id="preview-facts"/);
  assert.match(preview, /项目摘要/);
  assert.match(preview, /看乙的内容/);
  assert.match(preview, /本项目最近活动/);
  assert.match(preview, /id="preview-outputs"/);
  assert.match(preview, /已关联成果/);
  assert.match(preview, /阶段摘要/);
  assert.equal(preview.includes('看甲的内容'), false);
  assert.equal(preview.includes('本项目任务'), false);
  assert.equal(preview.includes('负责人 / Agent'), false);
  assert.equal(preview.includes('涉及软件'), false);
  assert.equal(preview.includes('关键节点状态'), false);
  assert.equal(html.includes('0 个未完成'), false);
  assert.match(html, /class="card proj-card selected"/);
  assert.match(html, /乙项目/);

  runInContext(`DB.projects[1].stage = '阶段标记XYZ'`, ctx);
  const facts = runInContext('previewFactsHTML(DB.projects[1])', ctx);
  assert.match(facts, /阶段标记XYZ/);
  assert.match(facts, /当前阶段/);
  assert.equal(facts.includes('当前：'), false);
});

test('home preview still renders a project that is missing optional fields', () => {
  const ctx = loadViews();
  runInContext(`
    setDB(freshData());
    DB.projects.push({ id: 'bare', name: '只有名字' });
    state.project = 'bare';
    state.route = 'home';
  `, ctx);
  const html = ctx.homeView();
  const preview = html.slice(html.indexOf('id="project-preview"'));
  assert.match(preview, /只有名字/);
  assert.match(preview, /还没填写项目目标/);
  assert.match(preview, /还没有这个项目的动态/);
  assert.match(preview, /尚未关联成果/);
  assert.equal(preview.includes('还没有论文、综述或专利'), false);
  assert.equal(preview.includes('本项目任务'), false);
  assert.equal(preview.includes('负责人 / Agent'), false);
  assert.equal(preview.includes('涉及软件'), false);
  assert.equal(preview.includes('关键节点状态'), false);
});

test('feed folds stuck work and finished agents; outputs open real files only', () => {
  const ctx = loadViews();
  seed(ctx);
  runInContext(`
    DB.projects[0].stage = '阶段标记XYZ';
    DB.tasks.push({ id: 'tk-rev', t: '甲待复核', p: DB.projects[0].id, st: 'review', agent: 'Verifier', due: '明天', pri: 'mid' });
    DB.agentJobs = [
      { id: 'j-run', agent: 'Engineer', task: '正在算工况', projectId: DB.projects[0].id, status: 'running', startedAt: 30 },
      { id: 'j-done', agent: 'Writer', task: '写完综述一节', projectId: DB.projects[0].id, status: 'done', finishedAt: 20 },
      { id: 'j-other', agent: 'Writer', task: '别的项目的稿', projectId: 'nope', status: 'done', finishedAt: 99 }
    ];
    DB.activities = [
      { t: '<b>你</b> 更新了甲项目的目标', time: '09:00', at: 10, kind: 'edit', c: '#333', i: 'pencil', projectId: DB.projects[0].id },
      { t: '<b>无关项目</b> 改了别的东西', time: '08:00', at: 5, kind: 'edit', c: '#333', i: 'pencil' }
    ];
    DB.kbDocs = [
      { n: '甲的综述', type: '写作·综述', ext: 'md', file: (DB.projects[0].folder || DB.projects[0].name) + '/写作/甲的综述.md', date: '2026-10-01' },
      { n: '没有路径的论文', type: '论文', ext: 'pdf', date: '2026-10-02' },
      { n: '乙的专利', type: '写作·专利', ext: 'md', file: 'beta/写作/乙的专利.md', date: '2026-10-03' }
    ];
    state.project = DB.projects[0].id;
  `, ctx);
  const preview = ctx.homeView().slice(ctx.homeView().indexOf('id="project-preview"'));
  const facts = runInContext('previewFactsHTML(DB.projects[0])', ctx);
  assert.match(facts, /阶段标记XYZ/);
  assert.match(preview, /执行中/);
  assert.match(preview, /正在算工况/);
  assert.match(preview, /待复核/);
  assert.match(preview, /甲待复核/);
  assert.match(preview, /Agent 完成/);
  assert.match(preview, /写完综述一节/);
  assert.match(preview, /更新了甲项目的目标/);
  assert.equal(preview.includes('别的项目的稿'), false);
  assert.equal(preview.includes('改了别的东西'), false);
  assert.match(preview, /data-act="proj-open-doc"/);
  assert.match(preview, /甲的综述/);
  assert.equal(preview.includes('没有路径的论文'), false);
  assert.equal(preview.includes('乙的专利'), false);
  assert.equal(preview.includes('本项目任务'), false);
});

test('cards drop the full stepper and the project page uses one vertical flow', () => {
  const ctx = loadViews();
  seed(ctx);
  runInContext(`
    const p = DB.projects[0];
    p.shortName = '甲短名';
    p.nodes = [
      { id: 'n1', l: '论文大修与证据复核需要完整读完不能挤成竖字', s: 'done', d: '2026-10-01', dateKind: 'done', criterion: '修回关闭' },
      { id: 'n2', l: '终稿与投稿材料验收', s: 'current', d: '', criterion: '投稿包齐' },
      { id: 'n3', l: '外部评审意见回收', s: 'todo', d: '' }
    ];
    p.stage = '终稿与投稿材料验收';
    DB.activities = [
      { t: '甲项目里的动态', kind: 'edit', projectId: p.id, c: '#333', i: 'pencil', time: '09:00', at: 2 },
      { t: '扩展通用原生CAD网格验证案例', kind: 'create', projectId: 'other', c: '#333', i: 'plus', time: '08:00', at: 1 }
    ];
    DB.todos = [{ t: '111', done: true, projectId: '', cat: 'other', pri: 'low', due: '' }];
    state.project = p.id;
    state.route = 'project';
    state.projectTab = 'overview';
  `, ctx);
  const card = runInContext('projectCard(DB.projects[0])', ctx);
  assert.match(card, /甲短名/);
  assert.equal(card.includes('论文大修与证据复核需要完整读完不能挤成竖字'), false);
  assert.equal(card.includes('class="stepper"'), false);
  assert.equal(card.includes('class="step '), false);
  assert.match(card, /里程碑/);
  assert.match(card, /aria-pressed="true"/);
  const page = ctx.projectView();
  assert.match(page, /class="flow-steps"/);
  assert.match(page, /论文大修与证据复核需要完整读完不能挤成竖字/);
  assert.equal(page.includes('class="node-track"'), false);
  assert.equal(page.includes('class="flow-track"'), false);
  assert.equal(page.includes('>项目页<'), false);
  assert.match(page, /甲项目里的动态/);
  assert.equal(page.includes('扩展通用原生CAD网格验证案例'), false);
  assert.equal(page.includes('>111<'), false);
  assert.match(page, /尚未关联成果|已关联目录，尚未建立材料索引|周期待确认/);
});

test('project card click stays on home and does not open the project route', () => {
  const actions = readFileSync(new URL('./assets/js/actions.js', root), 'utf8');
  const start = actions.indexOf('if (t.dataset.project && !t.dataset.act)');
  const end = actions.indexOf('/* 标签页 */', start);
  assert.ok(start > 0 && end > start);
  const branch = actions.slice(start, end);
  assert.match(branch, /showProjectOnHome\(t\.dataset\.project\)/);
  assert.match(branch, /go\('home'\)/);
  assert.equal(branch.includes("go('project')"), false);
  assert.match(branch, /project-preview/);
});
