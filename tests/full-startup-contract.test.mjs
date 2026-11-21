import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

function windowFixture(onLoad = () => {}) {
  const source = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function createWindow(');
  const end = source.indexOf('/* ==========================================================================\n   webview', start);
  assert.ok(start >= 0);
  const calls = [];
  const timers = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    isVisible() { return this.visible; }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    show() { this.visible = true; }
    loadFile() { onLoad(this); return Promise.resolve(); }
  }
  const createWindow = runInNewContext(
    source.slice(start, end >= 0 ? end : source.indexOf("app.on('web-contents-created'", start)) + '\ncreateWindow',
    { BrowserWindow, fullCandidate: true, isDemoPortable: false, isDev: false,
      process: { platform: 'win32', argv: [], versions: { electron: '45.4.1' } },
      fs: { existsSync: () => false }, path, __dirname: 'desktop', ROOT: '.', ICON_PATH: 'icon.ico',
      setTimeout: callback => timers.push(callback),
      resetBootLog() {}, logBoot: line => calls.push(line),
      stopDesktopServices: () => calls.push('stopped'), app: { exit: code => calls.push(code), getVersion: () => '4.0.0-rc.1' },
      apiServer: { setWindow: window => calls.push(window) } }
  );
  return { createWindow, calls, timers };
}

test('candidate exposes and shows the window only after load and stops on a failed sandbox launch', () => {
  const { createWindow, calls } = windowFixture();
  const failed = createWindow();
  assert.equal(failed.options.webPreferences.sandbox, true);
  assert.equal(failed.options.webPreferences.contextIsolation, true);
  assert.equal(failed.options.webPreferences.nodeIntegration, false);
  assert.equal(failed.options.webPreferences.nodeIntegrationInWorker, false);
  assert.equal(failed.options.webPreferences.nodeIntegrationInSubFrames, false);
  assert.equal(failed.options.webPreferences.webSecurity, true);
  assert.equal(failed.options.webPreferences.webviewTag, false);
  assert.ok(!calls.includes(failed));
  failed.webContents.emit('render-process-gone', {}, { reason: 'launch-failed', exitCode: 49 });
  assert.ok(calls.some(line => typeof line === 'string' && line.includes('could not create a restricted renderer token')));
  assert.deepEqual(calls.slice(-3), [null, 'stopped', 1]);
  const good = createWindow();
  assert.ok(!calls.includes(good));
  good.emit('ready-to-show');
  assert.equal(good.isVisible(), false);
  good.webContents.emit('did-finish-load');
  assert.ok(calls.includes(good));
  assert.equal(good.isVisible(), true);
});

test('missing main page or failed sandbox preload stops startup before the window or API is exposed', () => {
  for (const failure of [
    win => win.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///index.html', true),
    win => win.webContents.emit('preload-error', {}, 'preload.js', new Error('fixture'))
  ]) {
    const { createWindow, calls, timers } = windowFixture(failure);
    const win = createWindow();
    win.webContents.emit('did-finish-load');
    win.emit('ready-to-show');
    for (const timer of timers) timer();
    assert.equal(win.isVisible(), false);
    assert.ok(!calls.includes(win));
    assert.equal(calls.filter(call => call === 'stopped').length, 1);
    assert.ok(calls.includes(1));
  }
});

test('sandboxed preload exposes only the scoped candidate interface', () => {
  const source = readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8');
  let bridge;
  runInNewContext(source, {
    process: { platform: 'win32', argv: ['--rw-full-bridge'], versions: {} },
    require: module => {
      assert.equal(module, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: { invoke: channel => channel }
      };
    }
  });
  assert.equal(bridge.full.enabled, true);
  assert.equal(bridge.full.search({}), 'full:search');
  assert.equal(bridge.full.codex.refresh({}), 'full:codex:refresh');
  assert.equal(bridge.full.codex.pending({}), 'full:codex:pending');
  assert.equal(bridge.full.codex.handoff({}), 'full:codex:handoff');
  assert.equal(bridge.full.codex.execute, undefined);
  assert.equal(bridge.full.codex.shell, undefined);
  assert.equal(bridge.full.openCitation, undefined);
  assert.equal(bridge.ragSearch, undefined);
  assert.equal(bridge.openPath, undefined);
  assert.equal(bridge.webview, false);
  assert.doesNotMatch(source, /require\(\s*['"](?!electron['"])/);
  assert.doesNotMatch(source, /\b(setImmediate|clearImmediate)\b/);
  assert.doesNotMatch(source, /\bBuffer\b/);
});
