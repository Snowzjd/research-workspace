/* ==========================================================================
   同步合并引擎（纯逻辑，不碰文件系统、不依赖 Electron）
   - 输入：local / remote / base 三份完整数据对象
   - 输出：合并后的数据 + 冲突清单 + 统计
   - 判定用「内容三方比较」，不依赖设备时钟（两台机器时间不一定一致）
   - 主进程通过 IPC sync:merge 调用；也可直接用 node 跑离线用例
   ========================================================================== */

/* 参与合并的记录集合。activities / audit / apps / workspace 是本机性质，不参与 */
const SYNC_COLLECTIONS = [
  'projects', 'tasks', 'todos', 'kbDocs', 'resources',
  'automations', 'agents', 'templates', 'timeline'
];

/* 本机设置：换设备后应该各用各的 */
const LOCAL_SETTING_KEYS = ['lastRoute', 'onboarded'];

/* 字符串哈希（FNV-1a 32 位）—— 用于老数据补 id 时保持两台设备一致 */
function hash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const LABEL_FIELDS = ['n', 't', 'name', 'l', 'key'];

/* 记录主键：优先 id；没有就用「集合 + 名称」派生，保证两台设备算出同一个值 */
function keyOf(coll, rec) {
  if (!rec || typeof rec !== 'object') return '';
  if (rec.id) return String(rec.id);
  let label = '';
  for (const f of LABEL_FIELDS) { if (rec[f] != null && rec[f] !== '') { label = String(rec[f]); break; } }
  if (!label && coll === 'timeline') label = String(rec.p || '');
  return 'k' + hash(coll + '|' + label);
}

/* 稳定序列化：忽略字段顺序，也忽略 rev（rev 只是「改过」的标记，不是内容） */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach(k => { if (k !== 'rev') o[k] = canon(v[k]); });
    return o;
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function indexBy(coll, arr) {
  const m = new Map();
  (Array.isArray(arr) ? arr : []).forEach(r => {
    if (r && typeof r === 'object') m.set(keyOf(coll, r), r);
  });
  return m;
}

function changedFields(b, l, r) {
  const keys = new Set([...Object.keys(l || {}), ...Object.keys(r || {}), ...Object.keys(b || {})]);
  const out = [];
  keys.forEach(k => {
    if (k === 'rev') return;
    if (!same(l ? l[k] : undefined, r ? r[k] : undefined)) out.push(k);
  });
  return out.slice(0, 8);
}

function labelOf(coll, rec) {
  if (!rec) return '';
  return String(rec.name || rec.n || rec.t || rec.l || rec.p || rec.id || '');
}

/**
 * 合并一个集合。
 * @returns {{ list: any[], conflicts: any[], stats: {added:number, updated:number, removed:number} }}
 */
/* 墓碑索引：coll:id → at（删除时间） */
function tombMap(list, coll) {
  const m = new Map();
  (Array.isArray(list) ? list : []).forEach(t => {
    if (!t || t.coll !== coll || !t.id) return;
    m.set(String(t.id), Math.max(m.get(String(t.id)) || 0, Number(t.at) || 0));
  });
  return m;
}

function mergeCollection(coll, baseArr, localArr, remoteArr, prefer, tombs = {}) {
  const B = indexBy(coll, baseArr);
  const L = indexBy(coll, localArr);
  const R = indexBy(coll, remoteArr);
  /* 墓碑只在「没有 base」时才真正起作用（有 base 时三方比较更准）；
     同时给 2 分钟时钟容差：记录在删除之后又被改过，就不认这条墓碑 */
  const TOL = 120 * 1000;
  const tombKills = (id, rec, tmap) => {
    const at = tmap.get(id);
    if (!at) return false;
    const rev = Number(rec && rec.rev) || 0;
    return rev <= at + TOL;
  };
  const out = [];
  const handled = new Set();
  const conflicts = [];
  const stats = { added: 0, updated: 0, removed: 0 };

  const push = (rec) => { if (rec) out.push(rec); };

  const resolve = (k) => {
    if (handled.has(k)) return;
    handled.add(k);
    let b = B.get(k), l = L.get(k), r = R.get(k);

    /* 没有 base（首次同步 / base 丢失）：墓碑是唯一能证明「确实删过」的信号。
       任一边有墓碑且记录不比删除时间新 → 这条就该消失。 */
    if (!b) {
      const rec = l || r;
      const killed = (tombs.local && tombKills(k, rec, tombs.local))
        || (tombs.remote && tombKills(k, rec, tombs.remote));
      if (killed) { stats.removed++; return; }
    }

    /* 两边都在 */
    if (l && r) {
      if (same(l, r)) { push(l); return; }
      if (b && same(l, b)) { push(r); stats.updated++; return; }   /* 本地没动，取远端 */
      if (b && same(r, b)) { push(l); stats.updated++; return; }   /* 远端没动，取本地 */
      /* 都改了且不一致 */
      conflicts.push({
        id: `${coll}:${k}`, coll, key: k, kind: 'edit',
        label: labelOf(coll, l) || labelOf(coll, r),
        fields: changedFields(b, l, r), local: l, remote: r
      });
      push(prefer === 'remote' ? r : l);
      return;
    }

    /* 只有本地有 */
    if (l && !r) {
      if (!b) { push(l); stats.added++; return; }                  /* 本地新增 */
      if (same(l, b)) { stats.removed++; return; }                 /* 远端删了，本地没动 → 删 */
      conflicts.push({
        id: `${coll}:${k}`, coll, key: k, kind: 'delete-edit',
        label: labelOf(coll, l), deletedOn: 'remote', fields: changedFields(b, l, null),
        local: l, remote: null
      });
      if (prefer !== 'remote') push(l);                            /* 默认保住数据 */
      return;
    }

    /* 只有远端有 */
    if (!l && r) {
      if (!b) { push(r); stats.added++; return; }                  /* 远端新增 */
      if (same(r, b)) { stats.removed++; return; }                 /* 本地删了，远端没动 → 删 */
      conflicts.push({
        id: `${coll}:${k}`, coll, key: k, kind: 'delete-edit',
        label: labelOf(coll, r), deletedOn: 'local', fields: changedFields(b, null, r),
        local: null, remote: r
      });
      /* 默认「改动优先于删除」：宁可多留一条，也不要静默丢掉别人的修改 */
      push(r);
      return;
    }
    /* 两边都没有：无需处理 */
  };

  /* 先按本地顺序，再补远端独有的，保证界面排序稳定 */
  (Array.isArray(localArr) ? localArr : []).forEach(r => resolve(keyOf(coll, r)));
  (Array.isArray(remoteArr) ? remoteArr : []).forEach(r => resolve(keyOf(coll, r)));
  Array.from(B.keys()).forEach(k => { if (!L.has(k) && !R.has(k)) handled.add(k); });

  return { list: out, conflicts, stats };
}

/* 键值对象（settings / ai / chats）的三方合并 */
function mergeObject(baseObj, localObj, remoteObj, opts = {}) {
  const b = baseObj || {}, l = localObj || {}, r = remoteObj || {};
  const skip = new Set(opts.skip || []);
  const out = {};
  const conflicts = [];
  const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
  keys.forEach(k => {
    if (skip.has(k)) { if (k in l) out[k] = l[k]; return; }
    const bv = b[k], lv = l[k], rv = r[k];
    if (same(lv, rv)) { if (lv !== undefined) out[k] = lv; return; }
    if (same(lv, bv)) { if (rv !== undefined) out[k] = rv; else if (opts.keepMissing) out[k] = lv; return; }
    if (same(rv, bv)) { if (lv !== undefined) out[k] = lv; else if (opts.keepMissing) out[k] = rv; return; }
    if (lv !== undefined) out[k] = lv; else if (rv !== undefined) out[k] = rv;
    conflicts.push({
      id: `${opts.coll || 'object'}:${k}`, coll: opts.coll || 'object', key: k,
      kind: 'edit', label: k, fields: [k], local: lv, remote: rv
    });
  });
  return { obj: out, conflicts };
}

/**
 * 主入口。
 * @param {{local:object, remote:object, base?:object, prefer?:'local'|'remote', choices?:object}} p
 * @returns {{ok:boolean, data:object, conflicts:any[], stats:object}}
 */
function merge(p = {}) {
  const local = p.local || {};
  const remote = p.remote || {};
  const base = p.base || {};
  const prefer = p.prefer === 'remote' ? 'remote' : 'local';
  const choices = p.choices || {};

  if (!local || typeof local !== 'object') return { ok: false, error: '本地数据无效', data: remote, conflicts: [], stats: {} };
  if (!remote || typeof remote !== 'object') return { ok: false, error: '对方数据无效', data: local, conflicts: [], stats: {} };

  /* 结果以本地为底（保留 settings 之外的本机字段） */
  const data = JSON.parse(JSON.stringify(local));
  const conflicts = [];
  const stats = { added: 0, updated: 0, removed: 0, collections: {} };

  SYNC_COLLECTIONS.forEach(coll => {
    /* 逐条冲突可由调用方指定偏好 */
    const res = mergeCollection(coll, base[coll], local[coll], remote[coll], prefer, {
      local: tombMap(local.tombstones, coll),
      remote: tombMap(remote.tombstones, coll)
    });
    /* 应用逐条选择：冲突里被指定为 remote 的，用远端版本 */
    const list = res.list.map(rec => {
      const k = keyOf(coll, rec);
      const c = res.conflicts.find(x => x.key === k);
      if (!c) return rec;
      /* 删除冲突的默认值 = 仍然保有这条记录的那一边（改动优先于删除） */
      const side = choices[c.id] || (c.kind === 'delete-edit'
        ? (c.deletedOn === 'local' ? 'remote' : 'local')
        : prefer);
      if (side === 'remote') {
        if (c.kind === 'delete-edit' && c.deletedOn === 'remote') return null;   /* 选择接受远端删除 */
        if (c.kind === 'delete-edit' && c.deletedOn === 'local') return c.remote;
        return c.remote || rec;
      }
      if (side === 'local') {
        if (c.kind === 'delete-edit' && c.deletedOn === 'local') return null;    /* 选择接受本地删除 */
        return c.local || rec;
      }
      return rec;
    }).filter(Boolean);

    data[coll] = list;
    conflicts.push(...res.conflicts);
    stats.added += res.stats.added;
    stats.updated += res.stats.updated;
    stats.removed += res.stats.removed;
    stats.collections[coll] = res.stats;
  });

  /* 设置与 AI 配置：键级合并，本机项跳过 */
  const st = mergeObject(base.settings, local.settings, remote.settings, { coll: 'settings', skip: LOCAL_SETTING_KEYS });
  data.settings = { ...(local.settings || {}), ...st.obj };
  conflicts.push(...st.conflicts);

  const ai = mergeObject(base.ai, local.ai, remote.ai, { coll: 'ai' });
  data.ai = { ...(local.ai || {}), ...ai.obj };
  conflicts.push(...ai.conflicts);

  /* AI 会话：按项目整体合并（消息本身没有 id，不做逐条合并） */
  const ch = mergeObject(base.chats, local.chats, remote.chats, { coll: 'chats' });
  data.chats = { ...(local.chats || {}), ...ch.obj };
  conflicts.push(...ch.conflicts);

  /* 墓碑：两边并集；已存在的记录不留墓碑 */
  const tombs = new Map();
  const addTomb = (list) => (Array.isArray(list) ? list : []).forEach(t => {
    if (!t || !t.coll || !t.id) return;
    const key = `${t.coll}:${t.id}`;
    const prev = tombs.get(key);
    tombs.set(key, { coll: t.coll, id: t.id, at: Math.max(prev ? prev.at : 0, Number(t.at) || 0) });
  });
  addTomb(local.tombstones);
  addTomb(remote.tombstones);
  const alive = new Set();
  SYNC_COLLECTIONS.forEach(coll => (data[coll] || []).forEach(r => alive.add(`${coll}:${keyOf(coll, r)}`)));
  data.tombstones = Array.from(tombs.entries())
    .filter(([k]) => !alive.has(k))
    .map(([, v]) => v)
    .sort((a, b) => b.at - a.at)
    .slice(0, 1000);

  return { ok: true, data, conflicts, stats };
}

/* 给老数据补 id：两台设备对同一条记录必须算出同一个 id（内容派生，不随机） */
function ensureIds(data) {
  let changed = 0;
  SYNC_COLLECTIONS.forEach(coll => {
    const arr = Array.isArray(data[coll]) ? data[coll] : null;
    if (!arr) return;
    const used = new Set();
    arr.forEach(rec => {
      if (!rec || typeof rec !== 'object') return;
      if (!rec.id) { rec.id = keyOf(coll, rec); changed++; }
      /* 冲突兜底：同集合内 id 不建议重复 */
      if (used.has(rec.id)) { rec.id = rec.id + '_' + hash(JSON.stringify(rec)).slice(0, 4); changed++; }
      used.add(rec.id);
    });
  });
  return changed;
}

module.exports = { merge, ensureIds, keyOf, hash, same, SYNC_COLLECTIONS, LOCAL_SETTING_KEYS };
