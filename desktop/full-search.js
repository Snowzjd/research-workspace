'use strict';

function createSearch({ readWorkspace, searchRpm, readGraph, listNotes }) {
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase();
  const section = (rows, code = '') => ({ rows, code });
  const settled = result => result.status === 'fulfilled' ? result.value : section([], 'unavailable');

  function structured(data, query) {
    const matches = (...fields) => fields.some(field => normalize(field).includes(query));
    const rows = [];
    for (const project of data.projects || []) {
      if (matches(project.name, project.displayName, project.desc, project.stage, project.id)) {
        rows.push({ source: 'workspace', kind: 'project', id: project.id, projectId: project.id,
          title: project.displayName || project.name, detail: project.stage || '' });
      }
      const milestones = Array.isArray(project.nodes) ? project.nodes : project.milestones;
      for (const milestone of Array.isArray(milestones) ? milestones : []) {
        if (!milestone) continue;
        const title = milestone.l || milestone.name || milestone.title || milestone.t;
        if (title && matches(title)) rows.push({ source: 'workspace', kind: 'milestone', projectId: project.id,
          id: milestone.id, title, detail: milestone.s || milestone.status || '' });
      }
    }
    for (const task of data.tasks || []) {
      if (matches(task.t, task.id, task.st, task.owner)) {
        rows.push({ source: 'workspace', kind: 'task', id: task.id, projectId: task.p, title: task.t, detail: task.st });
      }
    }
    return section(rows.slice(0, 60));
  }

  async function rpm(data, query) {
    const rows = [];
    let bound = 0;
    let failed = 0;
    const projects = data.projects || [];
    for (let cursor = 0; cursor < projects.length; cursor += 4) {
      const results = await Promise.allSettled(projects.slice(cursor, cursor + 4).map(async project => {
        const result = await searchRpm(project.id, query);
        if (!result.ok) {
          if (!['unbound', 'binding_missing'].includes(result.code)) failed++;
          return;
        }
        bound++;
        for (const file of result.files || []) {
          rows.push({
            source: 'rpm', kind: 'material', title: file.name || file.relative_path,
            detail: file.relative_path, path: file.relative_path, id: file.file_id, projectId: project.id
          });
        }
      }));
      failed += results.filter(result => result.status === 'rejected').length;
    }
    return section(rows.slice(0, 60), failed ? (bound ? 'partial' : 'unavailable') : bound ? '' : 'unbound');
  }

  async function notes(query) {
    const result = await listNotes({ query, limit: 30 });
    if (!result.ok) return section([], result.code || 'unavailable');
    return section(result.files.map(file => ({ source: 'vault', kind: 'note', title: file.name, path: file.path, detail: file.path })));
  }

  async function graph(query) {
    const result = await readGraph();
    if (!result.ok) return section([], 'unavailable');
    const rows = (result.nodes || []).filter(node => normalize(node.title).includes(query))
      .slice(0, 25).map(node => ({
        source: 'rpm', kind: 'node', id: node.id, title: node.title,
        detail: node.type, rpmProjectId: node.project_id
      }));
    return section(rows, result.registry_complete === false ? 'partial' : '');
  }

  return {
    async search(payload) {
      const query = String(payload?.query || '').trim();
      if (!query || query.length > 500) return { ok: false, error: '输入 1–500 个字符进行检索', results: [], sources: {} };
      const data = readWorkspace();
      const normalized = normalize(query);
      const [files, nodes, vault] = (await Promise.allSettled([
        rpm(data, query), graph(normalized), notes(query)
      ])).map(settled);
      const rpmCode = !files.code && !nodes.code ? ''
        : !nodes.code && files.code === 'unbound' ? ''
        : files.code === 'unavailable' && nodes.code === 'unavailable' ? 'unavailable' : 'partial';
      const result = [structured(data, normalized), section([...nodes.rows, ...files.rows], rpmCode), vault];
      const keys = ['workspace', 'rpm', 'vault'];
      const sources = Object.fromEntries(keys.map((key, index) => {
        const { rows, code } = result[index];
        return [key, { ok: !code, code, count: rows.length }];
      }));
      return { ok: true, results: result.flatMap(group => group.rows), sources };
    }
  };
}

module.exports = { createSearch };
