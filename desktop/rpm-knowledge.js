/* 主进程知识网络读取器：复用阶段三适配器与交付包 createKnowledgeReader，不新增长期服务。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createKnowledgeReader } = require('../rpm-integration/workbench-rpm-knowledge.cjs');
const rpmAdapter = require('./rpm-adapter');
const { safeDocument, samePath } = require('./full-product');

const INTERFACE_VERSION = 1;
const KNOWLEDGE_SCRIPT = path.resolve(__dirname, '..', 'rpm-integration', 'rpm_knowledge_api.py');
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

function readerFor(config) {
  const cfg = Object.assign({ cache: false }, config || {});
  cfg.timeoutMs = Math.max(DEFAULT_TIMEOUT_MS, Number(cfg.timeoutMs) || 0);
  return createKnowledgeReader(rpmAdapter, cfg);
}

const verifiedRevisions = new Map();

async function querySnapshot(config, opts) {
  const reader = readerFor({ maxStdout: MAX_SNAPSHOT_BYTES, ...config });
  const query = opts || {};
  const key = JSON.stringify([rpmAdapter.resolveScript(config || {}), rpmAdapter.resolveSettings(config || {}), query.projectId || '']);
  const previous = verifiedRevisions.get(key);
  const result = await reader.snapshot({
    projectId: query.projectId,
    ifRevision: query.ifRevision,
    ifInputStamp: previous?.revision === query.ifRevision ? previous?.stamp : undefined
  });
  if (result.ok && result.input_stamp && result.registry_complete && !result.not_modified) {
    verifiedRevisions.delete(key);
    verifiedRevisions.set(key, { revision: result.revision, stamp: result.input_stamp });
    if (verifiedRevisions.size > 12) verifiedRevisions.delete(verifiedRevisions.keys().next().value);
  } else if (!result.ok || !result.input_stamp) verifiedRevisions.delete(key);
  return result;
}

async function queryResolve(config, projectId, fileId) {
  const reader = readerFor(config);
  return reader.resolveFile(projectId, fileId);
}

function queryMaterialFiles(config, projectId, ids) {
  return readerFor(config).materialFiles(projectId, ids);
}

function queryMaterialCatalog(config, projectId, options) {
  return readerFor(config).materialCatalog(projectId, options);
}

async function accessMaterial(config, project, { id, action = 'open' } = {}, hooks) {
  if (!['open', 'reveal', 'copy-path'].includes(action) || typeof id !== 'string' || !id) {
    return { ok: false, error: '请选择一项已登记的文件' };
  }
  const resolved = await (hooks.resolve || queryResolve)(config, project.rpmProjectId, id);
  if (!resolved?.ok) return resolved || { ok: false, error: 'RPM 无法定位此文件' };
  const file = resolved.file;
  if (file?.project_id !== project.rpmProjectId || !file.path) {
    return { ok: false, error: '原件不属于当前项目' };
  }
  const locateOnly = action !== 'open';
  const target = safeDocument(project.root, file.relative_path, { allowIndexedOriginal: true, material: true, locateOnly });
  if (!target || !samePath(target, file.path)) {
    return { ok: false, error: locateOnly ? '文件已移动或路径不可访问' : '文件无法直接打开，可尝试在资源管理器中定位' };
  }
  if (action === 'reveal') hooks.reveal(target);
  else if (action === 'copy-path') hooks.copy(target);
  else if (await hooks.open(target)) return { ok: false, error: '系统无法打开此文件，请检查默认应用，可在资源管理器中定位' };
  return { ok: true, opened: action === 'open' };
}

async function openOriginal(config, { projectId, id, sourceId } = {}, hooks = {}) {
  const unavailable = { ok: false, error: 'RPM 未能定位 Markdown 正文' };
  const markdownOnly = { ok: false, error: '此条目暂无可读取的 Markdown 正文' };
  const markdown = value => typeof value === 'string' && /\.(?:md|markdown)$/i.test(value);
  const validId = value => typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value);
  if (!validId(projectId) || !validId(id) || (sourceId !== undefined && !validId(sourceId))) return unavailable;
  const snapshot = await (hooks.snapshot || querySnapshot)(config, { projectId });
  const root = snapshot?.projects?.find(project => project.id === projectId)?.root;
  if (!snapshot?.ok || !root || !path.isAbsolute(root)) return unavailable;
  const node = snapshot.nodes?.find(row => row.id === id) || snapshot.nodes?.find(row =>
    row.type === 'source' && row.source_files?.some(ref => ref.rpm_source_id === id));
  const references = node?.source_files || [];
  const ids = node && node.type !== 'source'
    ? [...new Set(references.filter(ref => ref.origin === 'indexed_file' && ref.project_id === projectId && markdown(ref.relative_path))
        .map(ref => ref.file_id || ref.rpm_source_id).filter(validId))]
    : [node?.id || id];
  if (sourceId && !ids.includes(sourceId)) return unavailable;
  if (!sourceId && ids.length > 1) {
    return { ok: true, choices: ids.map(choice => {
      const ref = references.find(row => (row.file_id || row.rpm_source_id) === choice);
      return { id: choice, name: path.basename(ref.relative_path || ref.title || choice) };
    }) };
  }
  const selected = sourceId || ids[0];
  if (!selected) return markdownOnly;
  const resolved = await (hooks.resolve || queryResolve)(config, projectId, selected);
  const file = resolved?.file;
  if (!resolved?.ok || file?.project_id !== projectId || !file.path) return unavailable;
  if (!markdown(file.relative_path)) return markdownOnly;
  const target = safeDocument(root, file.relative_path, { allowIndexedOriginal: true });
  if (!target || !samePath(target, file.path)) return unavailable;
  const result = await require('./full-markdown').readOriginalMarkdown(target);
  return { ...result, name: path.basename(target) };
}

async function openResolvedFile(config, projectId, fileId, deps) {
  const hooks = deps || {};
  const exists = hooks.exists || function (target) {
    try { return !!target && fs.existsSync(target) && fs.statSync(target).isFile(); }
    catch (_) { return false; }
  };
  const openPath = hooks.openPath || async function (target) {
    const { shell } = require('electron');
    const err = await shell.openPath(target);
    return err ? { ok: false, error: err } : { ok: true };
  };
  const resolveFile = hooks.resolveFile || queryResolve;

  const resolved = await resolveFile(config, projectId, fileId);
  if (!resolved || resolved.ok !== true) {
    return Object.assign({ opened: false }, resolved || {
      ok: false, schema_version: INTERFACE_VERSION, code: 'transport_failed', error: '定位失败'
    });
  }
  const file = resolved.file || {};
  if (!file.path || typeof file.path !== 'string') {
    return { ok: false, schema_version: INTERFACE_VERSION, code: 'file_unavailable', error: '定位结果没有可用路径', opened: false };
  }
  const abs = path.resolve(file.path);
  if (path.resolve(String(file.path)) !== abs) {
    return { ok: false, schema_version: INTERFACE_VERSION, code: 'file_unavailable', error: '定位路径复核失败', opened: false };
  }
  if (!exists(abs)) {
    return { ok: false, schema_version: INTERFACE_VERSION, code: 'file_unavailable', error: '该原件在定位过程中失效', opened: false };
  }
  const opened = await openPath(abs);
  if (!opened || opened.ok !== true) {
    return {
      ok: false, schema_version: INTERFACE_VERSION, code: 'file_unavailable',
      error: (opened && opened.error) || '系统无法打开该文件', opened: false
    };
  }
  return {
    ok: true,
    schema_version: INTERFACE_VERSION,
    opened: true,
    project_id: projectId,
    revision: resolved.revision,
    file: {
      id: file.id,
      file_id: file.file_id,
      path: abs,
      relative_path: file.relative_path,
      status: file.status
    }
  };
}

module.exports = {
  INTERFACE_VERSION,
  KNOWLEDGE_SCRIPT,
  readerFor,
  querySnapshot,
  queryResolve,
  queryMaterialFiles,
  queryMaterialCatalog,
  accessMaterial,
  openOriginal,
  openResolvedFile
};
