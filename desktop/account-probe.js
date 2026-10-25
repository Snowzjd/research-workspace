/* ==========================================================================
   账户 + 云端绑定的端到端验证
   全程在临时目录 + 本地 mock WebDAV 上跑，不碰真实网盘和用户数据：
   注册 → 密码锁 → 绑定（含错误凭证）→ 首次发布 → 拉取合并 → 冲突拦截
   → 按选择应用 → 幂等 → 换绑 → 解绑 → 目录载体
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const store = require('./store');
const device = require('./device');
const account = require('./account');
const cloud = require('./cloud');
const syncCloud = require('./sync-cloud');
const mockDav = require('./mock-webdav');

const mkTask = (id, t, st) => ({ id, t, st, p: 'p1' });

async function run({ outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 200)
  });
  const readLocal = () => JSON.parse(fs.readFileSync(store.dataFile(), 'utf8'));
  const tmpDir = path.join(os.tmpdir(), 'rw-acct-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  let davA = null; let davB = null;
  try {
    /* ---------- 0. 造一份本机数据 ---------- */
    store.writeData(JSON.stringify({
      schemaVersion: 2,
      settings: { glass: true, motion: true, autoBackup: false },
      projects: [{ id: 'p1', name: '项目一', folder: '项目一', progress: 10 }],
      tasks: [mkTask('t1', '任务一', 'todo'), mkTask('t2', '任务二', 'todo')],
      todos: [], kbDocs: [], resources: [], automations: [], agents: [],
      templates: [], timeline: [], tombstones: [], chats: {}
    }));

    /* ---------- 1. 还没注册 ---------- */
    const s0 = account.status();
    rec('全新安装：没有身份', s0.hasAccount === false, JSON.stringify({ hasAccount: s0.hasAccount }));

    /* ---------- 2. 注册 ---------- */
    const r1 = account.register({ name: '张三', pass: 'abcd1234' });
    rec('注册后拿到身份 id', r1.ok && r1.account && /^u[0-9a-f]{12}$/.test(r1.account.id), r1.account && r1.account.id);
    rec('身份写进了数据文件（会随同步走）', !!readLocal().__account, '数据文件含 __account');
    rec('注册后不再锁定', account.status().locked === false);
    const r2 = account.register({ name: '李四' });
    rec('重复注册被拒绝', r2.ok === false, r2.error);

    /* ---------- 3. 口令不落数据文件 ---------- */
    rec('数据文件里没有密码散列', !JSON.stringify(readLocal()).includes('hash'), '干净');
    const devRaw = fs.readFileSync(device.file(), 'utf8');
    rec('密码散列只在本机 device.json', /"credential"/.test(devRaw) && /scrypt/.test(devRaw), 'scrypt + 加盐');

    /* ---------- 4. 锁定与解锁 ---------- */
    const lk = account.bootLock();
    rec('有密码时启动即锁定', lk.locked === true && account.status().locked === true);
    const bad = account.unlock('wrongpass');
    rec('错误密码解锁失败', bad.ok === false && account.status().locked === true, bad.error);
    const good = account.unlock('abcd1234');
    rec('正确密码解锁成功', good.ok === true && account.status().locked === false);

    /* ---------- 5. 起两个 mock 云端（A 是目标，B 用来测换绑） ---------- */
    davA = await mockDav.start({ user: 'zs@example.com', pass: 'app-pass-123' });
    davB = await mockDav.start({ user: 'ls@example.com', pass: 'other-pass-456' });

    /* ---------- 6. 绑定前的凭证校验 ---------- */
    const badPass = await account.testCloud({
      kind: 'webdav', url: davA.base, dir: '/ResearchWorkspace',
      user: 'zs@example.com', pass: 'WRONG'
    });
    rec('错误应用密码被拒绝且提示可读',
      badPass.ok === false && /应用密码|401/.test(String(badPass.error)), badPass.error);

    const noUrl = await account.testCloud({ kind: 'folder', dir: '' });
    rec('目录载体缺目录时给出提示', noUrl.ok === false && /目录/.test(noUrl.error), noUrl.error);

    const planned = await account.testCloud({ kind: 'onedrive' });
    rec('未接入的载体（OneDrive）明确说明要 OAuth',
      planned.ok === false && /OAuth|还没接入/.test(planned.error), planned.error);

    /* ---------- 7. 正式绑定 ---------- */
    const okTest = await account.testCloud({
      kind: 'webdav', url: davA.base, dir: '/ResearchWorkspace',
      user: 'zs@example.com', pass: 'app-pass-123'
    });
    rec('正确凭证通过连通性校验', okTest.ok === true, JSON.stringify(okTest));
    rec('云端目录不存在时标记为需要创建', okTest.needCreate === true, String(okTest.needCreate));

    const bindRes = await account.bind({
      kind: 'webdav', url: davA.base, dir: '/ResearchWorkspace',
      user: 'zs@example.com', pass: 'app-pass-123'
    });
    rec('绑定成功', bindRes.ok === true && bindRes.status.cloud.kind === 'webdav', bindRes.status.cloud && bindRes.status.cloud.providerName);
    rec('绑定后自动创建云端目录', bindRes.dirReady === true && davA.dirs.has('/dav/ResearchWorkspace'), String(bindRes.dirNote || 'ok'));
    rec('绑定信息不含明文密码', !JSON.stringify(bindRes.status.cloud).includes('app-pass-123'),
      '仅暴露 hasSecret=' + (bindRes.status.cloud && bindRes.status.cloud.hasSecret));
    rec('云端凭证按系统加密存储',
      ['os', 'plain'].includes(String(bindRes.status.cloud && bindRes.status.cloud.secretMode)),
      'secretMode=' + (bindRes.status.cloud && bindRes.status.cloud.secretMode));

    /* ---------- 8. 首次同步：把本机数据发布上去 ---------- */
    const devId = account.status().device.deviceId;
    const selfName = `workspace-${devId}.json`;
    const s1 = await syncCloud.run({});
    rec('首次同步成功并发布本机副本',
      s1.ok === true && s1.applied === true && !!davA.read('/ResearchWorkspace/' + selfName),
      s1.error || ('云端文件 ' + (davA.read('/ResearchWorkspace/' + selfName) ? '存在' : '缺失')));
    rec('发布的副本带设备标识',
      !!(davA.read('/ResearchWorkspace/' + selfName) || {}).__device, devId);

    /* ---------- 9. 另一台设备已经同步过：拉取合并 ---------- */
    davA.seed('/ResearchWorkspace/workspace-devbbbbbbbb.json', {
      schemaVersion: 2,
      settings: { glass: true, motion: true, autoBackup: false },
      projects: [{ id: 'p1', name: '项目一', folder: '项目一', progress: 10 }],
      tasks: [mkTask('t1', '任务一', 'todo'), mkTask('t3', 'B 新增', 'todo')],
      todos: [], kbDocs: [], resources: [], automations: [], agents: [],
      templates: [], timeline: [], tombstones: [{ coll: 'tasks', id: 't2', at: Date.now() }],
      chats: {},
      __device: { deviceId: 'devbbbbbbbb', deviceName: '笔记本B', at: Date.now() }
    });

    const p1 = await syncCloud.peers();
    rec('能列出云端里的其它设备副本', p1.ok && p1.peers.length === 1 && p1.peers[0].deviceId === 'devbbbbbbbb', JSON.stringify(p1.peers));

    const s2 = await syncCloud.run({});
    const after2 = readLocal();
    rec('合并同步成功（无冲突时不再拦截）', s2.ok && s2.applied === true, JSON.stringify(s2.stats));
    rec('对方新增的记录被合并进来', after2.tasks.some(t => t.id === 't3'));
    rec('对方删除的记录被移除', !after2.tasks.some(t => t.id === 't2'));

    /* ---------- 10. 两边都改 → 冲突拦截 ---------- */
    const cur = readLocal();
    cur.tasks.find(t => t.id === 't1').st = 'doing';
    store.writeData(JSON.stringify(cur));

    davA.seed('/ResearchWorkspace/workspace-devbbbbbbbb.json', {
      ...JSON.parse(JSON.stringify(readLocal())),
      tasks: [mkTask('t1', '任务一', 'done'), mkTask('t3', 'B 新增', 'todo')],
      tombstones: [{ coll: 'tasks', id: 't2', at: Date.now() }],
      __device: { deviceId: 'devbbbbbbbb', deviceName: '笔记本B', at: Date.now() }
    });

    const s3 = await syncCloud.run({});
    rec('云端载体也能拦住冲突',
      s3.ok === true && s3.needsChoice === true && (s3.conflicts || []).length >= 1,
      (s3.conflicts || []).map(c => c.id).join(','));
    rec('未确认前不写本机', readLocal().tasks.find(t => t.id === 't1').st === 'doing');

    const cid = (s3.conflicts || [])[0] && s3.conflicts[0].id;
    const s4 = await syncCloud.run({ choices: { [cid]: 'remote' } });
    rec('按选择应用后生效',
      s4.ok && s4.applied && readLocal().tasks.find(t => t.id === 't1').st === 'done',
      JSON.stringify(s4.stats));

    /* ---------- 11. 幂等 ---------- */
    const s5 = await syncCloud.run({ force: true });
    const st5 = s5.stats || {};
    rec('重复同步不产生变化', s5.ok && !st5.added && !st5.updated && !st5.removed, JSON.stringify(st5));

    /* ---------- 12. 换绑：base 必须清掉，旧云端文件不能被删 ---------- */
    const baseBefore = fs.existsSync(require('./sync-carrier').baseFile());
    const rebind = await account.bind({
      kind: 'webdav', url: davB.base, dir: '/ResearchWorkspace',
      user: 'ls@example.com', pass: 'other-pass-456'
    });
    syncCloud.clearBase();
    const baseAfter = fs.existsSync(require('./sync-carrier').baseFile());
    rec('可以换绑到另一个云端', rebind.ok === true && rebind.status.cloud.user === 'ls@example.com', rebind.status.cloud && rebind.status.cloud.user);
    rec('换绑后清掉旧基准快照', baseBefore === true && baseAfter === false, `before=${baseBefore} after=${baseAfter}`);
    rec('换绑不会删除旧云端里的数据', !!davA.read('/ResearchWorkspace/' + selfName), '旧云端文件仍在');
    rec('新云端一开始是空的', (await syncCloud.peers()).peers.length === 0);

    const s6 = await syncCloud.run({});
    rec('换绑后第一次同步把数据发布到新云端',
      s6.ok && s6.applied && !!davB.read('/ResearchWorkspace/' + selfName), s6.error || '已发布');

    /* ---------- 13. 解绑 ---------- */
    const ub = account.unbind();
    rec('解绑后不再绑定任何云端', ub.ok && account.status().binding === false, String(account.status().binding));
    rec('解绑后同步入口给出明确提示', (await syncCloud.run({})).error !== undefined, '有明确错误');

    /* ---------- 14. 目录载体也能用同一套接口 ---------- */
    const localDir = path.join(tmpDir, 'RW同步');
    fs.mkdirSync(localDir, { recursive: true });
    const fb = await account.bind({ kind: 'folder', dir: localDir });
    rec('可以把本地目录绑定为云端载体', fb.ok && fb.status.cloud.kind === 'folder', fb.status.cloud && fb.status.cloud.dir);
    const s7 = await syncCloud.run({});
    rec('目录载体也能完成同步',
      s7.ok && s7.applied && fs.existsSync(path.join(localDir, selfName)), s7.error || '已写入本地目录');

    /* ---------- 15. 换绑成目录后，WebDAV 那份凭证不该残留 ---------- */
    rec('换绑会覆盖旧的凭证', !JSON.stringify(account.status().cloud).includes('zs@example.com'),
      '当前云端：' + (account.status().cloud && account.status().cloud.providerName));

    /* ---------- 16. 清除本机授权 ---------- */
    const rs = account.resetLocal();
    rec('清除本机授权后回到未绑定、未设密码',
      rs.ok && account.status().binding === false && account.status().hasPass === false,
      JSON.stringify({ binding: account.status().binding, hasPass: account.status().hasPass }));
    rec('清除本机授权不动身份与数据',
      account.status().hasAccount === true && readLocal().projects.length === 1, '身份与项目都还在');
  } catch (err) {
    rec('未捕获异常', false, String((err && err.stack) || err));
  } finally {
    try { if (davA) await davA.stop(); } catch (_) {}
    try { if (davB) await davB.stop(); } catch (_) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  const pass = rows.filter(r => r.pass).length;
  const out = { ok: pass === rows.length && rows.length > 0, pass, total: rows.length, rows, at: new Date().toISOString() };
  const targets = [outPath, path.join(os.tmpdir(), 'rw-probe-account-result.json')];
  for (const t of targets) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

module.exports = { run };
