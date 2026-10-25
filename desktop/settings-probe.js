/* ==========================================================================
   设置页渲染诊断
   直接调用 settingsView() 抓异常与返回长度，覆盖几种状态：
   未注册 / 已注册 / 已绑定云端（state.sync 用真实结构模拟）
   ========================================================================== */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const account = require('./account');

async function run({ ROOT, outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 300) });
  let win = null;

  try {
    win = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true
      }
    });
    const errors = [];
    win.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2) errors.push(String(msg).slice(0, 200));
    });
    await win.loadFile(path.join(ROOT, 'index.html'));
    await new Promise(r => setTimeout(r, 2000));
    const wc = win.webContents;
    const js = code => wc.executeJavaScript(code);

    /* 通用：调用 settingsView 并抓异常 */
    const probe = async (label) => js(`(() => {
      const out = {};
      try {
        const html = settingsView();
        out.ok = true; out.len = html.length;
        out.hasAccount = /工作台身份/.test(html);
        out.hasCloud = /云端绑定/.test(html);
        out.hasUpdate = /检查更新/.test(html);
      } catch (e) {
        out.ok = false; out.err = e && e.message; out.stack = (e && e.stack || '').split('\\n').slice(0, 4).join(' | ');
      }
      return out;
    })()`);

    /* 1. 未注册 */
    const p1 = await probe('未注册');
    rec('未注册时设置页可渲染', p1.ok && p1.len > 500, p1.ok ? `${p1.len} 字符` : `${p1.err} @ ${p1.stack}`);

    /* 2. 注册后（直接走 IPC，不依赖界面） */
    const reg = account.register({ name: '诊断', pass: '' });
    rec('诊断用身份注册成功', reg.ok, reg.error || (reg.account || {}).id);
    await wc.reload();
    await new Promise(r => setTimeout(r, 2000));
    const p2 = await probe('已注册');
    rec('已注册时设置页可渲染',
      p2.ok && p2.len > 500, p2.ok ? `${p2.len} 字符` : `${p2.err} @ ${p2.stack}`);

    /* 切到账户 tab：这里才是账户块真正渲染的地方 */
    const p2b = await js(`(() => {
      state.setTab = 'account';
      try {
        const html = settingsView();
        return { ok: true, len: html.length, hasAccount: /工作台身份/.test(html), hasCloud: /云端绑定/.test(html) };
      } catch (e) { return { ok: false, err: e && e.message }; }
    })()`);
    rec('账户 tab 渲染出身份与云端两块',
      p2b.ok && p2b.len > 500 && p2b.hasAccount && p2b.hasCloud,
      p2b.ok ? `${p2b.len} 字符 · 身份=${p2b.hasAccount} · 云端=${p2b.hasCloud}` : p2b.err);

    /* 3. 模拟「已绑定云端 + 有同步状态」（真实结构） */
    const p3 = await js(`(() => {
      const out = {};
      /* 用与主进程一致的脱敏结构 */
      state.auth.status = {
        ok: true, hasAccount: true,
        account: { id: 'u0123456789ab', name: '诊断', createdAt: '', updatedAt: '' },
        hasPass: false, locked: false,
        cloud: { kind: 'webdav', providerName: '坚果云', label: '坚果云', url: 'https://dav.jianguoyun.com/dav/',
          dir: '/ResearchWorkspace', user: 'a@b.com', boundAt: Date.now(), hasSecret: true, secretMode: 'os' },
        binding: true, providers: [], device: { deviceId: 'x', deviceName: 'y' }, secretMode: 'os', hasData: true
      };
      state.sync = { ok: true, mode: 'cloud', enabled: true, carrier: 'webdav', dir: '/ResearchWorkspace',
        deviceId: 'x', deviceName: 'y', lastSyncAt: Date.now(), hasBase: true,
        peers: [{ file: 'workspace-b.json', deviceId: 'b', deviceName: 'bbbbbbbb' }] };
      try {
        const html = settingsView();
        out.ok = true; out.len = html.length;
      } catch (e) {
        out.ok = false; out.err = e && e.message; out.stack = (e && e.stack || '').split('\\n').slice(0, 4).join(' | ');
      }
      return out;
    })()`);
    const p3b = await js(`(() => {
      state.setTab = 'account';
      try {
        const html = settingsView();
        return { ok: true, len: html.length, hasSync: /台其它设备/.test(html), hasBind: /坚果云 · a@b/.test(html) };
      } catch (e) { return { ok: false, err: e && e.message }; }
    })()`);
    rec('已绑定 + 有同步状态时账户页正常',
      p3b.ok && p3b.len > 500 && p3b.hasSync && p3b.hasBind,
      p3b.ok ? `${p3b.len} 字符 · 同步块=${p3b.hasSync} · 绑定块=${p3b.hasBind}` : p3b.err);

    /* 4. 真实点击一次（走 render 全链路） */
    const p4 = await js(`(async () => {
      state.setTab = 'account';
      go('settings');
      await new Promise(r => setTimeout(r, 400));
      const el = document.getElementById('view');
      return { len: (el && el.innerHTML || '').length, hasTabs: /账户/.test(el ? el.innerHTML : '') };
    })()`);
    rec('点击设置后主区域有内容', p4.len > 500 && p4.hasTabs, `${p4.len} 字符`);

    /* 5. 页面级错误（渲染异常会进 console） */
    const realErr = errors.filter(e => !/Content-Security-Policy|Security Warning|DevTools|Autofill|GPU|network service/i.test(e));
    rec('渲染过程中没有未捕获错误', realErr.length === 0, realErr.slice(0, 3).join(' | ') || '无');
  } catch (err) {
    rec('未捕获异常', false, String((err && err.stack) || err));
  } finally {
    if (win) { try { win.destroy(); } catch (_) {} }
  }

  const pass = rows.filter(r => r.pass).length;
  const out = { ok: pass === rows.length && rows.length > 0, pass, total: rows.length, rows, at: new Date().toISOString() };
  for (const t of [outPath, path.join(require('os').tmpdir(), 'rw-probe-settings.json')]) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

module.exports = { run };
