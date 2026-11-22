'use strict';
const path = require('node:path');
const SCRIPT = path.join(__dirname, 'rpm_knowledge_api.py');
const ID = /^[a-f0-9]{32}$/;
const REVISION = /^[a-f0-9]{64}$/;

function createKnowledgeReader(adapter, trustedConfig = {}) {
  const fail = (code, error) => ({ok:false, schema_version:1, code, error});
  if (!adapter || !['runCommand','resolveScript','resolveSettings'].every(key=>typeof adapter[key]==='function')) {
    throw new TypeError('A Stage 3 RPM adapter is required');
  }
  async function query(mode, args) {
    const base = adapter.resolveScript(trustedConfig);
    if (!base) return fail('rpm_skill_missing','RPM Skill 入口未配置');
    const settings = adapter.resolveSettings(trustedConfig);
    const result = await adapter.runCommand('context',[mode,...args],{
      ...trustedConfig,
      scriptPath:SCRIPT,
      settingsPath:settings,
      cache:false
    });
    if (!result.ok) return fail(result.details?.code || result.code || 'transport_failed', result.error || 'RPM 查询失败');
    const value = result.data;
    if (value?.ok !== true || value.schema_version !== 1) {
      return fail('invalid_response','RPM 知识网络返回了未知接口版本或响应结构');
    }
    return value;
  }
  /* Skill root is passed as a fixed trusted environment/config argument via the adapter's transport CLI. */
  function skillArgs() {
    const base = adapter.resolveScript(trustedConfig);
    return base ? ['--skill-root',path.dirname(path.dirname(path.resolve(base)))] : [];
  }
  return Object.freeze({
    materialCatalog(projectId, { category = '', offset = 0, limit = 30 } = {}) {
      if (typeof projectId !== 'string' || !ID.test(projectId) || typeof category !== 'string' ||
          (category && !/^\d{2}_[A-Za-z_]+$/.test(category)) ||
          !Number.isInteger(offset) || offset < 0 || offset > 2147483647 ||
          !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return Promise.resolve(fail('invalid_request','项目、分类或分页参数无效'));
      }
      return query('--material-catalog',[...skillArgs(),'--project-id',projectId,
        '--material-offset',String(offset),'--material-limit',String(limit),
        ...(category ? ['--material-category',category] : [])]);
    },
    materialFiles(projectId, ids) {
      if (typeof projectId !== 'string' || !ID.test(projectId) || !Array.isArray(ids) ||
          !ids.length || ids.length > 30 || ids.some(id => typeof id !== 'string' || !ID.test(id))) {
        return Promise.resolve(fail('invalid_request','须提供项目 ID 及 1–30 个材料 ID'));
      }
      return query('--material-files',[...skillArgs(),'--project-id',projectId,
        ...ids.flatMap(id=>['--material-id',id])]);
    },
    snapshot({projectId, ifRevision, ifInputStamp}={}) {
      if (projectId !== undefined && (typeof projectId !== 'string' || !ID.test(projectId))) {
        return Promise.resolve(fail('invalid_request','项目 ID 须为 RPM 登记 ID'));
      }
      if (ifRevision !== undefined && (typeof ifRevision !== 'string' || !REVISION.test(ifRevision))) {
        return Promise.resolve(fail('invalid_request','修订号无效'));
      }
      return query('--knowledge-network',[
        ...skillArgs(),
        ...(projectId === undefined ? [] : ['--project-id',projectId]),
        ...(ifRevision === undefined ? [] : ['--if-revision',ifRevision]),
        ...(ifInputStamp && REVISION.test(ifInputStamp) ? ['--if-input-stamp',ifInputStamp] : [])
      ]);
    },
    resolveFile(projectId,fileId) {
      if (typeof projectId !== 'string' || !ID.test(projectId) || typeof fileId !== 'string' || !ID.test(fileId)) {
        return Promise.resolve(fail('invalid_request','需要项目 ID 和文件或来源 ID'));
      }
      return query('--resolve-evidence',[...skillArgs(),'--project-id',projectId,'--file-id',fileId]);
    }
  });
}

module.exports = {createKnowledgeReader};
