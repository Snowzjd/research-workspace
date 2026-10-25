/* ==========================================================================
   应用内更新 · 真实替换验证（只在便携版上跑）
   把当前 resources/app 复制一份、版本号改成 99.0.0 打成更新包，
   起本地 http 更新源，走真正的 apply：下载 → 校验 → spawn bat 替换 → 重启。
   外部验证者随后检查 resources/app/package.json 是否变成 99.0.0。
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const updater = require('./updater');

async function run() {
  const out = { ok: false, steps: [] };
  const step = (name, pass, detail) => out.steps.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 200) });
  const tmp = path.join(os.tmpdir(), 'rw-e2e-' + Date.now());

  try {
    const appRoot = path.resolve(__dirname, '..');        /* resources/app */
    const exePath = path.resolve(appRoot, '..', '..', 'ResearchWorkspace.exe');
    if (!fs.existsSync(exePath)) throw new Error('只在便携版上运行');

    /* 1. 复制当前 app，版本改成 99.0.0，打包 */
    const stage = path.join(tmp, 'app');
    fs.mkdirSync(stage, { recursive: true });
    execFileSync('xcopy', [appRoot, stage, '/E', '/I', '/Q', '/Y'], { windowsHide: true });
    const pkgFile = path.join(stage, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const fromV = pkg.version;
    pkg.version = '99.0.0';
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2), 'utf8');
    const zipPath = path.join(tmp, 'app-update-99.0.0.zip');
    execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', stage, '.'], { windowsHide: true });
    step('构造 99.0.0 假更新包', fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1000, `from ${fromV}`);

    /* 2. 本地 http 更新源 */
    const manifest = {
      version: '99.0.0', notes: 'e2e 替换验证', publishedAt: new Date().toISOString(),
      update: 'app-update-99.0.0.zip', full: 'ResearchWorkspace-portable-99.0.0.exe'
    };
    const server = http.createServer((req, res) => {
      const pn = new URL(req.url, 'http://x').pathname;
      if (pn === '/latest.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(manifest)); }
      if (pn === '/' + manifest.update) { res.writeHead(200); return res.end(fs.readFileSync(zipPath)); }
      res.writeHead(404); res.end();
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/`;
    step('本地更新源就绪', true, base);

    /* 3. 设置源并执行真实更新 */
    updater.setSource(base);
    const r = await updater.apply({ force: true });
    step('apply 完成（bat 已脱离启动）', r.ok === true && r.restarting === true,
      r.ok ? `${r.from} -> ${r.to}` : r.error);

    out.ok = r.ok === true;
    out.from = fromV;
    out.to = '99.0.0';
  } catch (err) {
    step('未捕获异常', false, String((err && err.stack) || err));
    out.ok = false;
  }

  try { fs.writeFileSync(path.join(__dirname, 'probe-update-e2e.json'), JSON.stringify(out, null, 2), 'utf8'); } catch (_) {}

  /* bat 在等主进程退出：给结果落盘一拍时间 */
  setTimeout(() => app.exit(out.ok ? 0 : 1), 600);
  return out;
}

module.exports = { run };
