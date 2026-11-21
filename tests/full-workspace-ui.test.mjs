import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import markdownModule from '../desktop/full-markdown.js';
import MaterialSource from '../assets/js/material-source.js';

const renderer = readFileSync(new URL('../assets/js/full-workspace.js', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

function rendererContract(markdown) {
  const listeners = {};
  const els = new Map();
  const view = { innerHTML: '', replaceChildren() { this.innerHTML = ''; } };
  const project = { id: 'synthetic-project', name: '合成光学项目', stage: '校准' };
  const task = { id: 'synthetic-task', p: project.id, t: '合成研究任务', pri: 'mid', st: 'review' };
  const DB = { projects: [project], tasks: [task], activities: [{ t: '创建合成任务', projectId: project.id }], settings: {} };
  const state = { route: 'graph', project: project.id };
  const sys = {
    workspace: {
      full: { enabled: true, markdown },
      rpmProjectFiles: async () => ({ ok: true, files: [
        { file_id: 'fixture-file', name: '光学记录.md', relative_path: '光学记录.md', category: '记录', status: 'Final' }
      ] })
    },
    KnowledgeNetwork: { refresh: () => {} },
    addEventListener() {},
    confirm: () => true
  };
  const document = {
    addEventListener(type, fn) { listeners[type] = fn; },
    createElement(tag) {
      if (tag === 'div') {
        return { children: [], append(child) { this.children.push(child); },
          get innerHTML() { return this.children.map(child => child.innerHTML || child.textContent).join('\n'); } };
      }
      return { innerHTML: '', textContent: '' };
    }
  };
  vm.runInNewContext(renderer, {
    document, window: sys, DB, state, VIEWS: {}, MaterialSource,
    $: query => els.get(query) || null,
    esc: escape, icon: name => '<svg aria-label="' + name + '"></svg>',
    stripTags: value => String(value || '').replace(/<[^>]*>/g, ''),
    P: id => DB.projects.find(p => p.id === id), projName: p => p?.name,
    parseTaskDate: () => ({ label: '未设置' }), stChip: value => value,
    milestoneStats: () => ({ label: '0 / 0' }), ownerView: () => ({ label: '未分配' }),
    scheduleView: () => ({ label: '未设置' }), flowStepsCard: () => '<div>阶段列表</div>',
    render: () => {}, go: route => { state.route = route; }
  });
  const controls = [...'list detail category'.split(' ').map(id => '#fw-material-' + id),
    '#fw-note-tree', '#fw-note-toolbar', '#fw-note-content', '#fw-note-properties', '#fw-note-status', '#fw-note-editor',
    '#fw-note-preview', '[data-full="save-note"]'];
  for (const selector of controls) els.set(selector, { innerHTML: '', querySelectorAll: () => [] });
  return { ...sys, DB, state, listeners, els, api: sys.FullWorkspace,
    display(route) { state.route = route; sys.FullWorkspace.renderView(view); return view.innerHTML; },
    click(action, value = '') {
      return listeners.click({ detail: 1, target: { closest: () => ({ value, dataset: { full: action } }) } });
    }
  };
}

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
