/* 供 api-server 调用的只读 RPM 路由实现。本身不是独立服务。 */
'use strict';

const path = require('path');
const rpmAdapter = require('./rpm-adapter');
const projectRoot = require('./project-root');

function httpStatusFor(result) {
  if (!result) return 500;
  if (result.httpStatus) return result.httpStatus;
  if (result.code === 'not_found') return 404;
  if (result.code === 'unbound' || result.code === 'binding_conflict'
      || result.code === 'binding_missing' || result.code === 'binding_id_conflict'
      || result.code === 'reparse_in_path' || result.code === 'junction_target_missing') {
    return 409;
  }
  if (result.code === 'command_not_allowed') return 403;
  if (result.ok === false) return 400;
  return 200;
}

function findWorkbenchProject(ctx, id) {
  const wanted = String(id || '');
  if (!wanted) return null;
  const list = typeof ctx.listWorkbenchProjects === 'function' ? (ctx.listWorkbenchProjects() || []) : [];
  return list.find((p) => p && String(p.id) === wanted) || null;
}

function bindingsOf(ctx) {
  return (typeof ctx.getBindings === 'function' && ctx.getBindings()) || {};
}

function configOf(ctx) {
  return (typeof ctx.getConfig === 'function' && ctx.getConfig()) || {};
}

function rootDirOf(ctx) {
  return (typeof ctx.getRootDir === 'function' && ctx.getRootDir()) || '';
}

function matchWorkbenchId(projects, bindings, rpmProjectId, rpmRoot) {
  const list = Array.isArray(projects) ? projects : [];
  const map = bindings && typeof bindings === 'object' ? bindings : {};
  for (const [wid, bind] of Object.entries(map)) {
    if (!bind) continue;
    if (bind.rpmProjectId && String(bind.rpmProjectId) === String(rpmProjectId)) return wid;
    if (bind.rpmRoot && projectRoot.pathsEqual(bind.rpmRoot, rpmRoot)) return wid;
  }
  for (const project of list) {
    if (!project) continue;
    if (project.rpmProjectId && String(project.rpmProjectId) === String(rpmProjectId)) return project.id;
    if (project.rpmRoot && projectRoot.pathsEqual(project.rpmRoot, rpmRoot)) return project.id;
  }
  return '';
}

function absoluteOf(root, relative) {
  if (!root || relative == null) return '';
  const rel = String(relative).replace(/^[\\/]+/, '');
  return projectRoot.normalizePath(path.join(root, rel.split('/').join(path.sep)));
}

async function resolveForProject(ctx, project) {
  const cfg = configOf(ctx);
  const listed = await rpmAdapter.listProjects(cfg);
  const registry = listed.ok ? listed.data : {};
  const resolved = projectRoot.resolveProjectRoot({
    project,
    rootDir: rootDirOf(ctx),
    bindings: bindingsOf(ctx),
    listRegistry: registry
  });
  if (listed.ok === false) {
    resolved.listError = listed.error;
  }
  return { resolved, listed, cfg };
}

function filesPayload(root, searchResult) {
  const data = (searchResult && searchResult.data) || {};
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const files = matches.map((row) => Object.assign({}, row, {
    absolute_path: absoluteOf(root, row.relative_path)
  }));
  return {
    ok: true,
    rpmBound: true,
    resolvedRoot: root,
    total: data.total != null ? data.total : files.length,
    files
  };
}

function relationsPayload(root, contextResult, searchResult) {
  const data = (contextResult && contextResult.data) || {};
  const relations = Array.isArray(data.relations) ? data.relations : [];
  const matches = searchResult && searchResult.ok && searchResult.data && Array.isArray(searchResult.data.matches)
    ? searchResult.data.matches
    : [];
  const byId = {};
  for (const row of matches) {
    if (row && row.file_id) byId[row.file_id] = row;
  }
  const translate = (fileId) => {
    const row = byId[fileId] || {};
    return {
      file_id: fileId,
      name: row.name || '',
      relative_path: row.relative_path || '',
      absolute_path: row.relative_path ? absoluteOf(root, row.relative_path) : ''
    };
  };
  return {
    ok: true,
    rpmBound: true,
    resolvedRoot: root,
    relations: relations.map((item) => ({
      source: item.source,
      target: item.target,
      kind: item.kind,
      evidence: item.evidence,
      source_file: translate(item.source),
      target_file: translate(item.target)
    }))
  };
}


function rootPayload(resolved) {
  return {
    ok: !resolved.conflict,
    workbenchFolder: resolved.workbenchFolder,
    resolvedRoot: resolved.resolvedRoot,
    rpmBound: !!resolved.rpmBound,
    rpmProjectId: resolved.rpmProjectId || '',
    conflict: !!resolved.conflict,
    code: resolved.code || '',
    error: resolved.error || '',
    note: resolved.note || '',
    inspect: resolved.inspect
      ? {
          input: resolved.inspect.input,
          realPath: resolved.inspect.realPath,
          hasReparseInPath: resolved.inspect.hasReparseInPath,
          leafIsReparse: resolved.inspect.leafIsReparse,
          reparsePoints: resolved.inspect.reparsePoints
        }
      : null
  };
}

function rejectPayload(resolved, extra) {
  return Object.assign({
    ok: false,
    rpmBound: !!resolved.rpmBound,
    workbenchFolder: resolved.workbenchFolder,
    resolvedRoot: resolved.resolvedRoot,
    code: resolved.code || '',
    error: resolved.error || '',
    note: resolved.note || ''
  }, extra || {});
}

function pathNotUsable(resolved) {
  return !resolved.ok || resolved.conflict || resolved.hasReparseInPath
    || (resolved.inspect && resolved.inspect.hasReparseInPath && !resolved.rpmBound);
}

async function loadProject(ctx, id) {
  const project = findWorkbenchProject(ctx, id);
  if (!project) {
    return { httpStatus: 404, ok: false, code: 'not_found', error: '没有这个项目 ID' };
  }
  const { resolved, cfg } = await resolveForProject(ctx, project);
  return { ok: true, id, project, resolved, cfg };
}

async function queryRoot(ctx, id) {
  const got = await loadProject(ctx, id);
  if (got.code === 'not_found') return got;
  const body = rootPayload(got.resolved);
  body.id = id;
  return Object.assign({ httpStatus: got.resolved.conflict ? 409 : 200 }, body);
}

async function ensureBound(got) {
  if (got.code === 'not_found') return got;
  const resolved = got.resolved;
  if (pathNotUsable(resolved)) {
    return Object.assign({
      httpStatus: 409
    }, rejectPayload(resolved, {
      code: resolved.code || 'reparse_in_path',
      error: resolved.error || '路径不能交给 RPM'
    }));
  }
  if (!resolved.rpmBound) {
    return Object.assign({
      httpStatus: 409
    }, rejectPayload(resolved, {
      rpmBound: false,
      code: 'unbound',
      error: '该项目尚未接入文件引擎',
      note: '不会自动执行 init。可继续查看工作台原有项目内容。'
    }));
  }
  return null;
}

async function queryFiles(ctx, id, opts) {
  const got = await loadProject(ctx, id);
  const rejected = await ensureBound(got);
  if (rejected) return rejected;
  const options = opts || {};
  const root = got.resolved.resolvedRoot;
  const found = await rpmAdapter.searchFiles(root, options.query || '', {
    category: options.category || '',
    relatedTo: options.relatedTo || options.related_to || '',
    limit: options.limit
  }, got.cfg);
  if (!found.ok) {
    return {
      httpStatus: 400,
      ok: false,
      error: found.error,
      code: found.code || 'cli_failed',
      rpmBound: true,
      resolvedRoot: root
    };
  }
  return Object.assign({ httpStatus: 200, rpmProjectId: got.resolved.rpmProjectId, id }, filesPayload(root, found));
}

async function queryRelations(ctx, id) {
  const got = await loadProject(ctx, id);
  const rejected = await ensureBound(got);
  if (rejected) return rejected;
  const root = got.resolved.resolvedRoot;
  const ctxResult = await rpmAdapter.projectContext(root, got.cfg);
  if (!ctxResult.ok) {
    return {
      httpStatus: 400,
      ok: false,
      error: ctxResult.error,
      code: ctxResult.code || 'cli_failed',
      rpmBound: true,
      resolvedRoot: root
    };
  }
  const found = await rpmAdapter.searchFiles(root, '', { limit: 500 }, got.cfg);
  return Object.assign({ httpStatus: 200, rpmProjectId: got.resolved.rpmProjectId, id }, relationsPayload(root, ctxResult, found));
}

async function queryAudit(ctx, id) {
  const got = await loadProject(ctx, id);
  const rejected = await ensureBound(got);
  if (rejected) return rejected;
  const root = got.resolved.resolvedRoot;
  const audited = await rpmAdapter.projectAudit(root, got.cfg);
  if (!audited.ok) {
    return {
      httpStatus: 400,
      ok: false,
      error: audited.error,
      code: audited.code || 'cli_failed',
      rpmBound: true,
      resolvedRoot: root
    };
  }
  const data = audited.data || {};
  return {
    httpStatus: 200,
    ok: true,
    rpmBound: true,
    id,
    rpmProjectId: got.resolved.rpmProjectId,
    resolvedRoot: root,
    checked: data.checked,
    issues: Array.isArray(data.issues) ? data.issues : []
  };
}

async function handleRpmRoutes(ctx, req, res, url, pathname, send) {
  const p = pathname;
  if (!p.startsWith('/api/rpm') && !/^\/api\/projects\/[^/]+\/(files|relations|rpm-audit|root)$/.test(p)) {
    return false;
  }
  if (req.method !== 'GET') {
    send(res, 405, { ok: false, error: '请使用 GET' });
    return true;
  }

  if (p === '/api/rpm/status') {
    const cfg = configOf(ctx);
    const status = rpmAdapter.describeStatus(cfg);
    let rpmProjectCount = null;
    if (status.available) {
      const listed = await rpmAdapter.listProjects(cfg);
      if (listed.ok) rpmProjectCount = listed.projects.length;
      else status.listError = listed.error;
    }
    send(res, 200, Object.assign({ rpmProjectCount }, status));
    return true;
  }

  if (p === '/api/rpm/projects') {
    const cfg = configOf(ctx);
    const listed = await rpmAdapter.listProjects(cfg);
    if (!listed.ok) {
      send(res, 400, { ok: false, error: listed.error, code: listed.code || 'cli_failed' });
      return true;
    }
    const projects = (listed.projects || []).map((item) => {
      const id = matchWorkbenchId(ctx.listWorkbenchProjects ? ctx.listWorkbenchProjects() : [], bindingsOf(ctx), item.rpmProjectId, item.rpmRoot);
      const row = { rpmProjectId: item.rpmProjectId, rpmRoot: item.rpmRoot };
      if (id) row.id = id;
      return row;
    });
    send(res, 200, { ok: true, projects });
    return true;
  }

  if (p === '/api/rpm/vault-audit') {
    const cfg = configOf(ctx);
    const audited = await rpmAdapter.vaultAudit(cfg);
    if (!audited.ok) {
      send(res, 400, { ok: false, error: audited.error, code: audited.code || 'cli_failed' });
      return true;
    }
    send(res, 200, Object.assign({ ok: true }, audited.data || {}));
    return true;
  }


  if (p === '/api/rpm/knowledge/snapshot' || p === '/api/rpm/knowledge') {
    const rpmKnowledge = require('./rpm-knowledge');
    const cfg = Object.assign({ cache: false, timeoutMs: 60000 }, configOf(ctx));
    const projectId = url.searchParams.get('project_id') || url.searchParams.get('projectId') || undefined;
    const ifRevision = url.searchParams.get('if_revision') || url.searchParams.get('ifRevision') || undefined;
    const result = await rpmKnowledge.querySnapshot(cfg, {
      projectId: projectId || undefined,
      ifRevision: ifRevision || undefined
    });
    const status = result && result.ok ? 200
      : (result && (result.code === 'project_not_found' || result.code === 'file_not_found') ? 404 : 400);
    send(res, status, result);
    return true;
  }
  if (p === '/api/rpm/knowledge/resolve') {
    const rpmKnowledge = require('./rpm-knowledge');
    const cfg = Object.assign({ cache: false, timeoutMs: 60000 }, configOf(ctx));
    const projectId = url.searchParams.get('project_id') || url.searchParams.get('projectId') || '';
    const fileId = url.searchParams.get('file_id') || url.searchParams.get('fileId')
      || url.searchParams.get('source_id') || url.searchParams.get('sourceId') || '';
    const result = await rpmKnowledge.queryResolve(cfg, projectId, fileId);
    const status = result && result.ok ? 200
      : (result && (result.code === 'file_not_found' || result.code === 'project_not_found') ? 404 : 400);
    send(res, status, result);
    return true;
  }

  const one = p.match(/^\/api\/projects\/([^/]+)\/(files|relations|rpm-audit|root)$/);
  if (!one) return false;
  const id = decodeURIComponent(one[1]);
  const action = one[2];
  let result;
  if (action === 'root') result = await queryRoot(ctx, id);
  else if (action === 'files') {
    const limitRaw = url.searchParams.get('limit');
    result = await queryFiles(ctx, id, {
      query: url.searchParams.get('query') || '',
      category: url.searchParams.get('category') || '',
      relatedTo: url.searchParams.get('relatedTo') || url.searchParams.get('related_to') || '',
      limit: limitRaw == null || limitRaw === '' ? undefined : limitRaw
    });
  } else if (action === 'relations') result = await queryRelations(ctx, id);
  else if (action === 'rpm-audit') result = await queryAudit(ctx, id);
  else return false;
  const status = result.httpStatus || httpStatusFor(result);
  const body = Object.assign({}, result);
  delete body.httpStatus;
  send(res, status, body);
  return true;
}

const OPENAPI_PATHS = {
  '/api/rpm/status': {
    get: {
      summary: 'RPM 适配器状态（Skill 哈希、脚本路径、已登记项目数）。不含密钥。',
      tags: ['rpm'],
      responses: { 200: { description: 'available / skillHash / rpmProjectCount' } }
    }
  },
  '/api/rpm/projects': {
    get: {
      summary: 'RPM 已登记根目录。已绑定项带工作台 id；未绑定项不虚构工作台项目。',
      tags: ['rpm'],
      responses: { 200: { description: 'projects[].rpmProjectId / rpmRoot / 可选 id' } }
    }
  },
  '/api/rpm/knowledge/snapshot': {
    get: {
      summary: 'RPM 知识网络只读快照（接口版本 1）。可按 project_id 与 if_revision 条件刷新。',
      tags: ['rpm'],
      responses: { 200: { description: '快照或 not_modified' }, 400: { description: '查询失败' } }
    }
  },
  '/api/rpm/knowledge/resolve': {
    get: {
      summary: '按 project_id 与 file_id / source_id 定位原件，不接受任意路径。',
      tags: ['rpm'],
      responses: { 200: { description: 'FileResolution' }, 404: { description: '未找到' } }
    }
  },
  '/api/rpm/vault-audit': {
    get: {
      summary: '中央 Vault 只读自检（原样返回 CLI JSON）',
      tags: ['rpm'],
      responses: { 200: { description: 'vault-audit JSON' }, 400: { description: 'CLI 失败' } }
    }
  },
  '/api/projects/{id}/root': {
    get: {
      summary: '解析工作台项目的真实根目录与 RPM 绑定状态。不自动 init，不猜测子目录。',
      tags: ['rpm'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'workbenchFolder / resolvedRoot / rpmBound' },
        404: { description: '没有这个工作台项目' },
        409: { description: '绑定冲突或路径含重解析点' }
      }
    }
  },
  '/api/projects/{id}/files': {
    get: {
      summary: '按 RPM 文件索引查询。未绑定返回 409，不回落演示 MATERIALS。',
      tags: ['rpm'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'query', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'category', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'relatedTo', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }
      ],
      responses: {
        200: { description: 'files[]，含 absolute_path' },
        409: { description: '尚未接入或路径冲突' }
      }
    }
  },
  '/api/projects/{id}/relations': {
    get: {
      summary: 'RPM 文件关系（source / target / kind / evidence，并翻译路径）',
      tags: ['rpm'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'relations[]' }, 409: { description: '尚未接入或路径冲突' } }
    }
  },
  '/api/projects/{id}/rpm-audit': {
    get: {
      summary: '项目文件审计（RPM audit，不是 /api/audit 访问日志）',
      tags: ['rpm'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'checked / issues[]' }, 409: { description: '尚未接入或路径冲突' } }
    }
  }
};

const ROOT_ENDPOINT_HELP = {
  'GET  /api/rpm/status': 'RPM 适配器状态（Skill 哈希、脚本是否存在）',
  'GET  /api/rpm/projects': 'RPM 已登记根目录',
  'GET  /api/rpm/knowledge/snapshot': 'RPM 知识网络只读快照（v1）',
  'GET  /api/rpm/knowledge/resolve': '按项目 ID 与来源 ID 定位原件',
  'GET  /api/rpm/vault-audit': 'Vault 只读自检',
  'GET  /api/projects/<id>/root': '解析真实项目根与绑定状态',
  'GET  /api/projects/<id>/files': 'RPM 文件查询（只读）',
  'GET  /api/projects/<id>/relations': 'RPM 文件关系（只读）',
  'GET  /api/projects/<id>/rpm-audit': 'RPM 项目文件审计（只读）'
};

module.exports = {
  handleRpmRoutes,
  OPENAPI_PATHS,
  ROOT_ENDPOINT_HELP,
  httpStatusFor,
  queryRoot,
  queryFiles,
  queryRelations,
  queryAudit,
  resolveForProject,
  filesPayload,
  relationsPayload
};
