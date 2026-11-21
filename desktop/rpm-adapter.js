/* ==========================================================================
   RPM 2.0 只读适配层（仅主进程）
   --------------------------------------------------------------------------
   通过参数数组短进程调用已部署的 rpm.py，不复制 Skill，不新增长期服务。
   第一批只允许 list / search / context / audit / vault-audit。
   ========================================================================== */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ALLOWED_COMMANDS = Object.freeze(['list', 'search', 'context', 'audit', 'vault-audit']);
const BLOCKED_COMMANDS = Object.freeze([
  'organize', 'update', 'init', 'sync', 'scan', 'migrate-vault',
  'vault-init', 'archive'
]);

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_STDOUT = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR = 1 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 8000;

/* 2026-11-19 05:21 Asia/Shanghai 对本机 Skill 目录（不含 local.json）计算。
   Skill 仍可能被并行覆盖；哈希不一致时只告警，不阻断只读查询。 */
const EXPECTED_SKILL_HASH = '309441fa410b2c6a33fca72f68a19333fe8ce8fa51d6faaa88222c263eba9a34';

const DEFAULT_SCRIPT_CANDIDATES = [...new Set([process.env.CODEX_HOME, path.join(os.homedir(), '.codex')])]
  .filter(home => home && path.isAbsolute(home))
  .map(home => path.join(home, 'skills', 'research-project-manager', 'scripts', 'rpm.py'));

const cache = new Map();
let spawnObserver = null;
let lastSpawn = null;

function setSpawnObserver(fn) {
  spawnObserver = typeof fn === 'function' ? fn : null;
}

function clearCache() {
  cache.clear();
}

function knowledgeScriptPath() {
  return path.resolve(__dirname, '..', 'rpm-integration', 'rpm_knowledge_api.py');
}

function sameScriptPath(left, right) {
  try {
    const a = path.resolve(String(left || ''));
    const b = path.resolve(String(right || ''));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch (_) {
    return false;
  }
}

/* 只允许官方 rpm.py（scripts/rpm.py）以及交付包中的只读知识接口脚本。禁止任意 scriptPath。 */
function isTrustedRpmCli(scriptPath) {
  if (!scriptPath) return false;
  const resolved = path.resolve(String(scriptPath));
  if (path.basename(resolved) !== 'rpm.py') return false;
  if (path.basename(path.dirname(resolved)) !== 'scripts') return false;
  return fs.existsSync(resolved);
}

function isAllowedScript(scriptPath) {
  if (!scriptPath) return false;
  if (sameScriptPath(scriptPath, knowledgeScriptPath())) return true;
  return isTrustedRpmCli(scriptPath);
}

function commandAllowed(command) {
  return ALLOWED_COMMANDS.includes(String(command || ''));
}

function rejectCommand(command) {
  const name = String(command || '');
  return {
    ok: false,
    code: 'command_not_allowed',
    error: `不允许执行 RPM 命令「${name}」。第一批只读适配器仅允许：${ALLOWED_COMMANDS.join('、')}。`,
    command: name,
    spawned: false
  };
}

function skillFingerprint(scriptPath) {
  const resolved = scriptPath ? path.resolve(String(scriptPath)) : '';
  if (!resolved || !fs.existsSync(resolved)) {
    return { hash: '', fileCount: 0, skillRoot: '', error: '脚本路径不存在' };
  }
  const skillRoot = path.dirname(path.dirname(resolved));
  const rels = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '__pycache__' || ent.name === '.git' || ent.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const rel = path.relative(skillRoot, full).split(path.sep).join('/');
      if (rel === 'local.json' || rel.endsWith('/local.json')) continue;
      rels.push(rel);
    }
  };
  walk(skillRoot);
  rels.sort();
  const hash = crypto.createHash('sha256');
  for (const rel of rels) {
    const full = path.join(skillRoot, rel.split('/').join(path.sep));
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    hash.update(rel);
    hash.update('\0');
    hash.update(fileHash);
    hash.update('\0');
  }
  return { hash: hash.digest('hex'), fileCount: rels.length, skillRoot };
}

function firstExisting(candidates) {
  for (const item of candidates) {
    if (item && fs.existsSync(item)) return item;
  }
  return '';
}

function resolvePython(config) {
  const cfg = config || {};
  if (cfg.pythonPath) return cfg.pythonPath;
  if (process.env.RPM_PYTHON && fs.existsSync(process.env.RPM_PYTHON)) return process.env.RPM_PYTHON;
  const names = process.platform === 'win32' ? ['python.exe'] : ['python3', 'python'];
  const directories = (process.env.PATH || '').split(path.delimiter).map(item => item.replace(/^"|"$/g, ''))
    .filter(item => path.isAbsolute(item));
  return firstExisting(directories.flatMap(directory => names.map(name => path.join(directory, name)))) || 'python';
}

function resolveScript(config) {
  const cfg = config || {};
  if (cfg.scriptPath) return cfg.scriptPath;
  if (process.env.RPM_SCRIPT && fs.existsSync(process.env.RPM_SCRIPT)) return process.env.RPM_SCRIPT;
  return firstExisting(DEFAULT_SCRIPT_CANDIDATES);
}

function resolveSettings(config) {
  const cfg = config || {};
  if (cfg.settingsPath) return cfg.settingsPath;
  if (process.env.RPM_SETTINGS) return process.env.RPM_SETTINGS;
  const script = resolveScript(cfg);
  if (!script) return '';
  const local = path.join(path.dirname(path.dirname(script)), 'local.json');
  return fs.existsSync(local) ? local : '';
}

function configFrom(deviceCfg, workspaceData) {
  const dev = deviceCfg && typeof deviceCfg === 'object' ? deviceCfg : {};
  const settings = workspaceData && workspaceData.settings && typeof workspaceData.settings === 'object'
    ? workspaceData.settings
    : {};
  const rpm = settings.rpm && typeof settings.rpm === 'object' ? settings.rpm : {};
  return {
    pythonPath: dev.pythonPath || dev.rpmPythonPath || rpm.pythonPath || '',
    scriptPath: dev.rpmScriptPath || rpm.scriptPath || '',
    settingsPath: dev.rpmSettingsPath || rpm.settingsPath || '',
    timeoutMs: Number(dev.rpmTimeoutMs || rpm.timeoutMs || 0) || 0
  };
}

function readVaultPath(settingsPath) {
  if (!settingsPath || !fs.existsSync(settingsPath)) return '';
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return raw && raw.vault ? String(raw.vault) : '';
  } catch (_) {
    return '';
  }
}

function describeStatus(config) {
  const pythonPath = resolvePython(config);
  let scriptPath = resolveScript(config);
  const settingsPath = resolveSettings(config);
  const pythonExists = !!(pythonPath && fs.existsSync(pythonPath));
  const scriptExists = !!(scriptPath && fs.existsSync(scriptPath));
  const fp = scriptExists ? skillFingerprint(scriptPath) : { hash: '', fileCount: 0, skillRoot: '', error: '脚本不存在' };
  const match = !!(fp.hash && fp.hash === EXPECTED_SKILL_HASH);
  const timeoutMs = (config && Number(config.timeoutMs)) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;
  return {
    ok: true,
    available: pythonExists && scriptExists,
    pythonPath,
    pythonExists,
    scriptPath,
    scriptExists,
    settingsPath,
    vaultPath: readVaultPath(settingsPath),
    skillRoot: fp.skillRoot || '',
    skillHash: fp.hash || '',
    expectedSkillHash: EXPECTED_SKILL_HASH,
    skillHashMatch: match,
    skillFileCount: fp.fileCount || 0,
    skillHashWarning: fp.hash && !match
      ? '当前 Skill 哈希与实施时记录不一致，Skill 可能已被更新。只读查询仍可尝试，但结果需重新核对。'
      : '',
    skillHashError: fp.error || '',
    timeoutMs
  };
}

function cacheKey(command, argv, config) {
  return JSON.stringify({
    command,
    argv,
    pythonPath: resolvePython(config),
    scriptPath: resolveScript(config),
    settingsPath: resolveSettings(config)
  });
}

function parseCliPayload(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { ok: false, error: 'RPM CLI 没有输出' };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return { ok: true, data: JSON.parse(raw.slice(start, end + 1)) }; } catch (_) {}
    }
    return { ok: false, error: 'RPM CLI 输出不是合法 JSON：' + String((err && err.message) || err) };
  }
}

function mapCliError(stderr, stdout, code, signal) {
  const chunks = [stderr, stdout].filter(Boolean);
  for (const text of chunks) {
    const parsed = parseCliPayload(text);
    if (parsed.ok && parsed.data && typeof parsed.data === 'object') {
      if (parsed.data.error) {
        return { ok: false, error: String(parsed.data.error), details: parsed.data, exitCode: code, signal: signal || '' };
      }
    }
  }
  const excerpt = String(stderr || stdout || '').trim().slice(0, 800);
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    return { ok: false, code: 'timeout', error: 'RPM CLI 调用超时或被终止', exitCode: code, signal };
  }
  return {
    ok: false,
    code: 'cli_failed',
    error: excerpt ? ('RPM CLI 失败：' + excerpt) : ('RPM CLI 退出码 ' + code),
    exitCode: code,
    signal: signal || ''
  };
}

function runCommand(command, argv, config) {
  const name = String(command || '');
  if (!commandAllowed(name)) {
    lastSpawn = { command: name, spawned: false, argv: [] };
    if (spawnObserver) spawnObserver(lastSpawn);
    return Promise.resolve(rejectCommand(name));
  }
  const args = Array.isArray(argv) ? argv.map((item) => String(item)) : [];
  return spawnRpm(name, args, config || {});
}

function spawnRpm(command, argv, config) {
  const pythonPath = resolvePython(config);
  let scriptPath = resolveScript(config);
  const settingsPath = resolveSettings(config);
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const maxStdout = Number(config.maxStdout) > 0 ? Number(config.maxStdout) : DEFAULT_MAX_STDOUT;
  const maxStderr = Number(config.maxStderr) > 0 ? Number(config.maxStderr) : DEFAULT_MAX_STDERR;
  const useCache = config.cache !== false;
  const key = cacheKey(command, argv, config);

  if (useCache && cache.has(key)) {
    const hit = cache.get(key);
    if (hit && hit.expireAt > Date.now()) {
      return Promise.resolve(Object.assign({}, hit.value, { cached: true, spawned: false }));
    }
    cache.delete(key);
  }

  if (!pythonPath) {
    return Promise.resolve({ ok: false, code: 'python_missing', error: '未配置 Python 解释器', spawned: false });
  }
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return Promise.resolve({ ok: false, code: 'script_missing', error: '未找到 RPM CLI 脚本', spawned: false, scriptPath });
  }
  scriptPath = path.resolve(scriptPath);
  if (!isAllowedScript(scriptPath)) {
    lastSpawn = { command, spawned: false, argv: [], scriptPath, shell: false };
    if (spawnObserver) spawnObserver(lastSpawn);
    return Promise.resolve({
      ok: false,
      code: 'script_not_allowed',
      error: '不允许执行未授权的脚本',
      spawned: false,
      scriptPath
    });
  }

  const cliArgs = ['-X', 'utf8', '-B', scriptPath];
  if (settingsPath) cliArgs.push('--settings', settingsPath);
  cliArgs.push(command, ...argv);

  const spawnInfo = {
    command,
    spawned: true,
    shell: false,
    pythonPath,
    scriptPath,
    settingsPath,
    argv: cliArgs.slice()
  };
  lastSpawn = spawnInfo;
  if (spawnObserver) spawnObserver(spawnInfo);

  return new Promise((resolve) => {
    let settled = false;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let oversized = '';
    const cwd = path.dirname(scriptPath);
    let child;
    try {
      child = spawn(pythonPath, cliArgs, {
        cwd,
        windowsHide: true,
        shell: false,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({ ok: false, code: 'spawn_failed', error: '无法启动 RPM CLI：' + String((err && err.message) || err), spawned: true });
      return;
    }

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.removeAllListeners(); } catch (_) {}
      resolve(value);
    };

    const timer = setTimeout(() => {
      oversized = oversized || 'timeout';
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 1000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > maxStdout) {
        oversized = 'stdout';
        try { child.kill('SIGTERM'); } catch (_) {}
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > maxStderr) {
        oversized = 'stderr';
        try { child.kill('SIGTERM'); } catch (_) {}
      }
    });
    child.on('error', (err) => {
      finish({ ok: false, code: 'spawn_failed', error: '无法启动 RPM CLI：' + String((err && err.message) || err), spawned: true });
    });
    child.on('close', (code, signal) => {
      const outText = stdout.toString('utf8');
      const errText = stderr.toString('utf8');
      if (oversized && oversized !== 'timeout') {
        finish({
          ok: false,
          code: 'output_too_large',
          error: `RPM CLI ${oversized} 超过大小限制`,
          spawned: true
        });
        return;
      }
      if (oversized === 'timeout' || ((signal === 'SIGTERM' || signal === 'SIGKILL') && code !== 0 && !outText.trim())) {
        finish({
          ok: false,
          code: 'timeout',
          error: `RPM CLI 超过 ${timeoutMs}ms 仍未返回，已终止`,
          spawned: true,
          exitCode: code,
          signal: signal || ''
        });
        return;
      }
      if (code !== 0) {
        finish(Object.assign({ spawned: true }, mapCliError(errText, outText, code, signal)));
        return;
      }
      const parsed = parseCliPayload(outText);
      if (!parsed.ok) {
        finish(Object.assign({ spawned: true, stderr: errText.slice(0, 400) }, parsed));
        return;
      }
      if (parsed.data && typeof parsed.data === 'object' && parsed.data.error && Object.keys(parsed.data).length === 1) {
        finish({ ok: false, error: String(parsed.data.error), spawned: true });
        return;
      }
      const value = { ok: true, data: parsed.data, spawned: true, cached: false };
      if (useCache) {
        cache.set(key, { expireAt: Date.now() + DEFAULT_CACHE_TTL_MS, value });
      }
      finish(value);
    });
  });
}

function listProjects(config) {
  return runCommand('list', [], config).then((r) => {
    if (!r.ok) return r;
    const data = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
    const projects = Object.entries(data).map(([rpmProjectId, rpmRoot]) => ({
      rpmProjectId,
      rpmRoot: String(rpmRoot || '')
    }));
    return Object.assign({}, r, { projects, data });
  });
}

function searchFiles(root, query, opts, config) {
  const argv = [root];
  if (query != null && String(query) !== '') argv.push(String(query));
  const options = opts || {};
  if (options.category) { argv.push('--category', String(options.category)); }
  if (options.relatedTo) { argv.push('--related-to', String(options.relatedTo)); }
  if (options.limit != null && options.limit !== '') { argv.push('--limit', String(options.limit)); }
  return runCommand('search', argv, config);
}

function projectContext(root, config) {
  return runCommand('context', [root], config);
}

function projectAudit(root, config) {
  return runCommand('audit', [root], config);
}

function vaultAudit(config) {
  return runCommand('vault-audit', [], config);
}

module.exports = {
  ALLOWED_COMMANDS,
  BLOCKED_COMMANDS,
  EXPECTED_SKILL_HASH,
  DEFAULT_TIMEOUT_MS,
  commandAllowed,
  knowledgeScriptPath,
  isAllowedScript,
  isTrustedRpmCli,
  rejectCommand,
  skillFingerprint,
  resolvePython,
  resolveScript,
  resolveSettings,
  configFrom,
  readVaultPath,
  describeStatus,
  runCommand,
  listProjects,
  searchFiles,
  projectContext,
  projectAudit,
  vaultAudit,
  clearCache,
  setSpawnObserver,
  getLastSpawn: () => lastSpawn
};
