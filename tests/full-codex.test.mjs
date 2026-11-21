import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import codex from '../desktop/full-codex.js';

const { createCodexActivity, parseExecEvent } = codex;

async function fixture(t, options) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'rw-codex-test-')));
  const updates = [];
  const activity = createCodexActivity({ pollIntervalMs: 35, ...options, onUpdate: record => updates.push(record) });
  t.after(async () => {
    activity.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, updates, activity };
}

async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(25);
  }
  assert.fail('Codex activity did not reach the expected state');
}

const line = (type, data = {}) => JSON.stringify({ type, ...data }) + '\n';

test('Codex JSONL normalization keeps only allowed event kinds and a bounded file count', () => {
  const details = { id: 'private-id', type: 'file_change', changes: [{ path: 'private-path', kind: 'update' }], text: 'private-content' };
  assert.deepEqual(parseExecEvent(line('item.completed', { item: details })), {
    source: 'codex', kind: 'file_change_completed', count: 1
  });
  assert.equal(parseExecEvent(line('item.completed', { item: { type: '__proto__' } })), null);
  assert.equal(parseExecEvent(line('run.spoofed_success')), null);
  assert.equal(parseExecEvent('{partial'), null);
});

test('attachment follows live appends and keeps reported events distinct from observed file metadata', { timeout: 10000 }, async t => {
  const { root, updates, activity } = await fixture(t);
  const logfile = path.join(root, 'synthetic-exec.jsonl');
  const file = path.join(root, 'synthetic-note.md');
  await fs.writeFile(file, 'fixture before');
  await fs.writeFile(logfile, line('thread.started') + line('turn.started'));
  const attached = await activity.attach({ projectId: 'fixture-project', taskId: 'fixture-task', eventFile: logfile, observedRoot: root });
  assert.equal(attached.ok, true);
  await until(() => updates.at(-1)?.events.some(event => event.kind === 'turn_started'));
  assert.equal(updates.at(-1).status, 'running');
  assert.equal((await activity.attach({ projectId: 'fixture-project', eventFile: logfile })).code, 'already_attached');
  await delay(150);
  await fs.appendFile(file, '\nfixture after');
  const reported = line('item.completed', { item: { type: 'file_change', changes: [{ path: file }], text: 'private synthetic message' } });
  await fs.appendFile(logfile, reported.slice(0, -2));
  await delay(120);
  assert.equal(updates.at(-1).events.some(event => event.kind === 'file_change_completed'), false);
  await fs.appendFile(logfile, reported.slice(-2));
  await until(() => updates.at(-1)?.events.some(event => event.kind === 'file_changes_inferred'));
  await fs.appendFile(logfile, line('turn.completed'));
  const completed = await until(() => updates.at(-1)?.status === 'completed' && updates.at(-1));
  assert.equal(completed.id, attached.runId);
  assert.equal(completed.projectId, 'fixture-project');
  assert.equal(completed.taskId, 'fixture-task');
  assert.equal(completed.events.find(event => event.kind === 'file_change_completed').source, 'codex');
  assert.equal(completed.events.find(event => event.kind === 'file_changes_inferred').source, 'filesystem');
  assert.equal(completed.events.find(event => event.kind === 'file_changes_inferred').count, 1);
  assert.doesNotMatch(JSON.stringify(completed), /private synthetic message|synthetic-note|synthetic-exec/);
});

test('an idle or detached external stream stays distinguishable from cancelling an owned process', async t => {
  const { root, updates, activity } = await fixture(t, { disconnectMs: 120 });
  const logfile = path.join(root, 'synthetic-exec.jsonl');
  await fs.writeFile(logfile, line('turn.started'));
  await activity.attach({ projectId: 'fixture-project', eventFile: logfile });
  await until(() => updates.at(-1)?.events.at(-1).kind === 'stream_idle');
  assert.equal(updates.at(-1).status, 'disconnected');
  const second = await activity.attach({ projectId: 'fixture-project', eventFile: logfile });
  assert.deepEqual(activity.cancel(second.runId), { ok: true, status: 'disconnected' });
  assert.equal(updates.at(-1).events.at(-1).kind, 'user_detached');
  assert.equal(await fs.readFile(logfile, 'utf8'), line('turn.started'));
});

test('rejects credential-shaped inputs and safely disconnects when a capture is replaced', async t => {
  const { root, updates, activity } = await fixture(t);
  const logfile = path.join(root, 'synthetic-exec.jsonl');
  await fs.writeFile(logfile, line('turn.started'));
  const authName = path.join(root, 'auth.jsonl');
  assert.equal((await activity.attach({ projectId: 'fixture-project', eventFile: authName })).code, 'invalid_event_file');
  assert.equal((await activity.attach({ projectId: 'fixture-project', eventFile: 'relative.jsonl' })).code, 'invalid_event_file');
  await activity.attach({ projectId: 'fixture-project', eventFile: logfile });
  await until(() => updates.at(-1)?.status === 'running');
  await fs.rename(logfile, path.join(root, 'old.jsonl'));
  await fs.writeFile(logfile, line('turn.completed'));
  await until(() => updates.at(-1)?.status === 'disconnected');
  assert.ok(['stream_replaced', 'stream_read_failed'].includes(updates.at(-1).events.at(-1).kind));
});

test('installed Codex accepts bounded offline App Server handshake and owned cancellation', { timeout: 16000 }, async t => {
  const { updates, activity } = await fixture(t);
  const capabilities = await activity.capabilities();
  if (!capabilities.available || !capabilities.appServer) {
    t.skip(capabilities.code || 'installed CLI lacks stdio App Server');
    return;
  }
  assert.match(capabilities.version, /^\d+\.\d+/);
  assert.equal(capabilities.fixtureMode, 'offline_app_server');
  const first = await activity.startFixture({ projectId: 'fixture-project', taskId: 'fixture-task' });
  assert.equal(first.ok, true);
  const finished = await until(() => updates.find(row => row.id === first.runId && row.status === 'completed'), 12000);
  assert.equal(finished.mode, 'fixture');
  assert.equal(finished.projectId, 'fixture-project');
  assert.equal(finished.taskId, 'fixture-task');
  assert.deepEqual(finished.events.map(event => event.kind), ['fixture_started', 'app_server_initialized', 'fixture_finished']);
  const second = await activity.startFixture({ projectId: 'fixture-project' });
  assert.equal(second.ok, true);
  assert.deepEqual(activity.cancel(second.runId), { ok: true, status: 'cancelling' });
  const cancelled = await until(() => updates.find(row => row.id === second.runId && row.status === 'cancelled'));
  assert.equal(cancelled.events.at(-1).kind, 'owned_process_terminated');
});
