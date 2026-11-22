'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { atomicWrite, inside, samePath, MARKER, MARKER_CONTENT } = require('./full-product');
const { inspectPath } = require('./project-root');

const TARGET = '4.0.0';
const BACKUP = 'migration-backup.json';
const PENDING = 'pending-migration';
const MANIFEST = 'migration-plan.json';
const STATUS = 'migration-status.json';
const FILES = ['workspace-data.json', 'codex-executions.json', 'vault-config.json'];
const LIMITS = [32 * 1024 * 1024, 32 * 1024 * 1024, 16384];
const ID = /^[\w.-]{1,160}$/;
const TX = /^[0-9]{8}T[0-9]{9}Z-[0-9a-f-]{36}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function localDirectory(directory) {
  if (!path.isAbsolute(directory) || /^[\\/]{2}/.test(directory) ||
      samePath(directory, path.parse(directory).root)) {
    throw Error('请选择本机的数据文件夹');
  }
  const inspected = inspectPath(directory);
  if (!inspected.exists || inspected.hasReparseInPath || !samePath(directory, inspected.realPath) ||
      !fs.lstatSync(directory).isDirectory()) throw Error('数据文件夹不可用或经过重定向');
  return inspected.realPath;
}

function readFile(file, limit, optional = false) {
  const stat = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (!stat && optional) return null;
  if (!stat?.isFile() || stat.nlink !== 1n || stat.size > BigInt(limit) ||
      !samePath(file, fs.realpathSync.native(file))) throw Error('资料不可用、经过重定向或超出大小限制');
  const descriptor = fs.openSync(file, 'r');
  try {
    const matches = data => ['dev', 'ino', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => data[key] === stat[key]);
    if (!matches(fs.fstatSync(descriptor, { bigint: true }))) throw Error('资料在读取时发生变化');
    const bytes = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const size = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!size) throw Error('资料在读取时发生变化');
      offset += size;
    }
    if (!matches(fs.fstatSync(descriptor, { bigint: true }))) throw Error('资料在读取时发生变化');
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function json(bytes, clean = false) {
  const strip = /^(?:__proto__|constructor|prototype|__account|password|passphrase|secret|credentials?|accessToken|refreshToken|apiKey|token|auth|authorization|rootDir|structureCreated)$/i;
  try {
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''), clean
      ? (key, value) => strip.test(key) ? undefined : value
      : undefined);
  } catch (_) {
    throw Error('数据文件不是有效的 JSON');
  }
}

function transactionId() {
  return new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID();
}

function hash(bytes) {
  return bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
}

const asBytes = value => Buffer.from(JSON.stringify(value), 'utf8');
const digestList = files => Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)]));

function filesIn(directory) {
  return Object.fromEntries(FILES.map((name, index) => [name, readFile(path.join(directory, name), LIMITS[index], true)]));
}

function checkedFiles(directory, expected, exact = false) {
  if (!expected || Object.keys(expected).some(name => !FILES.includes(name)) ||
      (exact && Object.keys(expected).length !== FILES.length) ||
      Object.values(expected).some(digest => digest !== null && !DIGEST.test(digest))) {
    throw Error('备份或迁移清单无效');
  }
  const values = filesIn(directory);
  for (const [name, digest] of Object.entries(expected)) {
    if (hash(values[name]) !== digest) throw Error('备份或迁移资料校验失败');
  }
  return Object.fromEntries(Object.keys(expected).map(name => [name, values[name]]));
}

function validateWorkspace(bytes) {
  const value = json(bytes, true);
  if (!value || ![2, 3].includes(value.schemaVersion) || !Array.isArray(value.projects) || !Array.isArray(value.tasks)) {
    throw Error('工作台数据结构无效，或版本不受 4.0.0 支持');
  }
  for (const items of [value.projects, value.tasks]) {
    if (items.some(row => typeof row?.id !== 'string' || !row.id) ||
        new Set(items.map(row => row.id)).size !== items.length) throw Error('项目或任务 ID 无效或重复');
  }
  if (value.tasks.some(row => typeof row.p !== 'string')) throw Error('任务归属无效');
  return value;
}

function validateHistory(bytes) {
  const value = json(bytes, true);
  if (value?.version !== 1 || !Array.isArray(value.runs) ||
      value.runs.some(row => ![row?.sessionId, row?.projectId, row?.taskId].every(key => typeof key === 'string' && ID.test(key)) ||
        !Array.isArray(row.events) || !Array.isArray(row.files) || !Array.isArray(row.checks))) {
    throw Error('Codex 执行记录的格式或版本不兼容');
  }
  return value;
}

function portableVersion(directory) {
  const name = path.basename(directory);
  if (!['candidate-user-data', 'portable-user-data'].includes(name)) throw Error('请选择旧版程序旁的数据目录或本机迁移备份');
  const program = path.dirname(directory);
  const app = localDirectory(path.join(program, 'resources', 'app'));
  const metadata = json(readFile(path.join(app, 'package.json'), 16384));
  const candidate = name === 'candidate-user-data' && /^4\.0\.0-rc\.[123]$/.test(metadata?.version);
  const formal = name === 'portable-user-data' && metadata?.version === TARGET;
  if (metadata?.name !== 'research-workspace-desktop' || (!candidate && !formal)) {
    throw Error('无法确认源程序版本，或此版本不受迁移支持');
  }
  for (const folder of [program, app]) {
    const marker = readFile(path.join(folder, candidate ? 'FULL-CANDIDATE-PORTABLE.txt' : MARKER), 200);
    const expected = candidate ? 'RESEARCH-WORKSPACE-FULL-' + metadata.version : MARKER_CONTENT;
    if (marker.toString('utf8').trim() !== expected) throw Error('源程序标记不匹配');
  }
  return metadata.version;
}

function preview(target, selected, kind, validateVault) {
  const data = localDirectory(target);
  const source = kind === 'json' ? path.resolve(selected) : localDirectory(selected);
  let files;
  let version;
  let recovery = false;
  if (kind === 'json') {
    localDirectory(path.dirname(source));
    if (inside(data, source) || !/^workspace-data(?:[.-].+)?\.json$/i.test(path.basename(source))) {
      throw Error('请选择另一份工作台 JSON 文件');
    }
    files = { [FILES[0]]: readFile(source, LIMITS[0]) };
    version = '工作台 JSON';
  } else {
    if (samePath(data, source) || inside(source, data)) throw Error('请选择独立于当前工作台的旧数据');
    const backupFile = readFile(path.join(source, BACKUP), 16384, true);
    if (backupFile) {
      const snapshot = json(backupFile);
      if (snapshot?.format !== 1 || snapshot.appVersion !== TARGET) throw Error('迁移备份版本不兼容');
      files = checkedFiles(source, snapshot.files, true);
      recovery = true;
      version = TARGET + ' 本机备份';
    } else {
      if (inside(data, source)) throw Error('请选择其他版本的程序数据目录');
      version = portableVersion(source);
      files = filesIn(source);
    }
  }

  const sourceDigest = digestList(files);
  const workspace = files[FILES[0]] === null && recovery ? null : validateWorkspace(files[FILES[0]]);
  const history = files[FILES[1]] ? validateHistory(files[FILES[1]]) : null;
  const warnings = [];
  if (!recovery) {
    files[FILES[0]] = asBytes(workspace);
    if (history) files[FILES[1]] = asBytes(history);
    if (files[FILES[2]]) {
      const vault = validateVault(json(files[FILES[2]])?.vaultRoot);
      if (!vault) warnings.push('旧 Vault 路径当前不可用，请迁移后重新选择目录。');
      files[FILES[2]] = vault ? asBytes({ vaultRoot: vault }) : null;
    }
  }
  return {
    source, version, sourceDigest, files, warnings,
    projects: workspace?.projects.length || 0, tasks: workspace?.tasks.length || 0, runs: history?.runs.length || 0
  };
}

function backupRoot(data) {
  const root = path.join(data, 'migration-backups');
  try { fs.mkdirSync(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return localDirectory(root);
}

function captureBackup(target) {
  const data = localDirectory(target);
  const files = filesIn(data);
  const root = backupRoot(data);
  const id = transactionId();
  const staging = path.join(root, '.writing-' + id);
  fs.mkdirSync(staging);
  for (const [name, bytes] of Object.entries(files)) {
    if (bytes !== null) atomicWrite(path.join(staging, name), bytes);
  }
  atomicWrite(path.join(staging, BACKUP), asBytes({ format: 1, appVersion: TARGET, files: digestList(files) }));
  const directory = path.join(root, id);
  fs.renameSync(staging, directory);
  return { id, directory };
}

function stage(target, plan) {
  const data = localDirectory(target);
  const queue = path.join(data, PENDING);
  if (fs.lstatSync(queue, { throwIfNoEntry: false })) throw Error('已有待执行的迁移，请先退出并重新打开工作台');
  const id = transactionId();
  const preparing = path.join(backupRoot(data), '.preparing-' + id);
  fs.mkdirSync(preparing);
  for (const [name, bytes] of Object.entries(plan.files)) {
    if (!FILES.includes(name)) throw Error('迁移文件名无效');
    if (bytes !== null) atomicWrite(path.join(preparing, name), bytes);
  }
  atomicWrite(path.join(preparing, MANIFEST), asBytes({
    id, targetVersion: TARGET, phase: 'queued', sourceVersion: plan.version, files: digestList(plan.files)
  }));
  fs.renameSync(preparing, queue);
  return { ok: true, restartRequired: true };
}

function installFiles(data, files) {
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(data, name);
    const old = readFile(file, LIMITS[FILES.indexOf(name)], true);
    if (bytes !== null) atomicWrite(file, bytes);
    else if (old !== null) fs.unlinkSync(file);
  }
}

function readStatus(data) {
  try {
    const pending = fs.lstatSync(path.join(data, PENDING), { throwIfNoEntry: false });
    const bytes = readFile(path.join(data, STATUS), 16384, true);
    return { ok: true, pending: Boolean(pending), last: bytes ? json(bytes) : null };
  } catch (_) {
    return { ok: false, error: '无法读取迁移状态' };
  }
}

function applyBeforeStartup(target) {
  const data = localDirectory(target);
  let queue = path.join(data, PENDING);
  if (!fs.lstatSync(queue, { throwIfNoEntry: false })) return;
  queue = localDirectory(queue);
  const journal = path.join(queue, MANIFEST);
  const plan = json(readFile(journal, 16384));
  if (plan.targetVersion !== TARGET || !TX.test(plan.id) ||
      !['queued', 'applying', 'complete', 'rolled_back', 'failed'].includes(plan.phase)) {
    throw Error('待执行的迁移记录无效，请保留数据目录和备份');
  }
  const mark = phase => {
    plan.phase = phase;
    atomicWrite(journal, asBytes(plan));
  };
  const restore = () => {
    if (!TX.test(plan.backup || '')) throw Error('找不到迁移失败前的备份');
    const dir = localDirectory(path.join(backupRoot(data), plan.backup));
    const prior = json(readFile(path.join(dir, BACKUP), 16384));
    if (prior.format !== 1 || prior.appVersion !== TARGET) throw Error('迁移失败前的备份版本无效');
    installFiles(data, checkedFiles(dir, prior.files, true));
    mark('rolled_back');
  };
  if (plan.phase === 'applying') restore();
  if (plan.phase === 'queued') {
    let files;
    try {
      files = checkedFiles(queue, plan.files);
      if (!(FILES[0] in files)) throw Error('缺少工作台迁移数据');
      plan.backup = captureBackup(data).id;
    } catch (_) {
      mark('failed');
    }
    if (files && plan.phase === 'queued') {
      mark('applying');
      try {
        installFiles(data, files);
        mark('complete');
      } catch (_) {
        restore();
      }
    }
  }
  atomicWrite(path.join(data, STATUS), asBytes({
    phase: plan.phase, backup: plan.backup || '', sourceVersion: plan.sourceVersion
  }));
  fs.renameSync(queue, path.join(backupRoot(data), plan.id + '-operation'));
}

module.exports = { preview, stage, captureBackup, readStatus, applyBeforeStartup };
