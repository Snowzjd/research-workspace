/* ==========================================================================
   本地 API 服务（主进程）
   目的：让外部正在运行的 AI Agent（Codex / WorkBuddy / Claude 等）连进来，
        读取现状并更新、管理本软件里的项目数据。

   设计要点
   - 仅监听 127.0.0.1，不对外暴露；token 鉴权（Bearer / X-RW-Token / query）
   - 数据唯一通道是渲染层：所有写操作都走 window.__RW_API__，
     因此外部 Agent 的改动会立即反映在界面上，不会出现两份状态
   - token 落盘到 userData/api-token.txt，重启后保持不变（Agent 配置无需反复改）
   ========================================================================== */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 7317;
const INVOKE_TIMEOUT = 30000;

let server = null;
let token = '';
let listenPort = 0;
let tokenFile = '';
let getWindow = () => null;
let onLog = () => {};

/* ---------- token：读写分 scope ----------
   full = 可读可写；read = 只读（projects/context/list_*）。
   老版本只有单个明文 token，读到就当作 full，并补齐 read token。 */
let tokens = { full: '', read: '' };

function newToken() { return crypto.randomBytes(24).toString('hex'); }

function saveTokens() {
  try {
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (_) {}
}

function loadOrCreateTokens(file) {
  tokenFile = file;
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8').trim();
      /* 新格式：JSON */
      if (raw.startsWith('{')) {
        const j = JSON.parse(raw);
        if (j.full && String(j.full).length >= 16) {
          tokens = { full: String(j.full), read: String(j.read || '') };
          if (!tokens.read) { tokens.read = newToken(); saveTokens(); }
          return tokens;
        }
      }
      /* 旧格式：单个明文 token → 视为 full */
      if (raw.length >= 16) {
        tokens = { full: raw, read: newToken() };
        saveTokens();
        return tokens;
      }
    }
  } catch (_) {}
  tokens = { full: newToken(), read: newToken() };
  saveTokens();
  return tokens;
}

function rotateToken(scope = 'both') {
  if (scope === 'read') tokens.read = newToken();
  else if (scope === 'full') tokens.full = newToken();
  else tokens = { full: newToken(), read: newToken() };
  saveTokens();
  token = tokens.full;
  return tokens;
}

/* 兼容：老代码里的 token 变量指向 full */
function syncLegacyToken() { token = tokens.full || ''; }

/* ---------- 审计：append-only JSONL ---------- */
let auditFile = '';
function audit(kind, payload) {
  try {
    if (!auditFile) return;
    const line = JSON.stringify(Object.assign({ at: new Date().toISOString(), kind }, payload || {})) + '\n';
    fs.appendFileSync(auditFile, line, 'utf8');
  } catch (_) {}
}

/* ---------- 工具调用：转发到渲染层 ---------- */
/* 调用方标识：审计日志靠它区分是哪个 Agent 干的活 */
function clientName(req) {
  const h = String((req && req.headers && req.headers['x-rw-client']) || '').trim();
  if (h) return h.slice(0, 60);
  const ua = String((req && req.headers && req.headers['user-agent']) || '');
  if (/curl/i.test(ua)) return 'curl';
  if (/python/i.test(ua)) return 'python-requests';
  if (/node|undici|axios/i.test(ua)) return 'node-client';
  return '外部 Agent';
}

async function invokeInRenderer(tool, args, client) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return { ok: false, error: '工作台窗口未就绪，请确认软件正在运行' };

  const payload = JSON.stringify({ tool, args: args || {}, client: client || '外部 Agent' });
  const call = win.webContents.executeJavaScript(
    `(window.__RW_API__ ? window.__RW_API__(${payload}) : Promise.resolve({ok:false,error:'渲染层 API 桥接未就绪'}))`,
    true
  );

  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ ok: false, error: `操作超时（${INVOKE_TIMEOUT / 1000}s）` }), INVOKE_TIMEOUT);
  });

  try {
    const r = await Promise.race([call, timeout]);
    return (r && typeof r === 'object') ? r : { ok: false, error: '渲染层返回了非对象结果' };
  } catch (err) {
    return { ok: false, error: '渲染层执行失败：' + String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- HTTP 工具函数 ---------- */
function sendNoContent(res) {
  res.writeHead(204, {
    ...(res.__rid ? { 'X-Request-Id': res.__rid } : {}),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-RW-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600'
  });
  res.end();
}

/* JSON 响应：统一去 BOM、固定 charset，避免客户端解析失败 */
function sendBare(res, code, obj) {
  const payload = (obj && typeof obj === 'object') ? Object.assign({ request_id: res.__rid || '' }, obj) : obj;
  let body = JSON.stringify(payload == null ? {} : payload);
  if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'X-Request-Id',
    ...(res.__rid ? { 'X-Request-Id': res.__rid } : {})
  });
  res.end(buf);
}

/* OpenAPI：直接从 /api/tools 的同一份 schema 生成，禁止另写一套 */
function buildOpenApi(tools) {
  const paths = {};
  for (const t of tools) {
    paths['/api/tools/' + t.name] = {
      post: {
        summary: t.description || t.name,
        tags: ['tools'],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: t.parameters || { type: 'object', properties: {} } } }
        },
        responses: {
          200: { description: '工具执行结果（ok=true 表示成功）' },
          400: { description: '参数错误或工具执行失败' },
          403: { description: '只读令牌不能执行写操作' }
        }
      }
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: '个人科研工作台 本地 Agent API',
      version: '3.0.0',
      description: '仅监听 127.0.0.1；请求需带 Authorization: Bearer <token>（完整权限）或只读令牌。'
    },
    servers: [{ url: `http://127.0.0.1:${listenPort}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' }
      }
    },
    security: [{ bearerAuth: [] }],
    paths: Object.assign(paths, {
      '/api/health': {
        get: {
          summary: '服务与数据概览（免鉴权）', tags: ['rest'],
          responses: { 200: { description: 'tools_count / projects_count / knowledge_indexed / knowledge_engine / last_error' } }
        }
      },
      '/api/projects': {
        get: { summary: '项目列表', tags: ['rest'], responses: { 200: { description: 'projects[]' } } }
      },
      '/api/context': {
        get: {
          summary: '当前（或指定）项目全量上下文', tags: ['rest'],
          parameters: [{ name: 'project', in: 'query', required: false, schema: { type: 'string' }, description: '项目名称或 ID' }],
          responses: { 200: { description: '项目信息 / 任务 / 待办 / 材料目录' } }
        }
      },
      '/api/audit': {
        get: {
          summary: '写操作审计（只读）', tags: ['rest'],
          parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } }],
          responses: { 200: { description: 'entries[]（含 dryRun 标记）' } }
        }
      },
      '/api/tools': {
        get: { summary: '工具清单（与 /api/openapi.json 同源）', tags: ['rest'], responses: { 200: { description: 'tools[]' } } }
      },
      '/api/tasks': {
        get: {
          summary: '任务列表（含稳定 task_id）', tags: ['rest'],
          parameters: [
            { name: 'project', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'status', in: 'query', required: false, schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'tasks[]，每条含 task_id' } }
        }
      },
      '/api/openapi.json': {
        get: { summary: 'OpenAPI 描述', tags: ['rest'], responses: { 200: { description: 'OpenAPI 3.0.3' } } }
      }
    })
  };
}

/* 读最近 N 条审计记录（从文件尾部倒序） */
function readAudit(limit = 50) {
  try {
    if (!auditFile || !fs.existsSync(auditFile)) return [];
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch (_) { return { raw: l }; } });
  } catch (_) {
    return [];
  }
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  const body = String(text);
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

/** Agent 接入手册：访问 /agent-setup 即可拿到完整接管说明 */
function buildSetupDoc(port, tok) {
  const base = `http://127.0.0.1:${port}`;
  return `# 科研工作台 · Agent 接入手册

你现在（作为 AI Agent）获得了一个本机科研项目管理软件的读写能力。
用户在软件内生成本链接并交给你，凭它即可接管并管理其科研项目。

## 一、接口信息
- 基地址：${base}
- 鉴权：除健康检查外，所有请求都必须带请求头
  \`Authorization: Bearer ${tok}\`
- 该服务只监听本机回环地址（127.0.0.1），外部网络无法访问

## 二、令牌说明（两种 scope）

| 字段 | 权限 | 用途 |
|------|------|------|
| \`full\` | 读写全部工具 | 需要建任务、改项目、启动软件时用 |
| \`read\` | 只读（\`get_*\` / \`list_*\` / \`search_*\`） | 只让 Agent 看数据；写操作返回 403 |

在「设置 → 外部 Agent 接入」里分别复制；请求头统一 \`Authorization: Bearer <token>\`。
带 \`dry_run: true\` 调用任何写工具都只返回预览，不落盘、不启动、不删除。

## 三、最小上手路径
1. 确认服务在线：\`GET ${base}/api/health\`（无需鉴权）
2. 看有哪些项目：\`GET ${base}/api/projects\`
3. 读取某个项目的完整现状（项目信息 / 任务 / 待办 / 材料目录）：
   \`GET ${base}/api/context?project=<项目ID>\`
4. 查看全部可用操作及其参数定义：\`GET ${base}/api/tools\`
5. 调用任意操作：\`POST ${base}/api/tools/<操作名>\`，请求体为 JSON 参数

## 四、常用调用示例
新建任务：
\`\`\`
POST ${base}/api/tools/create_task
{"title":"优化晶胞参数","agent":"Engineer","priority":"高","due":"10-30"}
\`\`\`

修改任务状态：
\`\`\`
POST ${base}/api/tools/update_task
{"task_title":"优化晶胞参数","status":"已完成"}
\`\`\`

新增待办：
\`\`\`
POST ${base}/api/tools/create_todo
{"content":"复核试验台标定数据","category":"任务","priority":"高","due":"明天 10:00"}
\`\`\`

更新项目进度与阶段：
\`\`\`
POST ${base}/api/tools/update_project
{"progress":80,"stage":"多目标优化"}
\`\`\`

在文件管理器中打开材料目录：
\`\`\`
POST ${base}/api/tools/open_project_folder
{"dir":"03_仿真"}
\`\`\`

## 五、任务状态与优先级的取值
- 状态（status）：待处理 / 进行中 / 待复核 / 已完成
- 优先级（priority）：高 / 中 / 低
- 单个工具的参数定义以 \`GET ${base}/api/tools\` 返回的 inputSchema 为准

## 六、工作方式约定
1. 动手前先调用 \`GET /api/context\` 或 \`GET /api/tools\` 了解现状，不要凭猜测
2. 需要改动就直接调用工具完成，不要只给建议
3. 完成后用一句话向用户说明改了什么，不要罗列原始 JSON
4. 删除类操作先与用户确认
5. 该令牌仅在用户本机有效，请勿写入任何会外传的文件或提交到代码仓库

## 七、投递方式说明
- 若你运行在用户本机，可直接用上述地址发起 HTTP 请求
- 若你运行在远端（云端 Agent），你的工具无法访问 127.0.0.1；
  此时请引导用户在本机执行，或改用支持 MCP 的本机客户端接管
`;
}

function send(res, code, obj) {
  const payload = (obj && typeof obj === 'object' && !Array.isArray(obj))
    ? Object.assign({ request_id: res.__rid || '' }, obj) : obj;
  let body = JSON.stringify(payload, null, 2);
  if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-RW-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    let tooBig = false;
    req.on('data', c => {
      raw += c;
      if (raw.length > 2 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return resolve({ __error: '请求体过大（上限 2MB）' });
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' ? v : {});
      } catch (e) { resolve({ __error: '请求体不是合法 JSON' }); }
    });
    req.on('error', () => resolve({ __error: '读取请求体失败' }));
  });
}

/* 返回 'write' | 'read' | null（未授权）。full token=write，read token=read */
function authScope(req, url) {
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const fromHeader = req.headers['x-rw-token'] || '';
  const fromQuery = url.searchParams.get('token') || '';
  const got = bearer || fromHeader || fromQuery;
  if (!got) return null;
  const eq = (t) => {
    if (!t || got.length !== t.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(t)); } catch (_) { return false; }
  };
  if (eq(tokens.full)) return 'write';
  if (eq(tokens.read)) return 'read';
  /* 兼容旧变量（start 时同步过一次） */
  if (token && eq(token)) return 'write';
  return null;
}

/* 只读 scope 能用的工具前缀 */
function readAllowed(tool) {
  /* switch_project 会改当前工作区，只读令牌不能调用 */
  return /^(get_|list_|search_)/.test(String(tool || ''));
}

/* ---------- 路由 ---------- */
async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${listenPort}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';

  /* E1：每个请求（含 /api/health、401、OPTIONS）都要有非空 request_id */
  res.__rid = crypto.randomBytes(5).toString('hex');

  if (req.method === 'OPTIONS') return sendNoContent(res);

  /* 健康检查无需鉴权：方便 Agent 探测服务是否在线 */
  if (p === '/api/health') {
    const win2 = getWindow();
    const ready = !!(win2 && !win2.isDestroyed());
    let diag = {};
    if (ready) {
      try { diag = await invokeInRenderer('__diag__', {}); } catch (_) { diag = {}; }
    }
    return sendBare(res, 200, {
      ok: true,
      app: '个人 AI 科研工程工作台',
      version: diag.version || '3.0.0',
      port: listenPort,
      windowReady: ready,
      tools_count: diag.tools_count || 0,
      projects_count: diag.projects_count || 0,
      tasks_count: diag.tasks_count || 0,
      knowledge_indexed: diag.knowledge_indexed || 0,
      knowledge_engine: diag.knowledge_engine || 'builtin',
      last_error: diag.last_error || '',
      time: new Date().toISOString()
    });
  }

  const scope = authScope(req, url);
  if (!scope) {
    return send(res, 401, { ok: false, error: '未授权：请在请求头带上 Authorization: Bearer <token>，token 可在「设置 → 外部 Agent 接入」查看' });
  }

  const win = getWindow();
  if (!win || win.isDestroyed()) {
    return send(res, 503, { ok: false, error: '工作台窗口未就绪' });
  }

  try {
    /* Agent 接入手册：用户把链接发给 Agent，Agent 自己读这份说明即可接管 */
    if (p === '/agent-setup' && req.method === 'GET') {
      return sendText(res, 200, buildSetupDoc(listenPort, token), 'text/markdown; charset=utf-8');
    }

    /* 工具清单（MCP Server 与调试都用它） */
    if (p === '/api/tools' && req.method === 'GET') {
      const r = await invokeInRenderer('__list_tools__', {});
      return send(res, r.ok === false ? 500 : 200, r);
    }

    /* OpenAPI 描述：与 /api/tools 同源生成，避免 schema 与实现漂移 */
    if (p === '/api/openapi.json' && req.method === 'GET') {
      const list = await invokeInRenderer('__list_tools__', {});
      const tools = (list && list.tools) || [];
      return send(res, 200, buildOpenApi(tools));
    }

    /* 审计日志（只读）：GET /api/audit?limit=50 */
    if (p === '/api/audit' && req.method === 'GET') {
      const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
      return send(res, 200, { ok: true, entries: readAudit(limit) });
    }

    /* 便捷：当前项目全量上下文 */
    if (p === '/api/context' && req.method === 'GET') {
      const args = {};
      const proj = url.searchParams.get('project');
      if (proj) args.project = proj;
      const r = await invokeInRenderer('get_project_context', args, clientName(req));
      return send(res, r.ok === false ? 400 : 200, r);
    }

    /* 便捷：项目列表 */
    if (p === '/api/projects' && req.method === 'GET') {
      const r = await invokeInRenderer('list_projects', {});
      return send(res, r.ok === false ? 500 : 200, r);
    }

    /* 任务列表：稳定 task_id，和工具 list_tasks 同一份数据 */
    if (p === '/api/tasks' && req.method === 'GET') {
      const args = {};
      const proj = url.searchParams.get('project');
      const status = url.searchParams.get('status');
      if (proj) args.project = proj;
      if (status) args.status = status;
      const r = await invokeInRenderer('list_tasks', args, clientName(req));
      return send(res, r.ok === false ? 400 : 200, r);
    }

    /* 通用工具调用入口：POST /api/tools/<toolName>  body = args */
    const m = p.match(/^\/api\/tools\/([A-Za-z0-9_]+)$/);
    if (m) {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: '请使用 POST' });
      const body = await readBody(req);
      if (body.__error) return send(res, 400, { ok: false, error: body.__error });
      const who = clientName(req);
      /* 只读令牌不能调用写操作 */
      if (scope === 'read' && !readAllowed(m[1])) {
        audit('denied', { tool: m[1], client: who, scope });
        return send(res, 403, { ok: false, error: `只读令牌不能执行「${m[1]}」。请在设置里改用可写令牌（完整权限）。`, scope });
      }
      onLog(`调用工具 ${m[1]} · 来自 ${who}`);
      const r = await invokeInRenderer(m[1], body, who);
      audit('tool', {
        tool: m[1], client: who, scope,
        access: readAllowed(m[1]) ? 'read' : 'write',
        ok: r && r.ok !== false,
        dryRun: !!(r && r.dryRun)
      });
      return send(res, r.ok === false ? 400 : 200, r);
    }

    /* 根路径给出用法提示 */
    if (p === '/') {
      return send(res, 200, {
        ok: true,
        service: '科研工作台本地 API',
        endpoints: {
          'GET  /agent-setup': 'Agent 接入手册（把带 token 的链接发给 Agent 即可）',
          'GET  /api/health': '服务与窗口状态（无需鉴权）',
          'GET  /api/tools': '可用工具清单',
          'GET  /api/projects': '项目列表',
          'GET  /api/tasks?project=<id>': '任务列表（含稳定 task_id）',
          'GET  /api/context?project=<id>': '项目全量上下文（任务/待办/材料目录）',
          'GET  /api/openapi.json': 'OpenAPI 描述',
          'POST /api/tools/<name>': '调用工具，body 为参数对象；写工具可带 dry_run:true 只预览'
        },
        auth: 'Authorization: Bearer <token>'
      });
    }

    return send(res, 404, { ok: false, error: `未知路径：${p}` });
  } catch (err) {
    onLog('API 异常: ' + String((err && err.message) || err));
    return send(res, 500, { ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- 启动 / 停止 ---------- */
function start({ win, userDataDir, port = DEFAULT_PORT, log } = {}) {
  if (win) getWindow = () => win;
  if (log) onLog = log;
  if (!tokens.full) {
    loadOrCreateTokens(path.join(userDataDir, 'api-token.txt'));
    syncLegacyToken();
  }
  auditFile = path.join(userDataDir, 'api-audit.log');

  return new Promise(resolve => {
    const tryListen = (tryPort, attempt = 0) => {
      server = http.createServer(handle);
      server.on('error', err => {
        if (err.code === 'EADDRINUSE' && attempt < 12) {
          tryListen(tryPort + 1, attempt + 1);
        } else {
          onLog('API 服务启动失败: ' + err.message);
          resolve({ ok: false, error: err.message });
        }
      });
      server.listen(tryPort, '127.0.0.1', () => {
        listenPort = tryPort;
        onLog(`API 服务已启动: http://127.0.0.1:${listenPort}`);
        resolve({ ok: true, port: listenPort, token, tokens });
      });
    };
    tryListen(port);
  });
}

function stop() {
  if (server) { try { server.close(); } catch (_) {} server = null; }
}

function setWindow(win) { getWindow = () => win; }

const info = () => ({
  running: !!server && !!server.listening,
  port: listenPort,
  baseUrl: listenPort ? `http://127.0.0.1:${listenPort}` : '',
  token,
  tokenRead: tokens.read || '',
  tokenFull: tokens.full || ''
});

module.exports = { start, stop, setWindow, info, rotateToken, readAudit, readAllowed, DEFAULT_PORT };
