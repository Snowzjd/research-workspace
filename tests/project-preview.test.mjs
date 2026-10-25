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
  assert.match(html, /id="project-preview"/);
  assert.match(html, /class="detail-hero"/);
  assert.match(html, /看乙的内容/);
  assert.match(html, /项目流程/);
  assert.equal(html.includes('看甲的内容'), false);
  assert.equal(html.includes('0 个未完成'), false);
  assert.match(html, /class="card proj-card selected"/);
  assert.match(html, /乙项目/);
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
  assert.match(html, /id="project-preview"/);
  assert.match(html, /只有名字/);
  assert.match(html, /还没有任务/);
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
