/**
 * 项目根解析：包装目录、junction、真实根；禁止把 junction 当 RPM 根，禁止猜测子目录。
 * 运行：node --test tests/project-root.test.mjs
 * 仅使用隔离临时目录中的合成 junction，不触碰真实课题盘。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  normalizePath, pathsEqual, isReparsePoint, inspectPath, resolveProjectRoot
} = require('../desktop/project-root.js');

let base = '';
let realRoot = '';
let skillRoot = '';
let otherRoot = '';
let wrapper = '';
let mainJunction = '';
let skillJunction = '';
let otherJunction = '';
let workspace = '';

function joinJ(dest, src) {
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', dest, src], { windowsHide: true, stdio: 'pipe' });
}

function rmdirJunction(p) {
  try { execFileSync('cmd.exe', ['/c', 'rmdir', p], { windowsHide: true, stdio: 'pipe' }); } catch (_) {}
}

before(() => {
  base = mkdtempSync(path.join(tmpdir(), 'rw-rpm-root-'));
  realRoot = path.join(base, 'real-root');
  skillRoot = path.join(base, 'skill-root');
  otherRoot = path.join(base, 'other-root');
  workspace = path.join(base, 'workspace');
  wrapper = path.join(workspace, 'WRAPPER');
  mkdirSync(realRoot, { recursive: true });
  mkdirSync(skillRoot, { recursive: true });
  mkdirSync(otherRoot, { recursive: true });
  mkdirSync(wrapper, { recursive: true });
  writeFileSync(path.join(realRoot, 'README.md'), 'isolated-real-root\n');
  writeFileSync(path.join(skillRoot, 'SKILL.md'), 'unrelated-skill\n');
  writeFileSync(path.join(otherRoot, 'note.md'), 'other-project\n');
  mainJunction = path.join(wrapper, 'main');
  skillJunction = path.join(wrapper, 'skill-dir');
  otherJunction = path.join(workspace, 'OTHER');
  joinJ(mainJunction, realRoot);
  joinJ(skillJunction, skillRoot);
  joinJ(otherJunction, otherRoot);
});

after(() => {
  rmdirJunction(mainJunction);
  rmdirJunction(skillJunction);
  rmdirJunction(otherJunction);
  try { rmSync(base, { recursive: true, force: true }); } catch (_) {}
});

test('detects Windows junctions on the synthetic main link', () => {
  assert.equal(existsSync(mainJunction), true);
  assert.equal(isReparsePoint(mainJunction), true);
  assert.equal(isReparsePoint(wrapper), false);
  const inspected = inspectPath(mainJunction);
  assert.equal(inspected.leafIsReparse, true);
  assert.equal(inspected.hasReparseInPath, true);
  assert.equal(pathsEqual(inspected.realPath, realRoot), true);
});

test('does not treat the wrapper directory as the RPM root or guess child junctions', () => {
  const project = { id: 'pjstage2wrap', folder: 'WRAPPER', name: 'wrapper' };
  const resolved = resolveProjectRoot({
    project,
    rootDir: workspace,
    bindings: {},
    listRegistry: { abcdef0123456789abcdef0123456789: realRoot }
  });
  assert.equal(resolved.guessed, false);
  assert.equal(resolved.rpmBound, false);
  assert.equal(pathsEqual(resolved.resolvedRoot, wrapper), true);
  assert.equal(pathsEqual(resolved.resolvedRoot, realRoot), false);
  assert.equal(pathsEqual(resolved.resolvedRoot, mainJunction), false);
  assert.equal(resolved.code, 'unbound');
  assert.match(String(resolved.note), /子目录|尚未接入/);
});

test('refuses a binding that points at the wrapper or at the main junction', () => {
  const project = { id: 'pjstage2wrap', folder: 'WRAPPER' };
  for (const badRoot of [wrapper, mainJunction]) {
    const resolved = resolveProjectRoot({
      project,
      rootDir: workspace,
      bindings: { pjstage2wrap: { rpmProjectId: 'abcdef0123456789abcdef0123456789', rpmRoot: badRoot } },
      listRegistry: { abcdef0123456789abcdef0123456789: realRoot }
    });
    assert.equal(resolved.conflict, true, 'bad root ' + badRoot + ' ' + resolved.code + ' ' + resolved.error);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.rpmBound, false);
    assert.equal(resolved.code, 'binding_conflict');
    assert.equal(pathsEqual(resolved.resolvedRoot, realRoot), true);
    assert.match(String(resolved.note), /登记根|真实根/);
  }
});

test('expands a first-level project folder that is itself a junction', () => {
  const project = { id: 'pjstage2other', folder: 'OTHER' };
  const resolved = resolveProjectRoot({
    project,
    rootDir: workspace,
    bindings: {},
    listRegistry: { 11111111111111111111111111111111: otherRoot }
  });
  assert.equal(resolved.rpmBound, true);
  assert.equal(pathsEqual(resolved.resolvedRoot, otherRoot), true);
  assert.equal(pathsEqual(resolved.resolvedRoot, otherJunction), false);
});

test('accepts an explicit binding to the real, junction-free root', () => {
  const project = { id: 'pjstage2wrap', folder: 'WRAPPER' };
  const resolved = resolveProjectRoot({
    project,
    rootDir: workspace,
    bindings: { pjstage2wrap: { rpmProjectId: 'abcdef0123456789abcdef0123456789', rpmRoot: realRoot } },
    listRegistry: { abcdef0123456789abcdef0123456789: realRoot }
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.rpmBound, true);
  assert.equal(resolved.conflict, false);
  assert.equal(pathsEqual(resolved.resolvedRoot, realRoot), true);
  assert.equal(resolved.rpmProjectId, 'abcdef0123456789abcdef0123456789');
});

test('normalizePath is case-insensitive on Windows drive letters', () => {
  if (process.platform !== 'win32') return;
  const a = normalizePath('C:\\Windows');
  const b = normalizePath('c:/windows');
  assert.equal(pathsEqual(a, b), true);
});
