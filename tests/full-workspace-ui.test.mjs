import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import markdownModule from '../desktop/full-markdown.js';
import markdownContent from '../assets/js/markdown-content.js';
import MaterialSource from '../assets/js/material-source.js';

const renderer = readFileSync(new URL('../assets/js/full-workspace.js', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

function rendererContract(markdown, openOriginal, rpmOnboarding) {
  const listeners = {};
  const els = new Map();
  const view = { innerHTML: '', replaceChildren() { this.innerHTML = ''; } };
  const project = { id: 'synthetic-project', name: '合成光学项目', stage: '校准', rpmProjectId: 'fixture-rpm' };
  const task = { id: 'synthetic-task', p: project.id, t: '合成研究任务', pri: 'mid', st: 'review' };
  const DB = { projects: [project], tasks: [task], activities: [{ t: '创建合成任务', projectId: project.id }],
    settings: { materialHighlights: { 'fixture-rpm': [{ id: 'fixture-file', label: '实验记录' }] } } };
  const state = { route: 'graph', project: project.id };
  const sys = {
    workspace: {
      full: { enabled: true, markdown, openOriginal, rpmOnboarding },
      rpmProjectFiles: async () => ({ ok: true, files: [
        { file_id: 'fixture-file', name: '光学记录.md', relative_path: '光学记录.md', category: '记录', status: 'Final' }
      ] })
    },
    KnowledgeNetwork: { refresh: () => {} },
    ResearchMarkdown: markdownContent,
    addEventListener() {},
    confirm: () => true
  };
  const document = {
    body: { append(node) { els.set('#fw-dialog', node); } },
    querySelectorAll: () => [],
    addEventListener(type, fn) { listeners[type] = fn; },
    createElement(tag) {
      if (tag === 'dialog') {
        const attrs = new Map();
        const children = new Map();
        return {
          innerHTML: '', isConnected: true, setAttribute(key, value) { attrs.set(key, value); },
          getAttribute: key => attrs.get(key), removeAttribute: key => attrs.delete(key),
          querySelector(key) {
            if (!children.has(key)) children.set(key, { innerHTML: '', isConnected: true, replaceChildren() { this.innerHTML = ''; } });
            return children.get(key);
          },
          querySelectorAll: () => [], addEventListener() {}, showModal() {},
          close() { this.isConnected = false; els.delete('#fw-dialog'); }
        };
      }
      if (tag === 'div') {
        return { children: [], append(child) { this.children.push(child); },
          get innerHTML() { return this.children.map(child => child.innerHTML || child.textContent).join('\n'); } };
      }
      return { innerHTML: '', textContent: '' };
    }
  };
  vm.runInNewContext(renderer, {
    document, window: sys, DB, state, VIEWS: {}, MaterialSource, clearTimeout, setTimeout, setInterval: () => 0,
    $: query => els.get(query) || null,
    esc: escape, icon: name => '<svg aria-label="' + name + '"></svg>',
    stripTags: value => String(value || '').replace(/<[^>]*>/g, ''),
    P: id => DB.projects.find(p => p.id === id), projName: p => p?.name,
    parseTaskDate: () => ({ label: '未设置' }), stChip: value => value, priTag: value => value,
    milestoneStats: () => ({ label: '0 / 0' }), ownerView: () => ({ label: '未分配' }),
    scheduleView: () => ({ label: '未设置' }), flowStepsCard: () => '<div>阶段列表</div>',
    render: () => {}, go: route => { state.route = route; }, mutate: fn => fn(), flushSave: async () => ({ ok: true })
  });
  const controls = [...'list detail category'.split(' ').map(id => '#fw-material-' + id),
    '#fw-note-tree', '#fw-note-toolbar', '#fw-note-content', '#fw-note-properties', '#fw-note-status', '#fw-note-editor',
    '#fw-note-preview', '[data-full="save-note"]'];
  for (const selector of controls) els.set(selector, { innerHTML: '', querySelectorAll: () => [] });
  return { ...sys, DB, state, listeners, els, api: sys.FullWorkspace,
    display(route) { state.route = route; sys.FullWorkspace.renderView(view); return view.innerHTML; },
    click(action, value = '') {
      return listeners.click({ detail: 1, target: { closest: () => ({ value, dataset: { full: action }, closest: selector => els.get(selector) }) } });
    }
  };
}

test('metadata-only Markdown source offers the central Vault and material index', async () => {
  const ctx = rendererContract({
    list: async ({ projectId }) => projectId ? { ok: false, code: 'metadata_only' } :
      { ok: true, files: [{ path: 'index.md', name: 'index.md' }] }
  });
  await ctx.api.note('synthetic-project');
  await ctx.click('refresh-notes');
  const tree = ctx.els.get('#fw-note-tree');
  assert.match(tree.innerHTML, /data-full="project-materials"[^>]*value="synthetic-project"/);
  assert.match(tree.innerHTML, /data-full="central-notes"/);
  await ctx.click('central-notes');
  await ctx.click('refresh-notes');
  assert.match(tree.innerHTML, /index\.md/);
});

test('unconnected central Vault offers local connection settings', async () => {
  const ctx = rendererContract({ list: async () => ({ ok: false, code: 'unconnected' }) });
  await ctx.click('refresh-notes');
  assert.match(ctx.els.get('#fw-note-tree').innerHTML, /data-full="config".*连接 Vault/);
});

test('generated RPM notes show Markdown originals or an explicit missing-body message', async () => {
  const projectId = '11111111111111111111111111111111';
  const sourceId = '22222222222222222222222222222222';
  const projection = '---\nrpm_kind: knowledge\nrpm_id: ' + sourceId +
    '\nproject_ids:\n- ' + projectId + '\n---\n\n记录状态：历史资料\n来源与依据';
  let original = { ok: true, name: '正文.md', text: '# 这是正文' };
  const ctx = rendererContract({ read: async () => ({ ok: true, text: projection }) }, async payload => {
    assert.equal(payload.projectId, projectId);
    assert.equal(payload.id, sourceId);
    return original;
  });
  const content = ctx.els.get('#fw-note-content');
  await ctx.click('note', '综述.md');
  assert.match(content.innerHTML, /这是正文/);
  assert.doesNotMatch(content.innerHTML, /历史资料|来源与依据/);
  original = { ok: false, error: '此条目暂无可读取的 Markdown 正文' };
  await ctx.click('note', '仅有 Word.md');
  assert.match(content.innerHTML, /暂无可读取的 Markdown 正文/);
  assert.doesNotMatch(content.innerHTML, /历史资料|来源与依据/);
});

test('candidate shell and views render structured synthetic state with one class attribute', async () => {
  const ctx = rendererContract({ list: async () => ({ ok: true, files: [] }) });
  const candidates = ['dashboard', 'projects-center', 'graph', 'notes', 'materials', 'activity'];
  for (const route of candidates) assert.ok(ctx.api.sidebar().includes('data-route="' + route + '"'));
  assert.match(ctx.display('dashboard'), /合成研究任务/);
  assert.match(ctx.display('dashboard'), /创建合成任务/);
  assert.match(ctx.display('projects-center'), /class="fw-button fw-project-card"[^>]*data-full="project"[^>]*value="synthetic-project"/);
  assert.match(ctx.display('project'), /阶段列表/);
  assert.match(ctx.display('activity'), /合成研究任务/);
  assert.match(ctx.display('materials'), /id="fw-material-list"/);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(ctx.els.get('#fw-material-list').innerHTML, /光学记录\.md/);
  assert.match(ctx.els.get('#fw-material-list').innerHTML, /重点资料.*实验记录/);
  await ctx.click('material', 'synthetic-project:fixture-file');
  assert.match(ctx.els.get('#fw-material-list').innerHTML, /value="synthetic-project:fixture-file"[^>]*aria-pressed="true"/);
  const detail = ctx.els.get('#fw-material-detail').innerHTML;
  assert.match(detail, /打开文件.*在资源管理器中定位.*复制完整路径/);
  assert.match(detail, /<details[^>]*><summary>文件信息<\/summary>/);
});

test('candidate Markdown callbacks exercise safe service on disposable original file', async t => {
  const fixture = await mkdtemp(path.join(process.cwd(), 'rw-ui-contract-'));
  let onChange;
  const service = markdownModule.createMarkdownService({
    vaultRoot: fixture, backupDir: path.join(fixture, 'versions'), pollIntervalMs: 300,
    onChange: change => onChange?.(change)
  });
  t.after(async () => { service.close(); await rm(fixture, { recursive: true, force: true }); });
  const file = path.join(fixture, 'note.md');
  await writeFile(file, '\uFEFF\r\n# 合成笔记\r\n<script>ignored()</script>\r\n');
  const ctx = rendererContract({ ...service, onChange: callback => { onChange = callback; } });
  assert.match(ctx.display('notes'), /id="fw-note-tree"/);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.match(ctx.els.get('#fw-note-tree').innerHTML, /note\.md/);
  await ctx.click('note', 'note.md');
  assert.match(ctx.els.get('#fw-note-editor').value, /^\n# 合成笔记/);
  assert.match(ctx.els.get('#fw-note-content').innerHTML, /&lt;script&gt;/);
  ctx.listeners.input({ target: { id: 'fw-note-editor', value: '# 保存合成笔记\n' } });
  await ctx.click('save-note');
  assert.equal(await readFile(file, 'utf8'), '\uFEFF# 保存合成笔记\r\n');
  assert.match(ctx.els.get('#fw-note-status').innerHTML, /原件已保存/);
  await ctx.click('note-versions');
  assert.match(ctx.els.get('#fw-note-properties').innerHTML, /data-full="restore-note"/);
});

test('material browser loads category counts and only the requested page', async () => {
  const ctx = rendererContract({ list: async () => ({ ok: true, files: [] }) });
  const calls = [];
  ctx.workspace.rpmProjectFiles = async (id, opts) => {
    calls.push({ id, ...opts });
    return {
      ok: true, total: 70, categories: [{ id: '05_Data', count: 70 }],
      files: opts.category ? Array.from({ length: 30 }, (_, i) => ({
        file_id: 'file-' + (opts.offset + i), name: '样本-' + (opts.offset + i) + '.csv', category: '05_Data'
      })) : []
    };
  };
  assert.match(ctx.display('materials'), /分类浏览/);
  await ctx.click('material-browse');
  assert.match(ctx.display('materials'), /资料分类/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1).category, undefined);
  assert.equal(calls.at(-1).catalog, true);
  assert.match(ctx.els.get('#fw-material-category').innerHTML, /数据（70）/);
  await ctx.listeners.change({ target: { id: 'fw-material-category', value: '05_Data' } });
  assert.match(ctx.els.get('#fw-material-list').innerHTML, /第 1–30 条，共 70 条/);
  assert.doesNotMatch(ctx.els.get('#fw-material-list').innerHTML, /样本-30\.csv/);
  await ctx.click('material-page', '30');
  assert.equal(calls.at(-1).offset, 30);
  assert.equal(calls.at(-1).limit, 30);
  assert.match(ctx.els.get('#fw-material-list').innerHTML, /第 31–60 条，共 70 条/);
  assert.match(ctx.els.get('#fw-material-list').innerHTML, /样本-30\.csv/);
});


test('dashboard opens directly into the matching task filter and allows marking standalone todos complete', async () => {
  const ctx = rendererContract({ list: async () => ({ ok: true, files: [] }) });
  ctx.DB.todos = [{ t: '校核测试数据', done: false }];
  const dashboard = ctx.display('dashboard');
  assert.match(dashboard, /我的待办.*校核测试数据.*data-act="toggle-todo"/);
  assert.match(dashboard, /data-full="task-filter" value="review"/);
  assert.doesNotMatch(dashboard, /Codex 执行/);
  await ctx.click('task-filter', 'review');
  assert.equal(ctx.state.route, 'activity');
  assert.match(ctx.display('activity'), /<option value="review" selected>待复核/);
  await ctx.click('todo-status', '0');
  assert.equal(ctx.DB.todos[0].done, true);
  assert.match(ctx.els.get('#fw-dialog').innerHTML, /恢复待办/);
});

test('project retains task and material entry points and puts scoped activity and linked outcomes in task details', async () => {
  const ctx = rendererContract({ list: async () => ({ ok: true, files: [] }) });
  const [task] = ctx.DB.tasks;
  Object.assign(task, { description: '复核温度读数', acceptance: '覆盖独立采样', codexReferences: 'fixture-file', outcomeIds: ['final-figure'] });
  ctx.DB.activities.push({ t: '提交任务结果', projectId: task.p, objectId: task.id },
    { t: '无关任务活动', projectId: task.p, objectId: 'unrelated-task' });
  ctx.DB.outcomes = [{ id: 'final-figure', title: '验证曲线', file: 'fixture-plot.png', project_ids: [task.p] }];
  const project = ctx.display('project');
  assert.match(project, /研究目标/);
  assert.match(project, /下一步任务/);
  assert.match(project, /浏览项目材料/);
  assert.doesNotMatch(project, />项目 ID</);
  await ctx.click('task', task.id);
  const taskDialog = ctx.els.get('#fw-dialog');
  assert.match(taskDialog.innerHTML, /复核温度读数/);
  assert.match(taskDialog.innerHTML, /覆盖独立采样/);
  assert.match(taskDialog.innerHTML, /提交任务结果/);
  assert.doesNotMatch(taskDialog.innerHTML, /无关任务活动/);
  assert.match(taskDialog.innerHTML, /验证曲线/);
  assert.match(taskDialog.querySelector('[data-fw-task-materials]').innerHTML, /光学记录\.md/);
});

test('project takeover preview reports evidence and changes only after explicit confirmation', async () => {
  const ctx = rendererContract({ list: async () => ({ ok: true, files: [] }) });
  const calls = [];
  const fixture = {
    ok: true, token: 'fixture-intake', root: 'C:/test/history', offset: 0, limit: 30,
    categories: ['02_References'], summary: { total: 1, medium: 1, dependencyProtected: 1, duplicateGroups: 0 },
    files: [{ path: '综述.md', name: '综述.md', category: '02_References', confidence: 'medium', dependency: '工程原路径' }]
  };
  ctx.workspace.full.rpmOnboarding = {
    async preview(payload) { calls.push(['preview', payload]); return fixture; },
    async confirm(payload) { calls.push(['confirm', payload]); return { ok: true, binding: { rpmProjectId: 'fixture-rpm', rpmRoot: 'C:/test/history' } }; }
  };
  assert.match(ctx.display('projects-center'), /接管已有项目/);
  await ctx.click('takeover', 'synthetic-project');
  const dialog = ctx.els.get('#fw-dialog');
  ctx.els.set('#fw-takeover-name', { value: '验证项目' });
  ctx.els.set('#fw-takeover-direction', { value: '验证历史接管' });
  ctx.els.set('#fw-takeover-type', { value: 'Research' });
  await ctx.click('takeover-preview', 'synthetic-project');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].projectType, 'Research');
  const preview = dialog.querySelector('#fw-takeover-preview');
  assert.match(preview.innerHTML, /工程依赖 1/);
  assert.match(preview.innerHTML, /综述\.md/);
  assert.match(preview.innerHTML, /原位登记/);
  assert.equal(ctx.DB.settings.rpmBindings, undefined);
  await ctx.click('takeover-apply');
  assert.equal(calls[1][0], 'confirm');
  assert.equal(calls[1][1].acceptHigh, false);
  assert.equal(ctx.DB.settings.rpmBindings['synthetic-project'].rpmRoot, 'C:/test/history');
  assert.equal(ctx.state.route, 'project');
});

test('already registered previews can be attached without a registration write', async () => {
  const ctx = rendererContract({ list: async () => ({ ok: true, files: [] }) });
  let confirmationCalls = 0;
  ctx.workspace.full.rpmOnboarding = {
    preview: async () => ({ ok: true, existing: true, binding: { rpmProjectId: 'fixture-rpm', rpmRoot: 'C:/test/history' } }),
    confirm: async () => { confirmationCalls++; }
  };
  await ctx.click('takeover', 'synthetic-project');
  const dialog = ctx.els.get('#fw-dialog');
  ctx.els.set('#fw-takeover-name', { value: '验证项目' });
  ctx.els.set('#fw-takeover-direction', { value: '验证历史接管' });
  ctx.els.set('#fw-takeover-type', { value: 'Research' });
  await ctx.click('takeover-preview', 'synthetic-project');
  assert.match(dialog.querySelector('#fw-takeover-preview').innerHTML, /绑定已登记项目/);
  await ctx.click('takeover-apply');
  assert.equal(confirmationCalls, 0);
  assert.equal(ctx.DB.settings.rpmBindings['synthetic-project'].rpmRoot, 'C:/test/history');
});


test('the startup surfaces an interrupted intake and offers resume without losing decisions', async () => {
  const token = 'fixture-resume-token';
  const task = { token, projectId: 'new-workspace-project', name: '重启续办项目',
    phase: 'interrupted', checkpoint: 'indexed', total: 1, reviewed: 1 };
  const decisions = [{ path: '报告.md', action: 'change', category: '02_References', purpose: '人工原用途' }];
  const ctx = rendererContract({ list: async () => ({ ok: true, files: [] }) }, undefined, {
    list: async () => ({ ok: true, tasks: [task] }),
    page: async ({ token: supplied, projectId }) => {
      assert.equal(supplied, token);
      assert.equal(projectId, undefined);
      return { ...task, ok: true, root: 'C:/test/recovery', decisions, categories: ['02_References'],
        files: [{ path: '报告.md', name: '报告.md', category: '02_References', confidence: 'medium' }] };
    },
    rescan: async () => ({ ok: true }), abandon: async () => ({ ok: true })
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(ctx.display('dashboard'), /重启续办项目/);
  await ctx.click('takeover-resume', token);
  const body = ctx.els.get('#fw-dialog').querySelector('#fw-takeover-preview').innerHTML;
  assert.match(body, /文件索引已登记/);
  assert.match(body, /从检查点继续登记/);
  assert.match(body, /重新扫描并保留复核/);
  assert.match(body, /人工原用途/);
});
