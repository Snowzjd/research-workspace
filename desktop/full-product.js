'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MARKER = 'FULL-CANDIDATE-PORTABLE.txt';
const { version: VERSION } = require('../package.json');
const MARKER_CONTENT = 'RESEARCH-WORKSPACE-FULL-' + VERSION;
const PORT = 17400;
const TPMS_ID = 'd72165400fae48eb9466e8151cdd15e3';
const PROTECTED_WINDOWS_ROOT = 'fdde8cf29c223e6481bc9e6ccf3ee44e2fa953775800c29caf9acf8efd91f743';
const SAFE_DOCUMENTS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.png', '.jpg', '.jpeg', '.webp']);

function samePath(a, b) {
  const normalize = p => process.platform === 'win32'
    ? path.resolve(p).toLowerCase() : path.resolve(p);
  return normalize(a) === normalize(b);
}

function isolatedDirectory(executable, appRoot, dailyDirectory) {
  const directory = path.dirname(executable);
  if (![directory, appRoot].every(root => {
    const candidate = path.join(root, MARKER);
    try {
      return fs.lstatSync(candidate).isFile() && fs.readFileSync(candidate, 'utf8').trim() === MARKER_CONTENT;
    } catch (_) { return false; }
  })) throw new Error('Full candidate markers are missing or invalid');
  if (!samePath(directory, fs.realpathSync.native(directory))) throw new Error('Candidate executable directory is redirected');
  const data = path.join(directory, 'candidate-user-data');
  if (samePath(data, dailyDirectory) || inside(dailyDirectory, data)) throw new Error('Candidate data overlaps daily data');
  try { fs.mkdirSync(data); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!fs.lstatSync(data).isDirectory() || !samePath(data, fs.realpathSync.native(data))) {
    throw new Error('Candidate user data is redirected');
  }
  for (const entry of fs.readdirSync(data, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Candidate user data contains a redirected entry');
    if (entry.isFile() && fs.lstatSync(path.join(data, entry.name)).nlink !== 1) {
      throw new Error('Candidate user data contains a linked file');
    }
  }
  return data;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function metadataOnly(projectId, root) {
  if (projectId === TPMS_ID) return true;
  if (process.platform !== 'win32' || typeof root !== 'string' || !path.isAbsolute(root)) return false;
  let current = path.resolve(root);
  for (;;) {
    if (crypto.createHash('sha256').update(current.toLowerCase()).digest('hex') === PROTECTED_WINDOWS_ROOT) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function safeDocument(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes(':') || /[\x00-\x1f]/.test(relative)) return null;
  const segments = relative.split(/[\\/]/);
  if (segments.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) return null;
  const target = path.resolve(root, ...segments);
  if (!inside(root, target) || !SAFE_DOCUMENTS.has(path.extname(target).toLowerCase())) return null;
  try {
    const real = fs.realpathSync.native(target);
    const stat = fs.statSync(real);
    return samePath(real, target) && stat.isFile() && stat.nlink === 1 && !metadataOnly('', real) ? real : null;
  } catch (_) { return null; }
}

function atomicWrite(file, bytes) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function importWorkspace(file, destination) {
  if (samePath(file, destination)) return { ok: false, error: '请选择另一份工作台数据文件' };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024 || !samePath(file, fs.realpathSync.native(file))) {
    return { ok: false, error: '数据文件不可用或超过 32 MB' };
  }
  if (!/^workspace-data(?:[.-].+)?\.json$/i.test(path.basename(file))) {
    return { ok: false, error: '请选择 workspace-data.json 或其工作台备份' };
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw.replace(/^\uFEFF/, ''), (key, value) =>
    /^(?:__proto__|constructor|prototype|password|passphrase|secret|credentials?|accessToken|refreshToken|apiKey|token|auth|authorization|rootDir|structureCreated)$/i.test(key)
      ? undefined : value);
  if (!data || !Array.isArray(data.projects) || !Array.isArray(data.tasks) ||
      !data.projects.every(project => typeof project?.id === 'string' && project.id) ||
      !data.tasks.every(task => typeof task?.p === 'string')) {
    return { ok: false, error: '工作台项目或任务结构无效' };
  }
  if (new Set(data.projects.map(project => project.id)).size !== data.projects.length) {
    return { ok: false, error: '项目 ID 重复' };
  }
  let backedUp = false;
  const prior = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (prior) {
    if (!prior.isFile() || prior.nlink !== 1 || !samePath(destination, fs.realpathSync.native(destination))) {
      return { ok: false, error: '候选数据文件是链接或不可用，未导入' };
    }
    const backupDir = path.join(path.dirname(destination), 'migration-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    if (!samePath(backupDir, fs.realpathSync.native(backupDir))) throw new Error('Migration backup directory is redirected');
    atomicWrite(path.join(backupDir, 'workspace-data.' + Date.now() + '-' + crypto.randomUUID() + '.json'), fs.readFileSync(destination));
    backedUp = true;
  }
  atomicWrite(destination, JSON.stringify(data));
  return { ok: true, backedUp, projects: data.projects.length, tasks: data.tasks.length };
}

module.exports = { MARKER, MARKER_CONTENT, VERSION, PORT, isolatedDirectory, metadataOnly, samePath, inside, safeDocument, atomicWrite, importWorkspace };
