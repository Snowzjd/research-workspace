/* ==========================================================================
   个人 AI 科研工程工作台 · 视图层
   路由 / 视图渲染（纯展示，不含交互；交互见 actions.js）
   ========================================================================== */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* 全新安装预览窗口：临时数据，关闭即丢弃 */
const FRESH_PREVIEW = (() => {
  try { return new URLSearchParams(location.search).get('fresh') === '1'; } catch (_) { return false; }
})();

const state = {
  route: 'home', project: 'tpms',
  taskFilter: 'all', taskMode: 'table',
  kbCat: 'all', setTab: 'general',
  search: '', q: '',
  /* 外部 RAG 检索的运行时状态（不入库，只反映本次会话的最新探测/检索结果） */
  rag: { status: 'unknown', indexed: 0, model: '', error: '' },
  ragResults: null, ragMeta: null, ragBusy: false,
  ragToken: { stored: false, encrypted: false },
  /* 备份状态（仅本会话，来自主进程的实际文件列表） */
  backup: { count: 0, latest: null, items: [], dir: '', keep: 7 },
  device: { deviceId: '', deviceName: '' },
  /* 多设备同步（共享文件夹） */
  sync: { enabled: false, dir: '', lastSyncAt: 0, peers: [], deviceName: '' },
  /* 交接文件（导出/导入的最近时间，来自主进程的实际记录） */
  handoff: { lastExportAt: 0, lastImportAt: 0 },
  /* 账户：身份 / 本机密码 / 云端绑定（status 来自主进程） */
  auth: { ready: false, status: null, step: 'register', bind: { carrier: 'webdav', busy: false, error: '', okMsg: '' } },
  /* 应用内更新（便携版信息与更新源） */
  update: { portable: false, source: '', version: '' },
  /* AI 助手模式：聊天 / 派任务 */
  aiMode: 'chat',
  /* 项目页当前 Tab */
  projectTab: 'overview',
  /* 内置浏览器：多标签 + 真实 webview 的运行时状态 */
  webPages: [{ id: 'w1', title: '起始页', url: '' }],
  webActive: 0,
  webLoading: false,
  webError: null,
  webNav: { canBack: false, canForward: false, ready: false }
};

/* ==========================================================================
   数据变更统一出口
   - 变更前拍快照 → 可撤销
   - 变更后写盘 + 活动日志 + 重绘
   - 写操作按来源（界面 / AI 助手 / 外部 Agent）记入审计
   ========================================================================== */
const UNDO_LIMIT = 30;
const UNDO_SCOPE = ['tasks', 'todos', 'projects', 'timeline', 'kbDocs', 'apps', 'agents', 'automations'];
const undoStack = [];

const stripTags = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function snapshotData() {
  const o = {};
  UNDO_SCOPE.forEach(k => { o[k] = DB[k]; });
  return JSON.parse(JSON.stringify(o));      /* 深拷贝：后续改动不能污染快照 */
}

function restoreData(snap) {
  UNDO_SCOPE.forEach(k => { if (snap[k] !== undefined) DB[k] = snap[k]; });
}

/* 操作来源上下文：写审计与撤销都要用它区分「谁改的」 */
let _origin = { source: 'ui', actor: '你' };
function setOrigin(o) { const prev = _origin; if (o) _origin = o; return prev; }
function currentOrigin() { return _origin; }
const ORIGIN_LABEL = { ui: '界面操作', assistant: 'AI 助手', agent: '外部 Agent' };

/* 纯查询工具不写审计，避免把日志刷成噪音 */
const READ_ONLY_TOOLS = new Set([
  'get_project_context', 'list_tasks', 'list_projects', 'list_materials',
  'search_knowledge', 'list_software', 'list_automations'
]);

function shortArgs(args) {
  try {
    const o = { ...(args || {}) };
    delete o.project;
    const s = JSON.stringify(o);
    return s === '{}' ? '' : (s.length > 160 ? s.slice(0, 160) + '…' : s);
  } catch (_) { return ''; }
}

/* 审计日志：只记写操作，来源/操作者/工具/参数摘要/成败 一并落库 */
function recordAudit({ tool, args, result, label }) {  if (!Array.isArray(DB.audit)) DB.audit = [];
  const o = currentOrigin();
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const ok = !(result && result.ok === false);
  DB.audit.unshift({
    id: uid('au'),
    at: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    source: o.source,
    actor: o.actor || ORIGIN_LABEL[o.source] || '未知',
    tool,
    label: label || tool,
    ok,
    error: ok ? '' : String((result && result.error) || ''),
    args: shortArgs(args)
  });
  if (DB.audit.length > 200) DB.audit.length = 200;
}

function mutate(fn, opts = {}) {
  const origin = currentOrigin();
  const undoable = opts.undo !== false && !!opts.activity;
  if (undoable) {
    undoStack.push({
      label: opts.undoLabel || stripTags(opts.activity.text) || '数据修改',
      source: origin.source,
      actor: origin.actor,
      at: Date.now(),
      snap: snapshotData()
    });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  fn();
  if (opts.activity) logActivity(opts.activity.text, opts.activity.kind, opts.activity.color);
  persist(opts.immediate);
  if (opts.rerender !== false) render();
  return undoable ? undoStack[undoStack.length - 1] : null;
}

/* 读取真实备份状态（列的是磁盘上的文件，不是记忆里的数字） */
async function refreshBackupState() {
  try {
    state.backup = await Bridge.backupInfo();
    if (state.route === 'settings' && state.setTab === 'storage') render();
  } catch (_) {}
}

/* 撤销最近一次可撤销操作 —— 只回滚数据，不碰活动日志（历史要留痕） */
function undoLast() {
  const it = undoStack.pop();
  if (!it) { toast('没有可撤销的操作', 'err'); return false; }
  restoreData(it.snap);
  logActivity(`撤销：${esc(it.label)}`, 'edit', '#AD5700');
  persist(true);
  render();
  toast(`已撤销：<b>${esc(it.label)}</b>`, 'ok');
  return true;
}

/* 统一的工具执行入口：写操作自动进审计。
   外部 Agent（HTTP/MCP）与内置 AI 助手都走这里，保证口径一致。 */
async function executeTool(name, args) {
  const isWrite = !READ_ONLY_TOOLS.has(name);
  const origin = currentOrigin();
  /* 写操作先拍快照：Agent 与内置助手改动的东西，用户同样能撤销 */
  const snap = isWrite ? snapshotData() : null;

  let res;
  try {
    res = await AI_TOOL_IMPL[name](args);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }

  if (isWrite) {
    const label = (typeof TOOL_LABEL !== 'undefined' && TOOL_LABEL[name]) || name;
    recordAudit({ tool: name, args, result: res, label });
    if (res && res.ok !== false && snap) {
      undoStack.push({
        label: label + (origin.source === 'agent' ? `（${origin.actor || '外部 Agent'}）` : ''),
        source: origin.source, actor: origin.actor, at: Date.now(), snap
      });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
  }
  return res;
}

/* ==========================================================================
   通用片段
   ========================================================================== */
function appTile(name, size = 20) {
  const a = APP(name) || { ico: String(name).slice(0, 2).toUpperCase(), bg: 'linear-gradient(135deg,#9C93C4,#5B4C9E)' };
  /* 小方块里塞 3 个字母必然溢出：小尺寸降为双字母，字号兜到 9px */
  const raw = String(a.ico);
  const cjk = /[^\x00-\x7F]/.test(raw);
  const limit = cjk ? 1 : 2;
  const label = (size < 24 && raw.length > limit) ? raw.slice(0, limit) : raw;
  const fs = size < 16 ? Math.round(size * 0.72) : Math.max(9, Math.round(size * 0.4));
  return `<span class="app-tile" style="width:${size}px;height:${size}px;flex:0 0 ${size}px;background:${a.bg};font-size:${fs}px;overflow:hidden;letter-spacing:-0.03em">${esc(label)}</span>`;
}
function agentTile(name, size = 26) {
  const c = AGENT_COLORS[name] || { bg: 'linear-gradient(135deg,#B8B8C4,#7A7A87)', ico: 'bot' };
  const hasPath = !!ICON_PATHS[c.ico];
  const inner = hasPath ? icon(c.ico) : `<span style="font-size:${Math.round(size * 0.5)}px;font-weight:800">${esc(c.ico)}</span>`;
  return `<span class="app-tile" style="width:${size}px;height:${size}px;flex:0 0 ${size}px;background:${c.bg};${hasPath ? `font-size:${Math.round(size * 0.55)}px` : ''}">${inner}</span>`;
}
const AG_ST = { running: { l: '运行中', c: '' }, busy: { l: '忙碌', c: 'busy' }, idle: { l: '待命', c: 'idle' } };
const liveBadge = st => { const s = AG_ST[st] || AG_ST.idle; return `<span class="badge-live ${s.c}"><i class="d"></i>${s.l}</span>`; };

const PRI = { high: { l: '高', c: 'high' }, mid: { l: '中', c: 'mid' }, low: { l: '低', c: 'low' } };
const priTag = p => { const x = PRI[p] || PRI.mid; return `<span class="pri ${x.c}"><i class="pd"></i>${x.l}</span>`; };
const ST_MAP = { todo: ['待处理', 'gray'], doing: ['进行中', 'accent'], review: ['待复核', 'amber'], done: ['已完成', 'emerald'] };
const stChip = s => { const [l, c] = ST_MAP[s] || ['—', 'gray']; return `<span class="chip ${c}">${l}</span>`; };

/* ==========================================================================
   项目卡片
   ========================================================================== */
function projectCard(p, big) {
  /* S1：信息层级 = 显示名 > 阶段+进度 > 未完成数/下一阶段/最近活动 */
  const name = p.displayName || p.name;
  const openTasks = DB.tasks.filter(t => t.p === p.id && t.st !== 'done').length;
  const done = p.nodes.filter(n => n.s !== 'todo').length;
  const fill = p.nodes.length > 1 ? Math.max(0, (done - 1) / (p.nodes.length - 1) * 100) : 100;
  const lastAct = (DB.activities || []).find(a => String(a.text || '').includes(p.name));

  return `<article class="card proj-card ${state.project === p.id ? 'selected' : ''}" data-project="${p.id}" title="点击进入项目">
    <div class="proj-card-head">
      <div class="grow" style="min-width:0">
        <h4>${esc(name)}</h4>
        <p>${esc(p.subtitle || p.goal || '未填写简介')}</p>
      </div>
      <button class="proj-more" data-act="project-menu" data-id="${p.id}" title="项目操作">${icon('more')}</button>
    </div>
    <div class="thumb">${thumbSVG(p.thumb, p.seed)}</div>

    <div class="proj-line1">
      <span class="proj-stage">${esc(p.stage || '未设置阶段')}</span>
      <span class="grow"></span>
      <span class="proj-pct">${p.progress || 0}%</span>
    </div>
    <span class="bar" style="display:block;margin:2px 0 8px"><i style="width:${p.progress || 0}%"></i></span>

    <div class="proj-line2">
      <span class="proj-kpi ${openTasks ? 'hot' : ''}">${openTasks ? openTasks + ' 个未完成' : '任务已清空'}</span>
      <span class="proj-next">${p.next ? '下一步：' + esc(p.next) : ''}</span>
    </div>
    ${lastAct ? `<div class="proj-recent" title="${esc(String(lastAct.text).replace(/<[^>]+>/g, ''))}">
      ${icon('clock')}${esc(String(lastAct.text).replace(/<[^>]+>/g, '').slice(0, 34))}
    </div>` : ''}

    <div class="stepper">
      <span class="step-line"><i style="width:${fill}%"></i></span>
      ${p.nodes.map(n => `<span class="step ${n.s !== 'todo' ? 'done' : ''}"><span class="node"></span><span class="lbl">${esc(n.l)}</span></span>`).join('')}
    </div>
    ${big ? `<div class="row mt-10" style="gap:6px;flex-wrap:wrap">
        ${(p.agents || []).filter(n => DB.agents.some(a => a.name === n))
          .map(a => `<span class="chip accent">${esc(a)}</span>`).join('')}
        <span class="grow"></span>
        <span class="mono muted" style="font-size:9.5px">${esc(p.period || '')}</span>
      </div>` : ''}
  </article>`;
}


/* ==========================================================================
   项目详情
   ========================================================================== */
function detailCard(p) {
  const agent = p.owner.agent;
  const fileCount = materialsIn(p.id).length;
  return `<div class="card panel">
    <div class="detail-hero">
      <div class="thumb">${thumbSVG(p.thumb, p.seed)}</div>
      <div class="detail-hero-body">
        <div class="detail-title-row">
          <h2>${esc(p.name)}</h2>
          <span class="badge-live"><i class="d"></i>进行中</span>
          <span class="grow"></span>
          <button class="btn sm primary" data-act="project-open" data-id="${p.id}">${icon('grid')}项目页</button>
          <button class="btn sm" data-act="ai-open-project" data-id="${p.id}">${icon('sparkles')}AI 助手</button>
          <button class="btn sm" data-act="open-project-folder" data-id="${p.id}">${icon('folderOpen')}打开目录</button>
          <button class="btn sm" data-act="edit-project" data-id="${p.id}">${icon('pencil')}编辑</button>
        </div>
        <p class="detail-sub">${esc(p.goal)}</p>
        <div class="detail-meta">
          ${p.tags.map(t => `<span class="meta-pill">${icon('target')}${esc(t)}</span>`).join('')}
          <span class="meta-pill">${icon('calendar')}<b>${esc(p.period)}</b></span>
          <span class="meta-pill">${icon('user')}<b>${p.members.length} 人</b> · ${p.members.map(m => esc(m.n)).join(' / ')}</span>
          <span class="meta-pill">${icon('folder')}<b>${projectFolderCount(p.id)} 个材料目录</b> · ${fileCount} 个文件</span>
          ${p.next ? `<span class="meta-pill">${icon('chevronRight')}下一步 <b>${esc(p.next)}</b></span>` : ''}
        </div>
        <div class="row mt-10" style="gap:9px">
          <span class="bar" style="flex:1"><i style="width:${p.progress}%"></i></span>
          <span class="mono" style="font-size:11px;font-weight:660;color:var(--accent-600)">整体进度 ${p.progress}%</span>
        </div>
        <div class="row mt-10" style="gap:5px">
          ${icon('folder', 'color:var(--text-4);width:11px;height:11px')}
          <span class="mono muted" style="font-size:9.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(projectDir(p))}</span>
        </div>
      </div>
    </div>

    ${(() => {
      /* v2.8.6：删掉三列空壳后，这里放本项目真实任务，不留空白 */
      const mine = DB.tasks.filter(t => t.p === p.id);
      const open = mine.filter(t => t.st !== 'done');
      const doneN = mine.length - open.length;
      const rows = open.slice(0, 4);
      return `<div class="detail-tasks">
        <div class="dt-head">
          <h5>本项目任务</h5>
          <span class="dt-count">${open.length} 个未完成${doneN ? ` · ${doneN} 个已完成` : ''}</span>
          <span class="grow"></span>
          <button class="head-link" data-act="project-tab" data-v="tasks">全部 ${mine.length} 个 ${icon('chevronRight')}</button>
          <button class="head-link" data-act="new-task">${icon('plus')}新建</button>
        </div>
        ${rows.length ? `<div class="dt-list">
          ${rows.map(t => `<div class="dt-row" data-act="open-task" data-idx="${DB.tasks.indexOf(t)}">
            <span class="dt-dot ${t.st === 'doing' ? 'doing' : ''}"></span>
            <span class="dt-name">${esc(t.t)}</span>
            ${t.agent ? `<span class="dt-agent">${esc(t.agent)}</span>` : ''}
            <span class="dt-due">${esc(t.due || '')}</span>
          </div>`).join('')}
          ${open.length > 4 ? `<div class="dt-more">还有 ${open.length - 4} 个未完成，点右上「全部」查看</div>` : ''}
        </div>` : `<div class="dt-empty">
          <span>本项目还没有未完成任务</span>
          <button class="btn sm" data-act="new-task">${icon('plus')}建一个</button>
        </div>`}
      </div>`;
    })()}

    <div class="detail-foot">
      <div>
        <h5>负责人 / Agent</h5>
        <div class="owner-row">
          <span class="avatar">${esc(p.owner.n.slice(0, 1))}</span>
          <div><div class="o-name">${esc(p.owner.n)}</div><div class="o-sub">${esc(p.owner.r)}</div></div>
          <span class="grow"></span>
          <span class="agent-chip">${agentTile(agent, 22)}<span>${esc(agent)}</span></span>
        </div>
      </div>
      <div>
        <h5>涉及软件</h5>
        <div class="row" style="flex-wrap:wrap;gap:6px">
          ${p.tools.map(t => `<span class="chip gray">${appTile(t, 13)}${esc(t)}</span>`).join('')}
        </div>
        <div class="row mt-10"><span class="mono muted" style="font-size:9.5px">${esc(p.git)}</span></div>
      </div>
      <div>
        <h5>关键节点状态</h5>
        <div class="node-track">
          ${flowNodesOf(p).map(n => `<div class="node-item ${n.s}">
            <span class="ni-line"></span><span class="ni-dot"></span>
            <span class="ni-lbl">${esc(n.l)}</span><span class="ni-date">${esc(n.d)}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   项目流程
   ========================================================================== */
/* 流程节点唯一数据源 = p.nodes。p.flow 只作老数据兜底，不再用固定名字猜位置。 */
function flowNodesOf(p) {
  if (Array.isArray(p.nodes) && p.nodes.length) {
    return p.nodes.map(n => ({ l: String(n.l || ''), s: n.s || 'todo', d: String(n.d || '') }));
  }
  const flow = Array.isArray(p.flow) ? p.flow : [];
  return flow.map((l, i) => ({ l, s: i === 0 ? 'current' : 'todo', d: '' }));
}

/* 当前节点：current 优先；无 current 取第一个未完成；全完成取最后一个 */
function flowCurrentIndex(nodes) {
  const ci = nodes.findIndex(n => n.s === 'current');
  if (ci >= 0) return ci;
  const ti = nodes.findIndex(n => n.s !== 'done');
  return ti >= 0 ? ti : Math.max(0, nodes.length - 1);
}

const FLOW_STATE_TEXT = { done: '已完成', current: '进行中', todo: '待开始' };

/* 流程节点写回的唯一入口：nodes / flow / stage / progress 一次同步，避免各入口各写一套。
   推进语义：原来有「进行中」，保存后没有（通常是把它标成已完成）→ 自动把下一个未完成阶段接为进行中，
   否则流程会断在「没人正在做」。用户主动把所有阶段设成待开始的情况也走这条，同样补上第一个。 */
function applyFlowNodes(p, nodes, activityText) {
  const list = nodes.map(n => ({ l: String(n.l || ''), s: n.s || 'todo', d: String(n.d || '') }));
  const hadCurrent = (p.nodes || []).some(n => n && n.s === 'current');
  const curCount = list.filter(n => n.s === 'current').length;

  let advanced = '';
  if (curCount === 0) {
    const firstOpen = list.find(n => n.s !== 'done');
    if (firstOpen) { firstOpen.s = 'current'; if (hadCurrent) advanced = firstOpen.l; }
  } else if (curCount > 1) {
    /* 只留第一个进行中 */
    let seen = false;
    list.forEach(n => { if (n.s === 'current') { if (seen) n.s = 'todo'; seen = true; } });
  }

  const total = list.length || 1;
  const done = list.filter(n => n.s === 'done').length;
  const cur = list.find(n => n.s === 'current');
  const last = list[list.length - 1] || {};

  mutate(() => {
    p.nodes = list;
    p.flow = list.map(n => n.l);
    p.stage = cur ? cur.l : (last.l || p.stage);
    p.progress = Math.round(done / total * 100);
  }, { activity: { text: activityText, kind: 'flow', color: '#0D7485' } });

  return { advanced, total, done };
}

function flowCard(p) {
  const nodes = flowNodesOf(p);
  if (!nodes.length) {
    return `<div class="card panel flow-card">
      <div class="panel-head"><h3>${icon('branch')}项目流程</h3>
        <span class="head-sub">${esc(p.displayName || p.name)}</span>
        <button class="head-link" data-act="flow-edit" data-id="${p.id}">${icon('plus')}添加阶段</button>
      </div>
      <div class="empty">${icon('branch')}<div>还没有阶段</div>
        <div class="field-hint" style="margin-top:4px">点「添加阶段」建出你的研究流程</div></div>
    </div>`;
  }
  const ci = flowCurrentIndex(nodes);
  const hasCurrent = nodes.some(n => n.s === 'current');
  const doneCount = nodes.filter(n => n.s === 'done').length;
  const cur = nodes[ci] || {};

  return `<div class="card panel flow-card">
    <div class="panel-head">
      <h3>${icon('branch')}项目流程</h3>
      <span class="head-sub">${esc(p.displayName || p.name)}</span>
      <button class="head-link" data-act="flow-edit" data-id="${p.id}">${icon('pencil')}编辑流程</button>
      <button class="head-link" data-act="new-task">${icon('plus')}新建任务</button>
    </div>
    <div class="flow-track">
      ${nodes.map((n, i) => {
        const st = n.s === 'done' ? 'done' : (n.s === 'current' ? 'active' : '');
        return `${i ? `<span class="flow-arrow">${icon('chevronRight')}</span>` : ''}
        <button class="flow-node ${st}" data-act="flow-node" data-id="${p.id}" data-idx="${i}" title="点击管理这个阶段">
          <span class="fn-ico">${icon(n.s === 'done' ? 'check' : (n.s === 'current' ? 'pulse' : 'target'))}</span>
          <span class="fn-name">${esc(n.l)}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="row mt-10" style="gap:6px;flex-wrap:wrap">
      <span class="chip ${hasCurrent ? 'accent' : 'amber'}">当前：${esc(cur.l || '—')}${hasCurrent ? '' : '（未标记进行中）'}</span>
      ${cur.d ? `<span class="chip gray">节点日期 ${esc(cur.d)}</span>` : ''}
      <span class="grow"></span>
      <span class="mono muted" style="font-size:9.5px">已完成 ${doneCount}/${nodes.length} 个阶段</span>
    </div>
  </div>`;
}

/* 只留「实质性变化」：项目进程、任务、文件/材料、流程、软件操作。
   切换工作区、进入项目、纯浏览这类噪音不进列表。 */
const ACTIVITY_NOISE_KIND = new Set(['switch', 'nav', 'view']);
const ACTIVITY_NOISE_TEXT = /切换工作区|进入项目|当前工作区|打开了|查看/;

function activityList(max = 6) {
  return DB.activities.filter(a => {
    if (ACTIVITY_NOISE_KIND.has(a.kind)) return false;
    const plain = String(a.t || '').replace(/<[^>]+>/g, '');
    return !ACTIVITY_NOISE_TEXT.test(plain);
  }).slice(0, max);
}

function activityCard() {
  const list = activityList(6);
  return `<div class="card panel activity-card">
    <div class="panel-head"><h3>${icon('pulse')}最近活动</h3>
      <span class="head-sub">进程 / 文件 / 流程变化</span>
      <button class="head-link" data-act="all-activity">全部活动 ${icon('chevronRight')}</button></div>
    <div class="activity-list">
      ${list.map(a => {
        const idx = DB.activities.indexOf(a);
        return `<button class="activity-row activity-btn" data-act="activity-view" data-idx="${idx}" title="点开查看详情">
          <span class="a-dot" style="background:${a.c}">${icon(a.i)}</span>
          <span class="a-txt">${a.t}</span>
          <span class="a-time">${esc(a.time)}</span>
        </button>`;
      }).join('') || `<div class="empty">${icon('pulse')}<div>暂无项目变动</div>
        <div class="field-hint" style="margin-top:4px">建任务、改流程、存文档、同步材料都会记在这里</div></div>`}
    </div>
  </div>`;
}

const TODO_CATS = [['task', '任务'], ['meeting', '会议'], ['deadline', '截止日期'], ['other', '其他']];
function todoRow(t, i) {
  return `<div class="todo-row ${t.done ? 'done' : ''}" data-cat="${esc(t.cat)}">
    <span class="cb ${t.done ? 'done' : ''}" data-act="toggle-todo" data-idx="${i}" role="checkbox" aria-checked="${t.done}">${t.done ? icon('check') : ''}</span>
    <span class="t-txt">${esc(t.t)}</span>
    ${priTag(t.pri)}
    <span class="t-time">${esc(t.due)}</span>
    <span class="t-actions">
      <button data-act="edit-todo" data-idx="${i}" title="编辑">${icon('pencil')}</button>
      <button class="del" data-act="del-todo" data-idx="${i}" title="删除">${icon('trash')}</button>
    </span>
  </div>`;
}
function todoCard() {
  const list = DB.todos.slice(0, 7);
  return `<div class="card panel fill-card">
    <div class="panel-head">
      <h3>${icon('tasks')}待办事项</h3>
      <span class="head-sub">${DB.todos.filter(t => !t.done).length} 项未完成</span>
      <span class="grow"></span>
      <button class="btn sm primary" data-act="new-todo">${icon('plus')}新建任务</button>
    </div>
    <div class="tabs" style="margin-bottom:9px">
      <button class="tab active" data-tab="todo" data-val="all">全部</button>
      ${TODO_CATS.map(([k, l]) => `<button class="tab" data-tab="todo" data-val="${k}">${l}</button>`).join('')}
    </div>
    <div class="todo-list" id="todo-list">
      ${list.map((t, i) => todoRow(t, i)).join('') || `<div class="empty">${icon('tasks')}<div>暂无待办，点击右上角新建</div></div>`}
    </div>
  </div>`;
}

function resourceCard() {
  const cats = [['all', '全部'], ['doc', '研究文档'], ['data', '数据集'], ['ref', '参考文献'], ['code', '代码']];
  return `<div class="card panel fill-card">
    <div class="panel-head">
      <h3>${icon('book')}研究资源</h3>
      <span class="grow"></span>
      <button class="head-link" data-act="open-root-folder">打开资源库 ${icon('chevronRight')}</button>
    </div>
    <div class="tabs" style="margin-bottom:9px">
      ${cats.map(([k, l], i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="res" data-val="${k}">${l}</button>`).join('')}
    </div>
    <div class="res-list" id="res-list">
      ${DB.resources.map(r => `<div class="res-row" data-cat="${r.cat}" data-act="open-res" data-name="${esc(r.n)}" title="点击打开：${esc(projectDir(r.p) + '\\' + r.dir)}">
        <span class="r-ico" style="background:${fileType(r.ext).c}">${icon(extIcon(r.ext))}</span>
        <span class="r-name">${esc(r.n)}</span>
        <span class="r-size">${esc(r.size)}</span>
        <span class="r-date">${esc(r.date)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ==========================================================================
   视图：首页
   ========================================================================== */
/* 空工作区：新装软件只有它，不预置任何示例项目 */
function emptyWorkspace(opts = {}) {
  /* 首次使用给完整介绍；之后删光项目只给简洁提示，不重复引导 */
  const firstRun = opts.firstRun != null ? opts.firstRun : !DB.settings.onboarded;
  const full = opts.full !== false && firstRun;
  return `<div class="fade-in">
    <div class="card panel welcome">
      <div class="wl-hero">
        <span class="wl-ico">${icon('sparkles')}</span>
        <h2>${esc(opts.title || (firstRun ? '从这里开始' : '还没有项目'))}</h2>
        <p>${opts.desc || (firstRun
          ? '这个工作台不预置任何示例数据。新建项目时可选「标准模板」（带阶段流程、材料目录和 3 条起始任务）或「空白项目」（只有 01_资料 目录）——阶段、材料、任务会一起搭好。'
          : '新建一个项目，或从上次的备份里恢复。')}</p>
        <div class="row" style="justify-content:center;gap:8px;margin-top:16px">
          <button class="btn primary" data-act="new-project">${icon('plus')}新建第一个项目</button>
          <button class="btn" data-act="goto-external">${icon('bot')}让 Agent 管理</button>
        </div>
      </div>
      ${full ? `<div class="wl-grid">
        <div class="wl-card">
          <div class="wl-t">${icon('layers')}一个模板</div>
          <div class="wl-d">${esc(PROJECT_TEMPLATE.name)}：${esc(PROJECT_TEMPLATE.flow.join(' → '))}，
            自动建好 ${PROJECT_TEMPLATE.dirs.length} 类材料目录和 ${PROJECT_TEMPLATE.tasks.length} 条起始任务。</div>
        </div>
        <div class="wl-card">
          <div class="wl-t">${icon('bot')}也可以交给 Agent</div>
          <div class="wl-d">外部 Agent 通过 MCP 接入后可以创建项目、拆任务、更新进度；
            每个写操作都记审计，也能撤销。</div>
          <button class="btn sm" style="margin-top:10px" data-act="goto-external">${icon('externalLink')}查看接入方式</button>
        </div>
        <div class="wl-card">
          <div class="wl-t">${icon('shield')}数据在你自己机器上</div>
          <div class="wl-d">本机 JSON 存储 + 每日自动备份，不经过任何服务器。
            工作区根目录可以自己指定。</div>
        </div>
      </div>` : ''}
    </div>
  </div>`;
}

/* 首页 = 项目总览（Sprint A：合并原「首页」与「项目总览」双入口） */
function homeView() {
  if (!DB.projects.length) return emptyWorkspace({ full: true });
  const q = (state.search || '').toLowerCase();
  const list = DB.projects.filter(p => !q || (p.name + p.subtitle + p.stage).toLowerCase().includes(q));
  const sel = P(state.project) || DB.projects[0];
  const dueTodos = DB.todos.filter(t => !t.done).length;
  return `<div class="fade-in">
    <div class="page-head">
      <h2>我的项目</h2>
      <span class="page-sub">共 ${DB.projects.length} 个项目 · ${DB.tasks.filter(t => t.st !== 'done').length} 个未完成任务 · ${dueTodos} 条待办</span>
      <span class="ph-right">
        <label class="search" style="max-width:170px;height:29px">
          ${icon('search', 'color:var(--text-4)')}
          <input placeholder="筛选项目…" data-input="filter-projects" value="${esc(state.search)}">
        </label>
        <button class="btn sm" data-act="open-root-folder">${icon('folderOpen')}工作区</button>
        <button class="btn sm primary" data-act="new-project">${icon('plus')}新建项目</button>
      </span>
    </div>
    ${(() => {
      /* Sprint F：跨项目「今日到期」聚合（不占侧栏入口） */
      const isToday = (d) => /今天/.test(String(d || ''));
      const items = [
        ...DB.tasks.filter(t => t.st !== 'done' && isToday(t.due)).map(t => ({ kind: '任务', text: t.t, due: t.due, pid: t.p })),
        ...DB.todos.filter(t => !t.done && isToday(t.due)).map(t => ({ kind: '待办', text: t.t, due: t.due, pid: t.p || state.project }))
      ];
      if (!items.length) return '';
      return `<div class="today-bar">
        <span class="tb-ico">${icon('clock')}</span>
        <b>今日到期 ${items.length} 项</b>
        <span class="tb-list">${items.slice(0, 3).map(i => `${esc(i.text)}<span class="tb-due">${esc(i.due)}</span>`).join('　·　')}</span>
        ${items.length > 3 ? `<span class="muted">等 ${items.length} 项</span>` : ''}
      </div>`;
    })()}
    <div class="projects-grid">${list.map(p => projectCard(p, true)).join('')}</div>
    ${list.length ? '' : `<div class="empty">${icon('grid')}<div>没有匹配的项目</div></div>`}

    <div class="detail-grid" style="margin-top:var(--gap)">
      <div class="detail-main">${detailCard(sel)}</div>
      <div class="detail-side">${flowCard(sel)}${activityCard()}</div>
    </div>
    <div class="bottom-grid bottom-grid-2">${todoCard()}${resourceCard()}</div>
  </div>`;
}

/* ==========================================================================
   视图：项目总览
   ========================================================================== */
function projectsView() {
  const q = (state.search || '').toLowerCase();
  const list = DB.projects.filter(p => !q || (p.name + p.subtitle + p.stage).toLowerCase().includes(q));
  return `<div class="fade-in">
    <div class="page-head">
      <h2>项目总览</h2>
      <span class="page-sub">共 ${DB.projects.length} 个科研项目 · 当前工作区 ${esc(P(state.project) ? P(state.project).name : '—')}</span>
      <span class="ph-right">
        <label class="search" style="max-width:200px;height:29px">
          ${icon('search', 'color:var(--text-4)')}
          <input placeholder="筛选项目…" data-input="filter-projects" value="${esc(state.search)}">
        </label>
        <button class="btn sm" data-act="open-root-folder">${icon('folderOpen')}打开工作区</button>
        <button class="btn sm primary" data-act="new-project">${icon('plus')}新建项目</button>
      </span>
    </div>
    <div class="projects-grid">${list.map(p => projectCard(p, true)).join('')}</div>
    ${!DB.projects.length ? emptyWorkspace({ title: '还没有项目', full: true }) : (list.length ? '' : `<div class="empty">${icon('grid')}<div>没有匹配的项目</div></div>`)}
  </div>`;
}

/* ==========================================================================
   视图：任务中心
   ========================================================================== */
function tasksView() {
  const filter = state.taskFilter;
  const all = DB.tasks;
  const rows = all.filter(t => filter === 'all' || t.st === filter);
  const tabs = [['all', '全部', all.length], ...DB.taskStatus.map(s => [s.key, s.label, all.filter(t => t.st === s.key).length])];
  const priOrder = { high: 0, mid: 1, low: 2 };
  const sorted = rows.slice().sort((a, b) => (priOrder[a.pri] - priOrder[b.pri]) || String(a.due).localeCompare(String(b.due)));

  const table = `<div class="card panel" style="padding:14px 2px 4px">
    <div class="table-wrap">
    <table class="table">
      <thead><tr>
        <th style="width:26%">任务名称</th><th>所属项目</th><th>负责 Agent</th><th>工具</th>
        <th>截止</th><th>优先级</th><th>状态</th><th style="text-align:right">材料</th>
      </tr></thead>
      <tbody>${sorted.map(t => {
        const p = P(t.p), i = all.indexOf(t);
        return `<tr data-act="open-task" data-idx="${i}" title="点击查看任务详情与材料目录">
          <td><div class="t-title">${esc(t.t)}</div><div class="t-sub">${icon('folder', 'width:10px;height:10px')} ${esc(t.dir || '—')}</div></td>
          <td><span class="chip gray">${esc(p ? p.name : '—')}</span></td>
          <td><span class="row" style="gap:6px">${agentTile(t.agent, 20)}<span style="font-weight:560">${esc(t.agent)}</span></span></td>
          <td><span class="row" style="gap:5px">${appTile(t.tool, 16)}<span class="muted">${esc(t.tool)}</span></span></td>
          <td class="mono muted" style="white-space:nowrap">${esc(t.due)}</td>
          <td>${priTag(t.pri)}</td>
          <td>${stChip(t.st)}</td>
          <td style="text-align:right"><button class="btn sm ghost" data-act="open-task-folder" data-idx="${i}" title="打开材料文件夹">${icon('folderOpen')}打开</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    </div>
    ${sorted.length ? '' : `<div class="empty">${icon('tasks')}<div>${DB.projects.length ? '该状态下暂无任务' : '还没有项目，先建一个项目再拆任务'}</div>
      ${DB.projects.length ? '' : `<button class="btn sm primary" data-act="new-project" style="margin-top:10px">${icon('plus')}新建项目</button>`}</div>`}
  </div>`;

  const kanban = `<div class="kanban">${DB.taskStatus.map(s => {
    const list = all.filter(t => t.st === s.key);
    return `<div class="kanban-col">
      <h4><span class="sb-dot" style="background:${s.color}"></span>${s.label}<span class="kb-count">${list.length}</span></h4>
      ${list.map(t => `<div class="kanban-card" data-act="open-task" data-idx="${all.indexOf(t)}">
        <h5>${esc(t.t)}</h5>
        <div class="row" style="gap:5px;flex-wrap:wrap">
          <span class="chip gray">${esc(P(t.p) ? P(t.p).name : '—')}</span>${priTag(t.pri)}
        </div>
        <div class="kc-foot">${agentTile(t.agent, 20)}<span class="muted" style="font-size:10.5px">${esc(t.agent)}</span>
          <span class="kc-due">${esc(t.due)}</span></div>
      </div>`).join('')}
    </div>`;
  }).join('')}</div>`;

  const doing = all.filter(t => t.st === 'doing').length;
  const done = all.filter(t => t.st === 'done').length;
  return `<div class="fade-in">
    <div class="page-head">
      <h2>任务中心</h2>
      <span class="page-sub">共 ${all.length} 个任务 · 进行中 ${doing} · 完成率 ${all.length ? Math.round(done / all.length * 100) : 0}%</span>
      <span class="ph-right">
        <div class="tabs">${tabs.map(([k, l, n]) => `<button class="tab ${k === filter ? 'active' : ''}" data-tab="task" data-val="${k}">${l} ${n}</button>`).join('')}</div>
        <div class="tabs">
          <button class="tab ${state.taskMode === 'table' ? 'active' : ''}" data-tab="taskmode" data-val="table" title="列表视图">${icon('list')}</button>
          <button class="tab ${state.taskMode === 'kanban' ? 'active' : ''}" data-tab="taskmode" data-val="kanban" title="看板视图">${icon('columns')}</button>
        </div>
        <button class="btn sm primary" data-act="new-task">${icon('plus')}新建任务</button>
      </span>
    </div>
    ${state.taskMode === 'table' ? table : kanban}
  </div>`;
}

/* ==========================================================================
   视图：时间线
   ========================================================================== */
function timelineView() {
  if (!DB.projects.length) return emptyWorkspace({ title: '还没有排期', desc: '新建项目后会按研究周期自动生成甘特条。' });

  const M = DB.months.length;
  const now = new Date();
  const nowPct = ((now.getMonth() + (now.getDate() - 1) / 30) / 12) * 100;
  const md = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = md(now);

  /* 里程碑：未完成任务里截止日期最近的几条 */
  const milestones = DB.tasks
    .filter(t => t.st !== 'done' && t.due && t.due !== '—')
    .slice().sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 4);

  /* 风险：已过期未完成 + 待复核。全部来自真实任务，不写死 */
  const overdue = DB.tasks.filter(t => t.st !== 'done' && t.due && t.due !== '—' && String(t.due) < today);
  const review = DB.tasks.filter(t => t.st === 'review');
  const risks = [
    ...overdue.map(t => [t, 'high', `已逾期（${t.due}）`]),
    ...review.map(t => [t, 'mid', '待复核'])
  ].slice(0, 5);

  return `<div class="fade-in">
    <div class="page-head">
      <h2>时间线</h2><span class="page-sub">${now.getFullYear()} 年度科研项目排期（甘特视图）</span>
      <span class="ph-right">
        <button class="btn sm" data-act="timeline-today">回到今天</button>
        <button class="btn sm primary" data-act="new-project">${icon('plus')}新建项目</button>
      </span>
    </div>
    <div class="card panel">
      <div class="gantt">
        <div class="gantt-head"><div></div><div class="gantt-months">${DB.months.map(m => `<span>${m}</span>`).join('')}</div></div>
        ${DB.timeline.map(row => `<div class="gantt-row">
          <div class="gantt-label">${esc(row.p)}</div>
          <div class="gantt-track">
            <div style="position:absolute;left:${nowPct}%;top:0;bottom:0;width:1px;background:var(--accent-400);opacity:.6"></div>
            ${row.bars.map(b => `<div class="gantt-bar" data-act="gantt-bar" data-p="${esc(row.p)}" data-l="${esc(b.l)}" title="${esc(row.p)} · ${esc(b.l)}" style="left:${b.s / M * 100}%;width:${Math.max(3, (b.e - b.s) / M * 100)}%;background:linear-gradient(135deg,${b.c},${b.c}cc)">${esc(b.l)}</div>`).join('')}
          </div>
        </div>`).join('')}
      </div>
      <div class="legend">
        ${[['#C9256B', '结构/设计'], ['#6E56CF', '仿真/计算'], ['#AD5700', '优化/算法'], ['#218358', '实验/测试'], ['#3E63DD', '建模/方案']]
          .map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}
        <span class="grow"></span>
        <span class="mono muted" style="font-size:10px">红色竖线 = 今天</span>
      </div>
    </div>
    <div class="bottom-grid mt-14">
      <div class="card panel">
        <div class="panel-head"><h3>${icon('target')}关键里程碑</h3>
          <span class="head-sub">按截止日期</span></div>
        ${milestones.map(t => {
          const p = P(t.p);
          return `<div class="activity-row">
            <span class="a-dot" style="background:${p ? p.accent : 'var(--text-4)'}">${icon('target')}</span>
            <span class="a-txt">${esc(t.t)}</span><span class="a-time">${esc(t.due)}</span></div>`;
        }).join('') || `<div class="empty" style="padding:14px">${icon('target')}<div>还没有带截止日期的任务</div></div>`}
      </div>
      <div class="card panel">
        <div class="panel-head"><h3>${icon('chart')}进度分布</h3></div>
        ${DB.projects.map(p => `<div style="margin-bottom:9px">
          <div class="row" style="font-size:10.5px;margin-bottom:4px"><span>${esc(p.name)}</span>
            <span class="grow"></span><span class="mono muted">${p.progress}%</span></div>
          <span class="bar"><i style="width:${p.progress}%;background:linear-gradient(90deg,${p.accent}bb,${p.accent})"></i></span>
        </div>`).join('')}
      </div>
      <div class="card panel">
        <div class="panel-head"><h3>${icon('alert')}风险与阻塞</h3>
          <span class="head-sub">${risks.length} 项</span></div>
        ${risks.map(([t, pri, why]) => `<div class="todo-row">
          <span class="t-txt">${esc(t.t)}<span class="muted" style="font-size:9.5px"> · ${esc(why)}</span></span>${priTag(pri)}
        </div>`).join('') || `<div class="empty" style="padding:14px">${icon('check')}<div>没有逾期或待复核的任务</div></div>`}
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   视图：知识库
   ========================================================================== */
function knowledgeView() {
  const cats = [['all', '全部'], ['论文', '论文'], ['报告', '报告'], ['专利', '专利'], ['数据', '数据'], ['代码', '代码']];
  const S = DB.settings;
  const ragOn = !!S.ragEnabled;
  const rs = state.rag || {};
  const q = state.q;
  const hits = state.ragResults;

  /* 两种数据来源：外部 RAG 返回的原文片段，或本地资料清单。
     mode 决定界面上显示的通道说明，避免把"名称匹配"说成语义检索。 */
  let docs, mode;
  if (Array.isArray(hits)) {
    mode = 'rag';
    docs = hits.map((h, i) => ({
      n: h.title, type: h.docType || '资料', ext: h.ext || 'pdf',
      score: h.score, snippet: h.snippet, path: h.path, page: h.page, _i: i
    }));
    if (state.kbCat !== 'all') docs = docs.filter(d => !d.docType || d.type === state.kbCat);
  } else {
    mode = q ? 'name' : 'list';
    docs = DB.kbDocs.filter(d => state.kbCat === 'all' || d.type === state.kbCat);
    if (q) { const kw = q.toLowerCase(); docs = docs.filter(d => (d.n + d.type).toLowerCase().includes(kw)); }
    docs = docs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  const total = DB.kbDocs.length;
  const byType = {};
  DB.kbDocs.forEach(d => { byType[d.type] = (byType[d.type] || 0) + 1; });
  const recent = DB.kbDocs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3);

  const ragChip = !Bridge.desktop
    ? `<span class="chip gray">需桌面端</span>`
    : !ragOn
      ? `<span class="chip gray">未启用</span>`
      : rs.status === 'ok'
        ? `<span class="chip emerald">已连接${rs.indexed ? ' · 索引 ' + rs.indexed + ' 条' : ''}</span>`
        : rs.status === 'fail'
          ? `<span class="chip rose">连接失败</span>`
          : `<span class="chip amber">未检测</span>`;

  const modeLabel = { rag: '语义检索', name: '名称匹配', list: '资料清单' }[mode];
  const sub = ragOn && rs.status === 'ok'
    ? `外部 RAG 检索 · 索引 ${rs.indexed || 0} 条`
    : `资料 ${total} 条 · 未接入向量索引`;

  /* S4：引擎徽章（builtin / http / rag_snowz / none） */
  const engine = (DB.settings.kbEngine) || (ragOn ? 'http' : 'builtin');
  const ENGINE_LABEL = { builtin: '内置引擎', http: 'HTTP 引擎', rag_snowz: 'RAG_Snowz', none: '未启用引擎' };
  const engineChip = `<span class="chip ${engine === 'none' ? 'gray' : (ragOn && rs.status === 'ok' ? 'emerald' : 'sky')}">
    ${esc(ENGINE_LABEL[engine] || engine)}</span>`;

  return `<div class="fade-in">
    <div class="page-head">
      <h2>知识库</h2>
      <span class="page-sub">${engineChip} ${sub}</span>
      <span class="ph-right">
        <button class="btn sm" data-act="kb-import">${icon('inbox')}导入资料</button>
        <button class="btn sm primary" data-act="kb-reindex">${icon('refresh')}重建索引</button>
      </span>
    </div>

    ${(total === 0 && !q) ? `<div class="today-bar" style="border-left-color:var(--accent-500,#3E63DD)">
      <span class="tb-ico">${icon('folder')}</span>
      <b>知识库还是空的</b>
      <span class="tb-list">把论文 / 报告 / 数据说明放进「知识库材料」文件夹，再点「重建索引」即可被检索</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="kb-open-materials">${icon('folderOpen')}打开材料夹</button>
      <button class="btn sm primary" data-act="kb-reindex">${icon('refresh')}重建索引</button>
    </div>` : ''}

    <div class="kb-query">
      <span class="kq-ico">${icon('sparkles')}</span>
      <input id="kb-input" value="${esc(state.q)}" placeholder="${ragOn ? '用自然语言检索你的科研知识库…（回车检索）' : '按资料名称检索…（未接入 RAG 时只能匹配名称）'}">
      <span class="chip ${mode === 'rag' ? 'emerald' : 'gray'}">${modeLabel}</span>
      <button class="btn primary sm" data-act="kb-search">${state.ragBusy ? '检索中…' : '检索'}</button>
    </div>

    <div class="detail-grid">
      <div class="card panel">
        <div class="panel-head"><h3>${icon('file')}检索结果</h3>
          <span class="head-sub">命中 ${docs.length} 条${q ? ` · 「${esc(q)}」` : ''}${mode === 'name' ? ' · 仅匹配资料名称' : ''}</span>
          <span class="grow"></span>
          <div class="tabs">${cats.map(([k, l]) => `<button class="tab ${k === state.kbCat ? 'active' : ''}" data-tab="kb" data-val="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="doc-grid">
          ${docs.map(d => `<div class="doc-card" ${mode === 'rag' ? `data-act="kb-open-hit" data-i="${d._i}"` : `data-act="kb-open" data-name="${esc(d.n)}"`}>
            <div class="dc-top">
              <span class="dc-ico" style="background:${fileType(d.ext).c}">${icon(extIcon(d.ext))}</span>
              <span class="chip gray">${esc(d.type)}</span>
              <span class="grow"></span>
              ${mode === 'rag'
                ? `<span class="chip accent">${Math.round((d.score || 0) * 100)}%</span>`
                : mode === 'name' ? `<span class="chip gray">名称命中</span>` : ''}
            </div>
            <h5>${esc(d.n)}</h5>
            ${d.snippet ? `<p class="dc-snippet">${esc(d.snippet)}</p>` : ''}
            <div class="dc-meta">
              ${mode === 'rag'
                ? `<span>${d.page ? '第 ' + esc(String(d.page)) + ' 页' : '片段'}</span><span title="${esc(d.path)}">${esc(baseName(d.path) || '—')}</span>`
                : `<span>${esc(d.size)}</span><span>${esc(d.date)}</span>`}
            </div>
          </div>`).join('') || `<div class="empty">${icon('search')}<div>${mode === 'name' ? '没有名称匹配的资料' : '暂无资料'}</div></div>`}
        </div>
      </div>

      <div class="detail-side">
        <div class="card panel">
          <div class="panel-head"><h3>${icon('link')}检索通道</h3>${ragChip}</div>
          <div class="kb-answer">
            <div class="ka-step"><span class="num">1</span>${q ? `检索内容「${esc(q)}」` : '等待输入检索内容'}</div>
            <div class="ka-step"><span class="num">2</span>${ragOn
              ? `调用外部 RAG：<b>${esc(S.ragEndpoint)}</b>`
              : '本地按资料名称匹配（本软件不做向量化）'}</div>
            <div class="ka-step"><span class="num">3</span>${ragOn
              ? `取回 Top ${esc(String(S.ragTopK || 8))} 片段，附原文路径与页码`
              : `返回名称命中的 ${docs.length} 条资料`}</div>
          </div>
          ${mode === 'rag' && state.ragMeta ? `<div class="row mt-10" style="gap:6px">
            ${state.ragMeta.tookMs ? `<span class="chip emerald">耗时 ${state.ragMeta.tookMs}ms</span>` : ''}
            <span class="chip sky">命中 ${docs.length}</span>
            ${state.ragMeta.model ? `<span class="chip violet">${esc(state.ragMeta.model)}</span>` : ''}
          </div>` : ''}
          ${rs.error ? `<div class="field-err" style="display:block;margin-top:9px">${esc(rs.error)}</div>` : ''}
          <div class="row mt-10" style="gap:6px;flex-wrap:wrap">
            <button class="btn sm" data-act="rag-test">${icon('pulse')}测试连接</button>
            <button class="btn sm" data-act="goto-rag-settings">${icon('settings')}配置通道</button>
          </div>
        </div>

        <div class="card panel">
          <div class="panel-head"><h3>${icon('database')}知识库规模</h3><span class="head-sub">共 ${total} 条</span></div>
          <div class="kb-stat-list">
            ${Object.entries(byType).map(([k, v]) => `<div class="kbs-row"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}
          </div>
          <div class="mt-10" style="font-size:10.5px;color:var(--text-3);line-height:1.7">
            向量索引：${ragOn && rs.status === 'ok'
              ? `<b>${rs.indexed || 0}</b> 条（外部服务${rs.model ? ' · ' + esc(rs.model) : ''}）`
              : '<b>未建立</b>'}
          </div>
        </div>

        <div class="card panel">
          <div class="panel-head"><h3>${icon('clock')}最近入库</h3></div>
          ${recent.map(d => `<div class="activity-row">
            <span class="a-dot" style="background:${fileType(d.ext).c}">${icon(extIcon(d.ext))}</span>
            <span class="a-txt">${esc(d.n)}</span><span class="a-time">${esc(d.date)}</span></div>`).join('') || '<div class="empty" style="padding:14px">暂无</div>'}
          <button class="btn sm mt-10" style="width:100%;justify-content:center" data-act="kb-open-root">${icon('folderOpen')}打开知识库目录</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   视图：Agent 中心（DEPRECATED：v2.5 起并入 AI 助手「派任务」，此处仅保留旧深链兜底）
   ========================================================================== */
function agentsView() {
  const running = DB.agents.filter(a => a.status === 'running').length;
  const busy = DB.agents.filter(a => a.status === 'busy').length;
  const idle = DB.agents.filter(a => a.status === 'idle').length;
  const total = DB.agents.reduce((s, a) => s + a.stats[0], 0);
  return `<div class="fade-in">
    <div class="page-head">
      <h2>Agent 中心</h2>
      <span class="page-sub">${DB.agents.length} 个科研 Agent · ${running + busy} 个在役</span>
      <span class="ph-right">
        <button class="btn sm" data-act="agent-orchestrate">${icon('branch')}编排策略</button>
        <button class="btn sm primary" data-act="new-agent">${icon('plus')}新建 Agent</button>
      </span>
    </div>
    ${DB.agents.length === 0 ? `<div class="card panel welcome">
      <div class="wl-hero">
        <span class="wl-ico">${icon('bot')}</span>
        <h2>还没有 Agent</h2>
        <p>这里不预置任何演示 Agent。需要时点右上角「新建 Agent」，
           写好名字、职责和标签，它就会出现在这里，可以给项目派单。</p>
        <div class="row" style="justify-content:center;gap:8px;margin-top:16px">
          <button class="btn primary" data-act="new-agent">${icon('plus')}新建 Agent</button>
          <button class="btn" data-act="agent-orchestrate">${icon('branch')}编排策略</button>
        </div>
      </div>
    </div>` : `<div class="card panel" style="margin-bottom:var(--gap)">
      <div class="agent-stat-row" style="grid-template-columns:repeat(4,1fr)">
        ${[['运行中', running], ['忙碌', busy], ['待命', idle], ['累计任务', total]].map(([k, v]) =>
          `<div class="agent-stat"><div class="as-v">${v}</div><div class="as-k">${k}</div></div>`).join('')}
      </div>
    </div>`}
    <div class="agent-grid">
      ${DB.agents.map(a => {
        const linked = DB.projects.filter(p => p.agents.includes(a.name));
        const openTasks = DB.tasks.filter(t => t.agent === a.name && t.st !== 'done');
        return `<div class="card agent-card">
          <div class="ac-head">
            ${agentTile(a.name, 38)}
            <div class="grow"><div class="ac-name">${esc(a.name)}</div><div class="ac-role">${esc(a.role)}</div></div>
            ${liveBadge(a.status)}
          </div>
          <div class="ac-tags">${a.tags.map(t => `<span class="chip gray">${esc(t)}</span>`).join('')}</div>
          <div class="ac-block">
            <h6>当前任务</h6>
            <div class="ac-task">${esc(a.task)}</div>
          </div>
          <div class="ac-block">
            <h6>关联项目（${linked.length}）</h6>
            <div class="row" style="gap:5px;flex-wrap:wrap">
              ${linked.length ? linked.map(p => `<button class="chip accent" data-act="pick-project" data-id="${p.id}" style="cursor:pointer">${esc(p.name)}</button>`).join('') : '<span class="muted" style="font-size:10.5px">暂无关联</span>'}
            </div>
          </div>
          <div class="agent-stat-row">
            <div class="agent-stat"><div class="as-v">${a.stats[0]}</div><div class="as-k">累计任务</div></div>
            <div class="agent-stat"><div class="as-v">${openTasks.length}</div><div class="as-k">进行中</div></div>
            <div class="agent-stat"><div class="as-v">${a.stats[2]}%</div><div class="as-k">成功率</div></div>
          </div>
          <div class="ac-actions">
            <button class="btn sm" data-act="agent-history" data-a="${esc(a.name)}">${icon('clock')}历史</button>
            <button class="btn sm" data-act="agent-assign" data-a="${esc(a.name)}">${icon('plus')}派单</button>
            <button class="btn sm ${a.status === 'idle' ? 'primary' : ''}" data-act="agent-run" data-a="${esc(a.name)}">
              ${icon('send')}派单
            </button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ==========================================================================
   视图：自动化流程
   ========================================================================== */
function automationView() {
  const on = DB.automations.filter(a => a.on).length;
  return `<div class="fade-in">
    <div class="page-head">
      <h2>自动化流程</h2><span class="page-sub">${on}/${DB.automations.length} 个流程运行中</span>
      <span class="ph-right">
        <button class="btn sm" data-act="flow-log">${icon('list')}运行日志</button>
        <button class="btn sm primary" data-act="new-flow">${icon('plus')}新建流程</button>
      </span>
    </div>
    <div class="auto-grid">
      ${DB.automations.map((f, i) => `<div class="card auto-card">
        <div class="au-head">
          <span class="app-tile" style="width:24px;height:24px;flex-basis:24px;background:var(--grad-accent);font-size:12px">${icon('zap')}</span>
          <h4 class="grow">${esc(f.n)}</h4>
          <span class="switch ${f.on ? 'on' : ''}" data-act="flow-toggle" data-idx="${i}" role="switch" aria-checked="${f.on}"></span>
        </div>
        <div class="au-pipe">
          ${f.nodes.map((n, j) => `${j ? '<span class="au-link"></span>' : ''}
            <div class="au-node ${j === 0 ? 'trigger' : ''}"><span class="an-ico">${icon(n.i)}</span><span class="an-lbl">${esc(n.l)}</span></div>`).join('')}
        </div>
        <div class="au-foot">
          <span class="sb-dot" style="background:${f.on ? '#218358' : '#A5A5B2'}"></span>
          ${f.on ? '已启用' : '已停用'}
          <span class="grow"></span><span class="mono">${esc(f.last)}</span>
          <button class="btn sm ghost" data-act="flow-run" data-idx="${i}" title="立即运行一次">${icon('play')}</button>
        </div>
      </div>`).join('')}
    </div>

    <div class="card panel mt-14">
      <div class="panel-head"><h3>${icon('terminal')}最近执行日志</h3><span class="grow"></span>
        <button class="head-link" data-act="flow-log">查看全部 ${icon('chevronRight')}</button></div>
      <div class="activity-list">
        ${[['09:00', '文献周更流程', '抓取 32 篇 → 去重后入库 12 篇 → 摘要生成完成', '#6E56CF'],
           ['10:20', '参数扫描流程', '参数生成 24 组 → Fluent 批量提交中（18/24）', '#C9256B'],
           ['14:30', '结果汇总流程', '汇总 12 个结果文件 → 生成对比图表 3 张', '#3E63DD'],
           ['21:00', '日报推送流程', '汇总当日变更 → Agent 摘要 → 已推送至邮箱', '#218358']]
          .map(([t, n, d, c]) => `<div class="activity-row">
            <span class="a-dot" style="background:${c}">${icon('zap')}</span>
            <span class="a-txt"><b>${esc(n)}</b> — ${esc(d)}</span><span class="a-time">${t}</span></div>`).join('')}
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   视图：软件启动台
   ========================================================================== */
/** 软件图标：优先用导入时提取到的真实图标，否则退回字母色块 */
function appIconHTML(a, size) {
  if (a.icon) {
    const pad = Math.max(2, Math.round(size * 0.11));
    return `<span class="dk-ico dk-img" style="width:${size}px;height:${size}px;padding:${pad}px"><img src="${a.icon}" alt=""></span>`;
  }
  const raw = String(a.ico || '');
  const label = (size < 28 && raw.length > 2) ? raw.slice(0, 2) : raw;
  const fs = size >= 24 ? Math.max(10, Math.round(size * 0.34)) : Math.max(9, Math.round(size * 0.72));
  return `<span class="dk-ico" style="width:${size}px;height:${size}px;background:${a.bg};font-size:${fs}px;overflow:hidden;letter-spacing:-0.03em">${esc(label)}</span>`;
}

/* 只取文件名：完整路径放进 title，卡片里显示尾部才不会只剩「C:\Program Files\A…」 */
function baseName(p) {
  if (!p) return '';
  const s = String(p).replace(/[\\/]+$/, '');
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1] || s;
}

function dockView() {
  const running = DB.apps.filter(a => a.run);
  const quick = DB.sidebarLaunch;
  return `<div class="fade-in">
    <div class="page-head">
      <h2>软件启动台</h2>
      <span class="page-sub">工程软件统一入口 · 已登记 ${DB.apps.length} 个 · ${running.length} 个运行中</span>
      <span class="ph-right">
        <button class="btn sm" data-act="rescan-apps">${icon('search')}扫描已安装</button>
        <button class="btn sm" data-act="import-launch" data-mode="folder">${icon('folderOpen')}文件夹</button>
        <button class="btn sm" data-act="import-launch" data-mode="any">${icon('rocket')}选择程序</button>
        <button class="btn sm primary" data-act="import-launch" data-mode="shortcut">${icon('link')}导入快捷方式</button>
      </span>
    </div>

    <div class="card panel" style="margin-bottom:var(--gap)">
      <div class="panel-head"><h3>${icon('pulse')}当前工作区运行状态</h3>
        <span class="chip accent">${esc(DB.workspace.project)}</span>
        <span class="grow"></span>
        <span class="mono muted" style="font-size:10px">${Bridge.desktop ? '进程监控已开启' : '浏览器模式 · 进程功能不可用'}</span></div>
      ${running.length ? `<div class="row" style="gap:10px;flex-wrap:wrap">
        ${running.map((a, i) => {
          const load = [['42%', '1.2G'], ['18%', '0.6G'], ['63%', '2.4G'], ['9%', '0.4G']][i % 4];
          return `<div class="row" style="gap:8px;padding:8px 12px;border-radius:var(--r-md);background:var(--surface-sunken);border:1px solid var(--line-soft)">
          ${appIconHTML(a, 24)}
          <div><div style="font-size:11.5px;font-weight:620">${esc(a.displayName || a.n)}</div>
          <div class="mono muted" style="font-size:9.5px">CPU ${load[0]} · MEM ${load[1]}</div></div>
          <button class="btn sm ghost" data-act="stop-app" data-n="${esc(a.n)}">${icon('stop')}结束</button>
        </div>`;
        }).join('')}
      </div>` : `<div class="empty">${icon('pulse')}<div>当前没有由工作台启动的程序</div></div>`}
    </div>

    <div class="card panel" style="margin-bottom:var(--gap)">
      <div class="panel-head">
        <h3>${icon('zap')}左侧快捷启动</h3>
        <span class="head-sub">勾选后出现在左侧导航栏，点击即可启动 · 当前 ${quick.length} 个</span>
        <span class="grow"></span>
        ${quick.length ? `<button class="head-link" data-act="clear-quick">全部清空</button>` : ''}
      </div>
      <div class="quick-pool">
        ${DB.apps.map(a => {
          const on = quick.includes(a.n);
          return `<button class="quick-toggle${on ? ' on' : ''}" data-act="toggle-quick" data-n="${esc(a.n)}" title="${esc(a.path || '内置视图')}">
            ${on ? icon('check') : icon('plus')}<span>${esc(a.displayName || a.n)}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="field-hint" style="margin-top:8px">提示：先用上面三个按钮把程序（或桌面快捷方式）导入启动台，再在这里勾选固定到左侧。</div>
    </div>

    <div class="dock-grid">
      ${DB.apps.map(a => {
        const nm = esc(a.n);
        const mainBtn = a.kind === 'builtin'
          ? `<button class="btn sm primary" data-act="open-builtin" data-n="${nm}">${icon('globe')}打开</button>`
          : a.kind === 'folder'
            ? `<button class="btn sm primary" data-act="open-app-folder" data-n="${nm}">${icon('folderOpen')}打开</button>`
            : a.run
              ? `<button class="btn sm" data-act="stop-app" data-n="${nm}">${icon('stop')}结束</button>`
              : `<button class="btn sm primary" data-act="launch-app" data-n="${nm}">${icon('play')}启动</button>`;
        const subBtns = [
          (a.kind === 'exe' && a.run) ? `<button class="btn sm" data-act="bind-app" data-n="${nm}">${icon('link')}改绑定</button>` : '',
          a.kind === 'exe' ? `<button class="btn sm ghost" data-act="set-app-path" data-n="${nm}" title="重新指定可执行文件">${icon('settings')}路径</button>` : '',
          a.source === 'imported' ? `<button class="btn sm ghost" data-act="remove-app" data-n="${nm}" title="从启动台移除">${icon('trash')}移除</button>` : ''
        ].filter(Boolean).join('');
        return `<div class="card dock-card">
        ${appIconHTML(a, 42)}
        <h4 title="${esc(a.displayName || a.n)}">${esc(a.displayName || a.n)}</h4>
        <div class="dk-path" title="${esc(a.path || '应用内视图')}">${esc(baseName(a.path) || (a.kind === 'builtin' ? '应用内视图' : '未配置路径'))}</div>
        <div class="dk-chips">
          ${a.run
            ? `<span class="chip emerald">${icon('pulse')}运行中 · ${esc((P(a.run) || {}).name || '—')}</span>`
            : `<span class="chip gray">${a.kind === 'builtin' ? '应用内视图' : a.kind === 'folder' ? '文件夹' : '未运行'}</span>`}
          ${a.source === 'imported' ? `<span class="chip violet">${icon('link')}导入</span>` : ''}
        </div>
        <div class="dk-foot">
          ${subBtns ? `<div class="dk-sub">${subBtns}</div>` : ''}
          <div class="dk-main">${mainBtn}</div>
        </div>
      </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ==========================================================================
   视图：AI 助手
   ========================================================================== */

/** 轻量富文本渲染：代码块、行内码、粗体、标题、列表（不引入 markdown 库） */
function renderRich(text) {
  let h = esc(String(text || ''));
  const blocks = [];
  h = h.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (_, c) => {
    blocks.push(c.replace(/^\n+|\n+$/g, ''));
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  h = h.replace(/`([^`\n]+)`/g, '<code class="ai-code">$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/^###\s+(.+)$/gm, '<div class="ai-h3">$1</div>');
  h = h.replace(/^##\s+(.+)$/gm, '<div class="ai-h2">$1</div>');
  h = h.replace(/^\s*[-*]\s+(.+)$/gm, '<div class="ai-li">• $1</div>');
  h = h.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<div class="ai-li">$1. $2</div>');
  h = h.replace(/\n/g, '<br>');
  h = h.replace(/\u0000B(\d+)\u0000/g, (_, i) => `<pre class="ai-pre">${blocks[+i]}</pre>`);
  return h;
}

function aiMessageHTML(m) {
  if (m.role === 'user') {
    const tag = m.agent ? `<span class="ai-id-tag">${icon('bot')}${esc(m.agent)}</span>` : '';
    return `<div class="ai-msg user">${tag}<div class="ai-bubble">${renderRich(m.content)}</div></div>`;
  }
  if (m.role === 'assistant') {
    return `<div class="ai-msg assistant">
      ${m.content ? `<div class="ai-bubble">${renderRich(m.content)}</div>` : ''}
    </div>`;
  }
  if (m.role === 'tool') {
    const ok = m.ok !== false;
    return `<div class="ai-tool${ok ? '' : ' fail'}">
      <span class="ai-tool-ico">${icon(ok ? 'check' : 'alert')}</span>
      <div class="ai-tool-body">
        <div class="ai-tool-name">${esc(m.label || m.name || '工具调用')}</div>
        ${m.resultText ? `<div class="ai-tool-result">${esc(m.resultText)}</div>` : ''}
      </div>
    </div>`;
  }
  if (m.role === 'error') {
    return `<div class="ai-msg assistant"><div class="ai-bubble err">${esc(m.content)}</div></div>`;
  }
  return '';
}

function aiEmptyState(p) {
  const samples = [
    `把「${p.name}」下一步要做的事拆成 3 个任务`,
    '列出所有进行中的任务，按截止时间排序',
    '更新项目进度到 80%，并把当前阶段改成「多目标优化」',
    '打开这个项目的材料文件夹'
  ];
  return `<div class="ai-empty">
    ${icon('sparkles')}
    <div class="ai-empty-title">用自然语言管理项目</div>
    <div class="ai-empty-sub">AI 会先读取项目现状，再调用工具真实修改数据 —— 改动立即落盘，可在其它页面看到</div>
    <div class="ai-samples">
      ${samples.map(s => `<button class="ai-sample" data-act="ai-sample" data-text="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>
  </div>`;
}

function aiSetupCard() {
  const browserMode = !Bridge.desktop;
  return `<div class="card panel" style="border-color:var(--accent-200)">
    <div class="panel-head"><h3>${icon('settings')}${browserMode ? '需要桌面端运行' : '先配置 AI 接入'}</h3></div>
    <div style="font-size:11px;line-height:1.85;color:var(--text-2)">
      ${browserMode
        ? '浏览器模式下无法安全保存密钥，也无法绕过跨域限制发起请求。请运行桌面版后再配置。'
        : '支持任意 OpenAI 兼容端点：DeepSeek、OpenAI、通义千问、智谱、Moonshot、本地 Ollama 或自建服务。'}
      ${browserMode ? '' : `<ul class="list-tick" style="margin-top:8px">
        <li><span class="tk">1</span><span>选择服务商，确认 Base URL 与模型名</span></li>
        <li><span class="tk">2</span><span>填入 API Key —— 用系统加密能力保存在本地，不写进数据文件</span></li>
        <li><span class="tk">3</span><span>点「测试连接」确认可用</span></li>
      </ul>`}
    </div>
    ${browserMode ? '' : `<button class="btn primary mt-10" style="width:100%;justify-content:center" data-act="ai-config">${icon('settings')}打开模型设置</button>`}
  </div>`;
}

function aiView() {
  /* Sprint A：AI 助手单入口 = 聊天 | 派任务 | 浏览（原浏览器入口并入这里） */
  if (state.aiMode === 'assign') return aiAssignView();

  if (!DB.projects.length) return emptyWorkspace({ title: '先有项目，再谈助手', desc: 'AI 助手围绕当前项目工作。新建一个项目，它就能读到目标、任务和材料目录。' });
  const p = P(state.project) || DB.projects[0];
  const msgs = (DB.chats && DB.chats[p.id]) || [];
  const cfg = DB.ai;
  const keyState = state.aiKey || { stored: false };
  const ready = Bridge.desktop && keyState.stored;
  const busy = !!state.aiBusy;

  return `<div class="fade-in">
    <div class="page-head">
      <h2>AI 助手</h2>
      <span class="page-sub">用自然语言管理「${esc(p.name)}」</span>
      <span class="ph-right">
        <select class="select" data-act="ai-switch-project" title="切换 AI 操作的项目">
          ${DB.projects.map(x => `<option value="${x.id}"${x.id === p.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>
        <div class="seg">
          <button class="active" data-act="ai-mode" data-v="chat">聊天</button>
          <button data-act="ai-mode" data-v="assign">派任务</button>
          <button data-act="ai-mode" data-v="browser">浏览</button>
        </div>
        <button class="btn sm" data-act="ai-config">${icon('settings')}模型设置</button>
        <button class="btn sm" data-act="ai-clear">${icon('trash')}清空会话</button>
      </span>
    </div>

    <div class="ai-grid">
      <div class="card ai-panel">
        <div class="ai-stream" id="ai-stream">
          ${msgs.length ? msgs.map(aiMessageHTML).join('') : aiEmptyState(p)}
          ${busy ? `<div class="ai-msg assistant"><div class="ai-bubble thinking">
            <span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>
            ${esc(state.aiStatus || '思考中…')}</div></div>` : ''}
        </div>
        <div class="ai-input-row">
          <textarea id="ai-input" rows="2" ${ready ? '' : 'disabled'}
            placeholder="${ready ? '描述你要做的事，例如：把仿真任务标记为已完成，并新增一条明天跑参数扫描的待办' : '请先配置 AI 接入'}">${esc(state.aiDraft || '')}</textarea>
          <button class="btn primary" data-act="ai-send" ${ready && !busy ? '' : 'disabled'}>${icon('arrowRight')}发送</button>
        </div>
        <div class="ai-hint">
          ${ready ? `Enter 发送 · Shift + Enter 换行 · 模型 ${esc(cfg.model || '未设置')}` : 'AI 接入需要在桌面端配置'}
        </div>
      </div>

      <div class="detail-side">
        ${ready ? '' : aiSetupCard()}
        ${staffPanelHTML()}
        <div class="card panel">
          <div class="panel-head"><h3>${icon('book')}会话信息</h3></div>
          <div class="agent-stat-row" style="grid-template-columns:repeat(2,1fr)">
            <div class="agent-stat"><div class="as-v">${msgs.filter(m => m.role === 'user').length}</div><div class="as-k">提问</div></div>
            <div class="agent-stat"><div class="as-v">${msgs.filter(m => m.role === 'tool').length}</div><div class="as-k">工具调用</div></div>
          </div>
          <div class="mt-10 mono muted" style="font-size:9.5px;line-height:1.9">
            服务商：${esc(cfg.provider)}<br>
            模型：${esc(cfg.model || '未设置')}<br>
            密钥：${keyState.stored ? (keyState.encrypted ? '已加密保存' : '已保存（未加密）') : '未配置'}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   视图：内置浏览器
   ========================================================================== */
/* 起始页欢迎链接（真实 URL，点了就用 webview 打开） */
const WEB_SHORTCUTS = [
  ['百度学术', 'https://xueshu.baidu.com/', 'search'],
  ['arXiv', 'https://arxiv.org/', 'book'],
  ['Google Scholar', 'https://scholar.google.com/', 'book'],
  ['中国知网', 'https://www.cnki.net/', 'file'],
  ['Bing', 'https://www.bing.com/', 'globe'],
  ['GitHub', 'https://github.com/', 'terminal']
];
const WEB_SEARCH_ENGINE = 'https://www.bing.com/search?q=';

/* 用一个稳定的容器承载 webview：重绘只换 chrome，不碰网页面板 */
let webviewEl = null;

function webPage() {
  return state.webPages[Math.max(0, Math.min(state.webActive, state.webPages.length - 1))] || state.webPages[0];
}

function browserView() {
  /* 视图本体由浏览器面板承载，这里只返回占位说明（路由校验用） */
  return `<div class="fade-in"><div class="card panel">
    <div class="panel-head"><h3>${icon('globe')}内置浏览器</h3></div>
    <p style="font-size:11.5px;color:var(--text-3)">正在切换到网页面板…</p>
  </div></div>`;
}

function browserChromeHTML() {
  const pages = state.webPages;
  const active = Math.max(0, Math.min(state.webActive, pages.length - 1));
  const page = pages[active] || pages[0];
  const nav = state.webNav || {};
  return `<div class="browser-tabs">
      ${pages.map((t, i) => `<button class="btab ${i === active ? 'active' : ''}" data-act="web-tab" data-idx="${i}" title="${esc(t.url || '起始页')}">
        ${icon('globe')}<span class="t">${esc(t.title || '新标签页')}</span>
        <span class="x" data-act="web-tab-close" data-idx="${i}" title="关闭标签">${icon('x')}</span>
      </button>`).join('')}
      <button class="btab-add" data-act="web-tab-add" title="新建标签页">${icon('plus')}</button>
    </div>
    <div class="browser-bar">
      <button class="icon-btn" data-act="web-back" title="后退" ${nav.canBack ? '' : 'disabled'}>${icon('arrowLeft')}</button>
      <button class="icon-btn" data-act="web-forward" title="前进" ${nav.canForward ? '' : 'disabled'}>${icon('arrowRight')}</button>
      <button class="icon-btn" data-act="${state.webLoading ? 'web-stop' : 'web-reload'}" title="${state.webLoading ? '停止加载' : '刷新'}">
        ${state.webLoading ? icon('x') : icon('refresh')}</button>
      <button class="icon-btn" data-act="web-home" title="起始页">${icon('home')}</button>
      <div class="browser-url">
        ${icon('link')}
        <input id="web-url" value="${esc(page.url || '')}" placeholder="输入网址或检索词，回车打开" spellcheck="false" autocomplete="off">
      </div>
      <button class="btn sm" data-act="web-open-external" data-url="${esc(page.url || '')}" ${page.url ? '' : 'disabled'}>${icon('externalLink')}外部打开</button>
      <button class="btn sm" data-act="capture-page" ${page.url ? '' : 'disabled'}>${icon('save')}存入知识库</button>
    </div>
    ${page.url ? `<div style="display:flex;align-items:center;gap:8px;padding:0 12px 7px;font-size:10px;color:var(--text-4)">
      <span class="mono" id="web-status">${state.webLoading ? '加载中…' : '就绪'}</span>
      <span class="grow"></span>
      <span>${icon('globe')} 真实网页渲染 · 独立会话分区</span>
    </div>` : ''}`;
}

function webOverlayHTML() {
  const page = webPage();
  if (!Bridge.webview) {
    /* 降级模式：不能内嵌网页，但起始页的入口仍然有用 —— 点一下复制链接 */
    return `<div class="web-start">
      <div class="row" style="gap:8px;margin-bottom:10px">
        <h3 style="margin:0">起始页</h3>
        <span class="chip amber">浏览器降级模式</span>
      </div>
      <div class="ws-sub">当前无法内嵌真实网页。点击下面的站点会复制链接，粘贴到系统浏览器即可打开。</div>
      <div class="web-links">
        ${WEB_SHORTCUTS.map(([n, u, i]) => `<button class="web-link" data-act="web-open-external" data-url="${esc(u)}">${icon(i)}${esc(n)}</button>`).join('')}
      </div>
      <p class="web-hint">运行桌面版软件（双击桌面「科研工作台」）即可在应用内直接浏览并保持登录态。</p>
    </div>`;
  }
  if (state.webError) {
    const e = state.webError;
    return `<div class="web-state">
      ${icon('alert')}
      <h4>打不开这个页面</h4>
      <p><span class="mono">${esc(e.url || '')}</span><br>${esc(e.desc || '未知错误')}（${esc(String(e.code || ''))}）</p>
      <div class="row" style="justify-content:center;gap:8px;margin-top:14px">
        <button class="btn sm primary" data-act="web-reload">重试</button>
        <button class="btn sm" data-act="web-open-external" data-url="${esc(e.url || page.url)}">用系统浏览器打开</button>
        <button class="btn sm" data-act="web-home">回到起始页</button>
      </div>
      <p class="web-hint">常见原因：网络不可达、站点被防火墙拦截、证书无效。<br>内网/需登录的站点建议用「外部打开」。</p>
    </div>`;
  }
  if (!page.url) {
    return `<div class="web-start">
      <h3>起始页</h3>
      <div class="ws-sub">直接访问常用学术站点，或在地址栏输入网址 / 检索词</div>
      <div class="search" style="max-width:none;height:34px;margin-bottom:14px">
        ${icon('search', 'color:var(--text-4)')}
        <input id="web-q" placeholder="输入检索词，回车用必应搜索">
      </div>
      <div class="web-links">
        ${WEB_SHORTCUTS.map(([n, u, i]) => `<button class="web-link" data-act="web-goto" data-url="${esc(u)}">${icon(i)}${esc(n)}</button>`).join('')}
      </div>
      <p class="web-hint">网页在独立会话分区中渲染，与应用自身数据隔离；不支持在新窗口中弹开页面。</p>
    </div>`;
  }
  if (state.webLoading) {
    return `<div class="web-state">${icon('refresh')}<h4>正在加载…</h4><p class="mono">${esc(page.url)}</p></div>`;
  }
  return '';
}

function renderWebOverlay() {
  const box = document.getElementById('web-overlay');
  if (!box) return;
  const html = webOverlayHTML();
  box.innerHTML = html;
  box.hidden = !html;
  if (webviewEl) webviewEl.style.display = html ? 'none' : 'flex';
}

function syncBrowserChrome() {
  const bar = document.querySelector('#browser-chrome .browser-bar');
  if (!bar) return;
  const nav = state.webNav || {};
  const btns = bar.querySelectorAll('.icon-btn');
  /* 顺序：后退 / 前进 / 刷新或停止 / 起始页 */
  if (btns[0]) btns[0].disabled = !nav.canBack;
  if (btns[1]) btns[1].disabled = !nav.canForward;
  const st = document.getElementById('web-status');
  if (st) st.textContent = state.webLoading ? '加载中…' : '就绪';
}

function setWebUrl(url) {
  const p = webPage();
  if (!p) return;
  p.url = url || '';
  renderWebOverlay();
}

function refreshNavState() {
  if (!webviewEl || !webviewEl.getWebContentsId) return;
  try {
    state.webNav.canBack = webviewEl.canGoBack();
    state.webNav.canForward = webviewEl.canGoForward();
  } catch (_) { state.webNav.canBack = false; state.webNav.canForward = false; }
  syncBrowserChrome();
}

function bindWebviewEvents(wv) {
  wv.addEventListener('dom-ready', () => {
    state.webNav.ready = true;
    refreshNavState();
  });
  wv.addEventListener('did-start-loading', () => {
    state.webLoading = true; syncBrowserChrome(); renderWebOverlay();
  });
  wv.addEventListener('did-stop-loading', () => {
    state.webLoading = false; refreshNavState(); renderWebOverlay();
    const bar = document.querySelector('#browser-chrome .browser-bar');
    const input = document.getElementById('web-url');
    if (input && document.activeElement !== input) input.value = webPage().url || '';
    if (bar) refreshNavState();
  });
  wv.addEventListener('did-navigate', e => {
    setWebUrl(e.url); refreshNavState();
    const input = document.getElementById('web-url');
    if (input && document.activeElement !== input) input.value = e.url || '';
  });
  wv.addEventListener('did-navigate-in-page', e => { if (e.isMainFrame) setWebUrl(e.url); });
  wv.addEventListener('page-title-updated', e => {
    const p = webPage();
    if (p && e.title) { p.title = String(e.title).slice(0, 60); renderBrowserChrome(); }
  });
  wv.addEventListener('did-fail-load', e => {
    if (e.errorCode === -3) return;                 /* 用户主动停止，不算失败 */
    state.webLoading = false;
    state.webError = {
      code: e.errorCode,
      desc: e.errorDescription || '加载失败',
      url: e.validatedURL || webPage().url
    };
    renderWebOverlay(); syncBrowserChrome();
  });
  wv.addEventListener('render-process-gone', () => {
    state.webLoading = false;
    state.webError = { code: -1, desc: '网页进程异常退出', url: webPage().url };
    renderWebOverlay();
  });
}

/* 首次进入浏览器时创建 webview；此后只在需要时复用，绝不重建 */
function mountWebview() {
  const stage = document.getElementById('web-stage');
  if (!stage || !Bridge.webview) return;
  if (!webviewEl) {
    webviewEl = document.createElement('webview');
    webviewEl.setAttribute('partition', 'persist:rw-web');
    webviewEl.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,nodeIntegration=no');
    bindWebviewEvents(webviewEl);
  }
  if (!stage.contains(webviewEl)) stage.insertBefore(webviewEl, stage.firstChild);
  const url = webPage().url;
  if (url) navigateWebview(url);
}

/* 导航语义：有地址才加载；空地址回起始页 */
function navigateWebview(url) {
  if (!webviewEl) return;
  state.webError = null;
  state.webLoading = true;
  try {
    if (state.webNav.ready && webviewEl.loadURL) webviewEl.loadURL(url);
    else webviewEl.setAttribute('src', url);       /* dom-ready 之前只能用 src */
  } catch (e) {
    state.webLoading = false;
    state.webError = { code: -2, desc: String((e && e.message) || e), url };
  }
  renderWebOverlay(); syncBrowserChrome();
}

function goWeb(raw) {
  const p = webPage();
  if (!p) return;
  const input = String(raw || '').trim();
  if (!input) { p.url = ''; p.title = '起始页'; renderBrowserChrome(); renderWebOverlay(); return; }
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(input) || /^localhost(:\d+)?/i.test(input);
  const url = isUrl ? (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : 'https://' + input) : WEB_SEARCH_ENGINE + encodeURIComponent(input);
  p.url = url;
  p.title = url.replace(/^https?:\/\//, '').split('/')[0];
  if (!Bridge.webview) { renderBrowserChrome(); renderWebOverlay(); return; }
  navigateWebview(url);
  renderBrowserChrome();
  renderWebOverlay();
}

/* 浏览器面板：只有首次进入时建壳，之后只替换 chrome */
function renderBrowserChrome() {
  const pane = document.getElementById('browser-pane');
  if (!pane) return;
  if (!pane.querySelector('#browser-shell')) {
    pane.innerHTML = `<div class="card browser-shell" id="browser-shell">
      <div id="browser-chrome"></div>
      <div class="web-stage" id="web-stage"><div class="web-overlay" id="web-overlay" hidden></div></div>
    </div>`;
    mountWebview();
  }
  const chrome = pane.querySelector('#browser-chrome');
  if (chrome) chrome.innerHTML = browserChromeHTML();
  renderWebOverlay();
  syncBrowserChrome();
}

/* ==========================================================================
   视图：设置
   ========================================================================== */
/* S4：设置分组按排期对齐（外观 / Agent 接入与令牌 / 知识库引擎 / 同步与备份 / 关于与更新） */
const SET_NAV = [
  ['general', '通用'],
  ['appearance', '外观与主题'],
  ['ai', 'AI 与知识库引擎'],
  ['external', 'Agent 接入与令牌'],
  ['tools', '科研工具链'],
  ['storage', '同步与备份'],
  ['account', '账户'],
  ['about', '关于与更新']
];
/* ==========================================================================
   外部 Agent 接入面板
   ========================================================================== */
function externalPanel() {
  const info = state.apiInfo || { running: false, port: 0, baseUrl: '', token: '' };
  const clients = state.connClients || [];
  const detected = clients.filter(c => c.installed);
  const connected = clients.filter(c => c.configured);
  const mk = t => (t ? t.slice(0, 6) + '••••••••' + t.slice(-4) : '—');
  const masked = mk(info.token);
  const maskedRead = mk(info.tokenRead);
  const audit = (Array.isArray(DB.audit) ? DB.audit : []).filter(x => x.source !== 'ui');
  const auditFail = audit.filter(x => !x.ok).length;

  return `
    <div class="ext-hero">
      <span class="ext-dot ${info.running ? 'on' : ''}"></span>
      <div class="grow">
        <div class="ext-title">本地服务${info.running ? '运行中' : '未启动'}${info.port ? ` · 端口 ${info.port}` : ''}</div>
        <div class="ext-sub mono">${esc(info.baseUrl || '—')}</div>
        <div class="ext-sub mono" style="margin-top:3px">
          可写令牌 <b>${esc(masked)}</b>　·　只读令牌 <b>${esc(maskedRead)}</b>
        </div>
      </div>
      <button class="btn sm" data-act="copy-api-base">${icon('copy')}地址</button>
      <button class="btn sm" data-act="copy-api-token">${icon('copy')}可写令牌</button>
      <button class="btn sm" data-act="copy-api-token-read">${icon('copy')}只读令牌</button>
      <button class="btn sm" data-act="export-mcp" title="生成可粘进 Cursor/Claude 的 MCP 配置">${icon('branch')}MCP 配置</button>
      <button class="btn sm danger" data-act="api-rotate" title="重置后已连接的 Agent 需要重新连接">${icon('refresh')}重置</button>
    </div>

    <div class="ext-block">
      <div class="ext-block-head">
        <span class="chip ${auditFail ? 'rose' : audit.length ? 'sky' : 'gray'}">${audit.length} 条${auditFail ? ` · ${auditFail} 失败` : ''}</span>
        <h4>写操作审计</h4>
      </div>
      <p class="ext-desc">
        内置 AI 助手与外部 Agent 的每一次<b>写操作</b>都会留痕：来源、操作者、工具、参数摘要与成败。
        纯查询不记录，避免淹没真实改动。
      </p>
      ${audit.length
        ? `<div class="audit-list" style="max-height:none">
            ${audit.slice(0, 3).map(x => `<div class="audit-row">
              <span class="au-src ${esc(x.source)}">${esc(ORIGIN_LABEL[x.source] || x.source)}</span>
              <div class="au-body">
                <div class="au-t">${esc(x.label || x.tool)} ${x.ok ? '' : '<span class="chip rose">失败</span>'}</div>
                <div class="au-meta">${esc(x.at)} · ${esc(x.actor)} · <span class="mono">${esc(x.tool)}</span></div>
              </div>
            </div>`).join('')}
          </div>`
        : `<div class="empty" style="padding:16px">${icon('shield')}<div>还没有 Agent 写操作记录</div></div>`}
      <div class="row" style="gap:7px;margin-top:9px">
        <button class="btn sm" data-act="audit-view" ${audit.length ? '' : 'disabled'}>${icon('shield')}查看全部</button>
        ${audit.length ? `<button class="btn sm danger" data-act="audit-clear">${icon('trash')}清空记录</button>` : ''}
      </div>
    </div>

    <div class="ext-block">
      <div class="ext-block-head">
        <span class="chip emerald">适用于任何 Agent</span>
        <h4>方式一 · 生成接管凭证，投递给 Agent</h4>
      </div>
      <p class="ext-desc">
        生成一份自包含的接管凭证，把它发给任意 AI Agent（Codex / WorkBuddy / Claude / 其它），
        它据此就能读取现状并管理本项目。<b>与具体机器无关，也不要求 Agent 预先安装什么</b>。
      </p>
      <div class="row" style="gap:7px;flex-wrap:wrap">
        <button class="btn primary" data-act="copy-agent-prompt">${icon('copy')}复制接管指令</button>
        <button class="btn" data-act="copy-agent-link">${icon('link')}复制接管链接</button>
        <button class="btn" data-act="export-agent-file">${icon('download')}导出为文件</button>
        <button class="btn" data-act="preview-agent-prompt">${icon('eye')}预览</button>
      </div>
      <div class="ext-link mono" title="把这个链接发给 Agent，它打开即可读到完整接入手册">
        ${esc(info.baseUrl || 'http://127.0.0.1:7317')}/agent-setup?token=…
      </div>
      <div class="ext-note" style="margin-top:6px">
        指令适合粘贴到对话框；链接适合直接丢给 Agent 让它自行读取；文件适合拖给 Agent 或放进项目目录。
      </div>
    </div>

    <div class="ext-block">
      <div class="ext-block-head">
        <span class="chip gray">可选</span>
        <h4>方式二 · MCP 一键写入（仅对已安装的 MCP 客户端）</h4>
      </div>
      <p class="ext-desc">
        若你的机器上装有支持 MCP 的客户端，可直接把本软件注册进去，省去手动改配置。
        检测到 <b>${detected.length}</b> 个，已连接 <b>${connected.length}</b> 个。
        写入前自动备份，重复连接只更新本条目，不影响你已有的其他 MCP 配置。
      </p>
      <div class="ext-clients">
        ${clients.length ? clients.map(c => `
          <div class="ext-client ${c.installed ? '' : 'is-muted'}">
            <span class="ext-dot ${c.configured ? 'on' : c.installed ? 'idle' : ''}"></span>
            <div class="grow">
              <div class="ext-client-name">
                ${esc(c.name)}
                ${c.configured ? '<span class="chip emerald">已连接</span>' : (c.installed ? '<span class="chip gray">已检测</span>' : '<span class="chip gray">未检测到</span>')}
              </div>
              <div class="ext-client-path mono" title="${esc(c.configPath)}">${esc(c.configPath)}</div>
              ${c.note ? `<div class="ext-note">${esc(c.note)}</div>` : ''}
              ${c.error ? `<div class="ext-note" style="color:var(--red)">${esc(c.error)}</div>` : ''}
            </div>
            <div class="row" style="gap:5px">
              ${c.configured
                ? `<button class="btn sm" data-act="conn-reveal" data-id="${c.id}" title="打开配置目录">${icon('folderOpen')}</button>
                   <button class="btn sm danger" data-act="conn-remove" data-id="${c.id}">${icon('trash')}移除</button>`
                : `<button class="btn sm ${c.installed ? 'primary' : ''}" data-act="conn-apply" data-id="${c.id}">${icon('link')}一键连接</button>`}
            </div>
          </div>`).join('')
          : `<div class="empty">${icon('link')}<div>${Bridge.desktop ? '未检测到 MCP 客户端' : '需要桌面端运行'}</div></div>`}
      </div>
    </div>

    <div class="ext-block">
      <div class="ext-block-head"><h4>其他工具</h4></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button class="btn sm" data-act="api-selftest">${icon('pulse')}运行自检</button>
        <button class="btn sm" data-act="show-api-doc">${icon('book')}接口与工具说明</button>
        <button class="btn sm" data-act="copy-curl">${icon('copy')}curl 示例</button>
        <button class="btn sm" data-act="copy-mcp-config">${icon('copy')}MCP 配置片段</button>
      </div>
    </div>`;
}

function settingsView() {
  const S = DB.settings;
  const AI = DB.ai;
  const keyState = state.aiKey || { stored: false, encrypted: false };
  const keyChip = keyState.stored
    ? `<span class="chip emerald">${keyState.encrypted ? '已加密保存' : '已保存（未加密）'}</span>`
    : `<span class="chip rose">未配置</span>`;
  const providers = state.aiProviders && state.aiProviders.length
    ? state.aiProviders
    : [{ id: AI.provider, label: AI.provider }];
  const sw = (key, on) => `<span class="switch ${on ? 'on' : ''}" data-act="set-toggle" data-key="${key}" role="switch" aria-checked="${on}"></span>`;
  const rows = {
    account: accountRows(),
    general: [
      ['默认工作区', '打开软件后默认进入的项目空间', DB.projects.length
        ? `<select class="select" data-act="set-select" data-key="defaultWorkspace">${DB.projects.map(p => `<option value="${p.id}"${p.id === S.defaultWorkspace ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`
        : `<span class="chip gray">还没有项目</span>`],
      ['启动时恢复上次页面', '关闭时记住所在页面，下次直接回到那里', sw('resumeLast', S.resumeLast)],
      ['界面动效', '页面切换与卡片过渡动画；关闭后更省电', sw('motion', S.motion)],
      ['提醒红点', '在顶栏与导航显示未读提醒标记', sw('notifyDot', S.notifyDot)]
    ],
    appearance: [
      ['玻璃拟态效果', '卡片与面板启用半透明磨砂背景', sw('glass', S.glass)],
      ['环境渐变光', '背景保留低强度环境光晕', sw('ambient', S.ambient)],
      ['紧凑布局', '减小卡片间距，提升信息密度', sw('compact', S.compact)],
      ['当前主题', '界面配色方案', `<span class="set-path" style="max-width:150px">科研中性（浅色）</span>`]
    ],
    ai: [
      ['启用 AI 助手', '控制 AI 助手入口与对话能力', `<span class="switch ${AI.enabled ? 'on' : ''}" data-act="ai-toggle" data-key="enabled" role="switch" aria-checked="${AI.enabled}"></span>`],
      ['服务商', '选择 OpenAI 兼容的服务提供方，会带出推荐 Base URL 与模型', `<select class="select" data-act="ai-select" data-key="provider">${providers.map(p => `<option value="${esc(p.id)}"${p.id === AI.provider ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`],
      ['Base URL', '接口基地址；若未以版本号结尾会自动补 /v1，最终请求 /chat/completions', `<span class="row" style="gap:6px"><span class="set-path" title="${esc(AI.baseUrl)}">${esc(AI.baseUrl || '未设置')}</span><button class="btn sm" data-act="ai-edit" data-key="baseUrl">${icon('pencil')}编辑</button></span>`],
      ['模型', '对话模型名称，例如 deepseek-chat / qwen-plus / gpt-4o-mini', `<span class="row" style="gap:6px"><span class="set-path" style="max-width:170px">${esc(AI.model || '未设置')}</span><button class="btn sm" data-act="ai-edit" data-key="model">${icon('pencil')}编辑</button></span>`],
      ['API Key', '使用系统加密能力保存在本地，<b>不会写入数据文件</b>，导出数据也带不走', `<span class="row" style="gap:6px">${keyChip}<button class="btn sm" data-act="ai-key">${icon('settings')}${keyState.stored ? '更换' : '设置'}</button>${keyState.stored ? `<button class="btn sm danger" data-act="ai-key-clear" title="清除密钥">${icon('trash')}</button>` : ''}</span>`],
      ['采样温度', '越低越稳定可控，越高越发散', `<select class="select" data-act="ai-select" data-key="temperature">${['0', '0.3', '0.7', '1.0'].map(v => `<option value="${v}"${String(AI.temperature) === v ? ' selected' : ''}>${v}</option>`).join('')}</select>`],
      ['自动执行工具', 'AI 调用工具时直接执行；关闭后每步都需要你确认', `<span class="switch ${AI.autoApprove ? 'on' : ''}" data-act="ai-toggle" data-key="autoApprove" role="switch" aria-checked="${AI.autoApprove}"></span>`],
      ['连接测试', '验证 Base URL、模型与密钥是否可用', `<button class="btn sm" data-act="ai-test">${icon('pulse')}测试连接</button>`],
      /* Sprint D：知识库引擎（插件宿主） */
      ['知识库引擎', '决定 search_knowledge 走哪个检索后端；无可用引擎时自动降级为文件名匹配', `<select class="select" data-act="kb-engine" data-key="kbEngine">
        ${[['builtin', '内置（本地登记 + 名称检索）'], ['http', 'HTTP 引擎（外部服务）'], ['rag_snowz', 'RAG_Snowz（协同 @Snowsz）'], ['none', '关闭（仅文件名匹配）']]
          .map(([v, l]) => `<option value="${v}"${(DB.settings.kbEngine || 'builtin') === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>`],
      ['引擎地址', 'HTTP 引擎的接口前缀（例如 http://127.0.0.1:8000），只填到前缀', (() => {
        const ep = DB.settings.ragEndpoint || '';
        const st = (state.rag && state.rag.status) || '';
        return `<span class="row" style="gap:6px">
          <span class="set-path" style="max-width:200px" title="${esc(ep)}">${esc(ep || '未配置')}</span>
          <button class="btn sm" data-act="rag-config">${icon('pencil')}${ep ? '修改' : '配置'}</button>
          ${ep ? `<button class="btn sm" data-act="rag-reindex">${icon('refresh')}重建索引</button>` : ''}
          ${st === 'ok' ? `<span class="chip green">已连接</span>` : (st === 'fail' ? `<span class="chip red">连接失败</span>` : '')}
        </span>`;
      })()]
    ],
    tools: DB.apps.map(a => [
      a.n,
      a.kind === 'exe' ? (a.path || '未配置') : (a.kind === 'builtin' ? '内置视图，无需配置路径' : (a.path || '')),
      `<span class="row" style="gap:6px">
        ${a.kind === 'exe' ? `<span class="set-path" title="${esc(a.path || '')}">${esc((a.path || '').length > 32 ? '…' + (a.path || '').slice(-31) : (a.path || '未配置'))}</span>
        <button class="btn sm" data-act="set-app-path" data-n="${esc(a.n)}">${icon('search')}更改</button>
        <button class="btn sm" data-act="launch-app" data-n="${esc(a.n)}">${icon('play')}启动</button>` : `<span class="chip gray">${a.kind === 'builtin' ? '内置' : '文件夹'}</span>`}
      </span>`
    ]),
    storage: [
      ['工作区根目录', '项目材料与资源文件存放位置', `<span class="row" style="gap:6px"><span class="set-path" title="${esc(rootDir())}">${esc(rootDir())}</span><button class="btn sm" data-act="change-root">${icon('search')}更改</button><button class="btn sm" data-act="open-root-folder">${icon('folderOpen')}</button></span>`],
      ['数据文件', '本地配置与任务数据（JSON）', `<span class="row" style="gap:6px"><span class="set-path" id="data-file-path" style="max-width:260px">读取中…</span><button class="btn sm" data-act="open-data-file" title="打开所在目录">${icon('folderOpen')}</button></span>`],
      ['自动备份', '每天第一次改动时自动把数据复制一份，保留最近 7 份', sw('autoBackup', S.autoBackup)],
      ['备份状态', '实际落在磁盘上的备份副本', (() => {
        const b = state.backup || { count: 0, latest: null };
        const at = b.latest ? new Date(b.latest.at) : null;
        const when = at ? `${at.getMonth() + 1}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '—';
        const chip = b.count
          ? `<span class="chip emerald">最近 ${esc(when)} · 共 ${b.count} 份</span>`
          : `<span class="chip amber">还没有备份</span>`;
        return `<span class="row" style="gap:6px">${chip}<button class="btn sm" data-act="backup-now">${icon('save')}立即备份</button></span>`;
      })()],
      ['预览全新安装', '另开一个窗口，用临时数据展示「第一次打开」的样子；关闭窗口即清除，不影响现有数据',
        `<button class="btn sm" data-act="preview-fresh">${icon('eye')}打开预览</button>`],
      ['同步文件夹', '用本地目录/共享盘做载体的老方式；新装建议在「账户」页绑定云端（坚果云一键配置）。只同步项目与任务登记，不动材料文件', (() => {
        const sy = state.sync || {};
        const chip = sy.dir
          ? `<span class="set-path" title="${esc(sy.dir)}">${esc(sy.dir)}</span>`
          : `<span class="chip gray">未设置</span>`;
        return `<span class="row" style="gap:6px">${chip}<button class="btn sm" data-act="sync-pick-dir">${icon('folderOpen')}${sy.dir ? '更改' : '选择目录'}</button>${sy.dir ? `<button class="btn sm danger" data-act="sync-unset-dir" title="关闭同步">${icon('x')}</button>` : ''}</span>`;
      })()],
      ['同步状态', '上次同步时间、目录里其它设备的数量', (() => {
        const sy = state.sync || {};
        if (!sy.dir) return `<span class="chip gray">未启用</span>`;
        const at = sy.lastSyncAt ? new Date(sy.lastSyncAt) : null;
        const p2 = n => String(n).padStart(2, '0');
        const when = at ? `${p2(at.getMonth() + 1)}-${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}` : '还没同步过';
        const n = (sy.peers || []).length;
        const names = (sy.peers || []).map(x => x.deviceName).join('、');
        return `<span class="row" style="gap:6px">
          <span class="chip ${sy.lastSyncAt ? 'emerald' : 'amber'}">${esc(when)}</span>
          <span class="muted" style="font-size:10px" title="${esc(names)}">${n ? n + ' 台其它设备' : '暂无其它设备'}</span>
          <button class="btn sm primary" data-act="sync-now">${icon('refresh')}立即同步</button></span>`;
      })()],
      ['交接文件（数据包）', '不配网盘也能搬数据：导出成 .json 放 U 盘或直接发出去；另一台导入时走同一套合并，两边都改过的会逐条确认', (() => {
        const h = state.handoff || {};
        const p2 = n => String(n).padStart(2, '0');
        const fmtT = ts => {
          if (!ts) return '';
          const d = new Date(ts);
          return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
        };
        const tips = [];
        if (h.lastExportAt) tips.push('上次导出 ' + fmtT(h.lastExportAt));
        if (h.lastImportAt) tips.push('上次导入 ' + fmtT(h.lastImportAt));
        const chip = tips.length
          ? `<span class="muted" style="font-size:10px">${esc(tips.join(' · '))}</span>`
          : `<span class="chip gray">还没用过</span>`;
        return `<span class="row" style="gap:6px">${chip}<button class="btn sm" data-act="handoff-export">${icon('download')}导出</button><button class="btn sm" data-act="handoff-import">${icon('inbox')}导入</button></span>`;
      })()],
      ['交接单（Markdown）', '把项目阶段、正在做的任务、下一步计划整理成一份文档，交给别人看或喂给 AI', `<button class="btn sm" data-act="handoff-doc">${icon('md')}导出交接单</button>`],
      ['从备份恢复', '用历史副本覆盖当前数据（会二次确认）', `<span class="row" style="gap:6px"><button class="btn sm" data-act="backup-list">${icon('refresh')}查看备份</button><button class="btn sm" data-act="backup-dir">${icon('folderOpen')}备份目录</button></span>`],
      ['外部 RAG 检索', '启用后知识库检索走你自建的 RAG 服务；未启用时只按资料名称匹配', sw('ragEnabled', S.ragEnabled)],
      ['RAG 服务地址', '接口基地址，软件按 /health、/search、/reindex 三个端点调用', `<span class="row" style="gap:6px"><span class="set-path" title="${esc(S.ragEndpoint || '')}">${esc(S.ragEndpoint || '未设置')}</span><button class="btn sm" data-act="rag-config">${icon('pencil')}编辑</button></span>`],
      ['RAG 访问令牌', '服务需要鉴权时填 Bearer 令牌；加密保存在本地，不写入数据文件', (() => {
        const st = state.ragToken || { stored: false, encrypted: false };
        const chip = st.stored
          ? `<span class="chip emerald">${st.encrypted ? '已加密保存' : '已保存（未加密）'}</span>`
          : `<span class="chip gray">未配置</span>`;
        return `<span class="row" style="gap:6px">${chip}<button class="btn sm" data-act="rag-token">${icon('settings')}${st.stored ? '更换' : '设置'}</button>${st.stored ? `<button class="btn sm danger" data-act="rag-token-clear" title="清除令牌">${icon('trash')}</button>` : ''}</span>`;
      })()],
      ['检索返回条数', '请求时传给服务的 top_k', `<select class="select" data-act="set-select" data-key="ragTopK">${['4', '8', '12', '20'].map(v => `<option value="${v}"${String(S.ragTopK) === v ? ' selected' : ''}>${v}</option>`).join('')}</select>`],
      ['RAG 连接测试', '调用 /health，确认服务可用并读取索引规模', `<button class="btn sm" data-act="rag-test">${icon('pulse')}测试连接</button>`],
      ['重建工作区目录', '重新创建缺失的项目材料目录结构', `<button class="btn sm" data-act="rebuild-structure">${icon('refresh')}重建</button>`],
      ['导出全部数据', '把当前工作台数据导出为 JSON 文件', `<button class="btn sm" data-act="export-data">${icon('download')}导出</button>`],
      ['重置所有数据', '清除本地数据，恢复到初始示例内容', `<button class="btn sm danger" data-act="reset-data">${icon('trash')}重置</button>`]
    ],
    about: [
      ['项目模板', '导出/导入 JSON 模板，方便团队共用项目结构（目录、阶段、起始任务）',
        `<span class="row" style="gap:6px">
          <button class="btn sm" data-act="template-export">${icon('externalLink')}导出</button>
          <button class="btn sm" data-act="template-import">${icon('plus')}导入</button>
          <span class="muted" style="font-size:10px">${(DB.templates || []).length} 个模板</span>
        </span>`],
      ['版本', '当前软件版本', (() => {
        const u = state.update || {};
        const chip = u.portable ? '<span class="chip gray" style="font-size:9px;padding:1px 5px">便携版</span>' : '';
        return `<span class="row" style="gap:6px"><span class="set-path" style="max-width:150px">v${esc(u.version || '2.8.6')} Desktop</span>${chip}</span>`;
      })()],
      ['检查更新', '从更新源拉取版本清单，只下载约 1MB 的应用资源增量包；替换在软件关闭后自动完成并重启', (() => {
        const u = state.update || {};
        if (!u.portable) return `<span class="chip gray">仅便携版支持</span>`;
        return `<button class="btn sm primary" data-act="update-check">${icon('refresh')}检查更新</button>`;
      })()],
      ['更新源', '已内置官方仓库，一般不用改；想换成自己的镜像或坚果云再改。清空后保存 = 恢复默认', (() => {
        const u = state.update || {};
        if (!u.portable) return `<span class="chip gray">—</span>`;
        const tag = u.sourceIsDefault ? '<span class="chip gray" style="font-size:9px;padding:1px 5px">默认</span>' : '';
        return `<span class="row" style="gap:6px">
          <input class="input" id="update-source-input" value="${esc(u.source || '')}" placeholder="例：github:用户名/仓库　或　cloud" style="width:260px">
          <button class="btn sm" data-act="update-setsource">${icon('save')}保存</button>
          ${tag}
        </span>`;
      })()],
      ['本机标识', '工作区根目录与软件安装路径只在本机生效，不随数据同步', (() => {
        const dv = state.device || {};
        const id = dv.deviceId ? dv.deviceId.slice(0, 8) : '—';
        return `<span class="row" style="gap:6px"><span class="chip gray mono">${esc(id)}</span><span class="muted" style="font-size:10px">${esc(dv.deviceName || '')}</span></span>`;
      })()],
      ['运行环境', '当前宿主环境', `<span class="set-path" style="max-width:300px">${Bridge.desktop ? `Electron ${esc(((window.workspace || {}).versions || {}).electron || '')} · Chromium ${esc(((window.workspace || {}).versions || {}).chrome || '')}` : '浏览器（降级模式）'}</span>`],
      ['技术栈', '桌面端渲染层', `<span class="set-path" style="max-width:300px">Electron + 原生 HTML/CSS/JS（零构建）</span>`],
      ['数据存储', '本地数据文件位置', `<button class="btn sm" data-act="open-data-file">${icon('folderOpen')}打开位置</button>`],
      ['许可证', '授权方式', `<span class="set-path" style="max-width:120px">MIT</span>`]
    ]
  };
  const cur = rows[state.setTab] || rows.general;
  const body = state.setTab === 'external'
    ? externalPanel()
    : cur.map(([n, d, ctl]) => `<div class="set-row">
        <div class="s-body"><div class="s-name">${esc(n)}</div><div class="s-desc">${esc(d)}</div></div>
        <div class="s-ctl">${ctl}</div>
      </div>`).join('');
  return `<div class="fade-in">
    <div class="page-head"><h2>设置</h2><span class="page-sub">工作台偏好 · Agent · 工具链 · 数据</span>
      <span class="ph-right"><button class="btn sm" data-act="open-root-folder">${icon('folderOpen')}打开工作区目录</button></span></div>
    <div class="settings-grid">
      <nav class="settings-nav card" style="padding:7px">
        ${SET_NAV.map(([k, l]) => `<button class="${k === state.setTab ? 'active' : ''}" data-tab="set" data-val="${k}">${l}</button>`).join('')}
      </nav>
      <div class="card panel">
        <div class="panel-head"><h3>${(SET_NAV.find(n => n[0] === state.setTab) || SET_NAV[0])[1]}</h3></div>
        ${body}
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   外壳
   ========================================================================== */
/* Sprint A：侧栏只留个人每周会用的入口（时间线/自动化/任务中心/Agent 中心/启动台/浏览器已并入） */
const NAV = [
  ['home', 'grid', '项目'],
  ['knowledge', 'book', '知识库'],
  ['ai', 'sparkles', 'AI 助手'],
  ['settings', 'settings', '设置']
];

/* ==========================================================================
   侧栏：待办 + 快捷启动（v2.8.2 把左侧空间用起来）
   ========================================================================== */
function sidebarTodosHTML() {
  const open = DB.todos.filter(t => !t.done).slice(0, 6);
  const total = DB.todos.filter(t => !t.done).length;
  return `<div class="side-block">
    <div class="side-block-head">
      <span>${icon('check')}待办${total ? ` <b>${total}</b>` : ''}</span>
      <button class="side-mini" data-act="new-todo" title="新建待办">${icon('plus')}</button>
    </div>
    ${open.length ? `<div class="side-todos">
      ${open.map(t => {
        const idx = DB.todos.indexOf(t);
        const cat = (TODO_CATS.find(c => c[0] === t.cat) || [])[1] || '其他';
        return `<button class="side-todo" data-act="side-todo-done" data-idx="${idx}" title="${esc(cat)} · ${esc(t.due || '')}">
          <span class="st-dot"></span>
          <span class="st-txt">${esc(t.t)}</span>
        </button>`;
      }).join('')}
    </div>` : `<div class="side-empty">没有待办</div>`}
    ${total > 6 ? `<button class="side-more" data-act="side-all-todos">还有 ${total - 6} 条…</button>` : ''}
  </div>`;
}

function sidebarQuickHTML() {
  const items = (DB.sidebarLaunch || []).filter(n => DB.apps.some(a => a.n === n));
  return `<div class="side-block side-quick-block">
    <div class="side-block-head">
      <span>${icon('rocket')}快捷启动</span>
      <button class="side-mini" data-act="quick-manage" title="管理快捷入口">${icon('settings')}</button>
    </div>
    ${items.length ? `<div class="side-quick">
      ${items.map(n => `<button class="side-quick-item" data-act="quick-launch" data-n="${esc(n)}" title="${esc(n)}">
        ${appTile(n, 22)}
      </button>`).join('')}
      <button class="side-quick-item side-quick-add" data-act="quick-manage" title="添加">${icon('plus')}</button>
    </div>` : `<button class="side-empty side-empty-btn" data-act="quick-manage">${icon('plus')}选择要固定的软件</button>`}
  </div>`;
}

function renderSidebar() {
  const badges = { tasks: DB.tasks.filter(t => t.st === 'doing').length, agents: DB.agents.filter(a => a.status === 'running').length };
  return `<aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">${icon('flask')}</span>
      <div class="brand-text"><h1>个人科研工作台</h1><p>RESEARCH OS</p></div>
    </div>
    <nav>${NAV.map(([k, i, l]) => `<button class="nav-item ${state.route === k ? 'active' : ''}" data-route="${k}">
      ${icon(i)}<span>${l}</span>
      ${badges[k] ? `<span class="nav-badge">${badges[k]}</span>` : ''}
    </button>`).join('')}</nav>

    ${sidebarTodosHTML()}
    ${sidebarQuickHTML()}

    <div class="sidebar-foot">
      <span class="pill-running"></span>
      <span>${DB.agents.filter(a => a.status !== 'idle').length} 个 Agent 在役 · ${Bridge.desktop ? '本地模式' : '浏览器模式'}</span>
    </div>
  </aside>`;
}

/* 提醒：全部由当前数据推导 —— 不写死示例，点开看到的都是真实可跟进的条目 */
function buildNotifications() {
  const out = [];
  const open = DB.todos.filter(t => !t.done);
  const urgent = open.filter(t => /逾期|今天|今日/.test(String(t.time || '')));
  if (urgent.length) out.push({ i: 'alert', c: 'var(--amber)', alert: true, t: `${urgent.length} 条待办临近或已过截止时间`, s: urgent.map(x => x.t).join('、') });
  const review = DB.tasks.filter(t => t.st === 'review');
  if (review.length) out.push({ i: 'alert', c: 'var(--red)', alert: true, t: `${review.length} 个任务等待复核`, s: review.map(t => t.t).join('、') });
  const high = DB.tasks.filter(t => t.pri === 'high' && t.st !== 'done');
  if (high.length) out.push({ i: 'target', c: 'var(--accent-500)', alert: true, t: `${high.length} 个高优先级任务未完成`, s: high.map(t => t.t).join('、') });
  if (open.length) out.push({ i: 'check', c: 'var(--violet)', t: `还有 ${open.length} 条待办未完成`, s: '可在首页「待办事项」中直接勾选' });
  const running = (DB.workspace && DB.workspace.running) || [];
  if (running.length) out.push({ i: 'cpu', c: 'var(--blue)', t: `${running.length} 个程序正在运行`, s: running.join(' · ') });
  const active = DB.agents.filter(a => a.status !== 'idle');
  if (active.length) out.push({ i: 'bot', c: 'var(--green)', t: `${active.length} 个 Agent 在役`, s: active.map(a => a.name).join(' · ') });
  if (!out.length) out.push({ i: 'check', c: 'var(--green)', t: '暂无需要处理的提醒', s: '任务与待办都在正常推进' });
  return out;
}

function renderTopbar() {
  const stats = [
    ['tasks', 'linear-gradient(135deg,#E0668E,#B01E58)', `${DB.todos.filter(t => !t.done).length}`, '今日待办'],
    ['grid', 'linear-gradient(135deg,#8A7ED6,#5B4C9E)', `${DB.projects.length}`, '进行中项目'],
    ['bot', 'linear-gradient(135deg,#4E88C0,#2A5C8C)', `${DB.agents.filter(a => a.status !== 'idle').length}`, '运行Agent']
  ];
  const hasAlert = buildNotifications().some(n => n.alert);
  return `<header class="topbar">
    <div class="search-wrap">
      <label class="search">
        ${icon('search', 'color:var(--text-4)')}
        <input id="global-search" placeholder="搜索项目、任务、文档、代码、知识库..." value="${esc(state.search)}" autocomplete="off">
        <span class="kbd">Ctrl + K</span>
      </label>
      <div id="search-panel"></div>
    </div>
    <span class="grow"></span>
    ${stats.map(([i, bg, v, l]) => `<div class="stat-pill">
      <span class="stat-ico" style="background:${bg}">${icon(i)}</span>
      <span><span class="stat-val">${v}</span>
      <span class="stat-lbl" style="display:block">${l}</span></span>
    </div>`).join('')}
    <div class="topbar-right">
      <button class="icon-btn" data-act="undo-history" title="${undoStack.length
        ? `撤销历史 · 最近一步：${esc(undoStack[undoStack.length - 1].label)}（Ctrl+Z 直接撤销）`
        : '撤销历史'}">${icon('undo')}${undoStack.length ? `<span class="undo-count">${undoStack.length}</span>` : ''}</button>
      <button class="icon-btn" data-act="notify" title="通知">${icon('bell')}${hasAlert ? '<span class="dot"></span>' : ''}</button>
      <div class="user-chip">
        <span class="avatar">${esc(DB.user.initial)}</span>
        <div><div class="u-name">${esc(DB.user.greet)}</div><div class="u-sub">${esc(DB.user.mode)}</div></div>
      </div>
    </div>
  </header>`;
}

function renderStatusbar() {
  const w = DB.workspace;
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;

  /* 备份状态：显示磁盘上真实的副本份数与时间，不再假装「同步已完成」 */
  const bk = state.backup || { count: 0, latest: null };
  const bkAt = bk.latest ? new Date(bk.latest.at) : null;
  const bkWhen = bkAt ? `${p(bkAt.getMonth() + 1)}-${p(bkAt.getDate())} ${p(bkAt.getHours())}:${p(bkAt.getMinutes())}` : '';
  const bkOk = bk.count > 0;
  const bkText = !Bridge.desktop ? '本地缓存'
    : !DB.settings.autoBackup ? '自动备份已关闭'
      : bkOk ? `${bk.count} 份` : '尚未备份';
  const bkTip = !Bridge.desktop ? '浏览器降级模式，数据存在 localStorage'
    : !DB.settings.autoBackup ? '自动备份已关闭，可到「设置 → 数据与同步」开启'
      : bkOk ? `最近一份 ${bkWhen} · 保留最近 7 份` : '还没有备份，可到「设置 → 数据与同步」立即备份';

  return `<footer class="statusbar">
    ${FRESH_PREVIEW ? `<span class="sb-item" title="这是预览窗口：数据写在临时目录，关闭后自动删除">
      <span class="sb-dot" style="background:#AD5700"></span><b>全新安装预览</b><span class="k sb-hide-sm">临时数据</span></span>` : ''}
    <span class="sb-item"><span class="sb-dot" style="background:#C9256B"></span><span class="k sb-hide-sm">当前工作区：</span><b>${esc(w.project || '—')}</b></span>
    <span class="sb-item"><span class="k sb-hide-sm">运行：</span>${w.running.length
      ? w.running.map(n => `<button class="sb-run-chip" data-act="focus-app" data-n="${esc(n)}">${appTile(n, 13)}${esc(n)}</button>`).join('')
      : '<span class="muted">无</span>'}</span>
    <span class="sb-item"><span class="sb-dot" style="background:#6E56CF"></span><span class="k sb-hide-sm">Agent：</span><b>${w.agents} 个运行中</b></span>
    <span class="sb-item sb-hide-md" title="${esc(bkTip)}"><span class="sb-dot" style="background:${bkOk ? '#218358' : '#AD5700'}"></span><span class="k sb-hide-sm">备份：</span><b>${esc(bkText)}</b></span>
    <span class="sb-right">
      <span class="mono muted sb-hide-md" style="font-size:9.5px">${Bridge.desktop ? '本地存储' : '本地缓存'}</span>
      <span class="mono sb-hide-sm">${stamp}</span>
    </span>
  </footer>`;
}

const VIEWS = {
  home: homeView, project: projectView, projects: homeView, tasks: tasksView, timeline: timelineView,
  knowledge: knowledgeView, ai: aiView, agents: agentsView, automation: automationView,
  dock: dockView, browser: browserView, settings: settingsView
};

function render() {
  /* 重绘会重建 DOM，这里保留 AI 对话区的滚动位置（贴底时继续贴底） */
  const stream = document.getElementById('ai-stream');
  const prevTop = stream ? stream.scrollTop : 0;
  const stickBottom = stream ? (stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48) : false;

  $('#sidebar-slot').innerHTML = renderSidebar();
  $('#topbar-slot').innerHTML = renderTopbar();
  $('#statusbar-slot').innerHTML = renderStatusbar();

  /* 内置浏览器使用常驻面板：webview 不能随重绘销毁，否则页面会被反复重载 */
  const view = $('#view'), pane = $('#browser-pane');
  if (state.route === 'browser') {
    if (view) { view.hidden = true; view.innerHTML = ''; }
    if (pane) { pane.hidden = false; renderBrowserChrome(); }
  } else {
    if (pane) pane.hidden = true;
    if (view) { view.hidden = false; view.innerHTML = (VIEWS[state.route] || homeView)(); }
  }

  applyAppearance();
  if (state.setTab === 'storage') fillDataFilePath();

  const ns = document.getElementById('ai-stream');
  if (ns) ns.scrollTop = stickBottom ? ns.scrollHeight : prevTop;

  /* 账户门盖在最上层：只在签名变化时重建，避免打断用户输入 */
  renderAuthGate();
}

/* ---------- 外观设置真实生效 ---------- */
function applyAppearance() {
  const S = DB.settings;
  document.body.classList.toggle('no-glass', !S.glass);
  document.body.classList.toggle('no-ambient', !S.ambient);
  document.body.classList.toggle('compact', !!S.compact);
  document.body.classList.toggle('no-motion', !S.motion);
  document.body.classList.toggle('no-badges', !S.notifyDot);
  const inp = document.getElementById('global-search');
  if (inp && document.activeElement !== inp && inp.value !== state.search) inp.value = state.search;
}

async function fillDataFilePath() {
  const el = document.getElementById('data-file-path');
  if (!el) return;
  if (!Bridge.desktop) { el.textContent = 'localStorage（浏览器模式）'; return; }
  const f = await window.workspace.dataFilePath();
  el.textContent = f || '—';
  el.title = f || '';
}
