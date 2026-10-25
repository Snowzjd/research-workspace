/* ==========================================================================
   账户层
   --------------------------------------------------------------------------
   两层东西，故意分开存：

   1) 工作台身份（DB.__account）—— 存在数据文件里，随同步走
      { id, name, createdAt }
      换设备的语义：只要云端把数据带过去，新设备一看就知道「这是同一个工作台」。
      这就是「每个 id 绑定 1 个云端」里的那个 id。

   2) 本机授权（device.json）—— 不参与同步，每台设备各自一份
      credential: { hash, salt, algo, at }      本机解锁密码
      cloud:      { kind, url, dir, user, secret }  云端绑定（secret 用 safeStorage 加密）

   为什么密码不进数据文件：数据文件会被传到网盘。把口令散列传上去等于给爆破送样本。
   为什么云端凭证不进数据文件：同上，而且凭证本来就该一台设备一份、可单独吊销。

   ⚠️ 定位要说清楚：本机密码是「门锁」，不是磁盘加密。
      有心人拿到硬盘直接读 workspace-data.json 就能看内容。真要防这个用 BitLocker。
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const store = require('./store');
const device = require('./device');
const cloud = require('./cloud');

const SCRYPT_N = { algo: 'scrypt', N: 16384, r: 8, p: 1, len: 64 };

/* 进程内的解锁状态：启动时只要有 credential 就先锁上 */
let unlocked = false;

/* ==========================================================================
   数据文件读写（直接操作主进程侧，避免和渲染层的持久化打架）
   ========================================================================== */
function readDataFile() {
  const f = store.dataFile();
  try {
    if (!fs.existsSync(f)) return null;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    return (raw && typeof raw === 'object') ? raw : null;
  } catch (_) { return null; }
}

/* 全新安装时数据文件还不存在，但注册要往里写身份——先落一份最小骨架。
   渲染层 load 时会以 freshData() 为底座 merge + migrate，所以这里不需要复制整个默认结构。 */
function ensureDataFile() {
  if (readDataFile()) return { ok: true, created: false };
  const y = new Date().getFullYear();
  const skeleton = {
    schemaVersion: 2,
    user: { name: '研究员', initial: '研', greet: '', mode: '本地工作台' },
    rootDir: '',
    projects: [], tasks: [], todos: [], timeline: [], kbDocs: [], resources: [],
    automations: [], templates: [], tombstones: [], activities: [], chats: {}, audit: [],
    ai: {
      enabled: false, provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
      temperature: 0.3, maxTokens: 0, autoApprove: true
    },
    agents: [], apps: [], sidebarLaunch: ['浏览器'], months: [], taskStatus: [],
    settings: {
      glass: true, ambient: true, compact: false,
      defaultWorkspace: '', resumeLast: true, motion: true, notifyDot: true,
      agentAuto: true, agentConcurrency: '4', agentConfirm: true, localLLM: true,
      autoBackup: true, cloudSync: false,
      ragEnabled: false, ragEndpoint: 'http://127.0.0.1:8000', ragTopK: '8',
      rootDir: '', structureCreated: false, onboarded: false, year: y
    }
  };
  try {
    const w = store.writeData(JSON.stringify(skeleton));
    if (!w || !w.ok) return { ok: false, error: (w && w.error) || '写入失败' };
    return { ok: true, created: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function writeAccountIntoData(account) {
  let data = readDataFile();
  if (!data) {
    const e = ensureDataFile();
    if (!e.ok) return { ok: false, error: '无法创建工作区数据文件：' + (e.error || '未知错误') };
    data = readDataFile();
  }
  if (!data) return { ok: false, error: '无法读取工作区数据文件' };
  if (account) data.__account = account;
  else delete data.__account;
  const r = store.writeData(JSON.stringify(data));
  return r;
}

function accountOf(data) {
  const a = data && data.__account;
  if (!a || typeof a !== 'object' || !a.id) return null;
  return {
    id: String(a.id),
    name: String(a.name || ''),
    createdAt: a.createdAt || '',
    updatedAt: a.updatedAt || ''
  };
}

/* ==========================================================================
   口令：scrypt 加盐，只存散列
   ========================================================================== */
function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), salt, SCRYPT_N.len, {
    N: SCRYPT_N.N, r: SCRYPT_N.r, p: SCRYPT_N.p
  }).toString('hex');
}

function makeCredential(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    algo: SCRYPT_N.algo,
    N: SCRYPT_N.N, r: SCRYPT_N.r, p: SCRYPT_N.p,
    salt,
    hash: hashPass(pass, salt),
    at: Date.now()
  };
}

function verifyCredential(cred, pass) {
  if (!cred || !cred.salt || !cred.hash) return false;
  let h;
  try {
    h = crypto.scryptSync(String(pass), cred.salt, SCRYPT_N.len, {
      N: cred.N || SCRYPT_N.N, r: cred.r || SCRYPT_N.r, p: cred.p || SCRYPT_N.p
    }).toString('hex');
  } catch (_) { return false; }
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(String(cred.hash), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ==========================================================================
   云端凭证加解密（Windows 上走 DPAPI；不可用时降级为明文并明确标记）
   ========================================================================== */
function encryptSecret(plain) {
  const text = String(plain || '');
  if (!text) return { value: '', mode: 'none' };
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return { value: 'enc:' + safeStorage.encryptString(text).toString('base64'), mode: 'os' };
    }
  } catch (_) {}
  /* 降级：明确标记，界面上要提示风险 */
  return { value: 'raw:' + Buffer.from(text, 'utf8').toString('base64'), mode: 'plain' };
}

function decryptSecret(value) {
  const v = String(value || '');
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    }
    if (v.startsWith('raw:')) {
      return Buffer.from(v.slice(4), 'base64').toString('utf8');
    }
  } catch (_) { return ''; }
  return '';
}

/* ==========================================================================
   云端绑定
   ========================================================================== */
function cloudOf(dev) {
  const c = dev && dev.cloud;
  if (!c || typeof c !== 'object' || !c.kind) return null;
  return c;
}

/* 对外的脱敏视图：永远不含密码 */
function publicCloud(c) {
  if (!c) return null;
  const prov = cloud.providerById(c.kind);
  return {
    kind: c.kind,
    providerName: prov ? prov.name : c.kind,
    label: c.label || (prov ? prov.name : c.kind),
    url: c.url || '',
    dir: c.dir || '',
    user: c.user || '',
    boundAt: c.boundAt || 0,
    hasSecret: !!c.secret,
    secretMode: String(c.secret || '').startsWith('enc:') ? 'os'
      : (String(c.secret || '').startsWith('raw:') ? 'plain' : 'none')
  };
}

/* 内部使用：带解密的真实凭证 */
function bindingOf(dev) {
  const c = cloudOf(dev);
  if (!c) {
    /* 兼容 v1.9.0 的「同步文件夹」：只选了目录、没走绑定流程时，视为本地目录载体 */
    if (dev.syncDir) return { kind: 'folder', dir: dev.syncDir, url: '', user: '', pass: '' };
    return null;
  }
  return {
    kind: c.kind,
    url: c.url || '',
    dir: c.dir || '',
    user: c.user || '',
    pass: decryptSecret(c.secret)
  };
}

/* ==========================================================================
   对外状态
   ========================================================================== */
function status() {
  const dev = device.info();
  const data = readDataFile();
  const acc = accountOf(data);
  const cred = dev.credential || null;
  /* v1.9.0 只设了「同步文件夹」的用户：把目录当成 folder 载体显示，不用重绑一次 */
  const c = cloudOf(dev) || (dev.syncDir
    ? { kind: 'folder', dir: dev.syncDir, label: '本地或局域网目录', boundAt: 0, legacy: true }
    : null);

  return {
    ok: true,
    hasAccount: !!acc,
    account: acc,
    hasPass: !!(cred && cred.hash),
    locked: !!(acc && cred && cred.hash) && !unlocked,
    cloud: publicCloud(c),
    binding: !!(c && c.kind),
    providers: cloud.catalog(),
    device: { deviceId: dev.deviceId || '', deviceName: dev.deviceName || '' },
    secretMode: (() => {
      try { return safeStorage.isEncryptionAvailable() ? 'os' : 'plain'; } catch (_) { return 'plain'; }
    })(),
    /* 数据文件是否已存在（没数据时注册要顺手建一个） */
    hasData: !!data
  };
}

/* ==========================================================================
   注册 / 身份
   ========================================================================== */
function register(opts = {}) {
  const name = String(opts.name || '').trim();
  const pass = String(opts.pass || '');
  if (!name) return { ok: false, error: '请填一个名字' };
  if (name.length > 24) return { ok: false, error: '名字太长了（最多 24 个字符）' };
  if (pass && pass.length < 4) return { ok: false, error: '密码至少 4 位（不想设可以留空）' };

  /* 全新安装没有数据文件是正常状态：直接建一份空工作区，不能把用户卡在注册这一步 */
  const ensured = ensureDataFile();
  if (!ensured.ok) return { ok: false, error: '无法创建工作区数据文件：' + (ensured.error || '未知错误') };

  const data = readDataFile();
  if (!data) return { ok: false, error: '无法读取工作区数据文件，请重启软件后再试' };
  if (accountOf(data)) return { ok: false, error: '这个工作台已经有身份了' };

  const account = {
    id: 'u' + crypto.randomBytes(6).toString('hex'),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const w = writeAccountIntoData(account);
  if (!w || !w.ok) return { ok: false, error: '写入身份失败：' + ((w && w.error) || '未知错误') };

  const dev = device.info();
  if (pass) dev.credential = makeCredential(pass);
  device.write(dev);
  unlocked = true;

  return { ok: true, account, hasPass: !!pass, status: status() };
}

function renameAccount(name) {
  const next = String(name || '').trim();
  if (!next) return { ok: false, error: '名字不能为空' };
  const data = readDataFile();
  const acc = accountOf(data);
  if (!acc) return { ok: false, error: '还没有身份' };
  acc.name = next;
  acc.updatedAt = new Date().toISOString();
  const w = writeAccountIntoData(acc);
  if (!w || !w.ok) return { ok: false, error: '保存失败' };
  return { ok: true, account: acc };
}

/* ==========================================================================
   本机密码
   ========================================================================== */
function setPass(pass) {
  const p = String(pass || '');
  if (p.length < 4) return { ok: false, error: '密码至少 4 位' };
  const data = readDataFile();
  if (!accountOf(data)) return { ok: false, error: '还没有身份，先注册' };
  const dev = device.info();
  dev.credential = makeCredential(p);
  const w = device.write(dev);
  if (!w || !w.ok) return { ok: false, error: '保存失败' };
  unlocked = true;
  return { ok: true, status: status() };
}

function clearPass() {
  const dev = device.info();
  delete dev.credential;
  device.write(dev);
  unlocked = true;
  return { ok: true, status: status() };
}

function unlock(pass) {
  const dev = device.info();
  const cred = dev.credential;
  if (!cred || !cred.hash) { unlocked = true; return { ok: true, status: status() }; }
  if (!verifyCredential(cred, pass)) {
    return { ok: false, error: '密码不对', status: status() };
  }
  unlocked = true;
  return { ok: true, status: status() };
}

function lock() {
  const dev = device.info();
  if (dev.credential && dev.credential.hash) {
    unlocked = false;
    return { ok: true, locked: true };
  }
  return { ok: false, error: '还没有设置本机密码' };
}

/* 启动时自动调用：有密码就锁上 */
function bootLock() {
  const dev = device.info();
  unlocked = !(dev.credential && dev.credential.hash);
  return { locked: !unlocked };
}

/* ==========================================================================
   云端绑定 / 换绑 / 解绑
   ========================================================================== */
async function testCloud(cfg = {}) {
  const kind = String(cfg.kind || '');
  const prov = cloud.providerById(kind);
  if (!prov) return { ok: false, error: '未知的云端类型' };
  if (prov.status === 'planned') return { ok: false, error: `${prov.name} 还没接入，需要 OAuth 授权` };

  const rawDir = String(cfg.dir || '').trim();
  const binding = {
    kind,
    url: String(cfg.url || '').trim(),
    /* 只有 WebDAV 才有默认子目录；本地目录必须由用户明确指定 */
    dir: rawDir || (kind === 'webdav' ? cloud.DEFAULT_DIR : ''),
    user: String(cfg.user || '').trim(),
    pass: String(cfg.pass || '')
  };
  if (kind === 'webdav') {
    if (!binding.url) return { ok: false, error: '请填服务器地址' };
    if (!binding.user) return { ok: false, error: '请填账号' };
    if (!binding.pass) return { ok: false, error: '请填应用密码' };
    if (!/^https?:\/\//i.test(binding.url)) return { ok: false, error: '地址要以 http:// 或 https:// 开头' };
  }
  if (kind === 'folder' && !binding.dir) return { ok: false, error: '请选择目录' };

  try {
    const r = await cloud.test(binding);
    return { ok: true, ...r, dir: binding.dir };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function bind(cfg = {}) {
  const t = await testCloud(cfg);
  if (!t.ok) return t;

  const dev = device.info();
  const kind = String(cfg.kind);
  const prov = cloud.providerById(kind);
  const accountText = String(cfg.user || '').trim();

  const secret = kind === 'webdav' ? encryptSecret(String(cfg.pass || '')) : { value: '', mode: 'none' };
  dev.cloud = {
    kind,
    url: String(cfg.url || '').trim(),
    dir: String(cfg.dir || '').trim() || (kind === 'webdav' ? cloud.DEFAULT_DIR : ''),
    user: accountText,
    secret: secret.value,
    secretMode: secret.mode,
    label: prov ? prov.name : kind,
    boundAt: Date.now()
  };
  const w = device.write(dev);
  if (!w || !w.ok) return { ok: false, error: '保存绑定失败' };

  /* 绑定成功后把云端目录建出来，免得第一次同步还要单独处理 */
  let dirReady = true; let dirNote = '';
  try {
    const d = await cloud.ensureDir(bindingOf(dev));
    dirReady = !!(d && d.ok);
    if (!dirReady) dirNote = (d && d.error) || '目录创建失败';
  } catch (err) { dirReady = false; dirNote = String((err && err.message) || err); }

  return {
    ok: true, status: status(), needCreate: !!t.needCreate,
    dirReady, dirNote,
    secretMode: secret.mode
  };
}

function unbind() {
  const dev = device.info();
  const had = cloudOf(dev);
  delete dev.cloud;
  device.write(dev);
  /* 云端里的设备副本不删：换绑后旧云端的数据还在，撤回需要用户自己去网盘删 */
  return { ok: true, had: !!had, status: status() };
}

/* 清除本机授权（换人用这台电脑时用）：解绑 + 删本机密码 + 锁上 */
function resetLocal() {
  const dev = device.info();
  delete dev.credential;
  delete dev.cloud;
  device.write(dev);
  unlocked = false;
  return { ok: true, status: status() };
}

/* ==========================================================================
   给同步引擎用
   ========================================================================== */
function currentBinding() {
  const dev = device.info();
  return bindingOf(dev);
}

function deviceId() {
  return device.info().deviceId || '';
}

module.exports = {
  status, register, renameAccount,
  setPass, clearPass, unlock, lock, bootLock,
  testCloud, bind, unbind, resetLocal,
  currentBinding, deviceId,
  /* 测试用 */
  ensureDataFile,
  _internals: { makeCredential, verifyCredential, encryptSecret, decryptSecret, readDataFile }
};
