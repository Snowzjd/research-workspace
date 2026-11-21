'use strict';

(function () {
  const api = window.workspace?.full;
  if (!api?.enabled) return;

  const routes = [
    ['dashboard', 'home', '工作总览'], ['projects-center', 'grid', '项目中心'], ['graph', 'layers', '知识图谱'],
    ['notes', 'book', '知识工作区'], ['materials', 'folder', '材料与成果'], ['activity', 'tasks', '任务与活动']
  ];
  const labels = Object.fromEntries(routes.map(([key, , label]) => [key, label]));
  const sourceNames = { workspace: '工作台', rpm: 'RPM 索引', vault: 'Obsidian Vault' };
  const taskLabels = { todo: '待处理', doing: '进行中', review: '待复核', done: '已完成' };
  const moduleViews = new Set([...Object.keys(labels), 'project']);
  const notes = { projectId: '', path: '', mode: 'split', filter: '', list: null, file: null, text: '', dirty: false, conflict: false, busy: false, versions: null, message: '' };
  const materials = { projectId: '', category: '', filter: '', selected: '', rows: new Map() };
  const activity = { projectId: '', status: 'all' };
  let projectTab = 'overview';
  let graphTarget = null;
  let searchResults = [];
  let searchRequest = 0;
  let codexRuns = [];
  let codexLoadState = 'loading';
  let codexListRequest = 0;
  let codexUpdateTimer;
  const codexPendingRequests = new Map();
  const knownNoteLinks = new Map();
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
    return '<aside class="fw-nav"><div class="fw-brand"><span aria-hidden="true">' + icon('flask') + '</span><strong>个人科研工程工作台</strong></div>' +
      '<nav aria-label="工作台导航">' + routes.map(([key, image, label]) =>
        '<button type="button" data-route="' + key + '" ' + (selected === key ? 'aria-current="page"' : '') + '>' + icon(image) + esc(label) + '</button>'
      ).join('') + '</nav><div class="fw-navfoot">' + btn('config', '', '本机连接与导入') + '</div></aside>';
  }

  function topbar() {
    return '<header class="fw-top"><div class="fw-crumb">科研工程工作台 <span aria-hidden="true">/</span> <strong>' +
      esc(labels[state.route] || (state.route === 'project' ? '项目中心' : '工作台')) + '</strong></div>' +
      w('search', '', 'id="fw-search-open" aria-keyshortcuts="Control+k"') + icon('search') + '全局搜索 <kbd>Ctrl K</kbd></button></header>';
  }

  function statusbar() {
    return '<footer class="fw-footer"><span>本机候选工作区</span><span>' + (api.version ? 'v' + esc(api.version) : '') + '</span></footer>';
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
    const percent = tasks.length ? Math.round(100 * complete / tasks.length) : 0;
    return w('project', project.id, 'class="fw-project-card"') + '<span class="fw-project-icon">' + icon('folder') + '</span>' +
      '<span class="fw-project-content"><strong>' + esc(projName(project)) + '</strong><small>' + esc(project.stage || '阶段未设置') +
      ' · ' + esc(mile.label || '无里程碑') + '</small>' +
      (!concise && project.desc ? '<span class="fw-description">' + esc(stripTags(project.desc)) + '</span>' : '') +
      '<progress aria-label="任务完成度" value="' + percent + '" max="100"></progress><small>' + complete + ' / ' + tasks.length +
      ' 项任务完成</small></span></button>';
  }

  function recentActivities(projectId = '', count = 8) {
    const records = (DB.activities || []).filter(item => !projectId || item.projectId === projectId).slice(0, count);
    return records.length ? '<ol class="fw-timeline">' + records.map(record =>
      '<li><span>' + esc(stripTags(record.t || record.text || record.title || record.label || '活动记录')) + '</span><small>' +
      esc(when(record.at || record.time || record.date)) + '</small></li>'
    ).join('') + '</ol>' : empty('暂无工作台活动');
  }

  function dashboard() {
    const tasks = DB.tasks;
    const rank = task => task.st === 'review' ? 0 : task.pri === 'high' ? 1 : task.st === 'doing' ? 2 : 3;
    const priority = tasks.filter(task => task.st !== 'done').sort((a, b) => rank(a) - rank(b)).slice(0, 6);
    const counts = [
      ['登记项目', DB.projects.length, 'projects-center'], ['未完成任务', tasks.filter(t => t.st !== 'done').length, 'activity'],
      ['待复核', tasks.filter(t => t.st === 'review').length, 'activity'], ['已完成任务', tasks.filter(t => t.st === 'done').length, 'activity']
    ];
    const stats = '<div class="fw-stats">' + counts.map(([label, count, route]) =>
      '<button type="button" class="fw-stat" data-route="' + route + '"><span>' + label + '</span><strong>' + count + '</strong></button>'
    ).join('') + '</div>';
    return page(heading('工作总览', '', routeBtn('projects-center', '查看项目')) + stats + '<div class="fw-two">' +
      panel('优先处理', priority.length ? priority.map(task => taskRow(task)).join('') : empty('暂无待处理任务'), routeBtn('activity', '全部任务')) +
      panel('项目进度', DB.projects.length ? DB.projects.slice(0, 5).map(p => projectCard(p, true)).join('') : empty('暂无工作台项目')) +
      panel('近期活动', recentActivities()) +
      panel('知识网络', '<p class="fw-empty">从 RPM 查看项目、知识节点及其证据关系。</p>', routeBtn('graph', '打开图谱')) +
      codexPanel() + '</div>');
  }

  function projectsCenter() {
    return page(heading('项目中心', DB.projects.length ? DB.projects.length + ' 个工作台项目' : '', '<button type="button" class="fw-button prominent" data-act="new-project">' + icon('plus') + '新建项目</button>') +
      (DB.projects.length ? '<div class="fw-project-list">' + DB.projects.map(p => projectCard(p)).join('') + '</div>' :
        panel('项目', empty('暂无项目。可以新建项目，或从「本机连接与导入」选择已有工作台数据。'))));
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
    const owner = ownerView(project);
    const schedule = scheduleView(project);
    const binding = rpmId(project);
    const fields = [
      ['项目 ID', project.id], ['负责人', owner.label], ['项目周期', schedule.label],
      ['RPM 登记', binding || '未绑定']
    ];
    const goal = project.goal || project.intro || project.desc;
    return panel('项目信息', (goal ? '<p>' + esc(stripTags(goal)) + '</p>' : empty('尚未登记项目目标')) +
      '<dl>' + fields.map(([label, value]) => '<dt>' + label + '</dt><dd>' + esc(value || '未填写') + '</dd>').join('') + '</dl>');
  }

  function projectDetail() {
    const p = P(state.project);
    if (!p) return projectsCenter();
    const tabs = [['overview', '概况'], ['tasks', '任务'], ['notes', '知识笔记'], ['materials', '材料与成果'], ['activity', '活动']];
    const content = {
      overview: () => '<div class="fw-two">' + projectSummary(p) + flowStepsCard(p) + codexPanel(p.id) + '</div>',
      tasks: () => panel('项目任务', (DB.tasks.filter(t => t.p === p.id).map(t => taskRow(t, false)).join('') || empty('暂无项目任务')),
        '<button type="button" class="fw-button prominent" data-act="new-task" data-p="' + esc(p.id) + '">' + icon('plus') + '新建任务</button>'),
      notes: () => panel('项目原件 Markdown', empty('在知识工作区打开项目中的 Markdown 原件。'), btn('project-notes', p.id, '打开项目笔记')),
      materials: () => panel('RPM 材料与成果', empty('按 RPM 文件索引查看项目材料、状态和可定位的原件。'), btn('project-materials', p.id, '查看项目材料')),
      activity: () => '<div class="fw-two">' + panel('项目活动', recentActivities(p.id, 20)) + codexPanel(p.id) + '</div>'
    }[projectTab] || (() => '');
    return page(heading(projName(p), (p.stage || '阶段未设置') + ' · ' + milestoneStats(p).label,
      routeBtn('projects-center', '返回项目中心') + '<button type="button" class="fw-button" data-act="edit-project" data-id="' + esc(p.id) + '">编辑项目</button>' +
      btn('bind', p.id, '绑定 RPM') + (rpmId(p) ? btn('project-graph', p.id, '查看项目图谱') : '')) +
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
      panel('工作台活动', recentActivities(scope, 25)) + codexPanel(scope) + '</div>');
  }

  function materialView() {
    return page(heading('材料与成果', 'RPM 文件索引', btn('refresh-materials', '', '刷新索引')) +
      '<div class="fw-controls">' + selectProjects('fw-material-project', '项目', materials.projectId, '全部项目') +
      '<label class="fw-select">搜索材料<input id="fw-material-filter" type="search" value="' + esc(materials.filter) + '" placeholder="文件名、分类、状态"></label>' +
      '<label class="fw-select">分类<select id="fw-material-category"></select></label></div>' +
      '<div class="fw-two fw-material-columns"><div id="fw-material-list"></div><aside id="fw-material-detail"></aside></div>');
  }

  async function fetchMaterials(force) {
    const ids = materials.projectId ? [materials.projectId] : DB.projects.map(p => p.id);
    const pending = ids.filter(id => force || !materials.rows.has(id));
    pending.forEach(id => materials.rows.set(id, { pending: true }));
    updateMaterials();
    for (let offset = 0; offset < pending.length; offset += 4) {
      await Promise.all(pending.slice(offset, offset + 4).map(async id => {
        let result;
        try { result = await window.workspace.rpmProjectFiles(id, { limit: 500 }); }
        catch (_) { result = { ok: false, code: 'unavailable' }; }
        materials.rows.set(id, result);
      }));
      updateMaterials();
    }
  }

  function updateMaterials() {
    const list = $('#fw-material-list');
    if (!list) return;
    const rowSets = [...materials.rows].filter(([id]) => P(id) && (!materials.projectId || id === materials.projectId));
    const all = rowSets.flatMap(([projectId, result]) => (result.files || []).map(file => ({
      ...MaterialSource.fileRecord(file), projectId
    })));
    const categories = [...new Set(all.map(file => file.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const sel = $('#fw-material-category');
    sel.innerHTML = '<option value="">全部分类</option>' + categories.map(cat => '<option value="' + esc(cat) + '">' + esc(cat) + '</option>').join('');
    if (!categories.includes(materials.category)) materials.category = '';
    sel.value = materials.category;
    const query = materials.filter.toLowerCase();
    const filtered = all.filter(file => (!materials.category || materials.category === file.category) &&
      (!query || [file.n, file.relative_path, file.status, file.category].some(value => String(value).toLowerCase().includes(query))));
    const pending = rowSets.filter(([, result]) => result.pending).length;
    const unavailable = rowSets.filter(([, result]) => !result.pending && !result.ok && !['unbound', 'binding_missing'].includes(result.code)).length;
    const unbound = rowSets.filter(([, result]) => ['unbound', 'binding_missing'].includes(result.code)).length;
    const counts = [all.length + ' 个已读取文件', pending ? pending + ' 个项目读取中' : '',
      unavailable ? unavailable + ' 个项目读取失败' : '', unbound ? unbound + ' 个项目未绑定 RPM' : ''].filter(Boolean).join(' · ');
    const key = file => file.projectId + ':' + file.file_id;
    list.innerHTML = panel('索引文件', statusText(counts) + (filtered.map(file =>
      w('material', key(file), 'class="fw-row-button"') + '<span><strong>' + esc(file.n) + '</strong><small>' +
      esc(projectName(file.projectId)) + ' · ' + esc(file.category) + '</small></span><span class="fw-tag">' + esc(file.status || '状态未登记') + '</span></button>'
    ).join('') || empty(pending ? '正在读取 RPM 索引…' : '当前范围暂无索引材料')));
    const item = all.find(file => key(file) === materials.selected);
    $('#fw-material-detail').innerHTML = item ? panel('原件信息',
      '<h3 class="fw-material-name">' + esc(item.n) + '</h3><dl><dt>项目</dt><dd>' + esc(projectName(item.projectId)) + '</dd>' +
      '<dt>路径</dt><dd>' + esc(item.relative_path) + '</dd><dt>状态</dt><dd>' + esc(item.status || '状态未登记') + '</dd>' +
      (item.purpose ? '<dt>用途</dt><dd>' + esc(item.purpose) + '</dd>' : '') +
      (item.version ? '<dt>版本</dt><dd>' + esc(item.version) + '</dd>' : '') + '</dl>' +
      '<div class="fw-actions">' +
      (rpmId(P(item.projectId)) === 'd72165400fae48eb9466e8151cdd15e3' ? '<span class="fw-tag">仅显示原件元数据</span>' :
        btn('material-open', key(item), '打开原件') + (/\.md$|\.markdown$/i.test(item.relative_path) ? btn('material-note', key(item), '在工作区打开') : '')) +
      btn('material-graph', key(item), '在图谱中定位') + btn('material-copy-id', key(item), '复制资料 ID') +
      '</div><p class="fw-reference-id">资料 ID <code>' + esc(item.file_id) +
      '</code></p><div id="fw-material-message" role="status"></div>') :
      panel('原件信息', empty('选择索引文件查看详情'));
  }
  function markdownView() {
    return page(heading('知识工作区', '', btn('refresh-notes', '', '刷新目录')) +
      '<div class="fw-controls">' + selectProjects('fw-note-project', '笔记来源', notes.projectId, '中央 Obsidian Vault') +
      '<label class="fw-select">搜索文件<input id="fw-note-filter" type="search" value="' + esc(notes.filter) + '" placeholder="文件名或相对路径"></label></div>' +
      '<div class="fw-note-layout"><aside class="fw-note-sidebar" aria-label="Markdown 文件目录"><h2>文件目录</h2><div id="fw-note-tree"></div></aside>' +
      '<section class="fw-note-main"><div id="fw-note-toolbar"></div><div id="fw-note-status"></div><div id="fw-note-content"></div></section>' +
      '<aside class="fw-note-properties" aria-label="笔记属性"><h2>笔记属性</h2><div id="fw-note-properties"></div></aside></div>');
  }

  function noteArgs(projectId = notes.projectId, path = notes.path) {
    return { projectId: projectId || undefined, path };
  }

  let listToken = 0, fileToken = 0, listTimer = null;
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
    if (!notes.list.ok) { tree.innerHTML = empty(reason(notes.list)); return; }
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
    if (notes.path && (switching || reload)) void api.markdown.unwatch(noteArgs()).catch(() => {});
    const changedSource = notes.projectId !== projectId;
    Object.assign(notes, { path, projectId, file: null, text: '', dirty: false, conflict: false, versions: null, message: path ? '正在读取原件…' : '' });
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

  function markdownPreview(value) {
    const content = document.createElement('div');
    const blocks = String(value || '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/);
    let code = null;
    let list = null;
    for (const line of blocks) {
      if (/^\s*```/.test(line)) {
        if (code) code = null;
        else { code = document.createElement('pre'); content.append(code); }
        list = null;
        continue;
      }
      if (code) { code.textContent += line + '\n'; continue; }
      const headingMatch = /^(#{1,6})\s+(.+)/.exec(line);
      const bullet = /^(?:\s*)(?:[-*+]\s+|\d+\.\s+)(.+)/.exec(line);
      if (bullet && !list) { list = document.createElement('ul'); content.append(list); }
      if (!bullet) list = null;
      if (!line.trim()) continue;
      const el = document.createElement(headingMatch ? 'h' + headingMatch[1].length : bullet ? 'li' : line.startsWith('>') ? 'blockquote' : 'p');
      const plain = headingMatch?.[2] || bullet?.[1] || line.replace(/^>\s?/, '');
      el.innerHTML = esc(plain).replace(/`([^`\r\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[\[([^\]]+)\]\]/g, '<span class="fw-wikilink">$1</span>');
      (list || content).append(el);
    }
    return content.innerHTML;
  }

  function localNoteTarget(target, sourcePath = notes.path) {
    const name = target.trim().replace(/\\/g, '/').split('#')[0];
    if (!name || name.includes(':') || name.split('/').some(part => part === '..')) return '';
    const files = notes.list?.files || [];
    const withExt = /\.(md|markdown)$/i.test(name) ? name : name + '.md';
    const direct = files.find(file => file.path === withExt);
    if (direct) return direct.path;
    const parent = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
    const nearby = files.find(file => file.path === parent + withExt);
    if (nearby) return nearby.path;
    const matches = files.filter(file => file.path.split('/').pop() === withExt);
    return matches.length === 1 ? matches[0].path : '';
  }

  function internalLinks(text) {
    return [...new Set([...text.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]|\[[^\]]*\]\(([^\s)]+\.md(?:#[^\s)]+)?)\)/g)].map(hit => hit[1] || hit[2]))];
  }

  function fillNoteStatus() {
    const status = $('#fw-note-status');
    if (!status) return;
    status.innerHTML = statusText(notes.message || (notes.dirty ? '未保存修改' : notes.file ? (notes.file.readOnly || notes.file.readonly ? '只读原件' : '与原件一致') : ''));
    const save = $('[data-full="save-note"]');
    if (save) save.disabled = Boolean(!notes.dirty || notes.busy || notes.conflict || notes.file?.readOnly || notes.file?.readonly);
    const editor = $('#fw-note-editor');
    if (editor) editor.readOnly = Boolean(notes.busy || notes.file?.readOnly || notes.file?.readonly);
  }

  function fillNoteProperties() {
    const area = $('#fw-note-properties');
    if (!area) return;
    if (!notes.file) { area.innerHTML = empty('打开文件后显示路径和链接'); return; }
    const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(notes.text)?.[1];
    const links = internalLinks(notes.text);
    const scope = notes.projectId + ':';
    knownNoteLinks.set(scope + notes.path, links);
    const backlinks = [...knownNoteLinks].filter(([key, urls]) => key.startsWith(scope) && key !== scope + notes.path &&
      urls.some(url => localNoteTarget(url, key.slice(scope.length)) === notes.path));
    area.innerHTML = '<div class="fw-note-path">' + esc(notes.path) + '</div>' +
      (yaml ? '<h3>YAML</h3><pre>' + esc(yaml.slice(0, 1800)) + '</pre>' : '') +
      '<h3>出链</h3>' + (links.length ? links.map(link => {
        const path = localNoteTarget(link);
        return path ? btn('note', path, link) : '<small class="fw-note-path">' + esc(link) + '</small>';
      }).join('') : empty('暂无笔记链接')) +
      '<h3>反链 · 本次打开的笔记</h3>' + (backlinks.length ? backlinks.map(([key]) => {
        const path = key.slice(scope.length);
        return btn('note', path, path);
      }).join('') : empty('暂未发现')) +
      '<h3>版本</h3>' + (notes.versions ? notes.versions.map(version => btn('restore-note',
        version.id || version.versionId, '恢复 ' + when(version.mtime || version.at || version.createdAt || version.id))
      ).join('') || empty('暂无工作台版本') : btn('note-versions', '', '查看保存历史'));
  }

  function fillNoteEditor() {
    const toolbar = $('#fw-note-toolbar'), content = $('#fw-note-content');
    if (!toolbar || !content) return;
    const file = notes.file;
    toolbar.innerHTML = file ? '<div class="fw-note-heading"><strong>' + esc(notes.path.split(/[\\/]/).pop()) + '</strong><div class="fw-actions">' +
      [['edit', '编辑'], ['split', '分栏'], ['read', '阅读']].map(([mode, label]) =>
        btn('note-mode', mode, label, 'aria-pressed="' + (notes.mode === mode) + '"')
      ).join('') + btn('reload-note', '', '重读原件') + btn('save-note', '', '保存', 'aria-keyshortcuts="Control+s"') + '</div></div>' : '';
    content.className = file ? 'fw-note-content fw-note-' + notes.mode : '';
    content.innerHTML = file ? (notes.mode !== 'read' ? '<textarea id="fw-note-editor" aria-label="Markdown 原文" spellcheck="false"' +
      (file.readOnly || file.readonly ? ' readonly' : '') + '></textarea>' : '') +
      (notes.mode !== 'edit' ? '<article class="fw-markdown" id="fw-note-preview" aria-label="Markdown 预览">' + markdownPreview(notes.text) + '</article>' : '') :
      empty(notes.path ? (notes.message || '正在读取原件…') : '从文件目录选择一个 Markdown 原件');
    const editor = $('#fw-note-editor');
    if (editor) editor.value = notes.text;
    fillNoteStatus();
    fillNoteProperties();
  }

  async function saveNote(versionId) {
    if (!notes.file || notes.busy || notes.conflict || (notes.file.readOnly || notes.file.readonly)) return;
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
      window.KnowledgeNetwork.refresh?.();
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
    if (notes.dirty) {
      notes.conflict = true;
      notes.message = '原件已在外部变化。请保留当前修改内容，再点击「重读原件」处理冲突。';
      fillNoteStatus();
    } else {
      if (await openNote(notes.path, notes.projectId, { reload: true })) {
        notes.message = '已同步外部修改';
        fillNoteStatus();
      }
    }
  }

  const codexStatuses = {
    pending: '待执行', running: '执行中', waiting: '等待用户输入', paused: '暂停',
    completed: 'Codex 回合结束', failed: '执行失败', cancelled: '已取消', unknown: '状态待核对'
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
      const files = (run.files || []).map(file =>
        '<li>' + esc(codexFileChanges[file.kind] || '变更') + ' <code>' + esc(file.path) + '</code>' +
        (typeof file.present === 'boolean' ? ' · ' + (file.present ? '磁盘可见' : '当前未找到') : '') + '</li>').join('');
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
        '</p><p>Codex 会话 <code>' + esc(run.sessionId) + '</code></p>' +
        (run.directory ? '<p>会话目录 ' + esc(run.directory === '.' ? '项目根目录' : run.directory) + '</p>' : '') +
        (duration ? '<p>' + esc(duration) + '</p>' : '') +
        '<p>工作台任务状态：' + esc(taskLabels[task?.st] || '未登记') + '。用户验收由工作台另行确认。</p>' +
        (timeline ? '<h3>最近执行活动</h3><ol class="fw-run-items">' + timeline + '</ol>' : '') +
        (files ? '<h3>Codex 报告的文件变更</h3><ul class="fw-run-items">' + files + '</ul>' : '') +
        (checks ? '<h3>执行检查</h3><ul class="fw-run-items">' + checks + '</ul>' : '') +
        (!taskId && task ? '<div class="fw-actions">' + btn('task', task.id, '查看任务详情') + '</div>' : '') +
        '</details>';
    }).join('');
  }

  function codexTarget(projectId = '', taskId = '') {
    return '<div data-fw-codex-rows data-project-id="' + esc(projectId) +
      '" data-task-id="' + esc(taskId) + '">' + codexRows(projectId, taskId) + '</div>';
  }

  function codexPanel(projectId = '') {
    if (!api.codex) return '';
    const scopes = projectId ? [P(projectId)].filter(Boolean) : DB.projects.filter(project => rpmId(project));
    const pending = scopes.map(project =>
      '<div data-fw-codex-pending-project="' + esc(project.id) + '"' + (projectId ? '' : ' data-fw-codex-summary hidden') + '>' +
      (projectId ? '' : btn('project', project.id, projectName(project.id))) +
      '<p class="fw-status" data-fw-codex-pending-note role="status">正在核对本项目会话…</p></div>').join('');
    return panel('Codex 执行情况', pending + codexTarget(projectId));
  }

  function codexTaskControls(task) {
    if (!api.codex || !P(task.p)) return '';
    return '<section class="fw-codex-task" data-fw-codex-task data-task-id="' + esc(task.id) +
      '" data-project-id="' + esc(task.p) + '" data-fw-codex-pending-project="' + esc(task.p) + '"><h3>Codex 执行</h3>' +
      '<div class="fw-actions">' + btn('codex-discover', task.id, '刷新待关联会话') +
      btn('codex-refresh', task.id, '核对会话状态') + btn('codex-handoff', task.id, '复制 Codex 交接') +
      '</div><p>工作台自动核对该 RPM 项目及归属明确的子目录会话。请确认任务归属后关联。</p>' +
      '<p data-fw-codex-status class="fw-status" role="status"></p>' +
      '<p data-fw-codex-pending-note class="fw-status" role="status">正在核对本项目会话…</p><div data-fw-codex-sessions></div>' +
      codexTarget(task.p, task.id) + '</section>';
  }

  function renderCodexPending(projectId, result, busySection) {
    for (const target of document.querySelectorAll('[data-fw-codex-pending-project]')) {
      if (target.dataset.fwCodexPendingProject !== projectId ||
          (target !== busySection && target.getAttribute('aria-busy') === 'true')) continue;
      const note = target.querySelector('[data-fw-codex-pending-note]');
      const sessions = target.querySelector('[data-fw-codex-sessions]');
      const rows = result?.ok ? result.sessions || [] : [];
      if (target.hasAttribute('data-fw-codex-summary')) target.hidden = rows.length === 0;
      const message = result?.ok
        ? (rows.length
            ? rows.length + ' 个待关联会话' + (sessions ? '，请选择对应会话。' : '。打开任务详情进行关联。')
            : '暂无属于本项目目录的待关联会话。')
        : reason(result);
      const mode = result?.ok && result.notificationMode === 'filesystem-signal'
        ? ' 会话日志变化会触发核对。' : result?.ok ? ' 当前使用定时核对。' : '';
      if (note.textContent !== message + mode) note.textContent = message + mode;
      if (!sessions) continue;
      const focused = document.activeElement;
      const selectedId = sessions.contains(focused) ? focused.value : '';
      const markup = rows.map(session =>
        '<div class="fw-codex-session"><div>' + (session.name ? '<strong>' + esc(session.name) + '</strong>' : '') +
        '<code>' + esc(session.sessionId) + '</code><small>' +
        esc([session.directory && session.directory !== '.' ? session.directory : '项目根目录',
          codexStatus(session), when(session.updatedAt)].filter(Boolean).join(' · ')) + '</small></div>' +
        btn('codex-bind', session.sessionId, '关联会话') + '</div>').join('');
      if (sessions.innerHTML === markup) continue;
      sessions.innerHTML = markup;
      if (selectedId) [...sessions.querySelectorAll('[data-full="codex-bind"]')]
        .find(button => button.value === selectedId)?.focus();
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
        const saved = await flushSave();
        if (!saved?.ok) { status.textContent = '任务尚未保存，请重试。'; return; }
        const result = await api.codex.bind({ projectId, taskId, sessionId: button.value });
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
      statusText('仅检索本机结构化记录。RAG 全文检索留待后续版本。') + '<div id="fw-search-sources"></div><div id="fw-search-results">' + empty('输入关键词，按回车检索。') + '</div>', 'fw-search-dialog');
    $('#fw-search-input').focus();
  }

  async function search(query) {
    const sequence = ++searchRequest;
    const target = $('#fw-search-results');
    if (!target) return;
    target.innerHTML = statusText('正在检索本机来源…');
    $('#fw-search-sources').replaceChildren();
    let result;
    try { result = await api.search({ query }); } catch (_) { result = { ok: false, message: '搜索服务不可用' }; }
    if (!target.isConnected || sequence !== searchRequest) return;
    if (!result?.ok) { target.innerHTML = empty(reason(result)); return; }
    searchResults = result.results || [];
    const codes = {
      partial: '部分结果', unbound: '未绑定', unavailable: '连接不可用', root_missing: '目录不可用'
    };
    $('#fw-search-sources').innerHTML = '<div class="fw-source-state" role="status">' + Object.entries(result.sources || {}).map(([key, source]) =>
      '<span class="fw-tag">' + esc(sourceNames[key] || key) + ' · ' +
      esc(source.ok ? source.count + ' 条' : (codes[source.code] || '不可用') + (source.count ? '（' + source.count + ' 条）' : '')) + '</span>'
    ).join('') + '</div>';
    target.innerHTML = searchResults.map((item, idx) =>
      '<div class="fw-search-result">' + w('search-result', idx, 'class="fw-row-button"') + '<span><strong>' +
      esc(item.title || item.path || '无标题') + '</strong><small>' + esc(item.detail || item.path || '') +
      '</small></span><span class="fw-tag">' + esc(sourceNames[item.source] || item.source) + '</span></button></div>'
    ).join('') || empty('没有匹配结果');
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
      await promise;
    }
  }

  function showTask(id) {
    const index = DB.tasks.findIndex(task => task.id === id);
    if (index < 0) return;
    const task = DB.tasks[index], p = P(task.p);
    const title = task.t || '任务';
    const info = '<div class="fw-source-state">' + stChip(task.st) + priTag(task.pri) + '<span class="fw-tag">' +
      esc(projectName(task.p)) + '</span></div><dl><dt>截止日期</dt><dd>' + esc(parseTaskDate(task.due).label) +
      '</dd><dt>负责人</dt><dd>' + esc(task.agent || task.owner || '未指定') + '</dd>' +
      (task.tool ? '<dt>执行工具</dt><dd>' + esc(task.tool) + '</dd>' : '') +
      (task.dir ? '<dt>材料目录</dt><dd>' + esc(task.dir) + '</dd>' : '') + '</dl>';
    const more = [
      ['完成条件', task.acceptance || task.completionCriteria || task.definitionOfDone],
      ['待确认', task.openQuestions || task.pending || task.blockers],
      ['说明', task.description || task.note || task.notes]
    ].filter(([, value]) => value && (typeof value === 'string' || Array.isArray(value))).map(([label, value]) =>
      '<h3>' + esc(label) + '</h3><p>' + esc(Array.isArray(value) ? value.map(row => typeof row === 'string' ? row : row?.title || row?.text || '').join('、') : value) + '</p>'
    ).join('');
    const choose = '<label class="fw-select">任务状态<select id="fw-edit-task-status" data-task-id="' + esc(id) + '">' +
      Object.entries(taskLabels).map(([key, label]) => '<option value="' + key + '"' + (key === task.st ? ' selected' : '') + '>' + label + '</option>').join('') +
      '</select></label>';
    const links = '<div class="fw-actions">' + btn('task-edit', id, '编辑任务') +
      (p ? btn('task-activity', id, '查看项目活动') + btn('task-materials', p.id, '查看项目材料') : '') + '</div>';
    dialog(title, info + more + choose + links + codexTaskControls(task));
    loadVisibleCodexPending(task.p);
  }

  async function bindProject(projectId) {
    if (!P(projectId)) return;
    const node = dialog('绑定现有 RPM 项目', statusText('正在读取 RPM 登记…'));
    try {
      const result = await api.rpmProjects();
      if (!node.isConnected) return;
      const rows = result?.projects || [];
      node.querySelector('[role="status"]').textContent = result?.ok ? (rows.length ? '选择 RPM 中已登记的项目。' : '当前没有可绑定的登记项目。') : reason(result);
      if (!result?.ok || !rows.length) return;
      const rootList = document.createElement('div');
      rootList.innerHTML = '<label class="fw-select">已登记项目<select id="fw-bind-target">' + rows.map(row =>
        '<option value="' + esc(row.rpmProjectId) + '">' + esc(row.rpmRoot || row.rpmProjectId) + '</option>'
      ).join('') + '</select></label>' + btn('bind-confirm', projectId, '保存绑定') + '<p id="fw-dialog-message" role="status"></p>';
      node.append(rootList);
    } catch (_) {
      if (node.isConnected) node.querySelector('[role="status"]').textContent = '无法读取 RPM 登记';
    }
  }

  async function confirmBinding(projectId) {
    try {
      const rpmProjectId = $('#fw-bind-target').value;
      const result = await api.rpmBinding({ rpmProjectId });
      if (!result?.ok || !result.binding || !P(projectId)) {
        $('#fw-dialog-message').textContent = reason(result);
        return;
      }
      mutate(() => {
        DB.settings.rpmBindings ||= {};
        DB.settings.rpmBindings[projectId] = result.binding;
        const project = P(projectId);
        delete project.rpmProjectId;
        delete project.rpmRoot;
      }, { activity: { text: '更新 RPM 已登记项目绑定', kind: 'edit', projectId }, immediate: true });
      materials.rows.delete(projectId);
      window.KnowledgeNetwork.refresh?.();
      $('#fw-dialog')?.close();
    } catch (_) {
      if ($('#fw-dialog-message')) $('#fw-dialog-message').textContent = '无法保存 RPM 绑定';
    }
  }

  function configDialog() {
    const node = dialog('本机连接与导入',
      '<section class="fw-connection"><h3>本机 API</h3><p id="fw-local-status" role="status">正在读取状态…</p></section>' +
      '<section class="fw-connection"><h3>中央 Markdown Vault</h3><p id="fw-vault-status" role="status">正在读取状态…</p>' +
      btn('choose-vault', '', '选择中央 Vault') + '</section>' +
      '<section class="fw-connection"><h3>工作台数据</h3><p>选择已有 workspace-data.json 导入候选目录。现有候选数据会先备份。</p>' +
      btn('import', '', '选择工作台数据文件') + '<p id="fw-dialog-message" role="status"></p></section>');
    api.vault?.status().then(result => {
      const status = node.querySelector('#fw-vault-status');
      if (node.isConnected) status.textContent = result?.bound ? '已连接。更换目录后需重启候选。' : '未连接，可选择已有 Vault。';
    }).catch(() => { if (node.isConnected) node.querySelector('#fw-vault-status').textContent = '无法读取 Vault 状态'; });
    Promise.resolve(api.status()).then(result => {
      if (!node.isConnected) return;
      const local = node.querySelector('#fw-local-status');
      local.textContent = result?.apiReady ? '监听本机端口 ' + result.apiPort : '候选 API 当前未监听';
    }).catch(() => { if (node.isConnected) node.querySelector('#fw-local-status').textContent = '当前不可用'; });
  }

  async function importWorkspace() {
    if (notes.dirty) { $('#fw-dialog-message').textContent = '请先保存当前 Markdown 修改。'; return; }
    let result;
    try {
      const flushed = await flushSave();
      result = flushed?.ok ? await api.importWorkspace() : flushed;
    } catch (_) { result = { ok: false, message: '无法导入候选数据' }; }
    if (result?.ok) { location.reload(); return; }
    if ($('#fw-dialog-message')) $('#fw-dialog-message').textContent = result?.code === 'cancelled' ? '已取消' : reason(result);
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
          status.textContent = result?.ok ? '目录已保存，关闭并重启候选后生效。' : reason(result);
        }
        break;
      }
      case 'import': await importWorkspace(); break;
      case 'search': openSearch(); break;
      case 'close-dialog': $('#fw-dialog')?.close(); break;
      case 'search-result': chooseSearch(searchResults[Number(value)]); break;
      case 'project': project(value); break;
      case 'project-tab': projectTab = value; render(); break;
      case 'project-graph': showGraph({ rpmProjectId: rpmId(P(value)) }); break;
      case 'project-notes': await showNotes(value); break;
      case 'task-materials': $('#fw-dialog')?.close(); showMaterials(value); break;
      case 'project-materials': showMaterials(value); break;
      case 'bind': await bindProject(value); break;
      case 'bind-confirm': await confirmBinding(value); break;
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
      case 'material-note':
      case 'material-graph': {
        const [projectId, id] = value.split(':');
        const row = materials.rows.get(projectId)?.files?.find(file => file.file_id === id || file.id === id);
        if (!row) break;
        if (node.dataset.full === 'material-note') await showNotes(projectId, row.relative_path);
        else if (node.dataset.full === 'material-graph') showGraph({ rpmProjectId: rpmId(P(projectId)), fileId: id });
        else {
          const result = await api.openMaterial({ projectId, id }).catch(() => ({ ok: false, message: '无法打开原件' }));
          if ($('#fw-material-message')) $('#fw-material-message').textContent = result?.ok ? '已打开原件' : reason(result);
        }
        break;
      }
      case 'note':
        await openNote(value);
        if (!event.detail) $('#fw-note-tree')?.querySelectorAll('[data-full="note"]').forEach(row => { if (row.value === value) row.focus(); });
        break;
      case 'save-note': await saveNote(); break;
      case 'restore-note': await saveNote(value); break;
      case 'note-versions': await noteVersions(); break;
      case 'reload-note': await openNote(notes.path, notes.projectId, { reload: true }); break;
      case 'refresh-notes': await fetchNotes(); break;
      case 'note-mode': notes.mode = value; fillNoteEditor(); break;
    }
  });

  document.addEventListener('submit', event => {
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
      case 'fw-material-filter': materials.filter = input.value; updateMaterials(); break;
      case 'fw-note-editor':
        notes.text = input.value;
        notes.dirty = true;
        if (!notes.conflict) notes.message = '';
        if ($('#fw-note-preview')) $('#fw-note-preview').innerHTML = markdownPreview(notes.text);
        fillNoteStatus();
        fillNoteProperties();
        break;
    }
  });

  document.addEventListener('change', async event => {
    const input = event.target;
    switch (input.id) {
      case 'fw-note-project':
        if (await openNote('', input.value)) { notes.filter = ''; render(); }
        else input.value = notes.projectId;
        break;
      case 'fw-material-project':
        materials.projectId = input.value; materials.category = ''; materials.selected = ''; await fetchMaterials(false); break;
      case 'fw-material-category': materials.category = input.value; updateMaterials(); break;
      case 'fw-activity-project': activity.projectId = input.value; render(); break;
      case 'fw-task-status': activity.status = input.value; render(); break;
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
  window.addEventListener('beforeunload', event => {
    if (!notes.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  Object.assign(VIEWS, Object.fromEntries([...moduleViews].filter(route => route !== 'project').map(route => [route, () => ''])));
  window.FullWorkspace = { enabled: true, sidebar, topbar, statusbar, renderView, syncGraph, task: showTask,
    note: showNotes, graph: showGraph, graphReady: syncGraph };
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
