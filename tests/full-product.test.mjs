import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import product from '../desktop/full-product.js';
import searchModule from '../desktop/full-search.js';

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-full-product-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return fs.realpathSync.native(directory);
}

test('candidate requires both markers and refuses a redirected user-data directory', t => {
  const root = sandbox(t);
  const app = path.join(root, 'resources');
  const daily = path.join(root, 'daily-profile');
  const initial = path.join(root, 'ResearchWorkspace.exe');
  const profile = path.join(root, 'candidate-user-data');
  fs.mkdirSync(app);
  fs.mkdirSync(daily);
  fs.writeFileSync(path.join(app, product.MARKER), product.MARKER_CONTENT + '\r\n');
  assert.throws(() => product.isolatedDirectory(initial, app, daily), /markers/);
  fs.writeFileSync(path.join(root, product.MARKER), product.MARKER_CONTENT + '\r\n');
  assert.equal(product.isolatedDirectory(initial, app, daily), profile);
  fs.rmdirSync(profile);
  fs.symlinkSync(daily, profile, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => product.isolatedDirectory(initial, app, daily), /redirected/);
  assert.deepEqual(fs.readdirSync(daily), []);
});

test('opt-in migration keeps source bytes and IDs, removes credential-like fields and backs up the candidate', t => {
  const root = sandbox(t);
  const source = path.join(root, 'workspace-data.fixture.json');
  const candidate = path.join(root, 'workspace-data.json');
  const data = {
    projects: [{ id: 'p-stable', name: 'Fixture', milestones: [{ id: 'm-stable' }] }],
    tasks: [{ id: 't-stable', p: 'p-stable' }],
    settings: { token: 'synthetic-token', rootDir: 'fixture', rpmBindings: {} }
  };
  const original = Buffer.from('\uFEFF' + JSON.stringify(data));
  fs.writeFileSync(source, original);
  fs.writeFileSync(candidate, '{"projects":[],"tasks":[]}');
  const result = product.importWorkspace(source, candidate);
  assert.deepEqual(result, { ok: true, backedUp: true, projects: 1, tasks: 1 });
  assert.deepEqual(fs.readFileSync(source), original);
  const loaded = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  assert.equal(loaded.projects[0].milestones[0].id, 'm-stable');
  assert.equal(loaded.tasks[0].id, 't-stable');
  assert.deepEqual(loaded.settings, { rpmBindings: {} });
  const backups = path.join(root, 'migration-backups');
  assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]), 'utf8'), '{"projects":[],"tasks":[]}');
  assert.equal(product.importWorkspace(candidate, candidate).ok, false);
});

test('candidate opens only real supported originals and keeps protected RPM evidence metadata-only', t => {
  const root = sandbox(t);
  const index = path.join(root, 'fixture');
  fs.mkdirSync(index);
  fs.writeFileSync(path.join(index, 'note #1.md'), 'synthetic');
  fs.writeFileSync(path.join(root, 'outside.md'), 'synthetic');
  fs.writeFileSync(path.join(index, 'run.cmd'), '');
  fs.symlinkSync(root, path.join(index, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(product.safeDocument(index, 'note #1.md'), path.join(index, 'note #1.md'));
  for (const relative of ['../outside.md', 'escape/outside.md', 'note #1.md:stream', 'run.cmd', '/outside.md']) {
    assert.equal(product.safeDocument(index, relative), null);
  }
  assert.equal(product.metadataOnly('d72165400fae48eb9466e8151cdd15e3'), true);
  if (process.platform === 'win32') {
    assert.equal(product.metadataOnly('', 'G:\\TPMS\\notes\\sample.md'), true);
    assert.equal(product.metadataOnly('', 'G:\\TPMS-synthetic\\sample.md'), false);
  }
});

test('migration rejects a redirected destination before reading or backing it up', t => {
  const root = sandbox(t);
  const source = path.join(root, 'workspace-data.fixture.json');
  const original = path.join(root, 'original.json');
  const destination = path.join(root, 'workspace-data.json');
  const data = '{"projects":[],"tasks":[]}';
  fs.writeFileSync(source, data);
  fs.writeFileSync(original, data);
  fs.linkSync(original, destination);
  assert.equal(product.importWorkspace(source, destination).ok, false);
  assert.equal(fs.existsSync(path.join(root, 'migration-backups')), false);
  assert.equal(fs.readFileSync(original, 'utf8'), data);
});

test('structured search combines workbench, RPM and note titles with isolated source status', async () => {
  const search = searchModule.createSearch({
    readWorkspace: () => ({
      projects: [{ id: 'p', name: 'optics calibration', nodes: [{ id: 'm', l: 'calibration milestone' }] }],
      tasks: [{ id: 't', p: 'p', t: 'calibration task' }]
    }),
    searchRpm: async () => ({ ok: true, files: [{ name: 'indexed calibration', relative_path: 'calibration.md', file_id: 'f' }] }),
    readGraph: async () => ({ ok: true, nodes: [{ id: 'n', title: 'calibration procedure', type: 'method', project_id: 'r' }] }),
    listNotes: async () => ({ ok: true, files: [{ name: 'calibration note', path: 'note.md' }] })
  });
  const result = await search.search({ query: 'calibration' });
  assert.deepEqual(result.results.map(row => row.kind), ['project', 'milestone', 'task', 'node', 'material', 'note']);
  assert.deepEqual(Object.keys(result.sources), ['workspace', 'rpm', 'vault']);
  assert.equal(result.sources.rpm.count, 2);
});
