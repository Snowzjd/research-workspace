/* ==========================================================================
   知识库服务按需启动 / 空闲停止（主进程）
   --------------------------------------------------------------------------
   检索或问答失败且 /health 不通时，运行设置里的启动命令（kbStartCommand），
   轮询 /health 直到就绪，再把原请求重发一次。并发请求共用同一次启动。
   只有本软件启动的服务，才会在空闲 kbIdleStopMinutes 分钟后用 kbStopCommand 停掉；
   用户或其他程序手动启动的服务不会被自动停止。不写任何开机自启项。

   命令格式：可执行文件 + 参数，按引号拆分，不经过 shell。
   可执行文件须是绝对路径，或 powershell / pwsh；.bat/.cmd 经 cmd.exe /d /c 运行，
   且参数里不允许 & | < > ^ % ! 等 cmd 元字符。
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_TIMEOUT_SEC = 60;
const DEFAULT_IDLE_MIN = 30;
const RUNNERS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const CMD_META = /[&|<>^%!"\r\n]/;

const st = {
  starting: null,
  startedByApp: false,
  lastUseAt: 0,
  lastCfg: null,
  lastStart: null,
  lastStop: null,
  idleTimer: null
};
let healthImpl = null;
let notifyImpl = null;
let spawnImpl = (file, args, opts) => childProcess.spawn(file, args, opts);

function setHealth(fn) { healthImpl = typeof fn === 'function' ? fn : null; }
function setNotifier(fn) { notifyImpl = typeof fn === 'function' ? fn : null; }
function setSpawn(fn) { spawnImpl = typeof fn === 'function' ? fn : spawnImpl; }
function notify(payload) { try { if (notifyImpl) notifyImpl(Object.assign({ at: Date.now() }, payload)); } catch (_) {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function splitArgs(str) {
  const out = []; let cur = ''; let q = null; let has = false;
  for (const ch of String(str || '')) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) { out.push(cur); cur = ''; has = false; } }
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

function kbOf(cfg) {
  const kb = (cfg && cfg.kb && typeof cfg.kb === 'object') ? cfg.kb : {};
  const t = Number(kb.startTimeoutSec);
  const idle = Number(kb.idleStopMinutes);
  return {
    startCommand: String(kb.startCommand || '').trim(),
    stopCommand: String(kb.stopCommand || '').trim(),
    startTimeoutSec: Number.isFinite(t) && t > 0 ? Math.min(Math.max(t, 5), 600) : DEFAULT_TIMEOUT_SEC,
    idleStopMinutes: Number.isFinite(idle) && idle >= 0 ? idle : DEFAULT_IDLE_MIN
  };
}

function isExternal(cfg) {
  const e = String((cfg && cfg.engine) || '');
  return e === 'rag_snowz' || e === 'http';
}

function parseCommand(cmd) {
  const raw = String(cmd || '').trim();
  if (!raw) return { ok: false, code: 'unconfigured', error: '未配置命令' };
  const argv = splitArgs(raw);
  if (!argv.length) return { ok: false, code: 'bad_command', error: '命令为空' };
  const exe = argv[0];
  const args = argv.slice(1);
  if (args.some(a => /[\r\n\0]/.test(a))) return { ok: false, code: 'bad_command', error: '命令参数不能换行' };
  const base = path.basename(exe).toLowerCase();
  if (!(RUNNERS.has(base) && !/[\\/]/.test(exe))) {
    if (!path.isAbsolute(exe)) return { ok: false, code: 'bad_command', error: `命令须是绝对路径，或以 powershell / pwsh 开头：${exe}` };
    if (!fs.existsSync(exe)) return { ok: false, code: 'bad_command', error: `找不到命令：${exe}` };
  }
  const ext = path.extname(exe).toLowerCase();
  if (ext === '.bat' || ext === '.cmd') {
    if (argv.some(a => CMD_META.test(a))) return { ok: false, code: 'bad_command', error: '批处理命令的路径和参数里不能含 & | < > ^ % ! " 等字符' };
    return { ok: true, file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', exe].concat(args) };
  }
  if (!['', '.exe', '.com'].includes(ext)) {
    return { ok: false, code: 'bad_command', error: `不支持直接运行 ${ext || exe}。.ps1 请写成 powershell -NoProfile -ExecutionPolicy Bypass -File 脚本路径` };
  }
  return { ok: true, file: exe, args };
}

function lastJson(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l[0] !== '{') continue;
    try { return JSON.parse(l); } catch (_) {}
  }
  return null;
}
function lastLine(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 300) : '';
}

/* 运行一条命令，等它退出（或超时）。不经过 shell，窗口隐藏。
   不用 detached：Windows 上 DETACHED_PROCESS 会让 powershell 没有控制台、立刻以 0 退出而什么都没启动。
   启动脚本自己负责把服务拉成独立进程（例如 Start-Process），本软件退出不影响服务。 */
function runCommand(cmd, timeoutMs) {
  const parsed = parseCommand(cmd);
  if (!parsed.ok) return Promise.resolve({ ok: false, code: parsed.code, error: parsed.error });
  return new Promise(resolve => {
    let out = ''; let err = ''; let done = false; let child = null;
    const finish = (r) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { if (child && child.stdout) child.stdout.destroy(); } catch (_) {}
      try { if (child && child.stderr) child.stderr.destroy(); } catch (_) {}
      try { if (child && child.unref) child.unref(); } catch (_) {}
      resolve(Object.assign({ stdout: out.slice(-4000), stderr: err.slice(-4000), pid: child && child.pid }, r));
    };
    const timer = setTimeout(() => finish({ ok: false, timedOut: true, error: `命令 ${Math.round(timeoutMs / 1000)}s 内没有结束` }), timeoutMs);
    try {
      child = spawnImpl(parsed.file, parsed.args, {
        detached: false, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      return finish({ ok: false, code: 'spawn_failed', error: String((e && e.message) || e) });
    }
    if (child.stdout) child.stdout.on('data', d => { out += d; if (out.length > 65536) out = out.slice(-65536); });
    if (child.stderr) child.stderr.on('data', d => { err += d; if (err.length > 65536) err = err.slice(-65536); });
    child.on('error', e => finish({ ok: false, code: 'spawn_failed', error: String((e && e.message) || e) }));
    child.on('exit', code => setTimeout(() => {
      const json = lastJson(out);
      if (code === 0 && !(json && json.ok === false)) return finish({ ok: true, exitCode: code, json });
      finish({
        ok: false, code: 'script_failed', exitCode: code, json,
        error: (json && (json.error || json.message || json.reason)) || lastLine(err) || lastLine(out) || `退出码 ${code}`
      });
    }, 200));
  });
}

async function healthOk(cfg) {
  if (!healthImpl) return { ok: false, error: '健康检查未接入' };
  try {
    const h = await healthImpl({ endpoint: cfg && cfg.endpoint, engine: cfg && cfg.engine });
    return h && h.ok ? h : (h || { ok: false });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function remember(cfg) {
  if (cfg && cfg.endpoint) st.lastCfg = { endpoint: cfg.endpoint, engine: cfg.engine, kb: kbOf(cfg) };
}
function touch() { st.lastUseAt = Date.now(); }

/* 确保服务在线。已在线直接返回；否则跑启动命令并轮询 /health。并发调用共用一次启动。 */
function ensureUp(cfg, opts) {
  remember(cfg);
  if (st.starting) return st.starting;
  const kb = kbOf(cfg);
  st.starting = (async () => {
    const h0 = await healthOk(cfg);
    if (h0.ok) return { ok: true, already: true, health: h0 };
    if (!kb.startCommand) {
      return { ok: false, code: 'unconfigured', error: '未配置知识库启动命令（设置 → 知识库引擎 → 启动命令）' };
    }
    const t0 = Date.now();
    const timeoutMs = kb.startTimeoutSec * 1000;
    notify({ phase: 'starting', manual: !!(opts && opts.manual) });
    let runRes = null;
    const run = runCommand(kb.startCommand, timeoutMs).then(r => { runRes = r; return r; });
    let health = null;
    while (Date.now() - t0 < timeoutMs) {
      if (runRes && !runRes.ok) break;
      const h = await healthOk(cfg);
      if (h.ok) { health = h; break; }
      await (runRes ? sleep(1500) : Promise.race([sleep(1500), run]));
    }
    const ms = Date.now() - t0;
    if (!health) {
      const failed = runRes && !runRes.ok && !runRes.timedOut;
      const res = {
        ok: false,
        code: failed ? 'start_failed' : 'start_timeout',
        error: failed ? runRes.error : `${kb.startTimeoutSec}s 内服务没有就绪`,
        ms, exitCode: runRes ? runRes.exitCode : null, script: runRes && runRes.json
      };
      st.lastStart = { at: Date.now(), ok: false, ms, error: res.error };
      notify({ phase: 'fail', error: res.error, ms });
      return res;
    }
    st.startedByApp = true;
    touch();
    st.lastStart = { at: Date.now(), ok: true, ms };
    notify({ phase: 'ok', ms, health });
    return { ok: true, started: true, ms, health, script: runRes && runRes.json };
  })().finally(() => { st.starting = null; });
  return st.starting;
}

/* 检索 / 问答：失败且 /health 不通时，自动启动后重发一次。 */
async function withService(cfg, fn) {
  remember(cfg);
  touch();
  const r = await fn();
  if ((r && r.ok) || !isExternal(cfg)) return r;
  const h = await healthOk(cfg);
  if (h.ok) return r;
  const s = await ensureUp(cfg);
  if (!s.ok) {
    return Object.assign({}, r || {}, {
      ok: false,
      kb_start: { ok: false, code: s.code, error: s.error, ms: s.ms },
      error: s.code === 'unconfigured' ? ((r && r.error) || '知识库服务未启动') : '知识库启动失败：' + s.error
    });
  }
  const r2 = await fn();
  touch();
  return Object.assign({}, r2 || {}, { kb_start: { ok: true, started: !!s.started, ms: s.ms || 0 } });
}

async function stop(cfg, opts) {
  remember(cfg);
  const kb = kbOf(cfg && cfg.kb ? cfg : st.lastCfg);
  if (!kb.stopCommand) return { ok: false, code: 'unconfigured', error: '未配置知识库停止命令（设置 → 知识库引擎 → 停止命令）' };
  const r = await runCommand(kb.stopCommand, 120000);
  st.lastStop = { at: Date.now(), ok: !!r.ok, reason: (opts && opts.reason) || 'manual', error: r.ok ? '' : r.error };
  if (r.ok) st.startedByApp = false;
  notify({ phase: r.ok ? 'stopped' : 'stop_fail', reason: (opts && opts.reason) || 'manual', error: r.ok ? '' : r.error });
  return r.ok ? { ok: true, json: r.json } : { ok: false, code: r.code, error: r.error };
}

/* 空闲检查：只停本软件启动的服务；0 分钟表示不自动停。 */
async function idleTick(now) {
  const t = now || Date.now();
  if (!st.startedByApp || st.starting || !st.lastCfg) return { stopped: false };
  const kb = st.lastCfg.kb || kbOf(null);
  if (!(kb.idleStopMinutes > 0) || !kb.stopCommand) return { stopped: false };
  if (t - st.lastUseAt < kb.idleStopMinutes * 60000) return { stopped: false };
  const r = await stop(st.lastCfg, { reason: 'idle' });
  return { stopped: !!r.ok, result: r };
}

function startIdleTimer(intervalMs) {
  if (st.idleTimer) return;
  st.idleTimer = setInterval(() => { idleTick().catch(() => {}); }, intervalMs || 60000);
  if (st.idleTimer.unref) st.idleTimer.unref();
}

function status() {
  return {
    starting: !!st.starting,
    startedByApp: st.startedByApp,
    lastUseAt: st.lastUseAt,
    lastStart: st.lastStart,
    lastStop: st.lastStop
  };
}

function _reset() {
  st.starting = null; st.startedByApp = false; st.lastUseAt = 0; st.lastCfg = null; st.lastStart = null; st.lastStop = null;
}

module.exports = {
  splitArgs, parseCommand, lastJson, runCommand,
  setHealth, setNotifier, setSpawn,
  ensureUp, withService, stop, idleTick, startIdleTimer, status, touch, _reset
};
