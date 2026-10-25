/* ==========================================================================
   云端同步（绑定坚果云 / 本地目录之后走这条）
   - 与「同步文件夹」共用同一套合并逻辑（sync-carrier.applyMerge）
   - 区别只在"远端在哪"：这里通过 cloud.js 的载体接口，可以是 WebDAV，也可以是本地目录
   - 每台设备仍然只写自己那份 workspace-<deviceId>.json，不抢同一个文件
   ========================================================================== */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const device = require('./device');
const account = require('./account');
const cloud = require('./cloud');
const carrier = require('./sync-carrier');

const stateFile = () => path.join(app.getPath('userData'), 'sync', 'state.json');

function readState() { return carrier.readJson(stateFile()) || {}; }
function writeState(obj) {
  try {
    carrier.writeJson(stateFile(), obj);
    return true;
  } catch (_) { return false; }
}

/* 换绑云端时必须清掉旧的基准快照：base 描述的是"上一次同步到哪了"，
   换了远端还拿旧 base 去比对，会凭空算出「对方删了 / 本地删了」。 */
function clearBase() {
  try {
    const f = carrier.baseFile();
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  } catch (_) { return false; }
}

function selfFileName() {
  return `workspace-${device.info().deviceId}.json`;
}

/* ==========================================================================
   状态（设置页展示用）
   ========================================================================== */
function info() {
  const dev = device.info();
  const b = account.currentBinding();
  const st = readState();
  const out = {
    ok: true,
    bound: !!b,
    kind: b ? b.kind : '',
    dir: b ? (b.dir || '') : '',
    user: b ? (b.user || '') : '',
    url: b ? (b.url || '') : '',
    selfFile: selfFileName(),
    lastSyncAt: st.lastSyncAt || 0,
    lastPeers: st.peers || 0,
    lastCarrier: st.carrier || '',
    hasBase: fs.existsSync(carrier.baseFile()),
    deviceId: dev.deviceId,
    deviceName: dev.deviceName
  };
  return out;
}

/* 云端里现有的其它设备副本（只列名字，不下载） */
async function peers() {
  const b = account.currentBinding();
  if (!b) return { ok: false, error: '还没有绑定云端', peers: [] };
  try {
    const files = await cloud.list(b);
    const self = selfFileName();
    return {
      ok: true,
      peers: (files || [])
        .filter(f => f.name !== self && /^workspace-[a-z0-9_-]+\.json$/i.test(f.name))
        .map(f => ({ file: f.name, deviceId: (f.name.match(/^workspace-([a-z0-9_-]+)\.json$/i) || [])[1] || '', size: f.size || 0, mtime: f.mtime || 0 }))
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), peers: [] };
  }
}

/* ==========================================================================
   冲突留底
   用户选了"用本地"时，对方的版本会被覆盖——留一份完整快照在
   <userData>/sync/history/ 下，事后能查、能找回。只保留最近 20 份。
   ========================================================================== */
function saveConflictHistory(conflicts, choices, meta = {}) {
  try {
    const dir = path.join(app.getPath('userData'), 'sync', 'history');
    fs.mkdirSync(dir, { recursive: true });
    const at = Date.now();
    const stamp = new Date(at).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `conflict-${stamp}.json`);
    const payload = {
      at,
      atText: new Date(at).toLocaleString('zh-CN'),
      device: device.info().deviceName || '',
      carrier: meta.carrier || '',
      peers: meta.peers || [],
      note: '每条冲突的两版都在这里；choice 表示这次实际采用了哪一边',
      conflicts: conflicts.map(c => ({
        coll: c.coll,
        id: c.id,
        label: c.label || c.key,
        kind: c.kind,
        choice: (choices && choices[c.id]) || 'local',
        fields: c.fields || [],
        local: c.local,
        remote: c.remote
      }))
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    const files = fs.readdirSync(dir).filter(f => f.startsWith('conflict-')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 20))) {
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
    }
    return file;
  } catch (_) {
    return '';
  }
}

/* ==========================================================================
   执行一次同步
   @param {{choices?:object, force?:boolean}} opts
   ========================================================================== */
async function run(opts = {}) {
  const b = account.currentBinding();
  if (!b) return { ok: false, error: '还没有绑定云端' };

  const dev = device.info();
  const self = selfFileName();
  const local = carrier.localPayload();
  const base = carrier.readJson(carrier.baseFile()) || {};

  /* 1. 列目录 */
  let files;
  try {
    files = await cloud.list(b);
  } catch (err) {
    return { ok: false, error: '读取云端失败：' + String((err && err.message) || err) };
  }

  const peerFiles = (files || []).filter(f => f.name !== self && /^workspace-[a-z0-9_-]+\.json$/i.test(f.name));

  /* 2. 逐个下载 */
  const remotes = [];
  for (const f of peerFiles) {
    try {
      const text = await cloud.get(b, f.name);
      if (!text) { remotes.push({ name: f.name, error: '空文件' }); continue; }
      remotes.push({ name: f.name, data: JSON.parse(text) });
    } catch (err) {
      remotes.push({ name: f.name, error: String((err && err.message) || err) });
    }
  }

  /* 3. 合并（与目录载体同一套） */
  /* 同步策略：merge（默认三方合并）/ local（冲突全用本机）/ remote（冲突全用云端）。
     策略只影响"两边都改过同一条"这类冲突，单边改动照常合入。 */
  const prefer = (opts.prefer === 'local' || opts.prefer === 'remote') ? opts.prefer : '';
  const r = carrier.applyMerge({
    local, remotes, base: base || undefined, choices: opts.choices || {}, prefer
  });

  /* 4. 有冲突且没做选择：只回报，不写任何东西。
     注意必须按"有没有实际选择项"判断：空对象 {} 是 truthy，
     用它判断会让冲突被静默按本地处理 */
  const hasChoices = !!(opts.choices && Object.keys(opts.choices).length);
  /* 用户已经明确表态（逐条选择 或 整体策略）就不再拦；都没表态才拦下来问 */
  if (r.conflicts.length && !hasChoices && !prefer && !opts.force) {
    return {
      ok: true, applied: false, needsChoice: true,
      conflicts: r.conflicts, stats: { ...r.stats, peers: peerFiles.length },
      peers: peerFiles.length, broken: r.broken, carrier: b.kind
    };
  }

  /* 4b. 冲突留底：写盘前把两版都存下来 */
  const conflictBackup = r.conflicts.length
    ? saveConflictHistory(r.conflicts, opts.choices, {
      carrier: b.kind,
      peers: peerFiles.map(f => f.name)
    })
    : '';

  /* 5. 写回本机 */
  const w = store.writeData(JSON.stringify(r.data));
  if (!w || !w.ok) return { ok: false, error: '写回本机失败：' + ((w && w.error) || '未知错误') };

  /* 6. 发布自己那份 */
  const payload = {
    ...r.data,
    __device: {
      deviceId: dev.deviceId,
      deviceName: dev.deviceName,
      at: Date.now(),
      version: app.getVersion()
    }
  };
  const putRes = await cloud.put(b, self, JSON.stringify(payload));
  if (!putRes || !putRes.ok) {
    return { ok: false, error: '上传失败：' + ((putRes && putRes.error) || '未知错误') };
  }

  /* 7. 更新基准与状态 */
  try { carrier.writeJson(carrier.baseFile(), r.data); } catch (_) {}
  const at = Date.now();
  writeState({ ...readState(), lastSyncAt: at, peers: peerFiles.length, carrier: b.kind, deviceId: dev.deviceId });

  return {
    ok: true, applied: true, peers: peerFiles.length, stats: { ...r.stats, peers: peerFiles.length },
    conflicts: r.conflicts, conflictBackup, broken: r.broken, at, file: self, carrier: b.kind,
    prefer: prefer || 'merge',
    message: peerFiles.length ? '' : '已把本机数据发布到云端。到另一台设备登录同一个云端，再点一次同步'
  };
}

/* ==========================================================================
   首次绑定后的「哪边为准」：云端已有数据时，让用户决定合并方式
   - 这里不自动合并，先探查，把情况报给界面
   ========================================================================== */
async function probeRemote() {
  const b = account.currentBinding();
  if (!b) return { ok: false, error: '还没有绑定云端' };
  const p = await peers();
  if (!p.ok) return p;
  const self = selfFileName();
  let selfExists = false;
  try {
    const files = await cloud.list(b);
    selfExists = (files || []).some(f => f.name === self);
  } catch (_) {}
  return { ok: true, peerCount: p.peers.length, peers: p.peers, selfExists, hasRemote: p.peers.length > 0 };
}

module.exports = { info, run, peers, probeRemote, clearBase, selfFileName };
