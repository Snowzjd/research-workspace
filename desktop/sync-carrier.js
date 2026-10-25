/* ==========================================================================
   共享文件夹同步载体
   - 每台设备在同步目录里写自己那份：workspace-<deviceId>.json
   - 同步 = 读其它设备的副本 → 三方合并（base 为上次同步快照）→ 写回本机 + 自己那份
   - 冲突不静默处理：先返回冲突清单，用户逐条选择后再提交
   ========================================================================== */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const device = require('./device');
const { merge } = require('./sync-merge');

const PEER_RE = /^workspace-([a-z0-9_-]+)\.json$/i;

const stateDir = () => path.join(app.getPath('userData'), 'sync');
const baseFile = () => path.join(stateDir(), 'base.json');
const stateFile = () => path.join(stateDir(), 'state.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function readState() {
  return readJson(stateFile()) || {};
}
function writeState(obj) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    const tmp = stateFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, stateFile());
    return true;
  } catch (_) { return false; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, file);
}

/* 同步目录里的其它设备副本 */
function listPeers(dir, selfId) {
  try {
    return fs.readdirSync(dir)
      .filter(f => PEER_RE.test(f) && !f.includes(selfId))
      .map(f => {
        const full = path.join(dir, f);
        let st = { size: 0, mtimeMs: 0 };
        try { st = fs.statSync(full); } catch (_) {}
        const data = readJson(full);
        const meta = (data && data.__device) || {};
        return {
          file: f,
          path: full,
          size: st.size,
          mtime: st.mtimeMs,
          deviceId: meta.deviceId || (f.match(PEER_RE) || [])[1] || '',
          deviceName: meta.deviceName || meta.deviceId || f,
          at: meta.at || st.mtimeMs
        };
      })
      .filter(p => p.deviceId !== selfId)
      .sort((a, b) => a.mtime - b.mtime);
  } catch (_) { return []; }
}

function info() {
  const dev = device.info();
  const dir = dev.syncDir || '';
  const st = readState();
  const peers = dir ? listPeers(dir, dev.deviceId) : [];
  const base = readJson(baseFile());
  return {
    ok: true,
    enabled: !!dir,
    dir,
    dirExists: !!dir && fs.existsSync(dir),
    deviceId: dev.deviceId,
    deviceName: dev.deviceName,
    lastSyncAt: st.lastSyncAt || 0,
    lastPeers: st.peers || 0,
    peers,
    hasBase: !!base
  };
}

/* 设置同步目录（空字符串 = 关闭） */
function setDir(dir) {
  const dev = device.info();
  const raw = String(dir || '').trim();
  if (!raw) {
    dev.syncDir = '';
    device.write(dev);
    return { ok: true, enabled: false };
  }
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) return { ok: false, error: '目录不存在：' + abs };
  if (!fs.statSync(abs).isDirectory()) return { ok: false, error: '不是文件夹：' + abs };

  const ud = path.resolve(app.getPath('userData'));
  if (abs === ud || abs.startsWith(ud + path.sep)) return { ok: false, error: '同步目录不能放在应用数据目录里' };
  const root = String(dev.rootDir || '').trim();
  if (root && (abs === path.resolve(root) || path.resolve(root).startsWith(abs + path.sep))) {
    return { ok: false, error: '同步目录不能是工作区根目录，也不能是它的上级' };
  }

  dev.syncDir = abs;
  device.write(dev);
  return { ok: true, enabled: true, dir: abs };
}

function localPayload() {
  const f = store.dataFile();
  if (!fs.existsSync(f)) return {};
  return readJson(f) || {};
}

/**
 * 合并多份远端数据（纯逻辑，不碰文件系统）。
 * 目录载体和云端载体共用这一段，保证两条路的冲突判定完全一致。
 * @param {{local:object, remotes:Array<{name:string,data?:object,error?:string}>, base?:object, choices?:object}} p
 */
function applyMerge({ local, remotes, base, choices, prefer }) {
  let data = local;
  const conflicts = [];
  const stats = { added: 0, updated: 0, removed: 0 };
  const broken = [];

  (Array.isArray(remotes) ? remotes : []).forEach(item => {
    if (!item || !item.data || typeof item.data !== 'object') {
      if (item && item.name) broken.push(item.name);
      return;
    }
    const remote = { ...item.data };
    delete remote.__device;
    delete remote.__handoff;
    const r = merge({ local: data, remote, base: base || undefined, choices: choices || {}, prefer: prefer || undefined });
    if (!r || !r.ok) { broken.push(item.name); return; }
    data = r.data;
    stats.added += r.stats.added || 0;
    stats.updated += r.stats.updated || 0;
    stats.removed += r.stats.removed || 0;
    (r.conflicts || []).forEach(c => { if (!conflicts.some(x => x.id === c.id)) conflicts.push(c); });
  });

  return { data, conflicts, stats, broken };
}

/**
 * 执行一次同步。
 * @param {{choices?:object, force?:boolean}} opts
 *   - 有冲突且未提供 choices/force 时：只返回冲突，不写任何文件
 */
function run(opts = {}) {
  const dev = device.info();
  const dir = dev.syncDir || '';
  if (!dir) return { ok: false, error: '还没有选择同步目录' };
  if (!fs.existsSync(dir)) return { ok: false, error: '同步目录不可用：' + dir };

  const local = localPayload();
  const base = readJson(baseFile()) || {};
  const peers = listPeers(dir, dev.deviceId);

  if (!peers.length) {
    /* 只有自己：发布本机副本，并把当前数据作为 base（下次与其它设备对比用） */
    try {
      writeJson(path.join(dir, `workspace-${dev.deviceId}.json`), {
        ...local,
        __device: { deviceId: dev.deviceId, deviceName: dev.deviceName, at: Date.now(), version: app.getVersion() }
      });
      writeJson(baseFile(), local);
    } catch (err) {
      return { ok: false, error: '写同步副本失败：' + String((err && err.message) || err) };
    }
    const at0 = Date.now();
    writeState({ lastSyncAt: at0, peers: 0, deviceId: dev.deviceId });
    return {
      ok: true, applied: true, peers: 0, at: at0, stats: { added: 0, updated: 0, removed: 0 },
      message: base ? '已发布本机副本（当前没有其它设备）' : '已发布本机副本。到另一台设备上选择同一个目录，再点一次同步'
    };
  }

  let data = local;
  const conflicts = [];
  let stats = { added: 0, updated: 0, removed: 0, peers: peers.length };
  let broken = [];

  {
    const remotes = peers.map(peer => ({ name: peer.file, data: readJson(peer.path) }));
    const r = applyMerge({ local, remotes, base: base || undefined, choices: opts.choices || {} });
    data = r.data;
    stats = { ...r.stats, peers: peers.length };
    broken = r.broken;
    r.conflicts.forEach(c => { if (!conflicts.some(x => x.id === c.id)) conflicts.push(c); });
  }

  const needChoice = conflicts.length > 0 && !opts.choices && !opts.force;
  if (needChoice) {
    return {
      ok: true, applied: false, needsChoice: true,
      conflicts, stats, peers: peers.length, broken
    };
  }

  /* 写回本机（store 会顺带处理本机字段分流） */
  const payload = JSON.stringify(data);
  const w = store.writeData(payload);
  if (!w.ok) return { ok: false, error: '写回本机失败：' + (w.error || '未知错误') };

  /* 写自己的副本，供其它设备拉取 */
  const selfFile = path.join(dir, `workspace-${dev.deviceId}.json`);
  try {
    writeJson(selfFile, {
      ...data,
      __device: { deviceId: dev.deviceId, deviceName: dev.deviceName, at: Date.now(), version: app.getVersion() }
    });
  } catch (err) {
    return { ok: false, error: '写同步副本失败：' + String((err && err.message) || err) };
  }

  /* 更新 base 快照（下次同步的三方基准） */
  try { writeJson(baseFile(), data); } catch (_) {}

  const at = Date.now();
  writeState({ lastSyncAt: at, peers: peers.length, deviceId: dev.deviceId });

  return {
    ok: true, applied: true, peers: peers.length, stats, conflicts,
    at, broken, file: selfFile
  };
}

module.exports = { info, setDir, run, listPeers, baseFile, stateDir, applyMerge, localPayload, readJson, writeJson };
