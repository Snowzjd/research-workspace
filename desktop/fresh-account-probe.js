/* ==========================================================================
   全新安装 · 账户门端到端验证
   场景：一台刚装好软件的机器（userData 里没有 workspace-data.json）
   之前这里有个死锁：注册要求"先完成工作区初始化"，而账户门挡住了初始化入口。
   本探针专门守这条路径：
     门出现 → 填名字密码 → 注册成功 → 跳过绑定 → 进入主界面
     → 数据文件已落盘 → 重启后是解锁页 → 输入密码解锁
   ========================================================================== */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const account = require('./account');

async function run({ ROOT, outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 240)
  });
  const dataFile = () => store.dataFile();
  const readData = () => { try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch (_) { return null; } };

  let win = null;
  try {
    /* ---------- 0. 前提：干净机器 ---------- */
    try { if (fs.existsSync(dataFile())) fs.unlinkSync(dataFile()); } catch (_) {}
    rec('起始状态：没有数据文件（全新安装）', !fs.existsSync(dataFile()));

    win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true
      }
    });
    await win.loadFile(path.join(ROOT, 'index.html'));
    await new Promise(r => setTimeout(r, 2200));
    const wc = win.webContents;
    const js = code => wc.executeJavaScript(code);
    /* 账户门要等 boot 里的 accountStatus 返回才渲染，轮询等它出现（最多 8 秒） */
    const waitGate = async (maxMs = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        const has = await js(`!!document.getElementById('auth-gate')`);
        if (has) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
    };

    /* ---------- 1. 全新安装应当已自动落盘数据文件 ---------- */
    rec('启动后自动创建了数据文件', fs.existsSync(dataFile()), path.basename(dataFile()));
    const d0 = readData() || {};
    rec('数据文件结构可用（空项目 + 设置齐备）',
      Array.isArray(d0.projects) && d0.projects.length === 0 && !!d0.settings,
      `projects=${(d0.projects || []).length} settings=${d0.settings ? 'ok' : '缺'}`);

    /* ---------- 2. 账户门出现 ---------- */
    const appeared = await waitGate();
    rec('注册门在启动后出现', appeared, appeared ? '已渲染' : '8 秒内没出现');
    const gate = await js(`(() => {
      const g = document.getElementById('auth-gate');
      return {
        exists: !!g,
        kind: g ? g.dataset.kind : '',
        hasName: !!(g && g.querySelector('[data-role="reg-name"]')),
        hasPass: !!(g && g.querySelector('[data-role="reg-pass"]')),
        btn: !!(g && g.querySelector('[data-act="auth-register"]'))
      };
    })()`);
    rec('全新安装显示注册门', gate.exists && gate.kind === 'register', JSON.stringify(gate));
    rec('注册表单有名字与密码输入框', gate.hasName && gate.hasPass && gate.btn);

    /* ---------- 3. 填表并注册（不填名字应先被拦） ---------- */
    const blocked = await js(`(async () => {
      const g = document.getElementById('auth-gate');
      g.querySelector('[data-act="auth-register"]').click();
      await new Promise(r => setTimeout(r, 300));
      const err = document.getElementById('auth-err');
      return { shown: !!(err && err.classList.contains('show')), text: err ? err.textContent : '', stillGate: !!document.getElementById('auth-gate') };
    })()`);
    rec('空名字被拦下且给出提示', blocked.shown && blocked.stillGate, blocked.text);

    await js(`(async () => {
      const g = document.getElementById('auth-gate');
      g.querySelector('[data-role="reg-name"]').value = '张三';
      g.querySelector('[data-role="reg-pass"]').value = 'abcd1234';
      g.querySelector('[data-act="auth-register"]').click();
      await new Promise(r => setTimeout(r, 1200));
    })()`);
    await waitGate();
    const reg = await js(`(() => {
      const g2 = document.getElementById('auth-gate');
      return {
        gateKind: g2 ? g2.dataset.kind : 'none',
        hasBindForm: !!(g2 && g2.querySelector('.carrier-card')),
        err: (document.getElementById('auth-err') || {}).textContent || '',
        account: (typeof state !== 'undefined' && state.auth && state.auth.status && state.auth.status.account) || null
      };
    })()`);
    rec('注册成功，进入绑定云端步骤', reg.gateKind === 'bind' && reg.hasBindForm,
      'gate=' + reg.gateKind + ' err=' + reg.err);
    rec('身份已生成', !!(reg.account && /^u[0-9a-f]{12}$/.test(reg.account.id)), reg.account && reg.account.id);

    /* ---------- 4. 数据文件里已有身份 ---------- */
    const d1 = readData() || {};
    rec('身份写进了数据文件（会随同步走）', !!(d1.__account && d1.__account.id), (d1.__account || {}).name);

    /* ---------- 5. 跳过绑定，进入主界面 ---------- */
    const skipped = await js(`(async () => {
      const g = document.getElementById('auth-gate');
      g.querySelector('[data-act="auth-skip"]').click();
      await new Promise(r => setTimeout(r, 700));
      return {
        gate: !!document.getElementById('auth-gate'),
        view: (document.getElementById('view') || {}).innerHTML ? document.getElementById('view').innerHTML.length : 0,
        welcome: /从这里开始|还没有项目/.test((document.getElementById('view') || {}).innerHTML || '')
      };
    })()`);
    rec('跳过绑定后账户门关闭', skipped.gate === false, 'gate=' + skipped.gate);
    rec('主界面正常渲染（空工作区欢迎页）', skipped.view > 500 && skipped.welcome, skipped.view + ' 字符');

    /* ---------- 6. 重启：应显示解锁页 ---------- */
    const lk = account.bootLock();
    rec('重启时有密码则上锁', lk.locked === true, String(lk.locked));
    await wc.reload();
    await new Promise(r => setTimeout(r, 1500));
    await waitGate();
    const gate2 = await js(`(() => {
      const g = document.getElementById('auth-gate');
      return {
        exists: !!g, kind: g ? g.dataset.kind : '',
        hasPwd: !!(g && g.querySelector('[data-role="unlock-pass"]')),
        title: g ? ((g.querySelector('.auth-title') || {}).textContent || '') : ''
      };
    })()`);
    rec('重启后显示解锁页', gate2.exists && gate2.kind === 'unlock' && gate2.hasPwd, gate2.title);

    /* ---------- 7. 解锁 ---------- */
    const wrong = await js(`(async () => {
      const g = document.getElementById('auth-gate');
      g.querySelector('[data-role="unlock-pass"]').value = 'wrong-pass';
      g.querySelector('[data-act="auth-unlock"]').click();
      await new Promise(r => setTimeout(r, 500));
      const err = document.getElementById('auth-err');
      return { shown: !!(err && err.classList.contains('show')), still: !!document.getElementById('auth-gate') };
    })()`);
    rec('错误密码不解锁', wrong.shown && wrong.still);

    const ok = await js(`(async () => {
      const g = document.getElementById('auth-gate');
      g.querySelector('[data-role="unlock-pass"]').value = 'abcd1234';
      g.querySelector('[data-act="auth-unlock"]').click();
      await new Promise(r => setTimeout(r, 900));
      return { gate: !!document.getElementById('auth-gate'), name: (state.auth.status.account || {}).name };
    })()`);
    rec('正确密码解锁并进入主界面', ok.gate === false && ok.name === '张三', ok.name);
  } catch (err) {
    rec('未捕获异常', false, String((err && err.stack) || err));
  } finally {
    if (win) { try { win.destroy(); } catch (_) {} }
  }

  const pass = rows.filter(r => r.pass).length;
  const out = { ok: pass === rows.length && rows.length > 0, pass, total: rows.length, rows, at: new Date().toISOString() };
  for (const t of [outPath, path.join(require('os').tmpdir(), 'rw-probe-fresh-account.json')]) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

module.exports = { run };
