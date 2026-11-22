'use strict';

(function () {
  const api = window.workspace?.full;
  if (!api?.enabled) return;

  const routes = [
    ['dashboard', 'home', '工作总览'], ['projects-center', 'grid', '项目中心'], ['graph', 'layers', '知识图谱'],
    ['notes', 'book', '知识工作区'], ['materials', 'folder', '材料与成果'], ['activity', 'tasks', '任务与活动']
  ];
  const labels = Object.fromEntries(routes.map(([key, , label]) => [key, label]));
  const sourceNames = { workspace: '项目与任务', rpm: '项目材料', vault: '知识笔记', knowledge: '知识图谱' };
  const taskLabels = { todo: '待处理', doing: '进行中', review: '待复核', done: '已完成' };
  const moduleViews = new Set([...Object.keys(labels), 'project']);
  const notes = { projectId: '', path: '', mode: 'split', filter: '', list: null, file: null, text: '', dirty: false, conflict: false, busy: false, versions: null, message: '' };
  const materials = { projectId: '', filter: '', query: '', focusId: '', selected: '', rows: new Map(), request: '', generation: 0,
    browse: false, category: '', offset: 0, categories: [] };
  const materialPageSize = 30;
  const materialCategories = {
    '00_Project_Management': '项目管理', '01_Planning': '计划', '02_References': '参考资料',
    '03_Design_and_Development': '设计开发', '04_Models_and_Assets': '模型资源', '05_Data': '数据',
    '06_Experiments_and_Execution': '实验与执行', '07_Analysis': '分析', '08_Images_and_Media': '图像与媒体',
    '09_Documents': '工作文档', '10_Deliverables': '交付成果', '99_Archive': '历史归档'
  };
  const activity = { projectId: '', status: 'all' };
  let projectTab = 'overview';
  let graphTarget = null;
  const searchResults = new Map();
  let searchRequest = 0;
  let codexRuns = [];
  let pendingTakeovers = [];
  let takeoverListRequest = 0;
  let codexLoadState = 'loading';
  let codexListRequest = 0;
  let codexUpdateTimer;
  const codexPendingRequests = new Map();
  const closedNoteFolders = new Set();

  function w(name, value, attributes = '') {
    const extraClass = /class="([^"]+)"/.exec(attributes)?.[1] || '';
    return '<button type="button" class="fw-button ' + extraClass + '" data-full="' + name + '" value="' +
      esc(value) + '" ' + attributes.replace(/class="[^"]+"/, '') + '>';
  }
  const btn = (name, value, label, attr = '') => w(name, value, attr) + esc(label) + '</button>';
  const routeBtn = (route, label) => '<button type="button" class="fw-button" data-route="' + route + '">' + esc(label) + '</button>';
  const empty = text => '<p class="fw-empty">' + esc(text) + '</p>';
  const panel = (title, contents, control = '') => '<section class="fw-panel"><div class="fw-panelhead"><h2>' + esc(title) + '</h2>' + control + '</div>' + contents + '</section>';
  const heading = (title, sub = '', tools = '') => '<header class="fw-heading"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div><div class="fw-actions">' + tools + '</div></header>';
  const page = html => '<div class="fw-page">' + html + '</div>';
  const statusText = text => '<p class="fw-status" role="status">' + esc(text) + '</p>';
  const reason = result => result?.message || result?.error || result?.code || '操作失败';
  const projectName = id => projName(P(id)) || '未关联项目';
  const when = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  };

  function sidebar() {
    const selected = state.route === 'project' ? 'projects-center' : state.route;
    return '<aside class="fw-nav"><div class="fw-brand"><span aria-hidden="true">' + icon('flask') + '</span><strong>科研工程工作台</strong></div>' +
      '<nav aria-label="工作台导航">' + routes.map(([key, image, label]) =>
        '<button type="button" data-route="' + key + '" aria-label="' + esc(label) + '" ' + (selected === key ? 'aria-current="page"' : '') + '>' + icon(image) + '<span>' + esc(label) + '</span></button>'
      ).join('') + '</nav><div class="fw-navfoot">' + w('config', '', 'aria-label="设置与数据"') + icon('settings') + '<span>设置与数据</span></button></div></aside>';
  }

  function topbar() {
    return '<header class="fw-top"><div class="fw-crumb">科研工程工作台 <span aria-hidden="true">/</span> <strong>' +
      esc(labels[state.route] || (state.route === 'project' ? '项目中心' : '工作台')) + '</strong></div>' +
      w('search', '', 'id="fw-search-open" aria-keyshortcuts="Control+k"') + icon('search') + '全局搜索 <kbd>Ctrl K</kbd></button></header>';
  }

  function statusbar() {
    return '';
  }

  function taskRow(task, includeProject = true) {
    return w('task', task.id, 'class="fw-row-button"') + '<span><strong>' + esc(task.t) + '</strong><small>' +
      (includeProject ? esc(projectName(task.p)) + ' · ' : '') + esc(parseTaskDate(task.due).label) +
      '</small></span><span>' + stChip(task.st) + '</span></button>';
  }

  function projectCard(project, concise = false) {
    const tasks = DB.tasks.filter(task => task.p === project.id);
    const complete = tasks.filter(task => task.st === 'done').length;
    const mile = milestoneStats(project);
    const percent = Number.isFinite(mile.percent) ? mile.percent : null;
    return w('project', project.id, 'class="fw-project-card"') + '<span class="fw-project-icon">' + icon('folder') + '</span>' +
      '<span class="fw-project-content"><strong>' + esc(projName(project)) + '</strong><small>' + esc(project.stage || '阶段未设置') +
      ' · ' + esc(mile.label || '无里程碑') + '</small>' +
      (!concise && project.desc ? '<span class="fw-description">' + esc(stripTags(project.desc)) + '</span>' : '') +
      (percent === null ? '' : '<progress aria-label="里程碑完成度" value="' + percent + '" max="100"></progress>') +
      '<small>' + complete + ' / ' + tasks.length +
      ' 项任务完成</small>' + (api.codex && rpmId(project) ?
        '<small class="fw-project-pending" data-fw-codex-summary data-fw-codex-pending-project="' + esc(project.id) + '" hidden></small>' : '') +
      '</span></button>';
  }

  function recentActivities(projectId = '', count = 8, taskId = '') {
    const records = (DB.activities || []).filter(item => (!projectId || item.projectId === projectId) &&
      (!taskId || item.objectId === taskId)).slice(0, count);
    return records.length ? '<ol class="fw-timeline">' + records.map(record =>
      '<li><span>' + esc(stripTags(record.t || record.text || record.title || record.label || '活动记录')) + '</span><small>' +
      esc(when(record.at || record.time || record.date)) + '</small></li>'
    ).join('') + '</ol>' : empty(taskId ? '暂无此任务的活动记录' : '暂无活动记录');
  }

  function outcomeRows(projectId = '', { task, limit = Infinity, manage = false } = {}) {
    const linked = task && Array.isArray(task.outcomeIds) ? new Set(task.outcomeIds) : new Set();
    const outcomes = (DB.outcomes || []).filter(row => row && Array.isArray(row.project_ids) &&
      (!projectId || row.project_ids.includes(projectId)) && (manage || row.current !== false) &&
      (!task || linked.has(row.id))).slice(0, limit);
    const status = { draft: '草稿', review: '待复核', confirmed: '已确认', submitted: '已提交' };
    return outcomes.map(row => {
      const p = P(projectId || row.project_ids.find(id => P(id)));
      if (!p) return '';
      const file = typeof outcomeOpenPathOf === 'function' ? outcomeOpenPathOf(row, p) : row.file;
      const details = [projectName(p.id), status[row.status], row.version, row.current === false && '历史版本'].filter(Boolean);
      return '<div class="fw-record-row"><div><strong>' + esc(row.title || '未命名成果') + '</strong><small>' +
        esc(details.join(' · ')) + '</small></div><div class="fw-actions">' +
        (file ? '<button type="button" class="fw-button" data-act="open-abs" data-path="' + esc(file) + '" data-label="' +
          esc(row.title || '成果') + '">打开原件</button>' : '') +
        (task ? btn('task-unlink-outcome', row.id, '移除关联', 'data-task-id="' + esc(task.id) + '"') :
          manage ? '<button type="button" class="fw-button" data-act="unlink-outcome" data-id="' + esc(row.id) +
            '" data-pid="' + esc(p.id) + '">取消登记</button>' : '') + '</div></div>';
    }).join('') || empty(task ? '暂无关联成果' : '暂无已登记成果');
  }

  function dashboard() {
    const tasks = DB.tasks;
    const rank = task => task.st === 'review' ? 0 : task.pri === 'high' ? 1 : task.st === 'doing' ? 2 : 3;
    const priority = tasks.filter(task => task.st !== 'done').sort((a, b) => rank(a) - rank(b)).slice(0, 6);
    const todos = (DB.todos || []).map((todo, index) => ({ todo, index })).filter(({todo}) => !todo.done);
    const counts = [['待处理', 'todo'], ['进行中', 'doing'], ['待复核', 'review'], ['已完成', 'done']];
    const stats = '<div class="fw-stats">' + counts.map(([label, status]) =>
      w('task-filter', status, 'class="fw-stat"') + '<span>' + label + '</span><strong>' +
      tasks.filter(t => t.st === status).length + '</strong></button>'
    ).join('') + '</div>';
    const todoRows = todos.slice(0, 8).map(({todo, index}) => '<div class="fw-record-row"><div><strong>' +
      esc(todo.t) + '</strong><small>' + esc([todo.projectId && projectName(todo.projectId), parseTaskDate(todo.due).label].filter(Boolean).join(' · ')) +
      '</small></div><div class="fw-actions"><button type="button" class="fw-button" data-act="edit-todo" data-idx="' + index +
      '">编辑</button><button type="button" class="fw-button" data-act="toggle-todo" data-idx="' + index +
      '" aria-label="完成待办 ' + esc(todo.t) + '">完成</button></div></div>').join('');
    const todoTools = btn('all-todos', '', '全部待办') +
      '<button type="button" class="fw-button" data-act="new-todo">' + icon('plus') + '新增待办</button>';
    return page(heading('工作总览', '', routeBtn('projects-center', '查看项目')) + takeoverQueue() + stats + '<div class="fw-two">' +
      '<div class="fw-stack">' +
      panel('我的待办', todoRows || empty('暂无待办'), '<div class="fw-actions">' + todoTools + '</div>') +
      panel('优先任务', priority.map(task => taskRow(task)).join('') || empty('暂无待处理任务'),
        btn('task-filter', 'all', '全部任务')) + '</div><div class="fw-stack">' +
      panel('项目进度', DB.projects.slice(0, 5).map(p => projectCard(p, true)).join('') || empty('暂无项目')) +
      panel('近期成果', outcomeRows('', { limit: 4 }), routeBtn('materials', '查看材料与成果')) + '</div>' +
      panel('近期工作', recentActivities()) + '</div>');
  }

  function projectsCenter() {
    return page(heading('项目中心', DB.projects.length ? DB.projects.length + ' 个项目' : '',
      btn('takeover', '', '接管已有项目') +
      '<button type="button" class="fw-button prominent" data-act="new-project">' + icon('plus') + '新建项目</button>') +
      takeoverQueue() + (DB.projects.length ? '<div class="fw-project-list">' + DB.projects.map(p => projectCard(p)).join('') + '</div>' :
        panel('项目', empty('可以新建项目、接管已有项目目录，或在设置中导入工作台记录。'))));
  }

  function project(id, tab = 'overview') {
    if (!P(id)) return;
    state.project = id;
    projectTab = tab;
    state.taskFilter = 'all';
    go('project');
  }

  function rpmId(project) {
    if (!project) return '';
    return MaterialSource.bindingOf(project, DB.settings, project.id).rpmProjectId;
  }

  function projectSummary(project) {
    const schedule = scheduleView(project);
    const binding = MaterialSource.bindingOf(project, DB.settings, project.id);
    const goal = project.goal || project.intro || project.desc;
    const direction = project.subtitle || project.direction;
    return panel('研究目标', (direction ? '<p class="fw-kicker">' + esc(stripTags(direction)) + '</p>' : '') +
      (goal ? '<p class="fw-prose">' + esc(stripTags(goal)) + '</p>' : empty('尚未填写研究目标')) +
      '<div class="fw-source-state">' + [ownerView(project).label, schedule.label].filter(Boolean).map(value =>
        '<span class="fw-tag">' + esc(value) + '</span>').join('') + '</div>' +
      '<details class="fw-material-meta"><summary>目录与连接</summary><dl><dt>项目目录</dt><dd>' +
      esc(binding.rpmRoot || (binding.rpmProjectId ? '已绑定，目录待核对' : '尚未绑定')) +
      '</dd></dl><div class="fw-actions">' + btn('bind', project.id, rpmId(project) ? '管理项目连接' : '绑定已有登记') +
      btn('takeover', project.id, '接管已有目录') + '</div></details>');
  }

  function projectDetail() {
    const p = P(state.project);
    if (!p) return projectsCenter();
    const tasks = DB.tasks.filter(task => task.p === p.id);
    const openTasks = tasks.filter(task => task.st !== 'done');
    const tabs = [['overview', '概况'], ['tasks', '任务'], ['notes', '知识笔记'], ['materials', '材料与成果'], ['activity', '活动']];
    const makeTask = '<button type="button" class="fw-button prominent" data-act="new-task" data-p="' + esc(p.id) + '">' + icon('plus') + '新建任务</button>';
    const materialControl = btn('project-materials', p.id, '浏览项目材料');
    const outcomeControl = '<button type="button" class="fw-button" data-act="link-outcome" data-id="' + esc(p.id) + '">关联已有成果</button>';
    const content = {
      overview: () => '<div class="fw-two"><div class="fw-stack">' + projectSummary(p) +
        panel('下一步任务', openTasks.slice(0, 5).map(t => taskRow(t, false)).join('') || empty('暂无未完成任务'),
          btn('project-tab', 'tasks', '全部任务')) +
        panel('近期工作', recentActivities(p.id, 5), btn('project-tab', 'activity', '查看活动')) +
        '</div><div class="fw-stack">' + flowStepsCard(p) +
        panel('重点资料', empty('已选 ' + highlightedMaterials(p.id).length + ' 项'), materialControl) +
        panel('研究成果', outcomeRows(p.id, { limit: 4 }), btn('project-tab', 'materials', '查看全部')) +
        '</div></div>',
      tasks: () => '<div class="fw-two">' +
        panel('项目任务', tasks.map(t => taskRow(t, false)).join('') || empty('暂无项目任务'), makeTask) +
        flowStepsCard(p) + '</div>',
      notes: () => panel('项目知识笔记', empty('打开项目中的 Markdown 文件。'),
        btn('project-notes', p.id, '打开项目笔记') +
        (api.markdown.create ? btn('project-new-note', p.id, '新建研究笔记') : '')),
      materials: () => '<div class="fw-stack">' + panel('重点资料', empty('已选 ' + highlightedMaterials(p.id).length + ' 项'), materialControl) +
        panel('已登记成果', outcomeRows(p.id, { manage: true }), outcomeControl) + '</div>',
      activity: () => '<div class="fw-two">' + panel('项目活动', recentActivities(p.id, 20)) + codexPanel(p.id) + '</div>'
    }[projectTab] || (() => '');
    return page(heading(projName(p), (p.stage || '阶段未设置') + ' · 任务 ' +
      (tasks.length - openTasks.length) + ' / ' + tasks.length + ' 完成',
      routeBtn('projects-center', '返回项目中心') + '<button type="button" class="fw-button" data-act="edit-project" data-id="' + esc(p.id) + '">编辑项目</button>' +
      (rpmId(p) ? btn('project-graph', p.id, '查看项目图谱') : '')) +
      '<div class="fw-tabs" aria-label="项目分区">' + tabs.map(([tab, label]) =>
        btn('project-tab', tab, label, 'aria-pressed="' + (projectTab === tab) + '"')
      ).join('') + '</div>' + content());
  }

  function selectProjects(id, label, value, allLabel) {
    return '<label class="fw-select">' + esc(label) + '<select id="' + id + '"><option value="">' + esc(allLabel) + '</option>' +
      DB.projects.map(p => '<option value="' + esc(p.id) + '"' + (value === p.id ? ' selected' : '') + '>' +
        esc(projName(p)) + '</option>').join('') + '</select></label>';
  }

  function activityPage() {
    const scope = activity.projectId;
    const tasks = DB.tasks.filter(task => (!scope || scope === task.p) && (activity.status === 'all' || task.st === activity.status));
    const filters = '<div class="fw-controls">' + selectProjects('fw-activity-project', '项目', scope, '全部项目') +
      '<label class="fw-select">任务状态<select id="fw-task-status">' + [['all', '全部状态'], ...Object.entries(taskLabels)].map(([id, label]) =>
        '<option value="' + id + '"' + (activity.status === id ? ' selected' : '') + '>' + label + '</option>'
      ).join('') + '</select></label></div>';
    return page(heading('任务与活动', '', scope ? '<button type="button" class="fw-button prominent" data-act="new-task" data-p="' + esc(scope) + '">新建任务</button>' : '') +
      filters + '<div class="fw-two">' + panel('任务', tasks.map(task => taskRow(task)).join('') || empty('当前筛选下暂无任务')) +
      panel('近期活动', recentActivities(scope, 25)) + (scope ? codexPanel(scope) : '') + '</div>');
  }

  function materialView() {
    return page(heading('材料与成果', '', btn('show-outcomes', materials.projectId, '查看已登记成果') + btn('refresh-materials', '', '刷新列表')) +
      '<form class="fw-controls" id="fw-material-search">' + selectProjects('fw-material-project', '项目', materials.projectId, '全部项目') +
      '<label class="fw-select">搜索全部项目文件<input id="fw-material-filter" type="search" maxlength="160" value="' +
      esc(materials.filter) + '" placeholder="文件名或关键词"></label><button type="submit" class="fw-button">搜索</button>' +
      (materials.browse ? '' : btn('material-browse', '', '分类浏览')) +
      ((materials.browse || materials.query || materials.focusId) ? btn('material-highlights', '', '返回重点资料') : '') + '</form>' +
      (materials.browse ? '<div class="fw-controls"><label class="fw-select">资料分类<select id="fw-material-category"></select></label></div>' : '') +
      '<div class="fw-two fw-material-columns"><div id="fw-material-list"></div><aside id="fw-material-detail"></aside></div>');
  }

  function highlightedMaterials(projectId) {
    const entries = DB.settings.materialHighlights?.[rpmId(P(projectId))];
    return Array.isArray(entries) ? entries : [];
  }

  async function fetchMaterials(force) {
    const ids = materials.projectId ? [materials.projectId] : materials.browse ? [] : DB.projects.filter(p => rpmId(p)).map(p => p.id);
    const scopes = ids.map(id => [id, materials.browse ?
      { catalog: true, category: materials.category || undefined, offset: materials.offset, limit: materialPageSize } :
      materials.focusId ? { fileIds: [materials.focusId] } :
      materials.query ? { query: materials.query, limit: 30 } : { fileIds: highlightedMaterials(id).map(item => item.id) }]);
    const key = JSON.stringify(scopes);
    if (!force && key === materials.request) { updateMaterials(); return; }
    const token = ++materials.generation;
    materials.request = key;
    materials.rows.clear();
    const pending = scopes.filter(([, opts]) => !opts.fileIds || opts.fileIds.length);
    pending.forEach(([id]) => materials.rows.set(id, { pending: true }));
    updateMaterials();
    for (let offset = 0; offset < pending.length; offset += 4) {
      await Promise.all(pending.slice(offset, offset + 4).map(async ([id, options]) => {
        let result;
        try { result = await window.workspace.rpmProjectFiles(id, options); }
        catch (_) { result = { ok: false, code: 'unavailable' }; }
        if (token !== materials.generation) return;
        materials.rows.set(id, result);
        if (materials.browse && Array.isArray(result.categories)) materials.categories = result.categories;
      }));
      if (token !== materials.generation) return;
      updateMaterials();
    }
  }

  function updateMaterials() {
    const list = $('#fw-material-list');
    if (!list) return;
    const categories = $('#fw-material-category');
    if (categories && materials.browse) {
      categories.innerHTML = '<option value="">选择分类</option>' + materials.categories.map(({id, count}) =>
        '<option value="' + esc(id) + '">' + esc((materialCategories[id] || id) + '（' + count + '）') + '</option>').join('');
      categories.value = materials.category;
    }
    const rowSets = [...materials.rows].filter(([id]) => P(id) && (!materials.projectId || id === materials.projectId));
    const all = rowSets.flatMap(([projectId, result]) => (result.files || []).map(file => ({
      ...MaterialSource.fileRecord(file), projectId
    })));
    const pending = rowSets.filter(([, result]) => result.pending).length;
    const unavailable = rowSets.filter(([, result]) => !result.pending && !result.ok && !['unbound', 'binding_missing'].includes(result.code)).length;
    const unbound = rowSets.filter(([, result]) => ['unbound', 'binding_missing'].includes(result.code)).length;
    const total = rowSets.reduce((sum, [, result]) => sum + (result.total || 0), 0);
    const browsingPage = materials.browse && materials.category && !pending && !unavailable && !unbound;
    const counts = [browsingPage && total && all.length ? '第 ' + (materials.offset + 1) + '–' + (materials.offset + all.length) + ' 条，共 ' + total + ' 条' : '',
      materials.query && total > all.length ? '显示 ' + all.length + ' / ' + total + ' 条，可缩小关键词' : '',
      pending ? '正在查询 RPM…' : '',
      unavailable ? unavailable + ' 个项目读取失败' : '', unbound ? unbound + ' 个项目未绑定 RPM' : ''].filter(Boolean).join(' · ');
    const key = file => file.projectId + ':' + file.file_id;
    const highlight = file => highlightedMaterials(file.projectId).find(entry => entry.id === file.file_id);
    const item = all.find(file => key(file) === materials.selected);
    const title = materials.browse ? (materialCategories[materials.category] || '分类浏览') :
      materials.focusId ? '已定位的文件' : materials.query ? '搜索结果' : '重点资料';
    const browseTip = !materials.projectId ? '先选择项目查看分类。' : !materials.category ? '选择一个分类查看文件。' : '这个分类暂无文件。';
    const pagination = browsingPage && (materials.offset > 0 || materials.offset + materialPageSize < total) ?
      '<div class="fw-controls">' +
      (materials.offset > 0 ? btn('material-page', Math.max(0, materials.offset - materialPageSize), '上一页') : '') +
      (materials.offset + materialPageSize < total ? btn('material-page', materials.offset + materialPageSize, '下一页') : '') + '</div>' : '';
    list.innerHTML = panel(title, (counts ? statusText(counts) : '') + (all.map(file =>
      w('material', key(file), 'class="fw-row-button" aria-pressed="' + (file === item) + '"') + '<span><strong>' + esc(file.n) + '</strong><small>' +
      esc(projectName(file.projectId)) + ' · ' + esc(highlight(file)?.label || file.purpose || materialCategories[file.category] || file.category) + '</small></span></button>'
    ).join('') || (pending || unavailable || unbound ? '' : empty(materials.browse ? browseTip :
      materials.focusId ? '此文件已移动、失效或无法访问' : materials.query ?
      '没有匹配文件' : '还没有重点资料。搜索后可把需要常用的文件加入此处。'))) + pagination);
    $('#fw-material-detail').innerHTML = item ? panel('文件详情',
      '<h3 class="fw-material-name">' + esc(item.n) + '</h3>' +
      '<p class="fw-kicker">' + esc([projectName(item.projectId), materialCategories[item.category] || item.category].filter(Boolean).join(' · ')) + '</p>' +
      (highlight(item)?.label || item.purpose ? '<p class="fw-prose">' + esc(highlight(item)?.label || item.purpose) + '</p>' : '') +
      '<div class="fw-actions">' + btn('material-open', key(item), '打开文件', 'class="prominent"') +
      btn('material-reveal', key(item), '在资源管理器中定位') + btn('material-copy-path', key(item), '复制完整路径') +
      btn('material-highlight', key(item), highlight(item) ? '从重点移除' : '加入重点资料') +
      (DB.tasks.some(task => task.p === item.projectId) ? btn('material-link-task', key(item), '关联到任务') : '') +
      (/\.(?:md|markdown)$/i.test(item.relative_path)
        ? btn('material-note', key(item), '在知识工作区打开') : '') +
      '</div>' +
      '<div id="fw-material-message" role="status"></div>' +
      '<details class="fw-material-meta"><summary>文件信息</summary><p class="fw-material-path">' + esc(item.absolute_path || item.relative_path) + '</p><dl>' +
      '<dt>状态</dt><dd>' + esc(item.status || '状态未登记') + '</dd>' +
      (item.version ? '<dt>版本</dt><dd>' + esc(item.version) + '</dd>' : '') + '</dl>' +
      '<div class="fw-actions">' +
      btn('material-graph', key(item), '在图谱中定位') + btn('material-copy-id', key(item), '复制资料 ID') +
      '</div><p class="fw-reference-id">资料 ID <code>' + esc(item.file_id) +
      '</code></p></details>') : panel('文件详情', empty('选择一个文件查看用途和打开方式'));
  }
  function markdownView() {
    return page(heading('知识工作区', '', btn('refresh-notes', '', '刷新目录') +
      (api.markdown.create ? btn('new-note', '', '新建笔记', 'class="prominent"') : '')) +
      '<div class="fw-controls">' + selectProjects('fw-note-project', '笔记来源', notes.projectId, '中央 Obsidian Vault') +
      '<label class="fw-select">搜索文件<input id="fw-note-filter" type="search" value="' + esc(notes.filter) + '" placeholder="文件名或相对路径"></label></div>' +
      '<div class="fw-note-layout"><aside class="fw-note-sidebar" aria-label="Markdown 文件目录"><h2>文件目录</h2><div id="fw-note-tree"></div></aside>' +
      '<section class="fw-note-main"><div id="fw-note-toolbar"></div><div id="fw-note-status"></div><div id="fw-note-content"></div></section>' +
      '<aside class="fw-note-properties" aria-label="笔记属性"><h2>笔记属性</h2><div id="fw-note-properties"></div></aside></div>');
  }

  function noteArgs(projectId = notes.projectId, path = notes.path) {
    return { projectId: projectId || undefined, path };
  }

  let listToken = 0, fileToken = 0, listTimer = null, previewTimer = null;
  async function fetchNotes() {
    const token = ++listToken;
    notes.list = null;
    fillNoteTree();
    let result;
    try { result = await api.markdown.list({ projectId: notes.projectId || undefined, query: notes.filter, limit: 180 }); }
    catch (_) { result = { ok: false, message: '无法读取笔记目录' }; }
    if (token !== listToken) return;
    notes.list = result;
    fillNoteTree();
  }

  function fillNoteTree() {
    const tree = $('#fw-note-tree');
    if (!tree) return;
    if (!notes.list) { tree.innerHTML = empty('正在读取目录…'); return; }
    if (!notes.list.ok) {
      if (notes.list.code === 'metadata_only' && notes.projectId) {
        tree.innerHTML = empty('此项目仅提供文件索引。') +
          btn('project-materials', notes.projectId, '查看材料索引') +
          btn('central-notes', '', '打开中央 Vault');
      } else if (notes.list.code === 'unconnected' && !notes.projectId) {
        tree.innerHTML = empty('中央 Vault 尚未连接。') + btn('config', '', '连接 Vault');
      } else {
        tree.innerHTML = empty(reason(notes.list));
      }
      return;
    }
    const files = notes.list.files || [];
    const branch = () => ({ folders: new Map(), files: [] });
    const root = branch();
    for (const file of files) {
      let current = root;
      for (const part of file.path.split('/').slice(0, -1)) {
        if (!current.folders.has(part)) current.folders.set(part, branch());
        current = current.folders.get(part);
      }
      current.files.push(file);
    }
    function entries(current, prefix) {
      const folders = [...current.folders].map(([name, child]) => {
        const path = prefix + name + '/';
        return '<details class="fw-note-folder" data-folder="' + esc(path) + '"' +
          (!closedNoteFolders.has(notes.projectId + ':' + path) || notes.path.startsWith(path) ? ' open' : '') +
          '><summary>' + esc(name) + '</summary>' + entries(child, path) + '</details>';
      });
      return folders.join('') + current.files.map(file => w('note', file.path,
        'title="' + esc(file.path) + '" aria-pressed="' + (file.path === notes.path) + '"') +
        icon('file') + '<span><strong>' + esc(file.name || file.path) + '</strong></span></button>').join('');
    }
    tree.innerHTML = (notes.list.truncated ? statusText('结果已达显示上限，可用文件名缩小范围。') : '') +
      (files.length ? entries(root, '') : empty('当前范围暂无 Markdown'));
    for (const folder of tree.querySelectorAll('.fw-note-folder')) {
      const key = notes.projectId + ':' + folder.dataset.folder;
      folder.addEventListener('toggle', () => {
        if (folder.open) closedNoteFolders.delete(key);
        else closedNoteFolders.add(key);
      });
    }
  }

  async function openNote(path, projectId = notes.projectId, { reload = false } = {}) {
    const switching = notes.projectId !== projectId || notes.path !== path;
    if ((switching || reload) && notes.dirty && !window.confirm('放弃当前未保存的 Markdown 修改？')) return false;
    if (notes.busy) return false;
    const token = ++fileToken;
    if (notes.path && (switching || reload) && !rpmNoteRef()) void api.markdown.unwatch(noteArgs()).catch(() => {});
    const changedSource = notes.projectId !== projectId;
    Object.assign(notes, { path, projectId, file: null, text: '', original: null, graphRef: null, graphSource: switching ? null : notes.graphSource,
      dirty: false, conflict: false, diskVersion: null, versions: null, backlinks: null, message: path ? '正在读取原件…' : '' });
    if (changedSource) notes.list = null;
    fillNoteTree();
    fillNoteEditor();
    if (!path) return true;
    let result;
    try { result = await api.markdown.read(noteArgs()); }
    catch (_) { result = { ok: false, message: '无法读取 Markdown 原件' }; }
    if (token !== fileToken) return false;
    if (result?.ok) {
      const file = result.file || result;
      Object.assign(notes, { file, text: file.text || '', message: '' });
      const ref = rpmNoteRef();
      if (ref) {
        fillNoteTree();
        await openRpmOriginal(ref);
        return token === fileToken;
      }
      const observed = await api.markdown.watch(noteArgs()).catch(() => null);
      if (token !== fileToken) return false;
      if (observed?.ok && observed.revision !== file.revision) {
        notes.conflict = true;
        notes.message = '原件在读取期间已修改，请点击「重读原件」。';
      } else if (!observed?.ok) {
        notes.message = '未能监视外部修改，保存前仍会复核原件修订。';
      }
    } else notes.message = reason(result);
    fillNoteTree();
    fillNoteEditor();
    return Boolean(result?.ok);
  }

  function rpmNoteRef() {
    if (notes.graphRef) return notes.graphRef;
    const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(notes.text)?.[1] || '';
    const id = /^rpm_id:\s*([a-f0-9]{32})\s*$/m.exec(yaml)?.[1];
    const projectId = /^project_ids:[ \t]*\r?\n[ \t]*-[ \t]*([a-f0-9]{32})[ \t]*$/m.exec(yaml)?.[1];
    return /^rpm_kind: (?:source|knowledge)[ \t]*$/m.test(yaml) && id && projectId ? { projectId, id } : null;
  }

  async function openRpmOriginal(ref, sourceId) {
    const pending = { pending: true };
    notes.original = pending;
    fillNoteEditor();
    const result = await api.openOriginal?.({ ...ref, sourceId }).catch(() => null);
    if (notes.original !== pending) return;
    notes.original = result || { ok: false, error: '暂时无法读取 Markdown 正文' };
    fillNoteEditor();
  }

  function noteMarkdown() {
    return window.ResearchMarkdown;
  }

  function markdownPreview(value, links = true) {
    try { return noteMarkdown().render(value, { links }); }
    catch (_) { return '<pre>' + esc(String(value || '')) + '</pre>'; }
  }

  function showPreviewImages(article = $('#fw-note-preview')) {
    if (!article || !api.markdown.resolveLink || !notes.path || rpmNoteRef() || notes.original) return;
    const token = fileToken;
    const args = noteArgs();
    const images = [...article.querySelectorAll('[data-note-embed="true"]')].slice(0, 12);
    void (async () => {
      for (const button of images) {
        if (token !== fileToken || !button.isConnected) return;
        try {
          const result = await api.markdown.resolveLink({
            ...args, target: button.value, wiki: button.dataset.noteWiki === 'true', action: 'preview'
          });
          if (token !== fileToken || !button.isConnected || !result?.preview?.startsWith('data:image/')) continue;
          const image = document.createElement('img');
          image.src = result.preview;
          image.alt = button.textContent;
          image.loading = 'lazy';
          button.before(image);
        } catch (_) { /* The original attachment button is still available. */ }
      }
    })();
  }

  async function followNote(target, wiki = true) {
    if (!api.markdown.resolveLink) return;
    const token = fileToken;
    const result = await api.markdown.resolveLink({ ...noteArgs(), target, wiki, action: 'open' }).catch(() => null);
    if (token !== fileToken) return;
    if (result?.ok && result.kind === 'note') await openNote(result.path);
    else if (!result?.ok) {
      notes.message = result ? reason(result) : '无法打开此链接';
      fillNoteStatus();
    }
  }

  let backlinkRequest;
  async function loadBacklinks(silent = false) {
    if (!api.markdown.backlinks || !notes.file || backlinkRequest === fileToken || rpmNoteRef()) return;
    const token = fileToken;
    backlinkRequest = token;
    if (!silent) {
      notes.backlinks = { loading: true };
      fillNoteProperties();
    }
    const result = await api.markdown.backlinks(noteArgs()).catch(() => null);
    if (backlinkRequest === token) backlinkRequest = undefined;
    if (token !== fileToken) return;
    const next = result || { ok: false, message: '无法检索反向链接' };
    if (JSON.stringify(next) !== JSON.stringify(notes.backlinks)) {
      notes.backlinks = next;
      fillNoteProperties();
    }
  }

  function createNoteDialog(projectId = notes.projectId) {
    if (!api.markdown.create) return;
    if (projectId === notes.projectId && notes.list?.readOnly) return;
    const folder = projectId === notes.projectId && notes.path.includes('/') ? notes.path.slice(0, notes.path.lastIndexOf('/') + 1) : '';
    const id = projectId ? projectName(projectId) : '中央 Obsidian Vault';
    dialog('新建研究笔记', '<form id="fw-new-note" data-project-id="' + esc(projectId) + '">' +
      '<p>保存到 ' + esc(id) + '</p><label class="fw-select">相对路径<input id="fw-new-note-path" value="' + esc(folder) +
      '" placeholder="记录/新笔记.md" required autofocus></label>' +
      '<label class="fw-select">模板<select id="fw-new-note-template"><option value="research">研究记录</option><option value="">空白笔记</option></select></label>' +
      '<button type="submit" class="fw-button prominent">创建</button><p id="fw-dialog-message" role="status"></p></form>');
  }

  async function submitNewNote(form) {
    if (notes.dirty || notes.busy) {
      $('#fw-dialog-message').textContent = '请先保存当前修改。';
      return;
    }
    const projectId = form.dataset.projectId;
    const name = $('#fw-new-note-path').value.trim();
    const path = /\.(?:md|markdown)$/i.test(name) ? name : name + '.md';
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const result = await api.markdown.create({ ...noteArgs(projectId, path), template: $('#fw-new-note-template').value }).catch(() => null);
    if (!form.isConnected) return;
    submit.disabled = false;
    if (!result?.ok) {
      $('#fw-dialog-message').textContent = result ? reason(result) : '无法创建笔记';
      return;
    }
    $('#fw-dialog')?.close();
    await showNotes(projectId, result.path);
    await fetchNotes();
  }

  async function compareNote() {
    if (!notes.conflict || !notes.file) return;
    const token = fileToken;
    const current = await api.markdown.read(noteArgs()).catch(() => null);
    if (token !== fileToken) return;
    if (!current?.ok) {
      notes.message = current ? reason(current) : '无法读取磁盘版本，编辑草稿已保留';
      fillNoteStatus();
      return;
    }
    const disk = current.file || current;
    notes.diskVersion = disk;
    const node = dialog('合并 Markdown 修改',
      '<div class="rw-note-compare"><label>磁盘版本<textarea id="fw-note-disk" readonly></textarea></label>' +
      '<label>合并后的草稿<textarea id="fw-note-merged"></textarea></label></div>' +
      '<p>核对两份内容后，在右侧完成合并。返回编辑器后可保存合并稿。</p>' +
      btn('apply-note-merge', '', '使用合并草稿', 'class="prominent"'), 'rw-note-conflict-dialog');
    node.querySelector('#fw-note-disk').value = disk.text;
    node.querySelector('#fw-note-merged').value = notes.text;
  }

  function applyNoteMerge() {
    const box = $('#fw-note-merged');
    if (!box || !notes.diskVersion || !notes.conflict) return;
    const disk = notes.diskVersion;
    Object.assign(notes, { file: disk, text: box.value, dirty: box.value !== disk.text, conflict: false,
      diskVersion: null, message: '合并草稿已载入。保存前会再次核对磁盘版本。' });
    $('#fw-dialog')?.close();
    fillNoteEditor();
  }

  function fillNoteStatus() {
    const status = $('#fw-note-status');
    if (!status) return;
    status.innerHTML = statusText(notes.message || (notes.dirty ? '未保存修改' : notes.file ? (notes.file.readOnly || notes.file.readonly ? '只读原件' : '与原件一致') : '')) +
      (notes.conflict ? btn('compare-note', '', '查看磁盘版本并合并') : '');
    const save = $('[data-full="save-note"]');
    if (save) save.disabled = Boolean(!notes.dirty || notes.busy || notes.conflict || notes.file?.readOnly || notes.file?.readonly);
    const editor = $('#fw-note-editor');
    if (editor) editor.readOnly = Boolean(notes.busy || notes.file?.readOnly || notes.file?.readonly);
  }

  function fillNoteProperties() {
    const area = $('#fw-note-properties');
    if (!area) return;
    if (!notes.file) { area.innerHTML = empty('打开文件后显示路径和链接'); return; }
    const yaml = noteMarkdown().properties(notes.text);
    const links = noteMarkdown().links(notes.text);
    const backlinks = notes.backlinks;
    const backlinkResults = backlinks?.backlinks || [];
    area.innerHTML = '<div class="fw-note-path">' + esc(notes.path) + '</div>' +
      (notes.graphSource ? btn('note-graph-source', '', '返回图谱') : '') +
      (yaml.raw ? '<h3>属性</h3><dl class="rw-note-yaml">' + yaml.rows.map(([key, value]) =>
        '<dt>' + esc(key) + '</dt><dd>' + esc(value) + '</dd>').join('') + '</dl>' +
        '<details><summary>' + (yaml.invalid ? '属性格式有误，查看 YAML' : '查看 YAML') +
        '</summary><pre>' + esc(yaml.raw.slice(0, 6000)) + '</pre></details>' : '') +
      '<h3>链接</h3>' + (links.length ? links.slice(0, 60).map(link =>
        btn('follow-note', link.target, link.label || link.target, 'data-note-wiki="' + link.wiki + '"')).join('') : empty('暂无链接')) +
      '<h3>反向链接</h3>' + (backlinks?.loading ? empty('正在查找…') : backlinks?.ok ?
        (backlinkResults.map(row => btn('note', row.path, row.path)).join('') || empty('在已检查的笔记中未发现引用')) +
        (backlinks.partial ? statusText('只检查了部分笔记。') : '') : backlinks ? statusText(reason(backlinks)) : '') +
      (api.markdown.backlinks && !backlinks?.loading ? btn('note-backlinks', '', backlinks ? '重新查找' : '查找反链') : '') +
      '<h3>版本</h3>' + (notes.versions ? notes.versions.map(version => btn('restore-note',
        version.id || version.versionId, '恢复 ' + when(version.mtime || version.at || version.createdAt || version.id))
      ).join('') || empty('暂无工作台版本') : btn('note-versions', '', '查看保存历史'));
  }

  function fillNoteEditor() {
    const toolbar = $('#fw-note-toolbar'), content = $('#fw-note-content');
    if (!toolbar || !content) return;
    const file = notes.file;
    if (notes.graphRef || (file && rpmNoteRef())) {
      const original = notes.original;
      toolbar.innerHTML = '<div class="fw-note-heading"><strong>' +
        esc(original?.name || notes.path.split('/').pop() || '知识节点笔记') + '</strong>' +
        (notes.graphSource ? btn('note-graph-source', '', '返回图谱') : '') + '</div>';
      content.className = 'fw-note-content fw-note-read';
      if (original?.pending) content.innerHTML = empty('正在读取 Markdown 正文…');
      else if (original?.choices) content.innerHTML = empty('选择要阅读的 Markdown 正文') +
        original.choices.map(choice => btn('rpm-original-choice', choice.id, choice.name)).join('');
      else if (original?.ok) content.innerHTML = '<article class="fw-markdown" id="fw-note-preview" aria-label="Markdown 正文">' +
        markdownPreview(original.text, false) + '</article>';
      else content.innerHTML = empty(reason(original));
      const properties = $('#fw-note-properties');
      if (properties) properties.innerHTML = original?.ok && !original.choices ? empty('Markdown 正文 · 只读') : '';
      const status = $('#fw-note-status');
      if (status) status.innerHTML = '';
      return;
    }
    const mode = notes.mode;
    toolbar.innerHTML = file ? '<div class="fw-note-heading"><strong>' + esc(notes.path.split(/[\\/]/).pop()) + '</strong><div class="fw-actions">' +
      [['edit', '编辑'], ['split', '分栏'], ['read', '阅读']].map(([mode, label]) =>
        btn('note-mode', mode, label, 'aria-pressed="' + (notes.mode === mode) + '"')
      ).join('') + btn('reload-note', '', '重读原件') + btn('save-note', '', '保存', 'aria-keyshortcuts="Control+s"') + '</div></div>' : '';
    content.className = file ? 'fw-note-content fw-note-' + mode : '';
    content.innerHTML = file ? (mode !== 'read' ? '<textarea id="fw-note-editor" aria-label="Markdown 原文" spellcheck="false"' +
      (file.readOnly || file.readonly ? ' readonly' : '') + '></textarea>' : '') +
      (mode !== 'edit' ? '<article class="fw-markdown" id="fw-note-preview" aria-label="Markdown 预览">' + markdownPreview(notes.text) + '</article>' : '') :
      empty(notes.path ? (notes.message || '正在读取原件…') : '从文件目录选择一个 Markdown 原件');
    const editor = $('#fw-note-editor');
    if (editor) editor.value = notes.text;
    fillNoteStatus();
    fillNoteProperties();
    showPreviewImages();
  }

  async function saveNote(versionId) {
    if (!notes.file || rpmNoteRef() || notes.busy || notes.conflict || (notes.file.readOnly || notes.file.readonly)) return;
    if (!versionId && !notes.dirty) return;
    if (versionId && !window.confirm('恢复此版本并保留当前原件的备份？')) return;
    notes.busy = true;
    notes.message = versionId ? '正在恢复版本…' : '正在保存原件…';
    fillNoteStatus();
    let saved;
    try {
      const params = { ...noteArgs(), revision: notes.file.revision };
      saved = versionId ? await api.markdown.restore({ ...params, versionId }) : await api.markdown.save({ ...params, text: notes.text });
    } catch (_) { saved = { ok: false, message: '无法保存原件' }; }
    notes.busy = false;
    if (saved?.ok) {
      const file = saved.file || saved;
      Object.assign(notes, { file: { ...notes.file, ...file }, text: file.text ?? notes.text, dirty: false, conflict: false,
        versions: null, message: versionId ? '已恢复版本' : '原件已保存' });
      fillNoteEditor();
      if (notes.backlinks?.ok) void loadBacklinks(true);
    } else {
      notes.conflict = /conflict|changed|stale/i.test(saved?.code || '');
      notes.message = reason(saved);
      fillNoteStatus();
    }
  }

  async function noteVersions() {
    if (!notes.file) return;
    try {
      const result = await api.markdown.versions(noteArgs());
      if (result?.ok) { notes.versions = result.versions || []; fillNoteProperties(); }
      else { notes.message = reason(result); fillNoteStatus(); }
    } catch (_) { notes.message = '无法读取原件版本'; fillNoteStatus(); }
  }

  async function noteChanged(update) {
    if (!notes.file || notes.busy || notes.path !== update?.path || notes.projectId !== (update.projectId || '')) return;
    if (update.revision && notes.file.revision === update.revision) return;
    if (!update.revision) {
      notes.conflict = true;
      notes.message = update.code === 'not_found' ? '原件暂不可用，正在等待文件恢复。' : '暂时无法读取外部文件，当前内容已保留。';
      fillNoteStatus();
      return;
    }
    if (notes.dirty) {
      notes.conflict = true;
      notes.message = '原件已在外部修改，当前草稿已保留。';
      fillNoteStatus();
    } else {
      const hadBacklinks = notes.backlinks?.ok;
      if (await openNote(notes.path, notes.projectId, { reload: true })) {
        notes.message = '已同步外部修改';
        fillNoteStatus();
        if (hadBacklinks) void loadBacklinks();
      }
    }
  }

  const codexStatuses = {
    pending: '待执行', running: '执行中', waiting: '等待用户输入', paused: '执行中断',
    blocked: '执行受阻', test_failed: '测试未通过', completed: 'Codex 回合结束',
    failed: '执行失败', cancelled: '已取消', declined: '操作被拒绝', unknown: '状态待核对'
  };
  const codexConnections = { snapshot: '已核对会话', unavailable: '无法连接', stale: '暂未取得新状态' };
  const codexFileChanges = { added: '新增', modified: '修改', deleted: '删除' };

  function codexStatus(run) {
    return codexStatuses[run.status] || '状态待核对';
  }

  function codexRows(projectId = '', taskId = '', expanded = new Set()) {
    const matching = codexRuns.filter(run => (!projectId || run.projectId === projectId) &&
      (!taskId || run.taskId === taskId) && P(run.projectId));
    if (!matching.length) {
      if (codexLoadState === 'loading') return statusText('正在读取已关联的 Codex 执行…');
      if (codexLoadState === 'unavailable') return statusText('暂时无法读取 Codex 执行记录。');
      return empty('暂无已关联的 Codex 执行记录。');
    }
    const recent = [...matching].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const runs = taskId ? recent : recent.slice(0, 5);
    const loadWarning = codexLoadState === 'unavailable' ? statusText('暂时无法更新 Codex 执行记录，以下为上次读取内容。') : '';
    return loadWarning + runs.map(run => {
      const task = DB.tasks.find(row => row.id === run.taskId && row.p === run.projectId);
      const title = task?.t || '任务未登记';
      const timestamp = when(run.updatedAt);
      const timeline = (run.events || []).slice(-12).map(event =>
        '<li class="fw-run-event"><span>' + esc(event.label || '执行事件') + '</span> <small>' +
        esc([event.source === 'codex-app-server-snapshot' ? 'Codex 会话快照' : event.source === 'workbench' ? '工作台' : event.source,
          when(event.at)].filter(Boolean).join(' · ')) + '</small></li>').join('');
      const files = (run.files || []).map(file => {
        const actionable = file.present && ['added', 'modified'].includes(file.kind) && api.codex?.artifact;
        const attrs = 'data-run-id="' + esc(run.id) + '" data-project-id="' + esc(run.projectId) +
          '" data-task-id="' + esc(run.taskId) + '"';
        const action = (label, name) => btn('codex-artifact', file.path, label, attrs + ' data-artifact-action="' + name + '"');
        return '<li>' + esc(codexFileChanges[file.kind] || '变更') + ' <code>' + esc(file.path) + '</code>' +
          (typeof file.present === 'boolean' ? ' · ' + (file.present ? '磁盘可见' : '当前未找到') : '') +
          (actionable ? ' · ' + (file.fileId ? '已登记资料' : file.registered === false ? '待登记产物' : '登记状态待核对') +
            '<div class="fw-actions">' + action('打开原件', 'open') + action('在磁盘定位', 'reveal') +
            (file.fileId ? action('在材料中查看', 'inspect') : run.artifactRegistrationAllowed !== false ? action(file.registrationError ? '重试登记' : '登记为任务资料', 'register') : '') +
            '</div><p class="fw-status" data-artifact-status role="status">' + esc(file.registrationError || '') + '</p>' : '') + '</li>';
      }).join('');
      const errors = (run.denials || []).map(error =>
        '<li><strong>' + esc({write: '写入文件', command: '执行命令', turn: '执行回合'}[error.operation] || '工具操作') +
        '</strong> · ' + esc(error.source === 'codex-tool-rejection' ? 'Codex 本机工具返回' : 'Codex 会话快照') +
        '<p>' + esc(error.message) + '</p>' +
        (error.path || error.command ? '<code>' + esc(error.path || error.command) + '</code>' : '') + '</li>').join('');
      const checks = (run.checks || []).map(check =>
        '<li>' + esc(check.label || '命令执行') + ' · ' +
        esc(check.exitCode === 0 ? '退出码 0' : Number.isInteger(check.exitCode) ? '退出码 ' + check.exitCode : codexStatus(check)) +
        '</li>').join('');
      const duration = [
        run.startedAt && '开始 ' + when(run.startedAt),
        run.endedAt && '结束 ' + when(run.endedAt)
      ].filter(Boolean).join(' · ');
      return '<details class="fw-run" data-fw-codex-run="' + esc(run.id) + '"' + (expanded.has(run.id) ? ' open' : '') +
        '><summary><strong>' + esc(title) + '</strong> <span class="fw-tag">' + esc(codexStatus(run)) + '</span>' +
        (files ? ' <span class="fw-tag">' + esc(run.files.length) + ' 项文件变更</span>' : '') +
        '</summary><p>' + esc([projectName(run.projectId), codexConnections[run.connection], timestamp].filter(Boolean).join(' · ')) +
        '</p>' + (duration ? '<p>' + esc(duration) + '</p>' : '') +
        (errors ? '<h3>执行受阻详情</h3><ul class="fw-run-items">' + errors +
          '</ul><p>回到 Codex 核对当前工作目录和审批条件，再判断是否重试。科研任务状态仍由你确认。</p>' : '') +
        (run.status === 'test_failed' && checks ? '<h3>测试证据</h3><ul class="fw-run-items">' + checks + '</ul>' : '') +
        (timeline ? '<h3>最近执行活动</h3><ol class="fw-run-items">' + timeline + '</ol>' : '') +
        (files ? '<h3>Codex 报告的文件变更</h3><ul class="fw-run-items">' + files + '</ul>' : '') +
        '<details class="fw-material-meta"><summary>高级信息</summary><p>Codex 会话 <code>' + esc(run.sessionId) + '</code></p>' +
        (run.directory ? '<p>工作目录 ' + esc(run.directory === '.' ? '项目根目录' : run.directory) + '</p>' : '') +
        (checks && run.status !== 'test_failed' ? '<h3>执行检查</h3><ul class="fw-run-items">' + checks + '</ul>' : '') + '</details>' +
        (!taskId && task ? '<div class="fw-actions">' + btn('task', task.id, '查看任务详情') + '</div>' : '') +
        '</details>';
    }).join('');
  }

  async function useCodexArtifact(button) {
    const {projectId, taskId, runId, artifactAction: action} = button.dataset;
    const feedback = button.closest('li')?.querySelector('[data-artifact-status]');
    if (!feedback || !api.codex?.artifact) return;
    button.disabled = true;
    feedback.textContent = '正在核对项目文件…';
    try {
      const result = await api.codex.artifact({projectId, taskId, runId, action, path: button.value});
      if (!result?.ok) {
        feedback.textContent = result?.error || '暂时无法核对，可重试。';
        return;
      }
      if (action === 'inspect' && result.fileId) {
        $('#fw-dialog')?.close();
        materials.request = '';
        showMaterials(projectId, result.fileId);
      } else if (action === 'register' && result.fileId) {
        const task = DB.tasks.find(row => row.id === taskId && row.p === projectId);
        if (task && !taskRefs(task).includes(result.fileId)) {
          mutate(() => { task.codexReferences = [...taskRefs(task), result.fileId].join(', '); },
            { activity: { text: '登记 Codex 产物为任务资料 · ' + esc(result.path), kind: 'edit',
              projectId, objectId: taskId }, immediate: true });
        }
        feedback.textContent = result.notice || '已登记为任务资料，原始路径不变。';
        await loadCodexRuns();
        const current = $('#fw-dialog');
        if (task && current) void fillTaskMaterials(current, task);
      } else feedback.textContent = { open: '已请求系统打开原件', reveal: '已请求系统在磁盘定位',
        inspect: '索引中暂未找到此文件' }[action] || '操作已完成';
    } catch (_) {
      feedback.textContent = '暂时无法核对，可重试。';
    } finally { button.disabled = false; }
  }

  function codexTarget(projectId = '', taskId = '') {
    return '<div data-fw-codex-rows data-project-id="' + esc(projectId) +
      '" data-task-id="' + esc(taskId) + '">' + codexRows(projectId, taskId) + '</div>';
  }

  function codexPanel(projectId) {
    if (!api.codex || !P(projectId)) return '';
    return panel('Codex 协作', '<div data-fw-codex-pending-project="' + esc(projectId) + '">' +
      '<div class="fw-actions">' + btn('codex-project-refresh', projectId, '查找待关联会话') +
      '</div><p class="fw-status" data-fw-codex-pending-note role="status">正在查找本项目会话…</p>' +
      '<div data-fw-codex-sessions></div><p class="fw-status" data-fw-codex-action-note role="status"></p>' +
      '<details class="fw-material-meta"><summary>工作目录</summary><p class="fw-status" data-fw-codex-root></p>' +
      btn('codex-copy-root', projectId, '复制工作目录') + '</details></div>' + codexTarget(projectId));
  }

  function codexTaskControls(task) {
    if (!api.codex || !P(task.p)) return '';
    return '<section class="fw-codex-task" data-fw-codex-task data-task-id="' + esc(task.id) +
      '" data-project-id="' + esc(task.p) + '" data-fw-codex-pending-project="' + esc(task.p) + '"><h3>Codex 活动</h3>' +
      '<div class="fw-actions">' + btn('codex-discover', task.id, '查找待关联会话') +
      btn('codex-refresh', task.id, '刷新执行状态') + btn('codex-handoff', task.id, '复制任务交接') +
      '</div><p data-fw-codex-status class="fw-status" role="status"></p>' +
      '<p data-fw-codex-pending-note class="fw-status" role="status">正在查找本项目会话…</p><div data-fw-codex-sessions></div>' +
      codexTarget(task.p, task.id) + '</section>';
  }

  function renderCodexPending(projectId, result, busySection) {
    for (const target of document.querySelectorAll('[data-fw-codex-pending-project]')) {
      if (target.dataset.fwCodexPendingProject !== projectId ||
          (target !== busySection && target.getAttribute('aria-busy') === 'true')) continue;
      const rows = result?.ok ? result.sessions || [] : [];
      if (target.hasAttribute('data-fw-codex-summary')) {
        target.hidden = rows.length === 0;
        if (rows.length) target.textContent = rows.length + ' 个 Codex 会话待关联';
        continue;
      }
      const note = target.querySelector('[data-fw-codex-pending-note]');
      const sessions = target.querySelector('[data-fw-codex-sessions]');
      const root = target.querySelector('[data-fw-codex-root]');
      if (root) root.textContent = result?.root || '暂无可用项目目录。';
      const message = result?.ok ? (rows.length ? rows.length + ' 个会话待关联' : '暂无待关联会话。') : reason(result);
      if (note.textContent !== message) note.textContent = message;
      const taskMode = target.hasAttribute('data-fw-codex-task');
      const projectTasks = taskMode ? [] : DB.tasks.filter(task => task.p === projectId);
      const choices = projectTasks.map(task => '<option value="' + esc(task.id) + '">' + esc(task.t) + '</option>').join('');
      const previous = new Map([...sessions.querySelectorAll('select')].map(select => [select.closest('.fw-codex-session').dataset.session, select.value]));
      const focused = document.activeElement;
      const selectedId = sessions.contains(focused) && focused.closest('.fw-codex-session')?.dataset.session;
      const markup = rows.map(session =>
        '<div class="fw-codex-session" data-session="' + esc(session.sessionId) + '"><div><strong>' +
        esc(session.name || '未命名会话') + '</strong><small>' +
        esc([session.directory && session.directory !== '.' ? session.directory : '项目根目录',
          codexStatus(session), when(session.updatedAt)].filter(Boolean).join(' · ')) + '</small></div>' +
        (taskMode ? btn('codex-bind', session.sessionId, '关联到此任务') :
          choices ? '<div class="fw-actions"><label class="fw-select"><span class="fw-visually-hidden">关联任务</span><select>' +
            '<option value="">选择任务</option>' + choices + '</select></label>' +
            btn('codex-bind-project', session.sessionId, '关联') + '</div>' : '<small>请先创建项目任务</small>') + '</div>').join('');
      if (sessions.innerHTML === markup) continue;
      sessions.innerHTML = markup;
      for (const row of sessions.querySelectorAll('.fw-codex-session')) {
        const select = row.querySelector('select');
        if (select && previous.has(row.dataset.session)) select.value = previous.get(row.dataset.session);
        if (selectedId && row.dataset.session === selectedId) row.querySelector(focused.tagName.toLowerCase())?.focus();
      }
    }
  }

  function attachCodex(projectId, taskId, sessionId) {
    return flushSave().then(saved => saved?.ok ? api.codex.bind({ projectId, taskId, sessionId }) :
      { ok: false, message: '任务尚未保存，请重试。' });
  }

  async function bindProjectSession(button) {
    const section = button.closest('[data-fw-codex-pending-project]');
    if (!section || section.getAttribute('aria-busy') === 'true') return;
    const projectId = section.dataset.fwCodexPendingProject;
    const taskId = button.closest('.fw-codex-session')?.querySelector('select')?.value;
    const status = section.querySelector('[data-fw-codex-action-note]');
    if (!DB.tasks.some(task => task.id === taskId && task.p === projectId)) {
      status.textContent = '请先为会话选择对应的任务。';
      return;
    }
    section.setAttribute('aria-busy', 'true');
    button.disabled = true;
    status.textContent = '正在关联…';
    try {
      const result = await attachCodex(projectId, taskId, button.value);
      status.textContent = result?.ok ? '已关联到任务。' : reason(result);
      if (result?.ok) await Promise.all([loadCodexRuns(), loadCodexPending(projectId, { force: true, busySection: section })]);
    } catch (_) {
      status.textContent = '暂时无法关联会话。';
    } finally {
      section.removeAttribute('aria-busy');
      button.disabled = false;
    }
  }

  async function loadCodexPending(projectId, { force = false, busySection } = {}) {
    if (!api.codex?.pending || !projectId) return;
    const previous = codexPendingRequests.get(projectId);
    if (previous && !force) return previous;
    const request = Promise.resolve().then(() => api.codex.pending({ projectId, force }))
      .catch(() => ({ ok: false, error: '暂时无法核对本机 Codex 会话。' }))
      .then(result => {
        if (codexPendingRequests.get(projectId) === request) renderCodexPending(projectId, result, busySection);
        return result;
      });
    codexPendingRequests.set(projectId, request);
    try { return await request; }
    finally { if (codexPendingRequests.get(projectId) === request) codexPendingRequests.delete(projectId); }
  }

  function loadVisibleCodexPending(scope) {
    if (!api.codex?.pending) return;
    const projects = new Set([...document.querySelectorAll('[data-fw-codex-pending-project]')]
      .map(target => target.dataset.fwCodexPendingProject));
    for (const projectId of projects) if (!scope || scope === projectId) loadCodexPending(projectId);
  }

  async function loadCodexRuns() {
    if (!api.codex) return;
    const request = ++codexListRequest;
    let result;
    try { result = await api.codex.list({}); }
    catch (_) { result = null; }
    if (request !== codexListRequest) return;
    if (result?.ok) codexRuns = result.runs || [];
    codexLoadState = result?.ok ? 'ready' : 'unavailable';
    for (const target of document.querySelectorAll('[data-fw-codex-rows]')) {
      const expanded = new Set([...target.querySelectorAll('[data-fw-codex-run][open]')]
        .map(details => details.dataset.fwCodexRun));
      target.innerHTML = codexRows(target.dataset.projectId, target.dataset.taskId, expanded);
    }
  }

  async function codexAction(action, button) {
    const section = button.closest('[data-fw-codex-task]');
    if (!api.codex || !section || section.getAttribute('aria-busy') === 'true') return;
    const { projectId, taskId } = section.dataset;
    const status = section.querySelector('[data-fw-codex-status]');
    const sessions = section.querySelector('[data-fw-codex-sessions]');
    const controls = [...section.querySelectorAll('button[data-full^="codex-"]')];
    section.setAttribute('aria-busy', 'true');
    controls.forEach(control => { control.disabled = true; });
    status.textContent = '正在处理…';
    try {
      if (action === 'codex-discover') {
        const result = await loadCodexPending(projectId, { force: true, busySection: section });
        status.textContent = result?.ok ? '' : reason(result);
      } else if (action === 'codex-bind') {
        const result = await attachCodex(projectId, taskId, button.value);
        status.textContent = result?.ok ? '已关联 Codex 会话。' : reason(result);
        if (result?.ok) {
          sessions.replaceChildren();
          await Promise.all([loadCodexRuns(), loadCodexPending(projectId, { busySection: section })]);
        }
      } else if (action === 'codex-refresh') {
        const result = await api.codex.refresh({ projectId, taskId });
        status.textContent = result?.ok ? '已读取最新可用会话状态。' : reason(result);
        await loadCodexRuns();
      } else if (action === 'codex-handoff') {
        const saved = await flushSave();
        if (!saved?.ok) { status.textContent = '任务尚未保存，请重试。'; return; }
        const result = await api.codex.handoff({ projectId, taskId });
        status.textContent = result?.ok ? '交接内容已复制。请在对应目录的 Codex 会话中粘贴。' : reason(result);
      }
    } catch (_) {
      status.textContent = 'Codex 服务暂不可用。';
    } finally {
      section.removeAttribute('aria-busy');
      controls.forEach(control => { control.disabled = false; });
      if (button.isConnected) button.focus();
    }
  }

  function dialog(title, contents, className = '') {
    const existing = $('#fw-dialog');
    if (existing) existing.close();
    const node = document.createElement('dialog');
    const opener = document.activeElement;
    node.id = 'fw-dialog';
    node.className = 'fw-dialog ' + className;
    node.setAttribute('aria-labelledby', 'fw-dialog-title');
    node.innerHTML = '<div class="fw-dialog-label"><h2 id="fw-dialog-title">' + esc(title) + '</h2>' + btn('close-dialog', '', '关闭') +
      '</div>' + contents;
    node.addEventListener('close', () => { node.remove(); if (opener?.isConnected) opener.focus(); });
    document.body.append(node);
    node.showModal();
    return node;
  }

  function openSearch() {
    dialog('全局搜索', '<form id="fw-search-form" class="fw-search-form"><label for="fw-search-input" class="fw-visually-hidden">搜索关键词</label>' +
      '<input id="fw-search-input" type="search" placeholder="项目、任务、笔记、索引文件" maxlength="500" autocomplete="off" required autofocus>' +
      '<button type="submit" class="fw-button prominent">搜索</button></form>' +
      statusText('当前搜索项目、任务、笔记标题和文件索引。') + '<div id="fw-search-sources"></div><div id="fw-search-results">' + empty('输入关键词，按回车检索。') + '</div>', 'fw-search-dialog');
    $('#fw-search-input').focus();
  }

  async function search(query) {
    const sequence = ++searchRequest;
    const target = $('#fw-search-results');
    if (!target) return;
    const keys = Object.keys(sourceNames);
    const sourceTarget = $('#fw-search-sources');
    const parts = new Map();
    const status = { partial: '部分结果', unbound: '未绑定', unavailable: '暂不可用', root_missing: '目录不可用' };
    const types = { task: '任务', project: '项目', milestone: '里程碑', node: '图谱节点', material: '文件', note: '笔记' };
    const draw = () => {
      if (!target.isConnected || sequence !== searchRequest) return;
      const focused = document.activeElement?.closest('[data-full="search-result"]')?.value;
      searchResults.clear();
      sourceTarget.innerHTML = '<div class="fw-source-state" role="status">' + keys.map(key => {
        const data = parts.get(key);
        const label = data ? (data.source?.ok ? data.results.length + ' 条' :
          (status[data.source?.code] || status.unavailable) + (data.results.length ? '（' + data.results.length + ' 条）' : '')) : '搜索中';
        return '<span class="fw-tag">' + esc(sourceNames[key] + ' · ' + label) + '</span>';
      }).join('') + '</div>';
      const groups = keys.map(key => {
        const rows = parts.get(key)?.results || [];
        if (!rows.length) return '';
        return '<section class="fw-search-group"><h3>' + esc(sourceNames[key]) + '</h3>' + rows.map((item, index) => {
          const id = key + ':' + index;
          searchResults.set(id, item);
          return '<div class="fw-search-result">' + w('search-result', id, 'class="fw-row-button"') + '<span><strong>' +
            esc(item.title || item.path || '无标题') + '</strong><small>' +
            esc([item.projectId && P(item.projectId) && projectName(item.projectId),
              item.kind === 'task' ? taskLabels[item.detail] : item.kind === 'node' ? '' : item.detail || item.path].filter(Boolean).join(' · ')) +
            '</small></span><span class="fw-tag">' + esc(types[item.kind] || '条目') + '</span></button></div>';
        }).join('') + '</section>';
      }).join('');
      const message = parts.size < keys.length ? statusText('正在搜索其余来源…') :
        !searchResults.size ? empty([...parts.values()].some(part => !part.source?.ok) ?
          '可访问的来源中暂无匹配结果。' : '没有匹配结果') : '';
      target.innerHTML = groups + message;
      if (focused) [...target.querySelectorAll('[data-full="search-result"]')].find(row => row.value === focused)?.focus();
    };
    draw();
    await Promise.all(keys.map(async key => {
      const result = await api.search({ query, source: key }).catch(() => null);
      parts.set(key, { results: result?.ok ? result.results || [] : [], source: result?.sources?.[key] });
      draw();
    }));
  }

  async function chooseSearch(item) {
    if (!item) return;
    $('#fw-dialog')?.close();
    if (item.kind === 'task') return showTask(item.id);
    if (item.kind === 'project' || item.kind === 'milestone') return project(item.projectId || item.id);
    if (item.kind === 'node') return showGraph({ nodeId: item.id, rpmProjectId: item.rpmProjectId });
    if (item.kind === 'material') return showMaterials(item.projectId, item.id);
    if (item.kind === 'note') return showNotes(item.projectId || '', item.path);
  }

  function showGraph(target = null) {
    graphTarget = target;
    go('graph');
  }

  function syncGraph() {
    if (!graphTarget) return;
    const graph = window.KnowledgeNetwork;
    if (graph.focus?.(graphTarget)) graphTarget = null;
  }

  function showMaterials(projectId = '', id = '') {
    materials.projectId = projectId;
    materials.browse = false;
    materials.category = '';
    materials.categories = [];
    materials.offset = 0;
    materials.focusId = id;
    materials.filter = materials.query = '';
    materials.selected = id ? projectId + ':' + id : '';
    go('materials');
  }

  async function showNotes(projectId = '', path = '') {
    if (notes.projectId === projectId && (!path || path === notes.path)) { go('notes'); return; }
    if (!path && await openNote('', projectId)) { notes.list = null; go('notes'); fetchNotes(); return; }
    if (path) {
      const promise = openNote(path, projectId);
      if (notes.path === path && notes.projectId === projectId) {
        go('notes');
        if (!notes.list) fetchNotes();
      }
      return promise;
    }
  }

  function referenceScopes() {
    return DB.projects.filter(project => rpmId(project)).map(project => ({
      id: project.id, title: projectName(project.id), rpmProjectId: rpmId(project)
    }));
  }

  async function openReferenceNote(projectId, relativePath, nodeId) {
    if (notes.busy) return false;
    const opened = await openNote(relativePath, projectId || '', { reload: true });
    if (!opened) return false;
    notes.graphSource = { referenceScope: projectId || '', nodeId };
    go('notes');
    fillNoteEditor();
    return true;
  }

  async function openGraphNote(rpmProjectId, nodeId, relativePath = '', originNodeId = nodeId) {
    const project = DB.projects.find(item => rpmId(item) === rpmProjectId);
    if (notes.busy) return false;
    if (notes.dirty && !window.confirm('打开这份笔记并放弃未保存的修改？')) return false;
    notes.dirty = false;
    const direct = project && /\.(?:md|markdown)$/i.test(relativePath) &&
      await openNote(relativePath, project.id, { reload: true });
    const graphSource = originNodeId ? { rpmProjectId, nodeId: originNodeId } : null;
    notes.graphSource = graphSource;
    if (!direct) {
      await openNote('', project?.id || '');
      Object.assign(notes, { graphRef: { projectId: rpmProjectId, id: nodeId }, graphSource });
    }
    go('notes');
    if (!direct) await openRpmOriginal(notes.graphRef);
    else fillNoteEditor();
    return true;
  }

  function taskRefs(task) {
    return [...new Set(String(task.codexReferences || '').split(/[\s,，]+/)
      .filter(id => /^[\w.:-]{1,160}$/.test(id)))].slice(0, 12);
  }

  async function fillTaskMaterials(dialogNode, task) {
    const target = dialogNode.querySelector('[data-fw-task-materials]');
    const refs = taskRefs(task);
    if (!target || !refs.length) return;
    target.innerHTML = statusText('正在查找已关联资料…');
    const result = await window.workspace.rpmProjectFiles(task.p, { fileIds: refs }).catch(() => null);
    if (!target.isConnected) return;
    const rows = result?.files || [];
    target.innerHTML = rows.map(row =>
      w('task-open-material', row.file_id, 'class="fw-row-button" data-project-id="' + esc(task.p) + '"') +
      '<span><strong>' + esc(row.name || row.relative_path) + '</strong><small>' + esc(row.purpose || '') +
      '</small></span><span>查看文件</span></button>'
    ).join('') + (rows.length < refs.length ? empty('部分关联指向知识节点，或暂时无法定位。') : '');
  }

  function showTask(id) {
    const task = DB.tasks.find(item => item.id === id);
    if (!task) return;
    const p = P(task.p);
    const title = task.t || '任务';
    const info = '<div class="fw-source-state">' + stChip(task.st) + priTag(task.pri) + '<span class="fw-tag">' +
      esc(projectName(task.p)) + '</span><span class="fw-tag">' + esc(parseTaskDate(task.due).label) +
      '</span></div>';
    const more = [
      ['任务要求', task.description || task.note || task.notes],
      ['完成条件', task.acceptance || task.completionCriteria || task.definitionOfDone],
      ['待确认', task.openQuestions || task.pending || task.blockers]
    ].filter(([, value]) => value && (typeof value === 'string' || Array.isArray(value))).map(([label, value]) =>
      '<h3>' + esc(label) + '</h3><p class="fw-prose">' + esc(Array.isArray(value) ?
        value.map(row => typeof row === 'string' ? row : row?.title || row?.text || '').join('、') : value) + '</p>'
    ).join('');
    const choose = '<label class="fw-select">任务状态<select id="fw-edit-task-status" data-task-id="' + esc(id) + '">' +
      Object.entries(taskLabels).map(([key, label]) => '<option value="' + key + '"' + (key === task.st ? ' selected' : '') + '>' + label + '</option>').join('') +
      '</select></label>';
    const outcomeIds = Array.isArray(task.outcomeIds) ? task.outcomeIds : [];
    const eligible = (DB.outcomes || []).filter(row => Array.isArray(row?.project_ids) && row.project_ids.includes(task.p) &&
      !outcomeIds.includes(row.id));
    const linkOutcome = eligible.length ? '<div class="fw-actions"><label class="fw-select">登记成果<select id="fw-task-outcome">' +
      '<option value="">选择成果</option>' + eligible.map(row => '<option value="' + esc(row.id) + '">' +
        esc(row.title || '未命名成果') + '</option>').join('') + '</select></label>' +
      btn('task-link-outcome', id, '关联成果') + '</div>' : '';
    const body = '<div class="fw-actions">' + choose + btn('task-edit', id, '编辑任务') + '</div>' +
      '<div class="fw-two fw-task-grid"><div class="fw-stack">' +
      panel('任务说明', info + (more || empty('暂无任务要求或完成条件')) +
        (task.agent || task.owner || task.tool ? '<p class="fw-kicker">' + esc([task.agent || task.owner, task.tool].filter(Boolean).join(' · ')) + '</p>' : '')) +
      panel('关联资料', '<div data-fw-task-materials>' + empty('暂无关联资料') + '</div>',
        p ? btn('task-materials', p.id, '浏览项目材料') : '') +
      panel('关联成果', outcomeRows(task.p, { task }) + linkOutcome) + '</div><div class="fw-stack">' +
      panel('任务活动', recentActivities(task.p, 12, id)) + codexTaskControls(task) + '</div></div>';
    const node = dialog(title, body, 'fw-task-dialog');
    void fillTaskMaterials(node, task);
    loadVisibleCodexPending(task.p);
  }

  function updateTaskOutcome(taskId, outcomeId, add) {
    const task = DB.tasks.find(item => item.id === taskId);
    if (!task || !outcomeId) return;
    const row = (DB.outcomes || []).find(item => item?.id === outcomeId && item.project_ids?.includes(task.p));
    if (!row && add) return;
    const current = Array.isArray(task.outcomeIds) ? task.outcomeIds : [];
    mutate(() => { task.outcomeIds = add ? [...new Set([...current, outcomeId])] : current.filter(id => id !== outcomeId); },
      { activity: { text: (add ? '关联' : '移除') + '成果 · ' + esc(row?.title || ''), kind: 'edit', projectId: task.p, objectId: taskId }, immediate: true });
    showTask(taskId);
  }

  function linkMaterialToTask(value) {
    const [projectId, fileId] = value.split(':');
    const row = materials.rows.get(projectId)?.files?.find(file => file.file_id === fileId);
    const tasks = DB.tasks.filter(task => task.p === projectId);
    if (!row || !tasks.length) return;
    dialog('关联到任务', '<p>' + esc(row.name || row.relative_path) + '</p><div class="fw-actions">' +
      '<label class="fw-select">任务<select id="fw-material-task"><option value="">选择任务</option>' +
      tasks.map(task => '<option value="' + esc(task.id) + '">' + esc(task.t) + '</option>').join('') +
      '</select></label>' + btn('material-task-confirm', value, '保存关联', 'class="prominent"') +
      '</div><p class="fw-status" id="fw-dialog-message" role="status"></p>');
  }

  function confirmMaterialTask(value) {
    const [projectId, fileId] = value.split(':');
    const task = DB.tasks.find(item => item.id === $('#fw-material-task')?.value && item.p === projectId);
    const message = $('#fw-dialog-message');
    if (!task || !materials.rows.get(projectId)?.files?.some(file => file.file_id === fileId)) {
      if (message) message.textContent = '请选择对应的任务。';
      return;
    }
    const refs = taskRefs(task);
    if (refs.includes(fileId)) { if (message) message.textContent = '此资料已关联。'; return; }
    const next = [...refs, fileId].join(' ');
    if (refs.length >= 12 || next.length > 1024) { if (message) message.textContent = '此任务的资料关联已满。'; return; }
    mutate(() => { task.codexReferences = next; }, { activity: {
      text: '关联一项研究资料', kind: 'edit', projectId, objectId: task.id
    }, immediate: true });
    showTask(task.id);
  }

  function showTodos() {
    const rows = (DB.todos || []).map((todo, index) => '<div class="fw-record-row"><div><strong>' + esc(todo.t) +
      '</strong><small>' + esc([todo.projectId && projectName(todo.projectId), parseTaskDate(todo.due).label].filter(Boolean).join(' · ')) +
      '</small></div><div class="fw-actions">' + btn('todo-status', index, todo.done ? '恢复待办' : '标记完成') +
      '</div></div>').join('');
    dialog('全部待办', rows || empty('暂无待办'));
  }

  const takeoverTypes = {
    Research: '科研论文', 'Research+CFD': '科研与仿真', 'Research+Experiment': '科研与实验',
    CFD: '工程仿真', Experiment: '实验', Theory: '理论研究', Software: '软件或 Skill 开发',
    Writing: '写作', General: '通用'
  };

  const takeoverPhaseLabel = {
    scanning: '扫描尚未完成', scan_failed: '扫描需要重试', review: '等待复核',
    stale: '文件发生变化，待重新扫描', applying: '登记尚未确认完成',
    interrupted: '登记中断，待续办', registered: 'RPM 已登记，待连接工作台'
  };
  const takeoverCheckpointLabel = {
    approved: '已确认登记范围', initialized: '项目记录已初始化', indexed: '文件索引已登记', synced: '中央导航已同步'
  };
  const dependencyLabels = {
    resolved: '已找到同一项目原件', missing_in_scope: '项目内路径未找到',
    external_unverified: '外部路径待核验', dynamic_unresolved: '动态路径待核验'
  };

  function takeoverQueueContents() {
    if (!pendingTakeovers.length) return '';
    return panel('待续办的项目接管', pendingTakeovers.map(row => '<div class="fw-record-row"><div><strong>' +
      esc(row.name) + '</strong><small>' + esc([takeoverPhaseLabel[row.phase], takeoverCheckpointLabel[row.checkpoint],
        row.total ? '已复核 ' + row.reviewed + ' / ' + row.total + ' 份资料' : ''].filter(Boolean).join(' · ')) +
      '</small></div>' + btn('takeover-resume', row.token, '打开续办任务') + '</div>').join(''));
  }

  function takeoverQueue() {
    return '<div id="fw-takeover-pending">' + takeoverQueueContents() + '</div>';
  }

  async function loadPendingTakeovers() {
    if (!api.rpmOnboarding?.list) return;
    const sequence = ++takeoverListRequest;
    const result = await api.rpmOnboarding.list().catch(() => null);
    if (!result?.ok || sequence !== takeoverListRequest) return;
    pendingTakeovers = Array.isArray(result.tasks) ? result.tasks : [];
    const target = $('#fw-takeover-pending');
    if (target) target.innerHTML = takeoverQueueContents();
  }

  function takeoverScope(projectId) {
    return projectId === 'new-workspace-project' ? undefined : projectId;
  }

  function receiveTakeoverPage(node, result, extra = {}) {
    const intake = node.takeover;
    const { decisions, projectId, ...payload } = result;
    Object.assign(intake, payload, extra);
    if (projectId !== undefined) intake.projectId = takeoverScope(projectId);
    if (Array.isArray(decisions)) intake.decisions = new Map(decisions.map(row => [row.path, row]));
    if (intake.token) {
      const fields = node.querySelector('.fw-takeover-fields');
      if (fields) fields.hidden = true;
    }
    if (result.binding) {
      intake.confirmed = result.existing ? result : null;
      node.querySelector('#fw-takeover-preview').innerHTML =
        '<p class="fw-material-path">' + esc(result.binding.rpmRoot) + '</p>' +
        '<p>此目录已登记 RPM。连接工作台后可沿用原分类和记录。</p>' +
        btn('takeover-apply', '', '绑定已登记项目', 'class="prominent"') +
        (intake.token ? btn('takeover-abandon', '', '放弃续办') : '');
    } else renderTakeover(node);
  }

  async function resumeTakeover(token) {
    const task = pendingTakeovers.find(row => row.token === token);
    if (!task) return;
    openTakeover(takeoverScope(task.projectId));
    const node = $('#fw-dialog');
    node.takeover.token = token;
    node.setAttribute('aria-busy', 'true');
    try {
      const result = await api.rpmOnboarding.page({ token, projectId: takeoverScope(task.projectId) });
      if (!node.isConnected) return;
      if (result?.ok) receiveTakeoverPage(node, result);
      takeoverStatus(node, result?.ok ? result.failure?.error || '' : reason(result));
    } catch (_) { takeoverStatus(node, '无法读取保存的接管任务。'); }
    finally { node.removeAttribute('aria-busy'); }
  }

  async function saveTakeoverDraft(node) {
    const intake = node?.takeover;
    if (!intake?.token || intake.phase !== 'review' || !api.rpmOnboarding?.save) return true;
    readTakeoverDecisions(node);
    const saved = await api.rpmOnboarding.save({ token: intake.token, projectId: intake.projectId,
      decisions: [...intake.decisions.values()], acceptHigh: intake.acceptHigh }).catch(() => null);
    if (!saved?.ok) takeoverStatus(node, reason(saved));
    return Boolean(saved?.ok);
  }

  async function rescanTakeover() {
    const node = $('#fw-dialog');
    const intake = node?.takeover;
    if (!intake?.token || node.getAttribute('aria-busy') === 'true') return;
    node.setAttribute('aria-busy', 'true');
    try {
      if (!await saveTakeoverDraft(node)) return;
      takeoverStatus(node, '正在核对变化，保留已复核的分类…');
      const result = await api.rpmOnboarding.rescan({ token: intake.token, projectId: intake.projectId });
      if (!node.isConnected) return;
      if (result?.ok) receiveTakeoverPage(node, result, { filter: 'all' });
      takeoverStatus(node, result?.ok ? '扫描完成，请确认发生变化的资料。' : reason(result));
    } catch (_) { takeoverStatus(node, '重新扫描未完成，已保存先前记录。'); }
    finally { node.removeAttribute('aria-busy'); void loadPendingTakeovers(); }
  }

  async function abandonTakeover() {
    const node = $('#fw-dialog');
    const intake = node?.takeover;
    if (!intake?.token || node.getAttribute('aria-busy') === 'true' ||
        !window.confirm('放弃续办任务？已经写入的 RPM 管理记录与原件将原位保留。')) return;
    const result = await api.rpmOnboarding.abandon({ token: intake.token, projectId: intake.projectId }).catch(() => null);
    if (result?.ok) { node.close(); void loadPendingTakeovers(); }
    else takeoverStatus(node, reason(result));
  }

  function openTakeover(projectId = '') {
    const p = P(projectId);
    const options = Object.entries(takeoverTypes).map(([value, label]) =>
      '<option value="' + esc(value) + '">' + esc(label) + '</option>').join('');
    const node = dialog('接管已有项目', '<div class="fw-controls fw-takeover-fields">' +
      '<label class="fw-select">项目名称<input id="fw-takeover-name" maxlength="120" value="' + esc(p ? projName(p) : '') + '"></label>' +
      '<label class="fw-select">研究方向或项目目标<input id="fw-takeover-direction" maxlength="240" value="' +
      esc(p?.subtitle || p?.direction || '') + '"></label>' +
      '<label class="fw-select">项目类型<select id="fw-takeover-type">' + options + '</select></label>' +
      btn('takeover-preview', projectId, '选择目录并预览', 'class="prominent"') +
      '</div><p>先读取目录并提出分类建议。确认登记后，原有文件仍保留在现有位置。</p>' +
      '<div id="fw-takeover-preview"></div><p class="fw-status" id="fw-takeover-status" role="status"></p>',
      'fw-task-dialog');
    node.takeover = { projectId: projectId || undefined, decisions: new Map(), acceptHigh: false };
  }

  function takeoverStatus(node, text) {
    if (node.isConnected) node.querySelector('#fw-takeover-status').textContent = text;
  }

  async function startTakeover(button) {
    const node = button.closest('#fw-dialog');
    const intake = node?.takeover;
    if (!intake || node.getAttribute('aria-busy') === 'true') return;
    if (!api.rpmOnboarding) { takeoverStatus(node, '当前版本无法预览历史项目。'); return; }
    const name = $('#fw-takeover-name')?.value.trim();
    const direction = $('#fw-takeover-direction')?.value.trim();
    const projectType = $('#fw-takeover-type')?.value;
    if (!name || !direction) { takeoverStatus(node, '请输入项目名称和研究方向。'); return; }
    Object.assign(intake, { token: undefined, name, direction, projectType, decisions: new Map(), acceptHigh: false, confirmed: null });
    node.querySelector('#fw-takeover-preview').replaceChildren();
    node.setAttribute('aria-busy', 'true');
    button.disabled = true;
    takeoverStatus(node, '选择项目目录后，将只读扫描并生成复核清单…');
    try {
      const result = await api.rpmOnboarding.preview({ projectId: intake.projectId, name, direction, projectType });
      if (!node.isConnected) return;
      if (result?.code === 'cancelled') { takeoverStatus(node, ''); return; }
      if (!result?.ok) { takeoverStatus(node, reason(result)); return; }
      receiveTakeoverPage(node, result);
      void loadPendingTakeovers();
      takeoverStatus(node, '');
    } catch (_) {
      takeoverStatus(node, '无法完成目录预览，请重试。');
    } finally {
      button.disabled = false;
      node.removeAttribute('aria-busy');
    }
  }

  function readTakeoverDecisions(node) {
    const intake = node.takeover;
    if (intake.confirmed || (intake.phase && intake.phase !== 'review')) return;
    intake.acceptHigh = Boolean(node.querySelector('#fw-takeover-high')?.checked);
    for (const row of node.querySelectorAll('[data-takeover-path]')) {
      const selected = row.querySelector('select');
      const [action, category] = selected.value.split(':');
      const purpose = row.querySelector('input').value.trim();
      if (!action) { intake.decisions.delete(row.dataset.takeoverPath); continue; }
      intake.decisions.set(row.dataset.takeoverPath, {
        path: row.dataset.takeoverPath, action, ...(category && { category }), ...(action === 'change' && purpose && { purpose })
      });
    }
  }

  function renderTakeover(node) {
    const intake = node.takeover;
    const categories = (intake.categories || []).map(row => typeof row === 'string' ? { id: row } : row);
    const summary = intake.summary || {};
    const tallies = [
      ['文件', summary.total ?? summary.files ?? summary.fileCount], ['较明确', summary.high], ['待复核', summary.medium],
      ['待分类', summary.pending ?? summary.low], ['重复组', summary.duplicateGroups], ['重复文件', summary.duplicateFiles],
      ['工程依赖', summary.dependencyProtected ?? summary.dependencyCount ?? summary.dependencies], ['重名组', summary.sameNameGroups],
      ['未核实重复项', summary.duplicateUnverified]
    ].filter(([, count]) => Number.isInteger(count));
    const directoryList = (intake.directories || []).slice(0, 30).map(dir =>
      '<li>' + esc(typeof dir === 'string' ? dir : (dir.path || dir.name || '根目录') + (dir.count ? ' · ' + dir.count + ' 项' : '')) +
      '</li>').join('');
    const candidates = (intake.knowledgeCandidates || []).slice(0, 15).map(row =>
      '<li>' + esc(typeof row === 'string' ? row : [row.title || row.name || row.source || row.path, row.target,
        row.reason].filter(Boolean).join(' · ')) + '</li>').join('');
    const rows = (intake.files || []).map(file => {
      const chosen = intake.decisions.get(file.path);
      const choice = chosen && (chosen.action === 'change' ? 'change:' + chosen.category : chosen.action);
      const options = [['', '待确认'], ['accept', '接受建议'], ['reject', '保留待分类'],
        ...categories.filter(row => row?.id).map(({id, label, name}) => ['change:' + id, label || name || materialCategories[id] || id])];
      const remarks = [file.reason, file.dependency && '工程保护 · ' + (typeof file.dependency === 'string' ? file.dependency : '原位登记'), file.sameName && '同名文件',
        file.duplicateGroup && '与其他文件内容相同', file.changed && '本次发生变化，请核对'].filter(Boolean);
      const category = categories.find(row => row?.id === file.category);
      const depRows = (file.dependencyRefs || []).slice(0, 12).map(ref => '<li>' +
        esc([dependencyLabels[ref.status], ref.kind, ref.line ? '第 ' + ref.line + ' 行' : '', ref.path,
          ref.target && ref.target !== ref.path ? '→ ' + ref.target : ''].filter(Boolean).join(' · ')) + '</li>').join('');
      return '<div class="fw-record-row fw-takeover-row" data-takeover-path="' + esc(file.path) + '"><div><strong>' +
        esc(file.name || file.path) + '</strong><small>' + esc(file.path) + '</small><small>' +
        esc([file.purpose, category?.label || category?.name || materialCategories[file.category] || file.category,
          {high: '较明确', medium: '建议复核', pending: '待分类'}[file.confidence], ...remarks].filter(Boolean).join(' · ')) +
        '</small>' + (depRows ? '<details><summary>查看引用依据</summary><ul>' + depRows + '</ul></details>' : '') +
        '</div><label class="fw-select"><span class="fw-visually-hidden">复核 ' + esc(file.name || file.path) +
        '</span><select' + (intake.phase && intake.phase !== 'review' ? ' disabled' : '') + '>' + options.map(([value, label]) => '<option value="' + esc(value) + '"' +
        (choice === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select></label>' +
        '<label class="fw-select" data-takeover-purpose' + (chosen?.action === 'change' ? '' : ' hidden') +
        '>用途说明<input maxlength="240" value="' + esc(chosen?.purpose || file.purpose || '') + '"' +
        (intake.phase && intake.phase !== 'review' ? ' readonly' : '') + '></label></div>';
    }).join('');
    const offset = intake.offset || 0;
    const limit = intake.limit || 30;
    const total = intake.filteredTotal ?? intake.total ?? summary.total ?? summary.files ?? offset + (intake.files || []).length;
    const filter = intake.filter || 'all';
    const filterValue = typeof filter === 'string' ? filter : '';
    const blocked = Boolean(intake.blocked);
    const editable = !intake.phase || intake.phase === 'review';
    const canConfirm = !blocked && (editable || ['applying', 'interrupted'].includes(intake.phase));
    const changed = intake.changeSummary;
    const issues = intake.failure?.error;
    const refs = intake.dependencySummary;
    node.querySelector('#fw-takeover-preview').innerHTML =
      '<div class="fw-material-meta"><strong>项目目录</strong><p class="fw-material-path">' + esc(intake.root) + '</p></div>' +
      (intake.phase ? statusText([takeoverPhaseLabel[intake.phase], takeoverCheckpointLabel[intake.checkpoint], issues].filter(Boolean).join(' · ')) : '') +
      (changed && (changed.changed || changed.removed || changed.reused) ? statusText('沿用 ' + changed.reused +
        ' 项 · 已变化 ' + changed.changed + ' 项 · 新增 ' + changed.added + ' 项 · 已移除 ' + changed.removed + ' 项') : '') +
      '<div class="fw-source-state">' + tallies.map(([label, count]) => '<span class="fw-tag">' + label + ' ' + count + '</span>').join('') + '</div>' +
      (refs ? '<details class="fw-material-meta"><summary>引用核对</summary><p>' +
        Object.entries(dependencyLabels).filter(([key]) => Number.isInteger(refs[key])).map(([key, label]) =>
          esc(label + ' ' + refs[key])).join(' · ') + '</p></details>' : '') +
      (directoryList ? '<details class="fw-material-meta"><summary>目录结构</summary><ul>' + directoryList + '</ul></details>' : '') +
      (intake.skipped?.length ? '<details class="fw-material-meta"><summary>无法纳入复核的路径（' +
        intake.skipped.length + '）</summary><ul>' + intake.skipped.slice(0, 30).map(row => '<li>' +
        esc(typeof row === 'string' ? row : [row.path, row.reason].filter(Boolean).join(' · ')) + '</li>').join('') + '</ul></details>' : '') +
      (candidates ? '<details class="fw-material-meta"><summary>待核实的知识线索</summary><ul>' + candidates + '</ul></details>' : '') +
      (blocked ? statusText(typeof intake.blocked === 'string' ? intake.blocked : '此目录当前无法登记，可继续查看预览。') : '') +
      '<h3>复核分类</h3>' + '<div class="fw-actions"><label class="fw-select">筛选<select id="fw-takeover-filter">' +
      [['all', '全部文件'], ['high', '较明确'], ['medium', '建议复核'], ['pending', '待分类'],
        ['duplicate', '重复文件'], ['sameName', '同名文件'], ['dependency', '工程依赖']].map(([value, label]) =>
        '<option value="' + value + '"' + (filterValue === value ? ' selected' : '') + '>' + label + '</option>').join('') +
      '</select></label></div>' + (rows || empty('当前筛选下没有文件')) + '<div class="fw-actions">' +
      (offset > 0 ? btn('takeover-page', Math.max(0, offset - limit), '上一页') : '') +
      (offset + limit < total ? btn('takeover-page', offset + limit, '下一页') : '') + '</div>' +
      '<div class="fw-takeover-confirm">' + (editable && !blocked ?
        '<label><input type="checkbox" id="fw-takeover-high"' + (intake.acceptHigh ? ' checked' : '') +
        '> 接受未单独处理的高置信度建议</label>' : '') +
      (canConfirm ? '<p>确认后将写入项目管理目录以完成登记。未确认的分类保留待复核。</p>' +
        btn('takeover-apply', '', editable ? '确认原位登记' : '从检查点继续登记', 'class="prominent"') : '') +
      (intake.token && api.rpmOnboarding?.rescan ? btn('takeover-rescan', '', '重新扫描并保留复核') : '') +
      (intake.token && api.rpmOnboarding?.abandon ? btn('takeover-abandon', '', '放弃续办') : '') + '</div>';
  }

  async function takeoverPage(offset, changedFilter) {
    const node = $('#fw-dialog');
    const intake = node?.takeover;
    if (!intake?.token || node.getAttribute('aria-busy') === 'true') return;
    readTakeoverDecisions(node);
    const filter = changedFilter ?? intake.filter ?? 'all';
    node.setAttribute('aria-busy', 'true');
    takeoverStatus(node, '正在读取复核清单…');
    try {
      if (!await saveTakeoverDraft(node)) return;
      const result = await api.rpmOnboarding.page({ token: intake.token, projectId: intake.projectId, offset, filter });
      if (!node.isConnected) return;
      if (!result?.ok) { takeoverStatus(node, reason(result)); return; }
      receiveTakeoverPage(node, result, { filter });
      takeoverStatus(node, '');
    } catch (_) {
      takeoverStatus(node, '无法读取复核清单，请重试。');
    } finally {
      node.removeAttribute('aria-busy');
    }
  }

  async function applyTakeover() {
    const node = $('#fw-dialog');
    const intake = node?.takeover;
    if (!intake || (!intake.token && !intake.confirmed) || intake.blocked || node.getAttribute('aria-busy') === 'true') return;
    readTakeoverDecisions(node);
    node.setAttribute('aria-busy', 'true');
    takeoverStatus(node, '正在核对变更并登记…');
    try {
      if (!await saveTakeoverDraft(node)) return;
      const result = intake.confirmed || await api.rpmOnboarding.confirm({
        token: intake.token, projectId: intake.projectId,
        ...(!intake.phase || intake.phase === 'review' ? { decisions: [...intake.decisions.values()], acceptHigh: intake.acceptHigh } : {})
      });
      if (!result?.ok || !result.binding) {
        if (intake.token && !['cancelled', 'invalid_review'].includes(result?.code)) {
          const refreshed = await api.rpmOnboarding.page({ token: intake.token, projectId: intake.projectId }).catch(() => null);
          if (refreshed?.ok && node.isConnected) receiveTakeoverPage(node, refreshed);
        }
        takeoverStatus(node, reason(result));
        return;
      }
      intake.confirmed = result;
      const matched = DB.projects.find(p => rpmId(p) === result.binding.rpmProjectId);
      if (matched && intake.projectId && matched.id !== intake.projectId) {
        takeoverStatus(node, '此目录已连接到项目「' + projName(matched) + '」。请从项目中心打开该项目。');
        return;
      }
      const existing = P(intake.projectId) || matched;
      const p = existing || makeProject({ name: intake.name, subtitle: intake.direction });
      mutate(() => {
        if (!existing) {
          Object.assign(p, { subtitle: intake.direction, stage: '', next: '', nodes: [], flow: [],
            cover: { kind: 'none', resource: '', alt: '', fit: 'contain', focus: '' } });
          DB.projects.push(p);
        }
        DB.settings.rpmBindings ||= {};
        DB.settings.rpmBindings[p.id] = result.binding;
        delete p.rpmProjectId;
        delete p.rpmRoot;
      }, { activity: { text: '接管已有项目 · ' + esc(intake.name), kind: 'edit', projectId: p.id }, immediate: true });
      const saved = await flushSave();
      if (!saved?.ok) { takeoverStatus(node, '项目已登记，工作台连接尚未保存。请重试。'); return; }
      if (intake.token && api.rpmOnboarding?.finish) {
        const finished = await api.rpmOnboarding.finish({ token: intake.token, projectId: intake.projectId }).catch(() => null);
        if (!finished?.ok) {
          takeoverStatus(node, '项目已连接工作台，尚未关闭接管记录。可重试。');
          return;
        }
      }
      if (node.isConnected) node.close();
      materials.rows.delete(p.id);
      window.KnowledgeNetwork?.refresh?.();
      project(p.id);
    } catch (_) {
      takeoverStatus(node, '无法完成登记，请重试或重新预览。');
    } finally {
      node.removeAttribute('aria-busy');
      void loadPendingTakeovers();
    }
  }

  async function bindProject(projectId) {
    const project = P(projectId);
    if (!project) return;
    const node = dialog('项目目录连接', '<section class="fw-connection"><h3>绑定已登记项目</h3>' +
      '<p id="fw-bind-status" role="status">正在读取已登记项目…</p><div id="fw-bind-existing"></div></section>' +
      '<section class="fw-connection"><h3>接管尚未登记的目录</h3>' +
      '<p>先预览目录和分类，再确认登记。</p>' + btn('takeover', projectId, '接管已有目录') +
      '</section><p id="fw-dialog-message" role="status"></p>');
    const status = node.querySelector('#fw-bind-status');
    try {
      const result = await api.rpmProjects();
      if (!node.isConnected) return;
      const rows = result?.projects || [];
      status.textContent = result?.ok ? 'RPM 已登记 ' + rows.length + ' 个项目。' : reason(result);
      if (!result?.ok || !rows.length) return;
      const rootList = node.querySelector('#fw-bind-existing');
      rootList.innerHTML = '<label class="fw-select">已登记项目<select id="fw-bind-target">' + rows.map(row =>
        '<option value="' + esc(row.rpmProjectId) + '"' + (row.rpmProjectId === rpmId(project) ? ' selected' : '') +
        '>' + esc(row.rpmRoot || row.rpmProjectId) + '</option>'
      ).join('') + '</select></label>' + btn('bind-confirm', projectId, '保存绑定');
    } catch (_) {
      if (node.isConnected) status.textContent = '无法读取 RPM 登记';
    }
  }

  async function confirmBinding(projectId) {
    const dialogNode = $('#fw-dialog');
    const message = $('#fw-dialog-message');
    if (!dialogNode || !message || !P(projectId) || dialogNode.getAttribute('aria-busy') === 'true') return;
    const rpmProjectId = $('#fw-bind-target')?.value;
    dialogNode.setAttribute('aria-busy', 'true');
    try {
      message.textContent = '正在核对项目目录…';
      const result = await api.rpmBinding({ rpmProjectId });
      if (result?.code === 'cancelled') { message.textContent = ''; return; }
      if (!result?.ok || !result.binding || !P(projectId)) {
        message.textContent = reason(result);
        return;
      }
      mutate(() => {
        DB.settings.rpmBindings ||= {};
        DB.settings.rpmBindings[projectId] = result.binding;
        const project = P(projectId);
        delete project.rpmProjectId;
        delete project.rpmRoot;
      }, { activity: { text: '更新项目目录连接', kind: 'edit', projectId }, immediate: true });
      const saved = await flushSave();
      materials.rows.delete(projectId);
      window.KnowledgeNetwork.refresh?.();
      if (saved?.ok) {
        if (dialogNode.isConnected) dialogNode.close();
        void loadCodexPending(projectId, { force: true });
      } else message.textContent = 'RPM 已登记，但工作台绑定暂未保存。';
    } catch (_) {
      message.textContent = '无法保存 RPM 绑定';
    } finally { dialogNode.removeAttribute('aria-busy'); }
  }

  function configDialog() {
    const node = dialog('本机连接与导入',
      '<section class="fw-connection"><h3>本机 API</h3><p id="fw-local-status" role="status">正在读取状态…</p></section>' +
      '<section class="fw-connection"><h3>中央 Markdown Vault</h3><p id="fw-vault-status" role="status">正在读取状态…</p>' +
      btn('choose-vault', '', '选择中央 Vault') + '</section>' +
      '<section class="fw-connection"><h3>工作台数据</h3><p>可迁移旧版便携数据或恢复本机迁移备份。早期正式版可选择 workspace-data.json 副本。</p>' +
      (api.migration ? btn('migrate-profile', '', '迁移旧数据文件夹') + btn('migration-backup', '', '备份本机数据') : '') +
      btn('import', '', '导入工作台 JSON') + '<p id="fw-dialog-message" role="status"></p></section>');
    api.migration?.status().then(result => {
      const message = node.querySelector('#fw-dialog-message');
      if (!node.isConnected || !result?.ok) return;
      const options = { complete: '迁移已完成，迁移前的备份可用于恢复。', rolled_back: '迁移中断，已恢复迁移前的数据。', failed: '迁移未执行，请核对源数据后重试。' };
      message.textContent = result.pending ? '迁移已准备。请退出并重新打开 4.0.0。' : (options[result.last?.phase] || '');
    }).catch(() => {});
    api.vault?.status().then(result => {
      const status = node.querySelector('#fw-vault-status');
      if (node.isConnected) status.textContent = result?.bound ? '已连接。更换目录后需重启工作台。' : '未连接，可选择已有 Vault。';
    }).catch(() => { if (node.isConnected) node.querySelector('#fw-vault-status').textContent = '无法读取 Vault 状态'; });
    Promise.resolve(api.status()).then(result => {
      if (!node.isConnected) return;
      const local = node.querySelector('#fw-local-status');
      local.textContent = result?.apiReady ? '监听本机端口 ' + result.apiPort : '本机 API 当前未监听';
    }).catch(() => { if (node.isConnected) node.querySelector('#fw-local-status').textContent = '当前不可用'; });
  }

  async function migrateWorkspace(action) {
    if (notes.dirty) { $('#fw-dialog-message').textContent = '请先保存当前 Markdown 修改。'; return; }
    let result;
    try {
      const flushed = await flushSave();
      result = flushed?.ok ? await action() : flushed;
    } catch (_) { result = { ok: false, message: '无法完成数据操作' }; }
    const message = $('#fw-dialog-message');
    if (!message) return;
    if (result?.ok) {
      message.textContent = result.restartRequired ? '迁移已准备。请退出并重新打开 4.0.0。' :
        '已备份工作台、Codex 执行记录和 Vault 设置。备份目录 ' + result.directory;
      return;
    }
    message.textContent = result?.code === 'cancelled' ? '已取消' : reason(result);
  }

  function renderView(host) {
    if (!moduleViews.has(state.route)) return false;
    switch (state.route) {
      case 'dashboard': host.innerHTML = dashboard(); break;
      case 'projects-center': host.innerHTML = projectsCenter(); break;
      case 'project': host.innerHTML = projectDetail(); break;
      case 'graph': host.replaceChildren(); break;
      case 'notes':
        if (!$('#fw-note-editor', host) || !notes.dirty || !$('#fw-note-project', host)) {
          host.innerHTML = markdownView();
          fillNoteTree();
          fillNoteEditor();
          if (!notes.list) fetchNotes();
        }
        break;
      case 'materials': host.innerHTML = materialView(); fetchMaterials(false); break;
      case 'activity': host.innerHTML = activityPage(); break;
    }
    loadVisibleCodexPending();
    return true;
  }

  function changeTask(id, newStatus) {
    const task = DB.tasks.find(item => item.id === id);
    if (!task || !taskLabels[newStatus]) return;
    const oldStatus = task.st;
    if (oldStatus === newStatus) return;
    mutate(() => { task.st = newStatus; }, { activity: { text: '更新任务状态 · ' + esc(task.t), kind: 'edit', projectId: task.p, objectId: id }, immediate: true });
    showTask(id);
  }

  document.addEventListener('click', async event => {
    const node = event.target.closest('[data-full]');
    if (!node || node.disabled) return;
    const value = node.value;
    switch (node.dataset.full) {
      case 'config': configDialog(); break;
      case 'choose-vault': {
        const status = $('#fw-vault-status');
        if (!status) break;
        const result = await api.vault?.choose().catch(() => null);
        if (status.isConnected && result?.code !== 'cancelled') {
          status.textContent = result?.ok ? '目录已保存，重新打开工作台后生效。' : reason(result);
        }
        break;
      }
      case 'import': await migrateWorkspace(api.importWorkspace); break;
      case 'migrate-profile': await migrateWorkspace(api.migration.profile); break;
      case 'migration-backup': await migrateWorkspace(api.migration.backup); break;
      case 'search': openSearch(); break;
      case 'close-dialog': $('#fw-dialog')?.close(); break;
      case 'search-result': chooseSearch(searchResults.get(value)); break;
      case 'project': project(value); break;
      case 'project-tab': projectTab = value; render(); break;
      case 'takeover': openTakeover(value); break;
      case 'takeover-preview': await startTakeover(node); break;
      case 'takeover-resume': await resumeTakeover(value); break;
      case 'takeover-rescan': await rescanTakeover(); break;
      case 'takeover-abandon': await abandonTakeover(); break;
      case 'takeover-page': await takeoverPage(Number(value)); break;
      case 'takeover-apply': await applyTakeover(); break;
      case 'task-filter': activity.projectId = ''; activity.status = value; go('activity'); break;
      case 'all-todos': showTodos(); break;
      case 'todo-status': {
        const todo = DB.todos?.[Number(value)];
        if (todo) { mutate(() => { todo.done = !todo.done; }, { immediate: true }); showTodos(); }
        break;
      }
      case 'show-outcomes': dialog('已登记成果', outcomeRows(value, { manage: Boolean(value) }), 'fw-task-dialog'); break;
      case 'task-link-outcome': updateTaskOutcome(value, $('#fw-task-outcome')?.value, true); break;
      case 'task-unlink-outcome': updateTaskOutcome(node.dataset.taskId, value, false); break;
      case 'task-open-material': $('#fw-dialog')?.close(); showMaterials(node.dataset.projectId, value); break;
      case 'material-link-task': linkMaterialToTask(value); break;
      case 'material-task-confirm': confirmMaterialTask(value); break;
      case 'codex-bind-project': await bindProjectSession(node); break;
      case 'codex-artifact': await useCodexArtifact(node); break;
      case 'project-graph': showGraph({ rpmProjectId: rpmId(P(value)) }); break;
      case 'project-notes': await showNotes(value); break;
      case 'project-new-note': createNoteDialog(value); break;
      case 'central-notes':
        if (await openNote('', '')) { notes.filter = ''; render(); }
        break;
      case 'task-materials': $('#fw-dialog')?.close(); showMaterials(value); break;
      case 'project-materials': showMaterials(value); break;
      case 'bind': await bindProject(value); break;
      case 'bind-confirm': await confirmBinding(value); break;
      case 'codex-project-refresh': await loadCodexPending(value, { force: true }); break;
      case 'codex-copy-root': {
        const result = await loadCodexPending(value);
        const status = node.closest('[data-fw-codex-pending-project]')?.querySelector('[data-fw-codex-action-note]');
        if (!status) break;
        if (!result?.root) status.textContent = '未取得可用的项目工作目录。';
        else status.textContent = (await Bridge.copy(result.root)).ok ? '已复制工作目录' : '无法复制工作目录';
        break;
      }
      case 'task': showTask(value); break;
      case 'codex-discover':
      case 'codex-bind':
      case 'codex-refresh':
      case 'codex-handoff': await codexAction(node.dataset.full, node); break;
      case 'task-edit': {
        $('#fw-dialog')?.close();
        const idx = DB.tasks.findIndex(task => task.id === value);
        if (idx >= 0) openTaskForm(idx);
        break;
      }
      case 'task-activity': {
        const task = DB.tasks.find(item => item.id === value);
        if (!task) break;
        $('#fw-dialog')?.close();
        activity.projectId = task.p; go('activity');
        break;
      }
      case 'refresh-materials': await fetchMaterials(true); break;
      case 'material-highlights': showMaterials(materials.projectId); break;
      case 'material-browse': {
        const active = P(state.project);
        materials.projectId ||= rpmId(active) ? active.id : DB.projects.find(p => rpmId(p))?.id || '';
        Object.assign(materials, { browse: true, category: '', categories: [], offset: 0, filter: '', query: '', focusId: '', selected: '' });
        render();
        break;
      }
      case 'material-page':
        materials.offset = Number(value);
        materials.selected = '';
        await fetchMaterials(false);
        break;
      case 'material-highlight': {
        const [projectId, id] = value.split(':');
        const rpm = rpmId(P(projectId));
        if (!rpm || !materials.rows.get(projectId)?.files?.some(file => file.file_id === id)) break;
        const current = highlightedMaterials(projectId);
        if (current.length >= 30 && !current.some(entry => entry.id === id)) {
          const message = $('#fw-material-message');
          if (message) message.textContent = '此项目已有 30 项重点资料，请先移除一项。';
          break;
        }
        mutate(() => {
          DB.settings.materialHighlights ||= {};
          DB.settings.materialHighlights[rpm] = current.some(entry => entry.id === id) ?
            current.filter(entry => entry.id !== id) : [...current, { id }];
        }, { immediate: true });
        break;
      }
      case 'material':
        materials.selected = value;
        updateMaterials();
        if (!event.detail) $('#fw-material-list')?.querySelectorAll('[data-full="material"]').forEach(row => { if (row.value === value) row.focus(); });
        break;
      case 'material-copy-id': {
        const material = [...materials.rows].flatMap(([projectId, result]) =>
          (result.files || []).map(file => ({ projectId, id: file.file_id })))
          .find(item => item.projectId + ':' + item.id === value);
        if (!material?.id) break;
        const result = await Bridge.copy(material.id);
        const message = $('#fw-material-message');
        if (message) message.textContent = result.ok ? '资料 ID 已复制，可粘贴到任务。' : reason(result);
        break;
      }
      case 'material-open':
      case 'material-reveal':
      case 'material-copy-path':
      case 'material-note':
      case 'material-graph': {
        const [projectId, id] = value.split(':');
        const row = materials.rows.get(projectId)?.files?.find(file => file.file_id === id || file.id === id);
        if (!row) break;
        if (node.dataset.full === 'material-note') {
          const scope = rpmId(P(projectId));
          if (scope) await openGraphNote(scope, id, row.relative_path, null);
          else await showNotes(projectId, row.relative_path);
        }
        else if (node.dataset.full === 'material-graph') showGraph({ rpmProjectId: rpmId(P(projectId)), fileId: id });
        else {
          const action = node.dataset.full.slice('material-'.length);
          const message = $('#fw-material-message');
          const result = await api.openMaterial({ projectId, id, action }).catch(() => ({ ok: false, message: '无法访问文件' }));
          if (message?.isConnected) message.textContent = result?.ok ?
            ({ open: '已打开原件', reveal: '已在资源管理器中定位', 'copy-path': '已复制完整路径' })[action] : reason(result);
        }
        break;
      }
      case 'note':
        await openNote(value);
        if (!event.detail) $('#fw-note-tree')?.querySelectorAll('[data-full="note"]').forEach(row => { if (row.value === value) row.focus(); });
        break;
      case 'follow-note': await followNote(value, node.dataset.noteWiki === 'true'); break;
      case 'note-backlinks': await loadBacklinks(); break;
      case 'note-graph-source': if (notes.graphSource) showGraph({ ...notes.graphSource, preserveSelection: true }); break;
      case 'new-note': createNoteDialog(); break;
      case 'compare-note': await compareNote(); break;
      case 'apply-note-merge': applyNoteMerge(); break;
      case 'rpm-original-choice': {
        const ref = rpmNoteRef();
        if (ref) await openRpmOriginal(ref, value);
        break;
      }
      case 'save-note': await saveNote(); break;
      case 'restore-note': await saveNote(value); break;
      case 'note-versions': await noteVersions(); break;
      case 'reload-note': await openNote(notes.path, notes.projectId, { reload: true }); break;
      case 'refresh-notes': await fetchNotes(); break;
      case 'note-mode': notes.mode = value; fillNoteEditor(); break;
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'fw-new-note') {
      event.preventDefault();
      void submitNewNote(event.target);
      return;
    }
    if (event.target.id === 'fw-material-search') {
      event.preventDefault();
      materials.query = materials.filter.trim();
      materials.browse = false;
      materials.focusId = materials.selected = '';
      render();
      return;
    }
    if (event.target.id !== 'fw-search-form') return;
    event.preventDefault();
    search($('#fw-search-input').value);
  });

  document.addEventListener('input', event => {
    const input = event.target;
    switch (input.id) {
      case 'fw-note-filter':
        notes.filter = input.value;
        clearTimeout(listTimer);
        listTimer = setTimeout(fetchNotes, 240);
        break;
      case 'fw-material-filter': materials.filter = input.value; break;
      case 'fw-note-editor':
        notes.text = input.value;
        notes.dirty = notes.text !== notes.file?.text;
        if (!notes.conflict) notes.message = '';
        fillNoteStatus();
        clearTimeout(previewTimer);
        const token = fileToken;
        previewTimer = setTimeout(() => {
          if (token !== fileToken) return;
          const preview = $('#fw-note-preview');
          if (preview) preview.innerHTML = markdownPreview(notes.text);
          fillNoteProperties();
          showPreviewImages(preview);
        }, 180);
        break;
    }
  });

  document.addEventListener('change', async event => {
    const input = event.target;
    const takeoverRow = input.matches?.('select') && input.closest('[data-takeover-path]');
    if (takeoverRow) {
      takeoverRow.querySelector('[data-takeover-purpose]').hidden = !input.value.startsWith('change:');
      await saveTakeoverDraft(input.closest('#fw-dialog'));
      return;
    }
    if (input.id === 'fw-takeover-high' || input.matches?.('[data-takeover-purpose] input')) {
      await saveTakeoverDraft(input.closest('#fw-dialog'));
      return;
    }
    switch (input.id) {
      case 'fw-note-project':
        if (await openNote('', input.value)) { notes.filter = ''; render(); }
        else input.value = notes.projectId;
        break;
      case 'fw-material-project':
        if (materials.browse) {
          Object.assign(materials, { projectId: input.value, category: '', categories: [], offset: 0, selected: '' });
          await fetchMaterials(false);
        } else showMaterials(input.value);
        break;
      case 'fw-material-category':
        Object.assign(materials, { category: input.value, offset: 0, selected: '' });
        await fetchMaterials(false);
        break;
      case 'fw-activity-project': activity.projectId = input.value; render(); break;
      case 'fw-task-status': activity.status = input.value; render(); break;
      case 'fw-takeover-filter': await takeoverPage(0, input.value); break;
      case 'fw-edit-task-status': changeTask(input.dataset.taskId, input.value); break;
    }
  });

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || authSt().status?.locked) return;
    if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if ($('#fw-search-input')) $('#fw-search-input').focus();
      else openSearch();
    } else if (event.key.toLowerCase() === 's' && state.route === 'notes') {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveNote();
    }
  }, true);

  api.markdown.onChange?.(noteChanged);
  if (api.markdown.references) setInterval(() => {
    if (state.route === 'notes' && notes.backlinks?.ok) void loadBacklinks(true);
  }, 3000);
  window.addEventListener('beforeunload', event => {
    if (!notes.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  Object.assign(VIEWS, Object.fromEntries([...moduleViews].filter(route => route !== 'project').map(route => [route, () => ''])));
  window.FullWorkspace = { enabled: true, sidebar, topbar, statusbar, renderView, syncGraph, task: showTask,
    note: showNotes, openGraphNote, openReferenceNote, referenceScopes, graph: showGraph, graphReady: syncGraph };
  void loadPendingTakeovers();
  if (api.codex) {
    api.codex.onChange?.(change => {
      if (change?.kind === 'pending') {
        loadVisibleCodexPending(change.projectId);
        return;
      }
      clearTimeout(codexUpdateTimer);
      codexUpdateTimer = setTimeout(loadCodexRuns, 100);
    });
    loadCodexRuns();
  }
})();
