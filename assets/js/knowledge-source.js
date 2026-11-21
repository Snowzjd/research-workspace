/* 工作台知识网络数据层。只保存 RPM 只读接口 v1 快照，不推断方法状态，不用标题当内部 ID。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KnowledgeSource = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const FOLD_ORIGINS = Object.freeze(['project_membership', 'index_membership', 'knowledge_citation']);
  const FOLD_RELATION_TYPES = Object.freeze(['membership', 'indexed_file', 'source']);
  const METHOD_USAGE_LABELS = Object.freeze({
    adopted: '已确认采用',
    investigating: '研究中',
    historical_candidate: '历史候选',
    literature_only: '文献中的方法',
    undecided: '尚未确定'
  });

  function methodUsageLabel(value) {
    if (value == null || value === '') return '未确定';
    return METHOD_USAGE_LABELS[value] || String(value);
  }

  function isAdopted(value) {
    return value === 'adopted';
  }

  function taskKey(projectId, taskId) {
    return String(projectId || '') + '::' + String(taskId || '');
  }

  function uniqueById(items, label) {
    const seen = new Set();
    const out = [];
    for (const item of items || []) {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error(label + '缺少有效 ID');
      if (seen.has(item.id)) throw new Error(label + '出现重复 ID：' + item.id);
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  function indexSnapshot(raw) {
    if (!raw || raw.ok !== true || raw.schema_version !== SCHEMA_VERSION) {
      throw new Error('RPM 知识网络返回了未知接口版本或响应结构');
    }
    if (raw.not_modified === true) {
      return { header: raw, not_modified: true, raw: raw };
    }
    const projects = uniqueById(raw.projects, '项目');
    const nodes = uniqueById(raw.nodes, '节点');
    const edges = uniqueById(raw.edges, '关系');
    const files = uniqueById(raw.files, '文件');
    return {
      header: raw,
      not_modified: false,
      raw: raw,
      projects: projects,
      nodes: nodes,
      edges: edges,
      files: files,
      issues: Array.isArray(raw.issues) ? raw.issues.slice() : [],
      projectMap: new Map(projects.map(function (p) { return [p.id, p]; })),
      nodeMap: new Map(nodes.map(function (n) { return [n.id, n]; })),
      edgeMap: new Map(edges.map(function (e) { return [e.id, e]; })),
      fileMap: new Map(files.map(function (f) { return [f.id, f]; }))
    };
  }

  function scopeKey(projectId) {
    if (projectId == null || projectId === '') return 'global';
    return String(projectId);
  }

  function createStore(requestSnapshot) {
    if (typeof requestSnapshot !== 'function') throw new TypeError('需要快照查询函数');
    const scopes = new Map();

    async function load(opts) {
      opts = opts || {};
      const key = scopeKey(opts.projectId);
      const prev = scopes.get(key);
      const revision = opts.force ? undefined : (opts.ifRevision !== undefined ? opts.ifRevision : (prev && prev.revision) || undefined);
      const response = await requestSnapshot({
        projectId: key === 'global' ? undefined : opts.projectId,
        ifRevision: revision
      });
      if (!response || response.ok !== true) {
        if (prev && prev.indexed) {
          prev.error = response || { ok: false, code: 'transport_failed', error: '查询失败' };
          prev.stale = true;
          return { ok: false, kept: true, error: prev.error, indexed: prev.indexed };
        }
        scopes.set(key, { indexed: null, revision: null, stale: true, error: response, incomplete: true });
        return { ok: false, kept: false, error: response };
      }
      if (response.not_modified === true) {
        if (!prev || !prev.indexed) return load(Object.assign({}, opts, { force: true, ifRevision: undefined }));
        prev.header = Object.assign({}, prev.header, response);
        prev.revision = response.revision;
        prev.stale = response.registry_complete === false;
        prev.incomplete = response.registry_complete === false;
        prev.error = null;
        return { ok: true, not_modified: true, indexed: prev.indexed, revision: prev.revision };
      }
      const indexed = indexSnapshot(response);
      const next = {
        indexed: indexed,
        revision: response.revision,
        stale: response.registry_complete === false,
        incomplete: response.registry_complete === false,
        error: null,
        header: response,
        updatedAt: response.generated_at
      };
      scopes.set(key, next);
      return { ok: true, not_modified: false, indexed: indexed, revision: response.revision };
    }

    return {
      SCHEMA_VERSION: SCHEMA_VERSION,
      scopes: scopes,
      load: load,
      get: function (id) { return scopes.get(scopeKey(id)) || null; },
      methodUsageLabel: methodUsageLabel,
      isAdopted: isAdopted,
      taskKey: taskKey
    };
  }

  function searchSnapshot(indexed, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q || !indexed) return { nodes: [], tasks: [], files: [] };
    const nodes = indexed.nodes.filter(function (n) {
      return (n.title || '').toLowerCase().indexOf(q) >= 0
        || (n.description || '').toLowerCase().indexOf(q) >= 0
        || (n.type || '').toLowerCase().indexOf(q) >= 0;
    });
    const tasks = [];
    (indexed.projects || []).forEach(function (p) {
      (p.tasks || []).forEach(function (t) {
        if ((t.title || '').toLowerCase().indexOf(q) >= 0 || String(t.id || '').toLowerCase().indexOf(q) >= 0) {
          tasks.push({
            project_id: p.id,
            project_title: p.title,
            id: t.id,
            title: t.title,
            status: t.status,
            depends_on: t.depends_on,
            key: taskKey(p.id, t.id)
          });
        }
      });
    });
    const files = (indexed.files || []).filter(function (f) {
      return (f.name || '').toLowerCase().indexOf(q) >= 0
        || (f.relative_path || '').toLowerCase().indexOf(q) >= 0;
    });
    return { nodes: nodes, tasks: tasks, files: files };
  }

  function foldableEdge(edge) {
    if (!edge) return false;
    if (FOLD_ORIGINS.indexOf(edge.origin) >= 0) return true;
    if (FOLD_RELATION_TYPES.indexOf(edge.relation_type) >= 0) return true;
    return false;
  }

  function claimFor(node, projectId) {
    const claims = (node && Array.isArray(node.claims)) ? node.claims : [];
    if (!claims.length) return null;
    if (projectId) {
      const hit = claims.find(function (c) { return c && c.project_id === projectId; });
      if (hit) return hit;
    }
    return claims.length === 1 ? claims[0] : null;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    METHOD_USAGE_LABELS: METHOD_USAGE_LABELS,
    FOLD_ORIGINS: FOLD_ORIGINS,
    FOLD_RELATION_TYPES: FOLD_RELATION_TYPES,
    methodUsageLabel: methodUsageLabel,
    isAdopted: isAdopted,
    taskKey: taskKey,
    indexSnapshot: indexSnapshot,
    createStore: createStore,
    searchSnapshot: searchSnapshot,
    foldableEdge: foldableEdge,
    scopeKey: scopeKey,
    claimFor: claimFor
  };
});
