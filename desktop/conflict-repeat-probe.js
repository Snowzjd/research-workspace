/* ==========================================================================
   冲突重复询问验证
   守住三件事：
     1. 每次同步有冲突都重新询问（绝不记忆上次的选择）
     2. 空选择集合（{}）不算"已选择"——否则会静默按本地覆盖
     3. 冲突写盘前留底（两版都在）
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const store = require('./store');
const device = require('./device');
const account = require('./account');
const syncCloud = require('./sync-cloud');
const carrier = require('./sync-carrier');
const mockDav = require('./mock-webdav');

const baseData = (taskSt) => ({
  schemaVersion: 2,
  settings: { glass: true, motion: true, autoBackup: false },
  projects: [{ id: 'p1', name: '项目一', folder: '项目一', progress: 10 }],
  tasks: [
    { id: 't1', t: '任务一', st: taskSt, p: 'p1' },
    { id: 't2', t: '任务二', st: 'todo', p: 'p1' }
  ],
  todos: [], kbDocs: [], resources: [], automations: [], agents: [],
  templates: [], timeline: [], tombstones: [], chats: {}
});

async function run({ outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 220)
  });
  const readLocal = () => JSON.parse(fs.readFileSync(store.dataFile(), 'utf8'));
  let dav = null;

  try {
    /* 建议一份带 rev 的数据：模拟"已经同步过一次" */
    store.writeData(JSON.stringify(baseData('todo')));
    dav = await mockDav.start({ user: 'zs@example.com', pass: 'app-pass-123' });
    const bind = await account.bind({
      kind: 'webdav', url: dav.base, dir: '/ResearchWorkspace',
      user: 'zs@example.com', pass: 'app-pass-123'
    });
    rec('绑定测试云端', bind.ok, bind.error || 'ok');

    const selfId = device.info().deviceId;
    const peerFile = '/ResearchWorkspace/workspace-devpeer001.json';

    /* 第一次：把本机数据发布出去（同时建立 base） */
    const s0 = await syncCloud.run({});
    rec('首次同步发布本机数据', s0.ok && s0.applied, s0.error || `peers=${s0.peers}`);

    /* 云端放一份和本机一致的副本 → 作为"另一台" */
    dav.seed(peerFile, { ...baseData('todo'), __device: { deviceId: 'devpeer001', deviceName: '笔记本B', at: Date.now() } });
    const s1 = await syncCloud.run({ force: true });
    rec('两边内容一致时同步无冲突', s1.ok && !(s1.conflicts || []).length, `冲突 ${(s1.conflicts || []).length}`);

    /* ---------- 第 1 轮冲突：两边都改 t1 ---------- */
    const local1 = readLocal(); local1.tasks.find(t => t.id === 't1').st = 'doing';
    store.writeData(JSON.stringify(local1));
    dav.seed(peerFile, { ...baseData('done'), __device: { deviceId: 'devpeer001', deviceName: '笔记本B', at: Date.now() } });

    const c1 = await syncCloud.run({});
    rec('第 1 次冲突：返回待询问', c1.ok && c1.needsChoice === true, `冲突 ${(c1.conflicts || []).length}`);
    rec('未确认前不写本机', readLocal().tasks.find(t => t.id === 't1').st === 'doing');

    /* 空选择集合：必须仍被拦住（这是修掉的漏洞） */
    const empty = await syncCloud.run({ choices: {} });
    rec('空选择集合仍会拦住冲突（不静默覆盖）',
      empty.ok && empty.needsChoice === true, empty.needsChoice ? '已拦住' : '被静默写入了');

    /* 按"用本地"提交 */
    const a1 = await syncCloud.run({ choices: { 'tasks:t1': 'local' } });
    rec('按「用本地」应用后生效',
      a1.ok && a1.applied && readLocal().tasks.find(t => t.id === 't1').st === 'doing', JSON.stringify(a1.stats));
    const histDir = path.join(app_dir(), 'sync', 'history');
    const hist1 = fs.existsSync(histDir) ? fs.readdirSync(histDir).filter(f => f.startsWith('conflict-')) : [];
    rec('冲突两版已留底', hist1.length >= 1, hist1.join(',') || '无文件');
    if (hist1.length) {
      const payload = JSON.parse(fs.readFileSync(path.join(histDir, hist1[hist1.length - 1]), 'utf8'));
      const c0 = (payload.conflicts || [])[0] || {};
      rec('留底里同时有本地版与对方版',
        !!c0.local && !!c0.remote && c0.choice === 'local', `choice=${c0.choice}`);
    } else {
      rec('留底里同时有本地版与对方版', false, '没有历史文件');
    }

    /* ---------- 第 2 轮冲突：验证"不记忆上次选择" ---------- */
    const local2 = readLocal(); local2.tasks.find(t => t.id === 't1').st = 'paused';
    store.writeData(JSON.stringify(local2));
    dav.seed(peerFile, { ...baseData('done'), tasks: [
      { id: 't1', t: '任务一', st: 'done', p: 'p1' },
      { id: 't2', t: '任务二', st: 'todo', p: 'p1' }
    ], __device: { deviceId: 'devpeer001', deviceName: '笔记本B', at: Date.now() } });

    const c2 = await syncCloud.run({});
    rec('第 2 次冲突：仍然重新询问（不记忆上次选择）',
      c2.ok && c2.needsChoice === true,
      c2.needsChoice ? `再次询问 ${(c2.conflicts || []).length} 条` : '没有询问，直接写入了');

    const a2 = await syncCloud.run({ choices: { 'tasks:t1': 'remote' } });
    rec('这次选"用对方"能正确采用对方版本',
      a2.ok && a2.applied && readLocal().tasks.find(t => t.id === 't1').st === 'done',
      readLocal().tasks.find(t => t.id === 't1').st);

    /* ---------- 第 3 轮：整体策略「以云端为准」 ---------- */
    const local3 = readLocal(); local3.tasks.find(t => t.id === 't1').st = 'todo';
    store.writeData(JSON.stringify(local3));
    dav.seed(peerFile, { ...baseData('doing'), __device: { deviceId: 'devpeer001', deviceName: '笔记本B', at: Date.now() } });

    const m3 = await syncCloud.run({ prefer: 'remote' });
    rec('策略「以云端为准」不弹窗且采用云端版本',
      m3.ok && m3.applied && m3.prefer === 'remote' && readLocal().tasks.find(t => t.id === 't1').st === 'doing',
      `prefer=${m3.prefer} → ${readLocal().tasks.find(t => t.id === 't1').st}`);

    /* ---------- 第 4 轮：整体策略「以本机为准」 ---------- */
    const local4 = readLocal(); local4.tasks.find(t => t.id === 't1').st = 'paused';
    store.writeData(JSON.stringify(local4));
    dav.seed(peerFile, { ...baseData('done'), __device: { deviceId: 'devpeer001', deviceName: '笔记本B', at: Date.now() } });

    const m4 = await syncCloud.run({ prefer: 'local' });
    rec('策略「以本机为准」不弹窗且保留本机版本',
      m4.ok && m4.applied && m4.prefer === 'local' && readLocal().tasks.find(t => t.id === 't1').st === 'paused',
      `prefer=${m4.prefer} → ${readLocal().tasks.find(t => t.id === 't1').st}`);

    /* 单边改动仍会合入（策略只影响冲突） */
    const peerOnly = baseData('paused'); peerOnly.tasks.push({ id: 't9', t: '对方新增', st: 'todo', p: 'p1' });
    dav.seed(peerFile, { ...peerOnly, __device: { deviceId: 'devpeer001', deviceName: '笔记本B', at: Date.now() } });
    const m5 = await syncCloud.run({ prefer: 'local' });
    rec('策略为「本机为准」时，对方的单边新增仍会合入',
      m5.ok && m5.applied && readLocal().tasks.some(t => t.id === 't9'),
      readLocal().tasks.map(t => t.id).join(','));
  } catch (err) {
    rec('未捕获异常', false, String((err && err.stack) || err));
  } finally {
    try { if (dav) await dav.stop(); } catch (_) {}
  }

  const pass = rows.filter(r => r.pass).length;
  const out = { ok: pass === rows.length && rows.length > 0, pass, total: rows.length, rows, at: new Date().toISOString() };
  for (const t of [outPath, path.join(os.tmpdir(), 'rw-probe-conflict-repeat.json')]) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

function app_dir() {
  return require('electron').app.getPath('userData');
}

module.exports = { run };
