'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MARKER = 'RESEARCH-WORKSPACE-PORTABLE.txt';
const { version: VERSION } = require('../package.json');
const MARKER_CONTENT = 'RESEARCH-WORKSPACE-FULL-' + VERSION;
const PORT = 17403;
const METADATA_ONLY_PROJECT = 'ae428f0f9a857d151ccb32517d77a3a4e78106d7cb021b8064866250be65c26d';
const READ_ONLY_PROJECT = '68df7416ee6f059dd6b7c0b07cc224775917d9dce92d8db40a7754dd372ba20a';
const READ_ONLY_WINDOWS_ROOT = 'fc2fbb1e2e7a0e602bb45a1fdd7a1f33a324c620a6430a9d29c7577f6e225702';
const PROTECTED_WINDOWS_ROOT = 'fdde8cf29c223e6481bc9e6ccf3ee44e2fa953775800c29caf9acf8efd91f743';
const SAFE_DOCUMENTS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.png', '.jpg', '.jpeg', '.webp']);
const SAFE_MATERIALS = new Set(['.scdoc', '.scdocx', '.step', '.stp', '.stl', '.iges', '.igs', '.x_t', '.x_b',
  '.opj', '.opju', '.lay', '.plt', '.szplt']);

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
  })) throw new Error('Portable release markers are missing or invalid');
  if (!samePath(directory, fs.realpathSync.native(directory))) throw new Error('Portable executable directory is redirected');
  const data = path.join(directory, 'portable-user-data');
  if (samePath(data, dailyDirectory) || inside(dailyDirectory, data)) throw new Error('Portable data overlaps existing application data');
  try { fs.mkdirSync(data); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!fs.lstatSync(data).isDirectory() || !samePath(data, fs.realpathSync.native(data))) {
    throw new Error('Portable user data is redirected');
  }
  for (const entry of fs.readdirSync(data, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Portable user data contains a redirected entry');
    if (entry.isFile() && fs.lstatSync(path.join(data, entry.name)).nlink !== 1) {
      throw new Error('Portable user data contains a linked file');
    }
  }
  return data;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function pathDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function underProtectedWindowsRoot(root, digest) {
  if (process.platform !== 'win32' || typeof root !== 'string' || !path.isAbsolute(root)) return false;
  let current = path.resolve(root);
  for (;;) {
    if (pathDigest(current.toLowerCase()) === digest) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function metadataOnly(projectId, root) {
  if (typeof projectId === 'string' && pathDigest(projectId) === METADATA_ONLY_PROJECT) return true;
  return underProtectedWindowsRoot(root, PROTECTED_WINDOWS_ROOT);
}

function protectedProjectWrite(projectId, root) {
  if (metadataOnly(projectId, root)) return true;
  if (typeof projectId === 'string' && pathDigest(projectId) === READ_ONLY_PROJECT) return true;
  return underProtectedWindowsRoot(root, READ_ONLY_WINDOWS_ROOT);
}

function safeDocument(root, relative, { allowIndexedOriginal = false, material = false, locateOnly = false } = {}) {
  if (typeof relative !== 'string' || !relative || relative.includes(':') || /[\x00-\x1f]/.test(relative)) return null;
  const segments = relative.split(/[\\/]/);
  if (segments.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) return null;
  const target = path.resolve(root, ...segments);
  const extension = path.extname(target).toLowerCase();
  if (!inside(root, target) || (!locateOnly && !SAFE_DOCUMENTS.has(extension) &&
    !(material && SAFE_MATERIALS.has(extension)))) return null;
  try {
    const real = fs.realpathSync.native(target);
    const stat = fs.statSync(real);
    return samePath(real, target) && stat.isFile() && stat.nlink === 1 &&
      (allowIndexedOriginal || !metadataOnly('', real)) ? real : null;
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
      return { ok: false, error: '本机数据文件是链接或不可用，未导入' };
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

module.exports = { MARKER, MARKER_CONTENT, VERSION, PORT, isolatedDirectory, metadataOnly, protectedProjectWrite, samePath, inside, safeDocument, atomicWrite, importWorkspace };
