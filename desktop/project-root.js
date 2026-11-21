/* ==========================================================================
   项目根目录解析（只读）
   --------------------------------------------------------------------------
   产出「可交给 RPM 的、路径上不含 junction/重解析点的绝对根目录」，
   或明确的未绑定 / 冲突结果。禁止根据子目录自动猜测课题根。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

function normalizePath(input) {
  if (input == null || input === '') return '';
  let p = String(input).trim();
  if (!p) return '';
  if (p.startsWith('\\\\?\\UNC\\')) p = '\\' + p.slice(7);
  else if (p.startsWith('\\\\?\\')) p = p.slice(4);
  p = path.resolve(p);
  if (process.platform === 'win32') {
    p = p.replace(/\//g, '\\');
    if (/^[A-Za-z]:\\/.test(p)) p = p[0].toUpperCase() + p.slice(1);
    if (p.length > 3) p = p.replace(/[\\/]+$/, '');
  } else if (p.length > 1) {
    p = p.replace(/\/+$/, '');
  }
  return p;
}

function pathsEqual(a, b) {
  const left = canonicalPath(a);
  const right = canonicalPath(b);
  if (!left || !right) return false;
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/* 展开 8.3 短名，但不跟随 junction / 符号链接。 */
function canonicalPath(input) {
  const start = normalizePath(input);
  if (!start) return '';
  if (process.platform !== 'win32') return start;
  const prefixes = pathPrefixes(start);
  if (!prefixes.length) return start;
  let acc = prefixes[0];
  for (const prefix of prefixes.slice(1)) {
    const name = path.basename(prefix);
    const candidate = normalizePath(path.join(acc, name));
    try {
      if (!fs.existsSync(candidate)) {
        acc = candidate;
        continue;
      }
    } catch (_) {
      acc = candidate;
      continue;
    }
    if (isReparsePoint(candidate)) {
      acc = candidate;
      continue;
    }
    try {
      acc = normalizePath(fs.realpathSync.native(candidate));
    } catch (_) {
      acc = candidate;
    }
  }
  return acc;
}

function isReparsePoint(absPath) {
  if (!absPath) return false;
  try {
    const st = fs.lstatSync(absPath);
    if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) return true;
  } catch (_) {}
  return false;
}

function readReparseTarget(absPath) {
  if (!isReparsePoint(absPath)) return '';
  try { return normalizePath(fs.readlinkSync(absPath)); } catch (_) {}
  try { return normalizePath(fs.realpathSync.native(absPath)); } catch (_) {}
  return '';
}

function pathPrefixes(absPath) {
  const resolved = normalizePath(absPath);
  if (!resolved) return [];
  const prefixes = [];
  let current = resolved;
  for (;;) {
    prefixes.push(current);
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    if (process.platform === 'win32' && parent.toLowerCase() === current.toLowerCase()) break;
    current = parent;
  }
  prefixes.reverse();
  return prefixes;
}

/**
 * 把路径展开到不含重解析点的真实目录，并记录途中的 junction。
 */
function inspectPath(inputPath) {
  const input = normalizePath(inputPath);
  const result = {
    input,
    exists: false,
    realPath: '',
    leafIsReparse: false,
    hasReparseInPath: false,
    reparsePoints: [],
    error: ''
  };
  if (!input) {
    result.error = '路径为空';
    return result;
  }
  try {
    result.exists = fs.existsSync(input);
  } catch (err) {
    result.error = String((err && err.message) || err);
    return result;
  }
  if (!result.exists) {
    result.error = '路径不存在';
    return result;
  }
  for (const prefix of pathPrefixes(input)) {
    if (!isReparsePoint(prefix)) continue;
    result.hasReparseInPath = true;
    if (pathsEqual(prefix, input)) result.leafIsReparse = true;
    result.reparsePoints.push({
      path: prefix,
      target: readReparseTarget(prefix)
    });
  }
  try {
    result.realPath = normalizePath(fs.realpathSync.native(input));
  } catch (err) {
    result.error = '无法解析真实路径：' + String((err && err.message) || err);
    return result;
  }
  if (result.realPath && isReparsePoint(result.realPath)) {
    result.hasReparseInPath = true;
    result.error = result.error || '解析后的路径仍包含重解析点';
  }
  return result;
}

function bindingOf(project, bindings) {
  const map = bindings && typeof bindings === 'object' ? bindings : {};
  const id = project && project.id;
  const fromMap = (id && map[id]) || null;
  const rpmRoot = (fromMap && fromMap.rpmRoot)
    || (project && (project.rpmRoot || project.projectRoot))
    || '';
  const rpmProjectId = (fromMap && fromMap.rpmProjectId)
    || (project && project.rpmProjectId)
    || '';
  if (!rpmRoot && !rpmProjectId) return null;
  return { rpmRoot: normalizePath(rpmRoot), rpmProjectId: String(rpmProjectId || '') };
}

function findInRegistry(realPath, listRegistry) {
  if (!listRegistry || typeof listRegistry !== 'object') return null;
  for (const [rpmProjectId, rpmRoot] of Object.entries(listRegistry)) {
    if (pathsEqual(realPath, rpmRoot)) {
      return { rpmProjectId: String(rpmProjectId), rpmRoot: normalizePath(rpmRoot) };
    }
  }
  return null;
}

function workbenchFolderPath(project, rootDir) {
  if (!project) return '';
  const folder = String(project.folder || project.name || '').trim();
  if (!folder || /[\\/]|\.\./.test(folder)) return '';
  const root = normalizePath(rootDir);
  if (!root) return '';
  return normalizePath(path.join(root, folder));
}

/**
 * 按设计 §1.3 的顺序解析，全部只读，不自动 init，不猜测子目录。
 *
 * @returns {object}
 */
function resolveProjectRoot({ project, rootDir, bindings, listRegistry } = {}) {
  const workbenchFolder = workbenchFolderPath(project, rootDir);
  const base = {
    ok: false,
    rpmBound: false,
    workbenchId: project && project.id ? String(project.id) : '',
    workbenchFolder,
    junctionTarget: project && project.junctionTarget ? String(project.junctionTarget) : '',
    resolvedRoot: '',
    rpmProjectId: '',
    rpmRoot: '',
    conflict: false,
    guessed: false,
    code: '',
    error: '',
    note: '',
    inspect: null
  };

  if (!project || !project.id) {
    return { ...base, code: 'not_found', error: '工作台项目不存在' };
  }

  const bind = bindingOf(project, bindings);
  if (bind && bind.rpmRoot) {
    const inspected = inspectPath(bind.rpmRoot);
    base.inspect = inspected;
    base.rpmProjectId = bind.rpmProjectId;
    base.rpmRoot = bind.rpmRoot;
    if (!inspected.exists) {
      return {
        ...base,
        ok: false,
        conflict: true,
        code: 'binding_missing',
        error: '绑定的项目根目录不存在',
        note: '未擅自改写绑定'
      };
    }
    if (inspected.hasReparseInPath || !pathsEqual(inspected.realPath, bind.rpmRoot)) {
      return {
        ...base,
        ok: false,
        conflict: true,
        code: 'binding_conflict',
        resolvedRoot: inspected.realPath,
        error: '绑定路径含有重解析点或与真实根不一致，不能交给 RPM',
        note: inspected.realPath
          ? ('应使用真实根：' + inspected.realPath + '。未擅自改写绑定。')
          : '未擅自改写绑定'
      };
    }
    if (bind.rpmProjectId && listRegistry && Object.prototype.hasOwnProperty.call(listRegistry, bind.rpmProjectId)) {
      const registered = normalizePath(listRegistry[bind.rpmProjectId]);
      if (registered && !pathsEqual(registered, inspected.realPath)) {
        return {
          ...base,
          ok: false,
          conflict: true,
          resolvedRoot: registered,
          code: 'binding_conflict',
          error: '绑定路径与该 RPM 项目在登记表中的根目录不一致',
          note: '登记根为：' + registered + '。未擅自改写绑定。'
        };
      }
    }
    const hit = findInRegistry(inspected.realPath, listRegistry);
    if (hit && bind.rpmProjectId && hit.rpmProjectId !== bind.rpmProjectId) {
      return {
        ...base,
        ok: false,
        conflict: true,
        resolvedRoot: inspected.realPath,
        code: 'binding_id_conflict',
        error: '绑定的 RPM 项目 ID 与登记表不一致',
        note: '未擅自改写绑定'
      };
    }
    return {
      ...base,
      ok: true,
      rpmBound: true,
      resolvedRoot: inspected.realPath,
      rpmProjectId: (hit && hit.rpmProjectId) || bind.rpmProjectId,
      rpmRoot: inspected.realPath,
      code: 'bound'
    };
  }

  const explicitJunction = String((project && project.junctionTarget) || '').trim();
  if (explicitJunction) {
    const inspected = inspectPath(explicitJunction);
    base.inspect = inspected;
    if (!inspected.exists) {
      return { ...base, code: 'junction_target_missing', error: 'junctionTarget 指向的路径不存在' };
    }
    if (inspected.hasReparseInPath) {
      return {
        ...base,
        ok: false,
        code: 'reparse_in_path',
        resolvedRoot: inspected.realPath,
        error: 'junctionTarget 展开后仍含重解析点，不能直接交给 RPM',
        note: inspected.realPath ? ('应使用真实根：' + inspected.realPath) : ''
      };
    }
    return finishWithRegistry(base, inspected.realPath, listRegistry);
  }

  if (!workbenchFolder) {
    return { ...base, code: 'unbound', error: '无法计算工作台项目目录（缺少 rootDir 或合法 folder）', note: '尚未接入文件引擎' };
  }

  const inspected = inspectPath(workbenchFolder);
  base.inspect = inspected;
  if (!inspected.exists) {
    return { ...base, code: 'folder_missing', error: '工作台项目目录不存在', note: '尚未接入文件引擎' };
  }

  /* 项目文件夹本身是 junction：展开为目标，这不是猜测子目录。 */
  if (inspected.leafIsReparse && inspected.realPath && !isReparsePoint(inspected.realPath)) {
    return finishWithRegistry(base, inspected.realPath, listRegistry, {
      note: '已展开项目文件夹自身的 junction，未扫描其子目录'
    });
  }

  if (inspected.hasReparseInPath) {
    return {
      ...base,
      ok: false,
      code: 'reparse_in_path',
      resolvedRoot: inspected.realPath,
      error: '工作台项目路径含有重解析点，不能直接交给 RPM',
      note: inspected.realPath ? ('应使用真实根：' + inspected.realPath + '。不会自动选择子目录。') : '不会自动选择子目录'
    };
  }

  /* 普通包装目录：绝对不要挑选其子级 junction（例如 main / Skill）。 */
  return finishWithRegistry(base, inspected.realPath, listRegistry, {
    note: '未自动猜测子目录。若真实科研根位于子级 junction，需要用户明确指定后再绑定。'
  });
}

function finishWithRegistry(base, realPath, listRegistry, extra) {
  const hit = findInRegistry(realPath, listRegistry);
  if (hit) {
    return {
      ...base,
      ok: true,
      rpmBound: true,
      resolvedRoot: realPath,
      rpmProjectId: hit.rpmProjectId,
      rpmRoot: hit.rpmRoot,
      code: 'registry_match',
      note: (extra && extra.note) || '',
      guessed: false
    };
  }
  return {
    ...base,
    ok: true,
    rpmBound: false,
    resolvedRoot: realPath,
    code: 'unbound',
    error: '',
    note: ((extra && extra.note) || '') + (extra && extra.note ? ' ' : '') + '尚未接入文件引擎，不会自动执行 init。',
    guessed: false
  };
}

module.exports = {
  normalizePath,
  pathsEqual,
  canonicalPath,
  isReparsePoint,
  readReparseTarget,
  inspectPath,
  bindingOf,
  findInRegistry,
  workbenchFolderPath,
  resolveProjectRoot
};
