#!/usr/bin/env node
/* ==========================================================================
   科研工作台 · MCP Server
   把本软件的能力以 Model Context Protocol 暴露给外部 Agent：
   Codex、WorkBuddy、Claude Desktop、Cursor 等只要支持 MCP 即可挂载。

   运行方式（由 MCP 客户端拉起，无需用户手动执行）：
     command: <ResearchWorkspace.exe 的绝对路径>
     args:    [<该文件绝对路径>]
     env:     ELECTRON_RUN_AS_NODE=1, RW_API_PORT=<端口>, RW_API_TOKEN=<令牌>

   说明：
   - 本进程是纯 Node 脚本，通过本地 HTTP API 转发到正在运行的软件本体
   - stdout 只用于 MCP 协议（换行分隔的 JSON-RPC 2.0），日志一律走 stderr
   - 软件未运行时仍能返回工具清单（内置回退），调用时会给出明确提示
   ========================================================================== */
import process from 'node:process';

const PORT = process.env.RW_API_PORT || '7317';
const TOKEN = process.env.RW_API_TOKEN || '';
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_INFO = { name: 'research-workspace', version: '1.0.0' };

const logErr = (...a) => process.stderr.write('[rw-mcp] ' + a.join(' ') + '\n');

/* ---------- 与软件本体的通信 ---------- */
/* 让审计日志能认出是谁在调用：优先用启动方给的名字 */
const CLIENT = String(process.env.RW_CLIENT_NAME || 'MCP Client').slice(0, 60);
const CLIENT_HEADER = { 'X-RW-Client': CLIENT };

async function apiGet(path) {
  const res = await fetch(BASE + path, {
    headers: { ...CLIENT_HEADER, ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    signal: AbortSignal.timeout(15000)
  });
  return res.json();
}

async function apiCall(name, args) {
  const res = await fetch(`${BASE}/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...CLIENT_HEADER,
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {})
    },
    body: JSON.stringify(args || {}),
    signal: AbortSignal.timeout(30000)
  });
  return res.json();
}

/* ---------- 内置回退工具清单（软件未运行时也能让 Agent 看到能力范围） ---------- */
const fallback = (name, description) => ({ name, description, inputSchema: { type: 'object', properties: {}, additionalProperties: true } });
const FALLBACK_TOOLS = [
  fallback('get_project_context', '获取当前项目全量上下文：项目信息、任务、待办、材料目录。'),
  fallback('list_projects', '列出全部科研项目及其进度、阶段与负责 Agent。'),
  fallback('switch_project', '切换当前工作区，之后的操作默认作用于该项目。参数：project（项目名或 ID）。'),
  fallback('list_tasks', '列出当前项目的任务，可按状态筛选。参数：status。'),
  fallback('create_task', '在当前项目新建任务。参数：title、agent、tool、due、priority、status、material_dir。'),
  fallback('update_task', '修改任务。参数：task_title 加要改的字段。'),
  fallback('delete_task', '删除任务。参数：task_title。'),
  fallback('create_todo', '新增待办。参数：content、category、priority、due。'),
  fallback('update_todo', '修改待办（含标记完成）。参数：todo_content 加要改的字段。'),
  fallback('update_project', '更新项目进度、阶段、研究目标。参数：progress、stage、next_stage、goal、subtitle。'),
  fallback('list_materials', '列出项目材料目录与文件。参数：dir（可选）。'),
  fallback('open_project_folder', '在文件管理器中打开项目材料目录。参数：dir（可选）。'),
  fallback('search_knowledge', '在科研知识库中检索资料。参数：query。'),
  fallback('list_software', '列出软件启动台中的程序及其运行状态。'),
  fallback('launch_software', '启动一个工程软件。参数：name。')
];

/* 软件在线时用它的权威定义，离线时退回内置列表 */
async function loadTools() {
  try {
    const r = await apiGet('/api/tools');
    if (r && r.ok && Array.isArray(r.tools) && r.tools.length) {
      return r.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters && Object.keys(t.parameters).length ? t.parameters : { type: 'object', properties: {}, additionalProperties: true }
      }));
    }
    logErr('工作台返回的工具清单为空，使用内置列表');
  } catch (err) {
    logErr('无法连接工作台（' + String((err && err.message) || err) + '），使用内置工具列表');
  }
  return FALLBACK_TOOLS;
}

/* ---------- MCP 协议 ---------- */
function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const replyErr = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO
      });

    case 'notifications/initialized':
    case 'initialized':
      return;                                  // 通知类消息不需要响应

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: await loadTools() });

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name) return replyErr(id, -32602, 'tools/call 缺少 name');
      let result;
      try {
        result = await apiCall(name, args);
      } catch (err) {
        result = {
          ok: false,
          error: `无法连接科研工作台（${BASE}）：${String((err && err.message) || err)}\n请先启动「科研工作台」软件，再重试。`
        };
      }
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return reply(id, {
        content: [{ type: 'text', text }],
        isError: !!(result && result.ok === false)
      });
    }

    case 'resources/list':
      return reply(id, { resources: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });

    default:
      if (isNotification) return;
      return replyErr(id, -32601, '未实现的方法：' + method);
  }
}

/* ---------- stdio 主循环（换行分隔的 JSON-RPC） ---------- */
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (_) { logErr('收到无法解析的消息，已忽略'); continue; }
    handle(msg).catch(err => {
      const id = msg && msg.id;
      if (id !== undefined && id !== null) replyErr(id, -32603, String((err && err.message) || err));
      else logErr('处理消息失败：' + String((err && err.message) || err));
    });
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', err => { logErr('未捕获异常：' + String((err && err.stack) || err)); });

logErr(`已启动 · 目标 ${BASE} · token ${TOKEN ? '已配置' : '缺失'}`);
