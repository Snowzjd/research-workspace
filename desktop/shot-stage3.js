/* 阶段三界面验收：使用已准备的隔离 userData，不注入演示课题。 */
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

async function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capture(win, out, label) {
  win.showInactive();
  win.webContents.invalidate();
  await delay(500);
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  const info = await win.webContents.executeJavaScript(`(() => {
    const v = document.getElementById('view');
    const html = v ? v.innerHTML : '';
    return {
      label: ${JSON.stringify(label)},
      htmlLen: html.length,
      head: html.replace(/\\s+/g, ' ').slice(0, 900),
      hasDisconnected: /尚未接入文件引擎/.test(html),
      hasRpm: /已接入文件引擎/.test(html),
      hasPreview: /非 RPM/.test(html),
      hasUnlink: /取消关联/.test(html)
    };
  })()`);
  return { file: out, size: fs.statSync(out).size, info };
}

async function run({ ROOT, outDir }) {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true
    }
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await delay(2600);
  try {
    await win.webContents.executeJavaScript("Bridge.accountRegister({ name: '阶段三验收', pass: '' })");
    await win.webContents.reload();
    await delay(2600);
  } catch (_) {}

  const nav = await win.webContents.executeJavaScript(`(() => {
    try {
      if (!DB.projects || !DB.projects.length) return { ok: false, error: 'userData 里没有项目' };
      const bound = DB.projects.find(p => p.rpmRoot || p.rpmProjectId || (DB.settings && DB.settings.rpmBindings && DB.settings.rpmBindings[p.id]));
      const unbound = DB.projects.find(p => !p.rpmRoot && !p.rpmProjectId && !(DB.settings && DB.settings.rpmBindings && DB.settings.rpmBindings[p.id]));
      return {
        ok: true,
        boundId: bound && bound.id,
        unboundId: unbound && unbound.id,
        names: DB.projects.map(p => p.id + ':' + (p.name || ''))
      };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  })()`);
  if (!nav || !nav.ok) {
    try { win.destroy(); } catch (_) {}
    return { ok: false, error: (nav && nav.error) || '无法读取项目' };
  }

  const shots = [];
  const go = async (js, file, label) => {
    await win.webContents.executeJavaScript(js);
    await delay(1400);
    shots.push(await capture(win, path.join(outDir, file), label));
  };

  if (nav.boundId) {
    await go(`(async () => {
      state.project = ${JSON.stringify(nav.boundId)};
      state.projectTab = 'materials';
      if (typeof refreshProjectMaterials === 'function') { await refreshProjectMaterials(state.project); }
      go('project');
      return 'ok';
    })()`, 'materials-bound.png', 'bound-materials');
    const pathInfo = await win.webContents.executeJavaScript(`(() => {
      const p = P(state.project);
      const st = materialStatusView(p.id);
      return {
        id: p.id,
        source: st.source,
        label: st.label,
        rpm_bound: st.rpm_bound,
        resolved_root: st.resolved_root || (typeof projectOpenRoot === 'function' ? projectOpenRoot(p) : ''),
        files: (typeof materialsIn === 'function' ? materialsIn(p.id).length : 0)
      };
    })()`);
    fs.writeFileSync(path.join(outDir, 'bound-path.json'), JSON.stringify(pathInfo, null, 2), 'utf8');

    await go(`(() => { state.projectTab = 'outcomes'; go('project'); return 'ok'; })()`, 'outcomes-bound.png', 'bound-outcomes');
  }

  if (nav.unboundId) {
    await go(`(async () => {
      state.project = ${JSON.stringify(nav.unboundId)};
      state.projectTab = 'materials';
      if (typeof refreshProjectMaterials === 'function') { await refreshProjectMaterials(state.project); }
      go('project');
      return 'ok';
    })()`, 'materials-unbound.png', 'unbound-materials');
  }

  const summary = { ok: shots.length > 0, shots, nav };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'shot-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  try { win.destroy(); } catch (_) {}
  return summary;
}

module.exports = { run };
