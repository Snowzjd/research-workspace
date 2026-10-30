/**
 * 知识库服务按需启动 / 空闲停止（desktop/kb-service.js）。
 * 运行：node --test tests/kb-service.test.mjs
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test, beforeEach } from 'node:test';

const require = createRequire(import.meta.url);
const kb = require('../desktop/kb-service.js');

const START = 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\rag\\start.ps1 -TimeoutSec 60';
const STOP = 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\rag\\stop.ps1';
const cfg = (extra) => ({ endpoint: 'http://127.0.0.1:8765', engine: 'rag_snowz', kb: Object.assign({ startCommand: START, stopCommand: STOP, startTimeoutSec: 5, idleStopMinutes: 30 }, extra || {}) });

function fakeChild({ code = 0, stdout = '', delay = 10 } = {}) {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stdout.destroy = () => {};
  c.stderr = new EventEmitter(); c.stderr.destroy = () => {};
  c.unref = () => {}; c.pid = 4242;
  setTimeout(() => { if (stdout) c.stdout.emit('data', stdout); c.emit('exit', code); }, delay);
  return c;
}

let up = false;
let spawns = [];
beforeEach(() => {
  kb._reset();
  up = false;
  spawns = [];
  kb.setHealth(async () => (up ? { ok: true, docs: 266, chunks: 33383 } : { ok: false, error: 'ECONNREFUSED' }));
  kb.setNotifier(null);
});

test('commands are split without a shell and unsafe forms are refused', () => {
  const p = kb.parseCommand(START);
  assert.equal(p.ok, true);
  assert.equal(p.file, 'powershell');
  assert.deepEqual(p.args.slice(-3), ['C:\\rag\\start.ps1', '-TimeoutSec', '60']);
  assert.equal(kb.parseCommand('').code, 'unconfigured');
  assert.equal(kb.parseCommand('python serve.py').ok, false);
  assert.equal(kb.parseCommand('C:\\no\\such\\start.ps1').ok, false);
  assert.deepEqual(kb.lastJson('x\n{"ok":true,"docs":266}\n'), { ok: true, docs: 266 });
});

test('concurrent searches share one start, then retry and succeed', async () => {
  kb.setSpawn((file, args, opts) => {
    spawns.push({ file, args, opts });
    assert.equal(opts.shell, false);
    assert.equal(opts.windowsHide, true);
    assert.equal(opts.detached, false);
    setTimeout(() => { up = true; }, 30);
    return fakeChild({ stdout: '{"ok":true,"docs":266,"chunks":33383}\n', delay: 40 });
  });
  let calls = 0;
  const search = async () => { calls++; return up ? { ok: true, results: [1, 2] } : { ok: false, error: 'connect ECONNREFUSED' }; };
  const [a, b] = await Promise.all([kb.withService(cfg(), search), kb.withService(cfg(), search)]);
  assert.equal(spawns.length, 1);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(a.kb_start.started, true);
  assert.equal(kb.status().startedByApp, true);
});

test('script failure reports 知识库启动失败 with the reason', async () => {
  kb.setSpawn(() => fakeChild({ code: 1, stdout: '{"ok":false,"error":"pg 端口被占用"}\n' }));
  const r = await kb.withService(cfg(), async () => ({ ok: false, error: 'connect ECONNREFUSED' }));
  assert.equal(r.ok, false);
  assert.equal(r.kb_start.code, 'start_failed');
  assert.ok(r.error.startsWith('知识库启动失败：pg 端口被占用'));
  assert.equal(kb.status().startedByApp, false);
});

test('timeout is reported, not hidden', async () => {
  kb.setSpawn(() => fakeChild({ code: 0, delay: 10 }));
  const r = await kb.ensureUp(cfg({ startTimeoutSec: 5 }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'start_timeout');
  assert.ok(r.ms >= 4900);
});

test('unconfigured start command does not spawn anything', async () => {
  kb.setSpawn(() => { throw new Error('should not spawn'); });
  const r = await kb.withService(cfg({ startCommand: '' }), async () => ({ ok: false, error: 'connect ECONNREFUSED' }));
  assert.equal(r.ok, false);
  assert.equal(r.kb_start.code, 'unconfigured');
});

test('idle stop only touches a service this app started', async () => {
  up = true;
  kb.setSpawn((file, args) => { spawns.push(args.join(' ')); return fakeChild({ stdout: '{"ok":true}\n' }); });
  await kb.withService(cfg(), async () => ({ ok: true }));
  let r = await kb.idleTick(Date.now() + 31 * 60000);
  assert.equal(r.stopped, false, 'service started by someone else is left alone');
  assert.equal(spawns.length, 0);

  up = false;
  kb.setSpawn((file, args) => { spawns.push(args.join(' ')); if (args.join(' ').includes('start.ps1')) up = true; return fakeChild({ stdout: '{"ok":true}\n' }); });
  await kb.ensureUp(cfg());
  assert.equal(kb.status().startedByApp, true);
  r = await kb.idleTick(Date.now() + 10 * 60000);
  assert.equal(r.stopped, false);
  r = await kb.idleTick(Date.now() + 31 * 60000);
  assert.equal(r.stopped, true);
  assert.ok(spawns.some(s => s.includes('stop.ps1')));
  assert.equal(kb.status().startedByApp, false);
});
