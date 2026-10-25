/* ==========================================================================
   共享文件夹同步的双设备端到端验证
   用临时 userData 模拟设备 A，手写一份设备 B 的副本文件，跑完整流程：
   发布副本 → 拉取合并 → 冲突拦截 → 按选择提交 → 幂等
   ========================================================================== */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const os = require('os');
const store = require('./store');
const device = require('./device');
const carrier = require('./sync-carrier');

const mkTask = (id, t, st) => ({ id, t, st, p: 'p1' });

async function run({ outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 200) });
  const readLocal = () => JSON.parse(fs.readFileSync(store.dataFile(), 'utf8'));

  try {
    /* 同步目录必须在应用数据目录之外（真实场景是网盘目录） */
    const shared = path.join(os.tmpdir(), 'rw-sync-shared-' + Date.now());
    fs.mkdirSync(shared, { recursive: true });

    /* ---------- 1. 本机数据 ---------- */
    const base = {
      schemaVersion: 2,
      settings: { glass: true, motion: true, autoBackup: false },
      ai: { provider: 'deepseek', model: 'a' },
      projects: [{ id: 'p1', name: '项目一', folder: '项目一', progress: 10 }],
      tasks: [mkTask('t1', '任务一', 'todo'), mkTask('t2', '任务二', 'todo')],
      todos: [], kbDocs: [], resources: [], automations: [], agents: [],
      templates: [], timeline: [], tombstones: [], chats: {}
    };
    store.writeData(JSON.stringify(base));

    /* ---------- 2. 另一台设备的副本：改一条、删一条、增一条 ---------- */
    const peer = JSON.parse(JSON.stringify(base));
    peer.tasks = [mkTask('t1', '任务一', 'done'), mkTask('t3', '对方新增', 'todo')];
    peer.tombstones = [{ coll: 'tasks', id: 't2', at: Date.now() }];
    peer.__device = { deviceId: 'devbbbbbb', deviceName: '笔记本B', at: Date.now() };
    const peerFile = path.join(shared, 'workspace-devbbbbbb.json');
    fs.writeFileSync(peerFile, JSON.stringify(peer), 'utf8');

    /* ---------- 3. 选目录 + 首次同步 ---------- */
    rec('拒绝把应用数据目录当同步目录', carrier.setDir(app.getPath('userData')).ok === false);
    const setr = carrier.setDir(shared);
    rec('可以选择同步目录', setr.ok === true && setr.dir === path.resolve(shared), setr.dir);

    /* 首次同步没有 base：同一条记录两边内容不同 → 先让用户选，不静默覆盖 */
    const r1 = carrier.run({});
    rec('首次同步先返回冲突清单而不直接覆盖',
      r1.ok === true && r1.needsChoice === true && (r1.conflicts || []).length === 1,
      (r1.conflicts || []).map(c => c.id).join(',') || JSON.stringify(r1.stats || {}));
    rec('未确认前本地保持原样', (readLocal().tasks.find(t => t.id === 't1') || {}).st === 'todo');

    const cid1 = (r1.conflicts || [])[0] && r1.conflicts[0].id;
    const r1b = carrier.run({ choices: { [cid1]: 'remote' } });
    rec('按选择提交后写回本机', r1b.ok === true && r1b.applied === true, JSON.stringify(r1b.stats || {}));
    const a1 = readLocal();
    rec('取到对方对 t1 的修改', (a1.tasks.find(t => t.id === 't1') || {}).st === 'done', (a1.tasks.find(t => t.id === 't1') || {}).st);
    rec('墓碑让对方的删除生效（t2 消失）', !a1.tasks.find(t => t.id === 't2'));
    rec('取到对方新增的 t3', !!a1.tasks.find(t => t.id === 't3'));

    const selfId = device.info().deviceId;
    rec('本机副本已发布到同步目录', fs.existsSync(path.join(shared, `workspace-${selfId}.json`)));
    rec('base 快照已生成', fs.existsSync(carrier.baseFile()));
    const selfFile = JSON.parse(fs.readFileSync(path.join(shared, `workspace-${selfId}.json`), 'utf8'));
    rec('本机副本带设备标识', selfFile.__device && selfFile.__device.deviceId === selfId, selfFile.__device && selfFile.__device.deviceName);
    rec('同步状态可读', (carrier.info().lastSyncAt || 0) > 0 && carrier.info().peers.length === 1);

    /* ---------- 4. 制造冲突 ---------- */
    const cur = readLocal();
    cur.tasks.find(t => t.id === 't1').st = 'doing';
    store.writeData(JSON.stringify(cur));

    const peer2 = JSON.parse(JSON.stringify(peer));
    peer2.tasks = [mkTask('t1', '任务一', 'review'), mkTask('t3', '对方新增', 'todo')];
    peer2.tombstones = peer.tombstones;
    peer2.__device.at = Date.now();
    fs.writeFileSync(peerFile, JSON.stringify(peer2), 'utf8');

    const r2 = carrier.run({});
    rec('有冲突时先返回清单、不写盘', r2.ok === true && r2.needsChoice === true && (r2.conflicts || []).length === 1,
      (r2.conflicts || []).map(c => c.id + '/' + c.kind).join(','));
    const mid = readLocal();
    rec('未确认前本地保持原样', mid.tasks.find(t => t.id === 't1').st === 'doing', mid.tasks.find(t => t.id === 't1').st);
    const c = (r2.conflicts || [])[0] || {};
    rec('冲突带出差异字段与两边值', (c.fields || []).includes('st') && c.local && c.remote, 'fields=' + (c.fields || []).join(','));

    const r3 = carrier.run({ choices: { [c.id]: 'remote' } });
    rec('按选择提交成功', r3.ok === true && r3.applied === true, '');
    const a3 = readLocal();
    rec('冲突按选择落到对方版本', (a3.tasks.find(t => t.id === 't1') || {}).st === 'review', (a3.tasks.find(t => t.id === 't1') || {}).st);

    /* ---------- 5. 再同步一次应无变化 ---------- */
    const r4 = carrier.run({});
    rec('无变化时同步幂等', r4.ok === true && r4.applied === true && (r4.stats.updated || 0) === 0,
      JSON.stringify(r4.stats || {}));

    /* ---------- 6. 换一个空目录：要先发布自己那份 ---------- */
    const shared2 = path.join(os.tmpdir(), 'rw-sync-shared2-' + Date.now());
    fs.mkdirSync(shared2, { recursive: true });
    carrier.setDir(shared2);
    const r5 = carrier.run({});
    rec('空目录首次同步会发布本机副本', r5.ok === true && r5.applied === true &&
      fs.existsSync(path.join(shared2, `workspace-${selfId}.json`)), r5.message || '');

    /* ---------- 7. 坏副本不应拖垮同步 ---------- */
    fs.writeFileSync(path.join(shared2, 'workspace-broken.json'), '{ not json', 'utf8');
    const r6 = carrier.run({});
    rec('坏掉的设备副本被跳过而不是报错', r6.ok === true, (r6.broken || []).join(','));
  } catch (err) {
    rec('探针执行异常', false, String((err && err.stack) || err).slice(0, 400));
  }

  const payload = { ok: rows.every(r => r.pass), total: rows.length, pass: rows.filter(r => r.pass).length, rows };
  try { fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8'); } catch (_) {}
  return payload;
}

module.exports = { run };
