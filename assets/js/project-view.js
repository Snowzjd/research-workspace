/* ==========================================================================
   项目页（Sprint A：项目成为唯一工作面）
   Tab：概览 / 任务 / 材料 / 本项目软件 / 文档
   ========================================================================== */

const PROJECT_TABS = [
  ['overview', '概览', 'grid'],
  ['tasks', '任务', 'tasks'],
  ['materials', '材料', 'folder'],
  ['software', '本项目软件', 'rocket'],
  ['docs', '文档', 'pencil']
];

function projectView() {
  const p = P(state.project) || DB.projects[0];
  if (!p) return emptyWorkspace({ title: '还没有项目', desc: '新建一个项目，任务、材料与软件都会收在它里面。', full: true });
  const tab = PROJECT_TABS.some(t => t[0] === state.projectTab) ? state.projectTab : 'overview';
  const openTasks = DB.tasks.filter(t => t.p === p.id && t.st !== 'done').length;
  const openLabel = incompleteLabel(openTasks);
  const headBits = [p.stage || '未设置阶段', `进度 ${p.progress || 0}%`];
  if (openLabel) headBits.push(openLabel);

  return `<div class="page">
    <div class="page-head">
      <h2>${esc(projName(p))}</h2>
      <span class="page-stage">${esc(p.stage || '未设置阶段')}</span>
      <span class="page-sub">${headBits.slice(1).join(' · ')}</span>
      <span class="ph-right">
        <button class="btn sm" data-act="project-back">${icon('grid')}全部项目</button>
        <button class="btn sm" data-act="open-project-folder" data-id="${p.id}">${icon('folderOpen')}打开目录</button>
        <button class="btn sm" data-act="ai-open-project" data-id="${p.id}">${icon('sparkles')}AI 助手</button>
      </span>
    </div>

    <div class="proj-tabs seg" style="margin-bottom:var(--gap)">
      ${PROJECT_TABS.map(([k, label, ico]) =>
        `<button class="${k === tab ? 'active' : ''}" data-act="project-tab" data-v="${k}">${icon(ico)}${label}${k === 'tasks' && openLabel ? ` <span class="pinfo">${openTasks}</span>` : ''}</button>`).join('')}
    </div>

    ${tab === 'overview' ? `<div class="detail-grid">
        <div class="detail-main">${detailCard(p)}</div>
        <div class="detail-side">${flowCard(p)}</div>
      </div>
      ${(() => {
        /* S1：新项目从概览就能去任务 / 材料 / 软件 */
        const openHere = DB.tasks.filter(t => t.p === p.id && t.st !== 'done').length;
        const matCount = materialsIn(p.id).length;
        const appCount = (DB.apps || []).filter(a => a.bound === p.id).length;
        const taskTitle = openHere ? `任务 · ${incompleteLabel(openHere)}` : '任务';
        return `<div class="ov-guides">
          <button class="ov-guide" data-act="project-tab" data-v="tasks">
            <span class="og-ico">${icon('tasks')}</span>
            <div><div class="og-title">${taskTitle}</div>
              <div class="og-sub">${openHere ? '继续推进当前任务' : '拆出第一个任务'}</div></div>
          </button>
          <button class="ov-guide" data-act="project-tab" data-v="materials">
            <span class="og-ico">${icon('folder')}</span>
            <div><div class="og-title">材料 · 登记 ${matCount} 个</div>
              <div class="og-sub">与磁盘同步，把文件纳入项目</div></div>
          </button>
          <button class="ov-guide" data-act="project-tab" data-v="software">
            <span class="og-ico">${icon('rocket')}</span>
            <div><div class="og-title">软件 · 绑定 ${appCount} 个</div>
              <div class="og-sub">拖入 Fluent 等快捷方式</div></div>
          </button>
        </div>`;
      })()}
      <div class="bottom-grid">${activityCard()}${todoCard()}${resourceCard()}</div>`
    : ''}
    ${tab === 'tasks' ? projectTasksHTML(p) : ''}
    ${tab === 'materials' ? projectMaterialsHTML(p) : ''}
    ${tab === 'software' ? projectSoftwareHTML(p) : ''}
    ${tab === 'docs' ? projectDocsHTML(p) : ''}
  </div>`;
}

/* ---------- 任务 ---------- */
function projectTasksHTML(p) {
  const all = DB.tasks.filter(t => t.p === p.id);
  const filter = state.taskFilter || 'all';
  const rows = all.filter(t => filter === 'all' || t.st === filter);
  const priOrder = { high: 0, mid: 1, low: 2 };
  const sorted = rows.slice().sort((a, b) => (priOrder[a.pri] - priOrder[b.pri]) || String(a.due).localeCompare(String(b.due)));
  const chips = [['all', '全部', all.length]]
    .concat(DB.taskStatus.map(s => [s.key, s.label, all.filter(t => t.st === s.key).length]));

  return `<div class="card panel">
    <div class="panel-head">
      <h3>${icon('tasks')}本项目任务</h3>
      <span class="head-sub">${all.length} 条${incompleteLabel(all.filter(t => t.st !== 'done').length) ? ' · ' + incompleteLabel(all.filter(t => t.st !== 'done').length) : ''}</span>
      <span class="grow"></span>
      <button class="btn sm primary" data-act="new-task" data-p="${p.id}">${icon('plus')}新建任务</button>
    </div>
    <div class="row" style="gap:6px;padding:0 12px 10px;flex-wrap:wrap">
      ${chips.map(([k, label, n]) =>
        `<button class="chip ${k === filter ? 'accent' : 'gray'}" data-act="proj-task-filter" data-v="${k}" style="cursor:pointer">${label} ${n}</button>`).join('')}
    </div>
    ${sorted.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th style="width:34%">任务</th><th>负责 Agent</th><th>工具</th><th>截止</th><th>优先级</th><th>状态</th><th></th></tr></thead>
      <tbody>${sorted.map(t => {
        const idx = DB.tasks.indexOf(t);
        return `<tr data-act="open-task" data-idx="${idx}" title="点击打开任务">
          <td><div class="t-title">${esc(t.t)}</div><div class="t-sub">${icon('folder', 'width:10px;height:10px')} ${esc(t.dir || '—')}</div></td>
          <td><span class="row" style="gap:6px">${agentTile(t.agent, 20)}<span>${esc(t.agent || '—')}</span></span></td>
          <td><span class="row" style="gap:5px">${appTile(t.tool, 16)}<span class="muted">${esc(t.tool || '—')}</span></span></td>
          <td class="mono muted">${esc(t.due || '—')}</td>
          <td>${priTag(t.pri)}</td>
          <td>${stChip(t.st)}</td>
          <td class="row-actions"><button class="btn sm ghost" data-act="open-task-folder" data-idx="${idx}" title="打开材料文件夹">${icon('folderOpen')}</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>` : emptyState({
      icon: 'tasks',
      title: all.length ? '该状态下暂无任务' : '这个项目还没有任务',
      sub: all.length ? '换一个状态筛选，或新建一条。' : '任务归在这个项目里，建好后会出现在这张表。',
      primary: { act: 'new-task', label: '新建任务', ico: 'plus', data: { p: p.id } },
      secondary: { act: 'ai-open-project', label: '让助手拆', ico: 'sparkles', data: { id: p.id } }
    })}
  </div>`;
}

/* ---------- 材料 ---------- */
function projectMaterialsHTML(p) {
  const dirs = Object.keys(materialIndexOf(p.id));
  const files = materialsIn(p.id);
  const scan = state.matScan && state.matScan.pid === p.id ? state.matScan : null;
  return `<div class="card panel">
    <div class="panel-head">
      <h3>${icon('folder')}材料</h3>
      <span class="head-sub">
        登记表 ${files.length} 个文件${scan ? `　·　磁盘 ${scan.count} 个` : ''}
      </span>
      <span class="grow"></span>
      <button class="btn sm primary" data-act="mat-scan" data-id="${p.id}">${icon('refresh')}与磁盘同步</button>
      <button class="btn sm" data-act="open-project-folder" data-id="${p.id}">${icon('folderOpen')}打开目录</button>
    </div>
    ${scan ? matDiffHTML(p, scan) : ''}
    <div class="proj-mat-list">
      ${dirs.length ? dirs.map(d => {
        const inDir = files.filter(f => String(f.dir || f.rel || '').startsWith(d));
        return `<div class="proj-mat-row">
          <span class="proj-mat-ico">${icon('folder')}</span>
          <div class="grow"><div class="proj-mat-name">${esc(d)}</div>
            <div class="proj-mat-sub">${inDir.length} 个已登记文件</div></div>
          <button class="btn sm ghost" data-act="proj-open-mat" data-id="${p.id}" data-d="${esc(d)}">${icon('folderOpen')}打开</button>
        </div>`;
      }).join('') : emptyState({
        icon: 'folder',
        title: '还没有材料目录',
        sub: '先把文件放进项目目录，再与磁盘同步。同步只读磁盘，不会改你的文件。',
        primary: { act: 'mat-scan', label: '与磁盘同步', ico: 'refresh', data: { id: p.id } },
        secondary: { act: 'open-project-folder', label: '打开目录', ico: 'folderOpen', data: { id: p.id } }
      })}
    </div>
  </div>`;
}

/* ---------- 本项目软件 ---------- */
function projectSoftwareHTML(p) {
  const bound = (DB.apps || []).filter(a => a.bound === p.id);
  const others = (DB.apps || []).filter(a => a.bound !== p.id);
  return `<div class="card panel">
    <div class="panel-head">
      <h3>${icon('rocket')}本项目软件</h3>
      <span class="head-sub">${bound.length} 个已绑定</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="goto-dock">${icon('settings')}管理全部软件</button>
    </div>
    <div class="drop-zone" data-drop="proj-app" data-id="${p.id}">
      <span class="dz-ico">${icon('plus')}</span>
      <div class="dz-text"><b>把快捷方式拖进来</b>
        <span>支持 .lnk 快捷方式 / .exe 程序 / 文件夹 —— 自动识别名称与路径，不用手填</span></div>
    </div>
    ${bound.length ? `<div class="proj-app-grid">${bound.map((a, i) => `<div class="proj-app-card">
        <button class="proj-app" data-act="launch-app" data-n="${esc(a.n)}" title="点击启动">
          ${appTile(a.n, 34)}
          <div class="proj-app-name">${esc(a.displayName || a.n)}</div>
          <div class="proj-app-sub">${a.path ? esc(String(a.path).split(/[\\/]/).pop()) : '未绑定路径'}</div>
        </button>
        <div class="proj-app-ops">
          <button class="icon-btn" data-act="proj-app-move" data-n="${esc(a.n)}" data-dir="up" title="上移" ${i === 0 ? 'disabled' : ''}><span style="display:inline-flex;transform:rotate(-90deg)">${icon('chevronRight')}</span></button>
          <button class="icon-btn" data-act="proj-app-move" data-n="${esc(a.n)}" data-dir="down" title="下移" ${i === bound.length - 1 ? 'disabled' : ''}><span style="display:inline-flex;transform:rotate(90deg)">${icon('chevronRight')}</span></button>
          <button class="icon-btn" data-act="proj-app-rename" data-n="${esc(a.n)}" title="重命名">${icon('pencil')}</button>
          <button class="icon-btn" data-act="proj-app-unbind" data-n="${esc(a.n)}" data-id="${p.id}" title="从本项目移除">${icon('x')}</button>
        </div>
      </div>`).join('')}</div>`
      : emptyState({
        icon: 'rocket',
        title: '还没有绑定到本项目的软件',
        sub: '把 Fluent / SpaceClaim 的快捷方式拖进上面的框，或从下面未绑定的程序里绑过来。绑定不会把程序标成正在运行。',
        primary: { act: 'import-launch', label: '导入快捷方式', ico: 'link', data: { mode: 'shortcut' } },
        secondary: { act: 'rescan-apps', label: '扫描已安装', ico: 'search' }
      })}

    ${others.length ? `<div class="panel-head" style="padding:12px 12px 4px"><h3 style="font-size:11px">其它已登记软件（可绑定到本项目）</h3></div>
      <div class="proj-app-grid">${others.map(a => `<div class="proj-app">
        ${appTile(a.n, 30)}
        <div class="proj-app-name">${esc(a.displayName || a.n)}</div>
        <div class="proj-app-sub">${a.bound ? '已属 ' + esc(projName(P(a.bound)) || '其它项目') : '未绑定项目'}${a.run === true ? ' · 运行中' : ''}</div>
        <button class="btn sm" data-act="proj-bind-app" data-id="${p.id}" data-n="${esc(a.n)}">绑到本项目</button>
      </div>`).join('')}</div>` : ''}
  </div>`;
}

/* ---------- 文档 ---------- */
function projectDocsHTML(p) {
  const fileOf = d => String(d.file || '');
  const roots = [p.folder || p.name, p.name].filter((v, i, arr) => v && arr.indexOf(v) === i);
  const docs = (DB.kbDocs || []).filter(d => {
    const f = fileOf(d);
    const writing = String(d.type || '').startsWith('写作') || d.ext === 'md';
    return writing && roots.some(r => f.startsWith(r + '/') || f.includes('/' + r + '/'));
  });
  return `<div class="card panel">
    <div class="panel-head">
      <h3>${icon('pencil')}文档</h3>
      <span class="head-sub">${docs.length} 篇</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="ai-open-project" data-id="${p.id}">${icon('sparkles')}让 Agent 写</button>
    </div>
    ${docs.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th style="width:44%">文档</th><th>类型</th><th>日期</th><th style="text-align:right">操作</th></tr></thead>
      <tbody>${docs.map(d => `<tr>
        <td><div class="t-title">${esc(d.n)}</div><div class="t-sub">${esc(d.file || '')}</div></td>
        <td><span class="chip gray">${esc(d.type || '文档')}</span></td>
        <td class="mono muted">${esc(d.date || '—')}</td>
        <td style="text-align:right"><button class="btn sm ghost" data-act="proj-open-doc" data-file="${esc(d.file || '')}">${icon('folderOpen')}打开</button></td>
      </tr>`).join('')}</tbody>
    </table></div>` : emptyState({
      icon: 'pencil',
      title: '还没有写作产出',
      subHtml: `派一单写作任务后，成稿存进 <span class="mono">${esc(p.folder || p.name)}/写作/</span>`,
      primary: { act: 'ai-mode', label: '去派任务', ico: 'send', data: { v: 'assign' } },
      secondary: { act: 'open-project-folder', label: '打开项目目录', ico: 'folderOpen', data: { id: p.id } }
    })}
  </div>`;
}


/* ==========================================================================
   Sprint B：拖拽导入软件（自动解析名称/路径，登记并绑定到当前项目）
   ========================================================================== */
const APP_PALETTE = [
  'linear-gradient(135deg,#4A7FB5,#1E4A7D)', 'linear-gradient(135deg,#7A6AD6,#4636A0)',
  'linear-gradient(135deg,#E0668E,#B01E58)', 'linear-gradient(135deg,#3E63DD,#23409C)',
  'linear-gradient(135deg,#218358,#14603C)', 'linear-gradient(135deg,#C79A3E,#8A5E14)'
];

async function importDroppedApps(zone, fileList) {
  const pid = zone.dataset.id;
  const project = P(pid);
  const files = Array.from(fileList || []);
  if (!files.length) return toast('没识别到文件，请拖快捷方式或程序本身', 'err');
  if (!Bridge.desktop || !window.workspace.resolveDropped) {
    return toast('拖拽导入只在桌面端可用', 'err');
  }

  const added = [], rebound = [], failed = [];
  for (const f of files) {
    let abs = '';
    try { abs = window.workspace.getPathForFile(f) || ''; } catch (_) { abs = (f && f.path) || ''; }
    if (!abs) { failed.push(`${f.name || '未知文件'}（拿不到真实路径）`); continue; }

    const r = await window.workspace.resolveDropped(abs);
    if (!r || !r.ok) { failed.push(`${f.name || abs} —— ${(r && r.error) || '解析失败'}`); continue; }

    /* 同路径已登记 → 只做绑定；否则新增 */
    const exist = DB.apps.find(a => a.path && String(a.path).toLowerCase() === String(r.path).toLowerCase())
      || DB.apps.find(a => a.n === r.name);
    if (exist) {
      exist.path = r.path;
      if (r.cwd) exist.cwd = r.cwd;
      if ((r.args || []).length) exist.args = r.args;
      if (r.icon) exist.icon = r.icon;
      exist.bound = pid;
      exist.pending = false;
      if (!exist.displayName) exist.displayName = exist.n;
      rebound.push(exist.n);
    } else {
      DB.apps.push({
        n: r.name, displayName: r.name, ico: String(r.name).slice(0, 2).toUpperCase(),
        kind: r.kind === 'folder' ? 'folder' : 'exe',
        args: r.args || [], cwd: r.cwd || '',
        bg: APP_PALETTE[DB.apps.length % APP_PALETTE.length],
        path: r.path, icon: r.icon || '',
        source: 'dropped', sourcePath: abs,
        run: null, bound: pid, pending: false
      });
      added.push(r.name);
    }
  }

  persist();
  render();

  const parts = [];
  if (added.length) parts.push(`新增 ${added.length} 个：${added.map(esc).join('、')}`);
  if (rebound.length) parts.push(`已存在并绑定 ${rebound.length} 个`);
  if (parts.length) {
    logActivity(`拖拽导入软件到项目 <b>${esc(project ? project.name : '')}</b>：${parts.join('；')}`, 'create', '#218358');
    toast(`已导入到「${esc(project ? project.name : '本项目')}」<br><span class="muted">${parts.join('；')}</span>`, 'ok');
  }
  if (failed.length) toast(`有 ${failed.length} 个没能导入：<br><span class="muted">${failed.map(esc).join('<br>')}</span>`, 'err');
}


/* ---------- 材料双视图：磁盘 vs 登记表 ---------- */
function matDiffHTML(p, scan) {
  const registered = materialsIn(p.id);
  const disk = [];
  (scan.dirs || []).forEach(d => (d.files || []).forEach(f => disk.push(Object.assign({ dir: d.dir }, f))));
  const regKey = new Set(registered.map(f => `${f.dir}/${f.n}`));
  const diskKey = new Set(disk.map(f => `${f.dir}/${f.n}`));
  const added = disk.filter(f => !regKey.has(`${f.dir}/${f.n}`));
  const missing = registered.filter(f => !diskKey.has(`${f.dir}/${f.n}`));

  return `<div class="mat-diff">
    <div class="mat-diff-head">
      <span class="chip accent">磁盘 ${disk.length}</span>
      <span class="chip gray">登记表 ${registered.length}</span>
      <span class="chip ${added.length ? 'green' : 'gray'}">磁盘新增 ${added.length}</span>
      <span class="chip ${missing.length ? 'amber' : 'gray'}">登记已失效 ${missing.length}</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="mat-sync-cancel">关闭</button>
      <button class="btn sm primary" data-act="mat-sync-apply" data-id="${p.id}"
        ${(added.length || missing.length) ? '' : 'disabled'}>按磁盘重建登记</button>
    </div>
    ${added.length || missing.length ? `<div class="mat-diff-list">
      ${added.slice(0, 6).map(f => `<div class="mat-diff-row add"><span>+</span>${esc(f.dir)}/${esc(f.n)}<b>${esc(f.size)}</b></div>`).join('')}
      ${missing.slice(0, 6).map(f => `<div class="mat-diff-row del"><span>−</span>${esc(f.dir)}/${esc(f.n)}</div>`).join('')}
      ${(added.length + missing.length) > 12 ? `<div class="mat-diff-row">…还有 ${added.length + missing.length - 12} 条</div>` : ''}
    </div>` : `<div class="field-hint" style="padding:0 12px 10px">磁盘与登记表一致，无需同步</div>`}
  </div>`;
}

/* 扫描磁盘（只读，不写登记） */
async function scanProjectMaterials(pid) {
  const p = P(pid);
  if (!p) return toast('项目不存在', 'err');
  if (!Bridge.desktop || !window.workspace.scanMaterials) return toast('材料扫描只在桌面端可用', 'err');
  const r = await window.workspace.scanMaterials({ folder: p.folder || p.name });
  if (!r || !r.ok) {
    state.matScan = null;
    render();
    return toast(`扫描失败：${esc((r && r.error) || '未知错误')}`, 'err');
  }
  state.matScan = { pid, count: r.count || 0, dirs: r.dirs || [], root: r.root || '', at: Date.now() };
  render();
  toast(`磁盘上扫到 ${r.count || 0} 个文件（尚未写入登记）`, 'ok');
}

/* 确认后按磁盘重建登记表 */
function applyMaterialSync(pid) {
  const scan = state.matScan;
  if (!scan || scan.pid !== pid) return toast('请先扫描', 'err');
  const idx = {};
  (scan.dirs || []).forEach(d => {
    idx[d.dir] = (d.files || []).map(f => [f.n, f.size, f.ext]);
  });
  DB.materialIndex[pid] = idx;
  state.matScan = null;
  persist();
  render();
  const total = Object.values(idx).reduce((n, arr) => n + arr.length, 0);
  logActivity(`按磁盘重建材料登记：${Object.keys(idx).length} 个目录 / ${total} 个文件`, 'edit', '#AD5700');
  toast(`登记已更新：${Object.keys(idx).length} 个目录 · ${total} 个文件`, 'ok');
}
