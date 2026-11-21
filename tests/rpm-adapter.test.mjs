/**
 * RPM 只读适配器：白名单、参数数组、超时、输出限制、哈希核对。
 * 运行：node --test tests/rpm-adapter.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const adapter = require('../desktop/rpm-adapter.js');

const WRITE_COMMANDS = ['organize', 'update', 'init', 'sync', 'scan', 'migrate-vault', 'vault-init', 'archive', 'rm', 'whatever'];

let tmp = '';
let fakeScript = '';
const pythonPath = process.env.RPM_TEST_PYTHON
  || 'D:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';

before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'rw-rpm-adapter-'));
  mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fakeScript = path.join(tmp, 'scripts', 'rpm.py');
  writeFileSync(path.join(tmp, 'SKILL.md'), 'fake skill for hash tests\n');
  writeFileSync(fakeScript, [
    'import json, sys, time',
    'text = " ".join(sys.argv)',
    'if "sleep" in text:',
    '    time.sleep(8)',
    '    print(json.dumps({"slept": True}))',
    'elif "huge" in text:',
    '    sys.stdout.write("{" + ("x" * 200000) + "}")',
    '    sys.stdout.flush()',
    'else:',
    '    print(json.dumps({"proj-isolated": "C:\\\\tmp\\\\isolated"}))',
  ].join('\n'), 'utf8');
});

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

test('hard-rejects write and unknown commands without spawning', async () => {
  const seen = [];
  adapter.setSpawnObserver((info) => seen.push(info));
  try {
    for (const command of WRITE_COMMANDS) {
      const result = await adapter.runCommand(command, ['G:\\TPMS'], { cache: false });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'command_not_allowed');
      assert.equal(result.spawned, false);
    }
  } finally {
    adapter.setSpawnObserver(null);
  }
  assert.equal(seen.every((item) => item.spawned === false), true);
  assert.equal(seen.some((item) => item.command === 'init' && item.spawned === true), false);
});

test('spawns with an argument array and shell=false', async () => {
  const seen = [];
  adapter.setSpawnObserver((info) => seen.push(info));
  adapter.clearCache();
  const result = await adapter.runCommand('list', [], {
    pythonPath,
    scriptPath: fakeScript,
    settingsPath: path.join(tmp, 'settings.json'),
    cache: false
  });
  adapter.setSpawnObserver(null);
  assert.equal(result.ok, true, result.error);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].spawned, true);
  assert.equal(seen[0].shell, false);
  assert.equal(Array.isArray(seen[0].argv), true);
  assert.equal(seen[0].argv.includes('-X'), true);
  assert.equal(seen[0].argv.includes('utf8'), true);
  assert.equal(seen[0].argv.includes('-B'), true);
  assert.equal(seen[0].argv.includes(fakeScript), true);
  assert.equal(seen[0].argv.includes('--settings'), true);
  assert.equal(seen[0].argv.includes('list'), true);
  assert.equal(seen[0].argv.some((part) => String(part).includes(' && ')), false);
  assert.deepEqual(result.data, { 'proj-isolated': 'C:\\tmp\\isolated' });
});

test('enforces timeout', async () => {
  const result = await adapter.runCommand('list', [], {
    pythonPath,
    scriptPath: fakeScript,
    settingsPath: path.join(tmp, 'settings-sleep.json'),
    timeoutMs: 400,
    cache: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'timeout');
});

test('enforces stdout size limit', async () => {
  const result = await adapter.runCommand('list', [], {
    pythonPath,
    scriptPath: fakeScript,
    settingsPath: path.join(tmp, 'settings-huge.json'),
    maxStdout: 1024,
    timeoutMs: 5000,
    cache: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'output_too_large');
});

test('skill hash matches the recorded fingerprint only for the live skill when unchanged', () => {
  const fake = adapter.skillFingerprint(fakeScript);
  assert.ok(fake.hash);
  assert.equal(fake.hash === adapter.EXPECTED_SKILL_HASH, false);
  const status = adapter.describeStatus({ scriptPath: fakeScript, pythonPath });
  assert.equal(status.skillHashMatch, false);
  assert.match(status.skillHashWarning, /不一致/);
});
