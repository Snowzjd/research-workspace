/* ==========================================================================
   本机配置（不参与同步）
   --------------------------------------------------------------------------
   数据文件里混了两类东西：
     - 逻辑数据（项目/任务/待办/知识库/偏好）—— 换设备也该一致，将来要同步
     - 本机环境（工作区根目录、各软件安装路径、目录是否已创建）—— 每台机器不同

   把后者抽到 device.json 单独存放，写入数据文件前先剥掉、读取时再注回内存。
   这样渲染层代码完全不用改（内存里结构不变），而导出的数据文件天然干净、可同步。

   存放：<userData>/device.json
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

const FILE = 'device.json';

function baseDir() {
  return app.getPath('userData');
}
function file() {
  return path.join(baseDir(), FILE);
}

function read() {
  try {
    const f = file();
    if (!fs.existsSync(f)) return {};
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (_) { return {}; }
}

function write(obj) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file());
    return { ok: true, file: file() };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/* 设备标识：将来做同步冲突识别要用，第一次访问时生成并固定下来 */
function info() {
  const d = read();
  if (!d.deviceId) {
    d.deviceId = crypto.randomBytes(8).toString('hex');
    d.deviceName = d.deviceName || os.hostname();
    d.createdAt = d.createdAt || new Date().toISOString();
    write(d);
  }
  /* 新设备首次新建项目时给一个合理默认值：<文档>/ResearchWorkspace */
  if (!d.suggestedRoot) {
    try { d.suggestedRoot = path.join(app.getPath('documents'), 'ResearchWorkspace'); } catch (_) { d.suggestedRoot = ''; }
  }
  return d;
}

/**
 * 从数据对象中剥离本机字段，返回 { data, device }。
 * data 是可直接落盘/同步的干净版本；device 合并进 device.json。
 */
function split(data) {
  const dev = { ...info() };
  if (!data || typeof data !== 'object') return { data, device: dev };

  if (data.settings) {
    if ('rootDir' in data.settings) { dev.rootDir = data.settings.rootDir; delete data.settings.rootDir; }
    if ('structureCreated' in data.settings) { dev.structureCreated = !!data.settings.structureCreated; delete data.settings.structureCreated; }
  }

  /* 软件安装路径只在本机有效；名称/图标/绑定项目这些留可同步的数据里 */
  const paths = {};
  (data.apps || []).forEach(a => {
    if (!a || !a.n) return;
    /* 有值才登记到本机配置；无论有没有值，都从可同步数据里删掉这两个键 */
    if (typeof a.path === 'string' && a.path) paths[a.n] = { path: a.path, cwd: a.cwd || '' };
    delete a.path; delete a.cwd;
  });
  if (Object.keys(paths).length) dev.appPaths = { ...(dev.appPaths || {}), ...paths };

  return { data, device: dev };
}

/**
 * 把本机字段注回数据对象（内存里保持原来的结构）。
 */
function inject(data) {
  if (!data || typeof data !== 'object') return data;
  const dev = read();

  data.settings = data.settings || {};
  if (dev.rootDir) data.settings.rootDir = dev.rootDir;
  if (typeof dev.structureCreated === 'boolean') data.settings.structureCreated = dev.structureCreated;

  const paths = dev.appPaths || {};
  /* 数据文件里的 path/cwd 在 split 时已被剥离（路径只属本机），
     所以这里必须给每个 app 都补上字符串：本机登记过的用登记值，
     没登记过的一律空串——留 undefined 会让界面在 `.length` 这类地方直接崩。
     （不会丢用户的已配路径：那些值只存在 device.json 的 appPaths 里，本来就不在数据文件中） */
  (data.apps || []).forEach(a => {
    if (!a || typeof a !== 'object') return;
    const p = a.n ? paths[a.n] : null;
    if (p) { a.path = p.path || ''; a.cwd = p.cwd || ''; }
    else { a.path = ''; a.cwd = ''; }
  });

  return data;
}

module.exports = { read, write, info, split, inject, file };
