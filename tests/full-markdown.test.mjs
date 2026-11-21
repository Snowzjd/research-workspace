import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, link, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import markdown from '../desktop/full-markdown.js';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function setup(t) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'rw-mark-fixture-'));
  const vault = path.join(root, 'vault');
  const project = path.join(root, 'coating');
  const outside = path.join(root, 'outside');
  const backupDir = path.join(root, 'candidate', 'markdown-backups');
  const changes = [];
  await Promise.all([mkdir(vault), mkdir(project), mkdir(outside)]);
  const service = markdown.createMarkdownService({
    vaultRoot: vault, backupDir, pollIntervalMs: 75, onChange: change => changes.push(change),
    resolveProject: async id => ({
      coating: { root: project }, reader: { root: project, readOnly: true },
      protected: { root: project, metadataOnly: true }
    })[id]
  });
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true, maxRetries: 4 }); });
  return { service, root, vault, project, outside, changes, backupDir };
}

async function until(predicate) {
  for (let attempts = 0; attempts < 40; attempts++) {
    const result = predicate();
    if (result) return result;
    await sleep(75);
  }
  assert.fail('no expected watcher event');
}

test('lists Vault and registered project originals independently without reading payloads', async t => {
  const { service, vault, project } = await setup(t);
  await mkdir(path.join(vault, '测试笔记'));
  await writeFile(path.join(vault, '测试笔记', '研究.md'), 'fixture text\n');
  await writeFile(path.join(vault, 'data.csv'), 'x\n');
  await writeFile(path.join(vault, 'credentials.md'), 'prohibited fixture\n');
  await writeFile(path.join(project, 'method.markdown'), 'project fixture\n');
  await mkdir(path.join(project, '00_Project_Management'));
  await writeFile(path.join(project, '00_Project_Management', 'TASKS.md'), 'prohibited fixture\n');
  assert.deepEqual((await service.list({ query: '研究' })).files, [{ path: '测试笔记/研究.md', name: '研究.md' }]);
  assert.deepEqual((await service.list({ directory: '测试笔记' })).files.map(row => row.name), ['研究.md']);
  assert.deepEqual((await service.list({ projectId: 'coating' })).files.map(row => row.path), ['method.markdown']);
  assert.equal((await service.read({ projectId: 'coating', path: 'method.markdown' })).text, 'project fixture\n');
  assert.equal((await service.list({ projectId: 'unknown' })).code, 'unconnected');
});

test('saves, backs up and restores exact UTF-8 BOM + CRLF bytes', async t => {
  const { service, vault, backupDir } = await setup(t);
  const note = { path: 'note.md' };
  const file = path.join(vault, note.path);
  const initial = Buffer.concat([BOM, Buffer.from('起始\r\n原始\r\n')]);
  await writeFile(file, initial);
  const read = await service.read(note);
  assert.equal(read.ok, true, read.message);
  assert.equal(read.bom, true);
  assert.equal(read.newline, 'CRLF');
  assert.equal(read.text, '起始\n原始\n');
  assert.deepEqual((await service.versions(note)).versions, []);
  const noChange = await service.save({ ...note, revision: read.revision, text: read.text });
  assert.equal(noChange.revision, read.revision);
  const saved = await service.save({ ...note, revision: read.revision, text: '起始\n更新\n' });
  assert.equal(saved.ok, true, saved.message);
  assert.notEqual(saved.revision, read.revision);
  assert.deepEqual(await readFile(file), Buffer.concat([BOM, Buffer.from('起始\r\n更新\r\n')]));
  const items = (await service.versions(note)).versions;
  assert.equal(items.length, 1);
  assert.equal(items[0].versionId, saved.backupVersionId);
  assert.equal(items[0].size, initial.length);
  assert.notEqual((await readdir(backupDir)).length, 0);
  const staleRestore = await service.restore({ ...note, revision: read.revision, versionId: items[0].versionId });
  assert.equal(staleRestore.code, 'conflict');
  const restored = await service.restore({ ...note, revision: saved.revision, versionId: items[0].versionId });
  assert.equal(restored.ok, true, restored.message);
  assert.deepEqual(await readFile(file), initial);
  assert.equal((await service.versions(note)).versions.length, 2);
  assert.deepEqual(await readdir(vault), [note.path]);
});

test('preserves LF, CR and mixed newline styles through existing tracked files', async t => {
  const { service, project } = await setup(t);
  for (const [filename, original, expected] of [
    ['lf.md', 'first\nold\nlast', 'first\nnew\nlast'],
    ['cr.md', 'first\rold\rlast', 'first\rnew\rlast'],
    ['mixed.md', 'first\r\nold\nlast\r', 'first\r\nnew\nlast\r']
  ]) {
    const target = { projectId: 'coating', path: filename };
    await writeFile(path.join(project, filename), original);
    const read = await service.read(target);
    const saved = await service.save({ ...target, revision: read.revision, text: read.text.replace('old', 'new') });
    assert.equal(saved.ok, true, saved.message);
    assert.equal(saved.bom, false);
    assert.equal(await readFile(path.join(project, filename), 'utf8'), expected);
  }
});

test('rejects stale edits and serializes simultaneous candidate saves', async t => {
  const { service, vault } = await setup(t);
  const target = { path: 'shared.md' };
  const file = path.join(vault, target.path);
  await writeFile(file, 'earlier\n');
  const earlier = await service.read(target);
  await writeFile(file, 'external edit\n');
  const stale = await service.save({ ...target, revision: earlier.revision, text: 'stale edit\n' });
  assert.equal(stale.code, 'conflict');
  const external = await service.read(target);
  assert.equal(stale.revision, external.revision);
  assert.equal(external.text, 'external edit\n');
  const pair = await Promise.all(['first\n', 'second\n'].map(text => service.save({ ...target, revision: external.revision, text })));
  assert.equal(pair.filter(row => row.ok).length, 1);
  assert.ok(pair.some(row => ['busy', 'conflict'].includes(row.code)));
  assert.equal(await readFile(file, 'utf8'), pair.find(row => row.ok).text);
});

test('watches external replacement, deletion, and reappearance and supports unwatch', async t => {
  const { service, vault, changes } = await setup(t);
  const target = { path: 'watch.md' };
  const file = path.join(vault, target.path);
  const tmp = path.join(vault, 'extern.tmp');
  await writeFile(file, 'initial\n');
  const watched = await service.watch(target);
  assert.equal(watched.ok, true, watched.message);
  await writeFile(tmp, 'replaced\n');
  await rename(tmp, file);
  const replacement = await until(() => changes.find(change => change.revision && change.revision !== watched.revision));
  assert.equal(replacement.path, target.path);
  await rm(file);
  await until(() => changes.find(change => change.code === 'not_found'));
  await writeFile(file, 'reappeared\n');
  const reappeared = await service.read(target);
  await until(() => changes.find(change => change.revision === reappeared.revision));
  assert.equal((await service.unwatch(target)).ok, true);
  const count = changes.length;
  await writeFile(file, 'after unwatch\n');
  await sleep(250);
  assert.equal(changes.length, count);
});

test('rejects traversal, special names, blocked roots, bad encoding, and readonly writes', async t => {
  const { service, project, vault } = await setup(t);
  await writeFile(path.join(project, 'original.md'), 'readonly fixture');
  await writeFile(path.join(vault, 'invalid.md'), Buffer.from([0xff, 0xfe]));
  for (const bad of ['../escape.md', 'C:\\Users\\escape.md', '\\absolute.md', 'a/../escape.md', 'a.md:stream.md',
    'AUX.md', '.obsidian/escape.md', 'credentials.md', 'foo./bar.md', '00_Project_Management/plan.md']) {
    assert.equal((await service.read({ path: bad })).code, 'unsafe_path', bad);
  }
  assert.equal((await service.read({ projectId: 'protected', path: 'original.md' })).code, 'metadata_only');
  assert.equal((await service.read({ path: 'invalid.md' })).code, 'invalid_encoding');
  const reader = { projectId: 'reader', path: 'original.md' };
  const read = await service.read(reader);
  assert.equal(read.readOnly, true);
  assert.equal((await service.save({ ...reader, revision: read.revision, text: 'change' })).code, 'read_only');
  assert.equal((await service.restore({ ...reader, revision: read.revision, versionId: 'ignored' })).code, 'read_only');
  assert.equal(await readFile(path.join(project, 'original.md'), 'utf8'), 'readonly fixture');
});

test('rejects directory junctions, hard links and symlinked backup roots', async t => {
  const { service, vault, outside, backupDir } = await setup(t);
  const file = path.join(outside, 'outside.md');
  await writeFile(file, 'external fixture\n');
  await symlink(outside, path.join(vault, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, path.join(vault, 'outside.md'), process.platform === 'win32' ? 'junction' : 'dir');
  await link(file, path.join(vault, 'hard.md'));
  assert.equal((await service.read({ path: 'outside/outside.md' })).code, 'unsafe_path');
  assert.equal((await service.read({ path: 'outside.md' })).code, 'unsafe_path');
  assert.equal((await service.read({ path: 'hard.md' })).code, 'unsafe_path');
  assert.ok(!(await service.list({})).files.some(row => row.path.startsWith('outside/')));
  await mkdir(path.dirname(backupDir));
  await symlink(outside, backupDir, process.platform === 'win32' ? 'junction' : 'dir');
  const note = { path: 'inside.md' };
  await writeFile(path.join(vault, note.path), 'inside fixture\n');
  const read = await service.read(note);
  assert.equal((await service.save({ ...note, revision: read.revision, text: 'mutated' })).code, 'unsafe_path');
  assert.equal(await readFile(path.join(vault, note.path), 'utf8'), 'inside fixture\n');
  assert.deepEqual(await readdir(outside), ['outside.md']);
});

test('rejects a linked Markdown file or reports platform link privilege', async t => {
  const { service, vault, outside } = await setup(t);
  const external = path.join(outside, 'file.md');
  await writeFile(external, 'external fixture\n');
  try { await symlink(external, path.join(vault, 'link.md'), 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip('Windows file symlink privilege unavailable; junction and hard-link paths tested separately');
    return;
  }
  assert.equal((await service.read({ path: 'link.md' })).code, 'unsafe_path');
  assert.deepEqual((await service.list({})).files, []);
});
