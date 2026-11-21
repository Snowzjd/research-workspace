'use strict';

const path = require('node:path');

const validId = id => typeof id === 'string' && /^[\w.-]{1,160}$/.test(id);
const clean = (input, length = 1500) => {
  if (Array.isArray(input)) input = input.filter(value => typeof value === 'string').join('\n');
  return typeof input === 'string' ? input.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, length) : '';
};

async function createHandoff({ context, readWorkspace, resolveProject, resolveReferences }) {
  const { projectId, taskId } = context || {};
  const invalid = { ok: false, code: 'invalid_context', error: '项目与任务不匹配' };
  if (!validId(projectId) || !validId(taskId)) return invalid;
  const db = readWorkspace();
  const project = Array.isArray(db.projects) && db.projects.find(row => row.id === projectId);
  const task = Array.isArray(db.tasks) && db.tasks.find(row => row.id === taskId && row.p === projectId);
  if (!project || !task) return invalid;
  const registered = await resolveProject(projectId);
  if (!registered || registered.metadataOnly || !path.isAbsolute(registered.root) || /[\r\n]/.test(registered.root)) {
    return { ok: false, code: 'unbound_project', error: '请先绑定可用于协同的 RPM 项目' };
  }
  const projectName = clean(project.name, 180) || projectId;
  const title = clean(task.t, 180) || taskId;
  const description = clean(task.description || task.note || task.notes);
  const acceptance = clean(task.acceptance || task.completionCriteria || task.definitionOfDone);
  const stage = clean(project.stage, 180);
  const references = [...new Set(clean(task.codexReferences, 1024).split(/[\s,，]+/)
    .filter(id => /^[\w.:-]{1,160}$/.test(id)))].slice(0, 12);
  if (references.length) {
    const verified = await resolveReferences(registered);
    if (!verified || references.some(id => !verified.has(id))) {
      return { ok: false, code: 'unverified_references', error: '部分资料或节点 ID 无法在当前项目核对，请检查后重试' };
    }
  }
  return {
    ok: true,
    text: [
      '科研工程工作台 · Codex 任务交接',
      '项目：' + projectName,
      '项目真实根目录：' + registered.root,
      '工作台项目 ID：' + projectId,
      stage && ('项目阶段：' + stage),
      '工作台任务 ID：' + taskId,
      '任务：' + title,
      description && ('任务要求：\n' + description),
      acceptance && ('完成条件：\n' + acceptance),
      references.length ? ('已核对的当前项目资料或节点 ID：' + references.join('、')) : '',
      '先确认 Codex 会话的工作目录是上述根目录或明确归属该项目的工作子目录。仅处理用户授权的项目文件，禁止上传敏感资料或擅自写入 RPM 索引、Obsidian 笔记与其他项目。修改原件前按会话中的授权确认。请分别列出文件变化、实际测试、仍待验证与待用户验收项。'
    ].filter(Boolean).join('\n\n')
  };
}

module.exports = { createHandoff };
