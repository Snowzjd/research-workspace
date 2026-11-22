/**
 * 知识接口传输与原件打开安全：失败时不得打开其他文件；任意脚本被拒绝。
 * 运行：node --test tests/rpm-knowledge.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const adapter = require('../desktop/rpm-adapter.js');
const knowledge = require('../desktop/rpm-knowledge.js');

let tmp = '';
before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'rw-rpm-kn-'));
});
after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

test('material actions resolve a registered original and reject mismatched paths', async () => {
  mkdirSync(path.join(tmp, 'materials'));
  const root = realpathSync.native(path.join(tmp, 'materials'));
  const filename = 'fixture CAD.scdoc';
  const target = path.join(root, filename);
  writeFileSync(target, 'synthetic fixture');
  const project = { rpmProjectId: 'project-a', root };
  const calls = [];
  const hooks = {
    resolve: async (_config, projectId) => ({
      ok: true, file: { project_id: projectId, relative_path: filename, path: target }
    }),
    open: file => { calls.push(['open', file]); return ''; },
    reveal: file => calls.push(['reveal', file]),
    copy: file => calls.push(['copy-path', file])
  };
  for (const action of ['open', 'reveal', 'copy-path']) {
    assert.equal((await knowledge.accessMaterial({}, project, { id: 'fixture', action }, hooks)).ok, true);
  }
  assert.deepEqual(calls, ['open', 'reveal', 'copy-path'].map(action => [action, target]));
  assert.equal((await knowledge.accessMaterial({}, { ...project, root: tmp }, { id: 'fixture' }, hooks)).ok, false);
  assert.equal(calls.length, 3);
});

test('arbitrary python scripts are rejected before spawn', async () => {
  const evil = path.join(tmp, 'evil.py');
  writeFileSync(evil, 'print("nope")\n', 'utf8');
  const seen = [];
  adapter.setSpawnObserver((info) => seen.push(info));
  try {
    const result = await adapter.runCommand('context', ['--knowledge-network'], {
      cache: false,
      scriptPath: evil,
      pythonPath: process.env.RPM_TEST_PYTHON || 'D:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'script_not_allowed');
    assert.equal(result.spawned, false);
  } finally {
    adapter.setSpawnObserver(null);
  }
  assert.equal(seen.every((item) => item.spawned === false), true);
});

test('bundled knowledge script is on the allowlist', () => {
  assert.equal(adapter.isAllowedScript(knowledge.KNOWLEDGE_SCRIPT), true);
  assert.equal(adapter.isAllowedScript(adapter.knowledgeScriptPath()), true);
});

test('openResolvedFile does not open a fallback path when resolve fails', async () => {
  const opened = [];
  const result = await knowledge.openResolvedFile({}, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', {
    exists: () => true,
    resolveFile: async () => ({ ok: false, schema_version: 1, code: 'file_not_found', error: '未能找到该 ID' }),
    openPath: async (target) => { opened.push(target); return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.opened, false);
  assert.equal(result.code, 'file_not_found');
  assert.equal(opened.length, 0);
});

test('openResolvedFile does not open when the resolved file has already vanished', async () => {
  const opened = [];
  const result = await knowledge.openResolvedFile({}, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', {
    exists: () => false,
    resolveFile: async () => ({
      ok: true, schema_version: 1, project_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', revision: 'c'.repeat(64),
      file: { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', path: path.join(tmp, 'missing #1.md'), relative_path: 'missing #1.md', status: 'Working' }
    }),
    openPath: async (target) => { opened.push(target); return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.opened, false);
  assert.equal(result.code, 'file_unavailable');
  assert.equal(opened.length, 0);
});

test('openResolvedFile opens only the resolved path, including Chinese, spaces and hash', async () => {
  const target = path.join(tmp, '潮位方案 #1.md');
  writeFileSync(target, 'ok\n', 'utf8');
  const opened = [];
  const result = await knowledge.openResolvedFile({}, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', {
    resolveFile: async () => ({
      ok: true, schema_version: 1, project_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', revision: 'd'.repeat(64),
      file: { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', path: target, relative_path: '潮位方案 #1.md', status: 'Working' }
    }),
    openPath: async (p) => { opened.push(p); return { ok: true }; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.opened, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0], path.resolve(target));
});
