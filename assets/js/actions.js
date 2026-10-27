/* ==========================================================================
   个人 AI 科研工程工作台 · 交互层
   弹窗表单 / 真实文件与进程操作 / 事件委托 / 启动引导
   ========================================================================== */

/* ==========================================================================
   1. 通用动作
   ========================================================================== */
async function openPath(path, label) {
  if (!path) return toast('未配置路径', 'err');
  const r = await Bridge.openFolder(path);
  if (r.ok) {
    logActivity(`打开 <b>${esc(label)}</b>`, 'open', '#218358');
    persist(); toast(`已打开 <b>${esc(label)}</b>`, 'ok');
    return true;
  }
  if (!Bridge.desktop) {
    await copyPath(path);
    return false;
  }
  confirmDialog({
    title: '目录不存在',
    message: `${esc(r.error)}<br><br>工作区目录可能尚未创建。是否现在按当前项目结构创建所需目录？`,
    okText: '创建目录',
    onOk: () => rebuildStructure()
  });
  return false;
}

async function copyPath(p) {
  const r = await Bridge.copy(p);
  if (r.ok) toast(`路径已复制到剪贴板`, 'ok');
  else toast(`无法自动复制，请手动复制：<span class="mono">${esc(p)}</span>`, 'err');
}

function structurePayload() {
  return {
    root: rootDir(),
    projects: DB.projects.map(p => ({
      name: p.name,
      folder: p.folder || p.name,
      dirs: Object.fromEntries(Object.entries(MATERIALS[p.id] || {}).map(([d, arr]) => [
        d, arr.map(([n, , ext]) => ({ name: n, kind: ext === 'dir' ? 'dir' : 'file' }))
      ]))
    }))
  };
}

async function rebuildStructure(silent) {
  if (!Bridge.desktop) return toast('浏览器模式无法访问本地文件系统', 'err');
  const r = await window.workspace.ensureStructure(structurePayload());
  if (r.ok) {
    logActivity(`创建工作区目录 <b>${r.created.dirs}</b> 个 / 文件 <b>${r.created.files}</b> 个`, 'create', '#AD5700');
    DB.settings.structureCreated = true;
    persist(true);
    toast(`工作区目录就绪：${r.created.dirs} 个目录 · ${r.created.files} 个文件`, 'ok');
    return true;
  }
  toast('目录创建失败：' + r.error, 'err');
  return false;
}

async function syncRunning() {
  if (!Bridge.desktop) return;
  const list = await window.workspace.listRunning();
  const names = list.map(x => x.name);
  DB.apps.forEach(a => { a.run = names.includes(a.n) ? true : null; });
  DB.workspace.running = names;
  DB.workspace.project = (P(state.project) || DB.projects[0] || {}).name || '';
  DB.workspace.agents = DB.agents.filter(a => a.status === 'running').length;
  render();
}

/* ==========================================================================
   2. 任务：详情 / 新建 / 编辑
   ========================================================================== */
function openTaskDetail(idx) {
  const t = DB.tasks[idx];
  if (!t) return;
  const p = P(t.p);
  const dir = taskDir(t);
  const files = materialsIn(t.p, t.dir);

  const body = `
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${stChip(t.st)} ${priTag(t.pri)}
      <span class="chip gray">${esc(p ? p.name : '—')}</span>
      <span class="chip gray">${icon('calendar')}${esc(t.due)}</span>
      <span class="chip gray">${agentTile(t.agent, 12)}${esc(t.agent)}</span>
      <span class="chip gray">${appTile(t.tool, 12)}${esc(t.tool)}</span>
    </div>

    <div class="field">
      <label>主要材料所在文件夹</label>
      <div class="path-box">
        <span class="pb-ico">${icon('folder')}</span>
        <div class="pb-body">
          <div class="pb-name">${esc(t.dir || '项目根目录')}</div>
          <div class="pb-path" title="${esc(dir)}">${esc(dir)}</div>
        </div>
        <div class="pb-actions">
          <button class="btn sm primary" data-act="open-abs" data-path="${esc(dir)}" data-label="${esc('材料目录 · ' + t.dir)}">${icon('folderOpen')}打开</button>
          <button class="btn sm" data-act="copy-abs" data-path="${esc(dir)}" title="复制路径">${icon('copy')}</button>
        </div>
      </div>
      <div class="field-hint">点击「打开」将调用系统文件管理器定位到该文件夹</div>
    </div>

    <div class="field">
      <label>该文件夹内的材料（${files.length}）</label>
      ${files.length ? `<div class="mat-list">${files.map(f => `
        <div class="mat-row" data-act="open-abs" data-path="${esc(dir + '\\' + f.n)}" data-label="${esc(f.n)}">
          <span class="m-ico" style="background:${fileType(f.ext).c}">${fileType(f.ext).t}</span>
          <div class="m-body"><div class="m-name">${esc(f.n)}</div><div class="m-meta">${esc(f.size)}</div></div>
          ${icon('externalLink', 'color:var(--text-4);width:13px;height:13px')}
        </div>`).join('')}</div>`
      : `<div class="path-box" style="color:var(--text-3);font-size:11px">该目录下暂无登记材料，可直接点击上方「打开」进入文件夹查看</div>`}
    </div>

    <div class="field">
      <label>项目其余材料目录</label>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        ${Object.keys(MATERIALS[t.p] || {}).map(d => `<button class="chip ${d === t.dir ? 'accent' : 'gray'}" data-act="open-abs" data-path="${esc(projectDir(p) + '\\' + d)}" data-label="${esc(d)}" style="cursor:pointer">${icon('folder')}${esc(d)}</button>`).join('')}
      </div>
    </div>`;

  const footer = `
    <button class="btn sm" data-act="quick-todo-from-task" data-idx="${idx}">${icon('plus')}加入待办</button>
    <span class="grow"></span>
    <button class="btn sm" data-act="edit-task" data-idx="${idx}">${icon('pencil')}编辑</button>
    ${t.st !== 'done'
      ? `<button class="btn sm primary" data-act="task-complete" data-idx="${idx}">${icon('check')}标记完成</button>`
      : `<button class="btn sm" data-act="task-reopen" data-idx="${idx}">${icon('refresh')}重新打开</button>`}
    <button class="btn sm" data-act="task-run" data-idx="${idx}">${icon('play')}执行</button>`;

  openModal({ title: esc(t.t), sub: `${esc(p ? p.name : '')} · 任务详情与材料`, body, footer, wide: true });
}

function openTaskForm(idx) {
  const isNew = idx == null;
  const t = isNew
    ? { t: '', p: state.project, agent: 'Engineer', tool: 'Python', due: '10-31', pri: 'mid', st: 'todo', dir: '' }
    : JSON.parse(JSON.stringify(DB.tasks[idx]));
  const p = P(t.p);
  const dirs = Object.keys(MATERIALS[t.p] || {});

  const body = `
    ${fText('t', '任务名称', t.t, { req: true, ph: '例如：优化 TPMS 晶胞参数' })}
    <div class="field-row">
      ${fSelect('p', '所属项目', t.p, DB.projects.map(p2 => [p2.id, projName(p2)]))}
      ${fSelect('agent', '负责 Agent', t.agent, DB.agents.map(a => [a.name, a.name]))}
    </div>
    <div class="field-row">
      ${fText('tool', '使用工具', t.tool, { ph: 'Fluent / Python / Tecplot…' })}
      ${fText('due', '截止时间', t.due, { ph: '10-31' })}
    </div>
    <div class="field-row">
      ${fSeg('pri', '优先级', t.pri, [['high', '高'], ['mid', '中'], ['low', '低']])}
      ${fSeg('st', '状态', t.st, [['todo', '待处理'], ['doing', '进行中'], ['review', '待复核'], ['done', '已完成']])}
    </div>
    ${fSelect('dir', '材料目录（项目内）', t.dir, [['', '（项目根目录）'], ...dirs.map(d => [d, d])], {
      hint: `完整路径：${esc(projectDir(p))}\\<所选目录>`
    })}`;

  openModal({
    title: isNew ? '新建任务' : '编辑任务',
    sub: isNew ? '任务会自动出现在任务中心与项目流程中' : esc(t.t),
    body,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="${isNew ? 'task-create' : 'task-update'}" data-idx="${idx ?? ''}">${isNew ? '创建任务' : '保存修改'}</button>`,
    onMount(modal) {
      modal.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
        const b = e.target.closest('button[data-val]');
        if (!b) return;
        seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      }));
      const sel = modal.querySelector('[name="p"]');
      sel && sel.addEventListener('change', () => {
        const dirSel = modal.querySelector('[name="dir"]');
        if (!dirSel) return;
        const nd = Object.keys(MATERIALS[sel.value] || {});
        dirSel.innerHTML = `<option value="">（项目根目录）</option>` + nd.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
      });
    }
  });
}

/* ==========================================================================
   3. 待办：新建 / 编辑
   ========================================================================== */
function openTodoForm(idx) {
  const isNew = idx == null;
  const t = isNew ? { t: '', cat: 'task', pri: 'mid', due: '今天', done: false } : DB.todos[idx];
  const body = `
    ${fArea('t', '待办内容', t.t, { req: true, rows: 2, ph: '例如：整理多目标优化的参数化仿真文件' })}
    <div class="field-row">
      ${fSelect('cat', '分类', t.cat, TODO_CATS)}
      ${fText('due', '截止/时间', t.due, { ph: '今天 16:00 / 10-20 18:00' })}
    </div>
    ${fSeg('pri', '优先级', t.pri, [['high', '高'], ['mid', '中'], ['low', '低']])}`;
  openModal({
    title: isNew ? '新建待办' : '编辑待办',
    sub: '内容、分类、优先级与时间均可自定义',
    body,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="${isNew ? 'todo-create' : 'todo-update'}" data-idx="${idx ?? ''}">${isNew ? '创建' : '保存'}</button>`,
    onMount(modal) {
      modal.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
        const b = e.target.closest('button[data-val]');
        if (!b) return;
        seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      }));
    }
  });
}

/* ==========================================================================
   4. 项目：新建 / 编辑 / 菜单
   ========================================================================== */
const THUMB_KINDS = [['tpms', '点阵结构'], ['lng', '工业储罐'], ['cfd', '涡量场'], ['pareto', 'Pareto'], ['bench', '试验回路'], ['rag', '知识图谱']];
function openProjectForm(id, draft) {
  const isNew = id == null;
  const p = isNew ? null : P(id);
  const d = draft || {};
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const defPeriod = `${now.getFullYear()}.${pad(now.getMonth() + 1)} - ${now.getFullYear() + 1}.06`;
  const root = d.rootDir != null ? d.rootDir : (rootDir() || (state.device && state.device.suggestedRoot) || '');
  const tplId = d.template || 'standard';
  const name0 = d.name || '';
  const folder0 = d.folder != null ? d.folder : (name0 ? safeFolderName(name0) : '');

  const pathPreview = root
    ? (folder0 ? `${root}\\${folder0}` : `${root}\\（文件夹名）`)
    : '尚未选择工作区根目录';

  const tplField = `
    <div class="field" data-field="template">
      <label>项目模板</label>
      <div class="row" style="gap:7px">
        <select class="select grow" name="template">${templateOptions().map(([v, l]) =>
          `<option value="${esc(v)}"${v === tplId ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <span id="tpl-actions"></span>
      </div>
      <div class="field-hint" id="tpl-hint">${esc(templateDesc(tplId))}</div>
    </div>`;

  const body = isNew ? `
    ${fText('name', '项目名称', name0, { req: true, ph: '例如：TPMS换热器' })}
    ${fText('displayName', '显示名', d.displayName || '', { ph: '留空则与项目名称相同', hint: '只用于界面。文件夹名单独保存，互不影响' })}
    ${fText('folder', '项目文件夹名', folder0, {
      hint: '建在工作区根目录下的这个子目录；默认跟项目名一致，可改（项目名以后改了也不影响文件夹）'
    })}
    <div class="field" data-field="rootDir">
      <label>工作区根目录</label>
      <div class="row" style="gap:7px">
        <input class="input grow" name="rootDir" value="${esc(root)}" placeholder="例如 D://ResearchWorkspace">
        <button class="btn" data-act="pick-project-root" type="button">${icon('folderOpen')}选择…</button>
      </div>
      <div class="field-hint">所有项目的材料目录都建在这里；之后可在「设置 → 数据与同步」更改</div>
    </div>
    <div class="path-preview" id="pf-path" title="最终位置">${icon('folder')} <span class="mono">${esc(pathPreview)}</span></div>
    ${fText('subtitle', '一句话描述', d.subtitle || '', { ph: '多孔结构换热器设计与性能优化' })}
    ${fArea('goal', '研究目标', d.goal || '', { rows: 2, ph: '要解决什么问题、做到什么程度', hint: '写清楚这一条，后面 AI 和 Agent 才有判断依据' })}
    ${fText('period', '研究周期', d.period || defPeriod, { ph: '2026.10 - 2027.06' })}
    ${tplField}
    ${fCheckbox('starterTasks', '生成模板自带的起始任务', true, { hint: '不勾选则只建项目与材料目录' })}
  ` : `
    ${fText('name', '项目名称', p.name, { req: true })}
    ${fText('displayName', '显示名', p.displayName || '', { ph: '留空则使用项目名称', hint: '只改界面上的名字，不改项目名称，也不改文件夹' })}
    ${fText('folder', '项目文件夹名', p.folder || p.name, { hint: '改这里不会移动磁盘上已有的文件夹，也不改显示名' })}
    ${fText('subtitle', '一句话描述', p.subtitle)}
    ${fArea('goal', '研究目标', p.goal, { rows: 2 })}
    <div class="field-row">
      ${fText('period', '研究周期', p.period, { ph: '2026.10 - 2027.06' })}
      ${fSelect('thumb', '缩略图风格', p.thumb, THUMB_KINDS)}
    </div>
    <div class="field-row">
      ${fText('stage', '当前阶段', p.stage, { ph: '仿真计算' })}
      ${fText('next', '下一阶段', p.next, { ph: '优化结构参数' })}
    </div>
    ${fText('tools', '使用软件（逗号分隔）', (p.tools || []).join(', '), { ph: 'Fluent, Python, Tecplot' })}
    <div class="field">
      <label>项目进度：<b id="pv">${p.progress}%</b></label>
      <input class="input" type="range" min="0" max="100" step="5" name="progress" value="${p.progress}" style="padding:0;height:22px">
    </div>`;

  openModal({
    title: isNew ? '新建科研项目' : '编辑项目',
    sub: isNew ? '套用模板生成阶段与材料目录，之后可随时调整' : esc(p.name),
    body,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="${isNew ? 'project-create' : 'project-update'}" data-id="${id ?? ''}">${isNew ? '创建项目' : '保存修改'}</button>`,
    onMount(modal) {
      const r = modal.querySelector('[name="progress"]');
      const v = modal.querySelector('#pv');
      r && r.addEventListener('input', () => { v.textContent = r.value + '%'; });

      const sel = modal.querySelector('[name="template"]');
      const hint = modal.querySelector('#tpl-hint');
      const acts = modal.querySelector('#tpl-actions');
      const syncTpl = () => {
        if (hint && sel) hint.textContent = templateDesc(sel.value);
        if (!acts || !sel) return;
        const t = allTemplates().find(x => x.id === sel.value);
        acts.innerHTML = (t && !t.builtin)
          ? `<button class="btn sm danger" type="button" data-act="tpl-delete" data-id="${esc(t.id)}">${icon('trash')}删除模板</button>`
          : '';
      };
      if (sel) sel.addEventListener('change', syncTpl);
      syncTpl();

      /* 文件夹名默认跟随项目名，用户手动改过就不再跟随 */
      const nameEl = modal.querySelector('[name="name"]');
      const folderEl = modal.querySelector('[name="folder"]');
      const rootEl = modal.querySelector('[name="rootDir"]');
      const pathEl = modal.querySelector('#pf-path');
      let folderTouched = !!folder0 && folder0 !== safeFolderName(name0);

      const syncPath = () => {
        if (!pathEl) return;
        const rt = (rootEl && rootEl.value.trim()) || '';
        const fd = (folderEl && folderEl.value.trim()) || '';
        const text = rt ? (fd ? `${rt}\\${fd}` : `${rt}\\（文件夹名）`) : '尚未选择工作区根目录';
        pathEl.querySelector('.mono').textContent = text;
        pathEl.classList.toggle('warn', !rt);
      };
      if (nameEl && folderEl) {
        nameEl.addEventListener('input', () => {
          if (!folderTouched) folderEl.value = safeFolderName(nameEl.value);
          syncPath();
        });
        folderEl.addEventListener('input', () => { folderTouched = true; syncPath(); });
      }
      if (rootEl) rootEl.addEventListener('input', syncPath);
      syncPath();
    }
  });
}

function projectMenu(id) {
  const p = P(id);
  openModal({
    title: esc(projName(p)),
    sub: '项目操作',
    body: `<div class="col" style="gap:6px">
      <button class="btn" style="justify-content:flex-start;height:34px" data-act="pick-project" data-id="${id}">${icon('target')}设为当前工作区</button>
      <button class="btn" style="justify-content:flex-start;height:34px" data-act="open-project-folder" data-id="${id}">${icon('folderOpen')}打开项目材料目录</button>
      <button class="btn" style="justify-content:flex-start;height:34px" data-act="new-task" data-project="${id}">${icon('plus')}为该项目建设任务</button>
      <button class="btn" style="justify-content:flex-start;height:34px" data-act="project-rename" data-id="${id}">${icon('pencil')}重命名显示名</button>
      <button class="btn" style="justify-content:flex-start;height:34px" data-act="edit-project" data-id="${id}">${icon('settings')}编辑项目信息</button>
      <button class="btn" style="justify-content:flex-start;height:34px" data-act="project-save-template" data-id="${id}">${icon('layers')}存为项目模板</button>
      <button class="btn danger" style="justify-content:flex-start;height:34px" data-act="delete-project" data-id="${id}">${icon('trash')}删除项目</button>
    </div>`,
    footer: `<span class="grow"></span><button class="btn" data-act="modal-close">关闭</button>`
  });
}

/* 流程编辑的单行模板（弹窗内动态增删） */
function flowEditRow(r) {
  return `<div class="flow-edit-row">
    <input class="input" data-f="name" value="${esc(r.l || '')}" placeholder="阶段名称">
    <select class="select" data-f="state">
      ${[['todo', '待开始'], ['current', '进行中'], ['done', '已完成']]
        .map(([v, l]) => `<option value="${v}"${(r.s || 'todo') === v ? ' selected' : ''}>${l}</option>`).join('')}
    </select>
    <input class="input" data-f="date" value="${esc(r.d || '')}" placeholder="日期" style="max-width:76px">
    <span class="flow-edit-ops">
      <button class="icon-btn" data-act="flow-row-move" data-dir="up" title="上移">${icon('chevronRight', 'transform:rotate(-90deg)')}</button>
      <button class="icon-btn" data-act="flow-row-move" data-dir="down" title="下移">${icon('chevronRight', 'transform:rotate(90deg)')}</button>
      <button class="icon-btn" data-act="flow-row-del" title="删除这一阶段">${icon('x')}</button>
    </span>
  </div>`;
}

/* ==========================================================================
   5. Agent：详情 / 历史 / 派单
   ========================================================================== */
function openAgentDetail(name) {
  const a = A(name);
  if (!a) return;
  const tasks = DB.tasks.filter(t => t.agent === name);
  const linked = DB.projects.filter(p => Array.isArray(p.agents) && p.agents.includes(name));
  openModal({
    title: a.name,
    sub: a.role,
    body: `
      <div class="row" style="gap:8px;margin-bottom:12px">${liveBadge(a.status)}
        ${(a.tags || []).map(t => `<span class="chip gray">${esc(t)}</span>`).join('')}</div>
      <div class="field"><label>当前任务</label>
        <div class="ac-task">${esc(a.task)}</div></div>
      <div class="field"><label>专属人设提示词</label>
        ${a.prompt
          ? `<div class="ac-task" style="white-space:pre-wrap;max-height:180px;overflow:auto">${esc(a.prompt)}</div>`
          : '<span class="muted" style="font-size:11px">未填写。点「编辑」可写一段专属规范，之后派任务会放进系统提示。</span>'}
      </div>
      <div class="field"><label>关联项目</label>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${linked.length ? linked.map(p => `<button class="chip accent" data-act="pick-project" data-id="${p.id}" style="cursor:pointer">${esc(p.name)}</button>`).join('') : '<span class="muted">无</span>'}
        </div></div>
      <div class="field"><label>名下任务（${tasks.length}）</label>
        <div class="mat-list">${tasks.map(t => `
          <div class="mat-row" data-act="open-task" data-idx="${DB.tasks.indexOf(t)}">
            <span class="m-ico" style="background:#6E56CF">${icon('tasks')}</span>
            <div class="m-body"><div class="m-name">${esc(t.t)}</div><div class="m-meta">${esc(P(t.p) ? P(t.p).name : '')} · ${esc(t.due)}</div></div>
            ${stChip(t.st)}
          </div>`).join('') || '<span class="muted" style="font-size:11px">暂无任务</span>'}</div></div>`,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="agent-edit" data-a="${esc(name)}">${icon('pencil')}编辑</button>
      <button class="btn" data-act="agent-assign" data-a="${esc(name)}">${icon('plus')}派发任务</button>
      <button class="btn primary" data-act="agent-run" data-a="${esc(name)}">${icon('send')}派任务</button>`
  });
}

function openAgentHistory(name) {
  const a = A(name);
  const rel = DB.activities.slice(0, 8);
  openModal({
    title: `${esc(name)} · 历史记录`,
    sub: `累计执行 ${a.stats[0]} 个任务 · 成功率 ${a.stats[2]}%`,
    body: `<div class="activity-list">${rel.map(x => `<div class="activity-row">
        <span class="a-dot" style="background:${x.c}">${icon(x.i)}</span>
        <span class="a-txt">${x.t}</span><span class="a-time">${esc(x.time)}</span></div>`).join('')}</div>`,
    footer: `<span class="grow"></span><button class="btn" data-act="modal-close">关闭</button>`
  });
}

function openAgentAssign(name) {
  openTaskForm(null);
  const sel = document.querySelector('.modal [name="agent"]');
  if (sel) sel.value = name;
  const title = document.querySelector('.modal-head h3');
  if (title) title.textContent = `向 ${name} 派发任务`;
}

/* 新建 / 编辑共用同一组字段。编辑时多一句改名说明。 */
function parseAgentTags(raw) {
  return String(raw || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
}
function agentFormFields(agent) {
  const a = agent || {};
  const tags = Array.isArray(a.tags) ? a.tags.join('，') : '';
  const editing = !!a.name;
  return `${fText('name', 'Agent 名称', a.name || '', {
      req: true,
      ph: '例如：Simulator',
      hint: editing ? '可以改名。已有任务、项目关联和派单记录会一起改过去，历史不会断掉。' : ''
    })}
    ${fText('role', '职责描述', a.role || '', { req: true, ph: 'CFD 求解与参数扫描' })}
    ${fText('tags', '能力标签（逗号分隔）', tags, { ph: '仿真, 参数扫描, 批处理' })}
    ${fArea('prompt', '专属人设提示词（可选）', a.prompt || '', {
      rows: editing ? 8 : 4,
      ph: '执行时的专属规范与工作流，例如：先查知识库再列大纲；成文用全角标点纯文本，可直接粘贴进 Word'
    })}`;
}
function openAgentEdit(name) {
  const a = A(name);
  if (!a) return toast('这个 Agent 已被删除', 'err');
  openModal({
    title: '编辑 Agent',
    sub: a.presetKey
      ? '内置写作 Agent。这里改过的职责、标签和提示词会保留，重新打开软件不会被预置文案盖掉。'
      : '修改名称、职责、标签和专属提示词',
    wide: true,
    body: agentFormFields(a),
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="agent-save" data-a="${esc(name)}">保存</button>`
  });
}
function saveAgentEdits(oldName) {
  const a = A(oldName);
  if (!a) return toast('这个 Agent 已被删除', 'err');
  const m = document.querySelector('.modal');
  if (!m || !validate(m, ['name', 'role'])) return;
  const v = formValues(m);
  const newName = v.name;
  if (!newName) return;
  if (newName !== oldName && DB.agents.some(x => x && x !== a && x.name === newName)) {
    return toast(`已经有名为「${esc(newName)}」的 Agent`, 'err');
  }
  const role = v.role;
  const tags = parseAgentTags(v.tags);
  const prompt = (v.prompt || '').trim();
  const renamed = newName !== oldName;
  mutate(() => {
    if (renamed) renameAgentRefs(DB, oldName, newName);
    a.name = newName;
    a.role = role;
    a.tags = tags;
    a.prompt = prompt;
    a.customized = true;
  }, {
    activity: {
      text: renamed
        ? `将 Agent <b>${esc(oldName)}</b> 改名为 <b>${esc(newName)}</b>`
        : `更新 Agent <b>${esc(newName)}</b> 的职责与提示词`,
      kind: 'agent',
      color: '#6E56CF'
    }
  });
  closeModal();
  toast(renamed ? `已改名为 <b>${esc(newName)}</b>` : 'Agent 已保存', 'ok');
  openAgentDetail(newName);
}

/* ==========================================================================
   6. 应用路径
   ========================================================================== */
async function setAppPath(name) {
  const a = APP(name);
  if (!a) return;
  if (!Bridge.desktop) return toast('浏览器模式无法选择本地程序，请在桌面端操作', 'err');
  const picked = await window.workspace.pickExecutable();
  if (!picked) return;
  mutate(() => { a.path = picked; }, { activity: { text: `更新 <b>${a.n}</b> 可执行文件路径`, kind: 'edit', color: '#AD5700' } });
  toast(`已更新 <b>${esc(name)}</b> 路径`, 'ok');
}

/* ==========================================================================
   7. 搜索
   ========================================================================== */
function searchAll(q) {
  const kw = q.trim().toLowerCase();
  if (!kw) return null;
  const out = [];
  DB.projects.filter(p => (p.name + p.subtitle + p.goal).toLowerCase().includes(kw)).slice(0, 4)
    .forEach(p => out.push({ k: '项目', i: 'grid', t: p.name, s: p.subtitle, act: 'pick-project', data: `data-id="${p.id}"` }));
  DB.tasks.filter(t => t.t.toLowerCase().includes(kw)).slice(0, 5)
    .forEach(t => out.push({ k: '任务', i: 'tasks', t: t.t, s: (P(t.p) || {}).name + ' · ' + t.agent, act: 'open-task', data: `data-idx="${DB.tasks.indexOf(t)}"` }));
  DB.kbDocs.filter(d => d.n.toLowerCase().includes(kw)).slice(0, 4)
    .forEach(d => out.push({ k: '知识库', i: 'book', t: d.n, s: d.type + ' · ' + d.size, act: 'kb-open', data: `data-name="${esc(d.n)}"` }));
  DB.agents.filter(a => (a.name + a.role).toLowerCase().includes(kw)).slice(0, 3)
    .forEach(a => out.push({ k: 'Agent', i: 'bot', t: a.name, s: a.role, act: 'agent-detail', data: `data-a="${esc(a.name)}"` }));
  DB.apps.filter(a => a.n.toLowerCase().includes(kw)).slice(0, 3)
    .forEach(a => out.push({ k: '软件', i: 'rocket', t: a.n, s: a.path || '内置视图', act: 'quick-launch', data: `data-n="${esc(a.n)}"` }));
  DB.resources.filter(r => r.n.toLowerCase().includes(kw)).slice(0, 4)
    .forEach(r => out.push({ k: '资源', i: 'file', t: r.n, s: r.size + ' · ' + r.date, act: 'open-res', data: `data-name="${esc(r.n)}"` }));
  return out;
}

function renderSearchPanel() {
  const box = document.getElementById('search-panel');
  if (!box) return;
  const hits = searchAll(state.search);
  if (!hits) { box.innerHTML = ''; box.classList.remove('open'); return; }
  box.classList.add('open');
  box.innerHTML = `<div class="card search-panel">
    ${hits.length ? hits.map(h => `<button class="sp-row" data-act="${h.act}" ${h.data}>
        <span class="sp-ico">${icon(h.i)}</span>
        <span class="sp-body"><span class="sp-t">${esc(h.t)}</span><span class="sp-s">${esc(h.s || '')}</span></span>
        <span class="chip gray">${h.k}</span>
      </button>`).join('')
      : `<div class="empty" style="padding:18px">${icon('search')}<div>没有找到「${esc(state.search)}」</div></div>`}
  </div>`;
}

/* ==========================================================================
   7.5 启动台导入弹窗
   ========================================================================== */
function openImportDialog(info) {
  state.pendingImport = info;
  const isFolder = info.kind === 'folder';
  const body = `
    <div class="path-box" style="margin-bottom:12px">
      <span class="pb-ico">${icon(info.sourcePath && /\.lnk$/i.test(info.sourcePath) ? 'link' : isFolder ? 'folder' : 'rocket')}</span>
      <div class="pb-body">
        <div class="pb-name">${esc(info.displayName || info.name)}</div>
        <div class="pb-path" title="${esc(info.sourcePath)}">${esc(info.sourcePath)}</div>
      </div>
    </div>
    ${info.warning ? `<div class="field"><div class="field-err" style="display:block">${esc(info.warning)}</div></div>` : ''}
    ${fText('n', '显示名称', info.displayName || info.name, { req: true, ph: '例如：ParaView' })}
    ${fText('path', isFolder ? '文件夹路径' : '可执行文件路径', info.targetPath, {
      req: true,
      hint: /\.lnk$/i.test(info.sourcePath || '') ? '已从快捷方式解析出真实目标，通常无需修改' : ''
    })}
    ${isFolder ? '' : fText('args', '启动参数', (info.args || []).join(' '), { hint: '可选；含空格的参数请用引号包裹' })}
    ${isFolder ? '' : fText('cwd', '工作目录', info.cwd || '', { hint: '留空则使用可执行文件所在目录' })}
    ${fSeg('quick', '固定到左侧快捷启动', 'yes', [['yes', '加入'], ['no', '暂不加入']], { hint: '加入后左侧导航栏点击即可启动' })}`;
  openModal({
    title: '导入到启动台',
    sub: isFolder ? '文件夹入口' : (/\.lnk$/i.test(info.sourcePath || '') ? '来自 Windows 快捷方式' : '来自可执行文件'),
    body, wide: true,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="import-save">导入启动台</button>`,
    onMount(modal) {
      modal.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
        const b = e.target.closest('button[data-val]');
        if (!b) return;
        seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      }));
    }
  });
}

/* ==========================================================================
   7.6 AI 配置弹窗
   ========================================================================== */
function openAiEdit(key) {
  const isUrl = key === 'baseUrl';
  openModal({
    title: isUrl ? '编辑 Base URL' : '编辑模型名称',
    sub: isUrl
      ? '未以版本号结尾会自动补 /v1，最终请求 {Base URL}/chat/completions'
      : '例如 deepseek-chat、qwen-plus、gpt-4o-mini、glm-4-flash',
    body: fText('val', isUrl ? 'Base URL' : '模型名称', DB.ai[key], {
      req: true,
      ph: isUrl ? 'https://api.deepseek.com/v1' : 'deepseek-chat'
    }),
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="ai-edit-save" data-key="${esc(key)}">保存</button>`
  });
}

function openAiKeyDialog() {
  openModal({
    title: '配置 API Key',
    sub: '由主进程使用系统加密能力保存，不写入数据文件，导出数据也带不走',
    body: `${fText('key', 'API Key', '', { req: true, ph: 'sk-...', hint: '保存后会覆盖原有密钥；取消则不做修改' })}`,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-submit data-act="ai-key-save">保存密钥</button>`
  });
}

/* ==========================================================================
   7.7 AI 对话主循环
   ========================================================================== */
const AI_MAX_ROUNDS = 6;

/** 与主进程一致的引号感知参数拆分 */
function splitArgsText(str) {
  const out = []; let cur = '', q = null;
  for (const ch of String(str || '')) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function scrollAi() {
  requestAnimationFrame(() => {
    const el = document.getElementById('ai-stream');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/** 重新扫描本机 MCP 客户端并刷新界面 */
async function refreshConnClients() {
  try {
    const r = await Bridge.connScan();
    if (r && r.clients) state.connClients = r.clients;
  } catch (_) {}
  render();
}

function buildApiMessages(p, chat, agent) {
  const dirs = Object.keys(MATERIALS[p.id] || {});
  let sys = `你是「个人 AI 科研工程工作台」的科研助理，当前协助用户管理项目「${p.name}」（项目 ID：${p.id}）。

你可以调用工具读取并修改项目数据，修改会立即写入本地数据文件并在界面上生效。

工作准则：
1. 涉及项目现状（任务、待办、进度、材料目录）时，先调用 get_project_context 或相应的查询工具，不要凭猜测回答。
2. 需要修改数据时直接调用工具完成，不要只给建议让用户自己做。
3. 完成后用简洁中文说明「改了什么」，不要罗列原始 JSON。
4. 删除类操作先向用户确认，除非用户已明确要求删除。
5. 不要编造项目里不存在的数据；查不到就如实说明。
6. 本项目已有的材料目录：${dirs.join('、') || '（暂无）'} —— create_task 的 material_dir 只能取其中之一。
7. 工作台共有 ${DB.projects.length} 个项目：${DB.projects.map(x => x.name).join('、')}。需要新建项目用 create_project（默认套用「标准科研项目」模板，含材料目录与起始任务）；删除项目必须先征得用户明确同意，再带 confirm=true 调用。
8. 用户询问资料、文献或报告内容时调用 search_knowledge。若返回 answer 与 citations，回答里必须写出每条 citation 的 source_relative_path（以及 block_ids，如果有），不要编造路径或引用不存在的片段。检索由本机主进程转发，你看不到知识库服务本身。`;

  /* 指定了执行身份：把该 Agent 的职责注入系统提示，工具与接入配置完全不变 */
  if (agent) {
    const tags = (agent.tags || []).filter(Boolean).join('、');
    sys += `

【本轮执行身份】你现在以工作台里的科研 Agent「${agent.name}」身份工作，但仍使用同一套工具与同一个 AI 接入配置。
职责：${agent.role || '（未填写）'}
擅长：${tags || '（未填写）'}
${agent.task ? '手上的任务：' + agent.task : ''}
回答时先一句话说明你以该身份打算怎么处理，然后直接调用工具完成；不要假装自己拥有额外能力。`;
    if (agent.prompt) sys += `

【该 Agent 的专属写作规范（优先级高于上文的一般准则，冲突时以这里为准）】
${agent.prompt}`;
  }

  const out = [{ role: 'system', content: sys }];
  for (const m of chat) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id, type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) }
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content || '{}' });
    }
  }
  return out;
}

function summarizeResult(name, res) {
  if (res && res.ok === false) return '失败：' + (res.error || '未知错误');
  switch (name) {
    case 'get_project_context': return `读取完成 · ${res.tasks.length} 个任务 / ${res.todos.length} 条待办 / ${(res.material_dirs || []).length} 个材料目录`;
    case 'list_tasks':          return `共 ${res.count} 个任务`;
    case 'create_task':         return `已创建「${res.created}」· 材料目录 ${res.material_dir || '—'}`;
    case 'update_task':         return `已更新：${(res.changes || []).join('、')}`;
    case 'delete_task':         return `已删除「${res.deleted}」`;
    case 'create_todo':         return `已新增待办「${res.created}」`;
    case 'update_todo':         return `已更新：${(res.changes || []).join('、')}`;
    case 'update_project':      return `已更新：${(res.changes || []).join('、')}`;
    case 'list_materials':      return res.dirs ? `${res.dirs.length} 个目录` : `${(res.files || []).length} 个文件`;
    case 'open_project_folder': return '已打开：' + res.opened;
    case 'save_document':       return res.ok ? `已保存：${res.savedPath || res.title}` : (res.error || '保存失败');
    case 'search_knowledge': {
      const cites = res.citations || res.results || [];
      const paths = cites.map(x => x && (x.source_relative_path || x.path)).filter(Boolean).slice(0, 3);
      const tail = paths.length ? ' · ' + paths.join('；') : '';
      if (res.mode === 'ask') return `抽取式回答 · 引用 ${cites.length} 条${tail}`;
      return `命中 ${res.count == null ? cites.length : res.count} 条${tail}`;
    }
    case 'list_software':       return `${res.apps.length} 个软件 · 左侧固定 ${res.sidebar_quick_launch.length} 个`;
    case 'launch_software':     return res.launched ? `已启动 ${res.launched}${res.pid ? ' (PID ' + res.pid + ')' : ''}` : (res.message || '完成');
    default: return '完成';
  }
}

async function runTool(call) {
  const impl = AI_TOOL_IMPL[call.name];
  if (!impl) return { ok: false, error: `未知工具：${call.name}` };
  /* 标记来源，让 mutate 的撤销快照与审计都记成「AI 助手」 */
  const prev = setOrigin({ source: 'assistant', actor: 'AI 助手' });
  try {
    return await executeTool(call.name, call.args || {});
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    setOrigin(prev);
  }
}

/** 人工确认（自动执行工具关闭时使用） */
function askApproval(calls) {
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (settled) return; settled = true; resolve(v); };
    const modal = openModal({
      title: 'AI 请求执行以下操作',
      sub: '「设置 → AI 接入 → 自动执行工具」当前为关闭状态，需你确认',
      body: `<div class="mat-list">${calls.map(c => `
        <div class="mat-row"><span class="m-ico" style="background:#6E56CF">${icon('zap')}</span>
          <div class="m-body"><div class="m-name">${esc(c.label)}</div>
          <div class="m-meta">${esc(c.name)}</div></div></div>`).join('')}</div>`,
      footer: `<span class="grow"></span>
        <button class="btn" data-act="approve-no">拒绝</button>
        <button class="btn primary" data-act="approve-yes">批准并执行</button>`,
      onMount(md) {
        md.querySelector('[data-act="approve-yes"]').addEventListener('click', () => { closeModal(); finish(true); });
        md.querySelector('[data-act="approve-no"]').addEventListener('click', () => { closeModal(); finish(false); });
      }
    });
    const obs = new MutationObserver(() => {
      if (!document.querySelector('.modal-mask')) { obs.disconnect(); finish(false); }
    });
    obs.observe(document.body, { childList: true });
  });
}

async function aiSend(presetText) {
  const p = P(state.project);
  if (!p) return;
  if (state.aiBusy) return;

  const content = String(presetText != null ? presetText : (state.aiDraft || '')).trim();
  if (!content) return;

  /* 当前执行身份：Agent 与 AI 助手共用同一个接入配置，只是换了人设 */
  const agent = (DB.agents || []).find(a => a.name === state.aiAgent) || null;

  if (!DB.chats[p.id]) DB.chats[p.id] = [];
  const chat = DB.chats[p.id];
  chat.push({ role: 'user', content, agent: agent ? agent.name : '' });

  state.aiDraft = '';
  state.aiBusy = true;
  state.aiStatus = '思考中…';
  render(); scrollAi();

  const cfg = {
    provider: DB.ai.provider,
    baseUrl: DB.ai.baseUrl,
    model: DB.ai.model,
    temperature: DB.ai.temperature,
    maxTokens: DB.ai.maxTokens
  };

  try {
    for (let round = 1; round <= AI_MAX_ROUNDS; round++) {
      state.aiStatus = round === 1 ? '思考中…' : `继续处理（第 ${round} 轮）…`;
      render(); scrollAi();

      const r = await Bridge.aiChat({ ...cfg, messages: buildApiMessages(p, chat, agent), tools: AI_TOOLS });

      if (!r.ok) { chat.push({ role: 'error', content: r.error }); break; }

      const calls = (r.toolCalls || []).map(tc => {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
        if (!args || typeof args !== 'object') args = {};
        return { id: tc.id || ('call_' + Math.random().toString(36).slice(2, 10)), name: tc.function.name, args, label: describeToolCall(tc.function.name, args) };
      });

      chat.push({ role: 'assistant', content: r.content || '', toolCalls: calls });
      render(); scrollAi();

      if (!calls.length) break;   // 模型给出了最终答复

      if (!DB.ai.autoApprove) {
        state.aiStatus = '等待你的确认…';
        render();
        const approved = await askApproval(calls);
        if (!approved) {
          chat.push({ role: 'error', content: '已取消本次工具执行。' });
          break;
        }
      }

      for (const c of calls) {
        state.aiStatus = `执行：${c.label}`;
        render(); scrollAi();
        const res = await runTool(c);
        chat.push({
          role: 'tool', tool_call_id: c.id, name: c.name, label: c.label,
          ok: res && res.ok !== false,
          resultText: summarizeResult(c.name, res),
          content: JSON.stringify(res == null ? { ok: false, error: '工具无返回' } : res)
        });
        render(); scrollAi();
      }
    }
    if (state.aiBusy && !chat.some(m => m.role === 'error' && m.content.includes('已取消'))) {
      const last = chat[chat.length - 1];
      if (last && last.role === 'tool') {
        chat.push({ role: 'error', content: `已达到单次对话最多 ${AI_MAX_ROUNDS} 轮工具调用上限，请把需求拆细后继续。` });
      }
    }
  } catch (err) {
    chat.push({ role: 'error', content: '执行出错：' + String((err && err.message) || err) });
  } finally {
    if (chat.length > 200) chat.splice(0, chat.length - 200);
    /* 以某个 Agent 身份跑完一轮且没有致命错误 → 记一次执行 */
    if (agent && !chat.some(m => m.role === 'error' && /执行出错|已达到单次对话/.test(m.content))) {
      agent.stats = Array.isArray(agent.stats) ? agent.stats : [0, 0, 0];
      agent.stats[0] = (agent.stats[0] || 0) + 1;
      agent.status = 'idle';
      agent.lastRunAt = Date.now();
    }
    state.aiBusy = false;
    state.aiStatus = '';
    persist(true);
    render(); scrollAi();
  }
}

function applyRagHealth(h) {
  if (h && h.ok) {
    state.rag = {
      status: 'ok',
      indexed: h.indexed || 0,
      docs: h.docs || 0,
      chunks: h.chunks || 0,
      model: h.model || '',
      askMode: h.askMode || '',
      llmRequired: h.llmRequired,
      error: ''
    };
    return true;
  }
  state.rag = {
    status: 'fail', indexed: 0, docs: 0, chunks: 0, model: '', askMode: '',
    error: (h && h.error) || '连接失败'
  };
  return false;
}

function ragHealthHtml(h, snowz) {
  if (!h) return '';
  if (!snowz) {
    return `<div class="kb-stat-list">
      <div class="kbs-row"><span>索引条数</span><b>${h.indexed || 0}</b></div>
      <div class="kbs-row"><span>嵌入模型</span><b style="font-family:var(--font-mono);font-size:10.5px">${esc(h.model || '服务未上报')}</b></div>
      <div class="kbs-row"><span>最近更新</span><b style="font-family:var(--font-mono);font-size:10.5px">${esc(h.updatedAt || '服务未上报')}</b></div>
    </div>`;
  }
  return `<div class="kb-stat-list">
    <div class="kbs-row"><span>文档</span><b>${h.docs || 0}</b></div>
    <div class="kbs-row"><span>片段</span><b>${h.chunks || 0}</b></div>
    <div class="kbs-row"><span>候选上限</span><b>${h.candidates || 0}</b></div>
    <div class="kbs-row"><span>问答</span><b>${esc(h.askMode || 'extractive')}</b></div>
    <div class="kbs-row"><span>需要大模型</span><b>${h.llmRequired ? '是' : '否'}</b></div>
    <div class="kbs-row"><span>检索方法</span><b style="font-family:var(--font-mono);font-size:10.5px">${esc(h.model || 'pg_fts:bm25_rerank')}</b></div>
  </div>
  <p style="font-size:11px;color:var(--text-3);line-height:1.7;margin-top:8px">这是全文检索，不是向量索引。向量条数仍为 0。</p>`;
}

function showCitation(h) {
  if (!h) return;
  const rel = h.source_relative_path || h.path || '';
  const abs = /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\') || rel.startsWith('/');
  const blocks = Array.isArray(h.block_ids) ? h.block_ids.join(', ') : '';
  let spans = '';
  try { spans = h.source_spans == null ? '' : (typeof h.source_spans === 'string' ? h.source_spans : JSON.stringify(h.source_spans)); } catch (_) { spans = ''; }
  if (spans.length > 400) spans = spans.slice(0, 400) + '…';
  openModal({
    title: h.title || '引用片段',
    sub: rel ? 'source_relative_path' : '服务未返回路径',
    body: `<div class="kb-stat-list">
      <div class="kbs-row"><span>路径</span><b style="font-family:var(--font-mono);font-size:10px;font-weight:500;max-width:70%;text-align:right;word-break:break-all">${esc(rel || '—')}</b></div>
      <div class="kbs-row"><span>block_ids</span><b style="font-family:var(--font-mono);font-size:10px;font-weight:500">${esc(blocks || '—')}</b></div>
      <div class="kbs-row"><span>chunk_id</span><b style="font-family:var(--font-mono);font-size:10px;font-weight:500">${esc(h.chunk_id || h.id || '—')}</b></div>
      <div class="kbs-row"><span>document_id</span><b style="font-family:var(--font-mono);font-size:10px;font-weight:500">${esc(h.document_id || '—')}</b></div>
      ${h.source_hash ? `<div class="kbs-row"><span>source_hash</span><b style="font-family:var(--font-mono);font-size:10px;font-weight:500">${esc(String(h.source_hash).slice(0, 16))}</b></div>` : ''}
    </div>
    ${spans ? `<p style="font-size:10.5px;color:var(--text-3);line-height:1.6;margin-top:8px;word-break:break-all">source_spans：${esc(spans)}</p>` : ''}
    ${h.snippet || h.text ? `<p class="dc-snippet" style="margin-top:8px;-webkit-line-clamp:8">${esc(h.snippet || h.text)}</p>` : ''}`,
    footer: `<span class="grow"></span>
      <button class="btn" data-act="modal-close">关闭</button>
      ${abs ? `<button class="btn primary" data-act="kb-open-abs" data-path="${esc(rel)}">${icon('folderOpen')}打开文件</button>` : ''}`
  });
}

async function runKnowledgeQuery(kind) {
  const inp = document.getElementById('kb-input');
  state.q = inp ? inp.value.trim() : state.q;
  const S = DB.settings;
  const cfg = ragClientConfig(S);
  const plugin = Bridge.desktop && cfg.external && (cfg.snowz || S.ragEnabled);
  if (!plugin) {
    state.ragResults = null; state.ragMeta = null; state.ragAnswer = null;
    logActivity(`按名称检索知识库：<b>${esc(state.q || '全部')}</b>`, 'search', '#0D7485');
    persist(); render();
    toast(state.q ? `已按资料名称匹配「${esc(state.q)}」` : '已列出全部资料', 'ok');
    return;
  }
  if (!state.q) {
    state.ragResults = null; state.ragMeta = null; state.ragAnswer = null; render();
    toast(kind === 'ask' ? '请输入提问内容' : '请输入检索内容', 'err');
    return;
  }
  if (kind === 'ask' && !cfg.snowz) {
    toast('提问需要 RAG_Snowz 引擎。请在「设置 → AI 与知识库引擎」切换。', 'err');
    return;
  }
  if (!cfg.endpoint) return toast('先配置知识库服务地址', 'err');

  state.ragBusy = true; state.ragOp = kind; render();
  const payload = { endpoint: cfg.endpoint, query: state.q, topK: cfg.topK, engine: cfg.engine };
  if (!cfg.snowz && state.kbCat && state.kbCat !== 'all') payload.filters = { doc_type: state.kbCat };
  const r = kind === 'ask' ? await Bridge.ragAsk(payload) : await Bridge.ragSearch(payload);
  state.ragBusy = false;

  if (r && r.ok) {
    const hits = kind === 'ask' ? (r.citations || []) : (r.results || []);
    state.ragResults = hits;
    state.ragMeta = { tookMs: r.tookMs, model: r.model || '', mode: kind };
    state.ragAnswer = kind === 'ask' ? { text: r.answer || '', citations: hits, extractive: true } : null;
    state.rag = Object.assign({}, state.rag, { status: 'ok', error: '' });
    const n = hits.length;
    logActivity(kind === 'ask'
      ? `知识库提问「<b>${esc(state.q)}</b>」引用 ${n} 条`
      : `RAG 检索「<b>${esc(state.q)}</b>」命中 ${n} 段`, 'search', '#0D7485');
    toast(kind === 'ask'
      ? `已回答 · 引用 ${n} 条`
      : `命中 ${n} 段原文`, n ? 'ok' : 'amber');
  } else {
    const err = (r && r.error) || (kind === 'ask' ? '提问失败' : '检索失败');
    state.ragResults = null; state.ragMeta = null; state.ragAnswer = null;
    state.rag = Object.assign({}, state.rag, { status: 'fail', error: err });
    logActivity(`RAG ${kind === 'ask' ? '提问' : '检索'}失败：${esc(err)}`, 'search', '#CE2C31');
    toast(`${kind === 'ask' ? '提问' : '检索'}失败：${esc(err)}`, 'err');
  }
  render();
}

/* ==========================================================================
   8. 事件委托
   ========================================================================== */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-route],[data-act],[data-project],[data-tab]');
  if (!t) { const sp = document.getElementById('search-panel'); sp && renderSearchPanel(); return; }

  /* 路由 */
  if (t.dataset.route && !t.dataset.act) { go(t.dataset.route); return; }

  /* 项目卡片：就地选中，内容预览留在首页。次要操作在「⋯」里，完整项目页走「项目页」。 */
  if (t.dataset.project && !t.dataset.act) {
    if (!showProjectOnHome(t.dataset.project)) return;
    go('home');
    const preview = document.getElementById('project-preview');
    if (preview && preview.scrollIntoView) preview.scrollIntoView({ block: 'nearest' });
    return;
  }

  /* 标签页 */
  if (t.dataset.tab) {
    const v = t.dataset.val;
    if (t.dataset.tab === 'task') state.taskFilter = v;
    else if (t.dataset.tab === 'taskmode') state.taskMode = v;
    else if (t.dataset.tab === 'kb') { state.kbCat = v; state.ragResults = null; state.ragMeta = null; }
    else if (t.dataset.tab === 'set') {
      state.setTab = v;
      if (v === 'external') { refreshConnClients(); return; }
    }
    else if (t.dataset.tab === 'todo' || t.dataset.tab === 'res') {
      setActiveTab(t);
      const sel = t.dataset.tab === 'todo' ? '#todo-list' : '#res-list';
      $$(`${sel} > *`).forEach(r => { r.style.display = (v === 'all' || r.dataset.cat === v) ? '' : 'none'; });
      return;
    }
    render();
    return;
  }

  const act = t.dataset.act;
  const idx = t.dataset.idx !== undefined && t.dataset.idx !== '' ? +t.dataset.idx : null;

  switch (act) {
    /* ---------- 弹窗 ---------- */
    case 'modal-close': closeModal(); return;

    /* ---------- 项目 ---------- */
    case 'new-project': closeModal(); openProjectForm(null); return;
    case 'edit-project': closeModal(); openProjectForm(t.dataset.id); return;
    case 'project-menu': projectMenu(t.dataset.id); return;
    case 'project-create': {
      const m = document.querySelector('.modal'); if (!validate(m, ['name'])) return;
      const v = formValues(m);
      const rootEl = m.querySelector('[name="rootDir"]');
      const folderEl = m.querySelector('[name="folder"]');
      const starterEl = m.querySelector('[name="starterTasks"]');

      const newRoot = rootEl ? rootEl.value.trim() : '';
      if (newRoot) {
        DB.settings.rootDir = newRoot;
        DB.settings.structureCreated = false;
      }
      if (!rootDir()) return toast('请先选择工作区根目录', 'err');

      const folder = safeFolderName(folderEl && folderEl.value.trim() ? folderEl.value.trim() : v.name);
      if (DB.projects.some(x => (x.folder || x.name) === folder)) {
        return toast(`工作区里已经有文件夹「${esc(folder)}」，换一个名字`, 'err');
      }

      const tpl = templateById(v.template);
      const withTasks = !starterEl || starterEl.checked;
      const proj = makeProject({
        name: v.name, folder, displayName: v.displayName, subtitle: v.subtitle, goal: v.goal,
        period: v.period, templateId: v.template
      });
      const span = monthsFromPeriod(proj.period);
      const due = days => {
        const x = new Date(Date.now() + days * 864e5);
        return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      };

      mutate(() => {
        DB.projects.push(proj);
        MATERIALS[proj.id] = Object.fromEntries(((tpl && tpl.dirs.length) ? tpl.dirs : ['01_资料']).map(d => [d, []]));
        DB.timeline.push({ p: proj.name, bars: [{ s: span.s, e: span.e, l: proj.stage, c: proj.accent }] });

        /* 模板自带的起始任务：都是「想清楚这个项目」必须回答的问题，可删可改 */
        if (tpl && withTasks && Array.isArray(tpl.tasks)) {
          tpl.tasks.forEach((row, i) => {
            const t = Array.isArray(row) ? row[0] : (row && row.t);
            const agent = Array.isArray(row) ? row[1] : (row && row.agent);
            if (!t) return;
            const agentName = (agent && (DB.agents || []).some(a => a && a.name === agent)) ? agent : '';
            DB.tasks.push({
              id: 'tk' + Date.now().toString(36) + i.toString(36) + Math.random().toString(36).slice(2, 4),
              t: String(t), p: proj.id, agent: agentName, tool: '文档', due: due((i + 1) * 5),
              pri: i === 0 ? 'high' : 'mid', st: 'todo', dir: (Object.keys(materialIndexOf(proj.id))[0]) || '', src: 'template'
            });
          });
        }

        DB.settings.onboarded = true;
        if (!DB.settings.defaultWorkspace) DB.settings.defaultWorkspace = proj.id;
        DB.workspace.project = projName(proj);
        state.project = proj.id;
      }, { activity: { text: `创建项目 <b>${esc(proj.name)}</b>`, kind: 'create', color: '#218358' } });

      closeModal();
      toast(`项目 <b>${esc(proj.name)}</b> 已创建 · 文件夹 <span class="mono">${esc(folder)}</span>`, 'ok');
      if (Bridge.desktop) setTimeout(() => rebuildStructure(true), 200);
      return;
    }
    case 'project-update': {
      const m = document.querySelector('.modal'); if (!validate(m, ['name'])) return;
      const v = formValues(m); const p = P(t.dataset.id);
      mutate(() => {
        Object.assign(p, {
          name: v.name, subtitle: v.subtitle, goal: v.goal, period: v.period,
          stage: v.stage, next: v.next, thumb: v.thumb, progress: +v.progress,
          folder: v.folder ? safeFolderName(v.folder) : (p.folder || p.name),
          tools: (v.tools || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)
        });
        const dn = String(v.displayName || '').trim().slice(0, 60);
        if (dn && dn !== p.name) p.displayName = dn;
        else delete p.displayName;
        if (state.project === p.id) DB.workspace.project = projName(p);
      }, { activity: { text: `更新项目 <b>${esc(v.name)}</b>`, kind: 'edit', color: '#AD5700' } });
      closeModal(); toast('项目已更新', 'ok');
      return;
    }
    case 'delete-project': {
      const id = t.dataset.id, p = P(id);
      closeModal();
      const folder = Bridge.desktop && rootDir() ? projectDir(p) : '';
      const taskCount = DB.tasks.filter(x => x.p === id).length;
      confirmDialog({
        title: '删除项目', danger: true, okText: '确认删除',
        message: `将从工作台删除「<b>${esc(p.name)}</b>」及其 ${taskCount} 个任务与排期。<br>默认保留磁盘上的材料文件夹。`,
        extra: folder ? `
          <label class="check-line" style="margin-top:12px">
            <input type="checkbox" name="delFolder"> <span>同时删除磁盘上的项目文件夹</span>
          </label>
          <div class="field-hint" style="margin:6px 0 0 22px">
            <span class="mono">${esc(folder)}</span><br>
            会移入系统回收站，可还原；文件夹里的材料文件将一并移走
          </div>` : '',
        onOk: async (checks) => {
          const wantFolder = !!(checks && checks.delFolder);
          mutate(() => {
            DB.tasks = DB.tasks.filter(x => x.p !== id);
            DB.projects = DB.projects.filter(x => x.id !== id);
            DB.timeline = DB.timeline.filter(x => x.p !== p.name);
            if (state.project === id) state.project = (DB.projects[0] || {}).id || '';
            DB.workspace.project = (P(state.project) || {}).name || '';
            if (!DB.projects.length) {
              DB.settings.defaultWorkspace = '';
              DB.settings.structureCreated = false;
            }
            if (DB.settings.defaultWorkspace === id) DB.settings.defaultWorkspace = (DB.projects[0] || {}).id || '';
          }, { activity: { text: `删除项目 <b>${esc(p.name)}</b>${wantFolder ? '（含文件夹）' : ''}`, kind: 'delete', color: '#CE2C31' } });

          if (!wantFolder) { toast('项目已删除，材料文件夹保留', 'ok'); return; }
          const r = await Bridge.trashPath(folder);
          if (r && r.ok) toast('项目已删除，文件夹已移入回收站', 'ok');
          else toast(`项目已删除，但文件夹没能移走：${esc((r && r.error) || '未知错误')}<br>可以手动删除 <span class="mono">${esc(folder)}</span>`, 'err');
        }
      });
      return;
    }
    /* ---------- 项目模板 ---------- */
    case 'project-save-template': {
      const p = P(t.dataset.id);
      closeModal();
      const dirs = Object.keys(MATERIALS[p.id] || {});
      const openTasks = DB.tasks.filter(x => x.p === p.id && x.st !== 'done');
      openModal({
        title: '存为项目模板',
        sub: '以后新建项目时可直接套用这套目录与阶段',
        body: `
          ${fText('tplName', '模板名称', `${p.name} 模板`, { req: true })}
          ${fArea('tplDesc', '模板说明', `${dirs.length} 个材料目录 · ${(p.flow || []).length} 个阶段`, { rows: 2 })}
          ${fStatic('包含内容', `
            <div class="tpl-summary">
              <div><b>材料目录</b>${dirs.length ? dirs.map(d => `<span class="chip gray">${esc(d)}</span>`).join('') : '<span class="muted">（无）</span>'}</div>
              <div style="margin-top:6px"><b>阶段</b>${(p.flow || []).map(f => `<span class="chip violet">${esc(f)}</span>`).join('') || '<span class="muted">（无）</span>'}</div>
            </div>`)}
          ${fCheckbox('tplTasks', `把当前 ${openTasks.length} 条未完成任务也存为起始任务`, false,
            { hint: '不勾选则模板只包含目录与阶段' })}
        `,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-act="project-save-template-do" data-id="${p.id}">保存模板</button>`
      });
      return;
    }
    case 'project-save-template-do': {
      const m = document.querySelector('.modal'); if (!validate(m, ['tplName'])) return;
      const v = formValues(m);
      const p = P(t.dataset.id);
      const withTasks = !!(m.querySelector('[name="tplTasks"]') || {}).checked;
      const dirs = Object.keys(MATERIALS[p.id] || {});
      const tpl = {
        id: 'tpl' + Date.now().toString(36),
        name: v.tplName.trim(),
        desc: (v.tplDesc || '').trim(),
        dirs: dirs.length ? dirs : ['01_资料'],
        flow: (p.flow || []).slice(),
        nodes: (p.nodes || []).map(n => ({ l: n.l, s: 'todo', d: '—' })),
        stage: p.stage || '',
        next: p.next || '',
        tasks: withTasks
          ? DB.tasks.filter(x => x.p === p.id && x.st !== 'done').map(x => [x.t, x.agent])
          : [],
        builtin: false
      };
      mutate(() => { if (!Array.isArray(DB.templates)) DB.templates = []; DB.templates.push(tpl); },
        { activity: { text: `从「${esc(p.name)}」保存模板 <b>${esc(tpl.name)}</b>`, kind: 'create', color: '#6E56CF' } });
      closeModal();
      toast(`模板「${esc(tpl.name)}」已保存，新建项目时可选`, 'ok');
      return;
    }
    case 'tpl-delete': {
      const id = t.dataset.id;
      const tpl = allTemplates().find(x => x.id === id);
      if (!tpl || tpl.builtin) return toast('内置模板不能删除', 'err');
      /* 先记下当前填了一半的表单，删完再恢复 */
      const m = document.querySelector('.modal');
      const draft = m ? {
        name: (m.querySelector('[name="name"]') || {}).value || '',
        folder: (m.querySelector('[name="folder"]') || {}).value || '',
        rootDir: (m.querySelector('[name="rootDir"]') || {}).value || '',
        subtitle: (m.querySelector('[name="subtitle"]') || {}).value || '',
        goal: (m.querySelector('[name="goal"]') || {}).value || '',
        period: (m.querySelector('[name="period"]') || {}).value || '',
        template: 'standard'
      } : null;
      confirmDialog({
        title: '删除模板', danger: true, okText: '删除模板',
        message: `删除自定义模板「<b>${esc(tpl.name)}</b>」？<br>已经用这个模板建好的项目不受影响。`,
        onOk: () => {
          mutate(() => { DB.templates = (DB.templates || []).filter(x => x.id !== id); },
            { activity: { text: `删除模板 <b>${esc(tpl.name)}</b>`, kind: 'delete', color: '#CE2C31' } });
          toast('模板已删除', 'ok');
          if (draft) openProjectForm(null, draft);
        }
      });
      return;
    }
    case 'pick-project-root': {
      if (!Bridge.desktop) return toast('浏览器模式无法选择目录', 'err');
      const dir = await window.workspace.pickDirectory();
      if (!dir) return;
      const m = document.querySelector('.modal');
      const input = m && m.querySelector('[name="rootDir"]');
      if (input) {
        input.value = dir;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    /* ---------- 多设备同步 ---------- */
    case 'sync-pick-dir': {
      if (!Bridge.desktop) return toast('同步需要桌面端运行', 'err');
      const dir = await window.workspace.pickDirectory();
      if (!dir) return;
      const r = await Bridge.syncSetDir(dir);
      if (!r || !r.ok) return toast(`这个目录不能用：${esc((r && r.error) || '未知错误')}`, 'err');
      state.sync = await Bridge.syncInfo();
      logActivity(`设置同步目录 <b>${esc(dir)}</b>`, 'edit', '#3E63DD');
      persist();
      render();
      toast('同步目录已设置，点「立即同步」先把本机副本发布出去', 'ok');
      return;
    }
    case 'sync-unset-dir': {
      const r = await Bridge.syncSetDir('');
      if (!r || !r.ok) return toast('关闭失败：' + esc((r && r.error) || ''), 'err');
      state.sync = await Bridge.syncInfo();
      logActivity('关闭多设备同步', 'edit', '#AD5700');
      persist();
      render();
      toast('已关闭同步（本机数据不受影响）', 'ok');
      return;
    }
    case 'sync-now': {
      if (!Bridge.desktop) return toast('同步需要桌面端运行', 'err');
      /* 每次同步都先问一次"以什么为准"，不记忆上次选择 */
      return openSyncMode();
    }
    case 'sync-go': {
      const prefer = t.dataset.prefer || 'merge';
      closeModal();
      toast('正在同步…', 'ok');
      /* 先把内存里的改动落盘，否则同步读到的是 350ms 前的旧文件 */
      await flushSave();
      const r = await Bridge.syncRun(prefer === 'merge' ? {} : { prefer });
      if (!r || !r.ok) return toast(`同步失败：${esc((r && r.error) || '未知错误')}`, 'err');
      /* 选了「合并」且真有冲突 → 再逐条问 */
      if (r.needsChoice) return openSyncConflicts(r);
      await finishSync(r);
      return;
    }
    case 'sync-apply': {
      await flushSave();
      const m = document.querySelector('.modal');
      const choices = {};
      m.querySelectorAll('.cf-seg').forEach(seg => {
        const on = seg.querySelector('.active');
        if (on) choices[seg.dataset.cf] = on.dataset.val;
      });
      const r = await Bridge.syncRun({ choices });
      if (!r || !r.ok) { closeModal(); return toast(`同步失败：${esc((r && r.error) || '未知错误')}`, 'err'); }
      closeModal();
      await finishSync(r);
      return;
    }
    case 'sync-choose-all': {
      const m = document.querySelector('.modal');
      const side = t.dataset.side;
      m.querySelectorAll('.cf-seg').forEach(seg => {
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.val === side));
      });
      return;
    }

    /* ---------- 交接文件（不配网盘也能搬数据） ---------- */
    case 'handoff-export': {
      if (!Bridge.desktop) return toast('交接文件需要桌面端运行', 'err');
      await flushSave();
      const r = await Bridge.handoffExport();
      if (!r || r.canceled) return;
      if (!r.ok) return toast(`导出失败：${esc((r && r.error) || '未知错误')}`, 'err');
      state.handoff = await Bridge.handoffInfo();
      const nm = String(r.file || '').split(/[\\/]/).pop();
      logActivity(`导出数据包 <b>${esc(nm)}</b>`, 'save', '#218358');
      persist();
      render();
      toast(`已导出 · ${r.projects || 0} 个项目 / ${r.tasks || 0} 条任务<br><span class="muted">${esc(r.file)}</span>`, 'ok');
      return;
    }
    case 'handoff-doc': {
      if (!Bridge.desktop) return toast('交接单需要桌面端运行', 'err');
      await flushSave();
      const r = await Bridge.handoffDoc();
      if (!r || r.canceled) return;
      if (!r.ok) return toast(`导出失败：${esc((r && r.error) || '未知错误')}`, 'err');
      logActivity('导出交接单', 'save', '#218358');
      persist();
      toast(`交接单已生成<br><span class="muted">${esc(r.file)}</span>`, 'ok');
      return;
    }
    case 'handoff-import': {
      if (!Bridge.desktop) return toast('交接文件需要桌面端运行', 'err');
      await flushSave();
      const r = await Bridge.handoffImport();
      if (!r || r.canceled) return;
      if (!r.ok) return toast(`导入失败：${esc((r && r.error) || '未知错误')}`, 'err');
      if (r.needsChoice) return openSyncConflicts(r, { handoff: true });
      await finishSync(r);
      return;
    }
    case 'handoff-apply': {
      await flushSave();
      const m = document.querySelector('.modal');
      const file = (m && m.dataset.handoffFile) || '';
      const choices = {};
      m.querySelectorAll('.cf-seg').forEach(seg => {
        const on = seg.querySelector('.active');
        if (on) choices[seg.dataset.cf] = on.dataset.val;
      });
      const r = await Bridge.handoffApply({ file, choices });
      if (!r || !r.ok) { closeModal(); return toast(`导入失败：${esc((r && r.error) || '未知错误')}`, 'err'); }
      closeModal();
      await finishSync(r);
      return;
    }

    /* ==================== 账户：注册 / 解锁 / 云端绑定 ==================== */
    case 'noop':
      return;

    case 'auth-register': {
      const host = document.getElementById('auth-gate');
      if (!host) return;
      const nameEl = host.querySelector('[data-role="reg-name"]');
      const passEl = host.querySelector('[data-role="reg-pass"]');
      const name = (nameEl ? nameEl.value : '').trim();
      if (!name) return setAuthError('先填一个名字');
      if (name.length > 24) return setAuthError('名字最多 24 个字符');
      const r = await Bridge.accountRegister({ name, pass: (passEl ? passEl.value : '') });
      if (!r || !r.ok) return setAuthError((r && r.error) || '创建失败');
      authSt().status = r.status;
      authSt().step = 'bind';
      /* 身份必须进 DB：持久化是整份 DB 覆盖写，DB 里没有 __account 就会把它抹掉 */
      DB.__account = r.account;
      logActivity(`建立工作台身份 <b>${esc(name)}</b>`, 'edit', '#6E56CF');
      persist();
      render();
      return;
    }

    case 'auth-unlock': {
      const host = document.getElementById('auth-gate');
      if (!host) return;
      const el = host.querySelector('[data-role="unlock-pass"]');
      const r = await Bridge.accountUnlock(el ? el.value : '');
      if (!r || !r.ok) {
        setAuthError((r && r.error) || '密码不对');
        if (el) { el.value = ''; el.focus(); }
        return;
      }
      authSt().status = r.status;
      authSt().step = 'done';
      toast('已解锁', 'ok');
      render();
      return;
    }

    case 'auth-forgot': {
      confirmDialog({
        title: '清除本机授权？',
        message: '密码只存在这台电脑上，没有后门可以找回。清除后：<br>'
          + '· 本机密码没了<br>· 云端绑定解除（云端里的数据不会被删）<br>· 身份、项目、任务都还在<br><br>'
          + '之后可以重新设密码、重新绑云端。',
        okText: '清除',
        danger: true,
        onOk: async () => {
          const r = await Bridge.accountResetLocal();
          if (!r || !r.ok) return toast(`清除失败：${esc((r && r.error) || '')}`, 'err');
          authSt().status = r.status;
          authSt().step = 'done';
          render();
          toast('本机授权已清除，可以重新设置', 'ok');
        }
      });
      return;
    }

    case 'auth-skip': {
      authSt().step = 'done';
      render();
      toast('先不绑云端。之后在「设置 → 账户」里随时能绑', 'ok');
      return;
    }

    case 'carrier-pick': {
      const id = String(t.dataset.id || '');
      const prov = ((authSt().status || {}).providers || []).find(p => p.id === id);
      if (!prov || prov.status === 'planned') return;
      authSt().bind.carrier = id;
      authSt().bind.error = '';
      refreshBindForm();
      setBindError('');
      return;
    }

    case 'bind-pick-dir': {
      if (!Bridge.desktop) return toast('选择目录需要桌面端运行', 'err');
      const dir = await window.workspace.pickDirectory();
      if (!dir) return;
      const scope = document.querySelector('.modal [data-role="bind-dir"]')
        || document.querySelector('#auth-gate [data-role="bind-dir"]');
      if (scope) scope.value = dir;
      return;
    }

    case 'bind-test': {
      const where = t.dataset.where || 'wizard';
      const root = where === 'gate' ? document.getElementById('auth-gate') : document.querySelector('.modal');
      if (!root) return;
      const cfg = readBindForm(root);
      if (cfg.kind === 'webdav') {
        if (!cfg.url) return setBindError('请填服务器地址');
        if (!/^https?:\/\//i.test(cfg.url)) return setBindError('地址要以 http:// 或 https:// 开头');
        if (!cfg.user) return setBindError('请填账号');
        if (!cfg.pass) return setBindError('请填应用密码（不是登录密码）');
      } else if (!cfg.dir) {
        return setBindError('请选择目录');
      }

      setBindError('');
      const label = t.textContent;
      t.disabled = true;
      t.textContent = '正在连接…';
      let r;
      try {
        r = await Bridge.accountBind(cfg);
      } finally {
        t.disabled = false;
        t.textContent = label;
      }
      if (!r || !r.ok) return setBindError((r && r.error) || '绑定失败');

      /* 绑定已成功：先把界面放出来，再跑第一次同步（冲突窗不该被账户门盖住） */
      authSt().status = r.status;
      authSt().step = 'done';
      authSt().bind.error = '';
      if (where === 'wizard') closeModal();
      render();

      const provName = (r.status.cloud && r.status.cloud.providerName) || '云端';
      logActivity(`绑定云端 <b>${esc(provName)}</b>`, 'edit', '#0D7485');
      persist();
      toast(`已绑定 ${esc(provName)}${r.dirReady === false ? '（目录创建失败：' + esc(r.dirNote || '') + '）' : ''}`, 'ok');

      await flushSave();
      const s1 = await Bridge.syncRun({});
      if (s1 && s1.ok && s1.needsChoice) return openSyncConflicts(s1);
      if (s1 && s1.ok) return finishSync(s1);
      toast(`首次同步没成功：${esc((s1 && s1.error) || '未知错误')}。绑定已保存，可以稍后点「立即同步」重试`, 'err');
      return;
    }

    case 'account-bind': {
      if (!Bridge.desktop) return toast('绑定云端需要桌面端运行', 'err');
      openBindWizard();
      return;
    }

    case 'account-unbind': {
      const c = (authSt().status || {}).cloud || {};
      confirmDialog({
        title: '解除云端绑定？',
        message: `当前绑定的是 <b>${esc(c.providerName || '')}${c.user ? ' · ' + esc(c.user) : ''}</b>。<br><br>`
          + '解除后本机不再和云端同步，<b>云端里的数据不会被删除</b>。'
          + '之后可以重新绑回同一个云端，或换成别的。',
        okText: '解除绑定',
        danger: true,
        onOk: async () => {
          const r = await Bridge.accountUnbind();
          if (!r || !r.ok) return toast(`解除失败：${esc((r && r.error) || '')}`, 'err');
          authSt().status = r.status;
          state.sync = await Bridge.syncInfo();
          logActivity('解除云端绑定', 'edit', '#AD5700');
          persist();
          render();
          toast('已解除绑定，数据仍在云端（需要的话自己去网盘删）', 'ok');
        }
      });
      return;
    }

    case 'account-reset': {
      confirmDialog({
        title: '清除本机授权？',
        message: '会解绑云端并删掉本机密码。<br><b>工作台身份和所有项目数据都不动。</b><br><br>'
          + '适合把电脑交给别人用之前做一次。',
        okText: '清除',
        danger: true,
        onOk: async () => {
          const r = await Bridge.accountResetLocal();
          if (!r || !r.ok) return toast(`清除失败：${esc((r && r.error) || '')}`, 'err');
          authSt().status = r.status;
          state.sync = await Bridge.syncInfo();
          logActivity('清除本机授权', 'edit', '#AD5700');
          persist();
          render();
          toast('已清除本机授权', 'ok');
        }
      });
      return;
    }

    case 'account-rename': {
      const acc = (authSt().status || {}).account || {};
      openModal({
        title: '改名字',
        body: fText('name', '工作台名字', acc.name || '', { req: true, hint: '只影响显示，不改身份 id' }),
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-act="modal-rename-ok">保存</button>`,
        onMount(modal) {
          modal.querySelector('[data-act="modal-rename-ok"]').addEventListener('click', async () => {
            const v = formValues(modal).name;
            if (!v) return toast('名字不能为空', 'err');
            const r = await Bridge.accountRename(v);
            closeModal();
            if (!r || !r.ok) return toast(`改名失败：${esc((r && r.error) || '')}`, 'err');
            authSt().status = await Bridge.accountStatus();
            if (r.account) DB.__account = r.account;
            render();
            toast('已改名', 'ok');
          });
        }
      });
      return;
    }

    case 'account-setpass': {
      openModal({
        title: '设置本机密码',
        body: fText('pass', '密码', '', { req: true, hint: '至少 4 位。只存本机，不进数据文件，也不会同步' })
          + fText('pass2', '再输一次', '', { req: true }),
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-act="modal-setpass-ok">设置</button>`,
        onMount(modal) {
          modal.querySelector('[data-act="modal-setpass-ok"]').addEventListener('click', async () => {
            const v = formValues(modal);
            if (!v.pass || v.pass.length < 4) return toast('密码至少 4 位', 'err');
            if (v.pass !== v.pass2) return toast('两次输入不一致', 'err');
            const r = await Bridge.accountSetPass(v.pass);
            closeModal();
            if (!r || !r.ok) return toast(`设置失败：${esc((r && r.error) || '')}`, 'err');
            authSt().status = r.status;
            logActivity('设置本机解锁密码', 'edit', '#6E56CF');
            persist();
            render();
            toast('已设置。下次启动需要输入密码', 'ok');
          });
        }
      });
      return;
    }

    case 'account-clearpass': {
      confirmDialog({
        title: '取消本机密码？',
        message: '取消后打开软件不再需要密码。数据本身不受影响。',
        okText: '取消密码',
        danger: true,
        onOk: async () => {
          const r = await Bridge.accountClearPass();
          if (!r || !r.ok) return toast(`操作失败：${esc((r && r.error) || '')}`, 'err');
          authSt().status = r.status;
          render();
          toast('已取消密码', 'ok');
        }
      });
      return;
    }

    case 'account-lock': {
      const r = await Bridge.accountLock();
      if (!r || !r.ok) return toast(esc((r && r.error) || '锁定失败'), 'err');
      authSt().status = await Bridge.accountStatus();
      render();
      return;
    }

    /* ==================== 应用内更新 ==================== */
    case 'update-check': {
      if (!Bridge.desktop) return toast('更新需要桌面端运行', 'err');
      toast('正在检查更新…', 'ok');
      const r = await Bridge.updateCheck();
      if (!r || !r.ok) {
        const msg = String((r && r.error) || '未知错误');
        const hint = /更新源/.test(msg) ? '<br><span class="muted">到「关于 → 更新源」填 github:用户名/仓库</span>' : '';
        return toast(`检查失败：${esc(msg)}${hint}`, 'err');
      }
      if (!r.hasUpdate) return toast(`已是最新版本（v${esc(r.current)}）`, 'ok');
      confirmDialog({
        title: `发现新版本 v${esc(r.latest.version)}`,
        message: `当前 v${esc(r.current)} → 新版 v${esc(r.latest.version)}<br><br>`
          + `${r.latest.notes ? esc(r.latest.notes) + '<br><br>' : ''}`
          + '点击「立即更新」后：软件会下载约 1MB 的更新包，'
          + '<b>自动关闭 → 替换 → 重新打开</b>，全程无需手动操作。',
        okText: '立即更新',
        onOk: async () => {
          toast('正在下载并准备更新…', 'ok');
          const a = await Bridge.updateApply();
          if (!a || !a.ok) return toast(`更新失败：${esc((a && a.error) || '未知错误')}（数据未受影响）`, 'err');
          toast(`正在更新到 v${esc(a.to)}，软件即将自动重启…`, 'ok');
        }
      });
      return;
    }
    case 'update-setsource': {
      const el = document.getElementById('update-source-input');
      if (!el) return;
      const wrote = el.value.trim();
      const r = await Bridge.updateSetSource(wrote);
      if (!r || !r.ok) return toast(`保存失败：${esc((r && r.error) || '')}`, 'err');
      state.update = await Bridge.updateInfo();
      if (!wrote) return toast('已清空，恢复为默认更新源', 'ok');
      toast(`更新源已保存<br><span class="muted">${esc(r.source)}</span>`, 'ok');
      render();
      return;
    }

    case 'preview-fresh': {
      if (!Bridge.desktop) return toast('全新安装预览需要桌面端运行', 'err');
      const r = await Bridge.previewFresh();
      if (r && r.ok) toast('已打开预览窗口：临时数据，关闭后自动清除', 'ok');
      else toast(`无法打开预览：${esc((r && r.error) || '未知错误')}`, 'err');
      return;
    }

    case 'pick-project': {
      const p = P(t.dataset.id);
      closeModal();
      mutate(() => { state.project = p.id; DB.workspace.project = p.name; }, { activity: { text: `切换工作区到 <b>${esc(p.name)}</b>`, kind: 'edit', color: '#6E56CF' } });
      toast(`当前工作区：<b>${esc(p.name)}</b>`, 'ok');
      return;
    }
    case 'open-project-folder': return openPath(projectDir(P(t.dataset.id)), P(t.dataset.id).name + ' 项目目录');

    /* ---------- 任务 ---------- */
    /* ---------- 项目页（Sprint A） ---------- */
    /* E5：只改显示名，文件夹保持不动 */
    case 'project-rename': {
      const proj = P(t.dataset.id);
      if (!proj) return;
      openModal({
        title: '重命名显示名',
        sub: `只改界面显示；文件夹仍是「${esc(proj.folder || proj.name)}」`,
        body: fText('displayName', '显示名', proj.displayName || proj.name, {
          req: true, ph: '例如：TPMS 换热器研究（2026 秋）',
          hint: '留空并保存则恢复为文件夹名'
        }),
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="project-rename-save" data-id="${proj.id}">保存</button>`
      });
      return;
    }
    case 'project-rename-save': {
      const m = document.querySelector('.modal');
      if (!m) return;
      const proj = P(t.dataset.id);
      if (!proj) return;
      const raw = String((formValues(m).displayName || '')).trim();
      const next = raw && raw !== (proj.folder || proj.name) ? raw.slice(0, 60) : '';
      mutate(() => {
        if (next) proj.displayName = next;
        else delete proj.displayName;
      }, { activity: { text: `项目显示名改为 <b>${esc(next || (proj.folder || proj.name))}</b>`, kind: 'edit', color: '#6E56CF' } });
      closeModal();
      toast(next ? `显示名已更新为「${esc(next)}」` : '已恢复为文件夹名', 'ok');
      return;
    }
    case 'project-open': {
      const p = P(t.dataset.id);
      if (!p) return;
      mutate(() => { state.project = p.id; DB.workspace.project = p.name; state.projectTab = 'overview'; },
        { activity: { text: `进入项目 <b>${esc(p.name)}</b>`, kind: 'edit', color: '#6E56CF' } });
      go('project');
      return;
    }
    case 'project-back': { state.route = 'home'; go('home'); return; }
    case 'project-tab': {
      state.projectTab = t.dataset.v || 'overview';
      /* 首页也能点（详情卡的「全部任务」）：不在项目页先跳过去，否则等于没反应 */
      if (state.route !== 'project') go('project'); else render();
      return;
    }
    case 'proj-task-filter': {
      state.taskFilter = t.dataset.v || 'all';
      render();
      return;
    }
    case 'proj-open-mat': {
      const p = P(t.dataset.id);
      if (!p) return;
      return openPath(projectDir(p) + '\\' + (t.dataset.d || ''), p.name + ' · ' + (t.dataset.d || ''));
    }
    /* ---------- 材料双视图（Sprint E） ---------- */
    /* ---------- 模板导入 / 导出（公开 JSON 格式） ---------- */
    case 'template-export': {
      if (!Bridge.desktop || !window.workspace.exportTemplates) return toast('模板导出只在桌面端可用', 'err');
      const payload = {
        format: 'research-workspace-templates',
        version: 1,
        exportedAt: new Date().toISOString(),
        templates: (DB.templates || []).map(t => ({
          id: t.id, name: t.name, desc: t.desc,
          dirs: t.dirs || [], flow: t.flow || [],
          starter_tasks: t.starter_tasks || 0, builtin: !!t.builtin
        }))
      };
      const r = await window.workspace.exportTemplates({ json: JSON.stringify(payload, null, 2) });
      if (!r || r.canceled) return;
      if (!r.ok) return toast(`导出失败：${esc((r && r.error) || '')}`, 'err');
      toast(`已导出 ${payload.templates.length} 个模板<br><span class="muted">${esc(r.path)}</span>`, 'ok');
      return;
    }
    case 'template-import': {
      if (!Bridge.desktop || !window.workspace.importTemplates) return toast('模板导入只在桌面端可用', 'err');
      const r = await window.workspace.importTemplates();
      if (!r || r.canceled) return;
      if (!r.ok) return toast(`读取失败：${esc((r && r.error) || '')}`, 'err');
      let data = null;
      try { data = JSON.parse(r.text); } catch (_) { return toast('不是合法的 JSON 文件', 'err'); }
      const list = Array.isArray(data && data.templates) ? data.templates : null;
      if (!list) return toast('文件里没有 templates 数组，不是本软件的模板格式', 'err');
      let added = 0, updated = 0;
      mutate(() => {
        for (const raw of list) {
          if (!raw || !raw.name) continue;
          const clean = {
            id: String(raw.id || ('tpl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))),
            name: String(raw.name).slice(0, 60),
            desc: String(raw.desc || '').slice(0, 200),
            dirs: Array.isArray(raw.dirs) ? raw.dirs.map(String).slice(0, 40) : [],
            flow: Array.isArray(raw.flow) ? raw.flow.map(String).slice(0, 40) : [],
            starter_tasks: Number(raw.starter_tasks) || 0,
            builtin: false
          };
          const exist = DB.templates.find(x => x.name === clean.name);
          if (exist) { Object.assign(exist, clean, { id: exist.id }); updated++; }
          else { DB.templates.push(clean); added++; }
        }
      }, { activity: { text: `导入项目模板（新增 ${added} / 覆盖 ${updated}）`, kind: 'create', color: '#218358' } });
      toast(`模板已导入：新增 ${added} 个，覆盖 ${updated} 个`, 'ok');
      return;
    }

    case 'mat-scan': return scanProjectMaterials(t.dataset.id);
    case 'mat-sync-cancel': { state.matScan = null; render(); return; }
    case 'mat-sync-apply': return applyMaterialSync(t.dataset.id);

    /* ---------- 项目软件：重命名 / 移除绑定 / 排序（P2） ---------- */
    case 'proj-app-rename': {
      const a = APP(t.dataset.n);
      if (!a) return;
      openModal({
        title: '重命名显示名',
        sub: '只改界面显示，不影响程序文件',
        body: fText('displayName', '显示名', a.displayName || a.n, { req: true, ph: '例如：Fluent 2023R1' }),
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="proj-app-rename-save" data-n="${esc(a.n)}">保存</button>`
      });
      return;
    }
    case 'proj-app-rename-save': {
      const m = document.querySelector('.modal'); if (!m || !validate(m, ['displayName'])) return;
      const a = APP(t.dataset.n);
      const name = String(formValues(m).displayName || '').trim();
      if (!a) return;
      mutate(() => { a.displayName = name || a.n; },
        { activity: { text: `软件显示名改为 <b>${esc(a.displayName)}</b>`, kind: 'edit', color: '#AD5700' } });
      closeModal(); toast('已重命名', 'ok'); return;
    }
    case 'proj-app-unbind': {
      const a = APP(t.dataset.n);
      if (!a) return;
      const p = P(t.dataset.id);
      mutate(() => { if (!p || a.bound === p.id) a.bound = ''; },
        { activity: { text: `把 <b>${esc(a.n)}</b> 从项目 ${esc(p ? projName(p) : '')} 移除绑定`, kind: 'edit', color: '#AD5700' } });
      toast(`已从本项目移除（磁盘上的程序不受影响）`, 'ok'); return;
    }
    case 'proj-app-move': {
      const n = t.dataset.n, dir = t.dataset.dir;
      const list = DB.apps.map(x => x.n);
      const i = list.indexOf(n);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= DB.apps.length) return;
      mutate(() => {
        const tmp = DB.apps[i]; DB.apps[i] = DB.apps[j]; DB.apps[j] = tmp;
      }, { activity: { text: `调整软件顺序 <b>${esc(n)}</b>`, kind: 'edit', color: '#AD5700' } });
      return;
    }

    case 'proj-bind-app': {
      const a = APP(t.dataset.n);
      const p = P(t.dataset.id);
      if (!a || !p) return;
      mutate(() => { a.bound = p.id; },
        { activity: { text: `把 <b>${esc(a.n)}</b> 绑定到项目 ${esc(projName(p))}`, kind: 'edit', color: '#AD5700' } });
      toast(`<b>${esc(a.n)}</b> 已绑定到「${esc(p.name)}」`, 'ok');
      return;
    }
    case 'proj-open-doc': {
      const rel = t.dataset.file || '';
      if (!rel) return toast('这条记录没有文件路径', 'err');
      return openPath(rootDir() + '\\' + rel.replace(/\//g, '\\'), rel);
    }
    case 'new-task': {
      closeModal();
      if (t.dataset.p && P(t.dataset.p)) state.project = t.dataset.p;
      openTaskForm(null);
      return;
    }
    case 'edit-task': closeModal(); openTaskForm(+t.dataset.idx); return;
    case 'open-task': openTaskDetail(+t.dataset.idx); return;
    case 'open-task-folder': {
      e.stopPropagation();
      return openPath(taskDir(DB.tasks[+t.dataset.idx]), '任务材料 · ' + DB.tasks[+t.dataset.idx].t);
    }
    case 'task-create': {
      const m = document.querySelector('.modal'); if (!validate(m, ['t'])) return;
      const v = formValues(m);
      mutate(() => {
        DB.tasks.unshift({
          id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          t: v.t, p: v.p, agent: v.agent, tool: v.tool, due: v.due, pri: v.pri, st: v.st, dir: v.dir
        });
        DB.workspace.project = (P(v.p) || {}).name || DB.workspace.project;
      }, { activity: { text: `新建任务 <b>${esc(v.t)}</b>`, kind: 'create', color: '#218358' } });
      closeModal(); toast('任务已创建', 'ok'); return;
    }
    case 'task-update': {
      const m = document.querySelector('.modal'); if (!validate(m, ['t'])) return;
      const v = formValues(m); const task = DB.tasks[+t.dataset.idx];
      mutate(() => Object.assign(task, { t: v.t, p: v.p, agent: v.agent, tool: v.tool, due: v.due, pri: v.pri, st: v.st, dir: v.dir }),
        { activity: { text: `更新任务 <b>${esc(v.t)}</b>`, kind: 'edit', color: '#AD5700' } });
      closeModal(); toast('任务已保存', 'ok'); return;
    }
    case 'task-complete': {
      const task = DB.tasks[+t.dataset.idx]; closeModal();
      mutate(() => { task.st = 'done'; }, { activity: { text: `完成任务 <b>${esc(task.t)}</b>`, kind: 'save', color: '#218358' } });
      toast('任务已完成', 'ok'); return;
    }
    case 'task-reopen': {
      const task = DB.tasks[+t.dataset.idx]; closeModal();
      mutate(() => { task.st = 'doing'; }, { activity: { text: `重新打开任务 <b>${esc(task.t)}</b>`, kind: 'refresh', color: '#3E63DD' } });
      return;
    }
    case 'task-run': {
      const task = DB.tasks[+t.dataset.idx];
      closeModal();
      mutate(() => {
        task.st = 'doing';
        const ag = A(task.agent);
        if (ag) ag.status = 'running';
      }, { activity: { text: `<b>${esc(task.agent)} Agent</b> 开始执行「${esc(task.t)}」`, kind: 'run', color: '#C9256B' } });
      toast(`<b>${esc(task.agent)}</b> 已开始执行任务`, 'ok');
      return;
    }

    /* ---------- 待办（完整增删改） ---------- */
    case 'new-todo': closeModal(); openTodoForm(null); return;
    case 'edit-todo': openTodoForm(+t.dataset.idx); return;
    case 'todo-create': {
      const m = document.querySelector('.modal'); if (!validate(m, ['t'])) return;
      const v = formValues(m);
      mutate(() => DB.todos.unshift({ t: v.t, cat: v.cat, pri: v.pri, due: v.due || '未设置', done: false }),
        { activity: { text: `新增待办 <b>${esc(v.t)}</b>`, kind: 'create', color: '#218358' } });
      closeModal(); toast('待办已添加', 'ok'); return;
    }
    case 'todo-update': {
      const m = document.querySelector('.modal'); if (!validate(m, ['t'])) return;
      const v = formValues(m); const todo = DB.todos[+t.dataset.idx];
      mutate(() => Object.assign(todo, { t: v.t, cat: v.cat, pri: v.pri, due: v.due || '未设置' }),
        { activity: { text: `修改待办 <b>${esc(v.t)}</b>`, kind: 'edit', color: '#AD5700' } });
      closeModal(); toast('待办已保存', 'ok'); return;
    }
    case 'toggle-todo': {
      const todo = DB.todos[+t.dataset.idx];
      mutate(() => { todo.done = !todo.done; });
      return;
    }
    case 'del-todo': {
      const todo = DB.todos[+t.dataset.idx];
      confirmDialog({
        title: '删除待办', danger: true, okText: '删除',
        message: `确认删除「${esc(todo.t)}」？`,
        onOk: () => {
          mutate(() => DB.todos.splice(DB.todos.indexOf(todo), 1),
            { activity: { text: `删除待办 <b>${esc(todo.t)}</b>`, kind: 'delete', color: '#CE2C31' } });
          toast('已删除', 'ok');
        }
      });
      return;
    }
    case 'quick-todo-from-task': {
      const task = DB.tasks[+t.dataset.idx];
      closeModal();
      mutate(() => DB.todos.unshift({ t: task.t, cat: 'task', pri: task.pri, due: task.due, done: false }),
        { activity: { text: `把任务 <b>${esc(task.t)}</b> 加入待办`, kind: 'create', color: '#218358' } });
      toast('已加入待办事项', 'ok'); return;
    }

    /* ---------- 绝对路径操作 ---------- */
    case 'open-abs': return openPath(t.dataset.path, t.dataset.label || t.dataset.path);
    case 'copy-abs': return copyPath(t.dataset.path);
    case 'open-root-folder': {
      if (!rootDir()) return toast('还没有设置工作区根目录。<br>新建项目时可指定，或到「设置 → 数据与同步」选择位置。', 'err');
      return openPath(rootDir(), '工作区根目录');
    }
    case 'open-data-file': {
      if (!Bridge.desktop) return toast('浏览器模式数据保存在 localStorage', 'err');
      const f = await window.workspace.dataFilePath();
      const r = await window.workspace.showItem(f);
      toast(r.ok ? '已在文件管理器中定位数据文件' : (r.error || '打开失败'), r.ok ? 'ok' : 'err');
      return;
    }
    case 'open-app-folder': {
      const a = APP(t.dataset.n);
      return openPath(a.path, a.n);
    }
    case 'change-root': {
      if (!Bridge.desktop) return toast('浏览器模式无法选择目录', 'err');
      const dir = await window.workspace.pickDirectory();
      if (!dir) return;
      mutate(() => { DB.settings.rootDir = dir; DB.settings.structureCreated = false; },
        { activity: { text: `工作区根目录改为 <b>${esc(dir)}</b>`, kind: 'edit', color: '#AD5700' } });
      toast('根目录已更新，正在创建目录结构…', 'ok');
      setTimeout(() => rebuildStructure(true), 200);
      return;
    }
    case 'rebuild-structure': await rebuildStructure(); return;

    /* ---------- 软件启动 ---------- */
    case 'quick-launch': {
      const a = APP(t.dataset.n);
      if (!a) return;
      if (a.kind === 'builtin') { go('browser'); return; }
      if (a.kind === 'folder') return openPath(a.path, a.n);
      return launchApp(a.n);
    }
    case 'launch-app': return launchApp(t.dataset.n);
    case 'stop-app': {
      const name = t.dataset.n;
      if (!Bridge.desktop) return toast('浏览器模式无法结束进程', 'err');
      const r = await window.workspace.stopApp(name);
      if (r.ok) {
        mutate(() => {
          const a = APP(name); if (a) a.run = null;
          DB.workspace.running = DB.workspace.running.filter(x => x !== name);
        }, { activity: { text: `结束进程 <b>${esc(name)}</b>`, kind: 'stop', color: '#AD5700' }, undo: false });
        toast(`已结束 <b>${esc(name)}</b>`, 'ok');
      } else toast(r.error, 'err');
      return;
    }
    case 'focus-app': {
      const name = t.dataset.n;
      const r = Bridge.desktop ? await window.workspace.exists(APP(name) ? APP(name).path : '') : { exists: false };
      toast(r.exists ? `<b>${esc(name)}</b> 正在运行` : `<b>${esc(name)}</b> 路径未就绪`, r.exists ? 'ok' : 'err');
      return;
    }
    case 'set-app-path': return setAppPath(t.dataset.n);
    case 'bind-app': {
      const a = APP(t.dataset.n);
      openModal({
        title: `绑定 ${esc(a.n)} 到项目`,
        body: `${fSelect('p', '项目', a.bound || state.project, DB.projects.map(p => [p.id, projName(p)]))}`,
        footer: `<span class="grow"></span><button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="bind-app-save" data-n="${esc(a.n)}">保存</button>`
      });
      return;
    }
    case 'bind-app-save': {
      const m = document.querySelector('.modal'); const v = formValues(m);
      const a = APP(t.dataset.n);
      mutate(() => { a.bound = v.p; }, { activity: { text: `<b>${esc(a.n)}</b> 绑定到 ${esc(projName(P(v.p)))}`, kind: 'link', color: '#6E56CF' } });
      closeModal(); toast('绑定已更新', 'ok'); return;
    }
    case 'open-builtin': go('browser'); return;
    case 'rescan-apps': {
      if (!Bridge.desktop) return toast('浏览器模式无法扫描本地程序', 'err');
      const found = [];
      for (const a of DB.apps.filter(x => x.kind === 'exe')) {
        const r = await window.workspace.exists(a.path);
        if (r.exists) found.push(a.n);
      }
      const missing = DB.apps.filter(x => x.kind === 'exe' && !found.includes(x.n)).map(x => x.n);
      openModal({
        title: '扫描结果',
        sub: `已检查 ${DB.apps.filter(x => x.kind === 'exe').length} 个可执行文件路径`,
        body: `<div class="field"><label>路径有效（${found.length}）</label>
            <div class="row" style="gap:6px;flex-wrap:wrap">${found.length ? found.map(n => `<span class="chip emerald">${esc(n)}</span>`).join('') : '<span class="muted">无</span>'}</div></div>
          <div class="field"><label>未找到（${missing.length}）</label>
            <div class="row" style="gap:6px;flex-wrap:wrap">${missing.length ? missing.map(n => `<span class="chip rose">${esc(n)}</span>`).join('') : '<span class="muted">无</span>'}</div>
            <div class="field-hint">可在「设置 → 科研工具链」中为每个软件指定真实的可执行文件路径</div></div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">关闭</button>
          <button class="btn primary" data-act="goto-tools">去设置路径</button>`
      });
      return;
    }
    case 'goto-tools': closeModal(); state.setTab = 'tools'; go('settings'); return;
    case 'goto-external': closeModal(); state.setTab = 'external'; go('settings'); return;
    case 'goto-dock': closeModal(); state.projectTab = 'software'; go('project'); return;
    case 'import-launch': {
      if (!Bridge.desktop) return toast('导入本地程序需要桌面端运行', 'err');
      const picked = await Bridge.pickLaunchTarget(t.dataset.mode || 'any');
      if (!picked) return;
      const info = await Bridge.resolveLaunchTarget(picked);
      if (!info.ok) return toast(esc(info.error).replace(/\n/g, '<br>'), 'err');
      openImportDialog(info);
      return;
    }
    case 'import-save': {
      const m = document.querySelector('.modal'); if (!validate(m, ['n', 'path'])) return;
      const v = formValues(m);
      const info = state.pendingImport || {};
      const name = v.n.trim();
      if (APP(name)) return toast(`启动台已存在同名项「${esc(name)}」，请换个名称`, 'err');
      const quick = v.quick !== 'no';
      const pal = [
        'linear-gradient(135deg,#7A6AD6,#4636A0)', 'linear-gradient(135deg,#4E88C0,#2A5C8C)',
        'linear-gradient(135deg,#3A9E70,#14603C)', 'linear-gradient(135deg,#C79A3E,#8A5E14)',
        'linear-gradient(135deg,#BE5590,#7E2E56)'
      ];
      mutate(() => {
        DB.apps.push({
          n: name, displayName: name, ico: name.slice(0, 2).toUpperCase(),
          kind: info.kind === 'folder' ? 'folder' : 'exe',
          args: splitArgsText(v.args), cwd: v.cwd || '',
          bg: pal[DB.apps.length % pal.length],
          path: v.path, icon: info.icon || '',
          source: 'imported', sourcePath: info.sourcePath || '',
          run: null, pending: false
        });
        if (quick && !DB.sidebarLaunch.includes(name)) DB.sidebarLaunch.push(name);
      }, { activity: { text: `导入 <b>${esc(name)}</b> 到启动台`, kind: 'create', color: '#218358' } });
      state.pendingImport = null;
      closeModal();
      toast(`<b>${esc(name)}</b> 已加入启动台${quick ? '，并固定到左侧快捷启动' : ''}`, 'ok');
      return;
    }
    case 'toggle-quick': {
      const n = t.dataset.n;
      mutate(() => {
        const i = DB.sidebarLaunch.indexOf(n);
        if (i >= 0) DB.sidebarLaunch.splice(i, 1); else DB.sidebarLaunch.push(n);
      });
      return;
    }
    case 'clear-quick': {
      mutate(() => { DB.sidebarLaunch = []; },
        { activity: { text: '清空左侧快捷启动', kind: 'delete', color: '#AD5700' } });
      return;
    }
    case 'remove-app': {
      const a = APP(t.dataset.n);
      if (!a) return;
      confirmDialog({
        title: '从启动台移除', danger: true, okText: '移除',
        message: `将把「${esc(a.displayName || a.n)}」从启动台与左侧快捷启动中移除。<br>不会删除磁盘上的任何文件。`,
        onOk: () => {
          mutate(() => {
            DB.apps = DB.apps.filter(x => x.n !== a.n);
            DB.sidebarLaunch = DB.sidebarLaunch.filter(x => x !== a.n);
            DB.workspace.running = DB.workspace.running.filter(x => x !== a.n);
          }, { activity: { text: `从启动台移除 <b>${esc(a.n)}</b>`, kind: 'delete', color: '#CE2C31' } });
          toast('已移除', 'ok');
        }
      });
      return;
    }

    /* ---------- AI 助手 ---------- */
    case 'ai-open-project': {
      const id = t.dataset.id;
      if (!P(id)) return;
      state.project = id;
      DB.workspace.project = P(id).name;
      persist();
      go('ai');
      return;
    }
    case 'ai-config': closeModal(); state.setTab = 'ai'; go('settings'); return;
    case 'ai-clear': {
      const p = P(state.project);
      confirmDialog({
        title: '清空会话', danger: true, okText: '清空',
        message: `将清除「${esc(p.name)}」的 AI 对话记录。项目数据不受影响。`,
        onOk: () => {
          mutate(() => { DB.chats[p.id] = []; }, { activity: { text: `清空 <b>${esc(p.name)}</b> 的 AI 会话`, kind: 'delete', color: '#AD5700' } });
          toast('会话已清空', 'ok');
        }
      });
      return;
    }
    case 'ai-sample': {
      const txt = t.dataset.text;
      state.aiDraft = '';
      aiSend(txt);
      return;
    }
    case 'ai-send': aiSend(); return;
    case 'ai-toggle': {
      const k = t.dataset.key;
      mutate(() => { DB.ai[k] = !DB.ai[k]; });
      return;
    }
    case 'ai-edit': openAiEdit(t.dataset.key); return;
    case 'ai-edit-save': {
      const m = document.querySelector('.modal'); if (!validate(m, ['val'])) return;
      const v = formValues(m);
      const key = t.dataset.key;
      mutate(() => { DB.ai[key] = v.val.trim(); }, { activity: { text: `AI ${key === 'baseUrl' ? 'Base URL' : '模型'} 已更新`, kind: 'edit', color: '#AD5700' } });
      closeModal(); toast('已保存', 'ok'); return;
    }
    case 'ai-key': openAiKeyDialog(); return;
    case 'ai-key-save': {
      const m = document.querySelector('.modal');
      const v = formValues(m);
      if (!v.key) { closeModal(); return; }
      const r = await Bridge.aiSetKey(v.key);
      if (!r.ok) return toast(esc(r.error), 'err');
      state.aiKey = await Bridge.aiKeyState();
      closeModal();
      toast(r.warning || 'API Key 已加密保存到本机', r.warning ? 'amber' : 'ok');
      render();
      return;
    }
    case 'ai-key-clear': {
      confirmDialog({
        title: '清除 API Key', danger: true, okText: '清除',
        message: '将删除本机保存的密钥。之后需要重新填写才能使用 AI 功能。',
        onOk: async () => {
          await Bridge.aiSetKey('');
          state.aiKey = await Bridge.aiKeyState();
          toast('密钥已清除', 'ok');
          render();
        }
      });
      return;
    }
    case 'ai-test': {
      if (!DB.ai.baseUrl || !DB.ai.model) return toast('请先配置 Base URL 与模型', 'err');
      toast('正在测试连接…', 'sky');
      const r = await Bridge.aiTest({ provider: DB.ai.provider, baseUrl: DB.ai.baseUrl, model: DB.ai.model });
      if (r.ok) {
        mutate(() => { DB.ai.enabled = true; },
          { activity: { text: `AI 连接测试成功（${esc(r.model)}）`, kind: 'agent', color: '#218358' } });
        toast(`连接成功 · 模型返回「${esc(r.reply || 'ok')}」`, 'ok');
      } else {
        toast(esc(r.error).replace(/\n/g, '<br>'), 'err');
      }
      return;
    }

    /* ---------- 外部 Agent 接入 ---------- */
    case 'copy-agent-prompt': {
      if (!Bridge.desktop) return toast('需要桌面端运行', 'err');
      const r = await Bridge.connPrompt();
      if (!r || !r.ok) return toast('生成接入指令失败', 'err');
      await Bridge.copy(r.prompt);
      toast('接入指令已复制 · 直接粘贴给你正在用的 Agent，无需重启它', 'ok');
      return;
    }
    case 'copy-agent-link': {
      if (!Bridge.desktop) return toast('需要桌面端运行', 'err');
      const r = await Bridge.connPrompt();
      if (!r || !r.ok || !r.link) return toast('生成接管链接失败', 'err');
      await Bridge.copy(r.link);
      toast('接管链接已复制 · 发给 Agent 并让它「读取这个链接并接管」即可', 'ok');
      return;
    }
    case 'export-agent-file': {
      if (!Bridge.desktop) return toast('需要桌面端运行', 'err');
      const r = await Bridge.connExport();
      if (r && r.canceled) return;
      if (!r || !r.ok) return toast(esc((r && r.error) || '导出失败'), 'err');
      toast(`接入手册已导出：<span class="mono">${esc(r.path)}</span>`, 'ok');
      return;
    }
    case 'preview-agent-prompt': {
      if (!Bridge.desktop) return toast('需要桌面端运行', 'err');
      const r = await Bridge.connPrompt();
      if (!r || !r.ok) return toast('生成接管凭证失败', 'err');
      openModal({
        title: '接管凭证（预览）',
        sub: '两种形态：可直接访问的链接，或粘到对话框的指令',
        wide: true,
        body: `
          <div class="field">
            <label>接管链接 · Agent 打开即可读到完整手册</label>
            <div class="path-box"><span class="pb-ico">${icon('link')}</span>
              <div class="pb-body"><div class="pb-path mono" style="white-space:normal;word-break:break-all">${esc(r.link)}</div></div></div>
          </div>
          <div class="field">
            <label>接管指令 · 复制后粘贴给 Agent</label>
            <pre class="ai-pre" style="max-height:340px;white-space:pre-wrap">${esc(r.prompt)}</pre>
          </div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">关闭</button>
          <button class="btn" data-act="copy-agent-link">${icon('link')}复制链接</button>
          <button class="btn primary" data-act="copy-agent-prompt">${icon('copy')}复制指令</button>`
      });
      return;
    }
    case 'conn-apply': {
      const r = await Bridge.connApply(t.dataset.id);
      if (r.ok) {
        toast(`已写入配置${r.backup ? '（原文件已备份）' : ''}${r.note ? '<br>' + esc(r.note) : ''}`, 'ok');
        await refreshConnClients();
      } else {
        toast(esc(r.error).replace(/\n/g, '<br>'), 'err');
      }
      return;
    }
    case 'conn-remove': {
      const r = await Bridge.connRemove(t.dataset.id);
      if (r.ok) { toast('已移除该连接配置', 'ok'); await refreshConnClients(); }
      else toast(esc(r.error), 'err');
      return;
    }
    case 'conn-reveal': {
      const r = await Bridge.connReveal(t.dataset.id);
      toast(r.ok ? '已打开配置目录' : esc(r.error || '打开失败'), r.ok ? 'ok' : 'err');
      return;
    }
    case 'copy-api-base': {
      const info = state.apiInfo || {};
      if (!info.baseUrl) return toast('本地 API 未启动', 'err');
      await Bridge.copy(info.baseUrl);
      return toast('接口地址已复制', 'ok');
    }
    case 'copy-api-token': {
      const info = state.apiInfo || {};
      if (!info.token) return toast('未获取到访问令牌', 'err');
      await Bridge.copy(info.token);
      return toast('可写令牌已复制（含增删改权限），请勿外泄', 'ok');
    }
    case 'copy-api-token-read': {
      const info = state.apiInfo || {};
      const t = info.tokenRead || info.token;
      if (!t) return toast('未获取到只读令牌', 'err');
      await Bridge.copy(t);
      return toast('只读令牌已复制（只能查询，不能改动数据）', 'ok');
    }
    case 'api-rotate': {
      confirmDialog({
        title: '重置访问令牌', danger: true, okText: '重置',
        message: '重置后旧令牌立即失效，已配置的外部 Agent 需要同步更新配置。',
        onOk: async () => {
          const info = await Bridge.apiRotate();
          if (info) state.apiInfo = info;
          toast('访问令牌已重置', 'ok');
          render();
        }
      });
      return;
    }
    case 'copy-mcp-config': {
      if (!Bridge.desktop) return toast('需要桌面端运行', 'err');
      const cfg = await Bridge.apiMcpConfig();
      if (!cfg || !cfg.ok) return toast('生成配置失败', 'err');
      await Bridge.copy(JSON.stringify({ mcpServers: cfg.mcpServers }, null, 2));
      toast('MCP 配置已复制 · 粘贴到 Agent 的 mcp.json 后重启该 Agent 即可', 'ok');
      return;
    }
    case 'copy-curl': {
      const info = state.apiInfo || {};
      const base = info.baseUrl || 'http://127.0.0.1:7317';
      const tk = info.token || '<token>';
      const sample = [
        `# 科研工作台 · 本地 API 调试示例（PowerShell / Windows 自带 curl.exe）`,
        ``,
        `# 1) 连通性检查（无需令牌）`,
        `curl.exe ${base}/api/health`,
        ``,
        `# 2) 查看全部项目`,
        `curl.exe -H "Authorization: Bearer ${tk}" ${base}/api/projects`,
        ``,
        `# 3) 读取项目全量现状（任务 / 待办 / 材料目录）`,
        `curl.exe -H "Authorization: Bearer ${tk}" "${base}/api/context?project=tpms"`,
        ``,
        `# 4) 新建一个任务`,
        `curl.exe -X POST -H "Authorization: Bearer ${tk}" -H "Content-Type: application/json" ` +
        `-d '{"title":"由外部 Agent 创建的任务","priority":"高","due":"10-30","agent":"Engineer"}' ` +
        `${base}/api/tools/create_task`,
        ``,
        `# 5) 把任务标记为已完成`,
        `curl.exe -X POST -H "Authorization: Bearer ${tk}" -H "Content-Type: application/json" ` +
        `-d '{"task_title":"由外部 Agent 创建的任务","status":"已完成"}' ` +
        `${base}/api/tools/update_task`,
        ``,
        `# 6) 新增待办`,
        `curl.exe -X POST -H "Authorization: Bearer ${tk}" -H "Content-Type: application/json" ` +
        `-d '{"content":"复核试验台标定数据","category":"任务","priority":"高","due":"明天 10:00"}' ` +
        `${base}/api/tools/create_todo`,
        ``,
        `# 7) 查看全部可用工具`,
        `curl.exe -H "Authorization: Bearer ${tk}" ${base}/api/tools`
      ].join('\n');
      await Bridge.copy(sample);
      toast('curl 示例已复制（含你的实际地址与令牌）', 'ok');
      return;
    }
    case 'api-selftest': {
      if (!Bridge.desktop) return toast('需要桌面端运行', 'err');
      const info = await Bridge.apiInfo();
      state.apiInfo = info;
      if (!info.running) { render(); return toast('本地 API 未启动', 'err'); }
      toast('正在自检…', 'sky');
      try {
        const h = await fetch(`${info.baseUrl}/api/health`);
        const hj = await h.json();
        const p = await fetch(`${info.baseUrl}/api/projects`, { headers: { Authorization: 'Bearer ' + info.token } });
        const pj = await p.json();
        const bad = await fetch(`${info.baseUrl}/api/projects`, { headers: { Authorization: 'Bearer wrong-token' } });
        if (pj.ok && bad.status === 401) {
          toast(`自检通过 · 服务在线（端口 ${hj.port}）· 令牌鉴权正常 · 可见 ${pj.projects.length} 个项目`, 'ok');
        } else if (!pj.ok) {
          toast('自检失败：' + (pj.error || '令牌无效'), 'err');
        } else {
          toast('自检异常：错误令牌未被拒绝，请检查服务', 'err');
        }
      } catch (e) {
        toast('自检失败：' + String((e && e.message) || e), 'err');
      }
      render();
      return;
    }
    case 'show-api-doc': {
      const info = state.apiInfo || {};
      const base = info.baseUrl || 'http://127.0.0.1:7317';
      const tools = (typeof AI_TOOLS !== 'undefined' ? AI_TOOLS : []).map(t => t.function.name);
      openModal({
        title: '外部 Agent 接入说明',
        sub: '两种方式：本地 HTTP API（通用）与 MCP（标准协议）',
        wide: true,
        body: `
          <div class="field">
            <label>方式一 · 本地 HTTP API</label>
            <div style="font-size:11.5px;line-height:1.9;color:var(--text-2)">
              任何能发 HTTP 请求的程序都能用：脚本、Codex、WorkBuddy 的终端工具、Postman 等。<br>
              请求头需带 <code class="ai-code">Authorization: Bearer &lt;令牌&gt;</code>，仅监听本机。
            </div>
            <div class="mat-list mt-10">
              ${[['GET', '/api/health', '服务与窗口状态（无需令牌）'],
                 ['GET', '/api/tools', '全部可用工具及其参数说明'],
                 ['GET', '/api/projects', '项目列表'],
                 ['GET', '/api/context?project=&lt;id&gt;', '某项目的全量现状'],
                 ['POST', '/api/tools/&lt;名称&gt;', '调用工具，body 为参数对象']]
                .map(([m, p, d]) => `<div class="mat-row" style="cursor:default">
                  <span class="m-ico" style="background:${m === 'GET' ? '#218358' : '#6E56CF'}">${m}</span>
                  <div class="m-body"><div class="m-name mono">${p}</div><div class="m-meta" style="font-family:var(--font);direction:ltr">${d}</div></div>
                </div>`).join('')}
            </div>
          </div>

          <div class="field">
            <label>方式二 · MCP（推荐给 Codex / WorkBuddy / Claude 这类 Agent）</label>
            <div style="font-size:11.5px;line-height:1.9;color:var(--text-2)">
              在「外部 Agent 接入」里点「生成并复制配置」，粘贴到对应 Agent 的 <code class="ai-code">mcp.json</code>，
              重启该 Agent 后它会自动发现下面这些工具，直接调用即可修改你的项目。
            </div>
          </div>

          <div class="field">
            <label>可调用的工具（${tools.length}）</label>
            <div class="row" style="gap:5px;flex-wrap:wrap">
              ${tools.map(n => `<span class="chip violet mono">${esc(n)}</span>`).join('')}
            </div>
          </div>

          <div class="field">
            <label>安全说明</label>
            <div style="font-size:11px;line-height:1.9;color:var(--text-3)">
              · 服务只绑定 127.0.0.1，外部网络无法访问<br>
              · 所有请求必须携带令牌，令牌保存在本机用户数据目录，可随时重置<br>
              · 外部改动会立即写入本地数据文件并同步刷新界面
            </div>
          </div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="copy-curl">${icon('copy')}复制 curl 示例</button>
          <button class="btn primary" data-act="copy-mcp-config">${icon('copy')}复制 MCP 配置</button>`
      });
      return;
    }


    /* ---------- Agent ---------- */
    case 'agent-detail': openAgentDetail(t.dataset.a); return;
    case 'agent-history': openAgentHistory(t.dataset.a); return;
    case 'agent-assign': return openAgentAssign(t.dataset.a);
    case 'ai-mode': {
      const v = t.dataset.v;
      if (v === 'browser') { state.aiMode = 'browser'; go('browser'); return; }
      state.aiMode = v === 'assign' ? 'assign' : 'chat';
      if (state.route !== 'ai') go('ai'); else render();
      return;
    }
    case 'goto-assign': { closeModal(); state.aiMode = 'assign'; go('ai'); return; }
    case 'goto-agents': {
      /* Agent 中心已并入 AI 助手：直接切到派任务模式（员工都在这里管） */
      closeModal();
      state.aiMode = 'assign';
      go('ai');
      return;
    }
    /* 给员工派单：打开弹窗 → 派发 → 独立会话执行（不占用 AI 助手主对话） */
    case 'staff-assign': return openStaffAssign(t.dataset.a);
    case 'staff-dispatch': {
      const m = document.querySelector('.modal');
      if (!m) return;
      const name = t.dataset.a;
      const sel = m.querySelector('[name="project"]');
      const ta = m.querySelector('[name="task"]');
      const projectId = sel ? sel.value : (state.project || '');
      const task = String(ta ? ta.value : '').trim();
      if (task.length < 4) return toast('任务写得太短，补几个字再派', 'err');
      const job = createAgentJob({ agent: name, task, projectId });
      closeModal();
      persist();
      render();
      toast(`已派给 <b>${esc(name)}</b>，开始执行…`, 'ok');
      runAgentJob(job.id);
      return;
    }
    case 'job-view': return openJobView(t.dataset.id);
    case 'job-retry': {
      const job = jobById(t.dataset.id);
      closeModal();
      if (!job) return;
      const again = createAgentJob({ agent: job.agent, task: job.task, projectId: job.projectId });
      persist();
      render();
      toast(`已重新派给 <b>${esc(job.agent)}</b>`, 'ok');
      runAgentJob(again.id);
      return;
    }
    case 'agent-run': {
      /* 详情里的主按钮只打开员工派单窗，不会直接跑任务，也不会中止正在跑的任务 */
      closeModal();
      return openStaffAssign(t.dataset.a);
    }
    case 'agent-orchestrate': {
      openModal({
        title: 'Agent 编排策略',
        sub: '决定任务如何在 Agent 之间分配',
        body: `<div class="set-pending-note" style="margin-bottom:11px">
            ${icon('alert')}调度模式标注为<b>即将推出</b>：目前只会保存选择，尚未接入真实调度逻辑 —— 保存后不会改变任务分配行为。
          </div>
          <div class="field"><label>调度模式</label>
            <div class="seg" data-seg="mode">
              <button class="active" data-val="auto">自动调度</button>
              <button data-val="manual">手动指派</button>
              <button data-val="chain">串行分解</button>
            </div></div>
          <div class="field"><label>当前在役 Agent</label>
            <div class="row" style="gap:6px;flex-wrap:wrap">${DB.agents.map(a => `<span class="chip ${a.status === 'idle' ? 'gray' : 'accent'}">${esc(a.name)}</span>`).join('')}</div>
            <div class="field-hint">自动调度会按任务关键词匹配 Agent 的职责标签</div></div>`,
        footer: `<span class="grow"></span><button class="btn" data-act="modal-close">关闭</button>
          <button class="btn primary" data-act="orchestrate-save">保存策略</button>`
      });
      return;
    }
    case 'orchestrate-save': {
      const seg = document.querySelector('.modal .seg');
      const mode = seg ? (seg.querySelector('.active') || {}).dataset.val : 'auto';
      DB.settings.agentAuto = mode === 'auto';
      closeModal();
      mutate(() => {}, { activity: { text: `更新 Agent 编排策略（${mode}）`, kind: 'agent', color: '#6E56CF' } });
      toast('编排策略已保存', 'ok'); return;
    }
    case 'new-agent': {
      openModal({
        title: '新建 Agent',
        sub: '为科研工作流添加一个专职 Agent',
        body: agentFormFields(null),
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="agent-create">创建</button>`
      });
      return;
    }
    case 'agent-edit': return openAgentEdit(t.dataset.a);
    case 'agent-save': return saveAgentEdits(t.dataset.a);
    case 'agent-create': {
      const m = document.querySelector('.modal'); if (!validate(m, ['name', 'role'])) return;
      const v = formValues(m);
      if (DB.agents.some(a => a && a.name === v.name)) {
        return toast(`已经有名为「${esc(v.name)}」的 Agent`, 'err');
      }
      const pal = [['linear-gradient(135deg,#E0668E,#B01E58)', 'bot'], ['linear-gradient(135deg,#3E63DD,#23409C)', 'cpu'], ['linear-gradient(135deg,#218358,#14603C)', 'pencil']];
      const p = pal[DB.agents.length % pal.length];
      mutate(() => {
        AGENT_COLORS[v.name] = { bg: p[0], ico: p[1] };
        DB.agents.push({
          name: v.name, role: v.role, status: 'idle',
          tags: parseAgentTags(v.tags),
          task: '待分配任务', stats: [0, 0, 90],
          prompt: (v.prompt || '').trim()
        });
      }, { activity: { text: `创建 Agent <b>${esc(v.name)}</b>`, kind: 'agent', color: '#6E56CF' } });
      closeModal(); toast('Agent 已创建', 'ok'); return;
    }

    /* ---------- 知识库 ---------- */
    case 'kb-search': return runKnowledgeQuery('search');
    case 'kb-ask': return runKnowledgeQuery('ask');
    case 'kb-open': {
      /* kbDocs 只是资料登记，没有绑定磁盘路径 —— 不再谎称"已打开" */
      const d = DB.kbDocs.find(x => x.n === t.dataset.name);
      if (!d) return;
      openModal({
        title: d.n,
        sub: `${d.type} · ${d.size} · 入库于 ${d.date}`,
        body: `<div class="kb-stat-list">
          <div class="kbs-row"><span>类型</span><b>${esc(d.type)}</b></div>
          <div class="kbs-row"><span>大小</span><b>${esc(d.size)}</b></div>
          <div class="kbs-row"><span>入库日期</span><b>${esc(d.date)}</b></div>
        </div>
        <p style="font-size:11px;color:var(--text-3);line-height:1.8;margin-top:10px">
          这是一条资料登记记录，未绑定具体文件路径。要按内容检索，请在「设置 → 数据与同步」接入你自己的 RAG 服务。
        </p>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">关闭</button>
          <button class="btn" data-act="kb-open-root">${icon('folderOpen')}打开知识库目录</button>`
      });
      return;
    }
    case 'kb-open-hit': {
      const h = state.ragResults && state.ragResults[Number(t.dataset.i)];
      if (!h) return;
      showCitation(h);
      return;
    }
    case 'kb-open-abs': {
      const p = t.dataset.path || '';
      if (!p) return;
      const r = await Bridge.openFolder(p);
      if (r && r.ok) toast('已打开文件', 'ok');
      else toast(`无法打开：${esc((r && r.error) || p)}`, 'err');
      return;
    }
    case 'kb-open-root': {
      if (!rootDir()) return toast('还没有设置工作区根目录。', 'err');
      return openPath(rootDir(), '工作区根目录');
    }
    case 'kb-reindex': {
      const S = DB.settings;
      if (!Bridge.desktop) return toast('重建索引需要桌面端运行', 'err');
      if (!S.ragEnabled || (S.kbEngine === 'rag_snowz')) {
        openModal({
          title: S.kbEngine === 'rag_snowz' ? '索引由 RAG_Snowz 维护' : '尚未接入外部 RAG',
          sub: '本软件不做向量化',
          body: `<div class="col" style="gap:9px;font-size:12px;line-height:1.85;color:var(--text-2)">
            ${S.kbEngine === 'rag_snowz'
              ? '<p>RAG_Snowz 的文档和片段由本机服务自己维护。工作台只调用 <code class="ai-code">/health</code>、<code class="ai-code">/v1/search</code> 和 <code class="ai-code">/v1/ask</code>，不会发送重建索引请求。</p>'
              : `<p>当前知识库只能按<b>资料名称</b>匹配，没有向量索引可重建 —— 所以这里不会再假装"重建成功"。</p>
            <p>接入通用 HTTP 引擎后，这个按钮会调用它的 <code class="ai-code">POST /reindex</code>。</p>
            <p class="muted" style="font-size:11px">RAG_Snowz 契约：<code class="ai-code">GET /health</code> · <code class="ai-code">POST /v1/search</code> · <code class="ai-code">POST /v1/ask</code></p>`}
          </div>`,
          footer: `<span class="grow"></span>
            <button class="btn" data-act="modal-close">知道了</button>
            <button class="btn primary" data-act="goto-rag-settings">去接入</button>`
        });
        return;
      }
      toast('正在请求 RAG 服务重建索引…', 'ok');
      const r = await Bridge.ragReindex({ endpoint: S.ragEndpoint, engine: S.kbEngine });
      if (!r || !r.ok) {
        const err = (r && r.error) || '重建失败';
        state.rag = { ...state.rag, status: 'fail', error: err };
        render(); return toast(`重建失败：${esc(err)}`, 'err');
      }
      state.rag = { ...state.rag, status: 'ok', indexed: r.indexed || state.rag.indexed, error: '' };
      mutate(() => {}, { activity: { text: `重建知识库索引：新增 ${r.added} · 更新 ${r.updated} · 移除 ${r.removed}`, kind: 'refresh', color: '#6E56CF' } });
      render();
      toast(`索引已重建 · 新增 ${r.added} / 更新 ${r.updated} / 移除 ${r.removed}`, 'ok');
      return;
    }

    /* ---------- 外部 RAG 检索通道 ---------- */
    case 'export-mcp': {
      const info = state.apiInfo || {};
      if (!info.baseUrl) return toast('先启动本地 API 服务（设置 → 外部 Agent 接入）', 'err');
      const cfg = {
        mcpServers: {
          'research-workspace': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-http',
              `${info.baseUrl}/mcp?token=${info.token || ''}`],
            env: {},
            _note: '把这段贴进 Cursor / Claude Desktop 的 MCP 配置；token 为可写令牌，只读场景请换成只读令牌'
          }
        }
      };
      const text = JSON.stringify(cfg, null, 2);
      await Bridge.copy(text);
      openModal({
        title: 'MCP 配置片段',
        sub: '已复制到剪贴板，可直接粘贴到支持 MCP 的客户端',
        body: `<p class="ext-desc" style="margin-bottom:8px">本工作台把 ${AI_TOOLS.length} 个工具通过本地 API 暴露，
          客户端只要能访问 ${esc(info.baseUrl)} 就能接管项目管理。</p>
          <pre class="mono" style="font-size:10.5px;line-height:1.7;background:var(--surface-2);padding:10px;border-radius:var(--r-sm);max-height:260px;overflow:auto;white-space:pre-wrap">${esc(text)}</pre>
          <div class="field-hint" style="margin-top:8px">只读场景：把 token 换成只读令牌，写操作会被 403 拒绝。</div>`,
        footer: `<span class="grow"></span><button class="btn primary" data-act="modal-close">好</button>`
      });
      return;
    }
    case 'rag-reindex': {
      if (!Bridge.desktop) return toast('重建索引需要桌面端运行', 'err');
      if (DB.settings.kbEngine === 'rag_snowz') return toast('RAG_Snowz 的索引由本机服务维护，这里不重建', 'err');
      const ep = DB.settings.ragEndpoint;
      if (!ep) return toast('先配置引擎地址', 'err');
      toast('正在重建索引…', 'ok');
      const r = await Bridge.ragReindex({ endpoint: ep, engine: DB.settings.kbEngine });
      if (r && r.ok) {
        state.rag = { status: 'ok', indexed: r.indexed || 0, model: r.model || '', error: '' };
        mutate(() => { DB.settings.ragLastIndexAt = Date.now(); },
          { activity: { text: `重建知识库索引（${r.indexed || 0} 条）`, kind: 'edit', color: '#3E63DD' } });
        toast(`索引已重建 · ${r.indexed || 0} 条`, 'ok');
      } else {
        toast(`重建失败：${esc((r && r.error) || '未知错误')}`, 'err');
      }
      return;
    }
    case 'rag-test': {
      if (!Bridge.desktop) return toast('外部 RAG 需要桌面端运行', 'err');
      const S = DB.settings;
      toast('正在连接 RAG 服务…', 'ok');
      const cfg = ragClientConfig(S);
      const r = await Bridge.ragHealth({ endpoint: cfg.endpoint, engine: cfg.engine });
      if (applyRagHealth(r)) {
        render();
        openModal({
          title: cfg.snowz ? 'RAG_Snowz 连接正常' : 'RAG 服务连接正常',
          sub: esc(cfg.endpoint),
          body: ragHealthHtml(r, cfg.snowz),
          footer: `<span class="grow"></span><button class="btn primary" data-act="modal-close">好</button>`
        });
      } else {
        const err = (r && r.error) || '连接失败';
        state.rag = { status: 'fail', indexed: 0, docs: 0, chunks: 0, model: '', error: err };
        render();
        openModal({
          title: 'RAG 服务连接失败',
          body: `<div class="field-err" style="display:block">${esc(err)}</div>
            <p style="font-size:11px;color:var(--text-3);line-height:1.8;margin-top:10px">
              软件按 <code class="ai-code">GET {地址}/health</code> 探测服务。请确认服务已启动、端口正确，且 /health 返回 JSON。
            </p>`,
          footer: `<span class="grow"></span>
            <button class="btn" data-act="goto-rag-settings">改地址</button>
            <button class="btn primary" data-act="modal-close">关闭</button>`
        });
      }
      return;
    }
    case 'kb-engine': {
      const v = String(t.value || 'builtin');
      mutate(() => {
        DB.settings.kbEngine = v;
        /* 引擎与老的 ragEnabled 开关保持一致，避免两套开关互相打架 */
        DB.settings.ragEnabled = (v === 'http' || v === 'rag_snowz');
        if (v === 'rag_snowz') {
          const ep = String(DB.settings.ragEndpoint || '');
          if (!ep || ep === 'http://127.0.0.1:8000') DB.settings.ragEndpoint = 'http://127.0.0.1:8765';
        }
      }, { activity: { text: `知识库引擎切换为 <b>${esc(v)}</b>`, kind: 'edit', color: '#3E63DD' } });
      toast(v === 'none' ? '知识库引擎已关闭（只按文件名匹配）' : `知识库引擎：${esc(v)}`, 'ok');
      render();
      return;
    }
    case 'rag-config': {
      openModal({
        title: 'RAG 服务地址',
        sub: '只填到接口前缀，不要带 /search 之类的路径后缀',
        body: fText('endpoint', '接口基地址', DB.settings.ragEndpoint || '', { req: true, ph: 'http://127.0.0.1:8765' }),
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="rag-config-save">保存并测试</button>`
      });
      return;
    }
    case 'rag-config-save': {
      const m = document.querySelector('.modal'); if (!m || !validate(m, ['endpoint'])) return;
      const ep = String(formValues(m).endpoint || '').trim().replace(/\/+$/, '');
      const snowzPort = /:8765(\/|$)/.test(ep);
      const engineForProbe = (DB.settings.kbEngine === 'rag_snowz' || DB.settings.kbEngine === 'http')
        ? DB.settings.kbEngine
        : (snowzPort ? 'rag_snowz' : 'http');
      const r = await Bridge.ragHealth({ endpoint: ep, engine: engineForProbe });
      const ok = !!(r && r.ok);
      mutate(() => {
        DB.settings.ragEndpoint = ep;
        if (ok) {
          DB.settings.ragEnabled = true;         /* 只有连得上才自动启用，避免一搜就报错 */
          if (!DB.settings.kbEngine || DB.settings.kbEngine === 'builtin' || DB.settings.kbEngine === 'none') {
            DB.settings.kbEngine = engineForProbe;
          }
        }
      }, { activity: { text: `设置 RAG 服务地址 <b>${esc(ep)}</b>${ok ? '（连接正常，已启用）' : '（未连接）'}`, kind: 'edit', color: '#AD5700' } });
      applyRagHealth(ok ? r : { ok: false, error: (r && r.error) || '连接失败' });
      closeModal();
      toast(ok
        ? (r.engine === 'rag_snowz'
          ? `已连接 · 文档 ${r.docs || 0} · 片段 ${r.chunks || 0}`
          : `已连接 · 索引 ${r.indexed || 0} 条`)
        : `地址已保存，但连接失败：${esc((r && r.error) || '')}`, ok ? 'ok' : 'err');
      return;
    }
    case 'rag-token': {
      openModal({
        title: 'RAG 访问令牌',
        sub: '留空保存则清除。令牌加密保存在本地，不写入数据文件',
        body: fText('token', 'Bearer 令牌', '', { ph: '服务不需要鉴权就留空' }),
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="rag-token-save">保存</button>`
      });
      return;
    }
    case 'rag-token-save': {
      const m = document.querySelector('.modal'); if (!m) return;
      const r = await Bridge.ragSetToken(formValues(m).token || '');
      if (!r || !r.ok) return toast(`保存失败：${esc((r && r.error) || '未知错误')}`, 'err');
      state.ragToken = await Bridge.ragState();
      closeModal(); render();
      toast(r.stored ? '令牌已加密保存' : '令牌已清除', 'ok');
      return;
    }
    case 'rag-token-clear': {
      await Bridge.ragSetToken('');
      state.ragToken = await Bridge.ragState();
      render(); toast('令牌已清除', 'ok'); return;
    }
    case 'goto-rag-settings': closeModal(); state.setTab = 'storage'; go('settings'); return;
    /* ---------- 活动详情（v2.8.2） ---------- */
    case 'activity-view': {
      const idx = +t.dataset.idx;
      const a = DB.activities[idx];
      if (!a) return;
      const plain = String(a.t || '').replace(/<[^>]+>/g, '');
      const when = a.at ? new Date(a.at) : null;
      const fmt = when
        ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${a.time}`
        : (a.time || '—');
      const KIND_LABEL = {
        create: '新建', edit: '修改', delete: '删除', save: '保存',
        flow: '流程', todo: '待办', run: '启动软件', agent: 'Agent', switch: '切换'
      };
      openModal({
        title: '活动详情',
        sub: `${KIND_LABEL[a.kind] || '变更'} · ${esc(fmt)}`,
        body: `<div class="job-detail-task">${esc(plain)}</div>
          <div class="field-hint" style="margin-top:8px">
            类型：${esc(KIND_LABEL[a.kind] || a.kind || '变更')}${a.source ? ' · 来源：' + esc(a.source) : ''}
          </div>`,
        footer: `<span class="grow"></span><button class="btn primary" data-act="modal-close">关闭</button>`
      });
      return;
    }

    /* ---------- 侧栏：待办勾选 / 快捷入口管理 ---------- */
    case 'side-todo-done': {
      const i = +t.dataset.idx;
      const todo = DB.todos[i];
      if (!todo) return;
      mutate(() => { todo.done = true; },
        { activity: { text: `完成待办 <b>${esc(todo.t)}</b>`, kind: 'todo', color: '#218358' } });
      toast('已完成', 'ok');
      return;
    }
    case 'side-all-todos': {
      go('home');
      setTimeout(() => {
        const el = document.querySelector('.bottom-grid');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
      return;
    }
    case 'quick-manage': {
      const items = DB.apps || [];
      if (!items.length) return toast('还没有登记任何软件，先在项目页拖入快捷方式', 'err');
      const sel = new Set(DB.sidebarLaunch || []);
      openModal({
        title: '管理快捷入口',
        sub: '勾选要固定在左侧栏的程序；只影响显示，不影响程序本身',
        body: `<div class="quick-manage-list">
          ${items.map(a => `<label class="quick-manage-row">
            <input type="checkbox" data-app="${esc(a.n)}" ${sel.has(a.n) ? 'checked' : ''}>
            ${appTile(a.n, 22)}
            <span class="qm-name">${esc(a.displayName || a.n)}</span>
            <span class="qm-path">${esc(a.path ? String(a.path).split(/[\\/]/).pop() : '未绑定路径')}</span>
          </label>`).join('')}
        </div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="quick-manage-save">保存</button>`
      });
      return;
    }
    case 'quick-manage-save': {
      const m = document.querySelector('.modal');
      if (!m) return;
      const picked = Array.from(m.querySelectorAll('[data-app]'))
        .filter(x => x.checked).map(x => x.dataset.app);
      mutate(() => { DB.sidebarLaunch = picked.slice(0, 8); },
        { activity: { text: `固定 ${picked.length} 个快捷入口到左侧栏`, kind: 'edit', color: '#AD5700' } });
      closeModal();
      toast(`已固定 ${picked.length} 个（最多 8 个）`, 'ok');
      return;
    }

    case 'kb-open-materials': {
      if (!Bridge.desktop) return toast('浏览器模式无法打开本地文件夹', 'err');
      const target = rootDir() + '\\知识库材料';
      return openPath(target, '知识库材料');
    }
    case 'kb-import': {
      if (!Bridge.desktop) {
        openModal({
          title: '导入文献', body: `<p style="font-size:12px;line-height:1.8;color:var(--text-2)">浏览器模式下无法访问本地文件。请使用桌面端运行本程序，即可选择本地 PDF / 数据集导入。</p>`,
          footer: `<span class="grow"></span><button class="btn primary" data-act="modal-close">知道了</button>`
        });
        return;
      }
      const dir = await window.workspace.pickDirectory();
      if (!dir) return;
      mutate(() => {
        DB.kbDocs.unshift({ n: dir.split(/[\\/]/).pop() + '（新导入）', type: '数据', ext: 'dir', size: '—', date: new Date().toISOString().slice(0, 10), score: 0.7 });
      }, { activity: { text: `导入资料 <b>${esc(dir)}</b>`, kind: 'create', color: '#218358' } });
      toast('已加入知识库索引队列', 'ok'); return;
    }
    /* ---------- 内置浏览器（真实 webview） ---------- */
    case 'capture-page': {
      const page = webPage();
      if (!page || !page.url) return toast('当前没有打开的网页', 'err');
      mutate(() => {
        DB.kbDocs.unshift({
          n: page.title || page.url, type: '网页', ext: 'html',
          size: '网页', date: new Date().toISOString().slice(0, 10),
          score: 0.8, url: page.url
        });
      }, { activity: { text: `网页存入知识库：<b>${esc(page.title || page.url)}</b>`, kind: 'save', color: '#218358' } });
      toast('已存入知识库（含原始网址）', 'ok');
      return;
    }
    case 'web-tab': {
      const i = +t.dataset.idx;
      if (i === state.webActive) return;
      state.webActive = i;
      state.webError = null;
      const page = webPage();
      if (page && page.url && Bridge.webview) navigateWebview(page.url);
      renderBrowserChrome();
      return;
    }
    case 'web-tab-add': {
      state.webPages.push({ id: uid('w'), title: '新标签页', url: '' });
      state.webActive = state.webPages.length - 1;
      state.webError = null;
      renderBrowserChrome();
      const inp = document.getElementById('web-url');
      if (inp) { inp.focus(); inp.select(); }
      return;
    }
    case 'web-tab-close': {
      const i = +t.dataset.idx;
      if (state.webPages.length === 1) {
        state.webPages = [{ id: uid('w'), title: '起始页', url: '' }];
        state.webActive = 0;
      } else {
        state.webPages.splice(i, 1);
        if (i < state.webActive) state.webActive--;
        if (state.webActive >= state.webPages.length) state.webActive = state.webPages.length - 1;
      }
      state.webError = null;
      const page = webPage();
      if (page && page.url && Bridge.webview) navigateWebview(page.url);
      renderBrowserChrome();
      return;
    }
    case 'web-goto': {
      goWeb(t.dataset.url || '');
      return;
    }
    case 'web-home': {
      const page = webPage();
      if (page) { page.url = ''; page.title = '起始页'; }
      state.webError = null; state.webLoading = false;
      renderBrowserChrome();
      return;
    }
    case 'web-back':
      if (webviewEl) { try { webviewEl.goBack(); } catch (_) {} }
      setTimeout(refreshNavState, 120);
      return;
    case 'web-forward':
      if (webviewEl) { try { webviewEl.goForward(); } catch (_) {} }
      setTimeout(refreshNavState, 120);
      return;
    case 'web-reload':
      if (!Bridge.webview) return toast('真实网页浏览需要桌面端运行', 'err');
      if (!webviewEl) return;
      state.webError = null;
      if (!webPage().url) { renderBrowserChrome(); return; }
      try { webviewEl.reload(); } catch (_) {}
      return;
    case 'web-stop':
      if (webviewEl) { try { webviewEl.stop(); } catch (_) {} }
      state.webLoading = false;
      renderBrowserChrome();
      return;
    case 'web-open-external': {
      const url = t.dataset.url || webPage().url;
      if (!url) return toast('当前没有可打开的网址', 'err');
      if (Bridge.desktop) { window.open(url, '_blank'); toast('已用系统浏览器打开', 'ok'); }
      else { await Bridge.copy(url); toast('链接已复制，可在浏览器中打开', 'ok'); }
      return;
    }

    /* ---------- 撤销与写操作审计 ---------- */
    case 'undo-last': {
      const ok = undoLast();
      if (ok && document.querySelector('.modal-mask')) closeModal();
      return;
    }
    case 'undo-history': {
      const rows = undoStack.slice().reverse();
      openModal({
        title: '撤销历史',
        sub: `可撤销 ${rows.length} 步 · 最多保留 ${UNDO_LIMIT} 步`,
        body: rows.length
          ? `<div class="audit-list">${rows.map((it, i) => `<div class="audit-row">
              <span class="au-src ${esc(it.source)}">${esc(ORIGIN_LABEL[it.source] || it.source)}</span>
              <div class="au-body">
                <div class="au-t">${esc(it.label)}</div>
                <div class="au-meta">${esc(it.actor || '')} · ${new Date(it.at).toLocaleTimeString('zh-CN', { hour12: false })}</div>
              </div>
              ${i === 0 ? '<span class="chip accent">上一步</span>' : ''}
            </div>`).join('')}</div>`
          : `<div class="empty">${icon('undo')}<div>没有可撤销的操作</div></div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">关闭</button>
          <button class="btn primary" data-act="undo-last" ${rows.length ? '' : 'disabled'}>${icon('undo')}撤销最近一步</button>`
      });
      return;
    }
    case 'audit-view': {
      const list = (Array.isArray(DB.audit) ? DB.audit : []).filter(x => x.source !== 'ui');
      openModal({
        title: '写操作审计',
        sub: `内置 AI 助手与外部 Agent 的写操作 · 共 ${list.length} 条（最多保留 200 条）`,
        body: list.length
          ? `<div class="audit-list">${list.map(x => `<div class="audit-row">
              <span class="au-src ${esc(x.source)}">${esc(ORIGIN_LABEL[x.source] || x.source)}</span>
              <div class="au-body">
                <div class="au-t">${esc(x.label || x.tool)} ${x.ok ? '' : `<span class="chip rose">失败</span>`}</div>
                <div class="au-meta">${esc(x.at)} · ${esc(x.actor)} · <span class="mono">${esc(x.tool)}</span></div>
                ${x.args ? `<div class="au-args mono">${esc(x.args)}</div>` : ''}
                ${x.error ? `<div class="au-err">${esc(x.error)}</div>` : ''}
              </div>
            </div>`).join('')}</div>`
          : `<div class="empty">${icon('shield')}<div>还没有 Agent 写操作记录</div></div>`,
        footer: `<span class="grow"></span>
          ${list.length ? `<button class="btn danger" data-act="audit-clear">${icon('trash')}清空记录</button>` : ''}
          <button class="btn primary" data-act="modal-close">关闭</button>`
      });
      return;
    }
    case 'audit-clear': {
      mutate(() => { DB.audit = []; },
        { activity: { text: '清空 Agent 写操作审计', kind: 'delete', color: '#CE2C31' }, undo: false });
      closeModal();
      toast('审计记录已清空', 'ok');
      return;
    }

    /* ---------- 自动化 ---------- */
    case 'flow-toggle':
    case 'flow-run':
    case 'new-flow':
      toast('自动化流程已从侧栏收起，这个开关不会执行任何流程', 'err');
      return;
    case 'flow-log': {
      openModal({
        title: act === 'new-flow' ? '新建自动化流程' : '流程运行日志',
        sub: act === 'new-flow' ? '定义触发器与执行步骤' : '最近 4 次执行',
        body: act === 'new-flow'
          ? `${fText('n', '流程名称', '', { req: true, ph: '例如：周报自动生成' })}
             ${fText('steps', '步骤（逗号分隔）', '', { ph: '汇总变更, Agent 摘要, 邮件推送' })}`
          : `<div class="activity-list">${DB.activities.slice(0, 10).map(x => `<div class="activity-row">
              <span class="a-dot" style="background:${x.c}">${icon(x.i)}</span>
              <span class="a-txt">${x.t}</span><span class="a-time">${esc(x.time)}</span></div>`).join('')}</div>`,
        footer: `<span class="grow"></span><button class="btn" data-act="modal-close">关闭</button>
          ${act === 'new-flow' ? '<button class="btn primary" data-act="flow-create">创建流程</button>' : ''}`
      });
      return;
    }
    case 'flow-create': {
      closeModal();
      toast('自动化流程已从侧栏收起，不会创建一条看起来能跑的流程', 'err');
      return;
    }

    /* ---------- 设置 ---------- */
    case 'set-toggle': {
      const key = t.dataset.key;
      mutate(() => {
        DB.settings[key] = !DB.settings[key];
        if (key === 'ragEnabled') {
          if (DB.settings.ragEnabled) {
            const ep = String(DB.settings.ragEndpoint || '');
            if (!DB.settings.kbEngine || DB.settings.kbEngine === 'builtin' || DB.settings.kbEngine === 'none') {
              DB.settings.kbEngine = (!ep || ep === 'http://127.0.0.1:8000' || /:8765(\/|$)/.test(ep)) ? 'rag_snowz' : 'http';
            }
            if (DB.settings.kbEngine === 'rag_snowz' && (!ep || ep === 'http://127.0.0.1:8000')) {
              DB.settings.ragEndpoint = 'http://127.0.0.1:8765';
            }
          } else if (DB.settings.kbEngine === 'http' || DB.settings.kbEngine === 'rag_snowz') {
            DB.settings.kbEngine = 'builtin';
          }
        }
      });
      return;
    }
    case 'export-data': {
      await Bridge.copy(JSON.stringify(DB, null, 2));
      toast('全部数据已复制为 JSON，可直接粘贴保存', 'ok');
      return;
    }
    /* ---------- 数据备份 ---------- */
    case 'backup-now': {
      if (!Bridge.desktop) return toast('备份需要桌面端运行', 'err');
      const r = await Bridge.backupNow();
      if (!r || !r.ok) return toast(`备份失败：${esc((r && r.error) || '未知错误')}`, 'err');
      state.backup = await Bridge.backupInfo();
      render();
      logActivity(`手动备份数据 <b>${esc(r.name)}</b>`, 'save', '#218358');
      persist();
      toast(`已备份 · 共 ${r.count} 份（超出 7 份会自动清理最旧的）`, 'ok');
      return;
    }
    case 'backup-list': {
      if (!Bridge.desktop) return toast('备份需要桌面端运行', 'err');
      const info = await Bridge.backupInfo();
      state.backup = info;
      const items = info.items || [];
      openModal({
        title: '从备份恢复',
        sub: items.length ? `共 ${items.length} 份 · 保留最近 ${info.keep} 份` : '还没有备份',
        body: items.length
          ? `<div class="audit-list">${items.map(it => {
              const d = new Date(it.at);
              const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              return `<div class="audit-row">
                <span class="au-src ui">${Math.max(1, Math.round(it.size / 1024))} KB</span>
                <div class="au-body">
                  <div class="au-t">${esc(t)}</div>
                  <div class="au-meta mono">${esc(it.name)}</div>
                </div>
                <button class="btn sm" data-act="backup-restore-do" data-name="${esc(it.name)}">恢复</button>
              </div>`;
            }).join('')}</div>`
          : `<div class="empty" style="padding:18px">${icon('save')}<div>还没有备份<br>点下面的「立即备份」创建第一份</div></div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="backup-dir">${icon('folderOpen')}备份目录</button>
          <button class="btn" data-act="backup-now">${icon('save')}立即备份</button>
          <button class="btn primary" data-act="modal-close">关闭</button>`
      });
      return;
    }
    case 'backup-restore-do': {
      const name = t.dataset.name || '';
      confirmDialog({
        title: '从备份恢复', danger: true, okText: '确认恢复',
        message: `将用 <b>${esc(name)}</b> 覆盖当前数据。<br>恢复后界面会重新加载，当前未备份的改动会丢失。`,
        onOk: async () => {
          const r = await Bridge.backupRestore(name);
          if (!r || !r.ok) return toast(`恢复失败：${esc((r && r.error) || '未知错误')}`, 'err');
          setDB(await Bridge.load());
          if (!P(state.project)) state.project = (DB.projects[0] || {}).id || state.project;
          state.ragResults = null; state.ragMeta = null;
          render();
          toast(`已恢复到 ${esc(name)}`, 'ok');
        }
      });
      return;
    }
    case 'backup-dir': {
      const dir = (state.backup && state.backup.dir) || ((await Bridge.backupInfo()) || {}).dir;
      if (!dir) return toast('还没有备份目录', 'err');
      const r = await Bridge.openFolder(dir);
      if (r && r.ok) { toast('已打开备份目录', 'ok'); }
      else toast(`无法打开：${esc((r && r.error) || dir)}`, 'err');
      return;
    }
    case 'reset-data': {
      confirmDialog({
        title: '重置所有数据', danger: true, okText: '确认重置',
        message: '将清除本地保存的全部项目、任务、待办与设置，恢复到初始示例内容。<br>磁盘上的项目材料文件<b>不会</b>被删除。',
        onOk: async () => {
          await Bridge.reset();
          setDB(JSON.parse(JSON.stringify(SEED)));
          DB.settings = { ...SETTINGS_DEFAULT, rootDir: SEED.rootDir };
          state.project = 'tpms';
          persist(true); render();
          toast('已重置为初始数据', 'ok');
        }
      });
      return;
    }

    /* ---------- 其它 ---------- */
    /* ---------- 项目流程：阶段增删改（v2.8.2） ---------- */
    case 'flow-edit': {
      const p = P(t.dataset.id);
      if (!p) return;
      const rows = (p.nodes && p.nodes.length)
        ? p.nodes
        : ((p.flow && p.flow.length) ? p.flow.map(l => ({ l, s: 'todo', d: '' })) : [{ l: '', s: 'todo', d: '' }]);
      openModal({
        title: '编辑项目流程',
        sub: `${esc(p.displayName || p.name)} · 阶段名称、状态与日期都可改；至少保留一个阶段`,
        body: `<div class="flow-edit-list" data-flow-rows>
          ${rows.map(r => flowEditRow(r)).join('')}
        </div>
        <button class="btn sm" data-act="flow-row-add" style="margin-top:8px">${icon('plus')}添加阶段</button>
        <div class="field-hint" style="margin-top:8px">左侧上下箭头调整阶段顺序；状态里「进行中」只能有一个。保存后当前阶段与整体进度会自动跟着变。</div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-submit data-act="flow-edit-save" data-id="${p.id}">保存流程</button>`
      });
      return;
    }
    case 'flow-row-add': {
      const list = document.querySelector('[data-flow-rows]');
      if (!list) return;
      const div = document.createElement('div');
      div.innerHTML = flowEditRow({ l: '', s: 'todo', d: '' });
      list.appendChild(div.firstElementChild);
      const last = list.lastElementChild;
      if (last) last.querySelector('input')?.focus();
      return;
    }
    case 'flow-row-move': {
      const row = t.closest('.flow-edit-row');
      const list = document.querySelector('[data-flow-rows]');
      if (!row || !list) return;
      const dir = t.dataset.dir;
      if (dir === 'up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      else if (dir === 'down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
      return;
    }
    case 'flow-row-del': {
      const row = t.closest('.flow-edit-row');
      const list = document.querySelector('[data-flow-rows]');
      if (!row || !list) return;
      if (list.querySelectorAll('.flow-edit-row').length <= 1) return toast('至少要保留一个阶段', 'err');
      row.remove();
      return;
    }
    case 'flow-edit-save': {
      const p = P(t.dataset.id);
      const list = document.querySelector('[data-flow-rows]');
      if (!p || !list) return;
      const rows = Array.from(list.querySelectorAll('.flow-edit-row')).map(r => ({
        l: String((r.querySelector('[data-f="name"]') || {}).value || '').trim(),
        s: String((r.querySelector('[data-f="state"]') || {}).value || 'todo'),
        d: String((r.querySelector('[data-f="date"]') || {}).value || '').trim()
      })).filter(r => r.l);
      if (!rows.length) return toast('至少要有一个有名字的阶段', 'err');
      /* 只允许一个 current：保留第一个 */
      let seenCurrent = false;
      rows.forEach(r => {
        if (r.s === 'current') { if (seenCurrent) r.s = 'todo'; seenCurrent = true; }
      });
      applyFlowNodes(p, rows, `编辑项目流程 <b>${esc(p.displayName || p.name)}</b>（${rows.length} 个阶段）`);
      closeModal();
      toast(`流程已更新：${rows.length} 个阶段，进度 ${p.progress}%`, 'ok');
      return;
    }
    case 'flow-node': {
      const p = P(t.dataset.id);
      if (!p) return;
      const i = +t.dataset.idx;
      const nodes = flowNodesOf(p);
      const n = nodes[i];
      if (!n) return;
      const dirName = Object.keys(materialIndexOf(p.id))[i] || '';
      const dir = dirName ? projectDir(p) + '\\' + dirName : '';
      const stageTasks = DB.tasks.filter(x => x.p === p.id && (x.dir === dirName || String(x.t).includes(n.l)));

      openModal({
        title: `阶段 · ${esc(n.l)}`,
        sub: `${esc(p.displayName || p.name)} · 第 ${i + 1}/${nodes.length} 个阶段`,
        body: `<div class="field"><label>阶段名称</label>
            <input class="input" name="stageName" value="${esc(n.l)}" placeholder="例如：参数扫描"></div>
          <div class="field"><label>状态</label>
            <div class="seg" data-stage-seg>
              ${[['todo', '待开始'], ['current', '进行中'], ['done', '已完成']].map(([v, l]) =>
                `<button type="button" data-val="${v}" class="${n.s === v ? 'active' : ''}">${l}</button>`).join('')}
            </div>
            <input type="hidden" name="stageState" value="${esc(n.s)}"></div>
          <div class="field"><label>日期</label>
            <input class="input" name="stageDate" value="${esc(n.d)}" placeholder="如 10.28"></div>
          ${dir ? `<div class="field"><label>阶段材料目录</label>
            <div class="path-box"><span class="pb-ico">${icon('folder')}</span>
              <div class="pb-body"><div class="pb-name">${esc(dirName)}</div><div class="pb-path">${esc(dir)}</div></div>
              <div class="pb-actions"><button class="btn sm primary" data-act="open-abs" data-path="${esc(dir)}" data-label="${esc(dirName)}">${icon('folderOpen')}打开</button></div></div></div>` : ''}
          <div class="field"><label>该阶段任务</label>
            <div class="mat-list">${stageTasks.slice(0, 6).map(x => `<div class="mat-row" data-act="open-task" data-idx="${DB.tasks.indexOf(x)}">
              <span class="m-ico" style="background:#6E56CF">${icon('tasks')}</span>
              <div class="m-body"><div class="m-name">${esc(x.t)}</div><div class="m-meta">${esc(x.agent)} · ${esc(x.due)}</div></div>${stChip(x.st)}</div>`).join('') || '<span class="muted" style="font-size:11px">该阶段暂无任务</span>'}</div></div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">取消</button>
          <button class="btn primary" data-act="flow-stage-save" data-id="${p.id}" data-idx="${i}">保存阶段</button>`,
        onMount(modal) {
          const seg = modal.querySelector('[data-stage-seg]');
          const hidden = modal.querySelector('[name="stageState"]');
          if (!seg || !hidden) return;
          seg.addEventListener('click', e => {
            const b = e.target.closest('button[data-val]');
            if (!b) return;
            e.preventDefault();
            seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            hidden.value = b.dataset.val;
          });
        }
      });
      return;
    }
    case 'flow-stage-save': {
      const p = P(t.dataset.id);
      const i = +t.dataset.idx;
      const m = document.querySelector('.modal');
      if (!p || !m) return;
      const name = String((m.querySelector('[name="stageName"]') || {}).value || '').trim();
      if (!name) return toast('阶段名称不能为空', 'err');
      const state = String((m.querySelector('[name="stageState"]') || {}).value || 'todo');
      const date = String((m.querySelector('[name="stageDate"]') || {}).value || '').trim();

      const nodes = flowNodesOf(p).map(x => ({ l: x.l, s: x.s, d: x.d }));
      if (!nodes[i]) return;
      const before = nodes[i].l;
      nodes[i] = { l: name, s: state, d: date };
      /* 只允许一个「进行中」 */
      if (state === 'current') {
        nodes.forEach((x, j) => { if (j !== i && x.s === 'current') x.s = 'todo'; });
      }
      const r = applyFlowNodes(p, nodes, `阶段「${esc(before)}」→「${esc(name)}」· ${esc(FLOW_STATE_TEXT[state] || state)}`);
      closeModal();
      toast(`已保存：${esc(name)} · ${esc(FLOW_STATE_TEXT[state] || state)}<br><span class="muted">`
        + `${r.advanced ? `已自动把「${esc(r.advanced)}」接为进行中 · ` : ''}`
        + `进度 ${p.progress}%（${r.done}/${r.total} 个阶段完成）</span>`, 'ok');
      return;
    }
    case 'gantt-bar': toast(`<b>${esc(t.dataset.p)}</b> · ${esc(t.dataset.l)}`, 'ok'); return;
    case 'timeline-today': toast('已定位到今天', 'ok'); return;
    case 'all-activity': {
      /* 与首页一致：过滤掉切换/浏览类噪音，只留实质变更 */
      const list = activityList(60);
      const KIND = {
        create: '新建', edit: '修改', delete: '删除', save: '保存',
        flow: '流程', todo: '待办', run: '启动', agent: 'Agent'
      };
      openModal({
        title: '全部活动记录',
        sub: `${list.length} 条实质变更（切换工作区等不计入）`,
        body: `<div class="activity-list">${list.map(x => `<div class="activity-row">
            <span class="a-dot" style="background:${x.c}">${icon(x.i)}</span>
            <span class="a-txt">${x.t}</span>
            <span class="chip gray" style="flex:0 0 auto">${esc(KIND[x.kind] || '变更')}</span>
            <span class="a-time">${esc(x.time)}</span></div>`).join('') || '<div class="empty">暂无记录</div>'}</div>`,
        footer: `<span class="grow"></span><button class="btn" data-act="modal-close">关闭</button>`
      });
      return;
    }
    case 'notify': {
      const items = buildNotifications();
      openModal({
        title: '通知', sub: `根据当前项目状态实时生成（${items.length} 条）`,
        body: `<div class="col" style="gap:6px">
          ${items.map(n => `<div class="mat-row">
            <span class="m-ico" style="background:${n.c}">${icon(n.i)}</span>
            <div class="m-body"><div class="m-name">${esc(n.t)}</div>
            <div class="m-meta">${esc(n.s)}</div></div>
            ${n.alert ? '<span class="chip rose">待处理</span>' : ''}
          </div>`).join('')}
        </div>`,
        footer: `<span class="grow"></span>
          <button class="btn" data-act="modal-close">关闭</button>
          ${items.some(n => n.alert) ? `<button class="btn primary" data-act="notify-goto-tasks">去看任务</button>` : ''}`
      });
      return;
    }
    case 'notify-goto-tasks': closeModal(); state.taskFilter = 'all'; go('tasks'); return;
    case 'open-res': {
      const r = DB.resources.find(x => x.n === t.dataset.name);
      if (!r) return;
      return openPath(projectDir(r.p) + '\\' + r.dir + '\\' + r.n, r.n);
    }
  }
});

function setActiveTab(el) {
  const group = el.parentElement;
  if (!group) return;
  $$('.tab', group).forEach(x => x.classList.remove('active'));
  el.classList.add('active');
}

/* ---------- 输入 ---------- */
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'global-search') {
    state.search = el.value;
    renderSearchPanel();
    if (state.route === 'projects') {
      const only = $$('.projects-grid .proj-card');
      const q = state.search.toLowerCase();
      only.forEach(c => {
        const p = P(c.dataset.project);
        c.style.display = (!q || (p.name + p.subtitle + p.stage).toLowerCase().includes(q)) ? '' : 'none';
      });
    }
    return;
  }
  if (el.dataset && el.dataset.input === 'filter-projects') {
    const q = el.value.toLowerCase();
    $$('.projects-grid .proj-card').forEach(c => {
      const p = P(c.dataset.project);
      c.style.display = (!q || (p.name + p.subtitle + p.stage).toLowerCase().includes(q)) ? '' : 'none';
    });
    return;
  }
  if (el.id === 'kb-input') { state.q = el.value; state.ragResults = null; state.ragMeta = null; state.ragAnswer = null; return; }
  if (el.id === 'ai-input') { state.aiDraft = el.value; return; }
});

/* 搜索框回车 / ESC */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const s = document.getElementById('global-search');
    if (s) { s.focus(); s.select(); }
    return;
  }
  /* Ctrl/⌘ + Z 撤销上一步数据操作；在输入框里让浏览器自己处理文本撤销 */
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    e.preventDefault();
    undoLast();
    return;
  }
  if (e.key === 'Escape') {
    const sp = document.getElementById('search-panel');
    if (sp && sp.classList.contains('open')) { state.search = ''; renderSearchPanel(); }
    return;
  }
  if (e.key === 'Enter' && e.target.id === 'global-search') {
    const hits = searchAll(state.search);
    const first = document.querySelector('#search-panel .sp-row');
    if (first) first.click();
    else if (hits) toast('没有匹配的结果', 'err');
    return;
  }
  if (e.key === 'Enter' && e.target.id === 'kb-input') {
    const btn = document.querySelector('[data-act="kb-search"]');
    btn && btn.click();
  }
  if (e.key === 'Enter' && (e.target.id === 'web-url' || e.target.id === 'web-q')) {
    e.preventDefault();
    goWeb(e.target.value);
    return;
  }
  if (e.key === 'Enter' && e.target.id === 'ai-input' && !e.shiftKey) {
    e.preventDefault();
    const btn = document.querySelector('[data-act="ai-send"]');
    if (btn && !btn.disabled) btn.click();
  }
});

/* ---------- 下拉选择（设置项 / AI 配置 / AI 项目上下文） ---------- */
document.addEventListener('change', e => {
  const el = e.target;
  if (!el.dataset) return;
  const act = el.dataset.act;

  if (act === 'set-select') {
    const key = el.dataset.key, val = el.value;
    mutate(() => {
      DB.settings[key] = val;
      if (key === 'defaultWorkspace' && P(val)) {
        state.project = val;
        DB.workspace.project = P(val).name;
      }
    }, { activity: { text: `设置 <b>${esc(key)}</b> 改为 <b>${esc(val)}</b>`, kind: 'edit', color: '#AD5700' } });
    toast('设置已保存', 'ok');
    return;
  }

  if (act === 'ai-select') {
    const key = el.dataset.key;
    const val = key === 'temperature' ? parseFloat(el.value) : el.value;
    let applied = null;
    mutate(() => {
      DB.ai[key] = val;
      if (key === 'provider') {
        const preset = (state.aiProviders || []).find(p => p.id === val);
        if (preset && preset.baseUrl) {
          DB.ai.baseUrl = preset.baseUrl;
          DB.ai.model = preset.model;
          applied = preset;
        }
      }
    }, { activity: { text: `AI 配置 <b>${esc(key)}</b> 已更新`, kind: 'edit', color: '#AD5700' } });
    toast(applied ? `已套用 ${applied.label} 推荐的 Base URL 与模型` : 'AI 配置已保存', 'ok');
    return;
  }

  if (act === 'ai-switch-project') {
    const id = el.value;
    if (!P(id)) return;
    state.project = id;
    DB.workspace.project = P(id).name;
    persist();
    render();
    return;
  }
});

/* ---------- 路由 ---------- */
/* Sprint A：已删除的侧栏入口 → 新位置（旧 hash/深链仍可用） */
const ROUTE_ALIAS = {
  projects: 'home', tasks: 'project', timeline: 'home', automation: 'home',
  dock: 'project', agents: 'ai'
  /* browser 保留独立路由：入口从侧栏移到 AI 助手的「浏览」模式 */
};

function consumeRoute(raw) {
  if (raw === 'agents') state.aiMode = 'assign';
  if (raw === 'browser') state.aiMode = 'browser';
  if (raw === 'dock') state.projectTab = 'software';
  if (raw === 'tasks') state.projectTab = 'tasks';
  return ROUTE_ALIAS[raw] || raw;
}

function go(route) {
  route = consumeRoute(route);
  state.route = VIEWS[route] ? route : 'home';
  if (location.hash.slice(1) !== state.route) location.hash = state.route;
  /* 记住所在页面，供「启动时恢复上次页面」使用 */
  if (DB.settings && DB.settings.lastRoute !== state.route) {
    DB.settings.lastRoute = state.route;
    persist();
  }
  render();
}
/* Sprint B：拖拽导入的落点高亮与投放（data-drop 标记的区块） */
document.addEventListener('dragover', e => {
  const z = e.target.closest('[data-drop]');
  if (!z) return;
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
  z.classList.add('dz-over');
});
document.addEventListener('dragleave', e => {
  const z = e.target.closest('[data-drop]');
  if (z && !z.contains(e.relatedTarget)) z.classList.remove('dz-over');
});
document.addEventListener('drop', async e => {
  const z = e.target.closest('[data-drop]');
  if (!z) return;
  e.preventDefault();
  z.classList.remove('dz-over');
  const kind = z.dataset.drop;
  if (kind === 'proj-app') return importDroppedApps(z, e.dataTransfer && e.dataTransfer.files);
});

window.addEventListener('hashchange', () => {
  const raw = location.hash.slice(1);
  const r = consumeRoute(raw);
  if (raw && r !== raw) {
    if (location.hash.slice(1) !== r) location.hash = r;
    return;
  }
  if (VIEWS[r] && r !== state.route) { state.route = r; render(); }
});

const _viewEl = document.getElementById('view');
_viewEl && _viewEl.addEventListener('click', e => {
  const sp = document.getElementById('search-panel');
  if (!e.target.closest('.search-wrap')) renderSearchPanel();
}, true);

/* ==========================================================================
   对外 API 桥接
   供主进程的本地 HTTP 服务调用。外部 Agent（Codex / WorkBuddy / Claude 等）
   的读写全部经这里落到同一套工具实现上，因此改动会立即反映在界面上，
   不会出现「文件里改了、界面还是旧的」这种两份状态。
   ========================================================================== */
window.__RW_API__ = async function (req) {
  try {
    const tool = req && req.tool;
    const rawArgs = (req && req.args) || {};
    if (!tool || typeof tool !== 'string') return { ok: false, error: '缺少 tool 参数' };

    /* 内部专用：把工具清单交给主进程（MCP Server 依赖它） */
    if (tool === '__list_tools__') {
      return {
        ok: true,
        count: AI_TOOLS.length,
        tools: AI_TOOLS.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        }))
      };
    }

    /* 内部专用：给 /api/health 提供真实统计 */
    if (tool === '__diag__') {
      const eng = (DB.settings && DB.settings.kbEngine) || 'builtin';
      return {
        ok: true,
        tools_count: AI_TOOLS.length,
        projects_count: DB.projects.length,
        tasks_count: DB.tasks.length,
        knowledge_registered: (DB.kbDocs || []).length,
        /* 向量条数只认通用 HTTP 引擎的上报。RAG_Snowz 是全文检索，文档/片段另计，避免再把 0 当成“没接上”。 */
        knowledge_indexed: eng === 'http' && state.rag && state.rag.status === 'ok' ? (state.rag.indexed || 0) : 0,
        knowledge_docs: eng === 'rag_snowz' && state.rag && state.rag.status === 'ok' ? (state.rag.docs || 0) : 0,
        knowledge_chunks: eng === 'rag_snowz' && state.rag && state.rag.status === 'ok' ? (state.rag.chunks || 0) : 0,
        knowledge_engine: eng,
        last_error: state.lastApiError || '',
        version: (state.update && state.update.version) || ''
      };
    }

    /* dry_run 统一网关：字符串 "true" 也算预览。写工具在这里返回，不进 executeTool。 */
    if (typeof isDryRun === 'function' && isDryRun(rawArgs) && !/^(get_|list_|search_)/.test(tool)) {
      return dryRunResult(tool, rawArgs);
    }

    /* 防原型链污染：只允许调用显式登记的工具 */
    if (!Object.prototype.hasOwnProperty.call(AI_TOOL_IMPL, tool)) {
      return { ok: false, error: `未知操作「${tool}」。可用：${Object.keys(AI_TOOL_IMPL).join('、')}` };
    }

    const args = { ...rawArgs };

    /* project 参数用于临时指定操作对象，不改变用户当前工作区。
       注意：不能删掉 args.project —— create_project / delete_project 需要它作为目标。 */
    let restore = null;
    if (args.project && tool !== 'switch_project' && tool !== 'create_project' && tool !== 'delete_project') {
      const p = DB.projects.find(x => x.id === args.project || x.name === args.project);
      if (p && p.id !== state.project) { restore = state.project; state.project = p.id; }
    }

    /* 外部调用的写操作都记成「外部 Agent」，并带上调用方标识，便于审计追溯 */
    const prevOrigin = setOrigin({ source: 'agent', actor: String((req && req.client) || '外部 Agent') });
    let result;
    try {
      result = await executeTool(tool, args);
    } finally {
      setOrigin(prevOrigin);
    }

    if (restore) state.project = restore;

    /* 外部写入后同步界面；纯查询也会刷新，代价很低 */
    if (result && result.ok !== false) render();

    return result == null ? { ok: false, error: '工具无返回' } : result;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
};

/* ==========================================================================
   多设备同步：结果落地与冲突处理
   ========================================================================== */
async function finishSync(r) {
  if (r.applied) {
    /* 合并结果已经写回本机文件，重新载入内存数据 */
    try {
      const fresh = await Bridge.load();
      if (fresh) setDB(fresh);
    } catch (_) {}
    if (!P(state.project)) state.project = (DB.projects[0] || {}).id || '';
    DB.workspace.project = (P(state.project) || {}).name || '';
  }
  try { state.sync = await Bridge.syncInfo(); } catch (_) {}
  try { state.handoff = await Bridge.handoffInfo(); } catch (_) {}
  try { state.backup = await Bridge.backupInfo(); } catch (_) {}
  render();

  if (!r.applied) {
    if (r.message) toast(esc(r.message), 'ok');
    return;
  }
  const s = r.stats || {};
  const bits = [];
  if (s.added) bits.push(`新增 ${s.added}`);
  if (s.updated) bits.push(`更新 ${s.updated}`);
  if (s.removed) bits.push(`删除 ${s.removed}`);
  if (r.message) toast(esc(r.message), 'ok');
  else if (r.kind === 'handoff') {
    const from = (r.from && r.from.deviceName) ? `　来自「${esc(r.from.deviceName)}」` : '';
    if (r.sameDevice) toast('这份数据包是本机自己导出的，内容和本地一致，没有改动', 'ok');
    else toast(`导入完成${bits.length ? ' · ' + bits.join(' · ') : ' · 没有变化'}${from}`, 'ok');
  } else {
    const modeText = { merge: '合并', local: '以本机为准', remote: '以云端为准' }[r.prefer] || '合并';
    toast(`同步完成（${modeText}）${bits.length ? ' · ' + bits.join(' · ') : ' · 没有变化'}` +
      `${r.peers ? ' · ' + r.peers + ' 台设备' : ''}`, 'ok');
  }
  if (r.conflicts && r.conflicts.length) {
    const n = r.conflicts.length;
    toast(`本次有 ${n} 条冲突按你的选择处理${r.force ? '（已确认）' : ''}`
      + (r.conflictBackup ? `<br><span class="muted">两版都已备份：${esc(r.conflictBackup)}</span>` : ''), 'ok');
  }
  if (r.broken && r.broken.length) toast(`有 ${r.broken.length} 份设备副本读不了，已跳过：${esc(r.broken.join('、'))}`, 'err');
}

/* 同步方式：每次同步前必须确认一次（用户明确要求不记忆） */
function openSyncMode() {
  const s = state.sync || {};
  const peers = Array.isArray(s.peers) ? s.peers.length : 0;
  const at = s.lastSyncAt ? new Date(s.lastSyncAt) : null;
  const p2 = n => String(n).padStart(2, '0');
  const when = at
    ? `${p2(at.getMonth() + 1)}-${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}`
    : '还没同步过';
  const counts = `本机 ${DB.projects.length} 个项目 · ${DB.tasks.length} 条任务 · ${DB.todos.length} 条待办`;

  openModal({
    title: '同步方式',
    sub: '每次同步都确认一次，不会记住上次的选择',
    body: `<div class="conflict-note">${icon('alert')}
        <span>只有「两台都改过同一条记录」时才需要你拿主意；单边的新增和修改会照常合并进来。</span></div>
      <div class="sync-mode-list">
        <button class="sync-mode recommend" data-act="sync-go" data-prefer="merge">
          <b>合并（推荐）</b>
          <span>逐条比对，只有两边都改过同一条时才弹窗让你逐条选</span>
        </button>
        <button class="sync-mode" data-act="sync-go" data-prefer="local">
          <b>以本机为准</b>
          <span>冲突时保留本机版本；云端那一版自动备份到本机 sync\history</span>
        </button>
        <button class="sync-mode" data-act="sync-go" data-prefer="remote">
          <b>以云端为准</b>
          <span>冲突时采用云端版本；本机这一版自动备份到本机 sync\history</span>
        </button>
      </div>
      <div class="field-hint" style="margin-top:10px">
        ${esc(counts)}<br>
        ${peers ? `${peers} 台其它设备` : '暂无其它设备'} · 上次同步 ${esc(when)}
      </div>`,
    footer: `<span class="grow"></span><button class="btn" data-act="modal-close">取消</button>`
  });
}

function openSyncConflicts(res, opts = {}) {
  const isHandoff = !!opts.handoff;
  const list = res.conflicts || [];
  const p2 = n => String(n).padStart(2, '0');
  const kindText = c => c.kind === 'delete-edit'
    ? (c.deletedOn === 'local' ? '本地已删除，对方有修改' : '对方已删除，本地有修改')
    : '两边都改了';
  const show = v => {
    if (v === undefined || v === null) return '（无）';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
    return String(v).slice(0, 60);
  };

  const body = `<div class="conflict-note">${icon('alert')}
      ${isHandoff
        ? '这台设备和导入的数据包都改过下面这些记录。<b>选定之后才会写入，没有选的部分保持「本地」。</b>'
        : '两台设备都改过下面这些记录。<b>每次同步都会重新询问，不会记住上次的选择</b>；' +
          '选定后只对这一次生效，没选的部分保持「本地」。被替换掉的另一版会自动备份到本机 ' +
          '<span class="mono">sync\\history</span>。'}</div>
    <div class="conflict-list">
      ${list.map(c => `
        <div class="conflict" data-id="${esc(c.id)}">
          <div class="cf-head">
            <span class="chip ${c.kind === 'delete-edit' ? 'amber' : 'violet'}">${c.kind === 'delete-edit' ? '删除冲突' : '修改冲突'}</span>
            <b>${esc(c.label || c.key)}</b>
            <span class="grow"></span>
            <span class="muted" style="font-size:10px">${esc(kindText(c))}</span>
          </div>
          ${c.kind === 'edit' && (c.fields || []).length ? `<div class="cf-fields">
            <div class="cf-row cf-head-row"><span class="cf-k"></span><span class="cf-v">本地</span><span class="cf-v">对方</span></div>
            ${(c.fields || []).slice(0, 4).map(f => `<div class="cf-row">
              <span class="cf-k">${esc(f)}</span>
              <span class="cf-v local">${esc(show(c.local && c.local[f]))}</span>
              <span class="cf-v remote">${esc(show(c.remote && c.remote[f]))}</span>
            </div>`).join('')}
          </div>` : ''}
          <div class="seg cf-seg" data-cf="${esc(c.id)}">
            <button class="active" data-val="local">用本地</button>
            <button data-val="remote">用对方</button>
          </div>
        </div>`).join('')}
    </div>`;

  openModal({
    title: `${isHandoff ? '导入冲突' : '同步冲突'}（${list.length} 项）`,
    sub: '逐条选择以哪边为准；选完才写入本机',
    body,
    footer: `<button class="btn sm" data-act="sync-choose-all" data-side="local">全部用本地</button>
      <button class="btn sm" data-act="sync-choose-all" data-side="remote">全部用对方</button>
      <span class="grow"></span>
      <button class="btn" data-act="modal-close">取消</button>
      <button class="btn primary" data-act="${isHandoff ? 'handoff-apply' : 'sync-apply'}">${isHandoff ? '应用并完成导入' : '应用并完成同步'}</button>`,
    onMount(modal) {
      if (isHandoff && res.from && res.from.file) modal.dataset.handoffFile = res.from.file;
      modal.querySelectorAll('.cf-seg').forEach(seg => {
        seg.addEventListener('click', e => {
          const b = e.target.closest('button[data-val]');
          if (!b) return;
          e.preventDefault();
          seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        });
      });
    }
  });
}

/* ==========================================================================
   启动引导
   ========================================================================== */
async function launchApp(name) {
  const a = APP(name);
  if (!a) return;
  if (!Bridge.desktop) {
    toast(`浏览器模式无法启动本地程序。<br>请用桌面端运行：<span class="mono">cd desktop && npm start</span>`, 'err');
    return;
  }
  if (a.kind === 'exe' && !a.path) {
    return toast(`<b>${esc(name)}</b> 还没有绑定程序路径。<br>到「设置 → 科研工具链」点「更改」选择安装位置。`, 'err');
  }
  toast(`正在启动 <b>${esc(name)}</b>…`, 'ok');
  const r = await window.workspace.launchApp({ name, execPath: a.path, args: a.args || [] });
    if (r.ok) {
    mutate(() => {
      a.run = true;
      if (!DB.workspace.running.includes(name)) DB.workspace.running.push(name);
    }, { activity: { text: `启动 <b>${esc(name)}</b> (PID ${r.pid})`, kind: 'run', color: '#C9256B' }, undo: false });
    toast(`<b>${esc(name)}</b> 已启动 · PID ${r.pid}`, 'ok');
  } else {
    toast(esc(r.error).replace(/\n/g, '<br>'), 'err');
  }
}

async function boot() {
  const saved = await Bridge.load();
  /* 没有数据文件 = 全新安装：空工作区，只有模板 */
  setDB(saved || freshData());

  /* 全新安装立刻落盘一份：账户门需要数据文件才能写入身份，
     不先落盘会出现「注册要求先初始化 / 账户门又挡住初始化入口」的死锁 */
  if (!saved && Bridge.desktop) {
    try { await Bridge.save(DB); } catch (_) {}
  }

  /* 老数据升级：补完稳定 id 后立刻落盘一次，避免每次启动重算 */
  try {
    if (saved && typeof _lastMigrateInfo !== 'undefined' && _lastMigrateInfo.idsAdded > 0) persist(true);
  } catch (_) {}

  const h = location.hash.slice(1);
  const resolved = h ? consumeRoute(h) : '';
  if (resolved && VIEWS[resolved]) state.route = resolved;
  else if (DB.settings.resumeLast && DB.settings.lastRoute) {
    const last = consumeRoute(DB.settings.lastRoute);
    if (VIEWS[last]) state.route = last;
  }
  if (h && resolved && resolved !== h) location.hash = resolved;
  const def = DB.settings.defaultWorkspace;
  if (P(def)) state.project = def;
  if (!P(state.project) && DB.projects.length) state.project = DB.projects[0].id;
  if (!P(state.project)) state.project = '';

  render();

  if (Bridge.desktop) {
    /* 真实进程同步：初始没有任何工作台拉起的进程 */
    DB.apps.forEach(a => { if (a.kind === 'exe') a.run = null; });
    DB.workspace.running = [];
    await syncRunning();
    if (DB.settings.rootDir && !DB.settings.structureCreated) await rebuildStructure(true);

    /* AI 能力探测：服务商列表与密钥状态（密钥明文始终留在主进程） */
    try {
      state.aiProviders = await Bridge.aiProviders();
      state.aiKey = await Bridge.aiKeyState();
      state.apiInfo = await Bridge.apiInfo();
      const conn = await Bridge.connScan();
      if (conn && conn.clients) state.connClients = conn.clients;
    } catch (_) {}

    /* 本机标识 */
    try { state.device = await Bridge.deviceInfo(); } catch (_) {}

    /* 应用内更新：是否便携版、更新源 */
    try { state.update = await Bridge.updateInfo(); } catch (_) {}

    /* 账户状态（身份 / 本机密码 / 云端绑定）—— 决定要不要盖账户门 */
    try {
      authSt().status = await Bridge.accountStatus();
      authSt().ready = true;
      if (authSt().status && authSt().status.hasAccount) authSt().step = 'done';
    } catch (_) {}

    /* 备份状态：直接读磁盘上的副本列表 */
    try { state.backup = await Bridge.backupInfo(); } catch (_) {}

    /* 多设备同步状态（目录、上次同步、其它设备） */
    try { state.sync = await Bridge.syncInfo(); } catch (_) {}

    /* 交接文件：上次导出/导入时间 */
    try { state.handoff = await Bridge.handoffInfo(); } catch (_) {}

    /* 外部 RAG：读令牌状态；已启用则后台探测一次（不阻塞启动） */
    try {
      state.ragToken = await Bridge.ragState();
      if (DB.settings.ragEnabled || DB.settings.kbEngine === 'rag_snowz') {
        const bootCfg = ragClientConfig(DB.settings);
        Bridge.ragHealth({ endpoint: bootCfg.endpoint, engine: bootCfg.engine }).then(h => {
          applyRagHealth(h);
          if (state.route === 'knowledge' || state.route === 'settings') render();
        }).catch(() => {});
      }
    } catch (_) {}
    render();
  } else {
    try { state.apiInfo = await Bridge.apiInfo(); } catch (_) {}
    DB.workspace.running = DB.apps.filter(a => a.run).map(a => a.n);
    render();
  }
  window.__BOOTED__ = true;
}

boot();
