'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const adapter = require('./rpm-adapter');
const { safeDocument, samePath } = require('./full-product');
const { inspectPath } = require('./project-root');

const execute = promisify(execFile);
const idPattern = /^[a-f0-9]{32}$/;
const caches = new Map();
const MAX_INDEX = 32 * 1024 * 1024;

function csvRows(text) {
  const rows = [];
  const token = /(?:^|,|\r?\n)("(?:[^"]|"")*"|[^",\r\n]*)/g;
  let row = [];
  let offset = 0;
  for (const match of text.replace(/^\uFEFF/, '').matchAll(token)) {
    if (match.index !== offset) throw new Error('index CSV');
    offset += match[0].length;
    if (match[0].startsWith('\n') || match[0].startsWith('\r')) {
      rows.push(row);
      row = [];
    }
    const cell = match[1];
    row.push(cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell);
  }
  if (offset !== text.replace(/^\uFEFF/, '').length) throw new Error('index CSV ending');
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function artifactIndex(scope) {
  if (!idPattern.test(scope.rpmProjectId || '')) return null;
  const file = path.join(scope.root, '00_Project_Management', 'FILE_INDEX.csv');
  try {
    const checked = inspectPath(file);
    if (!checked.exists || checked.hasReparseInPath || !samePath(file, checked.realPath)) return null;
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(MAX_INDEX)) return null;
    const stamp = [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.dev].join(':');
    const saved = caches.get(file);
    if (saved?.stamp === stamp) return saved.entries;
    const fd = fs.openSync(file, 'r');
    let rows;
    try {
      const actual = fs.fstatSync(fd, { bigint: true });
      if (actual.ino !== stat.ino || actual.dev !== stat.dev || actual.nlink !== 1n || !actual.isFile() ||
          actual.size !== stat.size || actual.mtimeNs !== stat.mtimeNs) return null;
      rows = csvRows(fs.readFileSync(fd, 'utf8'));
      const after = fs.fstatSync(fd, { bigint: true });
      if (actual.mtimeNs !== after.mtimeNs || actual.ctimeNs !== after.ctimeNs || actual.size !== after.size) return null;
    } finally { fs.closeSync(fd); }
    const header = rows.shift();
    const keys = ['file_id', 'relative_path', 'presence'].map(k => header?.indexOf(k) ?? -1);
    if (keys.includes(-1)) return null;
    const entries = new Map();
    for (const row of rows) {
      if (row.length !== header.length || !idPattern.test(row[keys[0]]) || !row[keys[1]]) return null;
      const key = pathKey(row[keys[1]]);
      if (entries.has(key)) return null;
      entries.set(key, { fileId: row[keys[0]], present: row[keys[2]] === 'present' });
    }
    if (caches.size >= 16) caches.delete(caches.keys().next().value);
    caches.set(file, { stamp, entries });
    return entries;
  } catch (_) { return null; }
}

const pathKey = p => process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p;

function verifyFile(scope, relative, locateOnly) {
  return safeDocument(scope.root, relative, { allowIndexedOriginal: true, material: true, locateOnly });
}

async function registerRpmArtifact(scope, relative, config) {
  try {
    const script = fs.realpathSync.native(adapter.resolveScript(config));
    const skill = path.dirname(path.dirname(script));
    if (!adapter.isTrustedRpmCli(script) || path.basename(skill) !== 'research-project-manager') {
      return { ok: false, code: 'rpm_unavailable', error: '无法核对 RPM 安装' };
    }
    const python = fs.realpathSync.native(adapter.resolvePython(config));
    const settings = adapter.resolveSettings(config);
    if (!settings || !fs.statSync(python).isFile() || /^[\\/]{2}/.test(python)) throw new Error('RPM settings');
    const helper = path.join(__dirname, '..', 'rpm-integration', 'rpm_codex_artifact.py');
    const { stdout } = await execute(python, ['-X', 'utf8', '-B', helper, '--skill-root', skill, '--settings', settings,
      '--root', scope.root, '--project-id', scope.rpmProjectId, '--file', relative],
    { cwd: path.dirname(helper), shell: false, windowsHide: true, timeout: 30000, maxBuffer: 128 * 1024, encoding: 'utf8' });
    const result = JSON.parse(stdout);
    if (!result?.ok || !idPattern.test(result.fileId || '')) return {
      ok: false, code: 'rpm_registration_failed', error: typeof result?.error === 'string' ? result.error.slice(0, 250) : 'RPM 未确认登记，请核对文件后重试'
    };
    caches.clear();
    adapter.clearCache();
    return { ok: true, fileId: result.fileId };
  } catch (_) {
    return { ok: false, code: 'rpm_registration_failed', error: '登记暂未完成。请确认 RPM 和项目目录可访问后重试' };
  }
}

module.exports = { artifactIndex, pathKey, verifyFile, registerRpmArtifact };
