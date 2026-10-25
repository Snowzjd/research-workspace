/* ==========================================================================
   全新设备端到端验证（由 main.js --fresh-probe 调用）
   前提：userData 已被主进程指向临时目录，相当于一台刚装好软件的机器。
   流程：确认工作区为空 → 指定根目录 → 建第一个项目 → 目录落盘 →
        数据文件落盘 → 重启（reload）后数据与根目录都还在。
   ========================================================================== */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function run({ ROOT, outPath }) {
  const userData = app.getPath('userData');
  const WS = path.join(userData, 'ws');
  const rows = [];
  const rec = (name, pass, detail) => rows.push({ name, pass: !!pass, detail: String(detail).slice(0, 240) });
  const flush = () => {
    const payload = { ok: rows.every(r => r.pass), total: rows.length, pass: rows.filter(r => r.pass).length, rows };
    try { fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8'); } catch (_) {}
    return payload;
  };

  let win;
  try {
    fs.mkdirSync(userData, { recursive: true });
    win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true
      }
    });
    await win.loadFile(path.join(ROOT, 'index.html'));
    await new Promise(r => setTimeout(r, 1800));
    const wc = win.webContents;

    /* ---------- 1. 干净机器 ---------- */
    const s0 = await wc.executeJavaScript(`(() => ({
      projects: DB.projects.length, tasks: DB.tasks.length, todos: DB.todos.length,
      onboarded: DB.settings.onboarded, rootDir: DB.settings.rootDir,
      welcome: /从这里开始/.test(document.getElementById('view').innerHTML)
    }))()`);
    rec('全新设备：没有任何项目', s0.projects === 0, s0.projects + ' 个');
    rec('全新设备：没有示例任务与待办', s0.tasks === 0 && s0.todos === 0, s0.tasks + ' / ' + s0.todos);
    rec('全新设备：引导状态为未完成', s0.onboarded === false, String(s0.onboarded));
    rec('全新设备：未预设工作区根目录', !s0.rootDir, s0.rootDir || '(空)');
    rec('全新设备：首页显示开始引导', s0.welcome === true);
    rec('全新设备：尚无数据文件', !fs.existsSync(path.join(userData, 'workspace-data.json')));

    /* 留一张新设备首屏截图，便于人工核对。
       隐藏窗口里 CSS 动画会被节流，先关掉动效再截图，否则内容停在 opacity:0 */
    try {
      /* 隐藏窗口不会真正绘制，capturePage 只能拿到空白；先显示再截 */
      win.showInactive();
      await wc.executeJavaScript("document.body.classList.add('no-motion');");
      await new Promise(r => setTimeout(r, 900));
      const img = await wc.capturePage();
      const shotDir = path.join(__dirname, '..', '.preview');
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, 'fresh-home.png'), img.toPNG());
      rec('首屏截图已保存', true, '.preview/fresh-home.png');
      await wc.executeJavaScript("document.body.classList.remove('no-motion');");
      win.hide();
    } catch (_) { rec('首屏截图已保存', false, '截图失败（不影响功能）'); }

    /* ---------- 2. 指定根目录并建第一个项目 ---------- */
    const created = await wc.executeJavaScript(`(async () => {
      DB.settings.rootDir = ${JSON.stringify(WS)};
      DB.settings.structureCreated = false;
      const r = await window.__RW_API__({ tool: 'create_project', args: { name: '新设备第一个项目', goal: '验证从空工作区到可用项目', period: '2026.10 - 2027.06' }, client: 'fresh-probe' });
      if (r && r.ok) await rebuildStructure(true);
      return r;
    })()`);
    rec('Agent 工具能建第一个项目', created && created.ok === true, (created && (created.name || created.error)) || '无返回');
    rec('模板给出 6 类材料目录', created && (created.material_dirs || []).length === 6, (created && created.material_dirs || []).join('/'));
    rec('模板给出 3 条起始任务', created && created.starter_tasks === 3, String(created && created.starter_tasks));

    /* ---------- 3. 目录真的落到磁盘 ---------- */
    const pdir = path.join(WS, '新设备第一个项目');
    const dirs = (created && created.material_dirs) || [];
    const exist = dirs.map(d => fs.existsSync(path.join(pdir, d)));
    rec('项目目录已落盘', fs.existsSync(pdir), pdir.replace(userData, '<userData>'));
    rec('六类材料目录全部存在', exist.length === 6 && exist.every(Boolean),
      dirs.map((d, i) => d + ':' + exist[i]).join(' '));

    /* ---------- 4. 数据文件内容 ---------- */
    const df = path.join(userData, 'workspace-data.json');
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(df, 'utf8')); } catch (_) {}
    rec('数据文件已创建', fs.existsSync(df), df.replace(userData, '<userData>'));
    rec('数据文件含 1 个项目', !!saved && (saved.projects || []).length === 1, saved ? (saved.projects || []).length + ' 个' : '未写入');
    rec('数据文件含 3 条起始任务', !!saved && (saved.tasks || []).length === 3, saved ? (saved.tasks || []).length + ' 条' : '-');
    rec('数据文件不含本机根目录', !!saved && !JSON.stringify(saved.settings || {}).includes(WS), 'rootDir 已剥离到 device.json');
    rec('device.json 记录了本机根目录', (() => {
      try { return JSON.parse(fs.readFileSync(path.join(userData, 'device.json'), 'utf8')).rootDir === WS; } catch (_) { return false; }
    })(), 'device.json');

    /* ---------- 5. 重启后仍在 ---------- */
    await win.reload();
    await new Promise(r => setTimeout(r, 1800));
    const s1 = await wc.executeJavaScript(`(() => ({
      projects: DB.projects.length, tasks: DB.tasks.length,
      current: (P(state.project) || {}).name || '',
      onboarded: DB.settings.onboarded, rootDir: rootDir(),
      cards: document.querySelectorAll('.proj-card').length
    }))()`);
    rec('重启后项目仍在', s1.projects === 1 && s1.cards === 1, s1.projects + ' 个 / ' + s1.cards + ' 张卡');
    rec('重启后任务仍在', s1.tasks === 3, s1.tasks + ' 条');
    rec('重启后当前工作区已恢复', s1.current === '新设备第一个项目', s1.current);
    rec('重启后引导已完成', s1.onboarded === true, String(s1.onboarded));
    rec('重启后根目录从 device.json 注回', s1.rootDir === WS, s1.rootDir.replace(userData, '<userData>'));
  } catch (err) {
    rec('探针执行异常', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    try { win && win.destroy(); } catch (_) {}
    const payload = flush();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
    return payload;
  }
}

module.exports = { run };
