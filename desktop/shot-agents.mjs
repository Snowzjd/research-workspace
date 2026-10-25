/* 一次性截图：Agent 中心空态（临时 userData，不碰真实数据） */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const ROOT = path.resolve(__dirname, '..');
  const win = new BrowserWindow({
    width: 1240, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true
    }
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise(r => setTimeout(r, 2600));
  await win.webContents.executeJavaScript("(() => { try { state.setTab='general'; go('agents'); } catch(e){} return 1; })()");
  await new Promise(r => setTimeout(r, 900));
  const img = await win.webContents.capturePage();
  const out = path.join(ROOT, '.preview', 'agents-empty.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out, fs.statSync(out).size, 'bytes');
  app.exit(0);
});
