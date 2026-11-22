'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { atomicWrite, inside, protectedProjectWrite, samePath, VERSION } = require('./full-product');
const { inspectPath } = require('./project-root');
const { checkedDenial, safeCommand, rolloutDenials } = require('./codex-block-evidence');
const { artifactIndex, pathKey, verifyFile, registerRpmArtifact } = require('./codex-artifacts');

const source = 'codex-app-server-snapshot';
const sourceKinds = ['cli', 'vscode', 'exec', 'appServer'];
const maxMessage = 16 * 1024 * 1024;
const turnStates = { inProgress: 'running', interrupted: 'paused', completed: 'completed', failed: 'failed' };
const labels = {
  pending: '会话已关联，等待执行', running: 'Codex 开始执行', waiting: 'Codex 等待输入或批准',
  paused: 'Codex 执行中断', completed: 'Codex 回合结束', failed: 'Codex 执行失败',
  blocked: 'Codex 执行受阻', test_failed: 'Codex 测试未通过', cancelled: 'Codex 执行取消', unknown: '执行状态未知'
};
const safeId = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
const iso = epoch => Number.isFinite(epoch) && epoch > 0 && epoch < 1e11
  ? new Date(epoch * 1000).toISOString() : null;
const reply = (code, error) => ({ ok: false, code, error });
const unavailable = () => reply('codex_unavailable', '本机 Codex 会话接口暂不可用，已保留历史记录');

function executablePath() {
  const filename = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const directories = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const installed = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const bins = fs.readdirSync(installed, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(installed, entry.name))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
      directories.push(...bins);
    } catch (_) { /* PATH may provide a local CLI install. */ }
  }
  directories.push(...(process.env.PATH || '').split(path.delimiter).map(value => value.replace(/^"|"$/g, '')));
  for (const directory of directories) {
    if (!path.isAbsolute(directory) || directory.startsWith('\\\\')) continue;
    try {
      const file = fs.realpathSync(path.join(directory, filename));
      if (fs.statSync(file).isFile()) return file;
    } catch (_) { /* Continue through local install locations. */ }
  }
  return null;
}

function connectAppServer() {
  const executable = executablePath();
  if (!executable) throw new Error('missing CLI');
  const child = spawn(executable, [
    'app-server', '--listen', 'stdio://', '--disable', 'respect_system_proxy',
    '-c', 'mcp_servers={}', '-c', 'plugins={}', '-c', 'analytics.enabled=false'
  ], { cwd: os.tmpdir(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const decoder = new StringDecoder('utf8');
  const requests = new Map();
  let buffer = '';
  let requestId = 0;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    for (const request of requests.values()) request.reject(new Error('Codex transport stopped'));
    requests.clear();
    child.kill();
  }

  child.once('error', close);
  child.once('exit', close);
  child.stdin.on('error', close);
  child.stdout.on('data', chunk => {
    const lines = decoder.write(chunk).split('\n');
    for (const fragment of lines.slice(0, -1)) {
      if (buffer.length + fragment.length > maxMessage) return close();
      let message;
      try { message = JSON.parse(buffer + fragment); } catch (_) { /* Ignore invalid frames. */ }
      buffer = '';
      const pending = requests.get(message?.id);
      if (!pending) continue;
      requests.delete(message.id);
      if (message.error) pending.reject(new Error('Codex request rejected'));
      else pending.resolve(message.result);
    }
    buffer += lines.at(-1);
    if (buffer.length > maxMessage) close();
  });

  function request(method, params) {
    if (closed) return Promise.reject(new Error('Codex transport stopped'));
    const id = ++requestId;
    let timer;
    return new Promise((resolve, reject) => {
      timer = setTimeout(close, 30000);
      requests.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    }).finally(() => clearTimeout(timer));
  }

  const ready = request('initialize', {
    clientInfo: { name: 'research_workbench', title: 'Research Workbench', version: VERSION },
    capabilities: { experimentalApi: false }
  }).then(() => child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'));
  ready.catch(() => {});
  return {
    ready,
    request: (method, params) => ready.then(() => request(method, params)),
    close,
    get closed() { return closed; }
  };
}

function rootMatches(left, right) {
  return typeof right === 'string' && path.isAbsolute(right) && !right.startsWith('\\\\') &&
    samePath(left, right);
}

function localAbsolute(value) {
  return typeof value === 'string' && value.length <= 4096 && path.isAbsolute(value) &&
    (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value)) &&
    !value.startsWith('//') && !/[\x00-\x1f]/.test(value);
}

function splitPath(value) {
  return value.replace(/\\/g, '/').split('/');
}

function projectSegment(name) {
  return !!name && !name.startsWith('.') && !/[. ]$|[:\x00-\x1f]/.test(name) &&
    !/^(?:\.?skills|node_modules|00_Project_Management)$/i.test(name) &&
    !/(?:^|[._-])(?:secret|credentials?|auth|tokens?|api[_-]?key|private[_-]?key|password|device)(?:[._-]|$)/i.test(name);
}

function ownedPath(scope, target) {
  if (samePath(scope.root, target)) return '.';
  if (!inside(scope.root, target) ||
      scope.children.some(registered => samePath(registered, target) || inside(registered, target))) return null;
  const relative = path.relative(scope.root, target).replace(/\\/g, '/');
  return relative.split('/').every(projectSegment) ? relative : null;
}

function canonicalDirectory(requested) {
  if (!localAbsolute(requested) || splitPath(requested).some(name => name === '..' || name === '.')) return null;
  try {
    const checked = inspectPath(requested);
    return checked.exists && !checked.hasReparseInPath && rootMatches(requested, checked.realPath) &&
      fs.statSync(checked.realPath).isDirectory() ? path.resolve(checked.realPath) : null;
  } catch (_) { return null; }
}

function projectDirectory(scope, requested) {
  if (!localAbsolute(requested)) return null;
  const absolute = path.resolve(requested);
  const relative = ownedPath(scope, absolute);
  if (!relative || (!scope.descendants && relative !== '.') || !canonicalDirectory(requested)) return null;
  return { absolute, relative };
}

function threadName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? [...cleaned].slice(0, 120).join('') : null;
}

function evidencePath(scope, cwd, reported) {
  if (typeof reported !== 'string' || !reported || reported.length > 2048 ||
      /[\x00-\x1f]/.test(reported) || reported.startsWith('\\') || reported.startsWith('//')) return null;
  const absolute = localAbsolute(reported);
  const segments = splitPath(reported);
  if (absolute ? segments.slice(1).some(name => name === '.' || name === '..' || name.includes(':')) :
    !segments.every(projectSegment)) return null;
  const target = path.resolve(cwd, absolute ? reported : segments.join(path.sep));
  const relative = ownedPath(scope, target);
  if (!relative || relative === '.') return null;
  let candidate = target;
  let exists = false;
  for (;;) {
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || !samePath(candidate, fs.realpathSync.native(candidate))) return null;
      if (candidate === target) {
        if (!stat.isFile() || stat.nlink !== 1) return null;
        exists = true;
      } else if (!stat.isDirectory()) return null;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') return null;
      candidate = path.dirname(candidate);
    }
  }
  return { path: relative, present: exists };
}

function stateOf(thread, turn) {
  const state = turnStates[turn?.status];
  if (state === 'running' && thread.status?.type === 'active' &&
      thread.status.activeFlags?.some(flag => ['waitingOnApproval', 'waitingOnUserInput'].includes(flag))) return 'waiting';
  if (turn?.status === 'cancelled') return 'cancelled';
  return state || (turn ? 'unknown' : 'pending');
}

function testCommand(command) {
  return typeof command === 'string' &&
    /^\s*(?:pytest(?:\.exe)?(?:\s|$)|python(?:3|\.exe)?\s+-m\s+(?:pytest|unittest)\b|(?:node|deno)(?:\.exe)?\s+--test\b|(?:npm|pnpm|yarn|cargo|go|dotnet|ctest|vitest|jest)(?:\.exe)?\s+(?:run\s+)?test\b)/i.test(command);
}

function observe(run, thread, scope, directory, sessionsDirectory) {
  const turns = (Array.isArray(thread.turns) ? thread.turns : []).filter(turn => safeId(turn.id))
    .sort((a, b) => (a.startedAt ?? a.completedAt ?? 0) - (b.startedAt ?? b.completedAt ?? 0));
  const anchor = turns.findIndex(turn => turn.id === run.anchorTurnId);
  const relevantTurns = anchor >= 0 ? turns.slice(anchor) : turns.filter(turn => (turn.startedAt ?? 0) >= run.anchorTime);
  const candidateLatest = relevantTurns.at(-1);
  const candidateTime = candidateLatest?.startedAt ?? candidateLatest?.completedAt ?? 0;
  const latest = candidateTime < (run.turnTime ?? 0) ? null : candidateLatest;
  const events = new Map(run.events.map(event => [event.id, event]));
  const files = new Map(run.files.map(file => [process.platform === 'win32' ? file.path.toLowerCase() : file.path, file]));
  const checks = new Map(run.checks.map(check => [check.id, check]));
  const observedAt = new Date().toISOString();
  const latestChecks = new Map();
  const currentDenials = rolloutDenials({ thread, turnId: latest?.id, directory: directory.absolute,
    sessionsDirectory, resolvePath: reported => evidencePath(scope, directory.absolute, reported) });
  const turnDenial = checkedDenial(latest?.error?.message);
  if (turnDenial) currentDenials.push({ operation: 'turn', message: turnDenial, source });
  function event(key, at, kind, label) {
    const id = createHash('sha256').update(run.sessionId + ':' + key).digest('hex');
    if (events.has(id)) return false;
    events.set(id, { id, at: at || observedAt, kind, source, label });
    return true;
  }
  for (const turn of relevantTurns) {
    const state = stateOf(thread, turn);
    const at = iso(turn.completedAt) || iso(turn.startedAt);
    event(turn.id + ':state:' + state, at, state, labels[state]);
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (!safeId(item?.id)) continue;
      const key = turn.id + ':item:' + item.id;
      const itemDenial = item.status === 'declined' ? checkedDenial(item.error?.message || item.aggregatedOutput) :
        item.exitCode == null && item.status === 'failed' ? checkedDenial(item.error?.message) : '';
      const itemBlocked = item.status === 'declined' || Boolean(itemDenial);
      if (turn.id === latest?.id && itemBlocked && ['fileChange', 'commandExecution'].includes(item.type) &&
          (item.type !== 'commandExecution' || projectDirectory(scope, item.cwd))) {
        const reported = item.type === 'fileChange' && Array.isArray(item.changes) ?
          item.changes.map(change => evidencePath(scope, directory.absolute, change.path)).find(Boolean) : null;
        const command = item.type === 'commandExecution' ? safeCommand(item.command) : '';
        currentDenials.push({ operation: item.type === 'fileChange' ? 'write' : 'command',
          message: itemDenial || 'Codex 将该操作标记为 declined', source,
          ...(reported ? { path: reported.path } : {}), ...(command ? { command } : {}) });
      }
      if (item.type === 'fileChange' && item.status === 'completed') {
        const ownedChanges = [];
        for (const change of Array.isArray(item.changes) ? item.changes : []) {
          const kind = { add: 'added', update: 'modified', delete: 'deleted' }[change?.kind?.type];
          const file = kind && evidencePath(scope, directory.absolute, change.path);
          if (!file) continue;
          ownedChanges.push({ ...file, kind, at, source });
          const move = change.kind.move_path && evidencePath(scope, directory.absolute, change.kind.move_path);
          if (move) ownedChanges.push({ ...move, kind: 'added', at, source });
        }
        if (!ownedChanges.length) continue;
        if (!event(key + ':patch', at, 'file_change', 'Codex 报告已应用文件变更') && turn.id !== latest?.id) continue;
        for (const file of ownedChanges) {
          const filename = pathKey(file.path);
          const registrationError = files.get(filename)?.registrationError;
          files.set(filename, registrationError && file.kind !== 'deleted' ? { ...file, registrationError } : file);
        }
      } else if (item.type === 'commandExecution' && projectDirectory(scope, item.cwd)) {
        const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
        const isTest = testCommand(item.command) || actions.some(action => testCommand(action.command));
        const legalStatus = ['inProgress', 'completed', 'failed', 'declined'].includes(item.status) ? item.status : 'unknown';
        const label = isTest ? 'Codex 执行测试命令' :
          actions.some(action => action.type === 'read') ? 'Codex 读取文件' :
            actions.some(action => action.type === 'search') ? 'Codex 查找项目内容' : 'Codex 执行本地命令';
        const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : null;
        const display = legalStatus === 'inProgress' ? label + '（执行中）' :
          exitCode == null ? label + '（无退出码）' : label + '（退出码 ' + exitCode + '）';
        event(key + ':' + legalStatus + ':' + exitCode, at, isTest ? 'test' : 'command', display);
        if (isTest && (legalStatus !== 'inProgress' || !checks.has(key))) {
          const check = { id: key, at, label, status: legalStatus, exitCode, source };
          checks.set(key, check);
          if (turn.id === latest?.id) {
            const command = safeCommand(item.command) || actions.map(action => safeCommand(action.command)).find(Boolean);
            latestChecks.set(command || key, check);
          }
        }
      } else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
        event(key + ':tool', at, 'tool', 'Codex 调用工具');
      }
    }
  }
  const turnState = stateOf(thread, latest);
  const sameTurn = latest?.id === run.turnId;
  const denied = [...new Map([...(sameTurn ? run.denials || [] : []), ...currentDenials]
    .slice(0, 32).map(entry => [JSON.stringify(entry), entry])).values()].slice(0, 12);
  const hasTestFailure = [...latestChecks.values()].some(check => Number.isInteger(check.exitCode) && check.exitCode !== 0);
  const terminal = ['completed', 'failed'].includes(turnState);
  const candidateState = terminal && denied.length ? 'blocked' : terminal && (hasTestFailure || sameTurn && run.status === 'test_failed' && !latestChecks.size)
    ? 'test_failed' : turnState;
  if (latest && candidateState !== turnState) {
    event(latest.id + ':state:' + candidateState, iso(latest.completedAt), candidateState, labels[candidateState]);
  }
  const currentTerminalState = ['completed', 'failed', 'cancelled', 'paused', 'blocked', 'test_failed'].includes(run.status);
  const regressed = sameTurn && currentTerminalState && ['running', 'waiting', 'unknown'].includes(candidateState);
  const index = scope.rpmProjectId && files.size ? artifactIndex(scope) : null;
  const knownFiles = [...files.values()].flatMap(file => {
    const current = evidencePath(scope, scope.root, file.path);
    if (!current) return [];
    const known = index?.get(pathKey(file.path));
    const { registrationError, ...record } = file;
    return [{ ...record, present: current.present, fileId: known?.present ? known.fileId : null,
      registered: index ? Boolean(known?.present) : null, ...(registrationError && !known?.present ? { registrationError } : {}) }];
  });
  return {
    ...run, connection: 'snapshot', directory: directory.relative, rootKey: scope.rootKey, scopeLost: false,
    turnId: latest?.id || run.turnId,
    turnTime: latest ? candidateTime : run.turnTime,
    status: latest && !regressed ? candidateState : run.status,
    startedAt: run.startedAt || iso(latest?.startedAt),
    endedAt: latest && !regressed ? iso(latest.completedAt) : run.endedAt,
    events: [...events.values()], files: knownFiles, checks: [...checks.values()],
    artifactRegistrationAllowed: Boolean(scope.rpmProjectId && !scope.readOnly),
    denials: latest && !regressed ? denied : run.denials || []
  };
}

function assertHistoryPath(file) {
  const directory = path.dirname(file);
  if (!samePath(directory, fs.realpathSync.native(directory))) throw new Error('redirected history directory');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || !samePath(file, fs.realpathSync.native(file))) {
    throw new Error('redirected history file');
  }
  return stat;
}

function codexSessionsRoot() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  if (!localAbsolute(home)) return '';
  try {
    // The configured Codex home can be a relocated directory. Its sessions child must stay canonical.
    const realHome = fs.realpathSync.native(home);
    if (!localAbsolute(realHome) || !fs.statSync(realHome).isDirectory()) return '';
    return path.join(realHome, 'sessions');
  } catch (_) {
    return path.join(home, 'sessions');
  }
}

function createCodexCollaboration({
  file, readWorkspace, resolveProject, onChange, connect = connectAppServer, pollIntervalMs = 12000,
  sessionsDirectory = codexSessionsRoot(), watchSessions = fs.watch,
  signalDelayMs = 180, settleDelayMs = 1200, openArtifact, revealArtifact, confirmArtifact,
  rpmConfig = () => ({}), registerArtifact = registerRpmArtifact
}) {
  let records = [];
  let readError = false;
  let client;
  let closed = false;
  let queue = Promise.resolve();
  let refreshJob;
  let recentJob;
  let contextRetryAt = 0;
  const pendingScopes = new Map();
  let watcher;
  let watchRetryAt = 0;
  let signalTimer;
  let settleTimer;
  let signalVersion = 0;
  let signalJob;

  try {
    const expected = assertHistoryPath(file);
    const fd = fs.openSync(file, 'r');
    let saved;
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== expected.ino || opened.dev !== expected.dev) {
        throw new Error('history file changed');
      }
      saved = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
    if (saved.version !== 1 || !Array.isArray(saved.runs) ||
        saved.runs.some(run => !safeId(run?.sessionId) || !safeId(run.projectId) || !safeId(run.taskId) ||
          !Array.isArray(run.events) || !Array.isArray(run.files) || !Array.isArray(run.checks))) {
      throw new Error('invalid integration history');
    }
    records = saved.runs.map(run => ({ ...run, connection: 'stale' }));
  } catch (error) {
    if (error.code !== 'ENOENT') readError = true;
  }

  function runSerial(work) {
    const job = queue.then(work);
    queue = job.catch(() => {});
    return job;
  }

  function notify(change) {
    if (closed) return;
    try { onChange?.(change); } catch (_) { /* The observer does not control stored state. */ }
  }

  function persist(next, projectId) {
    if (closed) return false;
    try {
      try { assertHistoryPath(file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      atomicWrite(file, JSON.stringify({ version: 1, runs: next }));
      records = next;
    } catch (_) { return false; }
    notify(projectId ? { kind: 'runs', projectId } : { kind: 'runs' });
    return true;
  }

  function rpc(method, params) {
    if (closed) return Promise.reject(new Error('Codex adapter closed'));
    if (!client || client.closed) client = connect();
    return client.request(method, params);
  }

  async function context(projectId, taskId) {
    if (!safeId(projectId) || (taskId !== undefined && !safeId(taskId))) return null;
    const db = await readWorkspace();
    if (!db?.projects?.some(project => project.id === projectId) ||
        (taskId && !db?.tasks?.some(task => task.id === taskId && task.p === projectId))) return null;
    const ref = await resolveProject(projectId);
    const root = ref && (!ref.metadataOnly || ref.allowActivityTracking === true) && canonicalDirectory(ref.root);
    if (!root) return null;
    const registered = Array.isArray(ref.registeredRoots) ? ref.registeredRoots.filter(localAbsolute) : [];
    const descendants = registered.some(item => samePath(root, item));
    const children = new Set();
    if (descendants) {
      for (const item of registered) {
        const absolute = path.resolve(item);
        if (inside(root, absolute)) children.add(absolute);
        try {
          const physical = fs.realpathSync.native(absolute);
          if (inside(root, physical)) children.add(physical);
        } catch (_) { /* A registered lexical child still excludes its own scope. */ }
      }
    }
    const keyPath = process.platform === 'win32' ? root.toLowerCase() : root;
    const rootKey = createHash('sha256').update(keyPath).digest('hex');
    return { root, rootKey, descendants, children: [...children], rpmProjectId: ref.rpmProjectId,
      metadataOnly: Boolean(ref.metadataOnly),
      readOnly: Boolean(ref.readOnly || ref.metadataOnly || protectedProjectWrite(ref.rpmProjectId, root)) };
  }

  const sessionQuery = { useStateDbOnly: true, currentAccountOnly: true, sourceKinds, modelProviders: [] };

  function notificationMode() {
    return watcher ? 'filesystem-signal' : 'reconcile-only';
  }

  async function capabilities() {
    ensureWatcher();
    const value = { mode: 'app-server-snapshot', liveEvents: false, pollIntervalMs, notificationMode: notificationMode() };
    try {
      await rpc('thread/list', { ...sessionQuery, limit: 1 });
      return { ok: true, available: true, ...value };
    } catch (_) {
      return { ...unavailable(), available: false, ...value };
    }
  }

  function recentSessions(cycle) {
    if (cycle?.recent) return cycle.recent;
    if (!recentJob) {
      recentJob = rpc('thread/list', { ...sessionQuery, limit: 100, sortKey: 'updated_at' })
        .finally(() => { recentJob = null; });
    }
    if (cycle) cycle.recent = recentJob;
    return recentJob;
  }

  async function findSessions(scope, cycle) {
    const exact = rpc('thread/list', { ...sessionQuery, cwd: scope.root, limit: 50, sortKey: 'updated_at' });
    const pages = scope.descendants ? await Promise.all([exact, recentSessions(cycle)]) : [await exact];
    const matches = new Map();
    for (const page of pages) {
      for (const thread of page?.data || []) {
        if (!safeId(thread.id) || matches.has(thread.id)) continue;
        const directory = projectDirectory(scope, thread.cwd);
        if (!directory) continue;
        const safeName = threadName(thread.name);
        matches.set(thread.id, {
          sessionId: thread.id, updatedAt: iso(thread.updatedAt), directory: directory.relative,
          status: thread.status?.type === 'active' ? 'running' : 'unknown',
          ...(safeName ? { name: safeName } : {})
        });
      }
    }
    return [...matches.values()].sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''));
  }

  function pendingResult(value) {
    const result = { ...value, mode: 'app-server-snapshot', notificationMode: notificationMode() };
    if (value.sessions) {
      result.sessions = value.sessions.filter(row => !records.some(run => run.sessionId === row.sessionId))
        .map(row => ({ ...row }));
    }
    return result;
  }

  async function pending({ projectId, force = false } = {}, cycle) {
    if (closed || !safeId(projectId)) return pendingResult(reply('ineligible_project', '请选择已绑定 RPM 的项目'));
    ensureWatcher();
    let scope = pendingScopes.get(projectId);
    if (!scope) {
      scope = {};
      pendingScopes.set(projectId, scope);
    }
    if (!force && scope.value) return pendingResult(scope.value);
    if (!scope.job) {
      scope.job = (async () => {
        let value;
        try {
          const project = await context(projectId);
          value = project ? { ok: true, root: project.root, sessions: await findSessions(project, cycle) } :
            reply('ineligible_project', '无法核对 RPM 项目根目录，请检查登记和目录可用性');
        } catch (_) { value = unavailable(); }
        const changed = scope.value && JSON.stringify(value) !== JSON.stringify(scope.value);
        scope.value = value;
        if (changed) notify({ kind: 'pending', projectId });
        return value;
      })().finally(() => { scope.job = null; });
    }
    return pendingResult(await scope.job);
  }

  function discover({ projectId } = {}) {
    return pending({ projectId, force: true });
  }

  async function readThread(sessionId, scope, approvedDirectory) {
    const data = await rpc('thread/read', { threadId: sessionId, includeTurns: true });
    const thread = data?.thread;
    const directory = thread?.id === sessionId && projectDirectory(scope, thread.cwd);
    if (!directory || (approvedDirectory !== undefined && !samePath(directory.relative, approvedDirectory))) return null;
    return { thread, directory };
  }

  function displayRun(run) {
    const { rootKey, scopeLost, ...safe } = run;
    if (scopeLost) {
      delete safe.directory;
      safe.files = [];
      safe.checks = [];
      safe.denials = [];
    }
    return structuredClone(safe);
  }

  function scopeStillApproved(run, scope) {
    return scope && (!run.rootKey || run.rootKey === scope.rootKey);
  }

  function bind({ projectId, taskId, sessionId } = {}) {
    return runSerial(async () => {
      if (readError) return reply('invalid_history', 'Codex 执行记录无法读取，请保留原文件并恢复备份');
      if (!safeId(sessionId) || !safeId(taskId)) return reply('invalid_binding', '请选择任务和本地 Codex 会话');
      try {
        const existing = records.find(run => run.sessionId === sessionId);
        if (existing && (existing.projectId !== projectId || existing.taskId !== taskId)) {
          return reply('already_bound', '该 Codex 会话已关联到另一项任务');
        }
        const scope = await context(projectId, taskId);
        if (!scope) return reply('invalid_binding', '任务、RPM 项目绑定或真实根目录校验未通过');
        if (existing) {
          const fresh = scopeStillApproved(existing, scope) && await readThread(sessionId, scope, existing.directory || '.');
          return fresh ? { ok: true, run: displayRun(existing) } :
            reply('unmatched_session', '已关联会话的工作目录已变化，请核对项目归属');
        }
        const candidates = await findSessions(scope);
        const approved = candidates.find(row => row.sessionId === sessionId);
        if (!approved) return reply('unmatched_session', '会话不在该项目检出的 Codex 会话中');
        const fresh = await readThread(sessionId, scope, approved.directory);
        if (!fresh) return reply('unmatched_session', '会话工作目录已变化或超出该项目');
        const { thread, directory } = fresh;
        const turns = Array.isArray(thread.turns) ? thread.turns : [];
        const latest = [...turns].sort((a, b) => (a.startedAt ?? a.completedAt ?? 0) - (b.startedAt ?? b.completedAt ?? 0)).at(-1);
        const now = new Date().toISOString();
        const run = observe({
          id: randomUUID(), projectId, taskId, sessionId, status: 'pending', connection: 'snapshot',
          anchorTurnId: latest?.id || null, anchorTime: latest?.startedAt ?? Math.floor(Date.now() / 1000),
          startedAt: iso(latest?.startedAt), endedAt: null, updatedAt: now, events: [], files: [], checks: []
        }, thread, scope, directory, sessionsDirectory);
        if (!persist([...records, run], projectId)) return reply('history_write_failed', '无法保存 Codex 执行记录');
        if (pendingScopes.has(projectId)) notify({ kind: 'pending', projectId });
        return { ok: true, run: displayRun(run) };
      } catch (_) { return unavailable(); }
    });
  }

  function list({ projectId, taskId } = {}) {
    if (readError) return reply('invalid_history', 'Codex 执行记录无法读取，请保留原文件并恢复备份');
    return { ok: true, runs: records.filter(run =>
      (!projectId || run.projectId === projectId) && (!taskId || run.taskId === taskId)).map(displayRun) };
  }

  function refresh(filter) {
    if (closed || readError || !records.length) return Promise.resolve(list(filter));
    if (!refreshJob) {
      refreshJob = runSerial(async () => {
        let changed = false;
        let failure = false;
        if (Date.now() < contextRetryAt) return null;
        const next = [];
        for (const run of records) {
          let updated = { ...run, connection: 'stale' };
          try {
            const scope = await context(run.projectId, run.taskId);
            const fresh = scopeStillApproved(run, scope) && await readThread(run.sessionId, scope, run.directory || '.');
            if (fresh) updated = observe(run, fresh.thread, scope, fresh.directory, sessionsDirectory);
            else updated.scopeLost = true;
          } catch (_) {
            updated.connection = 'unavailable';
            contextRetryAt = Date.now() + Math.min(pollIntervalMs, 10000);
            failure = true;
          }
          if (JSON.stringify(updated) !== JSON.stringify(run)) {
            changed = true;
            updated.updatedAt = new Date().toISOString();
          }
          next.push(updated);
          if (failure) {
            next.push(...records.slice(next.length).map(row => {
              if (row.connection === 'unavailable') return row;
              changed = true;
              return { ...row, connection: 'unavailable', updatedAt: new Date().toISOString() };
            }));
            break;
          }
        }
        if (changed && !persist(next)) return reply('history_write_failed', '无法保存 Codex 执行记录');
        return null;
      }).finally(() => { refreshJob = null; });
    }
    return refreshJob.then(error => error || list(filter));
  }

  function artifact({ projectId, taskId, runId, path: requested, action = 'inspect' } = {}) {
    if (!['inspect', 'open', 'reveal', 'register'].includes(action) ||
        !safeId(runId) || !safeId(taskId) || !safeId(projectId) || typeof requested !== 'string') {
      return Promise.resolve(reply('invalid_artifact', '请选择已关联执行中的文件'));
    }
    return runSerial(async () => {
      if (closed || readError) return reply('history_unavailable', '执行记录暂不可核对');
      const run = records.find(row => row.id === runId && row.projectId === projectId && row.taskId === taskId);
      const reported = run?.files.find(row => row.path === requested && ['added', 'modified'].includes(row.kind));
      if (!reported || run.scopeLost) return reply('unapproved_artifact', '此执行未报告该文件或项目归属已变化');
      const scope = await context(projectId, taskId);
      if (!scopeStillApproved(run, scope) || !run.rootKey) return reply('unapproved_artifact', '项目绑定已变化，请刷新执行记录');
      const current = evidencePath(scope, scope.root, requested);
      if (!current?.present) return reply('artifact_missing', '项目文件已移走、不可访问或不在授权目录内');
      const makeTarget = () => verifyFile(scope, requested, action !== 'open');
      const target = makeTarget();
      if (!target) return reply('artifact_unsupported', '此格式不支持从工作台直接打开，可在磁盘定位');
      const index = artifactIndex(scope);
      const item = index?.get(pathKey(requested));
      const canRegister = Boolean(index && !scope.readOnly && !item);
      const state = { ok: true, path: current.path, present: true, registered: index ? Boolean(item?.present) : null,
        fileId: item?.present ? item.fileId : null, canRegister };
      if (action === 'inspect') return state;
      if (action === 'open' || action === 'reveal') {
        if (scope.metadataOnly && !item?.present) return reply('protected_root', '该项目只提供已登记原件的读取与定位');
        const operation = action === 'open' ? openArtifact : revealArtifact;
        if (typeof operation !== 'function') return reply('artifact_unavailable', '暂无法从系统访问文件');
        try {
          if (await operation(target)) return reply('artifact_open_failed', '操作系统暂无法访问该文件，可重新定位');
          return state;
        } catch (_) { return reply('artifact_open_failed', '操作系统暂无法访问该文件，可重新定位'); }
      }
      if (scope.readOnly) return reply('protected_root', '项目只读，正式文件索引未修改');
      if (item?.present) return state;
      if (!canRegister || !confirmArtifact) return reply('artifact_registration_unavailable', '请核对 RPM 文件索引后重试');
      const stamp = stat => [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.dev].join(':');
      let original;
      try { original = stamp(fs.lstatSync(target, { bigint: true })); }
      catch (_) { return reply('artifact_changed', '文件已失效，请重新核对'); }
      if (!await confirmArtifact({ path: current.path, projectId, taskId })) return reply('cancelled', '已取消登记');
      const renewed = await context(projectId, taskId);
      if (!scopeStillApproved(run, renewed) || renewed.readOnly || renewed.rpmProjectId !== scope.rpmProjectId ||
          !evidencePath(renewed, renewed.root, requested)?.present || makeTarget() !== target) {
        return reply('artifact_changed', '确认期间文件或项目绑定发生变化，请重新核对后重试');
      }
      try {
        if (original !== stamp(fs.lstatSync(target, { bigint: true }))) {
          return reply('artifact_changed', '确认期间文件内容已变化，请重新核对后重试');
        }
      } catch (_) { return reply('artifact_changed', '确认期间文件已失效，请重新核对'); }
      const replaceFile = update => records.map(row => row.id === runId ? { ...row,
        files: row.files.map(file => file.path === requested ? update(file) : file) } : row);
      const result = await registerArtifact(renewed, requested, await rpmConfig());
      if (!result?.ok) {
        const failure = result || reply('rpm_registration_failed', 'RPM 未返回登记结果，请重试');
        const registrationError = String(failure.error || '登记失败，请重试').slice(0, 250);
        persist(replaceFile(file => ({ ...file, registrationError })), projectId);
        return failure;
      }
      const linked = persist(replaceFile(({ registrationError, ...file }) =>
        ({ ...file, registered: true, fileId: result.fileId })), projectId);
      return { ...state, registered: true, canRegister: false, fileId: result.fileId, linked,
        ...(linked ? {} : { notice: '文件已登记，执行关联暂未保存。刷新可重新核对登记' }) };
    });
  }

  async function reconcile() {
    if (closed) return;
    ensureWatcher();
    const cycle = {};
    const discovery = [...pendingScopes.keys()].map(projectId => pending({ projectId, force: true }, cycle));
    await Promise.allSettled([refresh(), ...discovery]);
  }

  function scheduleSignal() {
    if (closed || signalTimer || signalJob) return;
    signalTimer = setTimeout(() => {
      signalTimer = null;
      const version = signalVersion;
      signalJob = reconcile().finally(() => {
        signalJob = null;
        if (version !== signalVersion) scheduleSignal();
      });
    }, signalDelayMs);
    signalTimer.unref?.();
  }

  function fileSignal() {
    if (closed) return;
    signalVersion++;
    scheduleSignal();
    clearTimeout(settleTimer);
    // A rollout can become visible before the App Server's local index has been updated.
    settleTimer = setTimeout(() => {
      signalVersion++;
      scheduleSignal();
    }, settleDelayMs);
    settleTimer.unref?.();
  }

  function notifyPendingMode() {
    for (const [projectId, scope] of pendingScopes) {
      if (scope.value) notify({ kind: 'pending', projectId });
    }
  }

  function ensureWatcher() {
    if (closed || watcher || !sessionsDirectory || Date.now() < watchRetryAt) return;
    watchRetryAt = Date.now() + Math.min(pollIntervalMs, 5000);
    try {
      const checked = inspectPath(sessionsDirectory);
      if (!checked.exists || checked.hasReparseInPath || !rootMatches(sessionsDirectory, checked.realPath) ||
          !fs.statSync(checked.realPath).isDirectory()) return;
      // Directory notifications invalidate snapshots. Error evidence is scoped to the linked session and active turn.
      const current = watchSessions(checked.realPath, { recursive: true, persistent: false }, () => fileSignal());
      watcher = current;
      current.on('error', () => {
        if (watcher !== current) return;
        watcher = null;
        current.close();
        notifyPendingMode();
        fileSignal();
      });
      notifyPendingMode();
    } catch (_) { /* Periodic reconciliation remains active if watching is unsupported. */ }
  }

  if (records.length) ensureWatcher();
  const timer = setInterval(() => { reconcile().catch(() => {}); }, pollIntervalMs);
  timer.unref?.();
  return {
    capabilities, discover, pending, bind, list, refresh, artifact,
    close() {
      closed = true;
      clearInterval(timer);
      clearTimeout(signalTimer);
      clearTimeout(settleTimer);
      watcher?.close();
      client?.close();
    }
  };
}

module.exports = { createCodexCollaboration, connectAppServer };
