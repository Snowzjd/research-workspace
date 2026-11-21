/* ==========================================================================
   项目页（Sprint A：项目成为唯一工作面）
   Tab：概览 / 任务 / 材料 / 本项目软件 / 文档
   ========================================================================== */

const PROJECT_TABS = [
  ['overview', '概览', 'grid'],
  ['tasks', '任务', 'tasks'],
  ['materials', '材料', 'folder'],
  ['software', '软件', 'rocket'],
  ['outcomes', '成果', 'pencil'],
  ['docs', '文档', 'file']
];

function projectView() {
  const p = P(state.project) || DB.projects[0];
  if (!p) return emptyWorkspace({ title: '还没有项目', desc: '新建一个项目，任务、材料与软件都会收在它里面。', full: true });
  const tab = PROJECT_TABS.some(t => t[0] === state.projectTab) ? state.projectTab : 'overview';
  const openTasks = DB.tasks.filter(t => t.p === p.id && t.st !== 'done').length;
  const mile = milestoneStats(p);
  const counts = {
    tasks: openTasks,
    outcomes: outcomesForProject(p.id).length,
    software: (DB.apps || []).filter(a => a.bound === p.id).length
  };

  return `<div class="page">
    <div class="page-head">
      <h2 title="${esc(projName(p))}">${esc(p.shortName || projName(p))}</h2>
      <span class="page-stage">${esc(p.stage || '未设置阶段')}</span>
      <span class="page-sub">${esc(mile.label)}</span>
      <span class="ph-right">
        <button class="btn sm" data-act="project-back">${icon('grid')}全部项目</button>
        <button class="btn sm" data-act="edit-project" data-id="${p.id}">${icon('pencil')}编辑</button>
        <button class="btn sm" data-act="open-project-folder" data-id="${p.id}">${icon('folderOpen')}打开目录</button>
        <button class="btn sm" data-act="ai-open-project" data-id="${p.id}">${icon('sparkles')}AI 助手</button>
      </span>
    </div>
    <p class="context-line">当前项目：<b>${esc(projName(p))}</b> · ID <span class="mono">${esc(p.id)}</span></p>

    <div class="proj-tabs seg" role="tablist">
      ${PROJECT_TABS.map(([k, label, ico]) => {
        const n = counts[k];
        const badge = n ? `<span class="tab-count">${n}</span>` : '';
        return `<button type="button" role="tab" aria-selected="${k === tab ? 'true' : 'false'}" class="${k === tab ? 'active' : ''}" data-act="project-tab" data-v="${k}">${icon(ico)}<span class="tab-label">${label}</span>${badge}</button>`;
      }).join('')}
    </div>

    ${tab === 'overview' ? `<div class="detail-grid">
        <div class="detail-main">${detailCard(p)}${previewTasksHTML(p)}</div>
        <div class="detail-side">${flowStepsCard(p)}</div>
      </div>
      <div class="bottom-grid bottom-grid-2">${outcomesCard(p)}${resourceCard(p.id)}</div>
      ${activityCard(p.id)}
      ${todoCard(p.id)}`
    : ''}
    ${tab === 'tasks' ? projectTasksHTML(p) : ''}
    ${tab === 'materials' ? projectMaterialsHTML(p) : ''}
    ${tab === 'software' ? projectSoftwareHTML(p) : ''}
    ${tab === 'outcomes' ? outcomesCard(p) : ''}
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
      <thead><tr><th style="width:34%">任务</th><th>负责人</th><th>建议工具</th><th>截止日期</th><th>优先级</th><th>状态</th><th></th></tr></thead>
      <tbody>${sorted.map(t => {
        const idx = DB.tasks.indexOf(t);
        return `<tr data-act="open-task" data-idx="${idx}" title="点击打开任务">
          <td><div class="t-title">${esc(t.t)}</div><div class="t-sub">${icon('folder', 'width:10px;height:10px')} ${esc(t.dir || '—')}</div></td>
          <td><span class="row" style="gap:6px">${t.agent ? agentTile(t.agent, 20) : ''}<span>${esc(t.agent || '待指定')}</span></span></td>
          <td><span class="row" style="gap:5px">${appTile(t.tool, 16)}<span class="muted">${esc(t.tool || '—')}</span></span></td>
          <td class="mono">${esc(parseTaskDate(t.due).label)}</td>
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
  if (typeof scheduleRpmRefresh === 'function') scheduleRpmRefresh(p.id);
  const status = materialStatusView(p.id);
  const dirs = Object.keys(materialIndexOf(p.id));
  const files = materialsIn(p.id);
  const scan = state.matScan && state.matScan.pid === p.id ? state.matScan : null;
  const bound = !!status.rpm_bound || status.source === 'rpm' || status.source === 'rpm-loading' || status.source === 'rpm-error';
  const refreshLabel = bound ? '刷新文件索引' : '预览目录（非 RPM）';
  const emptyTitle = (status.state === 'disconnected')
    ? '尚未接入文件引擎'
    : status.label;
  const emptySub = bound
    ? '文件列表来自文件引擎索引。打开目录时使用解析后的真实根路径，不会把包装目录当作根。'
    : '不会回退到演示材料，也不会把浅扫描结果写成权威索引。预览只在本次会话中显示。排除名单可在设置 materialScanExclude 中配置。';
  const fileRows = (d, inDir) => {
    if (!inDir.length) return `<div class="proj-mat-sub">0 个文件</div>`;
    const extra = inDir.slice(0, 8).map(f => {
      const meta = [f.category, f.purpose, f.size].filter(Boolean).join(' · ');
      const open = f.absolute_path || '';
      return `<div class="proj-mat-sub" style="display:flex;gap:8px;align-items:center">
        <button class="head-link" data-act="open-abs" data-path="${esc(open)}" data-label="${esc(f.n)}" style="padding:0">${esc(f.n)}</button>
        <span class="muted">${esc(meta)}</span>
      </div>`;
    }).join('');
    const more = inDir.length > 8 ? `<div class="proj-mat-sub">还有 ${inDir.length - 8} 个文件</div>` : '';
    return `<div class="proj-mat-sub">${inDir.length} 个文件</div>${extra}${more}`;
  };
  return `<div class="card panel">
    <div class="panel-head">
      <h3>${icon('folder')}材料</h3>
      <span class="head-sub">${esc(status.label)}</span>
      <span class="grow"></span>
      <button class="btn sm primary" data-act="mat-scan" data-id="${p.id}">${icon('refresh')}${refreshLabel}</button>
      <button class="btn sm" data-act="open-project-folder" data-id="${p.id}">${icon('folderOpen')}打开目录</button>
    </div>
    ${scan && scan.nonRpm ? `<div class="field-hint" style="padding:8px 12px">这是一次性目录预览，不是文件引擎索引，也不会写入 materialIndex。</div>` : ''}
    ${scan && !scan.nonRpm ? matDiffHTML(p, scan) : ''}
    <div class="proj-mat-list">
      ${dirs.length ? dirs.map(d => {
        const inDir = files.filter(f => f.dir === d || String(f.dir || f.rel || '').startsWith(d));
        return `<div class="proj-mat-row">
          <span class="proj-mat-ico">${icon('folder')}</span>
          <div class="grow"><div class="proj-mat-name">${esc(d)}</div>
            ${fileRows(d, inDir)}</div>
          <button class="btn sm ghost" data-act="proj-open-mat" data-id="${p.id}" data-d="${esc(d)}">${icon('folderOpen')}打开</button>
        </div>`;
      }).join('') : emptyState({
        icon: 'folder',
        title: emptyTitle,
        sub: emptySub,
        primary: { act: 'mat-scan', label: bound ? '刷新文件索引' : '预览目录（非 RPM）', ico: 'refresh', data: { id: p.id } },
        secondary: { act: 'open-project-folder', label: '打开目录', ico: 'folderOpen', data: { id: p.id } }
      })}
    </div>
  </div>`;
}

/* ---------- 本项目软件 ---------- */
function projectSoftwareHTML(p) {
  const bound = (DB.apps || []).filter(a => a.bound === p.id);
  const others = (DB.apps || []).filter(a => a.bound !== p.id);
  const suggested = [...new Set((DB.tasks || []).filter(t => t.p === p.id).map(t => String(t.tool || '').trim()).filter(Boolean))];
  return `<div class="card panel">
    <div class="panel-head">
      <h3>${icon('rocket')}已绑定软件</h3>
      <span class="head-sub">${bound.length} 个已绑定程序。读取状态不会启动它们</span>
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
      : `<p class="meta-note">任务里写到的软件只是建议，不能当成已经安装或已经绑定。</p>
        ${suggested.length ? `<div class="suggest-row">${suggested.map(n => `<span class="chip gray">建议 ${esc(n)} · 未绑定</span>`).join('')}</div>` : '<p class="meta-note">任务里也没有填写建议工具。</p>'}
        ${emptyState({
        icon: 'rocket',
        title: '还没有绑定到本项目的软件',
        sub: '绑定只记录程序引用和可用状态，不会启动 CAD、求解器或 Agent。',
        primary: { act: 'import-launch', label: '导入快捷方式', ico: 'link', data: { mode: 'shortcut' } },
        secondary: { act: 'rescan-apps', label: '扫描已安装', ico: 'search' }
      })}`}

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

function scheduleRpmRefresh(pid) {
  if (!pid) return;
  if (!state.rpmMaterials) state.rpmMaterials = {};
  const cache = state.rpmMaterials[pid];
  if (cache && (cache.loading || cache.probed)) return;
  if (!Bridge.desktop || !window.workspace || typeof window.workspace.rpmProjectFiles !== 'function') {
    state.rpmMaterials[pid] = { probed: true, rpmBound: false, loading: false };
    return;
  }
  state.rpmMaterials[pid] = Object.assign({}, cache, { loading: true });
  refreshProjectMaterials(pid).then(function () { render(); });
}

async function refreshProjectMaterials(pid) {
  if (!pid) return null;
  if (!state.rpmMaterials) state.rpmMaterials = {};
  if (!Bridge.desktop || !window.workspace || typeof window.workspace.rpmProjectRoot !== 'function') {
    state.rpmMaterials[pid] = { probed: true, rpmBound: false, loading: false };
    return state.rpmMaterials[pid];
  }
  state.rpmMaterials[pid] = Object.assign({}, state.rpmMaterials[pid], { loading: true });
  const root = await window.workspace.rpmProjectRoot(pid);
  if (!root || root.rpmBound !== true) {
    state.rpmMaterials[pid] = {
      probed: true,
      loading: false,
      rpmBound: false,
      resolvedRoot: (root && root.resolvedRoot) || '',
      rpmProjectId: (root && root.rpmProjectId) || '',
      error: (root && (root.error || root.note)) || '',
      code: (root && root.code) || 'unbound',
      at: new Date().toISOString()
    };
    return state.rpmMaterials[pid];
  }
  const found = await window.workspace.rpmProjectFiles(pid, { limit: 500 });
  if (!found || found.ok === false) {
    state.rpmMaterials[pid] = {
      probed: true,
      loading: false,
      rpmBound: true,
      resolvedRoot: (found && found.resolvedRoot) || root.resolvedRoot || '',
      rpmProjectId: (found && found.rpmProjectId) || root.rpmProjectId || '',
      error: (found && found.error) || '无法读取文件引擎',
      files: null,
      at: new Date().toISOString()
    };
    return state.rpmMaterials[pid];
  }
  const files = found.files || [];
  state.rpmMaterials[pid] = {
    probed: true,
    loading: false,
    rpmBound: true,
    resolvedRoot: found.resolvedRoot || root.resolvedRoot || '',
    rpmProjectId: found.rpmProjectId || root.rpmProjectId || '',
    files: files,
    index: (typeof MaterialSource !== 'undefined' && MaterialSource.indexFromRpmFiles)
      ? MaterialSource.indexFromRpmFiles(files)
      : {},
    error: '',
    at: new Date().toISOString()
  };
  return state.rpmMaterials[pid];
}

/* 已绑定：刷新 RPM 索引。未绑定：一次性浅扫描预览，默认不写入 materialIndex / materialScans。 */
async function scanProjectMaterials(pid) {
  const p = P(pid);
  if (!p) return toast('项目不存在', 'err');
  const decided = typeof materialSourceOf === 'function' ? materialSourceOf(pid) : { source: 'disconnected' };
  const bound = !!(decided.rpmBound || decided.source === 'rpm' || decided.source === 'rpm-loading' || decided.source === 'rpm-error'
    || (p.rpmProjectId || p.rpmRoot || (DB.settings && DB.settings.rpmBindings && DB.settings.rpmBindings[pid])));
  if (bound) {
    if (!Bridge.desktop || !window.workspace || !window.workspace.rpmProjectFiles) {
      return toast('文件引擎只在桌面端可用', 'err');
    }
    if (!state.rpmMaterials) state.rpmMaterials = {};
    state.rpmMaterials[pid] = Object.assign({}, state.rpmMaterials[pid], { loading: true, probed: false });
    render();
    const cache = await refreshProjectMaterials(pid);
    render();
    if (cache && cache.rpmBound && !cache.error) return toast(esc(materialStatusView(pid).label), 'ok');
    return toast(esc((cache && cache.error) || materialStatusView(pid).label), 'err');
  }
  if (!Bridge.desktop || !window.workspace.scanMaterials) return toast('目录预览只在桌面端可用', 'err');
  const gen = state.viewGen || 0;
  render();
  const r = await window.workspace.scanMaterials({ folder: p.folder || p.name });
  if ((state.viewGen || 0) !== gen || state.project !== pid) return;
  if (!r || !r.ok) {
    state.matScan = { pid: pid, nonRpm: true, error: (r && r.error) || '无法读取目录', count: 0, dirs: [] };
    render();
    return toast('预览失败：' + esc((r && r.error) || '无法读取目录'), 'err');
  }
  state.matScan = {
    pid: pid, nonRpm: true, preview: true,
    count: r.count || 0, dirs: r.dirs || [], root: r.root || '',
    at: Date.now(), note: r.note || ''
  };
  render();
  toast('目录预览（非 RPM）：' + (r.count || 0) + ' 项，未写入权威索引', 'ok');
}

/* 不再把浅扫描结果写入 materialIndex。 */
function applyMaterialSync(pid) {
  state.matScan = null;
  render();
  toast('材料登记不再作为权威索引写入。已绑定项目请刷新文件引擎；未绑定项目的预览不会写入 materialIndex。', 'err');
}
