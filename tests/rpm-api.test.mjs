/**
 * 阶段二只读 API：在隔离 Vault / settings / 临时项目上调用真实 RPM CLI。
 * 运行：node --test tests/rpm-api.test.mjs
 * 不触碰正式 Vault、不绑定真实课题、不改运行中的 :7317。
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

const PYTHON = process.env.RPM_TEST_PYTHON
  || 'D:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const SCRIPT = process.env.RPM_TEST_SCRIPT
  || 'F:\\ai\\codex\\skills\\research-project-manager\\scripts\\rpm.py';
const SAMPLE_DIR = process.env.RPM_STAGE2_SAMPLE_DIR || '';

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
    headers: { Authorization: 'Bearer ' + tok, 'X-RW-Client': 'stage2-test' }
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

function saveSample(name, payload) {
  if (!SAMPLE_DIR) return;
  mkdirSync(SAMPLE_DIR, { recursive: true });
  writeFileSync(path.join(SAMPLE_DIR, name), JSON.stringify(payload, null, 2), 'utf8');
}

before(async () => {
  assert.equal(existsSync(SCRIPT), true, 'live RPM CLI missing');
  tmp = mkdtempSync(path.join(tmpdir(), 'rw-rpm-api-'));
  vault = path.join(tmp, 'vault');
  projectRootDir = path.join(tmp, 'project');
  settingsPath = path.join(tmp, 'settings.json');
  userData = path.join(tmp, 'userData');
  mkdirSync(vault, { recursive: true });
  mkdirSync(projectRootDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ vault }, null, 2), 'utf8');
  token = 'a'.repeat(32);
  writeFileSync(path.join(userData, 'api-token.txt'), JSON.stringify({
    full: token,
    read: 'b'.repeat(32)
  }, null, 2), 'utf8');

  rpmCli('vault-init', [vault]);
  rpmCli('init', [projectRootDir, '--name', 'Stage2 Isolated Probe', '--direction', 'readonly-interface-test', '--type', 'research']);
  const planDir = path.join(projectRootDir, '01_Planning');
  const docDir = path.join(projectRootDir, '09_Documents');
  mkdirSync(planDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });
  writeFileSync(path.join(planDir, 'interface-notes.md'), '# interface notes\nstage2-readonly-probe\n', 'utf8');
  writeFileSync(path.join(docDir, 'sample-record.md'), '# sample record\nrelated fixture\n', 'utf8');
  rpmCli('scan', [projectRootDir]);
  const found = rpmCli('search', [projectRootDir, '--limit', '20']);
  const matches = found.matches || [];
  const note = matches.find((row) => row.name === 'interface-notes.md');
  const rec = matches.find((row) => row.name === 'sample-record.md');
  if (note && rec) {
    rpmCli('update', [
      projectRootDir,
      '--source', note.file_id,
      '--target', rec.file_id,
      '--relation', 'related_to',
      '--evidence', 'stage2 isolated fixture'
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
        { id: boundId, folder: 'BOUND', name: 'Stage2 Isolated Probe', rpmProjectId, rpmRoot: projectRootDir },
        { id: unboundId, folder: 'FREE', name: 'Unbound Preview' }
      ];
    }
  });

  const started = await apiServer.start({ userDataDir: userData, port: 17317, log: () => {} });
  assert.equal(started.ok, true, started.error);
  assert.notEqual(started.port, 7317);
  baseUrl = `http://127.0.0.1:${started.port}`;
  saveSample('meta.json', { port: started.port, isolated: true, officialVaultUsed: false });
});

after(() => {
  adapter.setSpawnObserver(null);
  try { apiServer.stop(); } catch (_) {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

test('status and list routes work against the isolated vault', async () => {
  const status = await apiGet('/api/rpm/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.available, true);
  assert.equal(status.json.settingsPath, settingsPath);
  assert.equal(projectRoot.pathsEqual(status.json.vaultPath, vault), true);
  assert.equal(status.json.rpmProjectCount, 1);
  assert.equal(String(status.json.vaultPath).includes('Obsidian\\Research_Vault'), false);
  saveSample('status.json', status.json);

  const projects = await apiGet('/api/rpm/projects');
  assert.equal(projects.status, 200);
  assert.equal(projects.json.projects.length, 1);
  assert.equal(projects.json.projects[0].id, boundId);
  assert.equal(projectRoot.pathsEqual(projects.json.projects[0].rpmRoot, projectRootDir), true);
  saveSample('projects.json', projects.json);
});

test('files, relations and rpm-audit match direct CLI JSON', async () => {
  const cliSearch = rpmCli('search', [projectRootDir, 'stage2-readonly-probe', '--limit', '10']);
  const files = await apiGet('/api/projects/' + boundId + '/files?query=stage2-readonly-probe&limit=10');
  assert.equal(files.status, 200);
  assert.equal(files.json.rpmBound, true);
  assert.equal(files.json.files.length, cliSearch.matches.length);
  assert.equal(files.json.files[0].name, cliSearch.matches[0].name);
  assert.equal(files.json.files[0].file_id, cliSearch.matches[0].file_id);
  assert.ok(files.json.files[0].absolute_path);
  assert.equal(files.json.files[0].absolute_path.includes(cliSearch.matches[0].relative_path.split('/').join(path.sep)), true);
  saveSample('files.json', files.json);

  const cliCtx = rpmCli('context', [projectRootDir]);
  const rel = await apiGet('/api/projects/' + boundId + '/relations');
  assert.equal(rel.status, 200);
  assert.equal(rel.json.relations.length, (cliCtx.relations || []).length);
  if (rel.json.relations.length) {
    assert.equal(rel.json.relations[0].kind, cliCtx.relations[0].kind);
    assert.ok(rel.json.relations[0].source_file.relative_path);
  }
  saveSample('relations.json', rel.json);

  const cliAudit = rpmCli('audit', [projectRootDir]);
  const audit = await apiGet('/api/projects/' + boundId + '/rpm-audit');
  assert.equal(audit.status, 200);
  assert.equal(audit.json.checked, cliAudit.checked);
  assert.equal(audit.json.issues.length, cliAudit.issues.length);
  saveSample('rpm-audit.json', audit.json);

  const vaultAudit = await apiGet('/api/rpm/vault-audit');
  assert.equal(vaultAudit.status, 200);
  const cliVault = rpmCli('vault-audit');
  assert.deepEqual(vaultAudit.json.issues || [], cliVault.issues || []);
  saveSample('vault-audit.json', vaultAudit.json);
});

test('root route reports bound real path and unbound project without init', async () => {
  const root = await apiGet('/api/projects/' + boundId + '/root');
  assert.equal(root.status, 200);
  assert.equal(root.json.rpmBound, true);
  assert.equal(projectRoot.pathsEqual(root.json.resolvedRoot, projectRootDir), true);
  saveSample('root-bound.json', root.json);

  const before = spawned.filter((item) => item.command === 'init' && item.spawned).length;
  const unbound = await apiGet('/api/projects/' + unboundId + '/root');
  assert.equal(unbound.status, 200);
  assert.equal(unbound.json.rpmBound, false);
  assert.equal(unbound.json.code, 'unbound');
  saveSample('root-unbound.json', unbound.json);

  const files = await apiGet('/api/projects/' + unboundId + '/files');
  assert.equal(files.status, 409);
  assert.equal(files.json.rpmBound, false);
  assert.equal(files.json.code, 'unbound');
  const after = spawned.filter((item) => item.command === 'init' && item.spawned).length;
  assert.equal(after, before);
  saveSample('files-unbound.json', files.json);

  const missing = await apiGet('/api/projects/does-not-exist/files');
  assert.equal(missing.status, 404);
});

test('existing /api/audit path is not occupied by RPM audit', async () => {
  const res = await apiGet('/api/audit');
  assert.notEqual(res.status, 200);
  const body = JSON.stringify(res.json || {});
  assert.equal(body.includes('"checked"'), false);
  assert.equal(res.json && res.json.error && /未就绪|未授权/.test(res.json.error), true);
});
