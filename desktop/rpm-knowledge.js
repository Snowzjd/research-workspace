/* 主进程知识网络读取器：复用阶段三适配器与交付包 createKnowledgeReader，不新增长期服务。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createKnowledgeReader } = require('../rpm-integration/workbench-rpm-knowledge.cjs');
const rpmAdapter = require('./rpm-adapter');

const INTERFACE_VERSION = 1;
const KNOWLEDGE_SCRIPT = path.resolve(__dirname, '..', 'rpm-integration', 'rpm_knowledge_api.py');
const DEFAULT_TIMEOUT_MS = 60000;

function readerFor(config) {
  const cfg = Object.assign({ cache: false }, config || {});
  cfg.timeoutMs = Math.max(DEFAULT_TIMEOUT_MS, Number(cfg.timeoutMs) || 0);
  return createKnowledgeReader(rpmAdapter, cfg);
}

async function querySnapshot(config, opts) {
  const reader = readerFor(config);
  const query = opts || {};
  return reader.snapshot({
    projectId: query.projectId,
    ifRevision: query.ifRevision
  });
}

async function queryResolve(config, projectId, fileId) {
  const reader = readerFor(config);
  return reader.resolveFile(projectId, fileId);
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
  openResolvedFile
};
