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
    || DB.projects.find(x => x.name === key || x.displayName === key)
    || DB.projects.find(x => x.name.includes(key) || (x.displayName || '').includes(key) || key.includes(x.name))
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
      description: '更新当前项目的进度、当前阶段、下一阶段、研究目标、一句话描述或界面显示名。显示名与文件夹名互相独立。',
      parameters: {
        type: 'object',
        properties: {
          progress: { type: 'number', description: '整体进度百分比 0-100' },
          stage: { type: 'string', description: '当前阶段' },
          next_stage: { type: 'string', description: '下一阶段' },
          goal: { type: 'string', description: '研究目标' },
          subtitle: { type: 'string', description: '一句话描述' },
          display_name: { type: 'string', description: '界面显示名。不改项目名称，也不改磁盘文件夹名' }
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
      description: '在个人科研知识库中检索或抽取式问答。调用时必须显式传入 mode。综述和论文必须用 mode=search，并换中文、英文多次查询，目标是多个 document_id；短问答再用 mode=ask。search 返回检索片段，ask 返回 answer 与 citations（含 source_relative_path、block_ids、source_spans、document_id）。引用必须使用返回的路径，不要编造。若 unique_docs 少于 3，先换英文术语或放宽检索，不要只根据一篇文献展开。若本次是 mode=ask 且 unique_docs 少于 3，或结果带有文档不足的 warning，立刻改用 mode=search，并用更宽的中文和英文 query 再查。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词。综述请分别用中文和英文术语各查一次。' },
          mode: {
            type: 'string',
            enum: ['search', 'ask'],
            description: '必须显式传入。search=多文档检索，写综述、列文献、写论文用它；ask=短问答。省略时：写作 Agent，或 query 像文献清单/综述/论文，默认 search；短问答默认 ask。'
          }
        },
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
/* dry_run 的唯一判定：布尔 true、数字 1、字符串 "true"/"1" 都算预览。写工具不得落盘。 */
function isDryRun(args) {
  if (!args || typeof args !== 'object') return false;
  const v = Object.prototype.hasOwnProperty.call(args, 'dry_run') ? args.dry_run : args.dryRun;
  return v === true || v === 1 || v === 'true' || v === '1';
}
function dryRunResult(tool, args) {
  const preview = { ...(args || {}) };
  delete preview.dry_run;
  delete preview.dryRun;
  return {
    ok: true, dryRun: true, tool,
    args: preview,
    message: '预览模式：没有执行任何写入、删除或启动操作'
  };
}
const TOOL_READ_ONLY = /^(get_|list_|search_)/;
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

/* mode=ask 且不足 3 篇时，工具结果直接要求立刻改走 search，并加宽中英文查询。 */
function thinAskRetryWarning(n) {
  return `unique_docs=${n}（少于 3）。文档不足。请立刻再次调用 search_knowledge，改用 mode=search，并用更宽的中文 query 和英文 query 各查一次。不要只重复当前问句，也不要根据这一次 ask 的结果展开成文。`;
}

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/* 键盘连打：相邻字母大多落在同一行。正常英文词几乎不会整段贴着键位走。 */
function keyboardMash(word) {
  const w = String(word || '').toLowerCase();
  if (w.length < 6 || !/^[a-z]+$/.test(w)) return false;
  if (KEY_ROWS.some(row => row.includes(w) || row.split('').reverse().join('').includes(w))) return true;
  let adjacent = 0;
  for (let i = 1; i < w.length; i++) {
    const prev = w[i - 1];
    const cur = w[i];
    const hit = KEY_ROWS.some(row => {
      const a = row.indexOf(prev);
      const b = row.indexOf(cur);
      return a >= 0 && b >= 0 && Math.abs(a - b) === 1;
    });
    if (hit) adjacent += 1;
  }
  return adjacent / (w.length - 1) >= 0.6;
}

/* 乱码、纯符号、键盘连打，或没有元音的长串字母。正常中文、英文词和缩写（TPMS）不算。 */
function queryLooksGarbled(query) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (/\uFFFD|ï¿½|Ã.|Â.|â€/.test(q)) return true;
  if (/^(.)\1{5,}$/.test(q)) return true;
  const letters = (q.match(/[\u4e00-\u9fffA-Za-z0-9]/g) || []).length;
  if (!letters) return true;
  if (letters / q.length < 0.45) return true;
  const words = q.split(/\s+/).filter(Boolean);
  const mash = words.filter(w => {
    if (/[\u4e00-\u9fff]/.test(w)) return false;
    if (/^[A-Z0-9][A-Z0-9+\-./]{0,15}$/.test(w)) return false;
    if (keyboardMash(w)) return true;
    return w.length >= 6 && /^[A-Za-z]+$/.test(w) && !/[aeiouAEIOU]/.test(w);
  });
  return words.length > 0 && mash.length === words.length;
}

/* 空结果或乱码查询：一句人话。不要只说「换英文术语」。 */
function plainSearchMissWarning(query) {
  if (queryLooksGarbled(query)) {
    return '这次查询不像正常检索词，没有查到文献，请换成清楚的中文或英文关键词。';
  }
  return '这次没有检索到文献，知识库返回的是空结果。';
}

/* 同一 document_id（没有 id 时用路径）只算一篇。少于 3 篇时提醒换英文词、放宽检索。 */
function withUniqueDocs(payload) {
  const rows = (payload && (payload.citations || payload.results)) || [];
  const byId = new Map();
  const coveredPaths = new Set();
  rows.forEach(x => {
    const id = String((x && x.document_id) || '').trim();
    const rel = String((x && (x.source_relative_path || x.path)) || '').trim().replace(/\\/g, '/');
    if (!id) return;
    coveredPaths.add(rel.toLowerCase());
    if (!byId.has(id)) byId.set(id, id);
  });
  const ids = [...byId.keys()];
  const seenPaths = new Set(coveredPaths);
  rows.forEach(x => {
    const id = String((x && x.document_id) || '').trim();
    if (id) return;
    const rel = String((x && (x.source_relative_path || x.path)) || '').trim().replace(/\\/g, '/');
    const key = rel.toLowerCase();
    if (!key || seenPaths.has(key)) return;
    seenPaths.add(key);
    ids.push(rel);
  });
  const out = Object.assign({}, payload, { unique_docs: ids.length, document_ids: ids });
  if (ids.length < 3) {
    const mode = String((payload && payload.mode) || '').trim().toLowerCase();
    const query = payload && payload.query;
    const empty = ids.length === 0 || (payload && payload.code) === 'empty_corpus';
    const garbled = queryLooksGarbled(query);
    let tip;
    if (garbled || (empty && mode !== 'ask')) {
      tip = plainSearchMissWarning(query);
    } else if (mode === 'ask') {
      tip = thinAskRetryWarning(ids.length);
    } else {
      tip = `unique_docs=${ids.length}（少于 3）。请换英文术语或放宽检索范围，并用 mode=search 再查几次，凑齐多个 document_id。不要只根据同一篇文献展开。`;
    }
    out.warning = out.warning ? (out.warning + ' ' + tip) : tip;
    if (mode === 'ask' && !garbled) {
      out.next_step = '立刻再次调用 search_knowledge，mode=search，并用更宽的中文 query 和英文 query 各查一次。';
    }
  }
  return out;
}

function callerLooksLikeWriting() {
  const name = (typeof state !== 'undefined' && state && state.aiAgent) || '';
  if (!name || typeof DB === 'undefined' || !Array.isArray(DB.agents)) return false;
  const agent = DB.agents.find(a => a && a.name === name);
  if (!agent) return false;
  if (String(agent.presetKey || '').indexOf('writing-') === 0) return true;
  if (typeof writingReviewAgent === 'function') {
    const review = writingReviewAgent();
    if (review && review.name === name) return true;
  }
  return false;
}

/* 列文献、写综述、写论文。短问句（什么是、结论、这篇）仍走问答。 */
function queryLooksLikeLiterature(query) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (/(文献清单|分类框架|literature review|\bliterature\b)/i.test(q)) return true;
  if (/(这篇|那篇|什么是|是什么|为什么|怎么|如何|是否|结论)/.test(q) && !/文献清单|分类框架/.test(q)) return false;
  if (/(?:写|撰写).{0,16}(?:综述|论文)/.test(q)) return true;
  if (/文献/.test(q)) return true;
  if (/(综述|论文)/.test(q)) return true;
  return false;
}

/* 显式 search / ask 优先。省略时：写作身份或文献类 query 走检索，短问答仍走 ask。 */
function knowledgeWantsSearch(mode, query) {
  const requested = String(mode || '').trim().toLowerCase();
  if (requested === 'search') return true;
  if (requested === 'ask') return false;
  if (callerLooksLikeWriting()) return true;
  if (queryLooksLikeLiterature(query)) return true;
  return false;
}

/* 项目只有文件夹名。根目录为空时说明怎么设置，不拼盘符。 */
function workspaceRootMissingError(project) {
  const name = (project && (project.displayName || project.name)) || '';
  const folder = (project && (project.folder || project.name)) || '';
  const who = name
    ? `当前项目「${name}」只记录了文件夹名「${folder || '未命名'}」，没有可用的绝对路径。`
    : '项目记录里没有可用的绝对路径。';
  return '尚未设置工作区根目录，文档没有写入磁盘。请打开「设置 → 数据与同步」，点「工作区根目录」右侧的「更改」，选择本机已经存放项目材料的文件夹；也可以在新建项目时指定根目录。'
    + who
    + '不会猜测盘符，也不会写到别的位置。';
}

const AI_TOOL_IMPL_RAW = {
  async save_document({ title, kind, content } = {}) {
    const p = P(state.project);
    if (!p) return { ok: false, error: '当前没有选中项目' };
    title = String(title || '').trim();
    if (!title) return { ok: false, error: '缺少 title（文档标题）' };
    const body = String(content || '');
    if (body.trim().length < 20) return { ok: false, error: 'content 太短，像是不完整的成文，未保存' };
    const catName = { paper: '论文', review: '综述', patent: '专利' }[kind] || '文档';
    const safe = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
    const folder = p.folder || p.name;
    const rel = [folder, '写作', `${safe}.md`].join('/');
    if (!rootDir()) return { ok: false, error: workspaceRootMissingError(p), code: 'root_missing' };
    if (!Bridge || typeof Bridge.saveWritingDoc !== 'function') {
      return { ok: false, error: 'Bridge.saveWritingDoc 不可用，桌面桥没有转发 doc:save-writing。' };
    }
    let r;
    try {
      r = await Bridge.saveWritingDoc({
        relPath: rel, content: body,
        projectName: p.displayName || p.name, projectFolder: folder,
        meta: { title, kind: catName }
      });
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || '保存失败' };
    let kbId = '';
    const exist = DB.kbDocs.find(d => d.file === r.relPath);
    const overwritten = !!(r && r.overwritten) || !!exist;
    if (exist) {
      kbId = exist.id || '';
    } else {
      kbId = 'kb' + Date.now().toString(36);
      DB.kbDocs.unshift({
        id: kbId, n: title, type: `写作·${catName}`, ext: 'md', size: '—',
        date: new Date().toISOString().slice(0, 10), score: 0.9, file: r.relPath
      });
    }
    logActivity(`<b>AI</b> ${overwritten ? '覆盖' : '保存'}写作草稿 <b>${esc(title)}</b>`, 'save', '#218358');
    const note = overwritten ? '同名文稿已存在，这次保存覆盖了原文件。' : '';
    return {
      ok: true, title, savedPath: r.absPath, relPath: r.relPath || rel,
      kbId, kb: !!kbId, overwritten,
      note: note || undefined
    };
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
    const materialDirs = dirsOf(p.id);
    const out = {
      ok: true,
      project: {
        id: p.id, name: p.name, display_name: p.displayName || p.name,
        folder: p.folder || p.name,
        subtitle: p.subtitle, goal: p.goal,
        stage: p.stage, next_stage: p.next, progress: p.progress,
        period: p.period, tools: p.tools, agents: p.agents, owner: p.owner.n
      },
      material_dirs: materialDirs,
      project_folder: projectDir(p),
      tasks: DB.tasks.filter(t => t.p === p.id).map(t => ({
        task_id: t.id || '', id: t.id || '',
        title: t.t, agent: t.agent, tool: t.tool, due: t.due,
        priority: PRI_OUT[t.pri], status: ST_OUT[t.st], material_dir: t.dir
      })),
      todos: DB.todos.map((t, i) => ({
        index: i, content: t.t, category: t.cat,
        priority: PRI_OUT[t.pri], due: t.due, done: t.done
      }))
    };
    if (!materialDirs.length) out.materials_note = '当前项目没有材料子目录。';
    return out;
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
        task_id: t.id || '',
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
    return {
      ok: true, created: task.t, task_id: task.id, id: task.id,
      project: p.name, material_dir: dir, message: `已在项目「${p.name}」下创建任务`
    };
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
    return { ok: true, task: t.t, task_id: t.id || '', id: t.id || '', changes };
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
    return { ok: true, deleted: removed.t, task_id: removed.id || '', id: removed.id || '' };
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
    if (args.display_name != null) {
      const dn = String(args.display_name).trim().slice(0, 60);
      if (!dn || dn === p.name) { delete p.displayName; changes.push('显示名恢复为项目名称'); }
      else { p.displayName = dn; changes.push('显示名已更新'); }
    }
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
          id: newTaskId(),
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
      display_name: proj.displayName || proj.name,
      template: tplId,
      folder: proj.folder,
      project_folder: projectDir(proj),
      material_dirs: dirsOf(proj.id),
      starter_tasks: wantTasks ? tpl.tasks.length : 0,
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
    const names = dirsOf(p.id);
    if (!names.length) {
      const note = (dir ? `目录「${dir}」不存在。` : '') + '当前项目没有材料子目录。';
      const out = { ok: !dir, empty: true, project_folder: projectDir(p), dirs: [], note };
      if (dir) out.error = note;
      return out;
    }
    if (dir) {
      if (!all[dir]) return { ok: false, error: `目录「${dir}」不存在。可用目录：${names.join('、')}` };
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
      const names = dirsOf(p.id);
      if (!names.length) {
        return { ok: false, empty: true, dirs: [], error: `目录「${dir}」不存在。当前项目没有材料子目录。` };
      }
      return { ok: false, error: `目录「${dir}」不存在。可用目录：${names.join('、')}` };
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

  async search_knowledge({ query, mode } = {}) {
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: 'query 不能为空' };
    const wantSearch = knowledgeWantsSearch(mode, q);
    const S = DB.settings;

    /* 知识库引擎（插件宿主）：builtin=内置, rag_snowz/http=外部服务, none=只用文件名匹配。
       检索在主进程转发，渲染层不直接请求 RAG 端口。 */
    const cfg = (typeof ragClientConfig === 'function')
      ? ragClientConfig(S)
      : { engine: S.kbEngine || (S.ragEnabled ? 'http' : 'builtin'), endpoint: S.ragEndpoint || '', topK: Number(S.ragTopK) || 8, snowz: S.kbEngine === 'rag_snowz', external: S.kbEngine === 'http' || S.kbEngine === 'rag_snowz' };
    const engine = cfg.engine;

    if (engine === 'none') {
      return Object.assign(kbNameMatch(q), {
        channel: 'name_fallback', code: 'engine_none',
        warning: '未启用知识库引擎，已按资料名称匹配。可在「设置 → AI 与知识库引擎」配置。'
      });
    }

    if (cfg.external) {
      if (!cfg.endpoint) {
        return Object.assign(kbNameMatch(q), {
          channel: 'name_fallback', code: 'engine_missing',
          warning: '知识库引擎未配置服务地址，已按资料名称匹配。'
        });
      }
      const payload = { endpoint: cfg.endpoint, query: q, topK: cfg.topK, engine };
      const cite = (x) => {
        const rel = (x && (x.source_relative_path || x.path)) || '';
        return {
          title: x.title, path: rel, source_relative_path: rel,
          snippet: x.snippet || x.text || '',
          score: x.score, page: x.page, type: x.docType || x.type || '',
          block_ids: x.block_ids || [],
          source_spans: x.source_spans || [],
          source_hash: x.source_hash || '',
          chunk_id: x.chunk_id || '',
          document_id: x.document_id || ''
        };
      };
      /* RAG_Snowz：短问答走 ask；写作、列文献和显式 mode=search 直接检索。ask 失败再退回检索。 */
      if (cfg.snowz && Bridge.ragAsk && !wantSearch) {
        let asked = null;
        try { asked = await Bridge.ragAsk(payload); } catch (err) {
          asked = { ok: false, error: String((err && err.message) || err) };
        }
        if (asked && asked.ok) {
          const citations = (asked.citations || []).map(cite);
          return withUniqueDocs({
            ok: true, query: q, channel: 'rag', engine, mode: 'ask',
            code: citations.length || asked.answer ? 'ok' : 'empty_corpus',
            answer: asked.answer || '',
            citations, count: citations.length,
            results: citations
          });
        }
        const searched = await Bridge.ragSearch(payload);
        if (searched && searched.ok) {
          const results = (searched.results || []).map(cite);
          return withUniqueDocs({
            ok: true, query: q, channel: 'rag', engine, mode: 'search',
            code: results.length ? 'ok' : 'empty_corpus',
            count: results.length, results,
            ask_error: (asked && asked.error) || ''
          });
        }
        return kbEngineDownResult(kbNameMatch(q), ((searched && searched.error) || (asked && asked.error) || '未知错误'), cfg.endpoint);
      }
      const r = await Bridge.ragSearch(payload);
      if (r && r.ok) {
        const results = (r.results || []).map(cite);
        return withUniqueDocs({
          ok: true, query: q, channel: 'rag', engine, mode: 'search',
          code: results.length ? 'ok' : 'empty_corpus',
          count: results.length, results
        });
      }
      /* 不可用时如实告知，并退回名称匹配，不编造结果 */
      return kbEngineDownResult(kbNameMatch(q), ((r && r.error) || '未知错误'), cfg.endpoint);
    }

    return Object.assign(kbNameMatch(q), {
      channel: 'name', engine: 'builtin', indexed: 0, code: 'name_only',
      warning: '内置知识库只按资料名称匹配，没有向量索引。'
    });
  },

  async list_software() {
    return {
      ok: true,
      apps: DB.apps.map(a => ({
        name: a.n,
        kind: a.kind === 'builtin' ? '内置视图' : a.kind === 'folder' ? '文件夹' : '程序',
        path: a.path || '(内置)',
        running: a.run === true,
        bound_project: a.bound ? (P(a.bound) || {}).name || null : null,
        bound_project_id: a.bound || null
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
      a.run = true;
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
        display_name: p.displayName || p.name,
        folder_name: p.folder || p.name,
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
      || DB.projects.find(x => x.name === q || x.displayName === q)
      || DB.projects.find(x => x.name.includes(q) || (x.displayName || '').includes(q) || q.includes(x.name));
    if (!p) return { ok: false, error: `未找到项目「${q}」。可用项目：${DB.projects.map(x => x.name).join('、')}` };
    state.project = p.id;
    DB.workspace.project = p.name;
    logActivity(`切换工作区到 <b>${esc(p.name)}</b>`, 'edit', '#6E56CF');
    persist();
    return { ok: true, current: p.id, name: p.name, display_name: p.displayName || p.name, message: `当前工作区已切换为「${p.displayName || p.name}」` };
  }
};

const AI_TOOL_IMPL = Object.fromEntries(Object.entries(AI_TOOL_IMPL_RAW).map(([name, fn]) => [name, async function (args) {
  if (isDryRun(args) && !TOOL_READ_ONLY.test(name)) return dryRunResult(name, args);
  return fn.call(this, args || {});
}]));

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
    case 'search_knowledge':   pick('query', '关键词'); pick('mode', '模式'); break;
    case 'launch_software':    pick('name'); break;
    case 'list_tasks':         pick('status', '状态'); break;
    case 'switch_project':     pick('project', '目标项目'); break;
    default: break;
  }
  return bits.length ? `${label}（${bits.join('，')}）` : label;
}


/* 知识库服务不可用：结果带 stop + user_message，循环据此直接停下；同时把健康状态记成 fail。 */
function kbEngineDownResult(base, err, endpoint) {
  const notice = engineDownNotice(endpoint);
  if (typeof state !== 'undefined' && state) {
    state.rag = Object.assign({}, state.rag || {}, {
      status: 'fail', indexed: 0, docs: 0, chunks: 0, error: String(err || '连接失败')
    });
  }
  return Object.assign(base || {}, {
    channel: 'name_fallback', code: 'engine_down',
    stop: true,
    user_message: notice,
    warning: 'RAG 服务不可用：' + String(err || '未知错误') + '。知识库服务未启动，必须停止，不要继续写作或保存，直接把 user_message 告诉用户。'
  });
}
