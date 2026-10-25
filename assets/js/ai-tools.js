/* ==========================================================================
   AI 工具集（Function Calling）
   - AI_TOOLS      给模型看的 schema
   - AI_TOOL_IMPL  真实实现：直接读写项目数据、落盘、写活动日志
   - 工具调用由渲染层执行，因此每一步都能在对话流里可视化
   ========================================================================== */

/* ---------- 状态与优先级的双向映射（对模型用中文，落库用内部值） ---------- */
const ST_IN = { '待处理': 'todo', '进行中': 'doing', '待复核': 'review', '已完成': 'done', todo: 'todo', doing: 'doing', review: 'review', done: 'done' };
const ST_OUT = { todo: '待处理', doing: '进行中', review: '待复核', done: '已完成' };
const PRI_IN = { '高': 'high', '中': 'mid', '低': 'low', high: 'high', mid: 'mid', low: 'low' };
const PRI_OUT = { high: '高', mid: '中', low: '低' };

/** 用标题/内容定位任务与待办，容忍大小写与部分匹配 */
/* S0：任务稳定 ID（标题只用于展示，定位优先用 id） */
function newTaskId() { return 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function findTaskById(id, projectId) {
  const q = String(id || '').trim();
  if (!q) return -1;
  return DB.tasks.findIndex(t => t.id === q && (!projectId || t.p === projectId));
}

function findTask(title, projectId) {
  const q = String(title || '').trim();
  if (!q) return -1;
  const inScope = (t) => !projectId || t.p === projectId;
  let i = DB.tasks.findIndex(t => inScope(t) && t.t === q);
  if (i >= 0) return i;
  i = DB.tasks.findIndex(t => inScope(t) && (t.t.includes(q) || q.includes(t.t)));
  return i;
}
function findTodo(content) {
  const q = String(content || '').trim();
  if (!q) return -1;
  let i = DB.todos.findIndex(t => t.t === q);
  if (i >= 0) return i;
  i = DB.todos.findIndex(t => t.t.includes(q) || q.includes(t.t));
  return i;
}
const dirsOf = pid => Object.keys(MATERIALS[pid] || {});

/* 项目解析：ID → 全名 → 唯一部分匹配。找不到时返回 null，由调用方给出可用列表 */
function resolveProject(q) {
  const key = String(q || '').trim();
  if (!key) return null;
  return DB.projects.find(x => x.id === key)
    || DB.projects.find(x => x.name === key)
    || DB.projects.find(x => x.name.includes(key) || key.includes(x.name))
    || null;
}
const projectHint = () => DB.projects.length ? DB.projects.map(x => x.name).join('、') : '（还没有项目）';

/* ==========================================================================
   工具 Schema
   ========================================================================== */
const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_project_context',
      description: '获取当前科研项目的完整上下文：项目信息、全部任务、待办事项、材料目录结构。开始回答或执行任何操作前，应先调用本工具掌握现状。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '列出任务，可按状态与项目筛选。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['待处理', '进行中', '待复核', '已完成', '全部'], description: '任务状态，默认全部' },
          project: { type: 'string', description: '只看某个项目；省略则看当前工作区' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: '在当前项目中新建一个任务。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任务名称' },
          agent: { type: 'string', description: '负责的 Agent，如 Engineer / Analyst / Writer / Researcher / Architect / Verifier' },
          tool: { type: 'string', description: '使用的工具，如 Fluent / Python / Tecplot' },
          due: { type: 'string', description: '截止时间，如 10-25' },
          priority: { type: 'string', enum: ['高', '中', '低'] },
          status: { type: 'string', enum: ['待处理', '进行中', '待复核', '已完成'] },
          material_dir: { type: 'string', description: '材料所在目录（必须是该项目已有目录之一）' },
          project: { type: 'string', description: '目标项目名称或 ID；省略则用当前工作区' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: '修改已有任务的状态、优先级、截止时间、负责人或材料目录。优先用 task_id 定位（来自 list_tasks），task_title 仅作兼容；跨项目修改时带 project。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '任务稳定 ID（推荐，来自 list_tasks）' },
          task_title: { type: 'string', description: '任务名称（无 id 时的兼容方式；同名多条会要求改用 task_id）' },
          status: { type: 'string', enum: ['待处理', '进行中', '待复核', '已完成'] },
          priority: { type: 'string', enum: ['高', '中', '低'] },
          due: { type: 'string' },
          agent: { type: 'string' },
          material_dir: { type: 'string' },
          project: { type: 'string', description: '任务所属项目（跨项目管理时必填）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: '删除一个任务。属于不可逆操作，删除前应向用户确认。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '任务稳定 ID（推荐，来自 list_tasks）' },
          task_title: { type: 'string', description: '任务名称（无 id 时的兼容方式）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_todo',
      description: '新增一条待办事项。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '待办内容' },
          category: { type: 'string', enum: ['任务', '会议', '截止日期', '其他'] },
          priority: { type: 'string', enum: ['高', '中', '低'] },
          due: { type: 'string', description: '时间描述，如「今天 16:00」「明天 10:00」「10-20 18:00」' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_todo',
      description: '修改待办事项的内容、分类、优先级、时间，或标记完成/未完成。',
      parameters: {
        type: 'object',
        properties: {
          todo_content: { type: 'string', description: '用于定位的原有待办内容' },
          new_content: { type: 'string' },
          category: { type: 'string', enum: ['任务', '会议', '截止日期', '其他'] },
          priority: { type: 'string', enum: ['高', '中', '低'] },
          due: { type: 'string' },
          done: { type: 'boolean', description: 'true 标记完成，false 标记未完成' }
        },
        required: ['todo_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_todo',
      description: '删除一条待办（按内容匹配）。删除前建议先向用户确认。',
      parameters: {
        type: 'object',
        properties: {
          todo_content: { type: 'string', description: '用于定位的待办内容（支持部分匹配）' },
          confirm: { type: 'boolean', description: '必须为 true 才真正删除，防止误删' }
        },
        required: ['todo_content', 'confirm']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_project',
      description: '更新当前项目的进度、当前阶段、下一阶段、研究目标或一句话描述。',
      parameters: {
        type: 'object',
        properties: {
          progress: { type: 'number', description: '整体进度百分比 0-100' },
          stage: { type: 'string', description: '当前阶段' },
          next_stage: { type: 'string', description: '下一阶段' },
          goal: { type: 'string', description: '研究目标' },
          subtitle: { type: 'string', description: '一句话描述' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_materials',
      description: '列出当前项目的材料目录与其中登记的文件；也可查看某个指定目录。',
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string', description: '目录名，留空则返回全部目录' } },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_project_folder',
      description: '在系统文件管理器中打开当前项目的材料目录（真实打开文件夹）。',
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string', description: '要打开的目录名，留空则打开项目根目录' } },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: '在个人科研知识库中检索资料（论文、报告、数据、代码）。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '检索关键词' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_software',
      description: '列出软件启动台中登记的程序、是否正在运行、绑定到哪个项目。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'launch_software',
      description: '启动软件启动台中的一个工程软件（真实拉起进程）。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '软件名称，如 Fluent / Tecplot / Python' } },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_projects',
      description: '列出工作台里的全部科研项目及其进度、阶段、负责 Agent、任务数与材料目录。要用外部数据管理项目时，先调用它了解有哪些项目。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_templates',
      description: '列出可用的项目模板（内置 + 用户自定义），返回 ID、名称、目录与阶段，配合 create_project 的 template 参数使用。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: '新建一个科研项目。默认套用「标准科研项目」模板：生成文献/数据/仿真/分析/文档/参考六类材料目录、五个阶段与三条起始任务。项目会被持久保存，不需要用户再手动创建。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称（工作台内唯一）' },
          folder: { type: 'string', description: '项目文件夹名（省略则用项目名）。只能是一层目录名，不能带路径分隔符' },
          subtitle: { type: 'string', description: '一句话描述' },
          goal: { type: 'string', description: '研究目标：要解决什么问题、做到什么程度' },
          period: { type: 'string', description: '研究周期，如 2026.10 - 2027.06' },
          template: { type: 'string', description: '模板 ID：standard=内置标准模板（默认），blank=空壳，或用户自存模板的 ID（先用 list_templates 查看）' },
          starter_tasks: { type: 'boolean', description: '是否生成模板自带的 3 条起始任务，默认 true' },
          set_current: { type: 'boolean', description: '是否把新项目设为当前工作区，默认 true' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_project',
      description: '删除一个项目及其全部任务与排期（磁盘上的材料文件夹不会删除）。不可逆操作：第一次调用只返回需要确认，必须在用户明确同意后带 confirm=true 再次调用。',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '项目名称或 ID' },
          delete_folder: { type: 'boolean', description: '是否把磁盘上的项目文件夹也移入回收站（默认否）' },
          confirm: { type: 'boolean', description: '用户确认删除后传 true' }
        },
        required: ['project']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'switch_project',
      description: '切换当前工作区。之后的读写操作默认作用于该项目。',
      parameters: {
        type: 'object',
        properties: { project: { type: 'string', description: '项目名称或项目 ID（支持部分匹配）' } },
        required: ['project']
      }
    }
  },
    {
      type: 'function',
      function: {
        name: 'save_document',
        description: '把成稿的写作内容（论文/综述/专利章节、草稿）保存为项目写作目录下的 Markdown 文件，并登记进知识库。成文后应调用本工具存档。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '文档标题，例如：换热器论文-方法章节' },
            kind: { type: 'string', enum: ['paper', 'review', 'patent', 'other'], description: '文体：论文/综述/专利/其他' },
            content: { type: 'string', description: '正文全文（纯文本，可含公式）' }
          },
          required: ['title', 'content']
        }
      }
  },
];

/* ==========================================================================
   工具实现
   ========================================================================== */
/* 兜底检索：只按资料名称匹配。不伪造相关度分数，明确标注 matched='name' */
function kbNameMatch(q) {
  const kw = String(q).toLowerCase();
  const hits = DB.kbDocs
    .filter(d => (d.n + d.type).toLowerCase().includes(kw))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 8)
    .map(d => ({ title: d.n, type: d.type, size: d.size, date: d.date, matched: 'name' }));
  return { ok: true, query: q, count: hits.length, results: hits };
}

const AI_TOOL_IMPL = {
  async save_document({ title, kind, content } = {}) {
    const p = P(state.project);
    if (!p) return { ok: false, error: '当前没有选中项目' };
    title = String(title || '').trim();
    if (!title) return { ok: false, error: '缺少 title（文档标题）' };
    const body = String(content || '');
    if (body.trim().length < 20) return { ok: false, error: 'content 太短，像是不完整的成文，未保存' };
    const catName = { paper: '论文', review: '综述', patent: '专利' }[kind] || '文档';
    const safe = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
    const rel = [p.name, '写作', `${safe}.md`].join('/');
    const r = await Bridge.saveWritingDoc({ relPath: rel, content: body, meta: { title, kind: catName } });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || '保存失败' };
    let kbId = '';
    const exist = DB.kbDocs.find(d => d.file === r.relPath);
    if (exist) {
      kbId = exist.id || '';
    } else {
      kbId = 'kb' + Date.now().toString(36);
      DB.kbDocs.unshift({
        id: kbId, n: title, type: `写作·${catName}`, ext: 'md', size: '—',
        date: new Date().toISOString().slice(0, 10), score: 0.9, file: r.relPath
      });
    }
    logActivity(`<b>AI</b> 保存写作草稿 <b>${esc(title)}</b>`, 'save', '#218358');
    return { ok: true, title, savedPath: r.absPath, kbId, kb: !!kbId };
  },
  async get_project_context() {
    const p = P(state.project);
    if (!p) {
      return {
        ok: false,
        error: DB.projects.length
          ? '当前没有选中项目，先用 switch_project 指定一个'
          : '工作台里还没有项目。可以用 create_project 新建，或提示用户手动创建',
        projects: DB.projects.map(x => x.name)
      };
    }
    return {
      ok: true,
      project: {
        id: p.id, name: p.name, subtitle: p.subtitle, goal: p.goal,
        stage: p.stage, next_stage: p.next, progress: p.progress,
        period: p.period, tools: p.tools, agents: p.agents, owner: p.owner.n
      },
      material_dirs: dirsOf(p.id),
      project_folder: projectDir(p),
      tasks: DB.tasks.filter(t => t.p === p.id).map(t => ({
        title: t.t, agent: t.agent, tool: t.tool, due: t.due,
        priority: PRI_OUT[t.pri], status: ST_OUT[t.st], material_dir: t.dir
      })),
      todos: DB.todos.map((t, i) => ({
        index: i, content: t.t, category: t.cat,
        priority: PRI_OUT[t.pri], due: t.due, done: t.done
      }))
    };
  },

  async list_tasks({ status, project } = {}) {
    const target = project ? resolveProject(project) : P(state.project);
    if (project && !target) return { ok: false, error: `未找到项目「${project}」。可用项目：${projectHint()}` };
    if (!target) return { ok: true, count: 0, tasks: [], project: '', message: '还没有项目' };
    const want = status && status !== '全部' ? ST_IN[status] : null;
    const list = DB.tasks.filter(t => t.p === target.id && (!want || t.st === want));
    return {
      ok: true,
      count: list.length,
      tasks: list.map(t => ({
        id: t.id || '',
        title: t.t, agent: t.agent, tool: t.tool, due: t.due,
        priority: PRI_OUT[t.pri], status: ST_OUT[t.st], material_dir: t.dir
      })),
      project: target.name
    };
  },

  async create_task(args = {}) {
    const title = String(args.title || '').trim();
    if (!title) return { ok: false, error: 'task title 不能为空' };
    const p = args.project ? resolveProject(args.project) : P(state.project);
    if (args.project && !p) return { ok: false, error: `未找到项目「${args.project}」。可用项目：${projectHint()}` };
    if (!p) {
      return {
        ok: false,
        error: DB.projects.length ? '当前没有选中项目，请带上 project 参数' : '还没有项目，先用 create_project 建一个'
      };
    }
    const dirs = dirsOf(p.id);
    const dir = args.material_dir && dirs.includes(args.material_dir) ? args.material_dir : (dirs[0] || '');
    const task = {
      id: newTaskId(),
      t: title,
      p: p.id,
      agent: args.agent || (p.agents[0] || ''),
      tool: args.tool || (p.tools[0] || 'Python'),
      due: args.due || '待定',
      pri: PRI_IN[args.priority] || 'mid',
      st: ST_IN[args.status] || 'todo',
      dir
    };
    DB.tasks.unshift(task);
    logActivity(`<b>AI</b> 新建任务「${esc(title)}」`, 'create', '#218358');
    persist();
    return { ok: true, created: task.t, project: p.name, material_dir: dir, message: `已在项目「${p.name}」下创建任务` };
  },

  async update_task(args = {}) {
    if (!args.task_id && !args.task_title) return { ok: false, error: '请提供 task_id（推荐，来自 list_tasks）或 task_title' };
    const scope = args.project ? resolveProject(args.project) : null;
    if (args.project && !scope) return { ok: false, error: `未找到项目「${args.project}」。可用项目：${projectHint()}` };
    const scopeId = scope ? scope.id : null;

    /* 优先 task_id；没有 id 才退回标题定位 */
    let i = -1;
    if (args.task_id) {
      i = findTaskById(args.task_id, scopeId);
      if (i < 0) return { ok: false, error: `未找到任务 id「${args.task_id}」，请先用 list_tasks 拿准确 id` };
    } else {
      i = findTask(args.task_title, scopeId);
      if (i < 0) return { ok: false, error: `未找到任务「${args.task_title}」，请先用 list_tasks 查看准确名称` };
      /* 同名多条时要求改用 id，避免改错 */
      const same = DB.tasks.filter(t => t.t === String(args.task_title || '').trim() && (!scopeId || t.p === scopeId));
      if (same.length > 1) {
        return {
          ok: false, code: 'ambiguous',
          error: `有 ${same.length} 个同名任务「${args.task_title}」，请改用 task_id 定位`,
          candidates: same.map(t => ({ id: t.id, title: t.t, project: (P(t.p) || {}).name || '' }))
        };
      }
    }
    const t = DB.tasks[i];
    const changes = [];
    if (args.status && ST_IN[args.status]) { t.st = ST_IN[args.status]; changes.push(`状态→${args.status}`); }
    if (args.priority && PRI_IN[args.priority]) { t.pri = PRI_IN[args.priority]; changes.push(`优先级→${args.priority}`); }
    if (args.due) { t.due = args.due; changes.push(`截止→${args.due}`); }
    if (args.agent) { t.agent = args.agent; changes.push(`负责人→${args.agent}`); }
    if (args.material_dir && dirsOf(t.p).includes(args.material_dir)) { t.dir = args.material_dir; changes.push(`目录→${args.material_dir}`); }
    if (!changes.length) return { ok: false, error: '没有提供任何要修改的字段' };
    logActivity(`<b>AI</b> 更新任务「${esc(t.t)}」：${esc(changes.join('、'))}`, 'edit', '#AD5700');
    persist();
    return { ok: true, task: t.t, changes };
  },

  async delete_task(args = {}) {
    if (!args.task_id && !args.task_title) return { ok: false, error: '请提供 task_id（推荐，来自 list_tasks）或 task_title' };
    const scope = args.project ? resolveProject(args.project) : null;
    if (args.project && !scope) return { ok: false, error: `未找到项目「${args.project}」` };
    const scopeId = scope ? scope.id : null;

    let i = -1;
    if (args.task_id) {
      i = findTaskById(args.task_id, scopeId);
      if (i < 0) return { ok: false, error: `未找到任务 id「${args.task_id}」，请先用 list_tasks 拿准确 id` };
    } else {
      i = findTask(args.task_title, scopeId);
      if (i < 0) return { ok: false, error: `未找到任务「${args.task_title}」` };
      const same = DB.tasks.filter(t => t.t === String(args.task_title || '').trim() && (!scopeId || t.p === scopeId));
      if (same.length > 1) {
        return {
          ok: false, code: 'ambiguous',
          error: `有 ${same.length} 个同名任务「${args.task_title}」，请改用 task_id 删除`,
          candidates: same.map(t => ({ id: t.id, title: t.t, project: (P(t.p) || {}).name || '' }))
        };
      }
    }
    const [removed] = DB.tasks.splice(i, 1);
    logActivity(`<b>AI</b> 删除任务「${esc(removed.t)}」`, 'delete', '#CE2C31');
    persist();
    return { ok: true, deleted: removed.t, id: removed.id || '' };
  },

  async create_todo(args = {}) {
    const content = String(args.content || '').trim();
    if (!content) return { ok: false, error: 'content 不能为空' };
    const CAT = { '任务': 'task', '会议': 'meeting', '截止日期': 'deadline', '其他': 'other' };
    const todo = {
      t: content,
      cat: CAT[args.category] || 'task',
      pri: PRI_IN[args.priority] || 'mid',
      due: args.due || '未设置',
      done: false
    };
    DB.todos.unshift(todo);
    logActivity(`<b>AI</b> 新增待办「${esc(content)}」`, 'create', '#218358');
    persist();
    return { ok: true, created: todo.t, due: todo.due, priority: PRI_OUT[todo.pri] };
  },

  async delete_todo({ todo_content, confirm } = {}) {
    if (confirm !== true) {
      return { ok: false, needsConfirm: true, error: '删除待办需要 confirm=true 两段确认' };
    }
    const i = findTodo(todo_content);
    if (i < 0) return { ok: false, error: `未找到待办「${todo_content}」` };
    const t = DB.todos[i];
    DB.todos.splice(i, 1);
    logActivity(`<b>AI</b> 删除待办「${esc(t.t)}」`, 'delete', '#C4344B');
    persist();
    return { ok: true, deleted: t.t };
  },


  async update_todo(args = {}) {
    const i = findTodo(args.todo_content);
    if (i < 0) return { ok: false, error: `未找到待办「${args.todo_content}」` };
    const t = DB.todos[i];
    const CAT = { '任务': 'task', '会议': 'meeting', '截止日期': 'deadline', '其他': 'other' };
    const changes = [];
    if (args.new_content) { t.t = args.new_content; changes.push('内容已更新'); }
    if (args.category && CAT[args.category]) { t.cat = CAT[args.category]; changes.push(`分类→${args.category}`); }
    if (args.priority && PRI_IN[args.priority]) { t.pri = PRI_IN[args.priority]; changes.push(`优先级→${args.priority}`); }
    if (args.due) { t.due = args.due; changes.push(`时间→${args.due}`); }
    if (typeof args.done === 'boolean') { t.done = args.done; changes.push(args.done ? '标记完成' : '标记未完成'); }
    if (!changes.length) return { ok: false, error: '没有提供任何要修改的字段' };
    logActivity(`<b>AI</b> 更新待办「${esc(t.t)}」`, 'edit', '#AD5700');
    persist();
    return { ok: true, todo: t.t, changes };
  },

  async update_project(args = {}) {
    const p = args.project ? resolveProject(args.project) : P(state.project);
    if (args.project && !p) return { ok: false, error: `未找到项目「${args.project}」。可用项目：${projectHint()}` };
    if (!p) return { ok: false, error: DB.projects.length ? '当前没有选中项目，请带上 project 参数' : '还没有项目，先用 create_project 建一个' };
    const changes = [];
    if (args.progress != null) {
      const v = Math.max(0, Math.min(100, Math.round(+args.progress)));
      if (Number.isFinite(v)) { p.progress = v; changes.push(`进度→${v}%`); }
    }
    if (args.stage) { p.stage = args.stage; changes.push(`当前阶段→${args.stage}`); }
    if (args.next_stage) { p.next = args.next_stage; changes.push(`下一阶段→${args.next_stage}`); }
    if (args.goal) { p.goal = args.goal; changes.push('研究目标已更新'); }
    if (args.subtitle) { p.subtitle = args.subtitle; changes.push('描述已更新'); }
    if (!changes.length) return { ok: false, error: '没有提供任何要修改的字段' };
    logActivity(`<b>AI</b> 更新项目「${esc(p.name)}」：${esc(changes.join('、'))}`, 'edit', '#6E56CF');
    persist();
    return { ok: true, project: p.name, changes };
  },

  async list_templates() {
    return {
      ok: true,
      count: allTemplates().length + 1,
      templates: [
        ...allTemplates().map(t => ({
          id: t.id, name: t.name, desc: t.desc || '', builtin: !!t.builtin,
          dirs: t.dirs || [], flow: t.flow || [],
          starter_tasks: (t.tasks || []).length
        })),
        { id: 'blank', name: '空白项目', desc: '只有 01_资料 目录', builtin: true, dirs: ['01_资料'], flow: [], starter_tasks: 0 }
      ]
    };
  },

  async create_project(args = {}) {
    const name = String(args.name || '').trim();
    if (!name) return { ok: false, error: '项目名称不能为空' };
    const dup = DB.projects.find(p => p.name === name);
    if (dup) return { ok: false, error: `项目「${name}」已存在（id=${dup.id}）。要补充内容请用 update_project 或 create_task` };

    const tplId = args.template ? String(args.template) : 'standard';
    const tpl = templateById(tplId);
    const proj = makeProject({
      name,
      folder: args.folder,
      subtitle: args.subtitle,
      goal: args.goal,
      period: args.period,
      templateId: tplId
    });
    if (DB.projects.some(x => (x.folder || x.name) === proj.folder)) {
      return { ok: false, error: `工作区里已有文件夹「${proj.folder}」，请换一个 folder` };
    }
    const span = monthsFromPeriod(proj.period);
    const wantTasks = !!tpl && args.starter_tasks !== false;
    const md = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    DB.projects.push(proj);
    MATERIALS[proj.id] = Object.fromEntries((tpl ? tpl.dirs : ['01_资料']).map(d => [d, []]));
    DB.timeline.push({ p: proj.name, bars: [{ s: span.s, e: span.e, l: proj.stage, c: proj.accent }] });
    if (wantTasks) {
      tpl.tasks.forEach(([t, agent], i) => {
        const d = new Date(Date.now() + (i + 1) * 5 * 864e5);
        DB.tasks.push({
          t, p: proj.id, agent, tool: '文档', due: md(d),
          pri: i === 0 ? 'high' : 'mid', st: 'todo', dir: tpl.dirs[0], src: 'template'
        });
      });
    }
    if (args.set_current !== false) {
      state.project = proj.id;
      DB.workspace.project = proj.name;
    }
    if (!DB.settings.defaultWorkspace) DB.settings.defaultWorkspace = proj.id;
    DB.settings.onboarded = true;

    logActivity(`<b>AI</b> 创建项目「${esc(proj.name)}」`, 'create', '#218358');
    persist();
    return {
      ok: true,
      id: proj.id,
      name: proj.name,
      template: tplId,
      folder: proj.folder,
      material_dirs: dirsOf(proj.id),
      starter_tasks: wantTasks ? tpl.tasks.length : 0,
      folder: projectDir(proj),
      message: `项目「${proj.name}」已创建，材料目录会在下次打开时落盘`
    };
  },

  async delete_project(args = {}) {
    const p = resolveProject(args.project);
    if (!p) return { ok: false, error: `未找到项目「${args.project}」。可用项目：${projectHint()}` };
    const taskCount = DB.tasks.filter(t => t.p === p.id).length;
    if (args.confirm !== true) {
      return {
        ok: false,
        need_confirm: true,
        project: p.name,
        folder: projectDir(p),
        tasks: taskCount,
        error: `删除「${p.name}」会移除 ${taskCount} 个任务与它的排期（磁盘上的材料文件夹保留）。这是不可逆操作，请先向用户确认；用户同意后再带 confirm=true 调用。`
      };
    }

    DB.tasks = DB.tasks.filter(t => t.p !== p.id);
    DB.timeline = DB.timeline.filter(x => x.p !== p.name);
    if (DB.chats) delete DB.chats[p.id];
    DB.projects = DB.projects.filter(x => x.id !== p.id);
    if (state.project === p.id) {
      state.project = (DB.projects[0] || {}).id || '';
      DB.workspace.project = (DB.projects[0] || {}).name || '';
    }
    if (DB.settings.defaultWorkspace === p.id) DB.settings.defaultWorkspace = (DB.projects[0] || {}).id || '';
    logActivity(`<b>AI</b> 删除项目「${esc(p.name)}」${args.delete_folder ? '（含文件夹）' : ''}`, 'delete', '#CE2C31');
    persist();

    let folder = null;
    if (args.delete_folder === true && Bridge.desktop && rootDir()) {
      folder = await Bridge.trashPath(projectDir(p));
    }
    return {
      ok: true, deleted: p.name, removed_tasks: taskCount, remaining: DB.projects.length,
      folder_trashed: folder ? !!folder.ok : false,
      folder_error: folder && folder.ok === false ? folder.error : undefined
    };
  },

  async list_materials({ dir } = {}) {
    const p = P(state.project);
    if (!p) return { ok: false, error: '当前没有选中项目' };
    const all = MATERIALS[p.id] || {};
    if (dir) {
      if (!all[dir]) return { ok: false, error: `目录「${dir}」不存在。可用目录：${dirsOf(p.id).join('、')}` };
      return { ok: true, dir, full_path: projectDir(p) + '\\' + dir, files: all[dir].map(f => ({ name: f[0], size: f[1] })) };
    }
    return {
      ok: true,
      project_folder: projectDir(p),
      dirs: Object.entries(all).map(([d, files]) => ({ dir: d, file_count: files.length, files: files.map(f => f[0]) }))
    };
  },

  async open_project_folder({ dir } = {}) {
    const p = P(state.project);
    if (!p) return { ok: false, error: '当前没有选中项目' };
    if (dir && !dirsOf(p.id).includes(dir)) {
      return { ok: false, error: `目录「${dir}」不存在。可用目录：${dirsOf(p.id).join('、')}` };
    }
    const target = projectDir(p) + (dir ? '\\' + dir : '');
    const r = await Bridge.openFolder(target);
    if (r.ok) {
      logActivity(`<b>AI</b> 打开材料目录 ${esc(dir || p.name)}`, 'open', '#218358');
      persist();
      return { ok: true, opened: target };
    }
    return { ok: false, error: r.error };
  },

  async search_knowledge({ query } = {}) {
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: 'query 不能为空' };
    const S = DB.settings;

    /* 知识库引擎（插件宿主）：builtin=内置, rag_snowz/http=外部服务, none=只用文件名匹配
       宿主只负责按配置分流与降级，具体检索实现由引擎提供（见方案 4.4 契约） */
    const engine = S.kbEngine || (S.ragEnabled ? 'http' : 'builtin');

    if (engine === 'none') {
      return Object.assign(kbNameMatch(q), {
        channel: 'name_fallback', code: 'engine_none',
        warning: '未启用知识库引擎，已按资料名称匹配。可在「设置 → AI 接入 → 知识库引擎」配置。'
      });
    }

    if (engine === 'http' || engine === 'rag_snowz') {
      if (!S.ragEndpoint) {
        return Object.assign(kbNameMatch(q), {
          channel: 'name_fallback', code: 'engine_missing',
          warning: '知识库引擎未配置服务地址，已按资料名称匹配。'
        });
      }
      const r = await Bridge.ragSearch({ endpoint: S.ragEndpoint, query: q, topK: Number(S.ragTopK) || 8 });
      if (r && r.ok) {
        const results = (r.results || []).map(x => ({
          title: x.title, path: x.path, snippet: x.snippet,
          score: x.score, page: x.page, type: x.docType
        }));
        return {
          ok: true, query: q, channel: 'rag', engine, code: results.length ? 'ok' : 'empty_corpus',
          count: results.length, results
        };
      }
      /* 不可用时如实告知，并退回名称匹配，不编造结果 */
      return Object.assign(kbNameMatch(q), {
        channel: 'name_fallback', code: 'engine_down',
        warning: 'RAG 服务不可用，已退回资料名称匹配：' + ((r && r.error) || '未知错误')
      });
    }

    return { ...kbNameMatch(q), channel: 'name' };
  },

  async list_software() {
    return {
      ok: true,
      apps: DB.apps.map(a => ({
        name: a.n,
        kind: a.kind === 'builtin' ? '内置视图' : a.kind === 'folder' ? '文件夹' : '程序',
        path: a.path || '(内置)',
        running: !!a.run,
        bound_project: a.run ? (P(a.run) || {}).name : null
      })),
      sidebar_quick_launch: DB.sidebarLaunch
    };
  },

  async launch_software({ name } = {}) {
    const a = APP(name);
    if (!a) return { ok: false, error: `启动台中没有「${name}」。可用：${DB.apps.map(x => x.n).join('、')}` };
    if (a.kind === 'builtin') return { ok: true, message: `${name} 是内置视图，请让用户切换到「浏览器」页` };
    if (a.kind === 'folder') {
      const r = await Bridge.openFolder(a.path);
      return r.ok ? { ok: true, opened: a.path } : { ok: false, error: r.error };
    }
    const r = await Bridge.launchApp({ name: a.n, execPath: a.path, args: a.args || [], cwd: a.cwd || undefined });
    if (r.ok) {
      a.run = state.project;
      if (!DB.workspace.running.includes(a.n)) DB.workspace.running.push(a.n);
      logActivity(`<b>AI</b> 启动软件 <b>${esc(a.n)}</b> (PID ${r.pid})`, 'run', '#C9256B');
      persist();
      return { ok: true, launched: a.n, pid: r.pid };
    }
    return { ok: false, error: r.error };
  },

  async list_projects() {
    return {
      ok: true,
      current: state.project,
      count: DB.projects.length,
      projects: DB.projects.map(p => ({
        id: p.id,
        name: p.name,
        subtitle: p.subtitle,
        goal: p.goal,
        progress: p.progress,
        stage: p.stage,
        next_stage: p.next,
        period: p.period,
        owner: p.owner.n,
        agents: p.agents,
        tools: p.tools,
        task_count: DB.tasks.filter(t => t.p === p.id).length,
        open_tasks: DB.tasks.filter(t => t.p === p.id && t.st !== 'done').length,
        material_dirs: dirsOf(p.id),
        folder: projectDir(p)
      }))
    };
  },

  async switch_project(args = {}) {
    const q = String(args.project || '').trim();
    if (!q) return { ok: false, error: 'project 不能为空' };
    const p = DB.projects.find(x => x.id === q)
      || DB.projects.find(x => x.name === q)
      || DB.projects.find(x => x.name.includes(q) || q.includes(x.name));
    if (!p) return { ok: false, error: `未找到项目「${q}」。可用项目：${DB.projects.map(x => x.name).join('、')}` };
    state.project = p.id;
    DB.workspace.project = p.name;
    logActivity(`切换工作区到 <b>${esc(p.name)}</b>`, 'edit', '#6E56CF');
    persist();
    return { ok: true, current: p.id, name: p.name, message: `当前工作区已切换为「${p.name}」` };
  }
};

/* ==========================================================================
   调用描述（用于对话流可视化，让用户看清 AI 到底做了什么）
   ========================================================================== */
const TOOL_LABEL = {
  get_project_context: '读取项目上下文',
  list_tasks: '查询任务列表',
  create_task: '新建任务',
  update_task: '修改任务',
  delete_task: '删除任务',
  create_todo: '新增待办',
  update_todo: '修改待办',
  list_templates: '查看模板',
  create_project: '新建项目',
  delete_project: '删除项目',
  update_project: '更新项目',
  list_materials: '查看材料目录',
  open_project_folder: '打开材料文件夹',
  search_knowledge: '检索知识库',
  list_software: '查看软件列表',
  launch_software: '启动软件',
  list_projects: '列出全部项目',
  switch_project: '切换当前项目'
};

function describeToolCall(name, args = {}) {
  const label = TOOL_LABEL[name] || name;
  const bits = [];
  const pick = (k, t) => { if (args[k] != null && args[k] !== '') bits.push(t ? `${t}：${args[k]}` : String(args[k])); };
  switch (name) {
    case 'create_task':        pick('title'); pick('agent', '负责'); pick('due', '截止'); break;
    case 'update_task':        pick('task_title'); if (args.status) bits.push(`→ ${args.status}`); if (args.priority) bits.push(`优先级 → ${args.priority}`); break;
    case 'delete_task':        pick('task_title'); break;
    case 'create_todo':        pick('content'); pick('due', '时间'); break;
    case 'update_todo':        pick('todo_content'); if (args.done === true) bits.push('→ 完成'); if (args.done === false) bits.push('→ 未完成'); break;
    case 'update_project':     if (args.progress != null) bits.push(`进度 → ${args.progress}%`); pick('stage', '阶段'); break;
    case 'list_materials':     pick('dir', '目录'); break;
    case 'open_project_folder':pick('dir', '目录'); break;
    case 'search_knowledge':   pick('query', '关键词'); break;
    case 'launch_software':    pick('name'); break;
    case 'list_tasks':         pick('status', '状态'); break;
    case 'switch_project':     pick('project', '目标项目'); break;
    default: break;
  }
  return bits.length ? `${label}（${bits.join('，')}）` : label;
}
