import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { registerProject, previewOnboarding, onboardingPage, confirmOnboarding,
  listOnboarding, saveOnboarding, rescanOnboarding, abandonOnboarding, finishOnboarding } = require('../desktop/rpm-registration');
const adapter = require('../desktop/rpm-adapter');

function tempDirectory(t) {
  const temp = realpathSync.native(tmpdir());
  const root = mkdtempSync(path.join(temp, 'rw-rpm-register-'));
  t.after(() => {
    assert.equal(path.dirname(realpathSync.native(root)), temp);
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('registration rejects drive roots, absent paths and folder aliases before touching RPM', async t => {
  const temp = tempDirectory(t);
  const linked = path.join(temp, 'linked');
  const original = path.join(temp, 'original');
  mkdirSync(original);
  symlinkSync(original, linked, process.platform === 'win32' ? 'junction' : 'dir');
  for (const root of [path.parse(temp).root, path.join(temp, 'missing'), linked]) {
    assert.equal((await registerProject({ root })).code, 'invalid_root');
  }
});

test('actual RPM init registers an existing folder in an isolated Vault without changing originals', async t => {
  const installed = adapter.describeStatus({});
  if (!installed.available) return t.skip('local RPM CLI is unavailable');
  const temp = tempDirectory(t);
  const vault = path.join(temp, 'Vault');
  const root = path.join(temp, 'Prototype project');
  const original = path.join(root, '原始数据.txt');
  const settingsPath = path.join(temp, 'rpm-settings.json');
  const config = { settingsPath, scriptPath: installed.scriptPath, pythonPath: installed.pythonPath, cache: false };
  mkdirSync(vault);
  mkdirSync(root);
  writeFileSync(original, 'isolated RPM registration fixture', 'utf8');
  writeFileSync(settingsPath, JSON.stringify({ vault }), 'utf8');

  assert.equal((await registerProject({ root, name: '合成项目' }, config)).code, 'invalid_details');
  const result = await registerProject({ root, name: '合成项目', direction: '登记流程验证' }, config);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.existing, false);
  assert.equal(result.binding.rpmRoot, root);
  assert.match(result.binding.rpmProjectId, /^[a-f0-9]{32}$/);
  const registryPath = path.join(vault, '.rpm', 'projects.json');
  const registered = readFileSync(registryPath);
  assert.deepEqual(JSON.parse(registered), { [result.binding.rpmProjectId]: root });
  const indexPath = path.join(root, '00_Project_Management', 'FILE_INDEX.csv');
  const indexed = readFileSync(indexPath);
  assert.match(indexed.toString('utf8'), /原始数据\.txt/);
  assert.equal(readFileSync(original, 'utf8'), 'isolated RPM registration fixture');

  const reused = await registerProject({ root }, config);
  assert.deepEqual(reused, { ...result, existing: true });
  assert.deepEqual(readFileSync(indexPath), indexed);
  assert.deepEqual(readFileSync(registryPath), registered);
});

function onboardingFixture(t) {
  const installed = adapter.describeStatus({});
  if (!installed.available) {
    t.skip('local RPM CLI is unavailable');
    return null;
  }
  const temp = tempDirectory(t);
  const vault = path.join(temp, '中央 Vault');
  const root = path.join(temp, '双盘兼容 # 研究项目');
  const settingsPath = path.join(temp, 'rpm-settings.json');
  mkdirSync(vault);
  mkdirSync(root);
  writeFileSync(settingsPath, JSON.stringify({ vault }), 'utf8');
  const proposal = { root, name: '历史项目', direction: '实验验证与资料接管', projectId: 'workspace-test',
    projectType: 'Research+Experiment' };
  const config = { settingsPath, scriptPath: installed.scriptPath, pythonPath: installed.pythonPath, cache: false,
    onboardingDirectory: path.join(temp, 'takeovers') };
  return { temp, root, vault, proposal, config };
}

test('historical takeover previews content and duplicates, then applies only reviewed in-place decisions', async t => {
  const fixture = onboardingFixture(t);
  if (!fixture) return;
  const { root, vault, proposal, config } = fixture;
  const files = {
    '输入/研究规划.md': '# 研究规划\n参考 [[目标笔记]]。',
    '输入/目标笔记.md': '# 目标笔记\n用于演示笔记跳转。',
    '输入/原始文件.bin': 'original with unknown purpose',
    '另一目录/原始文件.bin': 'same name, independent bytes',
    '输入/副本 A.txt': 'same exact bytes',
    '输入/副本 B.txt': 'same exact bytes',
    '输入/solver/几何.scdoc': 'geometry dependency',
    '输入/run.jou': 'file/read-case "目标笔记.md"'
  };
  for (const [relative, contents] of Object.entries(files)) {
    const filename = path.join(root, relative);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, contents, 'utf8');
  }
  const deniedNew = await registerProject({ ...proposal, emptyOnly: true }, config);
  assert.equal(deniedNew.code, 'preview_required');
  const preview = await previewOnboarding(proposal, config);
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(readdirSync(vault), []);
  assert.deepEqual(readdirSync(root), ['另一目录', '输入'].sort((a, b) => a < b ? -1 : 1));
  assert.equal(preview.projectType, 'Research+Experiment');
  assert.equal(preview.summary.total, Object.keys(files).length);
  assert.equal(preview.summary.duplicateGroups, 1);
  assert.equal(preview.summary.duplicateFiles, 2);
  assert.equal(preview.summary.sameNameGroups, 1);
  assert.equal(preview.files.find(row => row.name === '研究规划.md').category, '01_Planning');
  assert.equal(preview.files.find(row => row.name === '研究规划.md').confidence, 'high');
  assert.equal(preview.files.find(row => row.name === '几何.scdoc').dependency, '工程工作目录');
  assert.equal(preview.knowledgeCandidates.length, 1);
  assert.deepEqual(preview.knowledgeCandidates[0], {
    source: '输入/研究规划.md', target: '输入/目标笔记.md', type: '笔记引用',
    reason: '文件正文中有可解析的双链，科研关系待核对。'
  });
  assert.equal(onboardingPage({ token: preview.token, projectId: 'other' }, config).code, 'preview_expired');
  const duplicatePage = onboardingPage({ token: preview.token, projectId: proposal.projectId, filter: 'duplicate' }, config);
  assert.deepEqual(duplicatePage.files.map(row => row.name).sort(), ['副本 A.txt', '副本 B.txt']);
  assert.equal(duplicatePage.filteredTotal, 2);

  const request = { token: preview.token, projectId: proposal.projectId, acceptHigh: true, decisions: [
    { path: '输入/原始文件.bin', action: 'change', category: '05_Data', purpose: '实验采集的原始输入' },
    { path: '另一目录/原始文件.bin', action: 'reject' }
  ] };
  assert.equal((await confirmOnboarding({ ...request, decisions: [{ path: '../外部.txt', action: 'accept' }] }, config)).code,
    'invalid_review');
  const applied = await confirmOnboarding(request, config);
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.binding.rpmRoot, root);
  assert.equal(applied.review.corrected, 1);
  assert.equal(applied.review.changedDuringApply, 0);
  assert.ok(applied.review.confirmed >= 1);
  assert.ok(applied.review.pending >= 1);
  for (const [relative, contents] of Object.entries(files)) {
    assert.equal(readFileSync(path.join(root, relative), 'utf8'), contents);
  }
  const manage = path.join(root, '00_Project_Management');
  const review = JSON.parse(readFileSync(path.join(manage, '.rpm', 'onboarding-review.json')));
  assert.equal(review.records['另一目录/原始文件.bin'].action, 'pending');
  const configText = readFileSync(path.join(manage, 'PROJECT_CONFIG.yaml'), 'utf8');
  assert.match(configText, /实验采集的原始输入/);
  const indexed = readFileSync(path.join(manage, 'FILE_INDEX.csv'), 'utf8');
  assert.match(indexed, /实验采集的原始输入/);
  assert.match(indexed, /输入\/原始文件\.bin/);
  assert.deepEqual(await confirmOnboarding(request, config), applied);
  assert.equal((await finishOnboarding(request, config)).ok, true);
  assert.equal((await confirmOnboarding(request, config)).code, 'preview_expired');
  const existing = await previewOnboarding(proposal, config);
  assert.equal(existing.existing, true);
  assert.deepEqual(existing.binding, applied.binding);
});

test('historical takeover blocks changed and aliased project inventories before writing', async t => {
  const fixture = onboardingFixture(t);
  if (!fixture) return;
  const { root, temp, vault, proposal, config } = fixture;
  const original = path.join(root, '计划.txt');
  writeFileSync(original, 'first draft');
  const preview = await previewOnboarding(proposal, config);
  assert.equal(preview.ok, true, preview.error);
  writeFileSync(original, 'second draft, edited after preview');
  assert.equal((await confirmOnboarding({ token: preview.token, projectId: proposal.projectId }, config)).code,
    'stale_preview');
  assert.deepEqual(readdirSync(root), ['计划.txt']);
  assert.deepEqual(readdirSync(vault), []);
  const next = await rescanOnboarding({ token: preview.token, projectId: proposal.projectId }, config);
  assert.equal(next.ok, true, next.error);
  const outside = path.join(temp, 'external');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'never touch.txt'), 'external');
  symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await confirmOnboarding({ token: next.token, projectId: proposal.projectId }, config)).code,
    'stale_preview');
  const blocked = await rescanOnboarding({ token: preview.token, projectId: proposal.projectId }, config);
  assert.equal(blocked.ok, true, blocked.error);
  assert.equal(blocked.summary.skipped, 1);
  assert.ok(blocked.blocked);
  assert.equal((await confirmOnboarding({ token: blocked.token, projectId: proposal.projectId }, config)).code,
    'preview_blocked');
  assert.deepEqual(readdirSync(vault), []);
  assert.equal(readFileSync(path.join(outside, 'never touch.txt'), 'utf8'), 'external');
});

test('historical takeover can retry the identical confirmation after a Vault write obstruction', async t => {
  const fixture = onboardingFixture(t);
  if (!fixture) return;
  const { root, vault, proposal, config } = fixture;
  const original = path.join(root, '来源.txt');
  const originalBytes = '原始研究内容';
  writeFileSync(original, originalBytes, 'utf8');
  const preview = await previewOnboarding(proposal, config);
  assert.equal(preview.ok, true, preview.error);
  const vaultManagement = path.join(vault, '.rpm');
  const obstruction = path.join(vaultManagement, 'unowned.txt');
  mkdirSync(vaultManagement);
  writeFileSync(obstruction, 'unrelated Vault file must survive attempted sync');
  const request = { token: preview.token, projectId: proposal.projectId, decisions: [
    { path: '来源.txt', action: 'change', category: '05_Data', purpose: '访谈原始记录' }
  ] };
  const interrupted = await confirmOnboarding(request, config);
  assert.equal(interrupted.ok, false);
  const projectConfig = path.join(root, '00_Project_Management', 'PROJECT_CONFIG.yaml');
  const initialId = readFileSync(projectConfig, 'utf8').match(/project_id: ([a-f0-9]{32})/)[1];
  assert.equal(readFileSync(obstruction, 'utf8'), 'unrelated Vault file must survive attempted sync');
  assert.equal(readFileSync(original, 'utf8'), originalBytes);
  assert.equal((await confirmOnboarding({ ...request, decisions: [] }, config)).code, 'recovery_needed');
  rmSync(obstruction);
  const applied = await confirmOnboarding(request, config);
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.binding.rpmProjectId, initialId);
  assert.equal(applied.review.corrected, 1);
  assert.equal(readFileSync(original, 'utf8'), originalBytes);
  assert.equal((await finishOnboarding(request, config)).ok, true);
  assert.ok(!readdirSync(root).includes('.rpm-onboarding-confirmation.json'));
});

function fromNewProcess(method, payload, config) {
  const main = require.resolve('../desktop/rpm-registration.js');
  const code = [
    'const methods = require(process.argv[1]);',
    'const name = process.argv[2], payload = JSON.parse(process.argv[3]), config = JSON.parse(process.argv[4]);',
    'const outcome = name === "listOnboarding" ? methods[name](config) : methods[name](payload, config);',
    'Promise.resolve(outcome).then(result => console.log(JSON.stringify(result)));'
  ].join('\n');
  const child = spawnSync(process.execPath, ['-e', code, main, method, JSON.stringify(payload), JSON.stringify(config)], {
    encoding: 'utf8', windowsHide: true
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('historical takeover survives process restart, retains approved decisions and reuses the indexed checkpoint', async t => {
  const fixture = onboardingFixture(t);
  if (!fixture) return;
  const { root, vault, proposal, config } = fixture;
  const original = path.join(root, '需人工复核.txt');
  writeFileSync(original, 'original material remains unchanged');
  const preview = await previewOnboarding(proposal, config);
  assert.equal(preview.ok, true, preview.error);
  const key = { token: preview.token, projectId: proposal.projectId };
  const decision = { path: '需人工复核.txt', action: 'change', category: '05_Data', purpose: '人工选定材料用途' };
  assert.equal(saveOnboarding({ ...key, decisions: [decision], acceptHigh: false }, config).ok, true);
  const beforeApply = fromNewProcess('onboardingPage', key, config);
  assert.deepEqual(beforeApply.decisions, [decision]);
  assert.equal(beforeApply.phase, 'review');
  const obstruction = path.join(vault, '.rpm', 'unowned.txt');
  mkdirSync(path.dirname(obstruction));
  writeFileSync(obstruction, 'Existing manual data');
  const first = fromNewProcess('confirmOnboarding', key, config);
  assert.equal(first.ok, false);
  const manage = path.join(root, '00_Project_Management');
  const indexPath = path.join(manage, 'FILE_INDEX.csv');
  const indexed = readFileSync(indexPath);
  const projectId = readFileSync(path.join(manage, 'PROJECT_CONFIG.yaml'), 'utf8').match(/project_id: ([a-f0-9]{32})/)[1];
  const pending = fromNewProcess('listOnboarding', {}, config).tasks;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].phase, 'interrupted');
  assert.equal(pending[0].checkpoint, 'indexed');
  assert.equal(pending[0].reviewed, 1);
  rmSync(obstruction);
  const registered = fromNewProcess('confirmOnboarding', key, config);
  assert.equal(registered.ok, true, registered.error);
  assert.equal(registered.binding.rpmProjectId, projectId);
  assert.deepEqual(readFileSync(indexPath), indexed);
  assert.match(indexed.toString('utf8'), /人工选定材料用途/);
  assert.equal(fromNewProcess('onboardingPage', key, config).phase, 'registered');
  assert.equal(fromNewProcess('finishOnboarding', key, config).ok, true);
  assert.equal(listOnboarding(config).tasks.length, 0);
  assert.equal(readFileSync(original, 'utf8'), 'original material remains unchanged');
  const persisted = JSON.parse(readFileSync(path.join(config.onboardingDirectory, key.token + '.json'), 'utf8'));
  assert.equal(persisted.phase, 'completed');
  assert.ok(persisted.audit.some(row => row.event === 'failed'));
  assert.equal(persisted.registeredFiles.length, 1);
});

test('changed files are selectively reclassified after interruption without overwriting manual decisions', async t => {
  const fixture = onboardingFixture(t);
  if (!fixture) return;
  const { root, vault, proposal, config } = fixture;
  writeFileSync(path.join(root, '保留.txt'), 'unchanged source');
  writeFileSync(path.join(root, '待变.txt'), 'first draft');
  writeFileSync(path.join(root, '移除.txt'), 'temporary item');
  const preview = await previewOnboarding(proposal, config);
  assert.equal(preview.ok, true, preview.error);
  const key = { token: preview.token, projectId: proposal.projectId };
  const decisions = [{ path: '保留.txt', action: 'change', category: '05_Data', purpose: '保留人工分类' },
    { path: '待变.txt', action: 'change', category: '09_Documents', purpose: '保留变动文件先前选择' }];
  const obstruction = path.join(vault, '.rpm', 'unowned.txt');
  mkdirSync(path.dirname(obstruction));
  writeFileSync(obstruction, 'Vault stress test');
  assert.equal((await confirmOnboarding({ ...key, decisions }, config)).ok, false);
  const manage = path.join(root, '00_Project_Management');
  const indexPath = path.join(manage, 'FILE_INDEX.csv');
  const indexBefore = readFileSync(indexPath, 'utf8');
  const idBefore = indexBefore.split(/\r?\n/).find(line => line.includes('保留.txt')).split(',')[0];
  rmSync(obstruction);
  rmSync(path.join(root, '移除.txt'));
  writeFileSync(path.join(root, '待变.txt'), 'modified during interruption');
  writeFileSync(path.join(root, '新增.txt'), 'new source');
  assert.equal(fromNewProcess('confirmOnboarding', key, config).code, 'stale_preview');
  const rescanned = fromNewProcess('rescanOnboarding', key, config);
  assert.equal(rescanned.ok, true, rescanned.error);
  assert.deepEqual(rescanned.changeSummary, { reused: 1, reclassified: 2, added: 1, changed: 1, removed: 1 });
  assert.deepEqual(rescanned.decisions, decisions);
  assert.equal(rescanned.files.find(row => row.path === '待变.txt').changed, true);
  assert.equal(rescanned.files.find(row => row.path === '保留.txt').changed, false);
  const applied = fromNewProcess('confirmOnboarding', key, config);
  assert.equal(applied.ok, true, applied.error);
  const indexAfter = readFileSync(indexPath, 'utf8');
  assert.equal(indexAfter.split(/\r?\n/).find(line => line.includes('保留.txt')).split(',')[0], idBefore);
  assert.match(indexAfter, /保留变动文件先前选择/);
  assert.equal((await finishOnboarding(key, config)).ok, true);
});

test('abandon preserves existing files and prevents automatic resume without writing RPM records', async t => {
  const fixture = onboardingFixture(t);
  if (!fixture) return;
  const { root, vault, proposal, config } = fixture;
  writeFileSync(path.join(root, '源文件.txt'), 'original bytes');
  const preview = await previewOnboarding(proposal, config);
  assert.equal(preview.ok, true, preview.error);
  const key = { token: preview.token, projectId: proposal.projectId };
  assert.equal(fromNewProcess('abandonOnboarding', key, config).ok, true);
  assert.equal(listOnboarding(config).tasks.length, 0);
  assert.equal(onboardingPage(key, config).code, 'preview_expired');
  assert.deepEqual(readdirSync(root), ['源文件.txt']);
  assert.deepEqual(readdirSync(vault), []);
});
