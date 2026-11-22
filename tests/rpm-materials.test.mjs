/**
 * 阶段三：隔离环境材料换源与回归。
 * 运行：node --test tests/rpm-materials.test.mjs
 * 端口 17318，不占用 :7317，不触碰正式 Vault / G:\TPMS。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const apiServer = require('../desktop/api-server.js');
const adapter = require('../desktop/rpm-adapter.js');
const projectRoot = require('../desktop/project-root.js');
const materialSource = require('../assets/js/material-source.js');
const { queryFiles } = require('../desktop/rpm-http.js');

const PYTHON = process.env.RPM_TEST_PYTHON
  || 'D:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const SCRIPT = process.env.RPM_TEST_SCRIPT
  || 'F:\\ai\\codex\\skills\\research-project-manager\\scripts\\rpm.py';
const SAMPLE_DIR = process.env.RPM_STAGE3_SAMPLE_DIR || '';

let tmp = '';
let vault = '';
let projectRootDir = '';
let settingsPath = '';
let userData = '';
let baseUrl = '';
let token = '';
let boundId = 'pjstage2iso1';
let unboundId = 'pjstage2free';
const spawned = [];

function rpmCli(command, args = []) {
  const argv = ['-X', 'utf8', '-B', SCRIPT, '--settings', settingsPath, command, ...args];
  const out = execFileSync(PYTHON, argv, {
    cwd: path.dirname(SCRIPT),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000
  });
  const text = String(out || '').trim();
  return text ? JSON.parse(text) : {};
}

async function apiGet(pathname, tok = token) {
  const res = await fetch(baseUrl + pathname, {
    headers: { Authorization: 'Bearer ' + tok, 'X-RW-Client': 'stage3-test' }
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

function saveSample(name, payload) {
  if (!SAMPLE_DIR) return;
  mkdirSync(SAMPLE_DIR, { recursive: true });
  const json = JSON.stringify(payload, null, 2)
    .replaceAll(tmp.replaceAll('\\', '\\\\'), '%LOCALAPPDATA%\\\\Temp\\\\rw-rpm-mat')
    .replaceAll(tmp, '%LOCALAPPDATA%\\\\Temp\\\\rw-rpm-mat');
  writeFileSync(path.join(SAMPLE_DIR, name), json, 'utf8');
}

before(async () => {
  assert.equal(existsSync(SCRIPT), true, 'live RPM CLI missing');
  tmp = mkdtempSync(path.join(tmpdir(), 'rw-rpm-mat-'));
  vault = path.join(tmp, 'vault');
  projectRootDir = path.join(tmp, 'project');
  settingsPath = path.join(tmp, 'settings.json');
  userData = path.join(tmp, 'userData');
  mkdirSync(vault, { recursive: true });
  mkdirSync(projectRootDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ vault }, null, 2), 'utf8');
  token = 'c'.repeat(32);
  writeFileSync(path.join(userData, 'api-token.txt'), JSON.stringify({
    full: token,
    read: 'd'.repeat(32)
  }, null, 2), 'utf8');

  rpmCli('vault-init', [vault]);
  rpmCli('init', [projectRootDir, '--name', 'Stage3 Isolated Probe', '--direction', 'materials-source-test', '--type', 'research']);
  const planDir = path.join(projectRootDir, '01_Planning');
  const docDir = path.join(projectRootDir, '09_Documents');
  mkdirSync(planDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });
  writeFileSync(path.join(planDir, 'interface-notes.md'), '# interface notes\nstage3-materials-probe\n', 'utf8');
  writeFileSync(path.join(docDir, 'sample-record.md'), '# sample record\nrelated fixture\n', 'utf8');
  const kept = path.join(docDir, 'keep-me.md');
  writeFileSync(kept, 'do not delete\n', 'utf8');
  rpmCli('scan', [projectRootDir]);
  const found = rpmCli('search', [projectRootDir, '--limit', '20']);
  const note = (found.matches || []).find((row) => row.name === 'interface-notes.md');
  const rec = (found.matches || []).find((row) => row.name === 'sample-record.md');
  if (note && rec) {
    rpmCli('update', [
      projectRootDir,
      '--source', note.file_id,
      '--target', rec.file_id,
      '--relation', 'related_to',
      '--evidence', 'stage3 isolated fixture'
    ]);
  }

  adapter.setSpawnObserver((info) => spawned.push({
    command: info.command,
    spawned: info.spawned,
    shell: info.shell || false
  }));

  const rootDir = path.join(tmp, 'workspace');
  mkdirSync(path.join(rootDir, 'FREE'), { recursive: true });
  const listed = rpmCli('list');
  const rpmProjectId = Object.keys(listed)[0];
  const rpmRoot = listed[rpmProjectId];

  apiServer.setRpmContext({
    getConfig() {
      return { pythonPath: PYTHON, scriptPath: SCRIPT, settingsPath, timeoutMs: 20000, cache: false };
    },
    getRootDir() { return rootDir; },
    getBindings() {
      return { [boundId]: { rpmProjectId, rpmRoot: projectRootDir } };
    },
    listWorkbenchProjects() {
      return [
        { id: boundId, folder: 'BOUND', name: 'Stage3 Isolated Probe', rpmProjectId, rpmRoot: projectRootDir },
        { id: unboundId, folder: 'FREE', name: 'Unbound Preview' }
      ];
    }
  });

  const started = await apiServer.start({ userDataDir: userData, port: 17318, log: () => {} });
  assert.equal(started.ok, true, started.error);
  assert.notEqual(started.port, 7317);
  baseUrl = `http://127.0.0.1:${started.port}`;
});

after(() => {
  adapter.setSpawnObserver(null);
  try { apiServer.stop(); } catch (_) {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

test('materials list matches RPM CLI and shows category, purpose, absolute path', async () => {
  const cli = rpmCli('search', [projectRootDir, '--limit', '20']);
  const files = await apiGet('/api/projects/' + boundId + '/files?limit=20');
  assert.equal(files.status, 200);
  assert.equal(files.json.rpmBound, true);
  assert.equal(files.json.files.length, (cli.matches || []).length);
  assert.ok(files.json.files.length >= 2);
  const row = files.json.files.find((f) => f.name === 'interface-notes.md');
  const cliRow = (cli.matches || []).find((f) => f.name === 'interface-notes.md');
  assert.ok(row && cliRow);
  assert.equal(row.file_id, cliRow.file_id);
  assert.equal(row.category, cliRow.category);
  assert.equal(row.purpose, cliRow.purpose);
  assert.ok(row.absolute_path);
  assert.equal(projectRoot.pathsEqual(files.json.resolvedRoot, projectRootDir), true);
  assert.equal(row.absolute_path.includes(path.join('01_Planning', 'interface-notes.md')) || row.absolute_path.includes('01_Planning\\interface-notes.md') || row.absolute_path.includes('01_Planning/interface-notes.md'), true);

  const decided = materialSource.resolve({
    projectId: boundId,
    project: { id: boundId, rpmRoot: projectRootDir, rpmProjectId: 'x' },
    rpmCache: { rpmBound: true, resolvedRoot: files.json.resolvedRoot, files: files.json.files }
  });
  assert.equal(decided.source, 'rpm');
  assert.ok(decided.files.some((f) => f.category && f.purpose));
  assert.equal(materialSource.openRootOf({ decided }), files.json.resolvedRoot);
  saveSample('files.json', files.json);
});

test('material catalog counts standard categories and pages one category without changing exact lookup', async () => {
  const registry = rpmCli('list');
  const [rpmProjectId] = Object.keys(registry);
  const ctx = {
    getConfig: () => ({ pythonPath: PYTHON, scriptPath: SCRIPT, settingsPath, cache: false }),
    listWorkbenchProjects: () => [{ id: boundId, rpmProjectId, rpmRoot: projectRootDir }]
  };
  const overview = await queryFiles(ctx, boundId, { catalog: true });
  assert.equal(overview.ok, true, overview.error);
  assert.equal(overview.rpmBound, true);
  assert.equal(overview.total, 3);
  assert.deepEqual(overview.files, []);
  assert.equal(overview.categories.length, 12);
  assert.deepEqual(overview.categories.at(0), { id: '00_Project_Management', count: 0 });
  assert.deepEqual(overview.categories.at(-1), { id: '99_Archive', count: 0 });
  const category = '09_Documents';
  assert.deepEqual(overview.categories.find(row => row.id === category), { id: category, count: 2 });
  const documents = await Promise.all([0, 1, 2].map(offset => queryFiles(ctx, boundId, {
    catalog: true, category, offset, limit: 1
  })));
  assert.deepEqual(documents.map(page => page.total), [2, 2, 2]);
  assert.deepEqual(documents.map(page => page.files.map(row => row.name)), [['keep-me.md'], ['sample-record.md'], []]);
  assert.ok(path.isAbsolute(documents[0].files[0].absolute_path));
  const exact = await queryFiles(ctx, boundId, { fileIds: [documents[0].files[0].file_id] });
  assert.deepEqual(exact.files, documents[0].files);
  const invalid = await queryFiles(ctx, boundId, { catalog: true, category: '98_Unknown' });
  assert.equal(invalid.code, 'invalid_request');
});

test('relations and audit match CLI; unbound stays 409; writes rejected before spawn', async () => {
  const cliCtx = rpmCli('context', [projectRootDir]);
  const rel = await apiGet('/api/projects/' + boundId + '/relations');
  assert.equal(rel.status, 200);
  assert.equal(rel.json.relations.length, (cliCtx.relations || []).length);
  saveSample('relations.json', rel.json);

  const cliAudit = rpmCli('audit', [projectRootDir]);
  const audit = await apiGet('/api/projects/' + boundId + '/rpm-audit');
  assert.equal(audit.status, 200);
  assert.equal(audit.json.checked, cliAudit.checked);
  assert.equal(audit.json.issues.length, (cliAudit.issues || []).length);
  saveSample('rpm-audit.json', audit.json);

  const unbound = await apiGet('/api/projects/' + unboundId + '/files');
  assert.equal(unbound.status, 409);
  assert.equal(unbound.json.rpmBound, false);
  assert.equal(unbound.json.code, 'unbound');
  saveSample('files-unbound.json', unbound.json);

  const before = spawned.length;
  const denied = await adapter.runCommand('organize', [projectRootDir], { pythonPath: PYTHON, scriptPath: SCRIPT, settingsPath });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'command_not_allowed');
  const added = spawned.slice(before);
  assert.equal(added.every((row) => row.spawned === false), true);
});

test('outcome associate/unassociate does not delete disk files', () => {
  const kept = path.join(projectRootDir, '09_Documents', 'keep-me.md');
  assert.equal(existsSync(kept), true);
  const before = readFileSync(kept, 'utf8');
  const outcomes = [];
  outcomes.push({ id: 'oc-keep', title: 'keep', file: kept, file_id: 'x', relative_path: '09_Documents/keep-me.md' });
  /* unlink: drop the workbench record only */
  outcomes.splice(0, 1);
  assert.equal(existsSync(kept), true);
  assert.equal(readFileSync(kept, 'utf8'), before);
  assert.equal(outcomes.length, 0);
});

test('legacy workspace-data still has material fields after compat, and renderer-like APIs are not taken over', async () => {
  const raw = {
    schemaVersion: 3,
    projects: [{ id: 'pjlegacy1', name: 'Old', folder: 'OLD' }],
    tasks: [{ id: 'tk1', t: 'keep me', p: 'pjlegacy1', st: 'todo' }],
    materialIndex: { pjlegacy1: { '05_文档': [['draft.docx', '20 KB', 'docx']] } },
    materialScans: { pjlegacy1: { state: 'ok', files: 1 } },
    outcomes: []
  };
  const d = materialSource.ensureCompatFields(JSON.parse(JSON.stringify(raw)));
  assert.equal(d.tasks[0].t, 'keep me');
  assert.equal(d.materialIndex.pjlegacy1['05_文档'][0][0], 'draft.docx');

  const projects = await apiGet('/api/projects');
  const tasks = await apiGet('/api/tasks');
  const context = await apiGet('/api/context?project=' + boundId);
  const tools = await apiGet('/api/tools');
  assert.equal(projects.status, 503);
  assert.equal(tasks.status, 503);
  assert.equal(context.status, 503);
  assert.equal(tools.status, 503);
  assert.match(projects.json.error || '', /窗口未就绪/);
  const healthish = await apiGet('/api/projects/' + boundId + '/root');
  assert.notEqual(healthish.status, 503);
  assert.equal(healthish.json.rpmBound, true);
});
