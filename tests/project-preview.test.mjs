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
  assert.match(preview, /项目详情/);
  assert.match(preview, /看乙的内容/);
  assert.match(preview, /id="preview-feed"/);
  assert.match(preview, /最近动态/);
  assert.match(preview, /id="preview-outputs"/);
  assert.match(preview, /产出物快览/);
  assert.match(preview, /项目流程/);
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
  assert.equal(facts.includes('阶段标记XYZ'), false);
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
  assert.match(preview, /还没有论文、综述或专利/);
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
      { t: '<b>你</b> 更新了甲项目的目标', time: '09:00', at: 10, kind: 'edit', c: '#333', i: 'pencil' },
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
  assert.equal(facts.includes('阶段标记XYZ'), false);
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
