/* ==========================================================================
   交接文件 —— 不依赖任何网盘 / 局域网的搬数据方式
   - 导出：把本机数据写成一个 .json 文件（可放 U 盘、发微信、存邮箱）
   - 导入：读那个文件，走与目录同步完全相同的三方合并（有冲突照样让你逐条选）
   - 交接单：另存一份 .md，给人或给 AI 读，说清现在做到哪、下一步做什么
   与 sync-carrier 共用同一份 base.json 快照，两条路可以混着用。
   ========================================================================== */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const device = require('./device');
const syncCarrier = require('./sync-carrier');
const { merge } = require('./sync-merge');

const stateFile = () => path.join(app.getPath('userData'), 'sync', 'state.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function readState() { return readJson(stateFile()) || {}; }
function patchState(patch) {
  const next = { ...readState(), ...patch };
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    const tmp = stateFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, stateFile());
  } catch (_) {}
  return next;
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, file);
}
function localPayload() {
  const f = store.dataFile();
  if (!fs.existsSync(f)) return {};
  return readJson(f) || {};
}
function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '设备';
}

/* 建议文件名：工作台交接-<设备名>-<时间>.json / .md */
function suggestedName(kind) {
  const dev = device.info();
  const ext = kind === 'doc' ? 'md' : 'json';
  return `工作台交接-${safeName(dev.deviceName)}-${stamp()}.${ext}`;
}

/* ==========================================================================
   导出数据包
   ========================================================================== */
function exportPack(filePath, opts = {}) {
  const target = path.resolve(String(filePath || '').trim());
  if (!target) return { ok: false, error: '没有指定保存路径' };
  const dev = device.info();
  const local = localPayload();
  if (!local || !Object.keys(local).length) return { ok: false, error: '本机还没有数据可导出' };

  const payload = {
    ...local,
    __device: { deviceId: dev.deviceId, deviceName: dev.deviceName, at: Date.now(), version: app.getVersion() },
    __handoff: { kind: 'workspace-pack', v: 1, exportedAt: Date.now() }
  };
  try {
    writeJson(target, payload);
  } catch (err) {
    return { ok: false, error: '写入失败：' + String((err && err.message) || err) };
  }
  /* 把当前数据记为 base：下次对方改完带回来，就能算出「谁改了什么」
     （自检等只验证写盘能力的场景传 noBase，避免动到用户的同步基准） */
  if (!opts.noBase) {
    try { writeJson(syncCarrier.baseFile(), local); } catch (_) {}
    patchState({ lastExportAt: Date.now(), lastExportFile: target });
  }

  let bytes = 0;
  try { bytes = fs.statSync(target).size; } catch (_) {}
  return {
    ok: true, file: target, bytes,
    projects: (local.projects || []).length,
    tasks: (local.tasks || []).length,
    todos: (local.todos || []).length
  };
}

/* ==========================================================================
   导入数据包
   ========================================================================== */
function importPack(filePath, opts = {}) {
  const target = path.resolve(String(filePath || '').trim());
  if (!target) return { ok: false, error: '没有指定文件' };
  if (!fs.existsSync(target)) return { ok: false, error: '文件不存在：' + target };

  const raw = readJson(target);
  if (!raw || typeof raw !== 'object') return { ok: false, error: '这个文件不是有效的工作台数据（内容读不出来）' };
  if (!Array.isArray(raw.projects) && !Array.isArray(raw.tasks)) {
    return { ok: false, error: '这个文件里没有项目或任务，可能选错了文件' };
  }

  const meta = raw.__device || {};
  const handoff = raw.__handoff || {};
  const remote = { ...raw };
  delete remote.__device;
  delete remote.__handoff;

  const dev = device.info();
  const sameDevice = !!meta.deviceId && meta.deviceId === dev.deviceId;

  const local = localPayload();
  const base = readJson(syncCarrier.baseFile()) || {};
  const r = merge({ local, remote, base: base || undefined, choices: opts.choices || {} });
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || '合并失败' };

  const conflicts = r.conflicts || [];
  if (!opts._force && conflicts.length && !(opts.choices && Object.keys(opts.choices).length)) {
    return {
      ok: true, kind: 'handoff', applied: false, needsChoice: true, conflicts,
      stats: r.stats || {}, sameDevice,
      from: { deviceName: meta.deviceName || '', at: meta.at || handoff.exportedAt || 0, file: target }
    };
  }

  const w = store.writeData(JSON.stringify(r.data));
  if (!w.ok) return { ok: false, error: '写回本机失败：' + (w.error || '未知错误') };
  try { writeJson(syncCarrier.baseFile(), r.data); } catch (_) {}
  patchState({ lastImportAt: Date.now(), lastImportFile: target });

  return {
    ok: true, kind: 'handoff', applied: true, conflicts, stats: r.stats || {}, sameDevice,
    from: { deviceName: meta.deviceName || '', at: meta.at || handoff.exportedAt || 0, file: target },
    at: Date.now()
  };
}

/* ==========================================================================
   交接单（Markdown，给人看）
   ========================================================================== */
const strip = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const ST_TEXT = { todo: '待开始', doing: '进行中', review: '待验收', done: '已完成', blocked: '被阻塞' };
const PRI_TEXT = { high: '高', mid: '中', low: '低' };

function fmtDay(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildDoc() {
  const data = localPayload();
  const dev = device.info();
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const todos = Array.isArray(data.todos) ? data.todos : [];
  const acts = Array.isArray(data.activities) ? data.activities : [];
  const ws = data.workspace || {};
  const byProject = pid => tasks.filter(t => t.p === pid);

  const L = [];
  L.push('# 科研工作台 · 交接单');
  L.push('');
  L.push(`- 导出时间：${fmtDay(Date.now())}`);
  L.push(`- 导出设备：${strip(dev.deviceName)}（${dev.deviceId}）`);
  L.push(`- 当前工作区：${strip(ws.project) || '—'}`);
  L.push(`- 规模：${projects.length} 个项目 · ${tasks.length} 条任务 · ${todos.filter(t => !t.done).length} 条未完成待办`);
  L.push('');
  L.push('> 这份文件是给人（或给 AI）读的摘要，不参与数据合并。要让另一台设备接着干，请用同时导出的 .json 数据包。');
  L.push('');

  L.push('## 一、项目总览');
  L.push('');
  if (!projects.length) {
    L.push('_还没有项目。_');
  } else {
    L.push('| 项目 | 阶段 | 进度 | 下一步 | 周期 |');
    L.push('| --- | --- | --- | --- | --- |');
    projects.forEach(p => {
      L.push(`| ${strip(p.name)} | ${strip(p.stage) || '—'} | ${Number(p.progress) || 0}% | ${strip(p.next) || '—'} | ${strip(p.period) || '—'} |`);
    });
  }
  L.push('');

  L.push('## 二、项目明细');
  L.push('');
  if (!projects.length) {
    L.push('_无。_');
    L.push('');
  }
  projects.forEach((p, i) => {
    const ts = byProject(p.id);
    const doing = ts.filter(t => t.st === 'doing');
    const todo = ts.filter(t => t.st === 'todo' || t.st === 'review' || !t.st);
    const done = ts.filter(t => t.st === 'done');
    L.push(`### ${i + 1}. ${strip(p.name)}`);
    L.push('');
    if (p.subtitle) L.push(`- 简介：${strip(p.subtitle)}`);
    L.push(`- 阶段：${strip(p.stage) || '—'} ｜ 进度：${Number(p.progress) || 0}% ｜ 周期：${strip(p.period) || '—'}`);
    if (p.goal) L.push(`- 目标：${strip(p.goal)}`);
    if (p.next) L.push(`- 下一步：${strip(p.next)}`);
    if (p.folder) L.push(`- 材料目录：${strip(p.folder)}`);
    if ((p.tools || []).length) L.push(`- 工具：${p.tools.map(strip).join('、')}`);
    L.push('');
    if (doing.length) {
      L.push('进行中：');
      doing.forEach(t => L.push(`- [ ] ${strip(t.t)}${t.due && t.due !== '—' ? `（${strip(t.due)}）` : ''}${t.agent ? ' · ' + strip(t.agent) : ''}`));
      L.push('');
    }
    if (todo.length) {
      L.push('待开始：');
      todo.slice(0, 12).forEach(t => L.push(`- [ ] ${strip(t.t)}${t.due && t.due !== '—' ? `（${strip(t.due)}）` : ''}${t.pri ? ' · 优先级' + (PRI_TEXT[t.pri] || t.pri) : ''}`));
      if (todo.length > 12) L.push(`- …另有 ${todo.length - 12} 条`);
      L.push('');
    }
    if (done.length) {
      L.push(`已完成 ${done.length} 条：${done.slice(0, 8).map(t => strip(t.t)).join('、')}${done.length > 8 ? ' 等' : ''}`);
      L.push('');
    }
    if (!ts.length) { L.push('_这个项目还没有任务。_'); L.push(''); }
  });

  L.push('## 三、全局待办');
  L.push('');
  const open = todos.filter(t => !t.done);
  if (!open.length) L.push('_清空了。_');
  else open.forEach(t => L.push(`- [ ] ${strip(t.t)}${t.due ? `（${strip(t.due)}）` : ''}${t.pri ? ' · ' + (PRI_TEXT[t.pri] || t.pri) : ''}`));
  L.push('');

  L.push('## 四、最近活动');
  L.push('');
  if (!acts.length) L.push('_没有记录。_');
  else acts.slice(0, 20).forEach(a => L.push(`- ${strip(a.at || a.time || '')}　${strip(a.text || a.t || '')}`));
  L.push('');

  L.push('## 五、接手须知');
  L.push('');
  L.push('1. 在另一台设备上打开本软件 → 设置 → 数据与同步 → 交接文件 → 导入数据包，选中同批导出的 .json。');
  L.push('2. 导入走三方合并：只在一边改过的记录自动采用，两边都改过的会逐条让你选。');
  L.push('3. 项目材料文件（PDF、算例、图表）不在数据包里，需要单独拷贝项目目录。');
  L.push('4. 本软件的 AI 接入需要在新设备上重新填一次密钥，密钥不会被导出。');
  L.push('');

  return L.join('\n');
}

function exportDoc(filePath) {
  const target = path.resolve(String(filePath || '').trim());
  if (!target) return { ok: false, error: '没有指定保存路径' };
  let body;
  try { body = buildDoc(); } catch (err) { return { ok: false, error: '生成失败：' + String((err && err.message) || err) }; }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, 'utf8');
  } catch (err) {
    return { ok: false, error: '写入失败：' + String((err && err.message) || err) };
  }
  patchState({ lastDocAt: Date.now() });
  return { ok: true, file: target, bytes: Buffer.byteLength(body) };
}

/* 状态：设置页展示用 */
function info() {
  const st = readState();
  return {
    ok: true,
    lastExportAt: st.lastExportAt || 0,
    lastImportAt: st.lastImportAt || 0,
    lastExportFile: st.lastExportFile || '',
    lastImportFile: st.lastImportFile || ''
  };
}

module.exports = { info, exportPack, importPack, exportDoc, buildDoc, suggestedName };
