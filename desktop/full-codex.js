'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { StringDecoder } = require('node:string_decoder');

const inspect = promisify(execFile);
const maxLogBytes = 32 * 1024 * 1024;
const maxLine = 256 * 1024;
const maxSampleEntries = 500;
const phases = {
  'thread.started': 'thread_started',
  'turn.started': 'turn_started',
  'turn.completed': 'turn_completed',
  'turn.failed': 'turn_failed',
  error: 'cli_error'
};
const items = {
  agent_message: 'message',
  reasoning: 'reasoning',
  command_execution: 'command',
  file_change: 'file_change',
  mcp_tool_call: 'tool',
  web_search: 'web_search',
  todo_list: 'plan',
  error: 'item_error'
};
const skipDirectories = new Set(['.git', '.codex', '.obsidian', '.hg', '.svn', 'node_modules', 'candidate-user-data', 'portable-user-data']);
const sensitiveName = /(?:^(?:device|auth|credentials?|secrets?|tokens?)\.|(?:^|[._-])(?:credential|password|api[_-]?key|private[_-]?key|secret)(?:[._-]|$)|^\.env(?:\.|$))/i;

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function validContext({ projectId, taskId } = {}) {
  const validId = id => typeof id === 'string' && /^[\w.-]{1,160}$/.test(id);
  return validId(projectId) && (!taskId || validId(taskId));
}

function parseExecEvent(line) {
  let event;
  try { event = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { return null; }
  if (!event || typeof event !== 'object') return null;
  if (Object.hasOwn(phases, event.type)) {
    return { source: 'codex', kind: phases[event.type] };
  }
  if (!['item.started', 'item.updated', 'item.completed'].includes(event.type)) return null;
  const type = event.item?.type;
  if (!Object.hasOwn(items, type)) return null;
  const kind = items[type] + '_' + event.type.slice(5);
  const count = type === 'file_change' && Array.isArray(event.item.changes)
    ? Math.min(10000, event.item.changes.length) : undefined;
  return count === undefined ? { source: 'codex', kind } : { source: 'codex', kind, count };
}

function jsonLines(consume) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let dropping = false;
  return chunk => {
    const lines = decoder.write(chunk).split('\n');
    const incomplete = lines.pop();
    for (const line of lines) {
      if (!dropping && pending.length + line.length <= maxLine) consume(pending + line);
      pending = '';
      dropping = false;
    }
    if (!dropping) {
      if (pending.length + incomplete.length > maxLine) {
        pending = '';
        dropping = true;
      } else {
        pending += incomplete;
      }
    }
  };
}

async function locateCli() {
  const filename = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const bins = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const installed = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const versions = await fsp.readdir(installed, { withFileTypes: true });
      const candidates = await Promise.all(versions.filter(entry => entry.isDirectory())
        .map(async entry => {
          const file = path.join(installed, entry.name, filename);
          try { return { file, mtime: (await fsp.stat(file)).mtimeMs }; } catch { return null; }
        }));
      bins.push(...candidates.filter(Boolean).sort((a, b) => b.mtime - a.mtime).map(entry => entry.file));
    } catch { /* PATH may still provide the executable. */ }
  }
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const absolute = directory.replace(/^"|"$/g, '');
    if (path.isAbsolute(absolute) && !absolute.startsWith('\\\\')) bins.push(path.join(absolute, filename));
  }
  for (const file of bins) {
    try {
      if ((await fsp.stat(file)).isFile()) return await fsp.realpath(file);
    } catch { /* Look at the next installation location. */ }
  }
  return '';
}

async function safeLog(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.startsWith('\\\\') ||
      path.extname(input).toLowerCase() !== '.jsonl' || input.slice(process.platform === 'win32' ? 2 : 0).includes(':')) {
    throw new Error('invalid_event_file');
  }
  const file = path.resolve(input);
  if (file.split(/[\\/]/).some(segment => skipDirectories.has(segment.toLowerCase()) || sensitiveName.test(segment))) {
    throw new Error('invalid_event_file');
  }
  const real = await fsp.realpath(file);
  const stat = await fsp.lstat(file, { bigint: true });
  if (!samePath(file, real) || !stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(maxLogBytes)) {
    throw new Error('invalid_event_file');
  }
  return { file, stat };
}

async function sampleFiles(root, eventFile) {
  const directory = path.resolve(root);
  if (!samePath(directory, await fsp.realpath(directory))) throw new Error('redirected observation root');
  const pending = [directory];
  const result = new Map();
  let scanned = 0;
  while (pending.length && scanned < maxSampleEntries) {
    const parent = pending.shift();
    const entries = await fsp.opendir(parent);
    for await (const entry of entries) {
      if (++scanned > maxSampleEntries) break;
      const name = entry.name;
      if (entry.isSymbolicLink() || name.startsWith('.') || skipDirectories.has(name.toLowerCase()) || sensitiveName.test(name)) continue;
      const file = path.join(parent, name);
      if (samePath(file, eventFile)) continue;
      try {
        const stat = await fsp.lstat(file, { bigint: true });
        if (!(stat.isDirectory() || stat.isFile()) || !samePath(file, await fsp.realpath(file))) continue;
        if (stat.isDirectory()) pending.push(file);
        else if (stat.nlink === 1n) result.set(file, [stat.ino, stat.size, stat.mtimeNs].join(':'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return { entries: result, limited: scanned >= maxSampleEntries };
}

function cleanEnvironment(home) {
  const systemNames = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'lang', 'systemdrive']);
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => systemNames.has(key.toLowerCase())));
  return { ...env, CODEX_HOME: home, TEMP: home, TMP: home };
}

function createCodexActivity({ onUpdate, pollIntervalMs = 400, disconnectMs = 120000 } = {}) {
  const active = new Map();
  let closed = false;
  let assessment;

  function publish(run, event, status) {
    const at = new Date().toISOString();
    run.record.updatedAt = at;
    if (status) run.record.status = status;
    if (event) run.record.events = [...run.record.events.slice(-149), { at, ...event }];
    onUpdate?.(structuredClone(run.record));
  }

  function start(payload, mode) {
    const at = new Date().toISOString();
    const run = { record: {
      id: randomUUID(), projectId: payload.projectId, taskId: payload.taskId || '',
      mode, status: 'connecting', startedAt: at, updatedAt: at, events: []
    } };
    active.set(run.record.id, run);
    try {
      publish(run, { source: 'workbench', kind: mode === 'fixture' ? 'fixture_started' : 'attachment_started' });
    } catch (error) {
      active.delete(run.record.id);
      throw error;
    }
    return run;
  }

  function finish(run, status, kind) {
    if (!active.delete(run.record.id)) return;
    clearTimeout(run.timer);
    clearTimeout(run.deadline);
    try {
      publish(run, { source: 'workbench', kind }, status);
    } catch {
      // The canonical store owns its write errors and remains the durable source.
    }
  }

  async function inspectCli() {
    const executable = await locateCli();
    if (!executable) return { available: false, code: 'cli_missing' };
    let room;
    try {
      room = await fsp.mkdtemp(path.join(os.tmpdir(), 'rw-codex-probe-'));
      const options = { cwd: room, env: cleanEnvironment(room), timeout: 4000, maxBuffer: 128 * 1024, windowsHide: true, shell: false };
      const [version, execHelp, serverHelp] = await Promise.all([
        inspect(executable, ['--version'], options),
        inspect(executable, ['exec', '--help'], options),
        inspect(executable, ['app-server', '--help'], options)
      ]);
      const match = /codex(?:-cli)?\s+([0-9][\da-z.+-]*)/i.exec(version.stdout);
      if (!match) return { available: false, code: 'unexpected_cli' };
      return {
        available: true, executable, version: match[1],
        execJson: execHelp.stdout.includes('--json'),
        ephemeral: execHelp.stdout.includes('--ephemeral'),
        appServer: serverHelp.stdout.includes('stdio')
      };
    } catch {
      return { available: false, code: 'cli_probe_failed' };
    } finally {
      if (room) await fsp.rm(room, { recursive: true, force: true }).catch(() => {});
    }
  }

  function probe() {
    assessment ||= inspectCli();
    return assessment;
  }

  async function capabilities() {
    const { executable, ...status } = await probe();
    return { ok: true, ...status, attachJsonl: true, fixtureMode: 'offline_app_server' };
  }

  function observeRun(run, event) {
    const terminal = event.kind === 'turn_completed' ? 'completed' : event.kind === 'turn_failed' ? 'failed' : '';
    const status = terminal ? undefined : 'running';
    publish(run, event, status);
    if (terminal) run.terminal = terminal;
  }

  async function attach(payload) {
    if (closed || !validContext(payload)) return { ok: false, code: 'invalid_context', error: '项目或任务已失效' };
    if (active.size >= 8) return { ok: false, code: 'activity_limit', error: '请先结束一项活动' };
    let origin;
    try { origin = await safeLog(payload.eventFile); } catch {
      return { ok: false, code: 'invalid_event_file', error: '请选择本机常规 Codex JSONL 文件（最大 32 MiB）' };
    }
    if (closed || active.size >= 8) return { ok: false, code: 'activity_limit', error: '请先结束一项活动' };
    if ([...active.values()].some(run => run.eventFile && samePath(run.eventFile, origin.file))) {
      return { ok: false, code: 'already_attached', error: '该事件流已接入' };
    }
    const run = start(payload, 'external');
    run.eventFile = origin.file;
    const parse = jsonLines(line => {
      if (run.terminal) return;
      const event = parseExecEvent(line);
      if (event) observeRun(run, event);
    });
    let offset = 0;
    let lastDataAt = Date.now();
    let previousSample;
    let nextSampleAt = 0;
    let observe = typeof payload.observedRoot === 'string' && path.isAbsolute(payload.observedRoot);
    async function poll() {
      if (!active.has(run.record.id)) return;
      try {
        const { stat } = await safeLog(origin.file);
        if (stat.dev !== origin.stat.dev || stat.ino !== origin.stat.ino || stat.size < BigInt(offset)) {
          finish(run, 'disconnected', 'stream_replaced');
          return;
        }
        if (stat.size > BigInt(offset)) {
          const file = await fsp.open(origin.file, 'r');
          try {
            const current = await file.stat({ bigint: true });
            if (current.dev !== origin.stat.dev || current.ino !== origin.stat.ino) {
              finish(run, 'disconnected', 'stream_replaced');
              return;
            }
            const chunk = Buffer.alloc(Math.min(65536, Number(current.size) - offset));
            const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
            offset += bytesRead;
            if (bytesRead && active.has(run.record.id)) {
              lastDataAt = Date.now();
              parse(chunk.subarray(0, bytesRead));
            }
          } finally {
            await file.close();
          }
        } else if (Date.now() - lastDataAt > disconnectMs) {
          finish(run, 'disconnected', 'stream_idle');
          return;
        }
        if (observe && Date.now() >= nextSampleAt) {
          try {
            const sample = await sampleFiles(payload.observedRoot, origin.file);
            if (!active.has(run.record.id)) return;
            if (sample.limited) {
              publish(run, { source: 'workbench', kind: 'file_observation_limit' });
              observe = false;
            } else if (previousSample) {
              const keys = new Set([...previousSample.keys(), ...sample.entries.keys()]);
              let differences = 0;
              for (const key of keys) if (previousSample.get(key) !== sample.entries.get(key)) differences++;
              if (differences) publish(run, { source: 'filesystem', kind: 'file_changes_inferred', count: differences });
            }
            previousSample = sample.entries;
          } catch {
            if (active.has(run.record.id)) publish(run, { source: 'workbench', kind: 'file_observation_unavailable' });
            observe = false;
          }
          nextSampleAt = Date.now() + Math.max(1500, pollIntervalMs);
        }
        if (run.terminal) finish(run, run.terminal, 'stream_finished');
      } catch {
        finish(run, 'disconnected', 'stream_read_failed');
      } finally {
        if (active.has(run.record.id)) run.timer = setTimeout(poll, pollIntervalMs);
      }
    }
    run.timer = setTimeout(poll, 0);
    return { ok: true, runId: run.record.id };
  }

  async function startFixture(payload) {
    if (closed || !validContext(payload)) return { ok: false, code: 'invalid_context', error: '项目或任务已失效' };
    const cli = await probe();
    if (!cli.available || !cli.appServer) return { ok: false, code: cli.code || 'app_server_unavailable', error: '本机 Codex CLI 的离线诊断不可用' };
    if (closed || active.size >= 8) return { ok: false, code: 'activity_limit', error: '请先结束一项活动' };
    const room = await fsp.mkdtemp(path.join(os.tmpdir(), 'rw-codex-fixture-'));
    let run;
    try {
      if (closed || active.size >= 8) return { ok: false, code: 'activity_limit', error: '请先结束一项活动' };
      run = start(payload, 'fixture');
      const child = spawn(cli.executable, ['-a', 'on-request', 'app-server', '--listen', 'stdio://'], {
        cwd: room, env: cleanEnvironment(room), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
      });
      run.child = child;
      let initialized = false;
      const send = message => child.stdin.write(JSON.stringify(message) + '\n');
      child.stdin.on('error', () => {});
      child.stdout.on('data', jsonLines(line => {
        if (!active.has(run.record.id) || initialized || run.record.status === 'cancelling') return;
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message?.id !== 1 || !message.result || message.error) return;
        initialized = true;
        try {
          publish(run, { source: 'codex', kind: 'app_server_initialized' }, 'running');
        } catch {
          child.kill();
          finish(run, 'failed', 'activity_store_failed');
          return;
        }
        send({ jsonrpc: '2.0', method: 'initialized' });
        child.stdin.end();
      }));
      child.on('error', () => finish(run, 'failed', 'fixture_launch_failed'));
      child.on('close', code => {
        if (run.timedOut) finish(run, 'disconnected', 'fixture_timeout');
        else if (run.record.status === 'cancelling') finish(run, 'cancelled', 'owned_process_terminated');
        else if (initialized && code === 0) finish(run, 'completed', 'fixture_finished');
        else finish(run, 'failed', 'fixture_exited');
        fsp.rm(room, { recursive: true, force: true }).catch(() => {});
      });
      run.deadline = setTimeout(() => {
        run.timedOut = true;
        if (!child.kill()) finish(run, 'disconnected', 'fixture_timeout');
      }, 10000);
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        clientInfo: { name: 'research-workspace-fixture', version: '4.0.0' }
      } });
      return { ok: true, runId: run.record.id };
    } catch {
      if (run) finish(run, 'failed', 'fixture_launch_failed');
      return { ok: false, code: 'fixture_launch_failed', error: 'Codex 离线诊断未能启动' };
    } finally {
      if (!run?.child) await fsp.rm(room, { recursive: true, force: true }).catch(() => {});
    }
  }

  function cancel(id) {
    const run = active.get(id);
    if (!run) return { ok: false, code: 'run_inactive', error: '活动已经结束或断开' };
    if (!run.child) {
      finish(run, 'disconnected', 'user_detached');
      return { ok: true, status: 'disconnected' };
    }
    if (run.record.status === 'cancelling') return { ok: true, status: 'cancelling' };
    publish(run, { source: 'workbench', kind: 'cancel_requested' }, 'cancelling');
    if (!run.child.kill()) {
      finish(run, 'disconnected', 'fixture_process_unavailable');
      return { ok: true, status: 'disconnected' };
    }
    return { ok: true, status: 'cancelling' };
  }

  function dispose() {
    closed = true;
    for (const run of active.values()) {
      run.child?.kill();
      finish(run, 'disconnected', 'workbench_closed');
    }
  }

  return { capabilities, attach, startFixture, cancel, dispose };
}

module.exports = { createCodexActivity, parseExecEvent };
