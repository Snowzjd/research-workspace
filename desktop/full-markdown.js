'use strict';

const fs = require('node:fs');
const io = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { metadataOnly } = require('./full-product');

const MAX_BYTES = 2 * 1024 * 1024;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const EXT = /\.(?:md|markdown)$/i;
const PROTECTED = /^(?:00_Project_Management|node_modules|rag[_-]?snowz|device|credentials?|secrets?|auth|tasks)(?:\.[^/]+)?$/i;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i;
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, publicMessage: message, ...extra });
}

function resultError(error) {
  const code = error.publicMessage ? error.code : ({
    ENOENT: 'not_found', ENOTDIR: 'not_found', EACCES: 'access_denied', EPERM: 'access_denied',
    ELOOP: 'unsafe_path', EBUSY: 'busy'
  }[error.code] || 'io_error');
  return { ok: false, code, message: error.publicMessage || ({
    not_found: '原始文件或目录不存在', access_denied: '无法访问该文件或目录',
    unsafe_path: '链接路径已被拒绝', busy: '文件正在被其他程序占用'
  }[code] || 'Markdown 文件操作失败'), ...(error.revision ? { revision: error.revision } : {}) };
}

function safeSegment(name) {
  return Boolean(name) && !name.startsWith('.') && !/[<>:"|?*\x00-\x1f]|[ .]$/.test(name)
    && !PROTECTED.test(name) && !RESERVED.test(name);
}

function segments(input, directory = false) {
  if (directory && (input == null || input === '')) return [];
  if (typeof input !== 'string' || input.length > 1024 || (!directory && !EXT.test(input))) {
    throw failure('invalid_path', '请选择根目录内的 Markdown 文件');
  }
  const parts = input.split(/[\\/]/);
  if (parts.length > 40 || !parts.every(safeSegment)) {
    throw failure('unsafe_path', '该路径超出 Markdown 工作区许可范围');
  }
  return parts;
}

function pathKey(name) {
  return process.platform === 'win32' ? name.toLowerCase() : name;
}

function isSamePath(left, right) {
  return pathKey(path.normalize(left)) === pathKey(path.normalize(right));
}

async function pathInfo(target, directory) {
  const stat = await io.lstat(target, { bigint: true });
  if (stat.isSymbolicLink() || !isSamePath(await io.realpath(target), target)) {
    throw failure('unsafe_path', '符号链接、目录联接或路径别名已被拒绝');
  }
  if (directory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1n)) {
    throw failure('unsafe_path', '该路径不是可访问的常规文件或目录');
  }
  return stat;
}

async function checkedRoot(candidate, create = false) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw failure('unconnected', 'Markdown 工作区尚未连接');
  }
  const root = path.resolve(candidate);
  const volume = path.parse(root).root;
  if (isSamePath(volume, root)) throw failure('unsafe_path', '不能将整个磁盘设为 Markdown 根目录');
  let current = volume;
  for (const part of path.relative(volume, root).split(path.sep)) {
    current = path.join(current, part);
    if (create) {
      try { await io.mkdir(current); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await pathInfo(current, true);
  }
  return root;
}

function sameStat(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function conflict(revision) {
  return failure('conflict', '原始文件已变化，请重新读取后合并或恢复版本', { revision });
}

function decode(bytes) {
  const bom = bytes.subarray(0, BOM.length).equals(BOM);
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(BOM.length) : bytes); }
  catch (_) { throw failure('invalid_encoding', '原始文件不是有效 UTF-8'); }
  if (raw.includes('\0')) throw failure('invalid_encoding', '原始文件包含二进制内容');
  const endings = raw.match(/\r\n|\r|\n/g) || [];
  const counts = new Map();
  for (const ending of endings) counts.set(ending, (counts.get(ending) || 0) + 1);
  const preferred = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '\n';
  return { bom, endings, preferred, text: raw.replace(/\r\n|\r/g, '\n'),
    newline: counts.size > 1 ? 'mixed' : ({ '\r\n': 'CRLF', '\r': 'CR', '\n': 'LF' }[preferred]) };
}

function encode(text, previous) {
  if (typeof text !== 'string' || text.length > MAX_BYTES || text.includes('\0')) {
    throw failure('cannot_save', '编辑内容超过大小上限或包含空字符');
  }
  const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
  const oldLines = previous.text.split('\n');
  let prefix = 0;
  let suffix = 0;
  while (prefix < Math.min(lines.length, oldLines.length) && lines[prefix] === oldLines[prefix]) prefix++;
  while (suffix < Math.min(lines.length, oldLines.length) - prefix
    && lines[lines.length - 1 - suffix] === oldLines[oldLines.length - 1 - suffix]) suffix++;
  const newMiddleLength = lines.length - prefix - suffix;
  const oldMiddleLength = oldLines.length - prefix - suffix;
  const content = lines.map((line, index) => {
    if (index === lines.length - 1) return line;
    const i = index < prefix ? index : (index >= lines.length - suffix
      ? index + oldLines.length - lines.length
      : (newMiddleLength === oldMiddleLength ? index : -1));
    return line + (previous.endings[i] || previous.preferred);
  }).join('');
  const bytes = Buffer.from((previous.bom ? '\uFEFF' : '') + content, 'utf8');
  if (bytes.length > MAX_BYTES) throw failure('cannot_save', '编辑内容超过大小上限');
  return bytes;
}

async function readFileRecord(target, checkPath) {
  const initial = await checkPath();
  if (initial.size > BigInt(MAX_BYTES)) throw failure('too_large', 'Markdown 文件超过 2 MiB 上限');
  const handle = await io.open(target, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    if (!sameStat(initial, await handle.stat({ bigint: true })) || !sameStat(initial, await checkPath())) {
      throw conflict();
    }
    const bytes = Buffer.alloc(Number(initial.size) + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== Number(initial.size) || !sameStat(initial, await handle.stat({ bigint: true }))
      || !sameStat(initial, await checkPath())) throw conflict();
    const exact = bytes.subarray(0, total);
    const revision = digest([pathKey(target), initial.dev, initial.ino, initial.mtimeNs, initial.ctimeNs, digest(exact)].join('\0'));
    return { bytes: exact, revision, mode: Number(initial.mode & 0o777n) };
  } finally {
    await handle.close();
  }
}

async function writeNew(target, bytes, mode, preserveMode = false) {
  const handle = await io.open(target, 'wx', mode);
  try {
    await checkedRoot(path.dirname(target));
    if (!sameStat(await handle.stat({ bigint: true }), await pathInfo(target, false))) {
      throw failure('unsafe_path', '临时文件路径已变化');
    }
    await handle.writeFile(bytes);
    if (preserveMode && process.platform !== 'win32') await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function createMarkdownService({ vaultRoot, resolveProject, backupDir, onChange, pollIntervalMs = 1400 } = {}) {
  const locks = new Map();
  const watchers = new Map();
  let closed = false;

  async function rootFor(projectId) {
    if (projectId != null && (typeof projectId !== 'string' || projectId.length > 128)) {
      throw failure('invalid_project', '项目标识无效');
    }
    const config = projectId ? await resolveProject?.(projectId) : { root: vaultRoot };
    if (config?.metadataOnly) throw failure('metadata_only', '该项目仅连接了只读文件元数据');
    const root = await checkedRoot(config?.root);
    if (metadataOnly('', root)) {
      throw failure('metadata_only', '该项目仅连接了只读文件元数据');
    }
    return { root, projectId: projectId || null, readOnly: Boolean(config.readOnly) };
  }

  async function targetFor(payload) {
    const parts = segments(payload.path);
    const scope = await rootFor(payload.projectId);
    const target = path.join(scope.root, ...parts);
    if (metadataOnly('', target)) throw failure('metadata_only', '该目录仅连接只读元数据');
    async function check() {
      await checkedRoot(scope.root);
      let current = scope.root;
      for (const part of parts.slice(0, -1)) {
        current = path.join(current, part);
        await pathInfo(current, true);
      }
      return pathInfo(target, false);
    }
    return { ...scope, target, relative: parts.join('/'), check };
  }

  function document(target, file) {
    const { text, bom, newline } = decode(file.bytes);
    return { ok: true, projectId: target.projectId, path: target.relative, text, bom, newline,
      revision: file.revision, readOnly: target.readOnly };
  }

  async function list(payload) {
    const parts = segments(payload.directory, true);
    const scope = await rootFor(payload.projectId);
    const query = typeof payload.query === 'string' ? payload.query.trim().toLowerCase().slice(0, 120) : '';
    const limit = Number.isInteger(payload.limit) ? Math.min(1500, Math.max(1, payload.limit)) : 500;
    let directory = scope.root;
    for (const part of parts) {
      directory = path.join(directory, part);
      await pathInfo(directory, true);
    }
    const files = [];
    const pending = [{ absolute: directory, parent: parts }];
    let visited = 0;
    while (pending.length && visited < 1800 && files.length <= limit) {
      const { absolute, parent } = pending.pop();
      visited++;
      let entries;
      try {
        await pathInfo(absolute, true);
        entries = await io.readdir(absolute, { withFileTypes: true });
      } catch (error) {
        if (absolute === directory) throw error;
        continue;
      }
      const dirs = [];
      entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      for (const entry of entries) {
        if (!safeSegment(entry.name)) continue;
        // Even a broad registered root must not traverse the protected project.
        const child = path.join(absolute, entry.name);
        if (metadataOnly('', child)) continue;
        const next = [...parent, entry.name];
        if (entry.isDirectory() && next.length < 40) {
          dirs.push({ absolute: child, parent: next });
        } else if (entry.isFile() && EXT.test(entry.name)) {
          const relative = next.join('/');
          if (!query || relative.toLowerCase().includes(query)) files.push({ path: relative, name: entry.name });
          if (files.length > limit) break;
        }
      }
      pending.push(...dirs.reverse());
    }
    return { ok: true, projectId: scope.projectId, readOnly: scope.readOnly,
      files: files.slice(0, limit), truncated: files.length > limit || pending.length > 0 };
  }

  async function read(payload) {
    const target = await targetFor(payload);
    return document(target, await readFileRecord(target.target, target.check));
  }

  async function versionDirectory(target, create) {
    const base = await checkedRoot(backupDir, create);
    const directory = path.join(base, digest(pathKey(target.target)));
    if (create) {
      try { await io.mkdir(directory); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await pathInfo(directory, true);
    return directory;
  }

  async function versions(payload) {
    const target = await targetFor(payload);
    await target.check();
    let directory;
    try { directory = await versionDirectory(target, false); }
    catch (error) {
      if (error.code === 'ENOENT') return { ok: true, versions: [] };
      throw error;
    }
    const entries = await io.readdir(directory, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || !UUID.test(entry.name)) continue;
      const stat = await pathInfo(path.join(directory, entry.name), false);
      items.push({ versionId: entry.name, mtime: stat.mtime.toISOString(), size: Number(stat.size) });
    }
    items.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { ok: true, versions: items };
  }

  async function mutate(payload, restoring) {
    const target = await targetFor(payload);
    if (target.readOnly) throw failure('read_only', '该原始文件位于只读项目');
    const key = pathKey(target.target);
    if (locks.has(key)) throw failure('busy', '该文件已有正在进行的保存');
    locks.set(key, true);
    let temporary;
    try {
      const before = await readFileRecord(target.target, target.check);
      if (payload.revision !== before.revision) throw conflict(before.revision);
      const previous = decode(before.bytes);
      let bytes;
      if (restoring) {
        if (typeof payload.versionId !== 'string' || !UUID.test(payload.versionId)) {
          throw failure('invalid_version', '版本标识无效');
        }
        const directory = await versionDirectory(target, false);
        const filename = path.join(directory, payload.versionId);
        const saved = await readFileRecord(filename, async () => {
          await checkedRoot(directory);
          return pathInfo(filename, false);
        });
        decode(saved.bytes);
        bytes = saved.bytes;
      } else {
        bytes = encode(payload.text, previous);
      }
      if (bytes.equals(before.bytes)) return document(target, before);
      const directory = await versionDirectory(target, true);
      const backupVersionId = randomUUID();
      await writeNew(path.join(directory, backupVersionId), before.bytes, 0o600);
      await target.check();
      temporary = path.join(path.dirname(target.target), '.rw-markdown-' + randomUUID() + '.tmp');
      await writeNew(temporary, bytes, before.mode, true);
      const latest = await readFileRecord(target.target, target.check);
      if (latest.revision !== before.revision) throw conflict(latest.revision);
      await io.rename(temporary, target.target);
      temporary = null;
      const saved = await readFileRecord(target.target, target.check);
      if (!saved.bytes.equals(bytes)) throw conflict(saved.revision);
      return { ...document(target, saved), backupVersionId };
    } finally {
      if (temporary) {
        try {
          await checkedRoot(path.dirname(temporary));
          await io.unlink(temporary);
        } catch (_) { /* A concurrent move can make the temporary file unreachable here. */ }
      }
      locks.delete(key);
    }
  }

  const watchKey = (projectId, relative) => JSON.stringify([projectId || null, pathKey(relative)]);
  async function watch(payload) {
    if (closed) throw failure('watch_closed', 'Markdown 监听已关闭');
    const target = await targetFor(payload);
    const key = watchKey(target.projectId, target.relative);
    const initial = await readFileRecord(target.target, target.check);
    if (closed) throw failure('watch_closed', 'Markdown 监听已关闭');
    const existing = watchers.get(key);
    if (!existing && watchers.size >= 8) throw failure('watch_limit', '已达到文件监听上限');
    if (existing) clearInterval(existing);
    let last = initial.revision;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const current = await targetFor(payload);
        const value = await readFileRecord(current.target, current.check);
        if (last !== value.revision && watchers.get(key) === timer) {
          last = value.revision;
          onChange?.({ projectId: current.projectId, path: current.relative, revision: last });
        }
      } catch (error) {
        const code = resultError(error).code;
        if (last !== code && watchers.get(key) === timer) {
          last = code;
          try { onChange?.({ projectId: target.projectId, path: target.relative, revision: null, code }); } catch (_) {}
        }
      } finally {
        polling = false;
      }
    }, Math.max(50, pollIntervalMs));
    timer.unref();
    watchers.set(key, timer);
    return { ok: true, revision: initial.revision };
  }

  function unwatch(payload) {
    const key = watchKey(payload.projectId, segments(payload.path).join('/'));
    clearInterval(watchers.get(key));
    watchers.delete(key);
    return { ok: true };
  }

  function route(action) {
    return async (payload = {}) => {
      try {
        if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
          throw failure('invalid_request', 'Markdown 请求格式无效');
        }
        return await action(payload);
      } catch (error) { return resultError(error); }
    };
  }

  return { list: route(list), read: route(read), save: route(payload => mutate(payload, false)),
    versions: route(versions), restore: route(payload => mutate(payload, true)), watch: route(watch),
    unwatch: route(unwatch), close() { closed = true; for (const timer of watchers.values()) clearInterval(timer); watchers.clear(); } };
}

module.exports = { createMarkdownService };
