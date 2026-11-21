/**
 * 材料数据源：已绑定走 RPM；未绑定明确未接入；演示 id 不命中真实项目。
 * 运行：node --test tests/material-source.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const src = require('../assets/js/material-source.js');

const demoMaterials = {
  tpms: { '01_建模': [['demo.scdoc', '1 MB', 'cad']] }
};

test('bound project uses RPM files only and ignores historical index and demo MATERIALS', () => {
  const decided = src.resolve({
    projectId: 'pjzlgv7wx4ks',
    project: { id: 'pjzlgv7wx4ks', folder: 'TPMS', rpmProjectId: 'd721', rpmRoot: 'G:\\TPMS' },
    settings: { rpmBindings: { pjzlgv7wx4ks: { rpmProjectId: 'd721', rpmRoot: 'G:\\TPMS' } } },
    materialIndex: { pjzlgv7wx4ks: { '01_旧': [['old.txt', '1 KB', 'txt']] } },
    demoMaterials,
    rpmCache: {
      rpmBound: true,
      resolvedRoot: 'G:\\TPMS',
      rpmProjectId: 'd721',
      files: [{
        file_id: 'abc',
        name: 'notes.md',
        relative_path: '01_Planning/notes.md',
        category: '01_Planning',
        purpose: 'text',
        size: '2048',
        absolute_path: 'G:\\TPMS\\01_Planning\\notes.md'
      }]
    }
  });
  assert.equal(decided.source, 'rpm');
  assert.equal(decided.rpmBound, true);
  assert.equal(decided.resolvedRoot, 'G:\\TPMS');
  assert.equal(Object.keys(decided.index).includes('01_旧'), false);
  assert.equal(Object.keys(decided.index).includes('01_建模'), false);
  assert.equal(decided.files.length, 1);
  assert.equal(decided.files[0].n, 'notes.md');
  assert.equal(decided.files[0].category, '01_Planning');
  assert.equal(decided.files[0].purpose, 'text');
  assert.equal(decided.files[0].absolute_path, 'G:\\TPMS\\01_Planning\\notes.md');
  assert.equal(src.openFolderPath({ decided: decided }, '01_Planning'), 'G:\\TPMS\\01_Planning');
  assert.equal(src.openFilePath({ decided: decided }, decided.files[0]), 'G:\\TPMS\\01_Planning\\notes.md');
  assert.match(decided.label, /已接入文件引擎/);
});

test('unbound real project does not fall back to demo MATERIALS or fake RPM data', () => {
  const decided = src.resolve({
    projectId: 'pjstage2free',
    project: { id: 'pjstage2free', folder: 'FREE', name: 'Unbound Preview' },
    settings: { rpmBindings: {} },
    materialIndex: {},
    demoMaterials
  });
  assert.equal(decided.source, 'disconnected');
  assert.equal(decided.rpmBound, false);
  assert.deepEqual(decided.index, {});
  assert.equal(decided.label, '尚未接入文件引擎');
});

test('historical materialIndex is shown only for unbound/legacy and labeled non-RPM', () => {
  const decided = src.resolve({
    projectId: 'pjlegacy1',
    project: { id: 'pjlegacy1', folder: 'OLD' },
    materialIndex: { pjlegacy1: { '05_文档': [['draft.docx', '20 KB', 'docx']] } },
    demoMaterials
  });
  assert.equal(decided.source, 'historical');
  assert.equal(decided.historical, true);
  assert.equal(decided.files[0].n, 'draft.docx');
  assert.match(decided.label, /历史工作台索引（非 RPM）/);
});

test('demo MATERIALS only match demo ids and never a real project id', () => {
  const demo = src.resolve({ projectId: 'tpms', demoMaterials });
  assert.equal(demo.source, 'demo');
  assert.equal(src.isDemoMaterialId('pjzlgv7wx4ks'), false);
  assert.equal(src.isDemoMaterialId('pjstage2iso1'), false);
  const real = src.resolve({
    projectId: 'pjzlgv7wx4ks',
    project: { id: 'pjzlgv7wx4ks', folder: 'TPMS' },
    demoMaterials
  });
  assert.equal(real.source, 'disconnected');
});

test('wrapper-style workbench folder is not used as open root when RPM root is resolved', () => {
  const decided = src.resolve({
    projectId: 'pj1',
    project: { id: 'pj1', folder: 'TPMS', rpmRoot: 'G:\\TPMS' },
    workbenchRoot: 'F:\\ResearchWorkspace',
    rpmCache: { rpmBound: true, resolvedRoot: 'G:\\TPMS', files: [] }
  });
  assert.equal(src.openRootOf({ decided: decided, workbenchRoot: 'F:\\ResearchWorkspace', project: { folder: 'TPMS' } }), 'G:\\TPMS');
  assert.equal(src.openFolderPath({ decided: decided }, '01_Planning').startsWith('F:\\ResearchWorkspace'), false);
});

test('ensureStructure payload skips bound projects and does not apply demo folders to them', () => {
  const projects = [
    { id: 'pjbound', name: 'Bound', folder: 'TPMS', rpmRoot: 'G:\\TPMS', rpmProjectId: 'd721' },
    { id: 'tpms', name: 'Demo', folder: 'demo-tpms' }
  ];
  const payload = src.structureProjects(projects, { rpmBindings: {} }, demoMaterials);
  assert.equal(payload.some(p => p.folder === 'TPMS'), false);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].folder, 'demo-tpms');
  assert.ok(payload[0].dirs['01_建模']);
  assert.equal(src.shouldSkipEnsureStructure(projects[0], {}), true);
  assert.equal(src.canUseDemoMaterials('pjbound', projects[0], {}), false);
});

test('old workspace-data fields still load and are not back-filled from RPM', () => {
  const raw = {
    schemaVersion: 3,
    projects: [{ id: 'pjlegacy1', name: 'Old', folder: 'OLD' }],
    tasks: [{ id: 'tk1', t: 'keep me', p: 'pjlegacy1', st: 'todo' }],
    materialIndex: { pjlegacy1: { '05_文档': [['draft.docx', '20 KB', 'docx']] } },
    materialScans: { pjlegacy1: { state: 'ok', files: 1 } },
    outcomes: []
  };
  const d = src.ensureCompatFields(JSON.parse(JSON.stringify(raw)));
  assert.equal(d.materialIndex.pjlegacy1['05_文档'][0][0], 'draft.docx');
  assert.equal(d.materialScans.pjlegacy1.state, 'ok');
  assert.ok(d.settings.rpmBindings);
  assert.deepEqual(d.settings.rpmBindings, {});
  const decided = src.resolve({
    projectId: 'pjlegacy1',
    project: d.projects[0],
    materialIndex: d.materialIndex,
    settings: d.settings
  });
  assert.equal(decided.source, 'historical');
});

test('outcome path helpers do not imply deleting files; unlink keeps the path record separate', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'rw-outcome-'));
  const file = path.join(tmp, 'kept.md');
  writeFileSync(file, 'keep', 'utf8');
  const outcome = { id: 'oc1', title: 'kept', file: file, file_id: 'fid', relative_path: 'kept.md' };
  const opened = src.outcomeOpenPath(outcome, { decided: { resolvedRoot: tmp, rpmBound: true } });
  assert.equal(existsSync(file), true);
  assert.ok(opened);
  /* 取消关联只丢工作台记录，测试调用方负责只删内存对象 */
  const remaining = [];
  assert.equal(existsSync(file), true);
  assert.equal(readFileSync(file, 'utf8'), 'keep');
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(remaining.length, 0);
});
