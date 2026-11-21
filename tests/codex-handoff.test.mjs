import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import handoff from '../desktop/codex-handoff.js';

const root = path.join(os.tmpdir(), 'synthetic-rpm-project');
const workspace = {
  projects: [{ id: 'estuary', name: '河口观测', stage: '复核' }],
  tasks: [
    { id: 'task-1', p: 'estuary', t: '复核观测记录', description: '核对测量范围',
      acceptance: '保留原始文件', codexReferences: 'file:abc node:def file:abc ../not-a-reference' },
    { id: 'task-2', p: 'other', t: '另一个项目的任务' }
  ]
};

test('handoff copies canonical task context with no command or file execution', async () => {
  const reply = await handoff.createHandoff({
    context: { projectId: 'estuary', taskId: 'task-1', root: os.homedir(), command: 'untrusted command' },
    readWorkspace: () => workspace, resolveProject: async () => ({ root }),
    resolveReferences: async () => new Set(['file:abc', 'node:def'])
  });
  assert.equal(reply.ok, true);
  for (const value of [root, 'task-1', '复核观测记录', '核对测量范围', '保留原始文件', 'file:abc、node:def']) {
    assert.ok(reply.text.includes(value), value);
  }
  assert.ok(!reply.text.includes('untrusted command'));
  assert.ok(!reply.text.includes('../not-a-reference'));
});

test('handoff refuses mismatched tasks and metadata-only or unbound project roots', async () => {
  const request = { context: { projectId: 'estuary', taskId: 'task-2' }, readWorkspace: () => workspace };
  const mismatch = await handoff.createHandoff({
    ...request, resolveProject: () => { throw new Error('must reject before resolving'); }
  });
  assert.equal(mismatch.code, 'invalid_context');
  for (const project of [null, { root, metadataOnly: true }, { root: 'relative-path' }]) {
    const reply = await handoff.createHandoff({
      ...request, context: { projectId: 'estuary', taskId: 'task-1' }, resolveProject: async () => project
    });
    assert.equal(reply.code, 'unbound_project');
  }
});
