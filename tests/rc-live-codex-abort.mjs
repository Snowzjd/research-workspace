import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import adapter from '../desktop/codex-collaboration.js';

const [executable, fixtureFile, historyFile, mode] = process.argv.slice(2);
assert.ok(path.isAbsolute(executable) && path.isAbsolute(fixtureFile) && path.isAbsolute(historyFile));
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const cwd = fs.realpathSync.native(fixture.directory);
assert.ok(path.basename(path.dirname(cwd)) === '07_Results_and_Analysis' && path.basename(cwd) === 'rc-sensor');
assert.ok(!fs.existsSync(historyFile), 'Use a fresh isolated history path');
const projectId = 'fixture-abort';
const taskId = 'fixture-task';
const service = adapter.createCodexCollaboration({
  file: historyFile,
  readWorkspace: () => ({ projects: [{ id: projectId }], tasks: [{ id: taskId, p: projectId }] }),
  resolveProject: async () => ({ root: cwd, registeredRoots: [cwd] })
});
const resume = mode === 'resume';
let previous;
if (resume) {
  const binding = await service.bind({ projectId, taskId, sessionId: fixture.inboundSession });
  assert.ok(binding.ok, binding.code);
  previous = binding.run;
}
const actor = spawn(executable, [
  'exec', '--ignore-user-config', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'respect_system_proxy',
  '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', cwd,
  ...(resume ? ['resume', '--json', fixture.inboundSession, '-'] : ['--json', '-'])
], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
const exited = once(actor, 'close');
let sessionId = resume ? fixture.inboundSession : '';
let started = false;
let completed = false;
let buffer = '';
actor.stdout.setEncoding('utf8').on('data', chunk => {
  const lines = (buffer + chunk).split('\n');
  buffer = lines.pop();
  for (const line of lines.filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'thread.started') sessionId = event.thread_id;
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'turn.started') {
      started = true;
      actor.kill();
    }
  }
});
actor.stdin.on('error', () => {});
actor.stdin.end('This disposable test observes forced termination. Without tools or files, think about how to explain 50 distinct generic numerical checks.');
const deadline = setTimeout(() => actor.kill(), 60000);
try {
  await exited;
  assert.ok(started && sessionId && !completed, 'Terminate only the test actor after its real turn starts');
  if (resume) {
    const result = await service.refresh({ projectId, taskId });
    const observed = result.runs[0];
    assert.equal(observed.id, previous.id);
    assert.equal(observed.sessionId, previous.sessionId);
    assert.deepEqual(observed.files, previous.files);
    assert.deepEqual(observed.checks, previous.checks);
    if (observed.turnId !== previous.turnId) assert.ok(!['completed', 'failed'].includes(observed.status));
    console.log(JSON.stringify({ forcedTermination: true, before: previous.status, after: observed.status,
      priorEvidencePreserved: true, newFalseTerminalState: false, sameBinding: true }));
  } else {
    let discovered;
    for (let step = 0; step < 5 && !discovered; step++) {
      const pending = await service.discover({ projectId });
      discovered = pending.ok && pending.sessions.some(row => row.sessionId === sessionId);
      if (!discovered) await wait(1000);
    }
    assert.ok(discovered, 'The aborted real session remains discoverable');
    const bound = await service.bind({ projectId, taskId, sessionId });
    assert.ok(bound.ok, bound.code);
    const observed = (await service.refresh({ projectId, taskId })).runs[0];
    assert.ok(!['completed', 'failed'].includes(observed.status));
    assert.deepEqual(observed.files, []);
    assert.deepEqual(observed.checks, []);
    console.log(JSON.stringify({ forcedTermination: true, autoDiscovered: true, recordedStatus: observed.status,
      falseResult: false, files: 0, tests: 0 }));
  }
} finally { clearTimeout(deadline); service.close(); }
