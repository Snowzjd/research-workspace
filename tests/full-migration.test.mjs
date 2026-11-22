import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import migration from '../desktop/full-migration.js';

const modulePath = fileURLToPath(new URL('../desktop/full-migration.js', import.meta.url));
const workspace = 'workspace-data.json';
const codex = 'codex-executions.json';
const vault = 'vault-config.json';
const noVault = () => '';
const fixtureData = (id, schemaVersion = 3) => ({
  schemaVersion, projects: [{ id, title: '材料研究' }], tasks: [{ id: 't-' + id, p: id, s: 'todo' }],
  settings: { rpmBindings: { [id]: { rpmProjectId: 'a'.repeat(32), rpmRoot: 'study' } }, token: 'example' }
});

function root(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rw-formal-migration-')));
  t.after(() => {
    const real = fs.realpathSync.native(dir);
    assert.equal(real, dir);
    assert.match(path.basename(real), /^rw-formal-migration-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function put(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
}

const get = (directory, name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));

function priorVersion(directory, release) {
  const app = path.join(directory, 'old', 'resources', 'app');
  const profile = path.join(directory, 'old', 'candidate-user-data');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(profile);
  put(app, 'package.json', { name: 'research-workspace-desktop', version: release });
  for (const control of [app, path.dirname(profile)]) {
    fs.writeFileSync(path.join(control, 'FULL-CANDIDATE-PORTABLE.txt'), 'RESEARCH-WORKSPACE-FULL-' + release);
  }
  return profile;
}

function startup(data) {
  const result = spawnSync(process.execPath, ['-e',
    'require(process.argv[1]).applyBeforeStartup(process.argv[2])', modulePath, data], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

for (const release of ['4.0.0-rc.1', '4.0.0-rc.2', '4.0.0-rc.3']) {
  test(`${release} profile migrates across restart without changing the old profile`, t => {
    const dir = root(t);
    const profile = priorVersion(dir, release);
    const data = path.join(dir, 'portable-user-data');
    const notes = path.join(dir, 'vault');
    fs.mkdirSync(data);
    fs.mkdirSync(notes);
    const original = path.join(notes, '人工笔记.md');
    fs.writeFileSync(original, '# 保留原件\n');
    put(profile, workspace, fixtureData('p'));
    const run = { sessionId: 'codex-existing', taskId: 't-p', projectId: 'p', events: [], files: [], checks: [] };
    put(profile, codex, { version: 1, runs: [run] });
    put(profile, vault, { vaultRoot: notes });
    put(data, workspace, fixtureData('before'));
    const bytes = Object.fromEntries([workspace, codex, vault].map(name => [name, fs.readFileSync(path.join(profile, name))]));
    const plan = migration.preview(data, profile, 'profile', folder => folder === notes ? notes : '');
    assert.equal(plan.version, release);
    assert.equal(plan.projects, 1);
    assert.equal(plan.runs, 1);
    assert.deepEqual(migration.stage(data, plan), { ok: true, restartRequired: true });
    assert.equal(get(data, workspace).projects[0].id, 'before');
    assert.equal(migration.readStatus(data).pending, true);
    startup(data);
    assert.equal(get(data, workspace).projects[0].id, 'p');
    assert.equal(get(data, workspace).tasks[0].id, 't-p');
    assert.equal(get(data, workspace).settings.rpmBindings.p.rpmProjectId, 'a'.repeat(32));
    assert.equal(get(data, workspace).settings.token, undefined);
    assert.deepEqual(get(data, codex).runs, [run]);
    assert.deepEqual(get(data, vault), { vaultRoot: notes });
    const status = migration.readStatus(data);
    assert.equal(status.pending, false);
    assert.equal(status.last.phase, 'complete');
    const backup = path.join(data, 'migration-backups', status.last.backup);
    assert.equal(get(backup, workspace).projects[0].id, 'before');
    assert.equal(fs.readFileSync(original, 'utf8'), '# 保留原件\n');
    for (const [name, saved] of Object.entries(bytes)) assert.deepEqual(fs.readFileSync(path.join(profile, name)), saved);
  });
}

test('legacy workspace schema is checked, imported without inventing Codex history, and can be restored', t => {
  const dir = root(t);
  const data = path.join(dir, 'portable-user-data');
  fs.mkdirSync(data);
  put(data, workspace, fixtureData('existing'));
  const backup = migration.captureBackup(data);
  put(dir, workspace, fixtureData('legacy', 2));
  const old = path.join(dir, workspace);
  migration.stage(data, migration.preview(data, old, 'json', noVault));
  startup(data);
  assert.equal(get(data, workspace).projects[0].id, 'legacy');
  assert.equal(get(data, workspace).schemaVersion, 2);
  assert.equal(fs.existsSync(path.join(data, codex)), false);
  migration.stage(data, migration.preview(data, backup.directory, 'profile', noVault));
  startup(data);
  assert.equal(get(data, workspace).projects[0].id, 'existing');
  put(dir, workspace, fixtureData('future', 4));
  assert.throws(() => migration.preview(data, old, 'json', noVault), /版本/);
  const newProfile = priorVersion(dir, '4.1.0');
  assert.throws(() => migration.preview(data, newProfile, 'profile', noVault), /版本/);
});

test('interrupted transfer restores the pre-migration backup on the next process', t => {
  const dir = root(t);
  const data = path.join(dir, 'portable-user-data');
  fs.mkdirSync(data);
  put(data, workspace, fixtureData('original'));
  const backup = migration.captureBackup(data);
  put(dir, workspace, fixtureData('old'));
  migration.stage(data, migration.preview(data, path.join(dir, workspace), 'json', noVault));
  const pending = path.join(data, 'pending-migration');
  const journal = get(pending, 'migration-plan.json');
  put(pending, 'migration-plan.json', { ...journal, phase: 'applying', backup: backup.id });
  put(data, workspace, fixtureData('partly-written'));
  put(data, vault, { vaultRoot: 'already-written' });
  startup(data);
  assert.equal(get(data, workspace).projects[0].id, 'original');
  assert.equal(fs.existsSync(path.join(data, vault)), false);
  assert.equal(migration.readStatus(data).last.phase, 'rolled_back');
});

test('tampered stage does not replace current data or allow a second pending migration', t => {
  const dir = root(t);
  const data = path.join(dir, 'portable-user-data');
  fs.mkdirSync(data);
  put(data, workspace, fixtureData('original'));
  put(dir, workspace, fixtureData('legacy'));
  const plan = migration.preview(data, path.join(dir, workspace), 'json', noVault);
  migration.stage(data, plan);
  assert.throws(() => migration.stage(data, plan), /已有待执行/);
  put(path.join(data, 'pending-migration'), workspace, fixtureData('tampered'));
  startup(data);
  assert.equal(get(data, workspace).projects[0].id, 'original');
  assert.equal(migration.readStatus(data).last.phase, 'failed');
  assert.equal(migration.readStatus(data).pending, false);
});
