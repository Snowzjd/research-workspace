'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const adapter = require('./rpm-adapter');
const { inspectPath } = require('./project-root');
const { atomicWrite, protectedProjectWrite, samePath } = require('./full-product');

const exec = promisify(execFile);
let registrationInProgress = false;

function failure(code, error) {
  return { ok: false, code, error };
}

function localDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value)) return '';
  const absolute = path.resolve(value);
  if (samePath(absolute, path.parse(absolute).root)) return '';
  const inspected = inspectPath(absolute);
  if (!inspected.exists || inspected.hasReparseInPath || !inspected.realPath ||
      !samePath(absolute, inspected.realPath) || !fs.statSync(absolute).isDirectory()) return '';
  return inspected.realPath;
}

function existingBinding(registry, root) {
  return registry.projects?.find(row => row.rpmRoot && samePath(row.rpmRoot, root));
}

function registrationFields(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit &&
    !/[\x00-\x1f\x7f]/.test(value);
}

function installedRpm(config) {
  const script = adapter.resolveScript(config);
  const file = fs.realpathSync.native(script);
  if (!adapter.isTrustedRpmCli(file) ||
      path.basename(path.dirname(path.dirname(file))) !== 'research-project-manager') return null;
  const python = fs.realpathSync.native(adapter.resolvePython(config));
  if (!fs.statSync(python).isFile() || !path.isAbsolute(python) || /^[\\/]{2}/.test(python)) return null;
  return { python, script: file };
}

function parseInitError(stderr) {
  try {
    const detail = JSON.parse(stderr).error;
    if (typeof detail === 'string') return detail.slice(0, 480);
  } catch (_) {}
  return 'RPM 未能完成登记。可检查目录权限或重试同一目录。';
}

async function registerProject({ root: selected, name, direction, emptyOnly = false } = {}, config = {}) {
  let root;
  try { root = localDirectory(selected); } catch (_) {}
  if (!root) return failure('invalid_root', '请选择存在的本机项目文件夹，且目录本身和上级目录均不可为链接或联接。');
  if (registrationInProgress) return failure('busy', '另一项 RPM 登记正在进行，请稍后再试。');
  registrationInProgress = true;
  try {
    const settingsPath = adapter.resolveSettings(config);
    if (!settingsPath || !localDirectory(adapter.readVaultPath(settingsPath))) {
      return failure('vault_unconfigured', 'RPM 尚未配置可访问的中央 Vault，无法登记项目。');
    }
    const resolved = installedRpm(config);
    if (!resolved) return failure('rpm_unavailable', '找不到已安装的 RPM 或 Python。');
    const { python, script } = resolved;
    const readConfig = { ...config, pythonPath: python, scriptPath: script, settingsPath, cache: false };
    const before = await adapter.listProjects(readConfig);
    if (!before.ok) return failure('registry_unavailable', '暂时无法读取 RPM 登记表。');
    const existing = existingBinding(before, root);
    if (existing) return { ok: true, binding: existing, existing: true };
    if (protectedProjectWrite('', root)) return failure('protected_root', '此目录仅开放读取，不能在这里初始化 RPM。');
    if (!registrationFields(name, 120) || !registrationFields(direction, 240)) {
      return failure('invalid_details', '请输入项目名称和研究方向。');
    }

    if (emptyOnly && fs.readdirSync(root).length) {
      return failure('preview_required', '该目录已有文件，请选择接管已有项目并复核。');
    }
    let initialized;
    try {
      const result = await exec(python, ['-X', 'utf8', '-B', script, '--settings', settingsPath,
        'init', root, '--name=' + name.trim(), '--direction=' + direction.trim()], {
        cwd: path.dirname(script), windowsHide: true, shell: false, timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024, encoding: 'utf8'
      });
      initialized = JSON.parse(result.stdout);
    } catch (error) {
      return failure('init_failed', error.killed
        ? 'RPM 登记尚未在时限内完成，请重新打开绑定窗口核对提交结果。'
        : parseInitError(error.stderr));
    } finally {
      adapter.clearCache();
    }
    const after = await adapter.listProjects(readConfig);
    const binding = after.ok && existingBinding(after, root);
    if (!binding || binding.rpmProjectId !== initialized?.project_id) {
      return failure('registry_unconfirmed', 'RPM 已执行初始化，但尚未核实中央登记，请刷新绑定窗口核对。');
    }
    return { ok: true, binding, existing: false };
  } catch (_) {
    return failure('rpm_unavailable', 'RPM 或 Python 无法访问，请核对本机安装。');
  } finally {
    registrationInProgress = false;
  }
}

const PREVIEW_LIMIT = 30;
const TASK_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_TASK_BYTES = 80 * 1024 * 1024;
const RECOVERY_MARKER = '.rpm-onboarding-confirmation.json';
const PREVIEW_TYPES = ['Research', 'CFD', 'Experiment', 'Theory', 'Software', 'Writing', 'General'];
const PREVIEW_FILTERS = Object.freeze({
  all: () => true,
  high: row => row.confidence === 'high',
  medium: row => row.confidence === 'medium',
  pending: row => row.confidence === 'pending',
  dependency: row => Boolean(row.dependency),
  duplicate: row => Boolean(row.duplicateGroup),
  sameName: row => row.sameName
});
let previewInProgress = false;

function normalizeProjectType(value) {
  if (value == null || value === '' || value === 'auto') return '';
  if (typeof value !== 'string' || value.length > 100) return null;
  const types = value.toLowerCase().split('+').map(part => part.trim()).map(part =>
    part === 'skill' ? 'Software' : PREVIEW_TYPES.find(type => type.toLowerCase() === part));
  return types.every(Boolean) ? [...new Set(types)].join('+') : null;
}

function configuredRpm(config) {
  const settingsPath = adapter.resolveSettings(config);
  const vault = settingsPath && localDirectory(adapter.readVaultPath(settingsPath));
  if (!vault) return null;
  const installed = installedRpm(config);
  if (!installed) return null;
  return { ...installed, settingsPath, vault };
}

function readConfigFor(config, configured) {
  return { ...config, pythonPath: configured.python, scriptPath: configured.script,
    settingsPath: configured.settingsPath, cache: false };
}

function onboardingPython(configured, action, root, request) {
  const { python, script, settingsPath } = configured;
  const helper = path.resolve(__dirname, '..', 'rpm-integration', 'rpm_onboarding.py');
  const skill = path.dirname(path.dirname(script));
  const timeout = action === 'apply' ? 600_000 : 240_000;
  return new Promise(resolve => {
    const child = execFile(python, ['-X', 'utf8', '-B', helper, action,
      '--skill-root', skill, '--settings', settingsPath, '--root', root], {
      cwd: path.dirname(helper), windowsHide: true, shell: false, timeout,
      maxBuffer: MAX_TASK_BYTES,
      encoding: 'utf8'
    }, (error, stdout) => {
      if (error) {
        const detail = action === 'apply'
          ? 'RPM 登记可能尚未完成。请先刷新已有登记，核对目录后重试。'
          : 'RPM 接管预览未完成。请核对目录和 RPM 安装后重试。';
        resolve(failure(error.killed ? 'timeout' : 'onboarding_failed', detail));
        return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch (_) { resolve(failure('invalid_response', 'RPM 返回了无法读取的接管结果。')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

function taskDirectory(config, create = false) {
  const selected = config?.onboardingDirectory;
  if (typeof selected !== 'string' || !path.isAbsolute(selected)) return '';
  if (create && localDirectory(path.dirname(selected)) && !fs.existsSync(selected)) fs.mkdirSync(selected);
  return localDirectory(selected);
}

function readLocalJson(file, maxBytes = MAX_TASK_BYTES) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes ||
        !samePath(file, fs.realpathSync.native(file))) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) { return null; }
}

function readTask(directory, token) {
  if (!directory || typeof token !== 'string' || !TASK_ID.test(token)) return null;
  const record = readLocalJson(path.join(directory, token + '.json'));
  return record?.schema === 1 && record.token === token && typeof record.root === 'string' &&
      typeof record.projectId === 'string' && typeof record.phase === 'string' &&
      typeof record.request?.name === 'string' && Array.isArray(record.decisions) &&
      Array.isArray(record.failures) && Array.isArray(record.audit) && typeof record.updated === 'string' ? record : null;
}

function activeTask(record) {
  return record && !['completed', 'abandoned'].includes(record.phase);
}

function loadTask(config, token, projectId) {
  const directory = taskDirectory(config);
  const record = readTask(directory, token);
  return activeTask(record) && record.projectId === projectId ? { directory, record } : null;
}

function readPreview(directory, record) {
  if (!TASK_ID.test(record.snapshot || '')) return null;
  return readLocalJson(path.join(directory, record.token + '-' + record.snapshot + '.preview.json'));
}

function saveTask(directory, record) {
  record.updated = new Date().toISOString();
  const bytes = JSON.stringify(record);
  if (Buffer.byteLength(bytes) > MAX_TASK_BYTES) throw Error('接管记录过大');
  atomicWrite(path.join(directory, record.token + '.json'), bytes);
}

function audit(record, event, extra = {}) {
  record.audit = [...record.audit.slice(-199), { at: new Date().toISOString(), event, ...extra }];
}

function storePreview(directory, record, preview) {
  const snapshot = randomUUID();
  const bytes = JSON.stringify(preview);
  if (Buffer.byteLength(bytes) > MAX_TASK_BYTES) throw Error('预览快照过大');
  atomicWrite(path.join(directory, record.token + '-' + snapshot + '.preview.json'), bytes);
  const old = record.snapshot;
  record.snapshot = snapshot;
  record.revision = preview.revision;
  record.summary = preview.summary;
  record.phase = 'review';
  audit(record, 'preview_saved', { revision: preview.revision, changed: preview.changeSummary });
  saveTask(directory, record);
  if (TASK_ID.test(old || '')) {
    try { fs.unlinkSync(path.join(directory, record.token + '-' + old + '.preview.json')); } catch (_) {}
  }
}

function recoveryCheckpoint(record) {
  if (!['applying', 'interrupted', 'stale'].includes(record.phase)) return '';
  try {
    const root = localDirectory(record.root);
    if (!root || protectedProjectWrite('', root)) return '';
    const marker = readLocalJson(path.join(root, RECOVERY_MARKER));
    return marker?.operation === record.token && ['approved', 'initialized', 'indexed', 'synced'].includes(marker.stage)
      ? marker.stage : '';
  } catch (_) { return ''; }
}

function listOnboarding(config = {}) {
  try {
    const directory = taskDirectory(config);
    if (!directory) return { ok: true, tasks: [] };
    const records = fs.readdirSync(directory)
      .filter(name => name.endsWith('.json') && TASK_ID.test(name.slice(0, -5)))
      .map(name => readTask(directory, name.slice(0, -5)))
      .filter(activeTask)
      .sort((a, b) => b.updated.localeCompare(a.updated));
    return { ok: true, tasks: records.map(record => ({
      token: record.token, projectId: record.projectId, root: record.root, name: record.request.name,
      direction: record.request.direction, projectType: record.request.projectType, phase: record.phase,
      updated: record.updated, total: record.summary?.total ?? 0, reviewed: record.decisions.length,
      checkpoint: recoveryCheckpoint(record), error: record.failure?.error || ''
    })) };
  } catch (_) { return failure('task_store_unavailable', '无法读取保存的接管任务。'); }
}

function onboardingPage({ token, projectId, offset = 0, filter = 'all' } = {}, config = {}) {
  const prepared = loadTask(config, token, projectId);
  if (!prepared) return failure('preview_expired', '找不到待续办的接管任务，请返回项目中心。');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Object.hasOwn(PREVIEW_FILTERS, filter)) {
    return failure('invalid_page', '此复核页不可用，请返回第一页。');
  }
  const { record, directory } = prepared;
  const common = { ok: true, token, root: record.root, projectId: record.projectId, name: record.request.name,
    direction: record.request.direction, projectType: record.request.projectType, phase: record.phase,
    checkpoint: recoveryCheckpoint(record), failure: record.failure, summary: record.summary,
    decisions: record.decisions, acceptHigh: record.acceptHigh };
  if (record.phase === 'registered') return { ...common, binding: record.binding, review: record.review };
  const preview = readPreview(directory, record);
  if (!preview) return { ...common, files: [], categories: [], filteredTotal: 0, nextOffset: null };
  const { revision, files, observations, recoveryHash, ...details } = preview;
  const selected = files.filter(PREVIEW_FILTERS[filter]);
  const paths = new Set(files.map(row => row.path));
  return { ...common, ...details, decisions: record.decisions.filter(row => paths.has(row.path)),
    offset, limit: PREVIEW_LIMIT,
    directories: details.directories.slice(0, 100), directoryTotal: details.directories.length,
    skipped: details.skipped.slice(0, 50),
    files: selected.slice(offset, offset + PREVIEW_LIMIT), filteredTotal: selected.length,
    nextOffset: offset + PREVIEW_LIMIT < selected.length ? offset + PREVIEW_LIMIT : null };
}

async function previewOnboarding({ root: selected, name, direction, projectId, projectType } = {}, config = {}) {
  let root;
  try { root = localDirectory(selected); } catch (_) {}
  if (!root) return failure('invalid_root', '请选择存在、无路径联接的本机项目文件夹。');
  const type = normalizeProjectType(projectType);
  if (!registrationFields(name, 120) || !registrationFields(direction, 240) ||
      !registrationFields(projectId, 120) || type === null) {
    return failure('invalid_details', '请输入项目名称和研究方向，并选择适用的项目类型。');
  }
  if (previewInProgress || registrationInProgress) return failure('busy', '正在处理另一接管任务，请稍后重试。');
  previewInProgress = true;
  try {
    const configured = configuredRpm(config);
    if (!configured) return failure('rpm_unavailable', 'RPM、Python 或中央 Vault 不可访问。');
    const listed = listOnboarding(config);
    if (!listed.ok) return listed;
    const active = listed.tasks.find(task => samePath(task.root, root));
    if (active) return active.projectId === projectId ? onboardingPage(active, config) :
      failure('existing_intake', '此目录已有待续办任务，请从项目中心继续。');
    const known = await adapter.listProjects(readConfigFor(config, configured));
    if (!known.ok) return failure('registry_unavailable', '暂时无法读取 RPM 登记表。');
    const existing = existingBinding(known, root);
    if (existing) return { ok: true, binding: existing, existing: true };
    if (protectedProjectWrite('', root)) return failure('protected_root', '此项目仅开放读取，请使用现有登记绑定。');
    const directory = taskDirectory(config, true);
    if (!directory) return failure('task_store_unavailable', '无法保存接管任务，请检查工作台数据目录。');
    const request = { name: name.trim(), direction: direction.trim(), projectType: type };
    const record = { schema: 1, token: randomUUID(), root, projectId, request, configured,
      phase: 'scanning', created: new Date().toISOString(), scanStarted: new Date().toISOString(),
      decisions: [], acceptHigh: false, failures: [], audit: [] };
    saveTask(directory, record);
    return await scanOnboarding(directory, record, configured, config);
  } catch (_) {
    return failure('rpm_unavailable', '无法读取项目、RPM 或接管记录。');
  } finally {
    previewInProgress = false;
  }
}

function recordFailure(directory, record, cause, phase = 'interrupted') {
  const detail = { code: cause.code, error: cause.error };
  record.phase = phase;
  record.failure = detail;
  record.failures = [...record.failures.slice(-49), { at: new Date().toISOString(), ...detail }];
  audit(record, 'failed', { code: detail.code, phase });
  saveTask(directory, record);
  return cause;
}

async function scanOnboarding(directory, record, configured, config) {
  const previous = readPreview(directory, record);
  const previousRows = previous?.observations && Object.fromEntries(previous.files.map(file => [
    file.path, { row: file, ...previous.observations[file.path] }
  ]));
  const preview = await onboardingPython(configured, 'preview', record.root, {
    ...record.request, operation: record.token, previous: previousRows
  });
  if (!preview.ok) return recordFailure(directory, record, preview, 'scan_failed');
  record.failure = null;
  storePreview(directory, record, preview);
  return onboardingPage({ token: record.token, projectId: record.projectId }, config);
}

function sameConfiguration(configured, record) {
  return configured && ['python', 'script', 'settingsPath', 'vault'].every(key =>
    samePath(configured[key], record.configured[key]));
}

async function rescanOnboarding({ token, projectId } = {}, config = {}) {
  const prepared = loadTask(config, token, projectId);
  if (!prepared) return failure('preview_expired', '找不到待续办的接管任务。');
  const { directory, record } = prepared;
  if (record.phase === 'registered') return onboardingPage({ token, projectId }, config);
  if (previewInProgress || registrationInProgress) return failure('busy', '正在处理另一接管任务，请稍后重试。');
  previewInProgress = true;
  try {
    const root = localDirectory(record.root);
    const configured = configuredRpm(config);
    if (!root || protectedProjectWrite('', root)) return failure('protected_root', '项目路径无法核对。');
    if (!sameConfiguration(configured, record)) return failure('stale_configuration', 'RPM 或中央 Vault 设置已变化，请先恢复原配置。');
    record.scanStarted = new Date().toISOString();
    audit(record, 'rescan_started');
    saveTask(directory, record);
    return await scanOnboarding(directory, record, configured, config);
  } catch (_) { return failure('onboarding_failed', '重新扫描失败，已保存当前接管状态。'); }
  finally { previewInProgress = false; }
}

function saveOnboarding({ token, projectId, decisions, acceptHigh } = {}, config = {}) {
  try {
    const prepared = loadTask(config, token, projectId);
    if (!prepared) return failure('preview_expired', '找不到待续办的接管任务。');
    const { record, directory } = prepared;
    if (registrationInProgress || previewInProgress || record.phase !== 'review') {
      return failure('review_locked', '请先继续或重新扫描此接管任务。');
    }
    const preview = readPreview(directory, record);
    if (!preview || !resolveReview(preview.files, preview.categories, decisions, acceptHigh)) {
      return failure('invalid_review', '复核决定缺少可登记的分类或用途。');
    }
    const paths = new Set(preview.files.map(row => row.path));
    const archived = record.decisions.filter(row => !paths.has(row.path));
    record.decisions = [...archived, ...decisions];
    record.acceptHigh = acceptHigh;
    saveTask(directory, record);
    return { ok: true };
  } catch (_) { return failure('task_store_unavailable', '无法保存本次复核。'); }
}

function changeTaskPhase({ token, projectId }, config, action) {
  try {
    const prepared = loadTask(config, token, projectId);
    if (!prepared) return failure('preview_expired', '找不到待续办的接管任务。');
    const { record, directory } = prepared;
    if (registrationInProgress || previewInProgress) return failure('busy', '正在处理另一接管任务，请稍后重试。');
    if (action === 'completed' && record.phase !== 'registered') {
      return failure('invalid_phase', '仅可关闭已登记的接管任务。');
    }
    record.phase = action;
    audit(record, action);
    saveTask(directory, record);
    return { ok: true };
  } catch (_) { return failure('task_store_unavailable', '无法保存当前接管状态。'); }
}

function abandonOnboarding(payload = {}, config = {}) {
  return changeTaskPhase(payload, config, 'abandoned');
}

async function finishOnboarding(payload = {}, config = {}) {
  const prepared = loadTask(config, payload.token, payload.projectId);
  if (!prepared || prepared.record.phase !== 'registered') {
    return failure('invalid_phase', '仅可关闭已登记的接管任务。');
  }
  if (registrationInProgress || previewInProgress) return failure('busy', '正在处理另一接管任务，请稍后重试。');
  registrationInProgress = true;
  try {
    const { record, directory } = prepared;
    const root = localDirectory(record.root);
    const configured = configuredRpm(config);
    if (!root || !samePath(root, record.root) || protectedProjectWrite('', root) ||
        !sameConfiguration(configured, record)) {
      return failure('recovery_needed', '项目路径或 RPM 配置已变化，请核对后再完成接管。');
    }
    const closed = await onboardingPython(configured, 'finish', root, {
      operation: record.token, projectId: record.binding.rpmProjectId
    });
    if (!closed.ok) return closed;
    record.phase = 'completed';
    audit(record, 'completed');
    saveTask(directory, record);
    return { ok: true };
  } catch (_) { return failure('task_store_unavailable', '工作台绑定存在，但未能关闭接管检查点。'); }
  finally { registrationInProgress = false; }
}

function resolveReview(files, categories, decisions, acceptHigh) {
  if (!Array.isArray(decisions) || decisions.length > files.length || typeof acceptHigh !== 'boolean') return null;
  const paths = new Map(files.map(row => [row.path, row]));
  const reviewed = Object.create(null);
  for (const decision of decisions) {
    if (!decision || !paths.has(decision.path) || Object.hasOwn(reviewed, decision.path)) return null;
    const row = paths.get(decision.path);
    if (decision.action === 'reject') {
      reviewed[row.path] = { action: 'pending' };
      continue;
    }
    const accept = decision.action === 'accept';
    if (!accept && decision.action !== 'change') return null;
    const category = accept ? row.category : decision.category;
    const purpose = accept ? row.purpose : decision.purpose;
    if (!categories.includes(category) || !registrationFields(purpose, 400)) return null;
    reviewed[row.path] = { action: decision.action, category, purpose: purpose.trim() };
  }
  if (acceptHigh) {
    for (const row of files) {
      if (row.confidence === 'high' && !Object.hasOwn(reviewed, row.path) &&
          categories.includes(row.category) && registrationFields(row.purpose, 400)) {
        reviewed[row.path] = { action: 'accept', category: row.category, purpose: row.purpose };
      }
    }
  }
  return reviewed;
}

async function confirmOnboarding({ token, projectId, decisions, acceptHigh } = {}, config = {}) {
  const prepared = loadTask(config, token, projectId);
  if (!prepared) return failure('preview_expired', '找不到待续办的接管任务。');
  const { record, directory } = prepared;
  if (record.phase === 'registered') {
    try {
      const configured = configuredRpm(config);
      const canonical = localDirectory(record.root);
      if (!sameConfiguration(configured, record) || !canonical || !samePath(canonical, record.root)) {
        return failure('registry_unconfirmed', '项目目录或 RPM 设置发生变化，请先核对原登记。');
      }
      const registry = await adapter.listProjects(readConfigFor(config, configured));
      const binding = registry.ok && existingBinding(registry, canonical);
      if (!binding || binding.rpmProjectId !== record.binding?.rpmProjectId) {
        return failure('registry_unconfirmed', '原项目登记已变化，请先在 RPM 中核对。');
      }
      return { ok: true, binding, review: record.review };
    } catch (_) { return failure('registry_unconfirmed', '无法核对 RPM 中央登记，请重试。'); }
  }
  const preview = readPreview(directory, record);
  if (!preview || ['scan_failed', 'scanning', 'stale'].includes(record.phase)) {
    return failure('stale_preview', '请先重新扫描并复核当前文件。');
  }
  if (preview.blocked) return failure('preview_blocked', preview.blocked);
  const { root, request } = record;
  const knownPaths = new Set(preview.files.map(row => row.path));
  const activeDecisions = record.decisions.filter(row => knownPaths.has(row.path));
  const selections = decisions ?? activeDecisions;
  const accept = acceptHigh ?? record.acceptHigh;
  const review = resolveReview(preview.files, preview.categories, selections, accept);
  if (!review) return failure('invalid_review', '复核决定缺少可登记的分类或用途。');
  if (registrationInProgress || previewInProgress) return failure('busy', '另一项 RPM 操作正在进行，请稍后重试。');
  registrationInProgress = true;
  try {
    const canonical = localDirectory(root);
    if (!canonical || !samePath(canonical, root) || protectedProjectWrite('', root)) {
      return failure('protected_root', '所选项目路径已变化或仅开放读取，无法写入管理记录。');
    }
    const configured = configuredRpm(config);
    if (!sameConfiguration(configured, record)) {
      return failure('stale_configuration', 'RPM 或中央 Vault 设置已变化，请先恢复原配置。');
    }
    let apply = record.applyRequest;
    if (record.phase === 'review' || !apply) {
      apply = { ...request, revision: preview.revision, operation: token, review,
        baseline: Object.fromEntries(Object.entries(preview.observations).map(([rel, row]) => [rel, row.stamp])),
        expectedRecoveryHash: preview.recoveryHash || '' };
      record.applyRequest = apply;
      record.decisions = [...record.decisions.filter(row => !knownPaths.has(row.path)), ...selections];
      record.acceptHigh = accept;
    } else if (JSON.stringify(review) !== JSON.stringify(apply.review)) {
      return failure('recovery_needed', '已批准的接管正在恢复。修改分类请先重新扫描。');
    }
    record.phase = 'applying';
    audit(record, 'apply_started', { revision: apply.revision });
    saveTask(directory, record);
    const result = await onboardingPython(configured, 'apply', root, apply);
    if (!result.ok) return recordFailure(directory, record, result, result.code === 'stale_preview' ? 'stale' : 'interrupted');
    const after = await adapter.listProjects(readConfigFor(config, configured));
    const binding = after.ok && existingBinding(after, root);
    if (!binding || binding.rpmProjectId !== result.project_id) {
      return recordFailure(directory, record,
        failure('registry_unconfirmed', '管理记录已写入，中央登记尚未核实，请重试。'));
    }
    record.phase = 'registered';
    record.binding = binding;
    record.review = result.review;
    record.registeredFiles = result.registeredFiles;
    record.pendingFiles = result.pendingFiles;
    record.failure = null;
    audit(record, 'rpm_registered', { rpmProjectId: binding.rpmProjectId, registeredFiles: result.registeredFiles.length });
    saveTask(directory, record);
    return { ok: true, binding, review: result.review };
  } catch (_) {
    try {
      return recordFailure(directory, record,
        failure('onboarding_failed', '接管登记未确认完成。已保留上次状态，请从待续办任务重试。'));
    } catch (_) { return failure('task_store_unavailable', '无法保存接管结果。请核对工作台数据目录。'); }
  } finally {
    adapter.clearCache();
    registrationInProgress = false;
  }
}

module.exports = { registerProject, previewOnboarding, onboardingPage, confirmOnboarding,
  listOnboarding, saveOnboarding, rescanOnboarding, abandonOnboarding, finishOnboarding };
