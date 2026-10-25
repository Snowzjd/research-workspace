/* ==========================================================================
   一键连接：自动检测本机的 MCP 客户端并写入配置
   - 支持 JSON（mcpServers 键）与 TOML（[mcp_servers.x] 段）两种格式
   - 写入前自动备份；幂等（重复连接只更新本条目）
   - 只读写目标配置文件，不动同目录其他内容
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_KEY = 'research-workspace';

/* ---------- 各客户端的配置文件位置与格式 ---------- */
const TARGETS = [
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    kind: 'json',
    files: ['~/.workbuddy/mcp.json'],
    probe: ['~/.workbuddy'],
    note: '写入后到「连接器管理 → 自定义连接器」点 Trust 即可启用，无需重启'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    kind: 'toml',
    files: ['~/.codex/config.toml'],
    probe: ['~/.codex/config.toml'],
    note: '写入 ~/.codex/config.toml 的 [mcp_servers] 段，Codex 重启后生效'
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'json',
    files: ['~/.claude.json'],
    probe: ['~/.claude.json'],
    note: '写入 ~/.claude.json 的 mcpServers，Claude Code 重启后生效'
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    kind: 'json',
    files: ['%APPDATA%/Claude/claude_desktop_config.json'],
    probe: ['%APPDATA%/Claude'],
    note: '写入后需完全退出并重新打开 Claude Desktop'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'json',
    files: ['~/.cursor/mcp.json'],
    probe: ['~/.cursor'],
    note: '写入后在 Cursor 的 MCP 面板启用'
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'json',
    files: ['~/.codeium/windsurf/mcp_config.json'],
    probe: ['~/.codeium/windsurf'],
    note: '写入后在 Windsurf 的 MCP 面板刷新'
  },
  {
    id: 'trae',
    name: 'Trae',
    kind: 'json',
    files: ['~/.trae/mcp.json'],
    probe: ['~/.trae'],
    note: '写入后重启 Trae'
  }
];

/* ---------- 路径展开 ---------- */
function expand(p) {
  let s = String(p || '');
  s = s.replace(/^~(?=$|[\\/])/, os.homedir());
  s = s.replace(/%([^%]+)%/g, (_, k) => process.env[k] || process.env[k.toUpperCase()] || '');
  return s;
}

/* ---------- 读取现状 ---------- */
function jsonEntryOf(file, key) {
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return null;
  const obj = JSON.parse(raw);
  return (obj && obj.mcpServers && obj.mcpServers[key]) || null;
}

function tomlSectionRange(lines, section) {
  const head = new RegExp('^\\s*\\[' + section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s*(#.*)?$');
  const anyHead = /^\s*\[/;
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (start < 0) {
      if (head.test(lines[i])) start = i;
    } else if (anyHead.test(lines[i])) { end = i; break; }
  }
  return start < 0 ? null : { start, end };
}

function tomlHasSection(raw) {
  const lines = raw.split(/\r?\n/);
  return !!tomlSectionRange(lines, `mcp_servers.${SERVER_KEY}`);
}

/** 删除所有以 mcp_servers.<key> 开头的段（含其 .env 子段），返回剩余行 */
function tomlStrip(lines) {
  const out = [];
  let skipping = false;
  const anyHead = /^\s*\[/;
  const mineHead = new RegExp('^\\s*\\[mcp_servers\\.' + SERVER_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.[^\\]]*)?\\]');
  for (const line of lines) {
    if (anyHead.test(line)) skipping = mineHead.test(line);
    if (!skipping) out.push(line);
  }
  return out;
}

const tomlStr = s => {
  const v = String(s);
  return v.includes("'") ? '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : "'" + v + "'";
};

function renderTomlSection(entry) {
  const lines = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${tomlStr(entry.command)}`,
    `args = [${entry.args.map(tomlStr).join(', ')}]`,
    '',
    `[mcp_servers.${SERVER_KEY}.env]`
  ];
  for (const [k, v] of Object.entries(entry.env || {})) lines.push(`${k} = ${tomlStr(v)}`);
  return lines;
}

/* ---------- 检测 ---------- */
function scan(entry) {
  return TARGETS.map(t => {
    const cfgPath = expand(t.files[0]);
    const detected = (t.probe || []).some(p => fs.existsSync(expand(p)));
    const configExists = fs.existsSync(cfgPath);
    let configured = false;
    let error = null;
    if (configExists) {
      try {
        configured = t.kind === 'toml'
          ? tomlHasSection(fs.readFileSync(cfgPath, 'utf8'))
          : !!jsonEntryOf(cfgPath, SERVER_KEY);
      } catch (err) {
        error = '配置读取失败：' + String((err && err.message) || err);
      }
    }
    return {
      id: t.id, name: t.name, kind: t.kind, note: t.note,
      detected, configExists, configPath: cfgPath,
      configured, error,
      installed: detected || configExists
    };
  });
}

/* ---------- 写入 ---------- */
function applyTo(id, entry) {
  const t = TARGETS.find(x => x.id === id);
  if (!t) return { ok: false, error: `未知客户端：${id}` };
  if (!entry || !entry.command || !Array.isArray(entry.args)) {
    return { ok: false, error: '接入参数不完整' };
  }

  const cfgPath = expand(t.files[0]);
  let backup = null;
  try {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

    if (fs.existsSync(cfgPath)) {
      backup = `${cfgPath}.rw-backup-${Date.now()}`;
      fs.copyFileSync(cfgPath, backup);
    }

    if (t.kind === 'toml') {
      const raw = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
      if (raw.trim() && !/^\s*\[/m.test(raw)) {
        return { ok: false, error: '目标文件不是预期的 TOML 配置格式，已中止以免破坏原文件' };
      }
      const kept = tomlStrip(raw.split(/\r?\n/));
      // 去掉尾部多余空行后追加新段
      while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
      const next = kept.concat([''], renderTomlSection(entry), ['']).join('\n');
      fs.writeFileSync(cfgPath, next, 'utf8');
    } else {
      let obj = {};
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        if (raw.trim()) obj = JSON.parse(raw);          // 解析失败会抛错，走 catch，不覆盖
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { ok: false, error: '目标文件顶层不是 JSON 对象，已中止以免破坏原文件' };
      }
      obj.mcpServers = (obj.mcpServers && typeof obj.mcpServers === 'object') ? obj.mcpServers : {};
      obj.mcpServers[SERVER_KEY] = entry;
      fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    }

    return { ok: true, path: cfgPath, backup, kind: t.kind, note: t.note };
  } catch (err) {
    return {
      ok: false,
      error: '写入失败：' + String((err && err.message) || err),
      backup,
      path: cfgPath
    };
  }
}

/* ---------- 移除 ---------- */
function removeFrom(id) {
  const t = TARGETS.find(x => x.id === id);
  if (!t) return { ok: false, error: `未知客户端：${id}` };
  const cfgPath = expand(t.files[0]);
  if (!fs.existsSync(cfgPath)) return { ok: false, error: '配置文件不存在' };

  let backup = null;
  try {
    backup = `${cfgPath}.rw-backup-${Date.now()}`;
    fs.copyFileSync(cfgPath, backup);

    if (t.kind === 'toml') {
      const kept = tomlStrip(fs.readFileSync(cfgPath, 'utf8').split(/\r?\n/));
      while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
      fs.writeFileSync(cfgPath, kept.join('\n') + '\n', 'utf8');
    } else {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const obj = raw.trim() ? JSON.parse(raw) : {};
      if (obj.mcpServers) delete obj.mcpServers[SERVER_KEY];
      fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    }
    return { ok: true, path: cfgPath, backup };
  } catch (err) {
    return { ok: false, error: '移除失败：' + String((err && err.message) || err), backup };
  }
}

module.exports = { TARGETS, SERVER_KEY, expand, scan, applyTo, removeFrom };
