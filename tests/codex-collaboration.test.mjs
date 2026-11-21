import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import adapter from '../desktop/codex-collaboration.js';

const t0 = 1795210000;

function setup(t) {
  const room = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rw-codex-collab-')));
  t.after(() => fs.rmSync(room, { recursive: true, force: true }));
  const project = path.join(room, 'research');
  const other = path.join(room, 'other');
  const nested = path.join(project, 'tools');
  for (const dir of [project, other, nested]) fs.mkdirSync(dir);
  const threads = [
    { id: 'session-1', cwd: project, updatedAt: t0, status: { type: 'notLoaded' }, turns: [
      { id: 'old-turn', startedAt: t0 - 20, status: 'completed', items: [] },
      { id: 'turn-1', startedAt: t0, status: 'inProgress', items: [] }
    ] },
    { id: 'session-2', cwd: project, updatedAt: t0, status: { type: 'idle' }, turns: [] },
    { id: 'foreign', cwd: other, updatedAt: t0, name: 'private other session', turns: [] },
    { id: 'skill', cwd: nested, updatedAt: t0, turns: [] }
  ];
  let online = true;
  const calls = [];
  let changes = 0;
  const file = path.join(room, 'codex-runs.json');
  const workspace = {
    projects: [{ id: 'p' }, { id: 'q' }, { id: 'unbound' }, { id: 'protected' }],
    tasks: [{ id: 't', p: 'p' }, { id: 'alternate', p: 'p' }, { id: 't2', p: 'q' }]
  };
  const options = {
    file, readWorkspace: () => workspace,
    resolveProject: id => ({p: {root: project}, q: {root: other}, protected: {root: other, metadataOnly: true}}[id]),
    onChange: () => changes++,
    pollIntervalMs: 15,
    sessionsDirectory: '',
    connect: () => ({
      close() {},
      async request(method, params) {
        calls.push({ method, params });
        if (!online) throw new Error('native pipe lost');
        if (method === 'thread/list') return { data: threads }; // Require adapter to enforce scope itself.
        if (method === 'thread/read') return { thread: threads.find(thread => thread.id === params.threadId) };
        throw new Error('unexpected method');
      }
    })
  };
  const service = adapter.createCodexCollaboration({ ...options, pollIntervalMs: 60000 });
  t.after(() => service.close());
  return {
    service, file, threads, project, other, options, calls, workspace, changes: () => changes,
    setOnline: value => { online = value; }
  };
}

const match = { projectId: 'p', taskId: 't', sessionId: 'session-1' };

test('scoped discovery and binding reject wrong projects, repository subfolders and duplicate registration', async t => {
  const { service, calls, project } = setup(t);
  const status = await service.capabilities();
  assert.equal(status.available, true);
  assert.equal(status.liveEvents, false);
  assert.equal((await service.discover({ projectId: 'unbound' })).code, 'ineligible_project');
  assert.equal((await service.discover({ projectId: 'protected' })).code, 'ineligible_project');
  const found = await service.discover({ projectId: 'p' });
  assert.deepEqual(found.sessions.map(row => row.sessionId), ['session-1', 'session-2']);
  assert.ok(calls.some(call => call.method === 'thread/list' && call.params.cwd === project));
  assert.equal((await service.bind({ ...match, sessionId: 'foreign' })).code, 'unmatched_session');
  assert.equal((await service.bind({ ...match, sessionId: 'skill' })).code, 'unmatched_session');
  assert.equal((await service.bind({ ...match, taskId: 't2' })).code, 'invalid_binding');
  const [first, second] = await Promise.all([service.bind(match), service.bind(match)]);
  assert.equal(first.run.status, 'running');
  assert.equal(second.run.id, first.run.id);
  assert.equal((await service.bind({ ...match, taskId: 'alternate' })).code, 'already_bound');
  assert.deepEqual((await service.discover({ projectId: 'p' })).sessions.map(row => row.sessionId), ['session-2']);
  assert.equal(service.list().runs.length, 1);
  assert.equal(first.run.events.length, 1);
});

test('project evidence has structured provenance and never includes raw content or out-of-scope paths', async t => {
  const { service, threads, file, project, other, workspace } = setup(t);
  await service.bind(match);
  const turn = threads[0].turns[1];
  const target = path.join(project, 'report.md');
  const linked = path.join(project, 'linked.md');
  const foreign = path.join(other, 'foreign.txt');
  fs.writeFileSync(target, 'synthetic result');
  fs.writeFileSync(foreign, 'synthetic other');
  fs.linkSync(foreign, linked);
  turn.items = [
    { type: 'agentMessage', id: 'message', text: 'secret prompt and false completion claim' },
    { type: 'fileChange', id: 'denied', status: 'failed', changes: [
      { path: 'denied.md', kind: {type: 'add'}, diff: 'unavailable attempt' }
    ] },
    { type: 'fileChange', id: 'patch', status: 'completed', changes: [
      { path: target, kind: {type: 'add'}, diff: 'private raw diff payload' },
      { path: 'old.md', kind: {type: 'delete'}, diff: 'private raw diff payload' },
      { path: 'sub/../traversal.md', kind: {type: 'add'} },
      { path: foreign, kind: {type: 'add'} },
      { path: linked, kind: {type: 'add'} },
      { path: '.env', kind: {type: 'add'} },
      { path: '00_Project_Management/TASKS.md', kind: {type: 'update'} },
      { path: 'report.md:secret-stream', kind: {type: 'add'} }
    ] },
    { type: 'commandExecution', id: 'test-01', command: 'node --test', status: 'completed', exitCode: 0, aggregatedOutput: 'private stdout', cwd: project },
    { type: 'commandExecution', id: 'echo', command: 'echo "pytest "', status: 'completed', exitCode: 0, cwd: project },
    { type: 'commandExecution', id: 'test-02', command: 'pytest', status: 'failed', exitCode: 2, cwd: project },
    { type: 'commandExecution', id: 'outside-test', command: 'npm test', status: 'completed', exitCode: 0, cwd: other }
  ];
  let run = (await service.refresh()).runs[0];
  assert.equal(run.status, 'running');
  assert.deepEqual(run.files.map(row => [row.path, row.kind, row.present]), [['report.md', 'added', true], ['old.md', 'deleted', false]]);
  assert.deepEqual(run.checks.map(row => [row.status, row.exitCode]), [['completed', 0], ['failed', 2]]);
  assert.ok(run.events.every(event => event.source === 'codex-app-server-snapshot' && event.id.length === 64));
  const saved = fs.readFileSync(file, 'utf8');
  for (const forbidden of ['secret prompt', 'private raw diff', 'private stdout', 'denied.md', 'foreign.txt', 'outside-test', project]) {
    assert.equal(saved.includes(forbidden), false, forbidden);
  }
  turn.status = 'completed';
  turn.completedAt = t0 + 2;
  run = (await service.refresh()).runs[0];
  assert.equal(run.status, 'completed');
  assert.equal(run.endedAt, new Date((t0 + 2) * 1000).toISOString());
  assert.deepEqual(workspace.tasks, [{id:'t',p:'p'}, {id:'alternate',p:'p'}, {id:'t2',p:'q'}]);
  assert.deepEqual((await service.refresh()).runs[0], run);
});

test('disconnect, restart and out-of-order history preserve the last observed outcome', async t => {
  const { service, file, threads, options, workspace, setOnline } = setup(t);
  await service.bind(match);
  await service.bind({ ...match, taskId: 'alternate', sessionId: 'session-2' });
  threads[0].status = { type: 'active', activeFlags: ['waitingOnApproval'] };
  assert.equal((await service.refresh()).runs[0].status, 'waiting');
  threads[0].turns[1].status = 'interrupted';
  assert.equal((await service.refresh()).runs[0].status, 'paused');
  threads[0].turns.push({ id: 'turn-2', startedAt: t0 + 20, completedAt: t0 + 21, status: 'completed', items: [] });
  assert.equal((await service.refresh()).runs[0].status, 'completed');
  threads[0].turns.reverse();
  assert.equal((await service.refresh()).runs[0].turnId, 'turn-2');
  const fullHistory = threads[0].turns;
  threads[0].turns = fullHistory.filter(row => row.id !== 'turn-2');
  assert.equal((await service.refresh()).runs[0].turnId, 'turn-2');
  threads[0].turns = fullHistory;
  setOnline(false);
  const disconnected = (await service.refresh()).runs;
  assert.deepEqual(disconnected.map(row => row.connection), ['unavailable', 'unavailable']);
  assert.equal(disconnected[0].status, 'completed');
  const originalIds = disconnected[0].events.map(row => row.id);
  service.close();
  const reopened = adapter.createCodexCollaboration({ ...options, pollIntervalMs: 60000 });
  t.after(() => reopened.close());
  assert.ok(reopened.list().runs.every(row => row.connection === 'stale'));
  setOnline(true);
  const recovered = (await reopened.refresh()).runs;
  assert.deepEqual(recovered[0].events.map(row => row.id), originalIds);
  workspace.tasks = workspace.tasks.filter(row => row.id !== 't');
  assert.equal((await reopened.refresh()).runs[0].connection, 'stale');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).runs.length, 2);
});

test('damaged history stays untouched and unapproved paths cannot start recording', async t => {
  const { service, file, options } = setup(t);
  service.close();
  fs.writeFileSync(file, 'truncated history');
  const damaged = adapter.createCodexCollaboration(options);
  t.after(() => damaged.close());
  assert.equal(damaged.list().code, 'invalid_history');
  assert.equal((await damaged.bind(match)).code, 'invalid_history');
  assert.equal(fs.readFileSync(file, 'utf8'), 'truncated history');
});

test('execution history cannot be loaded from or written through a linked path', async t => {
  const { service, file, options } = setup(t);
  service.close();
  const other = path.join(path.dirname(file), 'linked-source.json');
  const old = '{"version":1,"runs":[]}';
  fs.writeFileSync(other, old);
  fs.linkSync(other, file);
  const linked = adapter.createCodexCollaboration(options);
  t.after(() => linked.close());
  assert.equal(linked.list().code, 'invalid_history');
  assert.equal((await linked.bind(match)).code, 'invalid_history');
  assert.equal(fs.readFileSync(other, 'utf8'), old);
});

async function waitFor(predicate, label) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const result = await predicate();
    if (result) return result;
    await delay(20);
  }
  assert.fail(label);
}

test('native session-directory hints refresh concurrent pending scopes and a bound run before the periodic poll', async t => {
  const { service, file, options, project, other, threads } = setup(t);
  service.close();
  const directory = path.join(path.dirname(file), 'sessions');
  const nested = path.join(directory, '2026', '11', '21');
  fs.mkdirSync(nested, { recursive: true });
  const signals = [];
  const live = adapter.createCodexCollaboration({
    ...options, sessionsDirectory: directory, onChange: change => signals.push(change),
    pollIntervalMs: 60000, signalDelayMs: 15, settleDelayMs: 140
  });
  t.after(() => live.close());

  const [left, right] = await Promise.all([live.pending({ projectId: 'p' }), live.pending({ projectId: 'q' })]);
  assert.equal(left.notificationMode, 'filesystem-signal');
  assert.deepEqual(left.sessions.map(row => row.sessionId), ['session-1', 'session-2']);
  assert.deepEqual(right.sessions.map(row => row.sessionId), ['foreign']);
  assert.equal((await live.bind(match)).ok, true);
  signals.length = 0;

  threads.push({ id: 'new-left', cwd: project, updatedAt: t0 + 3 }, { id: 'new-right', cwd: other, updatedAt: t0 + 3 });
  threads[0].turns[1].status = 'completed';
  threads[0].turns[1].completedAt = t0 + 3;
  const fake = path.join(nested, 'ignored-rollout-name.jsonl');
  fs.writeFileSync(fake, 'Untrusted text does not become evidence.');

  await waitFor(() => ['p', 'q'].every(projectId => signals.some(change => change.kind === 'pending' && change.projectId === projectId)) &&
    signals.some(change => change.kind === 'runs'), 'native watcher triggered structured reads across scopes');
  const [latestLeft, latestRight] = await Promise.all([live.pending({ projectId: 'p' }), live.pending({ projectId: 'q' })]);
  assert.deepEqual(latestLeft.sessions.map(row => row.sessionId), ['new-left', 'session-2']);
  assert.deepEqual(latestRight.sessions.map(row => row.sessionId), ['new-right', 'foreign']);
  assert.equal(live.list().runs[0].status, 'completed');
  assert.equal(live.list().runs[0].files.length, 0);
  assert.equal(live.list().runs[0].events.some(row => row.label.includes('Untrusted')), false);
  assert.doesNotMatch(JSON.stringify(signals), /rollout|ignored|Untrusted/);
});

test('signals during a reconcile and an unavailable watcher keep updates recoverable', async t => {
  const { service, file, options, project, threads } = setup(t);
  service.close();
  const directory = path.join(path.dirname(file), 'sessions');
  fs.mkdirSync(directory);
  let callback;
  let watcher;
  let watching = true;
  let watchCalls = 0;
  let gate;
  let held;
  const connect = options.connect;
  const live = adapter.createCodexCollaboration({
    ...options, sessionsDirectory: directory, pollIntervalMs: 140,
    signalDelayMs: 5, settleDelayMs: 14,
    watchSessions(root, _options, handler) {
      assert.equal(root, directory);
      watchCalls++;
      if (!watching) throw new Error('native watcher unavailable');
      callback = handler;
      watcher = new EventEmitter();
      watcher.close = () => {};
      return watcher;
    },
    connect() {
      const client = connect();
      return {
        close: () => client.close(),
        async request(method, params) {
          if (method === 'thread/list' && gate) {
            const snapshot = structuredClone(await client.request(method, params));
            held = true;
            await gate.promise;
            gate = null;
            return snapshot;
          }
          return client.request(method, params);
        }
      };
    }
  });
  t.after(() => live.close());
  assert.equal((await live.pending({ projectId: 'p' })).notificationMode, 'filesystem-signal');
  let resume;
  gate = { promise: new Promise(resolve => { resume = resolve; }) };
  callback('change', 'ignored-name');
  await waitFor(() => held, 'first reconcile to start');
  threads.push({ id: 'late-project-session', cwd: project, updatedAt: t0 + 5 });
  callback('change', 'ignored-while-running');
  resume();
  await waitFor(async () => (await live.pending({ projectId: 'p' })).sessions.some(row => row.sessionId === 'late-project-session'),
    'notification while structured read was active to be reconciled');

  watching = false;
  watcher.emit('error', new Error('notifications stopped'));
  assert.equal((await live.pending({ projectId: 'p' })).notificationMode, 'reconcile-only');
  await delay(80);
  threads.push({ id: 'periodic-session', cwd: project, updatedAt: t0 + 7 });
  await waitFor(async () => (await live.pending({ projectId: 'p' })).sessions.some(row => row.sessionId === 'periodic-session'),
    'periodic reconciliation to recover without notification');
  watching = true;
  await waitFor(async () => (await live.pending({ projectId: 'p' })).notificationMode === 'filesystem-signal',
    'notification watcher to rearm');
  assert.ok(watchCalls >= 2);
});

test('discovers in-project sessions and projects only scoped names and relative working directories', async t => {
  const { service, file, options, project, other, threads, calls } = setup(t);
  service.close();
  const research = path.join(project, '模型', '校核');
  const innerProject = path.join(project, 'registered-child');
  const redirect = path.join(project, 'redirected-work');
  const deniedFolders = ['skills', '.codex', 'node_modules', '00_Project_Management']
    .map(name => path.join(project, name, 'work'));
  for (const target of [research, innerProject, ...deniedFolders]) fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(other, redirect, process.platform === 'win32' ? 'junction' : 'dir');
  threads.splice(0, threads.length,
    { id: 'root', cwd: project, updatedAt: t0 - 1 },
    { id: 'descendant', cwd: research, updatedAt: t0, name: '\u202E 模型\n校核\t一号 ', preview: 'must never return prompt preview' },
    { id: 'same-project-file', cwd: path.join(project, 'not-a-directory'), updatedAt: t0, name: 'must not disclose file' },
    { id: 'root-wrapper', cwd: path.dirname(project), updatedAt: t0, name: 'must not disclose wrapper' },
    { id: 'inner-project', cwd: innerProject, updatedAt: t0, name: 'must not disclose protected child' },
    { id: 'redirected', cwd: redirect, updatedAt: t0, name: 'must not disclose redirected work' },
    { id: 'traversal', cwd: research + path.sep + '..', updatedAt: t0, name: 'must not disclose traversal' },
    { id: 'other-project', cwd: other, updatedAt: t0, name: '另一个项目' },
    ...deniedFolders.map((cwd, index) => ({id: 'blocked-' + index, cwd, updatedAt: t0, name: 'must not disclose excluded directory'}))
  );
  fs.writeFileSync(path.join(project, 'not-a-directory'), 'synthetic data');
  const connect = options.connect;
  const live = adapter.createCodexCollaboration({
    ...options,
    resolveProject: id => ({
      root: id === 'p' ? project : other,
      registeredRoots: [innerProject, other, project]
    }),
    connect() {
      const client = connect();
      return {
        close: () => client.close(),
        async request(method, params) {
          const result = await client.request(method, params);
          if (method === 'thread/list' && params.cwd) {
            return { data: result.data.filter(thread => thread.cwd === params.cwd) };
          }
          return result;
        }
      };
    }
  });
  t.after(() => live.close());
  const [left, right] = await Promise.all([live.pending({ projectId: 'p' }), live.pending({ projectId: 'q' })]);
  assert.deepEqual(left.sessions, [
    {sessionId: 'descendant', updatedAt: new Date(t0 * 1000).toISOString(), status: 'unknown', directory: '模型/校核', name: '模型 校核 一号'},
    {sessionId: 'root', updatedAt: new Date((t0 - 1) * 1000).toISOString(), status: 'unknown', directory: '.'}
  ]);
  assert.deepEqual(right.sessions.map(row => row.sessionId), ['other-project']);
  const recent = calls.filter(call => call.method === 'thread/list' && !call.params.cwd);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].params.currentAccountOnly, true);
  assert.equal(recent[0].params.limit, 100);
  for (const offlimits of ['protected child', 'prompt preview', 'wrapper', 'redirected', 'not-a-directory', project]) {
    assert.equal(JSON.stringify(left).includes(offlimits), false, offlimits);
  }
  assert.equal((await live.bind({ ...match, sessionId: 'inner-project' })).code, 'unmatched_session');
});

test('descendant file and command evidence use the approved directory and stop at nested ownership boundaries', async t => {
  const { service, options, project, other, threads } = setup(t);
  service.close();
  const work = path.join(project, 'outputs');
  const ownedRunDir = path.join(work, 'step-a');
  const foreignProject = path.join(work, 'child-owner');
  for (const target of [work, ownedRunDir, foreignProject]) fs.mkdirSync(target, { recursive: true });
  const valid = path.join(work, 'created.md');
  const childFile = path.join(foreignProject, 'restricted.md');
  const link = path.join(work, 'linked-to-other');
  fs.writeFileSync(valid, 'synthetic report');
  fs.writeFileSync(childFile, 'other project file');
  fs.symlinkSync(other, link, process.platform === 'win32' ? 'junction' : 'dir');

  let registeredRoots = [project, other, foreignProject];
  const live = adapter.createCodexCollaboration({
    ...options, resolveProject: () => ({ root: project, registeredRoots })
  });
  t.after(() => live.close());
  const session = threads[0];
  session.cwd = work;
  const first = await live.bind(match);
  assert.equal(first.ok, true);
  assert.equal(first.run.directory, 'outputs');

  session.turns[1].items = [
    {type:'fileChange', id:'project-patch', status:'completed', changes: [
      {path:'created.md', kind:{type:'add'}},
      {path:'child-owner/restricted.md', kind:{type:'update'}},
      {path:'../outside.md', kind:{type:'add'}},
      {path:'linked-to-other/nonexistent.md', kind:{type:'add'}}
    ]},
    {type:'fileChange', id:'foreign-patch', status:'completed', changes: [
      {path:childFile, kind:{type:'update'}}
    ]},
    {type:'commandExecution', id:'owned-check', cwd:ownedRunDir, command:'node --test', status:'completed', exitCode:0},
    {type:'commandExecution', id:'child-check', cwd:foreignProject, command:'node --test', status:'completed', exitCode:1}
  ];
  let result = (await live.refresh()).runs[0];
  assert.deepEqual(result.files.map(row => row.path), ['outputs/created.md']);
  assert.deepEqual(result.checks.map(row => row.exitCode), [0]);
  assert.equal(result.events.filter(row => row.kind === 'file_change').length, 1);
  assert.doesNotMatch(JSON.stringify(result), /restricted\.md|child-owner|outside\.md|linked-to-other/);

  // A session relocating within the project does not rebase the previously approved relative paths.
  session.cwd = ownedRunDir;
  result = (await live.refresh()).runs[0];
  assert.equal(result.connection, 'stale');
  assert.equal(result.directory, undefined);
  assert.deepEqual(result.files, []);
  assert.equal((await live.bind(match)).code, 'unmatched_session');
  session.cwd = work;
  result = (await live.refresh()).runs[0];
  assert.equal(result.directory, 'outputs');
  assert.equal(result.connection, 'snapshot');

  // The same physical directory can subsequently become another project's registered scope.
  registeredRoots = [...registeredRoots, work];
  result = (await live.refresh()).runs[0];
  assert.equal(result.connection, 'stale');
  assert.equal(result.directory, undefined);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.checks, []);
});

test('relocated Codex home supplies a canonical watch root while a redirected sessions child is refused', async t => {
  const { project, other, options } = setup(t);
  const home = path.join(project, 'real-codex-home');
  const alias = path.join(project, 'configured-codex-home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(home, 'sessions'));
  fs.symlinkSync(home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const previous = process.env.CODEX_HOME;
  let service;
  try {
    process.env.CODEX_HOME = alias;
    service = adapter.createCodexCollaboration({ ...options, sessionsDirectory: undefined,
      watchSessions(directory) {
        assert.equal(directory, path.join(home, 'sessions'));
        const watcher = new EventEmitter();
        watcher.close = () => {};
        return watcher;
      }
    });
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
  t.after(() => service.close());
  assert.equal((await service.capabilities()).notificationMode, 'filesystem-signal');

  const redirectedHome = path.join(project, 'redirected-codex-home');
  fs.mkdirSync(redirectedHome);
  const redirected = path.join(redirectedHome, 'sessions');
  fs.symlinkSync(other, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  const rejected = adapter.createCodexCollaboration({ ...options, sessionsDirectory: redirected,
    watchSessions() { assert.fail('the sessions junction must never be watched'); } });
  t.after(() => rejected.close());
  assert.equal((await rejected.capabilities()).notificationMode, 'reconcile-only');
});
