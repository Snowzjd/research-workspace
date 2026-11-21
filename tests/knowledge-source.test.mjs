/**
 * 知识网络数据层：字段保留、稳定 ID、条件刷新、方法语境中立。
 * 运行：node --test tests/knowledge-source.test.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const KS = require('../assets/js/knowledge-source.js');

const PID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PID2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NID = 'cccccccccccccccccccccccccccccccc';
const MID = 'dddddddddddddddddddddddddddddddd';
const EID = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const FID = 'ffffffffffffffffffffffffffffffff';
const REV1 = 'a'.repeat(64);
const REV2 = 'b'.repeat(64);

function snapshot(overrides = {}) {
  return Object.assign({
    ok: true,
    schema_version: 1,
    revision: REV1,
    generated_at: '2026-11-19T00:00:00+08:00',
    data_updated_at: '2026-11-19T00:00:00+08:00',
    not_modified: false,
    scope: null,
    registry_complete: true,
    projects: [{
      id: PID, title: '合成甲', root: 'C:/tmp/a', types: ['Research'],
      direction: '方向甲', status: '进行中', stage: '第一阶段',
      description: '描述', status_note: '', tasks: [{ id: 't1', title: '任务一', status: 'doing', depends_on: [] }],
      changes: [], change_log_markdown: '', files: [FID], deliverables: [],
      file_summary: { total: 1, openable: 1, by_presence: {}, by_status: {} }
    }],
    files: [{
      id: FID, file_id: FID, project_id: PID, name: '方案 #1.md', relative_path: '01_Planning/方案 #1.md',
      status: 'Working', presence: 'present', openable: true, absolute_path: 'C:/tmp/a/01_Planning/方案 #1.md',
      href: 'file:///C:/tmp/a/01_Planning/%E6%96%B9%E6%A1%88%20%231.md', index_related_files: '', related_file_ids: []
    }],
    nodes: [{
      id: NID, type: 'method', title: '分段重复性判定', project_id: PID, project_ids: [PID],
      description: '私有方法', status: 'documented', source_files: [],
      claims: [{
        project_id: PID, local_id: 'm1', description: '私有方法', status: 'documented',
        usage_context: 'registered_method', method_usage: null, status_origin: 'descriptor',
        source_files: [{
          id: FID, file_id: FID, rpm_source_id: FID, title: '方案 #1.md', project_id: PID,
          path: 'C:/tmp/a/01_Planning/方案 #1.md', relative_path: '01_Planning/方案 #1.md',
          href: 'file:///C:/tmp/a/x', status: 'Working', evidence: '登记', origin: 'indexed_file'
        }]
      }]
    }, {
      id: PID, type: 'project', title: '合成甲', project_id: PID, project_ids: [PID],
      description: '描述', status: 'declared', source_files: []
    }],
    edges: [{
      id: EID, source: PID, target: NID, relation_type: 'membership', origin: 'project_membership',
      evidence: '项目归属', evidence_items: ['项目归属'], evidence_sources: [],
      project_id: PID, project_ids: [PID]
    }],
    issues: []
  }, overrides);
}

test('indexSnapshot keeps schema fields and original IDs', () => {
  const indexed = KS.indexSnapshot(snapshot());
  assert.equal(indexed.nodes[0].id, NID);
  assert.equal(indexed.edges[0].id, EID);
  assert.equal(indexed.files[0].id, FID);
  assert.equal(indexed.projects[0].id, PID);
  assert.equal(indexed.nodeMap.get(NID).claims[0].method_usage, null);
});

test('duplicate IDs are rejected', () => {
  const raw = snapshot();
  raw.nodes.push(Object.assign({}, raw.nodes[0]));
  assert.throws(() => KS.indexSnapshot(raw), /重复 ID/);
});

test('method_usage null stays undetermined and is not adopted', () => {
  assert.equal(KS.methodUsageLabel(null), '未确定');
  assert.equal(KS.methodUsageLabel(undefined), '未确定');
  assert.equal(KS.methodUsageLabel(''), '未确定');
  assert.equal(KS.isAdopted(null), false);
  assert.equal(KS.isAdopted('adopted'), true);
  assert.equal(KS.isAdopted('historical_candidate'), false);
  assert.equal(KS.methodUsageLabel('historical_candidate'), '历史候选');
});

test('tasks are identified by project_id plus task.id', () => {
  assert.equal(KS.taskKey(PID, 't1'), PID + '::t1');
  assert.notEqual(KS.taskKey(PID, 't1'), KS.taskKey(PID2, 't1'));
});

test('store keeps graph on not_modified and replaces atomically on new revision', async () => {
  let calls = 0;
  const first = snapshot();
  const second = snapshot({
    revision: REV2,
    projects: [Object.assign({}, first.projects[0], {
      stage: '第二阶段',
      tasks: [{ id: 't1', title: '任务一', status: 'done', depends_on: [] }]
    })]
  });
  // withdraw membership? keep same edge id, add a research edge then drop it later
  const store = KS.createStore(async ({ ifRevision }) => {
    calls += 1;
    if (calls === 1) return first;
    if (ifRevision === REV1) return { ok: true, schema_version: 1, revision: REV1, generated_at: first.generated_at, data_updated_at: first.data_updated_at, not_modified: true, scope: null, registry_complete: true };
    if (calls >= 3) return second;
    return first;
  });
  const a = await store.load({ force: true });
  assert.equal(a.ok, true);
  assert.equal(a.not_modified, false);
  assert.equal(a.revision, REV1);
  const b = await store.load();
  assert.equal(b.not_modified, true);
  assert.equal(b.indexed.nodeMap.get(NID).id, NID);
  const c = await store.load({ force: true });
  assert.equal(c.not_modified, false);
  assert.equal(c.revision, REV2);
  assert.equal(c.indexed.projectMap.get(PID).stage, '第二阶段');
  assert.equal(c.indexed.projectMap.get(PID).tasks[0].status, 'done');
  assert.equal(c.indexed.nodeMap.has(NID), true);
});

test('unreadable / failed refresh keeps previous graph and marks stale', async () => {
  let calls = 0;
  const store = KS.createStore(async () => {
    calls += 1;
    if (calls === 1) return snapshot();
    return { ok: false, schema_version: 1, code: 'unstable_inputs', error: '变化中' };
  });
  await store.load({ force: true });
  const next = await store.load({ force: true });
  assert.equal(next.ok, false);
  assert.equal(next.kept, true);
  assert.equal(next.indexed.nodeMap.has(NID), true);
  assert.equal(store.get().stale, true);
});

test('registry_complete=false is marked incomplete and stale, not deleted', async () => {
  const store = KS.createStore(async () => snapshot({ registry_complete: false }));
  const result = await store.load({ force: true });
  assert.equal(result.ok, true);
  assert.equal(store.get().incomplete, true);
  assert.equal(store.get().stale, true);
  assert.equal(store.get().indexed.projects.length, 1);
});

test('search covers nodes, tasks and files without using titles as IDs', () => {
  const indexed = KS.indexSnapshot(snapshot());
  const found = KS.searchSnapshot(indexed, '任务一');
  assert.equal(found.tasks.length, 1);
  assert.equal(found.tasks[0].key, KS.taskKey(PID, 't1'));
  const files = KS.searchSnapshot(indexed, '方案 #1');
  assert.equal(files.files[0].id, FID);
});

test('membership edges are foldable by origin and relation_type', () => {
  const indexed = KS.indexSnapshot(snapshot());
  assert.equal(KS.foldableEdge(indexed.edges[0]), true);
  assert.equal(KS.foldableEdge({ origin: 'research_relation', relation_type: '规定采样间隔' }), false);
});
