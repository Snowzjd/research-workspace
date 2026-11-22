'use strict';
/* 复用已完成的 Cytoscape 知识网络原型交互，数据源改为 RPM 只读快照。 */
(function (root) {
  const SHELL_HTML = "\n<header class=\"appbar\">\n  <div class=\"brand\"><span class=\"brand-mark\" aria-hidden=\"true\"><i></i><i></i><i></i></span>\n    <div><strong>科研知识网络</strong><span>RPM 2.0 · 正式接入</span></div>\n  </div>\n  <label class=\"top-search\"><span aria-hidden=\"true\" class=\"search-icon\"></span>\n    <input id=\"search\" type=\"search\" placeholder=\"搜索节点、任务或文件\" aria-label=\"搜索节点、任务或文件\">\n    <kbd>/</kbd>\n  </label>\n  <div class=\"header-actions\">\n    <button type=\"button\" id=\"refresh\" class=\"primary\"><span aria-hidden=\"true\">↻</span> 刷新图谱</button>\n  </div>\n  <div id=\"search-results\" class=\"search-results\" hidden></div>\n</header>\n\n<div class=\"shell\">\n  <aside class=\"sidebar\" aria-label=\"项目和图谱筛选\">\n    <section class=\"side-section projects-section\">\n      <h2>登记项目 <span id=\"project-count\"></span></h2>\n      <div id=\"project-list\" class=\"project-list\"></div>\n    </section>\n    <section class=\"side-section filters-section\">\n      <div class=\"side-head\"><h2>图谱筛选</h2><button class=\"text-btn\" id=\"clear-filters\">重置</button></div>\n      <span class=\"field-caption\" id=\"kind-hint\">节点类型</span>\n      <div id=\"kinds\" class=\"kind-list\" aria-labelledby=\"kind-hint\"></div>\n      <label class=\"field-caption select-label\" for=\"direction-filter\">研究方向</label>\n      <select id=\"direction-filter\" aria-label=\"研究方向\"></select>\n      <label class=\"field-caption select-label\" for=\"relation\">关系类型</label>\n      <select id=\"relation\" aria-label=\"关系类型\"></select>\n      <label class=\"toggle-row\"><input type=\"checkbox\" id=\"sources\"> 显示来源节点</label>\n    </section>\n    <section class=\"side-section snapshot-section\">\n      <div class=\"live-marker\"><span></span> RPM 只读快照</div>\n      <small id=\"snapshot-status\"></small>\n      <button type=\"button\" id=\"changes\" class=\"text-btn latest-changes\" hidden>查看本次变化</button>\n      \n    </section>\n  </aside>\n\n  <main class=\"main\">\n    <div class=\"view-header\">\n      <nav class=\"view-tabs\" aria-label=\"展示层级\">\n        <button data-view=\"global\">全局项目</button>\n        <button data-view=\"project\">项目研究</button>\n        <button data-view=\"relation\">研究关系</button>\n      </nav>\n      <div id=\"flow\" class=\"flow\"></div>\n      <div class=\"view-heading\"><div><h1 id=\"title\"></h1><p id=\"subtitle\"></p></div></div>\n      <div class=\"metrics\" id=\"metrics\"></div>\n    </div>\n    <section class=\"network-card\" aria-label=\"知识图谱\">\n      <div class=\"network-top\">\n        <div><span class=\"graphic-dot\"></span><strong id=\"network-title\"></strong><span id=\"graph-count\" class=\"graph-count\"></span></div>\n        <div class=\"net-actions\"><select id=\"global-filter\" aria-label=\"筛选项目\" hidden></select><label id=\"depth-group\" hidden>关系深度 <select id=\"depth\" aria-label=\"关系深度\"><option value=\"1\">1 层</option><option value=\"2\">2 层</option><option value=\"3\">3 层</option></select></label>\n          <button id=\"layout\" class=\"quiet compact\">自动布局</button></div>\n      </div>\n      <div id=\"lanes\" class=\"lanes\" aria-hidden=\"true\"></div>\n      <div class=\"graph-area\"><div id=\"graph\" aria-label=\"交互式节点与关系\"></div>\n        <div id=\"empty-graph\" hidden></div>\n        <div class=\"zoom-controls\" aria-label=\"图谱缩放\">\n          <button id=\"zoom-out\" aria-label=\"缩小\">−</button><button id=\"fit\" aria-label=\"适应画布\">⊡</button><button id=\"zoom-in\" aria-label=\"放大\">+</button>\n        </div>\n      </div>\n      <div class=\"network-footer\"><span id=\"legend\" class=\"legend\"></span><span class=\"guide\">拖动节点 · 滚轮缩放 · 点击查看详情</span></div>\n    </section>\n  </main>\n\n  <aside class=\"inspector\" aria-label=\"图谱详情\">\n    <div class=\"inspect-header\"><div><span class=\"inspect-icon\" aria-hidden=\"true\">⊙</span><strong id=\"inspect-caption\">节点详情</strong></div><button id=\"return-focus\" class=\"text-btn\" hidden>返回节点</button></div>\n    <div id=\"detail\" class=\"detail\"></div>\n  </aside>\n</div>\n<div id=\"toast\" role=\"status\" hidden></div>\n\n\n\n";

  let host = null;
  let mounted = false;
  let mounting = false;
  let api = null;

  function defaultOptions() {
    return {
      requestSnapshot: async function (q) {
        if (!window.workspace || typeof window.workspace.rpmKnowledgeSnapshot !== 'function') {
          return { ok: false, schema_version: 1, code: 'desktop_required', error: '需要桌面端主进程读取 RPM 快照' };
        }
        return window.workspace.rpmKnowledgeSnapshot(q || {});
      },
      openSourceFile: async function (projectId, sourceId) {
        if (!window.workspace || typeof window.workspace.rpmKnowledgeOpenFile !== 'function') {
          return { ok: false, opened: false, error: '需要桌面端主进程打开原件' };
        }
        return window.workspace.rpmKnowledgeOpenFile(projectId, sourceId);
      }
    };
  }

  function mount(el, opts) {
    if (!el) return api;
    if (mounted && host === el && api) {
      if (api.resize) api.resize();
      return api;
    }
    if (mounting) return api;
    mounting = true;
    try {
      host = el;
      el.innerHTML = SHELL_HTML;
      api = boot(el, opts || defaultOptions());
      mounted = true;
      return api;
    } catch (err) {
      mounted = false;
      api = null;
      try {
        console.error('KnowledgeNetwork.mount failed', err);
        el.innerHTML = '<div class="banner-stale">知识网络初始化失败：' + String((err && err.message) || err) + '</div>';
      } catch (_) {}
      return api;
    } finally {
      mounting = false;
    }
  }

  function boot(host, options) {
  const forceDirected = window.workspace?.full?.enabled === true;
  const references = window.workspace?.full?.markdown?.references;
  if (forceDirected) {
    host.classList.add('fw-force-graph');
    const mark = host.querySelector('.brand strong');
    if (mark) mark.textContent = '知识图谱';
    host.querySelector('.brand strong + span').textContent = '探索研究关系';
    host.querySelector('[data-view="relation"]').textContent = '局部探索';
    host.querySelector('[data-view="project"]').textContent = '完整项目网络';
    const sources = host.querySelector('#sources');
    const layer = document.createElement('select');
    layer.id = 'kn-relation-layer';
    layer.setAttribute('aria-label', '关系范围');
    for (const [value, label] of [['research', '科研关系'], ['citation', '来源引用'], ['organization', '文件与归属']]) {
      layer.add(new Option(label, value));
    }
    const layerLabel = document.createElement('label');
    layerLabel.className = 'field-caption select-label';
    layerLabel.htmlFor = layer.id;
    layerLabel.textContent = '关系范围';
    if (references) layer.add(new Option('笔记引用', 'notes'));
    const noteScope = document.createElement('select');
    noteScope.id = 'kn-note-scope';
    noteScope.setAttribute('aria-label', '笔记引用范围');
    noteScope.hidden = true;
    sources.closest('label').before(layerLabel, layer, noteScope);
    sources.parentElement.lastChild.textContent = ' 从材料索引显示部分文件';
    host.querySelector('.live-marker').hidden = true;
  }
  const KINDS = {
    project: ['项目', '#18594b', '#e0f2e8', 0],
    direction: ['研究方向', '#237161', '#e5f4ef', 1],
    research_question: ['研究问题', '#25649a', '#e9f3fc', 1],
    literature: ['文献', '#786128', '#f8f0dc', 2],
    design: ['技术方案', '#745ba0', '#f0eaf8', 2],
    method: ['技术方法', '#634e9e', '#eee9fa', 2],
    theoretical_model: ['理论模型', '#69539a', '#f0ebf7', 2],
    engineering_model: ['工程模型', '#5f62a1', '#edefef', 2],
    experiment: ['实验', '#116a73', '#e4f4f4', 2],
    simulation: ['仿真', '#47628f', '#e9eef8', 2],
    dataset: ['数据集', '#a3602e', '#fbf1e7', 3],
    analysis: ['数据分析', '#1b7187', '#e9f5f9', 3],
    conclusion: ['研究结论', '#257059', '#e8f5eb', 3],
    decision: ['技术决策', '#86632b', '#fcf3df', 4],
    paper: ['论文', '#407147', '#e9f2e6', 4],
    patent: ['专利', '#49713e', '#eff4e8', 4],
    deliverable: ['研究成果', '#317349', '#e4f4e9', 4],
    note: ['Markdown 笔记', '#476887', '#e9f1f7', 5],
    source: ['来源文件', '#55716f', '#f0f5f3', 5],
    task: ['任务', '#476877', '#eff5f7', 5]
  };
  const STATUSES = {
    declared:'已登记', planned:'计划中', historical:'历史资料', documented:'有记录',
    verified:'已核验', todo:'待办', doing:'进行中', done:'已完成',
    Original:'原始资料', Working:'工作中', Validated:'已验证', Final:'正式成果', Archived:'已归档'
  };
  const PROJECT_TYPES = {Research:'科研',CFD:'CFD',Experiment:'实验',Theory:'理论',Software:'软件',Writing:'写作',General:'一般'};
  const VIEWS = {global:'全局项目网络', project:'项目研究网络', relation:'具体研究关系'};
  const requestSnapshot = options.requestSnapshot;
  const openSourceFile = options.openSourceFile;
  const byId = id => (host && host.querySelector && host.querySelector('#' + id)) || document.getElementById(id);
  const text = (tag, value, className = '') => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = String(value);
    return el;
  };
  const button = (value, action, className = 'quiet') => {
    const el = text('button', value, className);
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
  };
  const append = (parent, ...children) => { parent.append(...children); return parent; };
  const clean = value => String(value == null ? '' : value);
  const statusName = value => STATUSES[value] || (Array.isArray(value) ? value.map(statusName).join(' / ') : value) || '待确认';
  const kind = type => KINDS[type] || [type || '其他', '#596f75', '#edf3f2', 3];
  const relationName = label => ({membership:'项目归属', source:'证据来源', note_reference:'笔记引用', related_to:'关联', uses:'使用', supports:'支持', derived_from:'派生自', validates:'验证', supersedes:'取代'}[label] || label);
  const partOf = (item, projectId) => (item.project_ids || [item.project_id]).includes(projectId);
  const ownerScope = () => state.view==='global' ? state.globalFilter || null : state.project;
  const split = (value, length) => {
    const arr = [...clean(value)];
    if (arr.length <= length) return arr.join('');
    return arr.slice(0, length).join('') + '\n' + arr.slice(length, length * 2).join('') + (arr.length > length * 2 ? '…' : '');
  };

  class Snapshot {
    constructor(raw) {
      if (!raw || raw.schema_version !== 1 || !Array.isArray(raw.projects) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
        throw new Error('RPM 快照须包含版本、项目、节点和关系');
      }
      this.raw = raw;
      this.projects = new Map();
      this.nodes = new Map();
      this.edges = new Map();
      this.adjacent = new Map();
      const insert = (store, item, label) => {
        if (!item || typeof item.id !== 'string' || !item.id || store.has(item.id)) throw new Error(label + '的 ID 无效或重复');
        store.set(item.id, item);
      };
      for (const row of raw.projects) {
        if (!Array.isArray(row.tasks) || !Array.isArray(row.files) || !Array.isArray(row.deliverables) || !row.title) throw new Error('项目记录缺少数据');
        const taskIds = new Set();
        for (const task of row.tasks) {
          if (!task.id || taskIds.has(task.id) || !['todo','doing','done'].includes(task.status)) throw new Error('任务记录无效');
          taskIds.add(task.id);
        }
        insert(this.projects, row, '项目');
      }
      for (const row of raw.nodes) {
        if (!row.title || !row.type || !Array.isArray(row.source_files)) throw new Error('节点记录缺少字段');
        const owners = row.project_ids || [row.project_id];
        if (!owners.length || owners.some(owner => !this.projects.has(owner))) throw new Error('节点引用未登记项目');
        insert(this.nodes, row, '节点');
        this.adjacent.set(row.id, []);
      }
      for (const record of this.projects.values()) {
        if (this.nodes.get(record.id)?.type !== 'project') throw new Error('项目缺少对应的 RPM 项目节点');
        if ([...record.files, ...record.deliverables].some(id => !this.nodes.has(id))) throw new Error('项目索引引用未登记节点');
      }
      for (const edge of raw.edges) {
        if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target) || edge.source === edge.target || !edge.relation_type || !edge.evidence) {
          throw new Error('关系缺少有效端点、类型或证据');
        }
        insert(this.edges, edge, '关系');
        this.adjacent.get(edge.source).push(edge);
        this.adjacent.get(edge.target).push(edge);
      }
    }
  }

  let data = null;
  const state = {
    view: 'global', project: null, selected: null, focus: null,
    depth: 1, layer: 'research', hidden: new Set(), explicit: new Set(), branches: new Set(), relation: '', showSources: false,
    globalFilter: '', directionFilter: '', revision: null, panel: 'node', edge: null, changes: [], handle: null,
    loading: false, incomplete: false, stale: false, error: null, generated_at: '', registry_complete: true
  };
  function featured(project) {
    if (!data) return project;
    return [...data.nodes.values()].find(n => partOf(n, project) && n.type === 'research_question')?.id || project;
  }
  const canvas = byId('graph');
  if (forceDirected) {
    byId('title').textContent = '全局知识图谱';
    byId('network-title').textContent = '知识网络';
    byId('subtitle').textContent = '正在加载项目知识…';
    ['project', 'relation'].forEach(view => { host.querySelector('[data-view="' + view + '"]').disabled = true; });
  }
  const cy = cytoscape({
    container: canvas, elements: [], layout: {name:'preset'},
    minZoom: .25, maxZoom: 2.6, boxSelectionEnabled: false,
    style: [
      {selector:'node', style:{
        'shape':forceDirected ? 'ellipse' : 'round-rectangle','width':'data(width)','height':'data(height)',
        'background-color':'data(fill)','border-color':'data(border)','border-width':1.5,
        'label':'data(label)','text-wrap':'wrap','text-max-width':'data(textWidth)','text-valign':forceDirected ? 'bottom' : 'center','text-halign':'center',
        'text-margin-y':forceDirected ? 5 : 0,
        'font-family':'Segoe UI, Microsoft YaHei UI, Noto Sans SC, sans-serif','font-size':'data(fontSize)','font-weight':600,
        'line-height':1.35,'color':'data(ink)','text-justification':'center'
      }},
      {selector:'.peripheral',style:{opacity:.24}},
      {selector:'node.focused',style:{'border-width':3,'border-color':'data(ink)','font-weight':700}},
      {selector:'node.accent',style:{'color':forceDirected ? '#26364a' : 'white','background-color':forceDirected ? '#da7e9a' : '#175849','border-color':forceDirected ? '#a54665' : '#175849','font-weight':700}},
      {selector:'node.shared',style:{'border-style':'dashed','border-width':2}},
      {selector:'node.file',style:{'border-style':'dotted','text-wrap':'wrap','border-width':1.3}},
      {selector:'edge',style:{
        'curve-style':'bezier','width':1.3,'line-color':forceDirected ? '#b8b7cd' : '#b4c9c1','target-arrow-color':forceDirected ? '#8a89b1' : '#9cb9ae',
        'target-arrow-shape':'triangle','arrow-scale':.8,'opacity':.88
      }},
      {selector:'edge.member',style:{'line-style':'dashed','width':1.25,'target-arrow-shape':'none'}},
      {selector:'edge.cites',style:{'line-style':'dotted','width':1.15,'target-arrow-shape':'none'}},
      {selector:'edge.highlight',style:{'width':2.15,'line-color':forceDirected ? '#9c4966' : '#448575','target-arrow-color':forceDirected ? '#9c4966' : '#448575','opacity':1}},
      {selector:'edge.named',style:{
        'label':'data(label)','font-size':9,'font-family':'Microsoft YaHei UI, sans-serif','color':'#244f45',
        'text-background-color':'#ffffff','text-background-opacity':.94,'text-background-padding':2,'text-rotation':'none'
      }}
    ]
  });

  const noteLayer = { scope: '', result: null, selected: null, focus: null, edge: null, pending: false, generation: 0, depth: 1, error: '' };
  const isNoteLayer = () => state.layer === 'notes';
  const scopes = () => window.FullWorkspace?.referenceScopes?.() || [];
  const noteWarning = { unresolved: '找不到目标笔记', ambiguous: '存在同名候选，请填写相对路径',
    invalid: '链接路径不在当前笔记范围', unchecked: '部分范围未完成扫描，目标待核对' };

  function selectNote(id, focus = false) {
    if (!noteLayer.result?.notes.some(row => row.id === id)) return;
    noteLayer.selected = id;
    noteLayer.edge = null;
    if (focus) {
      noteLayer.focus = id;
      noteLayer.depth = 1;
      render(true);
    } else { styleSelection(); renderDetails(); }
  }

  function chooseNoteScope(projectId) {
    Object.assign(noteLayer, { scope: projectId, result: null, selected: null, focus: null, edge: null,
      pending: false, generation: noteLayer.generation + 1, depth: 1, error: '' });
    render(true);
    void readNotes();
  }

  async function readNotes() {
    if (!isNoteLayer() || !references || noteLayer.pending) return;
    const generation = noteLayer.generation;
    noteLayer.pending = true;
    updateStatus();
    try {
      const result = await references({ projectId: noteLayer.scope || undefined, ifRevision: noteLayer.result?.revision });
      if (!isNoteLayer() || generation !== noteLayer.generation) return;
      if (!result?.ok) {
        noteLayer.error = result?.message || '无法读取当前范围的笔记引用';
        if (noteLayer.result) {
          noteLayer.result = null;
          render(false);
        }
        return;
      }
      noteLayer.error = '';
      if (result.notModified) return;
      const initial = !noteLayer.result;
      noteLayer.result = result;
      const ids = new Set(result.notes.map(note => note.id));
      if (!ids.has(noteLayer.selected)) noteLayer.selected = null;
      if (!ids.has(noteLayer.focus)) noteLayer.focus = null;
      const hasEdge = result.links.some(row => row.targetId && noteEdgeId(row) === noteLayer.edge);
      if (!hasEdge) noteLayer.edge = null;
      render(initial);
      window.FullWorkspace?.graphReady();
    } catch (_) {
      if (generation === noteLayer.generation) noteLayer.error = '无法读取当前范围的笔记引用';
    } finally {
      if (generation === noteLayer.generation) {
        noteLayer.pending = false;
        updateStatus();
      }
    }
  }

  const noteEdgeId = row => 'edge-' + row.sourceId + ':' + row.targetId;
  function noteGraph() {
    const view = noteLayer.result;
    const distance = new Map();
    if (!view) return { nodes: [], edges: [], distance };
    const included = new Set();
    const edges = new Map();
    const adjacent = new Map();
    function neighbor(from, to) {
      if (!adjacent.has(from)) adjacent.set(from, new Set());
      adjacent.get(from).add(to);
    }
    for (const row of view.links) {
      included.add(row.sourceId);
      if (!row.targetId) continue;
      included.add(row.targetId);
      const id = noteEdgeId(row);
      if (!edges.has(id)) {
        edges.set(id, { id, source: row.sourceId, target: row.targetId, relation_type: 'note_reference' });
        neighbor(row.sourceId, row.targetId);
        neighbor(row.targetId, row.sourceId);
      }
    }
    if (noteLayer.focus) {
      included.clear();
      let frontier = [noteLayer.focus];
      distance.set(noteLayer.focus, 0);
      included.add(noteLayer.focus);
      for (let depth = 1; depth <= noteLayer.depth; depth++) {
        const next = [];
        for (const id of frontier) {
          for (const other of adjacent.get(id) || []) {
            if (included.has(other)) continue;
            included.add(other);
            distance.set(other, depth);
            next.push(other);
          }
        }
        frontier = next;
      }
    }
    return { nodes: view.notes.filter(note => included.has(note.id)).map(note => ({ ...note, title: note.name, type: 'note' })),
      edges: [...edges.values()].filter(edge => included.has(edge.source) && included.has(edge.target)), distance };
  }

  function renderNoteDetails(target) {
    target.replaceChildren();
    const view = noteLayer.result;
    const selected = view?.notes.find(row => row.id === noteLayer.selected);
    byId('return-focus').hidden = !noteLayer.edge;
    byId('inspect-caption').textContent = noteLayer.edge ? '笔记引用详情' : '笔记引用';
    const open = row => window.FullWorkspace?.openReferenceNote(noteLayer.scope, row.path, row.id);
    if (noteLayer.focus) target.append(button('返回全部笔记引用', () => {
      noteLayer.focus = null;
      noteLayer.edge = null;
      render(true);
    }));
    if (!view) {
      target.append(text('p', noteLayer.error || '正在读取当前范围的 Markdown 原件。'));
      return;
    }
    const rows = noteLayer.edge ? view.links.filter(row => row.targetId && noteEdgeId(row) === noteLayer.edge) :
      selected ? view.links.filter(row => row.sourceId === selected.id || row.targetId === selected.id) :
      view.links.filter(row => !row.targetId);
    if (selected && !noteLayer.edge) {
      target.append(text('h2', selected.name), text('p', selected.path),
        button('打开 Markdown 原件', () => open(selected)),
        button('以此笔记探索引用', () => selectNote(selected.id, true)));
    } else if (noteLayer.edge) target.append(text('h2', '笔记引用'));
    else target.append(text('h2', '待解析引用'),
      text('p', rows.length ? rows.length + ' 条引用需要核对。' : '当前无待解析引用。'));
    if (!rows.length && selected) target.append(text('p', '当前范围没有这份笔记的引用。'));
    const files = new Map(view.notes.map(file => [file.id, file]));
    const list = text('div', null, 'related-list');
    for (const row of rows.slice(0, 100)) {
      const entry = text('div', null, 'claim-box');
      const to = files.get(row.targetId);
      const from = files.get(row.sourceId);
      entry.append(text('strong', row.label || row.text),
        text('p', row.sourcePath + ' · 第 ' + row.line + ' 行' + (row.column ? '第 ' + row.column + ' 列' : '')),
        text('p', to ? '目标 · ' + to.path : noteWarning[row.status] || '待解析引用'));
      if (from && (!selected || from.id !== selected.id)) entry.append(button('打开来源笔记', () => open(from)));
      if (to && (!selected || to.id !== selected.id)) entry.append(button('打开目标笔记', () => open(to)));
      list.append(entry);
    }
    if (rows.length > 100) list.append(text('p', '这里显示前 100 条。可选择笔记查看其引用。'));
    target.append(list);
  }

  function switchProject(id) {
    if (!data?.projects.has(id)) return;
    Object.assign(state,{project:id, selected:featured(id), view:'project', focus:null, panel:'node', edge:null, relation:'', depth:1});
    state.hidden.clear(); state.explicit.clear(); state.branches.clear(); state.showSources=false;
    state.directionFilter = '';
    render(true);
  }
  function switchView(view) {
    if (isNoteLayer() || !data) return;
    if (view === 'relation') {
      trace(state.selected || state.project);
      return;
    }
    Object.assign(state,{view, relation:'', panel:'node', edge:null, focus:null, depth:1});
    state.hidden.clear(); state.explicit.clear(); state.branches.clear(); state.showSources=false;
    if (view === 'global') state.selected=state.project;
    else if (!partOf(data.nodes.get(state.selected) || {}, state.project)) state.selected=featured(state.project);
    render(true);
  }
  function trace(id) {
    if (!data.nodes.has(id)) return;
    const node = data.nodes.get(id);
    if (!partOf(node, state.project)) state.project = node.project_id || node.project_ids[0];
    Object.assign(state,{view:'relation', focus:id, selected:id, panel:'node', edge:null, relation:'', depth:1});
    if (forceDirected && node.type === 'source' && state.layer === 'research') state.layer = 'citation';
    state.directionFilter = '';
    state.hidden.clear(); state.explicit.clear(); state.branches.clear();
    render(true);
  }
  function selectNode(id, {fromSearch=false} = {}) {
    if (isNoteLayer()) return selectNote(id, fromSearch);
    const node = data.nodes.get(id);
    if (!node) return;
    if (forceDirected && fromSearch && node.type !== 'project') {
      trace(id);
      return;
    }
    const reframe = fromSearch || (state.view === 'global' && node.type === 'project');
    if (reframe) {
      if (!partOf(node, state.project)) {
        state.project = node.project_id || node.project_ids[0];
        state.hidden.clear(); state.explicit.clear(); state.branches.clear(); state.showSources=false;
      }
      if (node.type === 'project') { switchProject(id); return; }
      if (state.view === 'global' || fromSearch) state.view='project';
      state.relation=''; state.hidden.delete(node.type);
      if (node.type === 'source') state.explicit.add(id);
    }
    state.selected=id; state.edge=null; state.panel='node';
    if (reframe) render(true);
    else { styleSelection(); renderDetails(); }
  }

  function inLayer(edge) {
    if (!forceDirected) return true;
    if (state.layer === 'research') return edge.origin === 'research_relation';
    if (state.layer === 'citation') return edge.origin === 'knowledge_citation';
    return ['project_membership', 'index_membership', 'file_relation'].includes(edge.origin);
  }

  function nodesUnderDirection(dirId) {
    const keep = new Set([dirId]);
    const dir = data && data.nodes.get(dirId);
    if (!dir) return keep;
    if (dir.project_id) keep.add(dir.project_id);
    for (const id of dir.project_ids || []) keep.add(id);
    let added = true;
    while (added) {
      added = false;
      for (const e of data.edges.values()) {
        const research = e.origin === 'research_relation';
        if (!research) continue;
        if (keep.has(e.source) && !keep.has(e.target)) { keep.add(e.target); added = true; }
        if (keep.has(e.target) && !keep.has(e.source)) { keep.add(e.source); added = true; }
      }
    }
    return keep;
  }
  function visibleGraph() {
    if (isNoteLayer()) return noteGraph();
    if (!data) return {nodes:[], edges:[], distance:new Map()};
    const picked = state.view === 'global'
      ? [...data.nodes.values()].filter(n => forceDirected || ['project','direction'].includes(n.type) || (n.project_ids?.length > 1 && n.type !== 'source'))
      : [...data.nodes.values()].filter(n => partOf(n, state.project));
    const sources = new Set(state.explicit);
    if (forceDirected && state.layer !== 'research') {
      const scope = ownerScope();
      for (const edge of data.edges.values()) {
        if (!inLayer(edge) || (scope && !partOf(edge, scope))) continue;
        if (state.layer === 'organization' && edge.origin === 'index_membership' && !state.showSources) continue;
        if (sources.size >= 80) break;
        for (const endpoint of [edge.source, edge.target]) {
          if (data.nodes.get(endpoint)?.type === 'source') sources.add(endpoint);
        }
      }
    }
    const pool = new Map(picked.filter(n =>
      (state.view !== 'global' || !state.globalFilter || partOf(n,state.globalFilter)) &&
      (!state.hidden.has(n.type) || n.id === state.focus) &&
      (n.type !== 'source' || (forceDirected ? sources.has(n.id) : state.showSources || state.explicit.has(n.id)) || n.id === state.focus)
    ).map(n => [n.id,n]));
    if (state.directionFilter && data.nodes.has(state.directionFilter)) {
      const keep = nodesUnderDirection(state.directionFilter);
      for (const id of [...pool.keys()]) {
        if (!keep.has(id) && id !== state.focus) pool.delete(id);
      }
    }
    let edges = [...data.edges.values()].filter(e =>
      inLayer(e) && pool.has(e.source) && pool.has(e.target) &&
      (state.view === 'global' ? forceDirected || e.relation_type === 'membership' : !e.project_id || partOf(e, state.project)) &&
      (!state.relation || e.relation_type === state.relation)
    );
    const distance = new Map();
    if (!forceDirected && !state.relation) {
      edges=edges.filter(e=>e.relation_type!=='indexed_file' || (forceDirected && (state.showSources || state.explicit.has(e.source) || state.explicit.has(e.target))) ||
        state.view==='relation' && (e.source===state.focus||e.target===state.focus) &&
        data.nodes.get(state.focus)?.type==='project');
      if (state.view==='relation' && data.nodes.get(state.focus)?.type!=='project')
        edges=edges.filter(e=>e.relation_type!=='membership');
    }
    if (state.view === 'relation') {
      if (pool.has(state.focus)) distance.set(state.focus, 0);
      for (let step = 1; step <= state.depth; step++) {
        for (const edge of edges) {
          const a = distance.get(edge.source);
          const b = distance.get(edge.target);
          if (a === step - 1 && b === undefined) distance.set(edge.target, step);
          if (b === step - 1 && a === undefined) distance.set(edge.source, step);
        }
      }
      const available = new Map();
      for (const edge of edges) {
        for (const [a,b] of [[edge.source,edge.target],[edge.target,edge.source]]) {
          if (!available.has(a)) available.set(a,[]);
          available.get(a).push(b);
        }
      }
      const expanded = new Set();
      let pending = true;
      while (pending) {
        pending = false;
        for (const a of state.branches) {
          const depth=distance.get(a);
          if (depth===undefined||depth>=3||expanded.has(a)) continue;
          expanded.add(a);
          for (const b of available.get(a)||[]) {
            if (!distance.has(b)) {distance.set(b,depth+1); pending=true;}
          }
        }
      }
      edges = edges.filter(e => distance.has(e.source) && distance.has(e.target));
      for (const id of pool.keys()) if (!distance.has(id)) pool.delete(id);
    } else if (!forceDirected && state.view === 'project' && !state.relation) {
      edges = edges.filter(e => e.relation_type !== 'membership' ||
        pool.get(e.source)?.type === 'direction' || pool.get(e.target)?.type === 'direction' ||
        pool.get(e.source)?.project_ids?.length > 1 || pool.get(e.target)?.project_ids?.length > 1);
    }
    if (state.relation && state.view !== 'relation') {
      const endpoints = new Set(edges.flatMap(e => [e.source,e.target]));
      for (const id of pool.keys()) if (!endpoints.has(id)) pool.delete(id);
    }
    return {nodes:[...pool.values()], edges, distance};
  }

  function planLayout(graph) {
    if (!data) return { labels: [], point: () => ({ x: 0, y: 0 }) };
    if (state.view === 'global') {
      const projects = [...data.projects.keys()].filter(id => !state.globalFilter || state.globalFilter === id);
      const shared = graph.nodes.filter(n => n.project_ids?.length > 1 && n.type !== 'project');
      const clusterW = 300;
      const gap = 64;
      const col = (id) => 36 + Math.max(0, projects.indexOf(id)) * (clusterW + gap) + clusterW / 2;
      const dirsOf = (id) => graph.nodes.filter(n => n.type === 'direction' && (n.project_id === id || (n.project_ids || []).includes(id)));
      return {
        labels: projects.map(id => (data.projects.get(id) && data.projects.get(id).title) || id),
        point: n => {
          if (n.type === 'project') return { x: col(n.id), y: 56 };
          if (n.type === 'direction') {
            const pid = projects.includes(n.project_id) ? n.project_id : (n.project_ids || []).find(id => projects.includes(id));
            const list = dirsOf(pid);
            const i = Math.max(0, list.indexOf(n));
            const spread = (i - (list.length - 1) / 2) * Math.min(170, clusterW - 40);
            return { x: col(pid) + spread, y: 150 };
          }
          const owners = (n.project_ids || []).filter(id => projects.includes(id));
          const cx = owners.length ? owners.reduce((sum, id) => sum + col(id), 0) / owners.length : 150;
          return { x: cx, y: 250 + Math.max(0, shared.indexOf(n)) * 86 };
        }
      };
    }
    const labels = state.view === 'relation'
      ? ['当前节点', '第 1 层关联', '第 2 层关联', '第 3 层关联']
      : ['项目', '方向与问题', '方案与方法', '数据与验证', '决策与成果'];
    const cols = new Map();
    for (const node of graph.nodes) {
      const lane = state.view === 'relation' ? graph.distance.get(node.id) : kind(node.type)[3];
      if (lane == null) continue;
      if (!cols.has(lane)) cols.set(lane, []);
      cols.get(lane).push(node);
    }
    const keys = [...cols.keys()].sort((a,b)=>a-b);
    const step=state.view==='relation'?(keys.length<=2?360:220):186;
    const ordered = new Map();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const list = (cols.get(key) || []).slice();
      if (i > 0) {
        const prev = ordered.get(keys[i - 1]) || [];
        const idx = new Map(prev.map((n, pos) => [n.id, pos]));
        const avg = (n) => {
          const rel = graph.edges.filter(e => e.source === n.id || e.target === n.id)
            .map(e => e.source === n.id ? e.target : e.source);
          const hits = rel.map(id => idx.get(id)).filter(v => v != null);
          return hits.length ? hits.reduce((s, v) => s + v, 0) / hits.length : (list.length / 2);
        };
        list.sort((a, b) => avg(a) - avg(b) || a.title.localeCompare(b.title, 'zh-CN'));
      } else {
        list.sort((a, b) => {
          if (a.type === 'project') return -1;
          if (b.type === 'project') return 1;
          return a.title.localeCompare(b.title, 'zh-CN');
        });
      }
      ordered.set(key, list);
    }
    let widest = 0;
    for (const list of ordered.values()) widest = Math.max(widest, list.length);
    const rowH = 92;
    const commonHeight = Math.max(280, (widest - 1) * rowH);
    return {
      labels:keys.map(key=>labels[key] || '资料来源'),
      point:n => {
        const lane = state.view === 'relation' ? graph.distance.get(n.id) : kind(n.type)[3];
        const row = ordered.get(lane) || [];
        const h = (row.length - 1) * rowH;
        return {x:keys.indexOf(lane)*step+96, y:(commonHeight-h)/2+Math.max(0, row.indexOf(n))*rowH+28};
      }
    };
  }

  let canvasSize = null;
  let pendingFit = false;
  function captureCamera() {
    if (!cy) return null;
    return { zoom: cy.zoom(), pan: { x: cy.pan().x, y: cy.pan().y } };
  }
  function restoreCamera(cam) {
    if (!cy || !cam || !cam.zoom) return;
    cy.zoom(cam.zoom);
    cy.pan(cam.pan);
  }
  function graphFit() {
    pendingFit = true;
    resizeCanvas();
  }
  function resizeCanvas() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const previous = canvasSize;
    canvasSize = { width, height };
    cy.resize();
    if (pendingFit) {
      pendingFit = false;
      if (!cy.nodes().length) return;
      const pad = 48;
      cy.fit(cy.elements(), pad);
      const box = cy.elements().boundingBox({ includeLabels: true });
      if (width > pad * 2 && height > pad * 2 && box.w > 0 && box.h > 0) {
        const need = Math.min((width - pad * 2) / box.w, (height - pad * 2) / box.h, 1.12);
        if (need < cy.zoom() - 0.01) cy.zoom({ level: need, renderedPosition: { x: width / 2, y: height / 2 } });
        cy.center();
      }
    } else if (previous && (previous.width !== width || previous.height !== height)) {
      cy.panBy({ x: (width - previous.width) / 2, y: (height - previous.height) / 2 });
    }
  }
  let graphTopology = '';
  function renderGraph(fit) {
    if (!cy) return;
    const info = visibleGraph();
    const positions = forceDirected ? { labels: [], point: () => ({ x: 0, y: 0 }) } : planLayout(info);
    const remembered = new Map(cy.nodes().map(n => [n.id(),n.position()]));
    const nodes = info.nodes.map(n => {
      const [label,ink,fill] = kind(n.type);
      const sizeOf = {
        project: [168, 72, 15, 11],
        direction: [152, 60, 13, 10],
        research_question: [146, 56, 12.5, 9],
        design: [146, 54, 12.5, 9],
        method: [146, 54, 12.5, 9],
        theoretical_model: [146, 54, 12.5, 9],
        engineering_model: [146, 54, 12.5, 9],
        dataset: [140, 50, 12, 9],
        analysis: [140, 50, 12, 9],
        experiment: [140, 50, 12, 9],
        simulation: [140, 50, 12, 9],
        decision: [148, 56, 12.5, 9],
        paper: [148, 56, 12.5, 9],
        patent: [148, 56, 12.5, 9],
        deliverable: [148, 56, 12.5, 9],
        source: [122, 38, 11, 8]
      };
      const defaultSize = sizeOf[n.type] || [140, 54, 12.5, 9];
      const diameter = n.type === 'project' ? 35 : n.project_ids?.length > 1 ? 26 : n.type === 'source' ? 13 : 20;
      const [width, height, size, wrap] = forceDirected ? [diameter, diameter, 12, 16] : defaultSize;
      let classes = n.type === 'project' ? 'accent' : n.type === 'source' ? 'file' : (n.type || '');
      if (n.project_ids?.length>1) classes += ' shared';
      return {group:'nodes', classes, position:(!fit && remembered.get(n.id)) || positions.point(n),
        data:{id:n.id,label:split(n.title, wrap),kind:label,ink,fill,
          border:ink,width,height,textWidth:forceDirected ? 128 : width-14,fontSize:size}};
    });
    const edges = info.edges.map(e => ({group:'edges',
      classes:e.relation_type==='membership'?'member':e.relation_type==='source'?'cites':'meaning',
      data:{id:e.id,source:e.source,target:e.target,label:relationName(e.relation_type)}}));
    const camera = fit ? null : captureCamera();
    const topology = forceDirected ? JSON.stringify([nodes.map(n => n.data.id), edges.map(e => e.data.id)]) : '';
    cy.batch(()=>{cy.elements().remove(); cy.add([...nodes,...edges]);});
    if (forceDirected && nodes.length && (fit || graphTopology !== topology)) {
      const config = isNoteLayer() && nodes.length > 160
        ? { name: 'circle', animate: false, fit: false, spacingFactor: 1.35 }
        : { name: 'cose', animate: false, fit: false, randomize: true,
          nodeRepulsion: 12000, idealEdgeLength: 88, nodeOverlap: 16,
          nodeDimensionsIncludeLabels: true, componentSpacing: 85, numIter: 650 };
      cy.layout(config).run();
    }
    graphTopology = topology;
    const lanes = byId('lanes');
    lanes.replaceChildren(...positions.labels.map(label=>text('span',label,'lane')));
    lanes.hidden=!positions.labels.length;
    lanes.style.gridTemplateColumns='repeat('+Math.max(positions.labels.length,1)+',minmax(0,1fr))';
    const limited = forceDirected && state.layer === 'organization' && state.showSources;
    byId('graph-count').textContent=nodes.length+' 节点 · '+edges.length+' 关系' + (limited ? ' · 文件样本，完整列表见材料与成果' : '');
    if (forceDirected && state.layer === 'research' && !edges.length) {
      byId('graph-count').textContent = nodes.length + ' 节点 · 暂无已登记的科研关系';
    }
    if (isNoteLayer()) {
      const pending = noteLayer.result?.links.filter(row => !row.targetId).length || 0;
      byId('graph-count').textContent = nodes.length + ' 笔记 · ' + edges.length + ' 引用 · ' + pending + ' 待解析';
    }
    byId('empty-graph').hidden=Boolean(nodes.length);
    byId('empty-graph').textContent=isNoteLayer() ? '当前范围没有可绘制的笔记引用。' : '此条件下没有可显示的节点或关系。';
    const present = [...new Set(info.nodes.map(n=>n.type))];
    const legend = byId('legend');
    legend.replaceChildren(...present.map(type => {
      const icon=text('i'); icon.style.setProperty('--color',kind(type)[1]);
      return append(text('span',null,'legend-item'),icon,text('span',kind(type)[0]));
    }));
    styleSelection();
    if (fit) graphFit();
    else if (camera) restoreCamera(camera);
  }
  function styleSelection() {
    cy.elements().removeClass('focused highlight named peripheral');
    const selected = cy.getElementById((isNoteLayer() ? noteLayer.selected : state.selected) || '');
    if (forceDirected && state.view !== 'relation' && selected.connectedEdges().nonempty()) {
      cy.elements().difference(selected.closedNeighborhood()).addClass('peripheral');
    }
    selected.addClass('focused');
    selected.connectedEdges().addClass('highlight');
    if (state.view==='relation' && state.depth===1) selected.connectedEdges('.meaning').addClass('named');
    const edge = isNoteLayer() ? noteLayer.edge : state.edge;
    if (edge) cy.getElementById(edge).addClass('highlight named');
  }

  function pill(type, value) {
    const el=text('span',value || kind(type)[0],'pill');
    el.style.setProperty('--color',kind(type)[1]); el.style.setProperty('--soft',kind(type)[2]);
    return el;
  }
  function availableKinds() {
    const filter = state.view==='global'
      ? n => (forceDirected || ['project','direction'].includes(n.type) || n.project_ids?.length>1) && (!state.globalFilter || partOf(n,state.globalFilter))
      : n => partOf(n,state.project);
    const counts = new Map();
    for (const row of data.nodes.values()) {
      if (filter(row) && row.type !== 'source') counts.set(row.type, (counts.get(row.type) || 0)+1);
    }
    return counts;
  }
  function renderSidebar() {
    const container=byId('project-list');
    const note = isNoteLayer();
    const scope = byId('kn-note-scope');
    if (scope) {
      scope.hidden = !note;
      host.querySelector('.projects-section').hidden = note;
      byId('kinds').hidden = note;
      byId('kind-hint').hidden = note;
      byId('direction-filter').disabled = note;
      byId('relation').disabled = note;
      byId('search').placeholder = note ? '搜索当前范围的笔记' : '搜索节点、任务或文件';
      if (note) {
        scope.replaceChildren(new Option('中央 Obsidian Vault', ''), ...scopes().map(row => new Option(row.title, row.id)));
        scope.value = noteLayer.scope;
        byId('kn-relation-layer').value = state.layer;
        byId('sources').disabled = true;
        byId('changes').hidden = true;
        updateStatus();
        return;
      }
    }
    if (!data) { container.replaceChildren(); return; }
    container.replaceChildren();
    byId('project-count').textContent=data.projects.size;
    for (const p of data.projects.values()) {
      const option=button(null,()=>switchProject(p.id),'project-option'+(state.view!=='global' && p.id===state.project?' active':''));
      option.title = p.title;
      option.setAttribute('aria-current',state.view!=='global' && p.id===state.project ? 'true':'false');
      const colors = [['#11614f','#e3f2ea'],['#49679b','#ebf0f8'],['#705b96','#eee9f7']];
      const color = colors[container.children.length%colors.length];
      const icon=text('span',p.title.charAt(0),'project-mark');
      icon.style.setProperty('--color',color[0]); icon.style.setProperty('--soft',color[1]);
      append(option,icon,append(text('span'),text('span',p.title,'p-name'),text('small',statusName(p.status))));
      container.append(option);
    }
    byId('kinds').replaceChildren(...[...availableKinds()].sort((a,b)=>kind(a[0])[3]-kind(b[0])[3]).map(([name,count])=>{
      const check=text('input'); check.type='checkbox'; check.checked=!state.hidden.has(name);
      check.addEventListener('change',()=>{
        if (check.checked) state.hidden.delete(name); else state.hidden.add(name);
        renderGraph(true);
      });
      const dot=text('i',null,'kind-dot'); dot.style.setProperty('--color',kind(name)[1]);
      return append(text('label',null,'kind-item'),check,dot,text('span',kind(name)[0]),text('small',count));
    }));
    const labels = [...new Set([...data.edges.values()].filter(e =>
      inLayer(e) && (state.view==='global' ? forceDirected || e.relation_type==='membership' : partOf(e,state.project))
    ).map(e=>e.relation_type))].sort((a,b)=>relationName(a).localeCompare(relationName(b),'zh-CN'));
    const option=(value,label)=>{const item=text('option',label);item.value=value;return item;};
    byId('relation').replaceChildren(option('','全部关系'),...labels.map(key=>option(key,relationName(key))));
    byId('relation').value=state.relation;
    const dirSel = byId('direction-filter');
    if (dirSel) {
      const dirs = [...data.nodes.values()].filter(n => n.type === 'direction' && (state.view === 'global' || partOf(n, state.project)));
      dirSel.replaceChildren(option('', '全部方向'), ...dirs.map(n => option(n.id, n.title)));
      if (state.directionFilter && !dirs.some(n => n.id === state.directionFilter)) state.directionFilter = '';
      dirSel.value = state.directionFilter;
    }
    byId('sources').checked=state.showSources;
    byId('sources').disabled=state.view==='global' || (forceDirected && state.layer !== 'organization');
    if (forceDirected) byId('kn-relation-layer').value = state.layer;
    const stamped=new Date(data.raw.generated_at);
    const date=Number.isNaN(stamped.getTime())?'':stamped.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
    if (date && state.revision && !forceDirected) byId('snapshot-status').textContent = '修订 ' + String(state.revision).slice(0, 16) + '… · ' + date;
    else updateStatus();
    byId('changes').hidden=!state.changes.length;
  }

  function metric(label,value,panel) {
    const el=panel ? button(null,()=>showPanel(panel),'metric') : text('div',null,'metric');
    return append(el,text('small',label),text('strong',value));
  }
  function renderHeading() {
    const note = isNoteLayer();
    host.querySelector('.view-tabs').hidden = note;
    if (note) {
      const name = scopes().find(row => row.id === noteLayer.scope)?.title || '中央 Obsidian Vault';
      byId('global-filter').hidden = true;
      byId('depth-group').hidden = !noteLayer.focus;
      byId('depth').value = noteLayer.depth;
      byId('flow').textContent = '科研工程工作台 / 笔记引用';
      byId('title').textContent = name;
      byId('subtitle').textContent = '已保存的笔记双链。未解析引用可在详情中核对。';
      byId('network-title').textContent = '笔记引用网络';
      byId('metrics').replaceChildren();
      return;
    }
    if (!data) return;
    const project=data.projects.get(state.project);
    const selected=data.nodes.get(state.focus);
    const glob=state.view==='global';
    const filter=byId('global-filter');
    filter.hidden=!glob;
    filter.replaceChildren(...[['','全部项目'],...[...data.projects.values()].map(p=>[p.id,p.title])].map(([key,label])=>{
      const option=text('option',label); option.value=key; return option;
    }));
    filter.value=state.globalFilter;
    byId('depth-group').hidden=state.view!=='relation';
    byId('depth').value=state.depth;
    host.querySelectorAll('[data-view]').forEach(tab=>{
      tab.classList.toggle('active',tab.dataset.view===state.view);
      tab.setAttribute('aria-pressed',String(tab.dataset.view===state.view));
      tab.disabled=!project&&tab.dataset.view!=='global';
    });
    byId('flow').textContent=glob?'科研工程工作台 / 全局视图':'科研工程工作台 / '+(project?.title||'');
    byId('title').textContent=glob?'全局项目网络':state.view==='relation'?selected?.title||'具体研究关系':project?.title||'项目研究网络';
    byId('subtitle').textContent=glob?(forceDirected?'显示 RPM 登记的项目、研究实体与证据关系。':'按正式登记项目查看研究方向和共享知识。'):state.view==='relation'?'以当前节点为起点，逐层追溯有证据的关系。':project?.direction||'';
    byId('network-title').textContent=VIEWS[state.view];
    const projects=glob?[...data.projects.values()].filter(p=>!state.globalFilter||state.globalFilter===p.id):project?[project]:[];
    const done=projects.flatMap(p=>p.tasks).filter(t=>t.status==='done').length;
    const total=projects.flatMap(p=>p.tasks).length;
    const deliverableN = projects.flatMap(p=>p.deliverables).length;
    const metricItems = [
      metric(glob?'正式登记':'当前阶段',glob?projects.length+' 个项目':project?.stage||'待确认',glob?null:'progress'),
      metric('任务完成',done+' / '+total,glob?null:'tasks'),
      metric('索引文件',projects.flatMap(p=>p.files).length+' 项',glob?null:'files')
    ];
    if (deliverableN > 0) metricItems.push(metric('登记成果',deliverableN+' 项',glob?null:'deliverables'));
    byId('metrics').replaceChildren(...metricItems);
  }

  function showPanel(panel) {
    state.panel=panel; state.edge=null; renderDetails();
  }
  function section(parent,titleValue,list) {
    const block=append(text('section',null,'detail-section'),text('h3',titleValue));
    if (list) block.append(list);
    parent.append(block); return block;
  }
  function fileList(items) {
    const list=text('div',null,'file-list');
    if (!items.length) return append(list,text('p','暂无已登记来源。'));
    for (const file of items) {
      const item=text('div',null,'file-item');
      const title = file.title || file.relative_path || file.path || '原始文件';
      const projectId = file.project_id || (data && data.nodes.get(file.id) && data.nodes.get(file.id).project_id);
      const sourceId = file.id || file.file_id || file.rpm_source_id;
      const isNote = forceDirected && /\.(?:md|markdown)$/i.test(file.relative_path || '');
      const entry = button(title, async () => {
        if (isNote && window.FullWorkspace?.openGraphNote) {
          await window.FullWorkspace.openGraphNote(projectId, sourceId, file.relative_path);
          return;
        }
        if (!openSourceFile) { toast('当前环境不能打开原件'); return; }
        if (!projectId || !sourceId) { toast('缺少项目 ID 或来源 ID，未打开文件'); return; }
        const result = await openSourceFile(projectId, sourceId);
        if (!result || result.ok !== true || !result.opened) {
          toast('无法打开原件：' + ((result && (result.error || result.code)) || '定位失败'));
        } else {
          toast('已打开原件');
        }
      }, 'file-open');
      entry.title = '核对项目和来源后打开原件';
      item.append(entry);
      const status=file.status ? ' · '+statusName(file.status) : '';
      const path = text('code',(file.relative_path||file.path||'')+status);
      if (file.path) path.title=file.path;
      item.append(path);
      if (file.path && file.path !== file.relative_path) {
        const disclosure=append(text('details'),text('summary','实际路径'),text('code',file.path));
        item.append(disclosure);
      }
      if (file.evidence) item.append(text('p',Array.isArray(file.evidence)?file.evidence.join('；'):file.evidence));
      list.append(item);
    }
    return list;
  }
  function safeLocal(value) {
    try { const u=new URL(value); return u.protocol==='file:'&&!u.hostname ? u.href : null; }
    catch { return null; }
  }
  function relatedList(node) {
    const list=text('div',null,'related-list');
    const edges=(data.adjacent.get(node.id)||[]).filter(e=>(forceDirected ? e.origin === 'research_relation' : !['membership','indexed_file'].includes(e.relation_type)) &&
      (!ownerScope()||partOf(e,ownerScope())) && (!state.relation||e.relation_type===state.relation));
    const preview=edges.filter(e=>e.relation_type!=='source');
    for (const e of preview.slice(0,8)) {
      const target=data.nodes.get(e.source===node.id?e.target:e.source);
      const go=button(null,()=> {if (cy.getElementById(target.id).nonempty()) selectNode(target.id); else trace(target.id);},'related-item');
      const title = append(text('span'),text('b',target.title),text('small',relationName(e.relation_type)));
      append(go,title,text('span','↗','related-arrow')); list.append(go);
    }
    if (!preview.length) list.append(text('p','暂无已登记的研究关系。'));
    if (preview.length>8) list.append(button('查看全部关系',()=>trace(node.id),'text-btn'));
    return list;
  }
  function ownerNames(node) {
    return (node.project_ids||[node.project_id]).map(id=>data.projects.get(id)?.title).filter(Boolean).join('、');
  }
  function fileForNode(record) {
    if (record.source_files.length) return record.source_files.filter(item =>
      !ownerScope()||!item.project_id||item.project_id===ownerScope());
    return record.relative_path ? [{id:record.id,title:record.title,path:record.path,relative_path:record.relative_path,status:record.status,href:record.href}] : [];
  }
  function progressList(project) {
    const list=text('div',null,'task-list');
    if (!project.tasks.length) return append(list,text('p','暂无已登记任务。'));
    for (const task of project.tasks) {
      const item=append(text('div',null,'task-item'),pill('task',statusName(task.status)),text('b','  '+task.title));
      if (task.depends_on?.length) item.append(text('small','依赖 '+task.depends_on.map(id=>project.tasks.find(t=>t.id===id)?.title||id).join('、')));
      list.append(item);
    }
    return list;
  }
  function renderPanel(parent, project) {
    if (!project && state.panel!=='changes') return parent.append(text('p','请选择一个已登记项目。'));
    const names={tasks:'任务进度',files:'文件索引',deliverables:'登记成果',progress:'项目进度',changes:'快照变化'};
    parent.append(text('h2',names[state.panel]));
    if (project) parent.append(text('div',project.title,'detail-owner'));
    if (state.panel==='tasks') {
      parent.append(progressList(project)); return;
    }
    if (state.panel==='progress') {
      parent.append(pill('project',statusName(project.status)),text('h3',project.stage||'阶段待确认'),text('p',project.description||project.direction));
      section(parent,'项目任务',progressList(project)); return;
    }
    if (state.panel==='files') {
      const groups={};
      for (const id of project.files) {
        const record=data.nodes.get(id);
        const name=statusName(record.status);
        groups[name]=(groups[name]||0)+1;
      }
      parent.append(text('p',Object.entries(groups).map(pair=>pair.join(' ')).join(' · ')));
      const files=project.files.flatMap(id=>fileForNode(data.nodes.get(id)));
      section(parent,'已登记文件',fileList(files)); return;
    }
    if (state.panel==='deliverables') {
      for (const id of project.deliverables) {
        const node=data.nodes.get(id);
        const item=section(parent,node.title);
        item.append(text('p',node.description),fileList(fileForNode(node)));
      }
      if (!project.deliverables.length) parent.append(text('p','暂无已登记成果。'));
      return;
    }
    const list=text('div',null,'change-list');
    list.replaceChildren(...state.changes.map(change=>text('div',change,'change-item')));
    if (!state.changes.length) list.append(text('p','当前两次读取的数据一致。'));
    parent.append(list);
  }
  function renderDetails() {
    const target=byId('detail');
    if (!target) return;
    if (isNoteLayer()) { renderNoteDetails(target); return; }
    if (!data) { target.replaceChildren(); target.append(text('p','正在读取或尚未取得 RPM 快照。')); return; }
    target.replaceChildren();
    byId('return-focus').hidden=state.panel==='node';
    byId('inspect-caption').textContent=state.panel==='edge'?'关系详情':state.panel==='node'?'节点详情':'项目详情';
    if (state.panel==='edge') {
      const edge=data.edges.get(state.edge);
      if (!edge) return;
      const from=data.nodes.get(edge.source);
      const to=data.nodes.get(edge.target);
      target.append(text('h2',relationName(edge.relation_type)),text('div',ownerNames(edge),'detail-owner'));
      section(target,'关系两端',append(text('div',null,'related-list'),
        button(from.title,()=>trace(from.id),'related-item'),button(to.title,()=>trace(to.id),'related-item')));
      const lines=Array.isArray(edge.evidence)?edge.evidence:[edge.evidence];
      const info=section(target,'关系依据');
      for (const line of lines) {
        if (typeof line==='string') info.append(text('p',line));
        else if (line?.evidence) info.append(fileList([line]));
      }
      if (edge.evidence_sources?.length) section(target,'证据文件',fileList(edge.evidence_sources));
      return;
    }
    if (state.panel!=='node') {
      renderPanel(target,data.projects.get(state.project)); return;
    }
    const node=data.nodes.get(state.selected);
    if (!node) {
      target.append(text('p','在图谱中选择项目、节点或关系。')); return;
    }
    const shared=node.project_ids?.length>1;
    const scope=ownerScope();
    const claim = (typeof KnowledgeSource !== 'undefined' && KnowledgeSource.claimFor)
      ? KnowledgeSource.claimFor(node, scope) : ((node.claims||[]).find(c => c.project_id === scope) || (node.claims||[])[0] || null);
    const displayedStatus = (claim && claim.status) || node.statuses_by_project?.[scope] || node.status;
    const description = (claim && claim.description) || node.descriptions_by_project?.[scope] || node.description;
    const owner=shared&&scope?data.projects.get(scope)?.title:ownerNames(node);
    target.append(append(text('div',null,'detail-kinds'),pill(node.type),pill('project',statusName(displayedStatus))),
      text('h2',node.title),text('div',shared?owner+' · 共享知识':owner,'detail-owner'));
    if (window.workspace?.full?.codex) {
      const copyId = button('复制节点 ID', async () => {
        const result = await Bridge.copy(node.id);
        toast(result.ok ? '节点 ID 已复制，可粘贴到任务。' : result.error);
      });
      copyId.dataset.copyKnowledgeId = node.id;
      const advanced = append(text('details'), text('summary', '高级信息'),
        append(text('div', null, 'fw-reference-id'), text('code', node.id), copyId));
      target.append(advanced);
    }
    if (description && !(node.type==='source'&&/^(text|document|table|media|code|other)$/i.test(description))) {
      section(target,'研究内容',text('p',description));
    }
    if (node.claims && node.claims.length) {
      const box = append(text('details'), text('summary', '研究状态与项目说明'));
      target.append(box);
      for (const row of node.claims) {
        const usage = (typeof KnowledgeSource !== 'undefined')
          ? KnowledgeSource.methodUsageLabel(row.method_usage)
          : (row.method_usage == null || row.method_usage === '' ? '未确定' : String(row.method_usage));
        const line = append(text('div', null, 'claim-box'),
          text('div', (data.projects.get(row.project_id)?.title || row.project_id) + ' · ' + statusName(row.status)),
          text('small', '方法语境：' + usage + (row.usage_context ? ' · ' + row.usage_context : '') + (row.status_origin ? ' · 来源 ' + row.status_origin : ''))
        );
        if (row.description) line.append(text('p', row.description));
        box.append(line);
      }
    }
    if (node.type==='project') {
      const project=data.projects.get(node.id);
      if (project?.stage) section(target,'当前阶段',text('p',project.stage));
      section(target,'项目任务',progressList(project));
    }
    const evidenceRows = (data.adjacent.get(node.id) || []).filter(e =>
      e.origin === 'research_relation' || (!forceDirected && e.evidence && !['membership','indexed_file'].includes(e.relation_type)));
    if (evidenceRows.length) {
      const box = append(text('details'), text('summary', '关系依据'));
      target.append(box);
      for (const e of evidenceRows.slice(0, 8)) {
        const other = data.nodes.get(e.source === node.id ? e.target : e.source);
        const ev = Array.isArray(e.evidence) ? e.evidence : [e.evidence];
        const block = text('div', null, 'evidence-block');
        block.append(text('p', (other ? other.title : '') + ' · ' + relationName(e.relation_type)));
        for (const line of ev) {
          if (typeof line === 'string' && line) block.append(text('p', line));
        }
        box.append(block);
      }
    }
    const sources=fileForNode(node);
    const visibleSources = sources.map(f=>f.id).filter(id=>data.nodes.get(id)?.type==='source'&&id!==node.id);
    const controls=text('div',null,'detail-controls');
    if (forceDirected && state.view === 'relation') {
      controls.append(button('返回完整项目网络', () => switchView('project')));
    }
    if (node.type==='project' && state.view==='global') controls.append(button('进入项目网络',()=>switchProject(node.id)));
    else if (state.view==='relation'&&node.id!==state.focus&&visibleGraph().distance.has(node.id)) {
      const expanded=state.branches.has(node.id);
      const nodeDepth=visibleGraph().distance.get(node.id);
      if (nodeDepth<3) controls.append(button(expanded?'折叠关联':'展开关联',()=>{
        if (expanded) state.branches.delete(node.id);
        else state.branches.add(node.id);
        render(false);
      }));
      controls.append(button('设为探索中心',()=>trace(node.id)));
    } else if (forceDirected && state.view !== 'relation') controls.append(button('探索局部知识簇',()=>trace(node.id)));
    else if (!forceDirected && node.type !== 'source') controls.append(button('追溯关系',()=>trace(node.id)));
    if (visibleSources.length && state.view!=='global') {
      const expanded=visibleSources.every(id=>state.explicit.has(id))||state.showSources;
      controls.append(button(expanded?'收起来源':'展开来源',()=>{
        if (expanded) {
          for (const id of visibleSources) state.explicit.delete(id);
          state.showSources=false;
        } else {
          if (forceDirected) state.layer = 'citation';
          for (const id of visibleSources) state.explicit.add(id);
        }
        render(true);
      }));
    }
    const noteSource = sources.find(file => /\.(?:md|markdown)$/i.test(file.relative_path || ''));
    if (forceDirected && noteSource && window.FullWorkspace?.openGraphNote) {
      controls.append(button('阅读 Markdown', () => window.FullWorkspace.openGraphNote(
        noteSource.project_id || scope || node.project_id, noteSource.id || noteSource.file_id, noteSource.relative_path, node.id
      )));
    }
    target.append(controls);
    if (node.type!=='project') section(target,'科研关联',relatedList(node));
    if (sources.length) section(target,'原始文件 · '+sources.length,fileList(sources));
  }

  function render(fit) {
    renderHeading(); renderSidebar(); renderGraph(fit); renderDetails(); search();
  }

  function search() {
    const field=byId('search');
    if (!field) return;
    if (isNoteLayer()) {
      const list = byId('search-results');
      const query = field.value.trim().toLocaleLowerCase();
      list.replaceChildren();
      list.hidden = !query;
      if (!query) return;
      const matches = noteLayer.result?.notes.filter(row => row.path.toLocaleLowerCase().includes(query)) || [];
      for (const row of matches.slice(0, 15)) list.append(append(button(null, () => {
        field.value = '';
        list.hidden = true;
        selectNote(row.id, true);
      }), text('strong', row.name), text('small', row.path)));
      if (!matches.length) list.append(text('p', '没有匹配的笔记。'));
      return;
    }
    if (!data) { const result=byId('search-results'); if(result) result.hidden=true; return; }
    const result=byId('search-results');
    const query=field.value.trim().toLocaleLowerCase();
    result.replaceChildren(); result.hidden=!query;
    if (!query) return;
    const score = node=>{
      const title=node.title.toLocaleLowerCase();
      return (title===query?100:title.startsWith(query)?25:title.includes(query)?10:0)
        +(ownerScope()&&partOf(node,ownerScope())?15:0);
    };
    const matches = [...data.nodes.values()].filter(node=>[node.title,node.description,node.relative_path,ownerNames(node)]
      .some(value=>clean(value).toLocaleLowerCase().includes(query)))
      .sort((a,b)=>score(b)-score(a)||a.title.localeCompare(b.title,'zh-CN'));
    const tasks=[...data.projects.values()].flatMap(project=>project.tasks.filter(t=>t.title.toLocaleLowerCase().includes(query))
      .map(task=>({project,task})));
    for (const node of matches.slice(0,10)) result.append(append(button(null,()=>{
      field.value=''; result.hidden=true; selectNode(node.id,{fromSearch:true});
    }),text('strong',node.title),text('small',kind(node.type)[0]+' · '+ownerNames(node))));
    for (const {project,task} of tasks.slice(0,5)) result.append(append(button(null,()=>{
      field.value=''; result.hidden=true; switchProject(project.id); showPanel('tasks');
    }),text('strong',task.title),text('small','任务 · '+project.title)));
    if (!matches.length&&!tasks.length) result.append(text('p','没有匹配的节点、任务或文件。'));
  }

  function describeDelta(previous, next) {
    const entries=[];
    if (!previous || !next) return entries;
    for (const project of next.projects.values()) {
      const earlier=previous.projects.get(project.id);
      if (!earlier) { entries.push('新增项目 · '+project.title); continue; }
      if (project.stage!==earlier.stage) entries.push(project.title+' · 阶段由「'+earlier.stage+'」更新为「'+project.stage+'」');
      if (project.status!==earlier.status) entries.push(project.title+' · 状态 '+statusName(earlier.status)+' → '+statusName(project.status));
      const oldTasks = new Map(earlier.tasks.map(task=>[task.id,task]));
      for (const task of project.tasks) {
        const prior=oldTasks.get(task.id);
        if (!prior) entries.push('新增任务 · '+task.title);
        else if (prior.status!==task.status) entries.push(task.title+' · '+statusName(prior.status)+' → '+statusName(task.status));
      }
      const currentTasks=new Set(project.tasks.map(task=>task.id));
      for (const task of earlier.tasks) if (!currentTasks.has(task.id)) entries.push('任务已移出登记 · '+task.title);
      for (const [field,label] of [['files','索引文件'],['deliverables','登记成果']]) {
        const prior=new Set(earlier[field]); const now=new Set(project[field]);
        for (const id of now) {
          const node=next.nodes.get(id);
          if (!prior.has(id)) entries.push('新增'+label+' · '+node.title);
          else if (clean(previous.nodes.get(id)?.status)!==clean(node.status)) {
            entries.push(node.title+' · '+statusName(previous.nodes.get(id)?.status)+' → '+statusName(node.status));
          }
        }
        for (const id of prior) if (!now.has(id)) entries.push(label+'已移出登记 · '+previous.nodes.get(id).title);
      }
    }
    for (const project of previous.projects.values()) if (!next.projects.has(project.id)) entries.push('项目已移出登记 · '+project.title);
    const addedEdges=[...next.edges.values()].filter(e=>!previous.edges.has(e.id)&&!['membership','source','indexed_file'].includes(e.relation_type));
    const removedEdges=[...previous.edges.values()].filter(e=>!next.edges.has(e.id)&&!['membership','source','indexed_file'].includes(e.relation_type));
    for (const [edges,store,prefix] of [[addedEdges,next,'新增关系'],[removedEdges,previous,'移除关系']]) {
      for (const edge of edges) entries.push(prefix+' · '+store.nodes.get(edge.source).title+' → '+store.nodes.get(edge.target).title+'（'+relationName(edge.relation_type)+'）');
    }
    for (const node of next.nodes.values()) if (!previous.nodes.has(node.id)&&!['source','project'].includes(node.type)) entries.push('新增知识节点 · '+node.title);
    for (const node of previous.nodes.values()) if (!next.nodes.has(node.id)&&!['source','project'].includes(node.type)) entries.push('知识节点已移出登记 · '+node.title);
    return entries;
  }
  let toastTimer;
  function toast(message) {
    const target=byId('toast');
    target.textContent=message; target.hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>target.hidden=true,3500);
  }
  function load(raw,revision,showChanges) {
    const next=new Snapshot(raw);
    const changes=describeDelta(data,next);
    data=next;
    state.revision=revision;
    if (showChanges || changes.length) state.changes=changes;
    if (!data.projects.has(state.project)) {
      state.project=data.projects.keys().next().value; state.selected=featured(state.project);
      state.globalFilter=''; state.focus=null; state.view=state.project?'project':'global';
    }
    if (!data.projects.has(state.globalFilter)) state.globalFilter='';
    if (!data.nodes.has(state.selected)) state.selected=featured(state.project);
    if (state.view==='relation'&&!data.nodes.has(state.focus)) {state.view='project';state.focus=null;}
    if (showChanges) { state.panel='changes'; state.edge=null; }
    else if (state.edge && !data.edges.has(state.edge)) { state.panel='node'; state.edge=null; }
    render(false);
    toast(changes.length?'图谱已刷新 · '+changes.length+' 项变化':'已重新读取当前快照');
  }
  async function importFile(file,handle=null) {
    try {
      load(JSON.parse(await file.text()),'imported',true);
      state.handle=handle;
    } catch (error) { toast('导入失败：'+error.message); }
  }
  async function fetchSnapshot(force) {
    if (typeof requestSnapshot !== 'function') throw new Error('未配置知识网络读取器');
    state.loading = true;
    updateStatus();
    const previousRevision = force ? undefined : state.revision;
    const raw = await requestSnapshot({ ifRevision: previousRevision || undefined });
    state.loading = false;
    if (!raw || raw.ok !== true) {
      state.error = raw || { error: '查询失败' };
      state.stale = !!data;
      updateStatus();
      throw new Error((raw && (raw.error || raw.code)) || '查询失败');
    }
    state.error = null;
    state.registry_complete = raw.registry_complete !== false;
    state.incomplete = raw.registry_complete === false;
    state.stale = raw.registry_complete === false;
    state.generated_at = raw.generated_at || '';
    if (raw.not_modified === true) {
      updateStatus();
      toast('修订号未变化，已保留当前布局');
      return null;
    }
    return raw;
  }
  async function refresh(force) {
    if (isNoteLayer() && !force) return readNotes();
    try {
      const raw = await fetchSnapshot(!!force);
      if (!raw) return;
      if (!data) {
        data = new Snapshot(raw);
        const first = data.projects.keys().next().value || null;
        state.project = first;
        state.selected = first ? featured(first) : null;
        state.revision = raw.revision;
        render(true);
        window.FullWorkspace?.graphReady();
        toast(state.incomplete ? '已读取快照（登记不完整）' : '已读取知识网络快照');
        return;
      }
      load(raw, raw.revision, true);
      window.FullWorkspace?.graphReady();
    } catch (error) {
      if (byId('empty-graph') && !data) {
        byId('empty-graph').hidden = false;
        byId('empty-graph').textContent = error.message;
      }
      toast('刷新失败：' + error.message);
    } finally {
      state.loading = false;
      updateStatus();
    }
  }
  function updateStatus() {
    const el = byId('snapshot-status');
    if (!el) return;
    if (isNoteLayer()) {
      el.textContent = noteLayer.error || (noteLayer.result?.partial ? '仅索引了部分范围，请缩小范围或检查未读取文件。' :
        noteLayer.result ? '笔记引用已同步' : '正在扫描当前范围的笔记引用…');
      return;
    }
    if (state.loading) el.textContent = '正在读取快照…';
    else if (state.error && !data) el.textContent = '读取失败：' + (state.error.error || state.error.code || '未知错误');
    else if (state.incomplete) el.textContent = '登记不完整，图谱可能过期。不可读项目不会被当作已删除。';
    else if (state.revision && forceDirected) el.textContent = '知识数据已更新';
    else if (state.revision) el.textContent = '修订 ' + String(state.revision).slice(0, 16) + '…' + (state.generated_at ? ' · ' + state.generated_at : '');
    else el.textContent = '尚未读取快照';
  }
  byId('search').addEventListener('input',search);
  byId('search').addEventListener('keydown',event=>{
    if (event.key==='Enter') { event.preventDefault(); byId('search-results').querySelector('button')?.click(); }
    else if (event.key==='Escape') { event.target.value=''; search(); event.target.blur(); }
  });
  host.addEventListener('keydown',event=>{
    const tag=event.target.tagName;
    if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(tag)&&!event.metaKey&&!event.ctrlKey) { event.preventDefault(); byId('search').focus(); }
  });
  host.addEventListener('pointerdown',event=>{
    if (!byId('search-results').contains(event.target)&&!byId('search').contains(event.target)) byId('search-results').hidden=true;
  });
  host.querySelectorAll('[data-view]').forEach(tab=>tab.addEventListener('click',()=>switchView(tab.dataset.view)));
  byId('relation').addEventListener('change',event=>{state.relation=event.target.value;renderGraph(true);renderDetails();});
  if (byId('direction-filter')) byId('direction-filter').addEventListener('change',event=>{state.directionFilter=event.target.value;render(true);});
  byId('kn-relation-layer')?.addEventListener('change', event => {
    Object.assign(state, {layer: event.target.value, relation: '', showSources: false});
    state.explicit.clear();
    state.branches.clear();
    if (isNoteLayer()) {
      const rpmId = ownerScope();
      chooseNoteScope(scopes().find(row => row.rpmProjectId === rpmId)?.id || '');
    } else render(true);
  });
  byId('kn-note-scope')?.addEventListener('change', event => chooseNoteScope(event.target.value));
  byId('sources').addEventListener('change',event=>{
    state.showSources=event.target.checked;
    if (!state.showSources) state.explicit.clear();
    render(true);
  });
  byId('global-filter').addEventListener('change',event=>{state.globalFilter=event.target.value;if(state.globalFilter)state.selected=state.globalFilter;render(true);});
  byId('depth').addEventListener('change', event => {
    if (isNoteLayer()) noteLayer.depth = Number(event.target.value);
    else { state.depth = Number(event.target.value); state.branches.clear(); }
    renderGraph(true);
    renderDetails();
  });
  byId('clear-filters').addEventListener('click',()=>{
    state.hidden.clear();state.explicit.clear();state.branches.clear();Object.assign(state,{relation:'',layer:'research',showSources:false,globalFilter:'',directionFilter:''});render(true);
  });
  byId('return-focus').addEventListener('click',()=>{
    if (isNoteLayer()) { noteLayer.edge = null; renderDetails(); }
    else { state.edge=null; showPanel('node'); }
    styleSelection();
  });
  byId('layout').addEventListener('click',()=>renderGraph(true));
  byId('fit').addEventListener('click',graphFit);
  const zoom=factor=>cy.zoom({level:Math.max(cy.minZoom(),Math.min(cy.maxZoom(),cy.zoom()*factor)),renderedPosition:{x:cy.width()/2,y:cy.height()/2}});
  byId('zoom-in').addEventListener('click',()=>zoom(1.2));
  byId('zoom-out').addEventListener('click',()=>zoom(1/1.2));
  byId('refresh').addEventListener('click',()=>refresh(false));
  byId('changes').addEventListener('click',()=>showPanel('changes'));
  cy.on('tap','node',event=>selectNode(event.target.id()));
  cy.on('tap','edge',event=>{
    if (isNoteLayer()) noteLayer.edge = event.target.id();
    else { state.edge=event.target.id(); state.panel='edge'; }
    styleSelection();
    renderDetails();
  });
  if (references) setInterval(() => {
    if (isNoteLayer() && host.getClientRects().length) void readNotes();
  }, 2500);
  new ResizeObserver(resizeCanvas).observe(canvas);

  render(true);
  updateStatus();
  refresh(true);
  api = {
    mount: mount,
    mounted: function () { return mounted; },
    resize: () => { resizeCanvas(); if (isNoteLayer() && host.getClientRects().length) void readNotes(); },
    refresh: refresh,
    focus: function ({ rpmProjectId, fileId, nodeId, preserveSelection = false, referenceScope } = {}) {
      if (referenceScope !== undefined && references) {
        if (!isNoteLayer() || noteLayer.scope !== referenceScope) {
          state.layer = 'notes';
          chooseNoteScope(referenceScope);
          return false;
        }
        if (!noteLayer.result) return false;
        if (noteLayer.result.notes.some(row => row.id === nodeId)) {
          if (!preserveSelection || noteLayer.selected !== nodeId) selectNote(nodeId, true);
        }
        return true;
      }
      if (!data) return false;
      if (isNoteLayer()) state.layer = 'research';
      const node = nodeId || (fileId && (data.raw.files || []).find(file =>
        (file.id === fileId || file.file_id === fileId) && (!rpmProjectId || file.project_id === rpmProjectId))?.id);
      if (node && data.nodes.has(node)) {
        if (!preserveSelection || node !== state.selected || cy.getElementById(node).empty()) selectNode(node, { fromSearch: true });
      }
      else if (rpmProjectId && data.projects.has(rpmProjectId)) switchProject(rpmProjectId);
      else return false;
      return true;
    },
    status: function () {
      return {
        revision: state.revision,
        incomplete: state.incomplete,
        stale: state.stale,
        loading: state.loading,
        error: state.error,
        generated_at: state.generated_at,
        registry_complete: state.registry_complete,
        nodes: data ? data.nodes.size : 0,
        edges: data ? data.edges.size : 0,
        projects: data ? data.projects.size : 0
      };
    },
    snapshot: function () { return data ? data.raw : null; },
    state: state,
    cy: function () { return cy; },
    test: { cy: cy, state: state, snapshot: function () { return data && data.raw; }, load: load, camera: captureCamera, noteReferences: () => noteLayer.result, portal: { safeLocal: safeLocal } }
  };
  window.rpmNetworkTest = api.test;
  return api;
  }

  root.KnowledgeNetwork = { mount, mounted: () => mounted, resize: () => api?.resize(), status: () => api?.status() || {},
    refresh: () => api?.refresh(false), focus: target => api?.focus(target) };
})(typeof window !== 'undefined' ? window : this);
