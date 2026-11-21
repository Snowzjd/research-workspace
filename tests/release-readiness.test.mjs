import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url);
const api = require('../desktop/api-server.js');

test('release metadata pins Electron 45.4.1 and the Snowzjd MIT license', () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', root), 'utf8'));
  const desktop = JSON.parse(readFileSync(new URL('./desktop/package.json', root), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('./desktop/package-lock.json', root), 'utf8'));
  assert.equal(pkg.version, '4.0.0-rc.1');
  assert.equal(pkg.license, 'MIT');
  assert.equal(desktop.version, '4.0.0-rc.1');
  assert.equal(desktop.devDependencies.electron, '45.4.1');
  assert.equal(lock.packages['node_modules/electron'].version, '45.4.1');
  const license = readFileSync(new URL('./LICENSE', root), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Snowzjd/);
  assert.match(license, /Permission is hereby granted/);
  const notices = readFileSync(new URL('./THIRD-PARTY-NOTICES.md', root), 'utf8');
  assert.match(notices, /45\.4\.1/);
  assert.match(notices, /156\.0\.8078\.100/);
  assert.match(notices, /marked 15\.0\.12/);
  assert.match(notices, /DOMPurify 3\.3\.0/);
  assert.match(notices, /demo\.html/);
  const pack = readFileSync(new URL('./desktop/pack-full.mjs', root), 'utf8');
  assert.match(pack, /path\.join\(app, 'LICENSE'\)/);
  const apiSource = readFileSync(new URL('./desktop/api-server.js', root), 'utf8');
  assert.doesNotMatch(apiSource, /['"]3\.2\.1['"]/);
});

test('health and OpenAPI advertise 4.0.0-rc.1 without a renderer version', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rw-release-ver-'));
  try {
    const started = await api.start({ userDataDir: dir, port: 39221, strictPort: true, log() {} });
    assert.equal(started.ok, true);
    const health = await fetch('http://127.0.0.1:39221/api/health').then(response => response.json());
    assert.equal(health.version, '4.0.0-rc.1');
    api.setWindow({
      isDestroyed: () => false,
      webContents: { executeJavaScript: async () => ({ ok: true, tools: [] }) }
    });
    const spec = await fetch('http://127.0.0.1:39221/api/openapi.json', {
      headers: { Authorization: 'Bearer ' + started.token }
    }).then(response => response.json());
    assert.equal(spec.info.version, '4.0.0-rc.1');
  } finally {
    api.stop();
    api.setWindow(null);
    rmSync(dir, { recursive: true, force: true });
  }
});
