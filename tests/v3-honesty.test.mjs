/**
 * v3.0 诚实性：dry_run 不落库、任务 id 稳定、显示名与文件夹分离、
 * 内置知识库不假装有向量索引、只读令牌不能写。
 *
 * 运行：node --test tests/v3-honesty.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const root = new URL('..', import.meta.url);
const require = createRequire(import.meta.url);

function loadTools() {
  const ctx = createContext({ console });
  runInContext(readFileSync(new URL('./assets/js/data.js', root), 'utf8'), ctx, { filename: 'data.js' });
  ctx.state = { project: '' };
  ctx.__writes = 0;
  ctx.persist = () => { ctx.__writes += 1; };
  ctx.logActivity = () => {};
  ctx.esc = (s) => String(s == null ? '' : s);
  ctx.Bridge = {
    saveWritingDoc: async ({ relPath, content }) => {
      ctx.__saved = { relPath, content };
      return { ok: true, relPath, absPath: 'C:/ws/' + relPath };
    },
    launchApp: async () => ({ ok: true, pid: 1 }),
    openFolder: async () => ({ ok: true }),
    ragSearch: async () => ({ ok: false, error: 'down' })
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
    const p = makeProject({ name: 'alpha', folder: 'alpha_dir', displayName: '甲项目' });
    DB.projects.push(p);
    state.project = p.id;
    MATERIALS[p.id] = { '01_资料': [] };
    DB.kbDocs = [{ id: 'kb1', n: '换热器综述', type: 'pdf', size: '1', date: '2026-01-01', score: 0 }];
    DB.settings.kbEngine = 'builtin';
    DB.settings.ragEnabled = false;
    DB.apps = [{ n: 'Fluent', kind: 'exe', path: 'C:/fluent.exe', args: [], run: null, bound: p.id }];
  `, ctx);
}

test('package version is 3.0.0 and compact is the default', () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', root), 'utf8'));
  assert.equal(pkg.version, '3.0.0');
  const ctx = loadTools();
  assert.equal(runInContext('SETTINGS_DEFAULT.compact', ctx), true);
  assert.equal(ctx.freshData().settings.compact, true);
  assert.equal(ctx.freshData().schemaVersion, 3);
  const html = readFileSync(new URL('./index.html', root), 'utf8');
  assert.match(html, /<body class="compact">/);
});

test('migrate promotes compact once and splits legacy app binding from run', () => {
  const ctx = loadTools();
  const d = ctx.freshData();
  d.schemaVersion = 2;
  d.settings.compact = false;
  d.projects = [{ id: 'tpms', name: 'TPMS', folder: 'TPMS' }];
  d.apps = [{ n: 'Fluent', kind: 'exe', path: '', args: [], run: 'tpms' }];
  const out = ctx.migrate(d);
  assert.equal(out.schemaVersion, 3);
  assert.equal(out.settings.compact, true);
  assert.equal(out.apps[0].bound, 'tpms');
  assert.equal(out.apps[0].run, null);
  out.settings.compact = false;
  const again = ctx.migrate(out);
  assert.equal(again.settings.compact, false);
  assert.equal(again.schemaVersion, 3);
});

test('display name, folder, and project name stay independent', () => {
  const ctx = loadTools();
  const p = ctx.makeProject({ name: 'alpha', folder: 'disk_folder', displayName: '显示名' });
  assert.equal(p.name, 'alpha');
  assert.equal(p.folder, 'disk_folder');
  assert.equal(p.displayName, '显示名');
  assert.equal(ctx.projName(p), '显示名');
  assert.equal(ctx.projName({ name: 'only' }), 'only');
  assert.equal(ctx.incompleteLabel(0), '');
  assert.equal(ctx.incompleteLabel(2), '2 个未完成');
});

test('dry_run on write tools does not mutate, including the string "true"', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const beforeTasks = runInContext('DB.tasks.length', ctx);
  const beforeProgress = runInContext('P(state.project).progress', ctx);
  const beforeWrites = ctx.__writes;
  for (const dry_run of [true, 'true', 1, '1']) {
    const created = await tool(ctx, 'create_task', { title: '不应落库', dry_run });
    assert.equal(created.ok, true);
    assert.equal(created.dryRun, true);
    assert.equal(created.tool, 'create_task');
    const updated = await tool(ctx, 'update_project', { progress: 80, dry_run });
    assert.equal(updated.dryRun, true);
  }
  assert.equal(runInContext('DB.tasks.length', ctx), beforeTasks);
  assert.equal(runInContext('P(state.project).progress', ctx), beforeProgress);
  assert.equal(ctx.__writes, beforeWrites);
  const listed = await tool(ctx, 'list_tasks', { dry_run: true });
  assert.equal(listed.dryRun, undefined);
  assert.equal(listed.ok, true);
});

test('create_task returns a stable task_id that list and context echo', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const created = await tool(ctx, 'create_task', { title: '测任务', project: 'alpha' });
  assert.equal(created.ok, true);
  assert.match(created.task_id, /^tk/);
  assert.equal(created.id, created.task_id);
  const listed = await tool(ctx, 'list_tasks', { project: '甲项目' });
  assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].task_id, created.task_id);
  assert.equal(listed.tasks[0].id, created.task_id);
  const ctxRes = await tool(ctx, 'get_project_context', {});
  assert.equal(ctxRes.project.display_name, '甲项目');
  assert.equal(ctxRes.project.folder, 'alpha_dir');
  assert.equal(ctxRes.tasks[0].task_id, created.task_id);
  const stored = runInContext('DB.tasks[0].id', ctx);
  assert.equal(stored, created.task_id);
});

test('update_project display_name does not rename the folder', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const res = await tool(ctx, 'update_project', { display_name: '乙项目', project: 'alpha' });
  assert.equal(res.ok, true);
  assert.equal(runInContext('P(state.project).displayName', ctx), '乙项目');
  assert.equal(runInContext('P(state.project).name', ctx), 'alpha');
  assert.equal(runInContext('P(state.project).folder', ctx), 'alpha_dir');
});

test('save_document writes under the folder name, not the display name', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const res = await tool(ctx, 'save_document', {
    title: '草稿标题',
    kind: 'paper',
    content: '这是一段超过二十个字的正文，用来确认保存路径走文件夹名。'
  });
  assert.equal(res.ok, true);
  assert.match(ctx.__saved.relPath, /^alpha_dir\/写作\/草稿标题\.md$/);
});

test('builtin knowledge search reports indexed 0', async () => {
  const ctx = loadTools();
  seedProject(ctx);
  const res = await tool(ctx, 'search_knowledge', { query: '换热器' });
  assert.equal(res.ok, true);
  assert.equal(res.engine, 'builtin');
  assert.equal(res.indexed, 0);
  assert.equal(res.count, 1);
  assert.match(res.warning, /没有向量索引/);
});

test('create_project starter tasks get ids and dry_run does not insert a project', async () => {
  const ctx = loadTools();
  runInContext('setDB(freshData())', ctx);
  const preview = await tool(ctx, 'create_project', { name: '预览项目', dry_run: 'true' });
  assert.equal(preview.dryRun, true);
  assert.equal(runInContext('DB.projects.length', ctx), 0);
  const created = await tool(ctx, 'create_project', { name: '新项目', folder: 'new_dir', starter_tasks: true });
  assert.equal(created.ok, true);
  assert.equal(created.folder, 'new_dir');
  assert.notEqual(created.project_folder, 'new_dir');
  const ids = runInContext('DB.tasks.filter(t => t.p === state.project).map(t => t.id)', ctx);
  assert.ok(ids.length > 0);
  assert.ok(ids.every(id => typeof id === 'string' && id.startsWith('tk')));
});

test('read token cannot call write tools, including switch_project', () => {
  const { readAllowed } = require('../desktop/api-server.js');
  assert.equal(readAllowed('list_tasks'), true);
  assert.equal(readAllowed('search_knowledge'), true);
  assert.equal(readAllowed('get_project_context'), true);
  assert.equal(readAllowed('create_task'), false);
  assert.equal(readAllowed('update_project'), false);
  assert.equal(readAllowed('switch_project'), false);
  assert.equal(readAllowed('launch_software'), false);
  const src = readFileSync(new URL('./desktop/api-server.js', root), 'utf8');
  assert.match(src, /'\/api\/tasks'/);
  assert.match(src, /version: '3\.0\.0'/);
});

test('sidebar end-state and empty-state template are in the UI sources', () => {
  const app = readFileSync(new URL('./assets/js/app.js', root), 'utf8');
  const actions = readFileSync(new URL('./assets/js/actions.js', root), 'utf8');
  const css = readFileSync(new URL('./assets/css/styles.css', root), 'utf8');
  assert.match(app, /const NAV = \[\s*\['home', 'grid', '首页'\]/);
  assert.equal(app.includes("['timeline'"), false);
  assert.equal(app.includes("['automation'"), false);
  assert.match(app, /function emptyState/);
  assert.match(app, /function aiModeSeg/);
  assert.match(app, /\['chat', '聊天'\], \['assign', '派任务'\], \['browser', '浏览'\]/);
  assert.match(actions, /timeline: 'home', automation: 'home'/);
  assert.match(actions, /isDryRun\(rawArgs\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.nav-item[\s\S]{0,120}height: 38px/);
});
