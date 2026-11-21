import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyElectronDistribution, verifyRuntimeFiles, runtimeFiles } from '../desktop/electron-runtime.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-electron-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'locales'), { recursive: true });
  for (const file of runtimeFiles) fs.writeFileSync(path.join(dist, file), 'fixture');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"45.4.1"}');
  fs.writeFileSync(path.join(dist, 'version'), '45.4.1');
  const pe = Buffer.alloc(70);
  pe.write('MZ');
  pe.writeUInt32LE(64, 60);
  pe.writeUInt32LE(0x4550, 64);
  pe.writeUInt16LE(0x8664, 68);
  fs.writeFileSync(path.join(dist, 'electron.exe'), pe);
  return { root, dist, pe };
}

test('packaging rejects a missing GPU runtime despite a matching executable and version', t => {
  const { root, dist } = fixture(t);
  assert.equal(runtimeFiles.includes('libEGL.dll'), false);
  assert.equal(runtimeFiles.includes('libGLESv2.dll'), false);
  assert.equal(verifyElectronDistribution(root, '45.4.1', '45.4.1'), dist);
  fs.unlinkSync(path.join(dist, 'vk_swiftshader.dll'));
  assert.throws(() => verifyElectronDistribution(root, '45.4.1', '45.4.1'), /vk_swiftshader\.dll/);
});

test('packaging rejects wrong version locks and non-x64 staged binaries', t => {
  const { root, dist, pe } = fixture(t);
  assert.throws(() => verifyElectronDistribution(root, '45.4.1', '45.4.2'), /versions must match/);
  pe.writeUInt16LE(0xaa64, 68);
  fs.writeFileSync(path.join(dist, 'ResearchWorkspace.exe'), pe);
  assert.throws(() => verifyRuntimeFiles(dist, 'ResearchWorkspace.exe'), /Windows x64/);
});
