/* 工作台材料数据源判定。已绑定项目以 RPM 文件索引为唯一权威。
   可在 Node 测试与渲染层（经典脚本）中共用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaterialSource = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEMO_MATERIAL_IDS = Object.freeze(['tpms', 'lng', 'cfd', 'opt', 'bench', 'rag']);
  const SOURCE = Object.freeze({
    rpm: 'rpm',
    rpmLoading: 'rpm-loading',
    rpmError: 'rpm-error',
    historical: 'historical',
    demo: 'demo',
    disconnected: 'disconnected'
  });

  function isDemoMaterialId(projectId, extraKeys) {
    const id = String(projectId || '');
    if (!id) return false;
    if (DEMO_MATERIAL_IDS.indexOf(id) >= 0) return true;
    if (extraKeys && Object.prototype.hasOwnProperty.call(extraKeys, id)) return true;
    return false;
  }

  function bindingOf(project, settings, projectId) {
    const id = String((project && project.id) || projectId || '');
    const fromSettings = settings && settings.rpmBindings && id
      ? settings.rpmBindings[id]
      : null;
    const rpmProjectId = String(
      (project && project.rpmProjectId) ||
      (fromSettings && fromSettings.rpmProjectId) ||
      ''
    ).trim();
    const rpmRoot = String(
      (project && (project.rpmRoot || project.projectRoot)) ||
      (fromSettings && fromSettings.rpmRoot) ||
      ''
    ).trim();
    return { id: id, rpmProjectId: rpmProjectId, rpmRoot: rpmRoot };
  }

  function hasBindHint(binding, rpmCache) {
    if (rpmCache && rpmCache.rpmBound) return true;
    if (!binding) return false;
    return !!(binding.rpmProjectId || binding.rpmRoot);
  }

  function historicalIndexOf(materialIndex, projectId) {
    const idx = materialIndex && projectId ? materialIndex[projectId] : null;
    if (idx && typeof idx === 'object' && Object.keys(idx).length) return idx;
    return null;
  }

  function formatSize(raw) {
    if (raw == null || raw === '') return '';
    const text = String(raw).trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return text;
    const n = Number(text);
    if (!Number.isFinite(n)) return text;
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
    const digits = v >= 100 || u === 0 ? 0 : 1;
    return v.toFixed(digits) + ' ' + units[u];
  }

  function extOf(name) {
    const base = String(name || '').split(/[\\/]/).pop() || '';
    const i = base.lastIndexOf('.');
    if (i <= 0 || i === base.length - 1) return '';
    return base.slice(i + 1).toLowerCase();
  }

  function dirKeyOf(row) {
    if (row && row.category) return String(row.category);
    const rel = String((row && (row.relative_path || row.relativePath)) || '').replace(/\\/g, '/');
    if (!rel) return '（未分类）';
    const parts = rel.split('/').filter(Boolean);
    return parts.length > 1 ? parts[0] : '（未分类）';
  }

  function fileRecord(row) {
    const name = String((row && (row.name || row.n)) || '');
    const rel = String((row && (row.relative_path || row.relativePath || row.rel)) || '');
    const dir = dirKeyOf(row);
    return {
      n: name,
      size: formatSize(row && (row.size != null ? row.size : row[1])),
      ext: (row && row.ext) || extOf(name),
      dir: dir,
      file_id: (row && (row.file_id || row.fileId)) || '',
      relative_path: rel,
      absolute_path: (row && (row.absolute_path || row.absolutePath)) || '',
      category: (row && row.category) || dir,
      purpose: (row && row.purpose) || '',
      file_type: (row && (row.file_type || row.fileType)) || '',
      status: (row && row.status) || '',
      version: (row && row.version) || ''
    };
  }

  function indexFromRpmFiles(files) {
    const index = {};
    (Array.isArray(files) ? files : []).forEach(function (row) {
      const rec = fileRecord(row);
      const key = rec.dir || '（未分类）';
      if (!index[key]) index[key] = [];
      index[key].push(rec);
    });
    return index;
  }

  function filesInIndex(index, dir) {
    const m = index && typeof index === 'object' ? index : {};
    if (dir) {
      return (m[dir] || []).map(normalizeIndexEntry);
    }
    const out = [];
    Object.keys(m).forEach(function (d) {
      (m[d] || []).forEach(function (entry) {
        const rec = normalizeIndexEntry(entry);
        if (!rec.dir) rec.dir = d;
        out.push(rec);
      });
    });
    return out;
  }

  function normalizeIndexEntry(entry) {
    if (entry && !Array.isArray(entry) && typeof entry === 'object') {
      return fileRecord(entry);
    }
    const arr = Array.isArray(entry) ? entry : [];
    return fileRecord({ n: arr[0], size: arr[1], ext: arr[2] });
  }

  function legacyIndexToObjects(idx) {
    const out = {};
    if (!idx || typeof idx !== 'object') return out;
    Object.keys(idx).forEach(function (d) {
      out[d] = (idx[d] || []).map(function (entry) {
        const rec = normalizeIndexEntry(entry);
        rec.dir = rec.dir || d;
        return rec;
      });
    });
    return out;
  }

  function resolve(opts) {
    const options = opts || {};
    const projectId = options.projectId || (options.project && options.project.id) || '';
    const project = options.project || null;
    const settings = options.settings || null;
    const rpmCache = options.rpmCache || null;
    const materialIndex = options.materialIndex || null;
    const demoMaterials = options.demoMaterials || null;
    const bind = bindingOf(project, settings, projectId);
    const boundHint = hasBindHint(bind, rpmCache);
    const hist = historicalIndexOf(materialIndex, projectId);

    if (rpmCache && rpmCache.rpmBound) {
      if (rpmCache.error && !rpmCache.files) {
        return {
          source: SOURCE.rpmError,
          index: {},
          files: [],
          rpmBound: true,
          resolvedRoot: rpmCache.resolvedRoot || bind.rpmRoot || '',
          rpmProjectId: rpmCache.rpmProjectId || bind.rpmProjectId || '',
          error: rpmCache.error || '',
          label: rpmCache.error ? ('无法读取文件引擎：' + rpmCache.error) : '无法读取文件引擎'
        };
      }
      const files = Array.isArray(rpmCache.files) ? rpmCache.files.map(fileRecord) : filesInIndex(rpmCache.index);
      const index = rpmCache.index && Object.keys(rpmCache.index).length
        ? rpmCache.index
        : indexFromRpmFiles(files);
      const count = files.length;
      return {
        source: SOURCE.rpm,
        index: index,
        files: files,
        rpmBound: true,
        resolvedRoot: rpmCache.resolvedRoot || bind.rpmRoot || '',
        rpmProjectId: rpmCache.rpmProjectId || bind.rpmProjectId || '',
        error: '',
        fileCount: count,
        label: '已接入文件引擎，已索引 ' + count + ' 个文件'
      };
    }

    if (boundHint || (rpmCache && rpmCache.loading)) {
      const loading = !rpmCache || rpmCache.loading || !rpmCache.probed;
      if (rpmCache && rpmCache.probed && rpmCache.rpmBound === false) {
        /* 有绑定字段但解析为未接入：仍按未接入，不回退历史/演示权威 */
      } else if (loading) {
        return {
          source: SOURCE.rpmLoading,
          index: {},
          files: [],
          rpmBound: true,
          resolvedRoot: (rpmCache && rpmCache.resolvedRoot) || bind.rpmRoot || '',
          rpmProjectId: (rpmCache && rpmCache.rpmProjectId) || bind.rpmProjectId || '',
          error: '',
          label: '正在读取文件引擎索引'
        };
      }
      if (rpmCache && rpmCache.error) {
        return {
          source: SOURCE.rpmError,
          index: {},
          files: [],
          rpmBound: !!boundHint,
          resolvedRoot: rpmCache.resolvedRoot || bind.rpmRoot || '',
          rpmProjectId: rpmCache.rpmProjectId || bind.rpmProjectId || '',
          error: rpmCache.error,
          label: '无法读取文件引擎：' + rpmCache.error
        };
      }
    }

    if (boundHint) {
      return {
        source: SOURCE.rpmError,
        index: {},
        files: [],
        rpmBound: true,
        resolvedRoot: bind.rpmRoot || '',
        rpmProjectId: bind.rpmProjectId || '',
        error: (rpmCache && rpmCache.error) || '尚未取得文件引擎索引',
        label: '已绑定文件引擎，但还没有读到索引'
      };
    }

    if (hist) {
      const index = legacyIndexToObjects(hist);
      const files = filesInIndex(index);
      return {
        source: SOURCE.historical,
        index: index,
        files: files,
        rpmBound: false,
        resolvedRoot: bind.rpmRoot || '',
        rpmProjectId: '',
        error: '',
        fileCount: files.length,
        historical: true,
        label: '历史工作台索引（非 RPM），' + files.length + ' 个文件'
      };
    }

    if (isDemoMaterialId(projectId, demoMaterials) && demoMaterials && demoMaterials[projectId]) {
      const index = legacyIndexToObjects(demoMaterials[projectId]);
      const files = filesInIndex(index);
      return {
        source: SOURCE.demo,
        index: index,
        files: files,
        rpmBound: false,
        resolvedRoot: '',
        rpmProjectId: '',
        error: '',
        fileCount: files.length,
        demo: true,
        label: '演示材料（仅开发预览），' + files.length + ' 个文件'
      };
    }

    return {
      source: SOURCE.disconnected,
      index: {},
      files: [],
      rpmBound: false,
      resolvedRoot: bind.rpmRoot || '',
      rpmProjectId: '',
      error: '',
      label: '尚未接入文件引擎'
    };
  }

  function joinOpenPath(root, rel) {
    const base = String(root || '').replace(/[\\/]+$/, '');
    const part = String(rel || '').replace(/^[\\/]+/, '').replace(/\//g, '\\');
    if (!base) return part;
    if (!part) return base;
    return base + '\\' + part;
  }

  function openRootOf(opts) {
    const decided = opts && opts.decided ? opts.decided : resolve(opts || {});
    if (decided.resolvedRoot) return decided.resolvedRoot;
    const project = (opts && opts.project) || null;
    const workbenchRoot = String((opts && opts.workbenchRoot) || '');
    const folder = project ? (project.folder || project.name || '') : '';
    if (workbenchRoot && folder) return joinOpenPath(workbenchRoot, folder);
    return workbenchRoot || '';
  }

  function openFolderPath(opts, relativeDir) {
    return joinOpenPath(openRootOf(opts), relativeDir);
  }

  function openFilePath(opts, file) {
    if (file && file.absolute_path) return file.absolute_path;
    const rel = file && (file.relative_path || (file.dir ? (file.dir + '/' + file.n) : file.n));
    return joinOpenPath(openRootOf(opts), rel);
  }

  function shouldSkipEnsureStructure(project, settings) {
    if (!project) return true;
    if (project.skipStructure || project.rpmBound) return true;
    const bind = bindingOf(project, settings, project.id);
    if (bind.rpmProjectId || bind.rpmRoot) return true;
    return false;
  }

  function canUseDemoMaterials(projectId, project, settings) {
    if (shouldSkipEnsureStructure(project, settings)) return false;
    return isDemoMaterialId(projectId);
  }

  function structureProjects(projects, settings, demoMaterials) {
    return (Array.isArray(projects) ? projects : []).filter(function (p) {
      return p && !shouldSkipEnsureStructure(p, settings);
    }).map(function (p) {
      const demo = canUseDemoMaterials(p.id, p, settings) && demoMaterials && demoMaterials[p.id]
        ? demoMaterials[p.id]
        : null;
      const dirs = {};
      if (demo) {
        Object.keys(demo).forEach(function (d) {
          dirs[d] = (demo[d] || []).map(function (arr) {
            const name = Array.isArray(arr) ? arr[0] : (arr && (arr.n || arr.name));
            const ext = Array.isArray(arr) ? arr[2] : (arr && arr.ext);
            return { name: name, kind: ext === 'dir' ? 'dir' : 'file' };
          });
        });
      }
      return {
        name: p.name,
        folder: p.folder || p.name,
        dirs: dirs
      };
    });
  }

  function ensureCompatFields(data) {
    const d = data && typeof data === 'object' ? data : {};
    if (!d.materialIndex || typeof d.materialIndex !== 'object') d.materialIndex = {};
    if (!d.materialScans || typeof d.materialScans !== 'object') d.materialScans = {};
    if (!Array.isArray(d.outcomes)) d.outcomes = [];
    if (!d.settings || typeof d.settings !== 'object') d.settings = {};
    if (!d.settings.rpmBindings || typeof d.settings.rpmBindings !== 'object') {
      d.settings.rpmBindings = {};
    }
    return d;
  }

  function outcomeOpenPath(outcome, opts) {
    if (!outcome) return '';
    if (outcome.absolute_path) return outcome.absolute_path;
    if (outcome.relative_path) return joinOpenPath(openRootOf(opts), outcome.relative_path);
    return String(outcome.file || outcome.path || '');
  }

  return {
    DEMO_MATERIAL_IDS: DEMO_MATERIAL_IDS,
    SOURCE: SOURCE,
    isDemoMaterialId: isDemoMaterialId,
    bindingOf: bindingOf,
    hasBindHint: hasBindHint,
    formatSize: formatSize,
    indexFromRpmFiles: indexFromRpmFiles,
    filesInIndex: filesInIndex,
    resolve: resolve,
    openRootOf: openRootOf,
    openFolderPath: openFolderPath,
    openFilePath: openFilePath,
    joinOpenPath: joinOpenPath,
    shouldSkipEnsureStructure: shouldSkipEnsureStructure,
    canUseDemoMaterials: canUseDemoMaterials,
    structureProjects: structureProjects,
    ensureCompatFields: ensureCompatFields,
    outcomeOpenPath: outcomeOpenPath,
    fileRecord: fileRecord
  };
});
