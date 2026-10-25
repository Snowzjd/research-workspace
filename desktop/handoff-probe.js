/* ==========================================================================
   交接文件的端到端验证
   全程在临时目录里跑，不碰用户数据：
   导出 → 自导自入 → 对方改过再导入 → 冲突拦截 → 按选择应用 → 幂等 → 交接单
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const store = require('./store');
const handoff = require('./handoff');

const mkTask = (id, t, st) => ({ id, t, st, p: 'p1' });

async function run({ outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 200)
  });
  const readLocal = () => JSON.parse(fs.readFileSync(store.dataFile(), 'utf8'));
  const dir = path.join(os.tmpdir(), 'rw-handoff-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });

  try {
    /* ---------- 1. 造一份本机数据 ---------- */
    const base = {
      schemaVersion: 2,
      settings: { glass: true, motion: true, autoBackup: false },
      projects: [{ id: 'p1', name: '项目一', folder: '项目一', progress: 10, stage: '仿真', next: '整理数据' }],
      tasks: [mkTask('t1', '任务一', 'todo'), mkTask('t2', '任务二', 'todo')],
      todos: [{ t: '写周报', pri: 'mid', done: false }],
      kbDocs: [], resources: [], automations: [], agents: [],
      templates: [], timeline: [], tombstones: [], chats: {}
    };
    store.writeData(JSON.stringify(base));

    /* ---------- 2. 导出数据包 ---------- */
    const packA = path.join(dir, 'pack-a.json');
    const e1 = handoff.exportPack(packA);
    rec('导出数据包成功', e1.ok && fs.existsSync(packA), e1.ok ? e1.bytes + ' 字节' : e1.error);
    rec('导出结果带上项目/任务数量', e1.ok && e1.projects === 1 && e1.tasks === 2, `${e1.projects} 个项目 / ${e1.tasks} 条任务`);

    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(packA, 'utf8')); } catch (_) {}
    rec('数据包带设备标识与格式标记',
      !!raw.__device && !!raw.__device.deviceId && raw.__handoff && raw.__handoff.kind === 'workspace-pack',
      raw.__device ? ('来自 ' + raw.__device.deviceName + ' · v' + raw.__device.version) : '缺少 __device');

    /* ---------- 3. 导入自己的包：应识别为同一台设备，且不改动数据 ---------- */
    const i0 = handoff.importPack(packA, {});
    rec('导入自己的包能识别为同机', i0.ok && i0.sameDevice === true, JSON.stringify(i0.stats || {}));
    rec('同机导入不产生虚假改动',
      !(i0.stats && (i0.stats.added || i0.stats.updated || i0.stats.removed)) && readLocal().tasks.length === 2,
      JSON.stringify(i0.stats || {}));

    /* ---------- 4. 构造「另一台设备」的数据包：改一条、删一条、增一条 ---------- */
    const peer = JSON.parse(JSON.stringify(raw));
    peer.tasks = [mkTask('t1', '任务一', 'done'), mkTask('t3', '对方新增', 'todo')];
    peer.tombstones = [{ coll: 'tasks', id: 't2', at: Date.now() }];
    delete peer.__device;
    const packB = path.join(dir, 'pack-b.json');
    fs.writeFileSync(packB, JSON.stringify(peer), 'utf8');

    /* 本机也把 t1 改了 → 构成修改冲突 */
    const cur = readLocal();
    cur.tasks.find(t => t.id === 't1').st = 'doing';
    store.writeData(JSON.stringify(cur));

    const i1 = handoff.importPack(packB, {});
    rec('两边都改过时先返回冲突而不覆盖',
      i1.ok === true && i1.needsChoice === true && (i1.conflicts || []).length === 1,
      (i1.conflicts || []).map(c => c.id).join(',') || '无冲突');
    rec('未确认前本地保持原样', readLocal().tasks.find(t => t.id === 't1').st === 'doing');

    /* ---------- 5. 按选择提交：t1 用对方 ---------- */
    const cid = (i1.conflicts || [])[0] && i1.conflicts[0].id;
    const i2 = handoff.importPack(packB, { choices: { [cid]: 'remote' } });
    const after = readLocal();
    rec('按选择应用成功', i2.ok && i2.applied === true, JSON.stringify(i2.stats || {}));
    rec('冲突记录按选择取了对方版本', after.tasks.find(t => t.id === 't1').st === 'done');
    rec('对方新增的记录被合并进来', after.tasks.some(t => t.id === 't3'));
    rec('对方删除的记录被移除', !after.tasks.some(t => t.id === 't2'));
    rec('合并后任务总数为 2', after.tasks.length === 2, after.tasks.map(t => t.id).join(','));

    /* ---------- 6. 幂等：同一份包再导一次不应有任何变化 ---------- */
    const i3 = handoff.importPack(packB, { _force: true });
    const s3 = i3.stats || {};
    rec('重复导入同一份包不产生变化',
      i3.ok && !s3.added && !s3.updated && !s3.removed && readLocal().tasks.length === 2,
      JSON.stringify(s3));

    /* ---------- 7. 坏文件与错文件都要给出可读错误，而不是崩 ---------- */
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ this is not json', 'utf8');
    const eb = handoff.importPack(broken, {});
    rec('损坏文件给出可读错误', eb.ok === false && /不是有效|读不出来/.test(String(eb.error)), eb.error);

    const wrong = path.join(dir, 'wrong.json');
    fs.writeFileSync(wrong, JSON.stringify({ hello: 'world' }), 'utf8');
    const ew = handoff.importPack(wrong, {});
    rec('结构不对的文件被拒绝', ew.ok === false && /没有项目或任务/.test(String(ew.error)), ew.error);

    const missing = handoff.importPack(path.join(dir, 'nope.json'), {});
    rec('不存在的文件给出明确提示', missing.ok === false && /不存在/.test(String(missing.error)), missing.error);

    /* ---------- 8. 交接单（Markdown） ---------- */
    const docText = handoff.buildDoc();
    rec('交接单含标题与项目名', docText.indexOf('# 科研工作台') === 0 && docText.indexOf('项目一') > 0, docText.length + ' 字符');
    rec('交接单含接手须知与待办', docText.indexOf('接手须知') > 0 && docText.indexOf('写周报') > 0,
      docText.indexOf('写周报') > 0 ? '含全局待办' : '缺待办');
    rec('交接单里没有残留 HTML 标签', !/<b>|<\/b>|<span/.test(docText), '干净' );

    const docFile = path.join(dir, 'handoff.md');
    const d1 = handoff.exportDoc(docFile);
    rec('交接单可写成文件', d1.ok && fs.existsSync(docFile) && d1.bytes > 200, d1.ok ? d1.bytes + ' 字节' : d1.error);

    /* ---------- 9. 状态记录 ---------- */
    const inf = handoff.info();
    rec('导入导出时间被记录下来',
      inf.ok && inf.lastExportAt > 0 && inf.lastImportAt > 0, JSON.stringify(inf).slice(0, 140));

    /* ---------- 10. 建议文件名带设备名与时间 ---------- */
    const n1 = handoff.suggestedName('pack');
    const n2 = handoff.suggestedName('doc');
    rec('建议文件名可读且带扩展名',
      /^工作台交接-.+-\d{8}-\d{4}\.json$/.test(n1) && /\.md$/.test(n2),
      n1 + ' / ' + n2);
  } catch (err) {
    rec('未捕获异常', false, String((err && err.stack) || err));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  const pass = rows.filter(r => r.pass).length;
  const out = { ok: pass === rows.length && rows.length > 0, pass, total: rows.length, rows, at: new Date().toISOString() };
  /* 便携版里 __dirname 在打包资源内、不可写，退到系统临时目录，保证结果一定能看到 */
  const targets = [outPath, path.join(os.tmpdir(), 'rw-probe-handoff-result.json')];
  for (const t of targets) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

module.exports = { run };
