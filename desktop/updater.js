/* ==========================================================================
   应用内更新（便携版专用）
   --------------------------------------------------------------------------
   更新粒度：Electron 运行时约 250MB 且极少变化，更新只下发 resources/app
   （约 1MB 的 zip），关闭软件后由 updater.bat 原子替换再重启。

   更新源（存 device.json.updateSource，设置页可改）：
     - github:<owner>/<repo>  → https://github.com/o/r/releases/latest/download/
     - https://...            → 直接当 base（拼 latest.json）
     - cloud                  → 用已绑定的 WebDAV，更新文件放 <绑定目录>/Releases/
     - 空                     → 未配置

   latest.json 契约（由 make-release.mjs 产出）：
     { version, notes, publishedAt, update: "app-update-x.y.z.zip", full: "..." }
   ========================================================================== */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const device = require('./device');
const account = require('./account');
const cloud = require('./cloud');

/* ---------- 路径（仅便携版可用） ---------- */
function paths() {
  const appDesktop = __dirname;                       /* .../resources/app/desktop */
  const appRoot = path.resolve(appDesktop, '..');     /* .../resources/app */
  const resourcesDir = path.resolve(appRoot, '..');   /* .../resources */
  const exePath = path.resolve(resourcesDir, '..', 'ResearchWorkspace.exe');
  return {
    appDesktop, appRoot, resourcesDir, exePath,
    portable: fs.existsSync(exePath) && fs.existsSync(path.join(resourcesDir, 'app', 'package.json'))
  };
}

/* ---------- 更新源 ---------- */
/* 这个软件只有一个官方发布仓库，直接内置成默认值：
   不填也能检查更新，用户想换成自己的镜像/坚果云再改即可 */
const DEFAULT_SOURCE = 'github:Snowzjd/research-workspace';

function getSource() {
  const saved = String(device.info().updateSource || '').trim();
  return saved || DEFAULT_SOURCE;
}

function isDefaultSource() {
  return !String(device.info().updateSource || '').trim();
}

function setSource(v) {
  const dev = device.info();
  dev.updateSource = String(v || '').trim();
  device.write(dev);
  return { ok: true, source: dev.updateSource };
}

/* 把用户填的源解析成 {kind, base|binding, error?} */
function resolveSource(src) {
  const s = String(src || '').trim();
  if (!s) return { kind: 'none', error: '还没有设置更新源（关于页 → 更新源）' };
  if (s.startsWith('github:')) {
    const repo = s.slice(7).trim().replace(/^\/+|\/+$/g, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { kind: 'none', error: 'GitHub 源格式：github:用户名/仓库名' };
    /* 走 api.github.com 而不是 releases/latest/download：
       后者是 github.com 域名（国内常不通）且一律 302，api 通道稳定得多 */
    return { kind: 'github', repo };
  }
  if (s === 'cloud' || s === 'webdav') {
    const b = account.currentBinding();
    if (!b || b.kind !== 'webdav') return { kind: 'none', error: '更新源选了「跟随云端」，但当前绑定的不是 WebDAV 云端' };
    return { kind: 'webdav', binding: b };
  }
  if (/^https?:\/\//i.test(s)) {
    return { kind: 'http', base: s.endsWith('/') ? s : s + '/' };
  }
  return { kind: 'none', error: '更新源格式不认识：' + s };
}

/* ---------- 版本比较（三段数字） ---------- */
function isNewer(remote, local) {
  const r = String(remote || '').split('.');
  const l = String(local || '').split('.');
  for (let i = 0; i < 3; i++) {
    const a = parseInt(r[i] || '0', 10) || 0;
    const b = parseInt(l[i] || '0', 10) || 0;
    if (a !== b) return a > b;
  }
  return false;
}

/* ---------- 拉 latest.json ---------- */
async function fetchManifest(src) {
  if (src.kind === 'github') {
    const url = `https://api.github.com/repos/${src.repo}/releases/latest`;
    const r = await cloud._internals.request('GET', url, {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ResearchWorkspace'
    }, null, 25000, false, 3);
    if (r.status === 404) throw new Error('在 GitHub 上找不到这个仓库或 Release');
    if (r.status === 403) throw new Error('GitHub 接口被限流（403），稍后再试，或改用其他更新源');
    if (r.status !== 200) throw new Error(`获取版本清单失败：HTTP ${r.status}`);
    let j;
    try { j = JSON.parse(r.body); } catch (_) { throw new Error('版本清单格式不对'); }
    const assets = Array.isArray(j.assets) ? j.assets : [];
    const upd = assets.find(a => /^app-update-.*\.zip$/i.test(a.name || ''));
    if (!upd) throw new Error('这个 Release 里没有更新包（app-update-*.zip）');
    const full = assets.find(a => /win64\.zip$/i.test(a.name || ''));
    return {
      version: String(j.tag_name || '').replace(/^v/i, ''),
      notes: String(j.body || '').slice(0, 400),
      publishedAt: j.published_at || '',
      update: upd.name,
      assetId: upd.id,
      size: upd.size || 0,
      full: full ? full.name : ''
    };
  }

  if (src.kind === 'http') {
    const { request } = cloud._internals;
    const r = await request('GET', src.base + 'latest.json', {}, null, 20000, false, 3);
    if (r.status === 404) throw new Error('更新源上还没有 latest.json（检查地址或先发布）');
    if (r.status !== 200) throw new Error(`获取版本清单失败：HTTP ${r.status}`);
    return JSON.parse(r.body);
  }
  if (src.kind === 'webdav') {
    const text = await cloud.get(src.binding, 'Releases/latest.json');
    if (!text) throw new Error('云端 Releases/ 里还没有 latest.json');
    return JSON.parse(text);
  }
  throw new Error(src.error || '更新源不可用');
}

/* ==========================================================================
   检查更新
   ========================================================================== */
async function check(opts = {}) {
  const current = app.getVersion();
  const p = paths();
  if (!p.portable && opts.requirePortable !== false) {
    return { ok: false, current, error: '当前是源码/开发模式运行，只有便携版支持应用内更新' };
  }
  const src = resolveSource(getSource());
  if (src.kind === 'none') {
    return { ok: false, current, source: getSource(), error: src.error };
  }
  try {
    const m = await fetchManifest(src);
    if (!m || !m.version || !m.update) throw new Error('latest.json 缺 version 或 update 字段');
    return {
      ok: true,
      current,
      latest: {
        version: String(m.version),
        notes: String(m.notes || ''),
        publishedAt: m.publishedAt || '',
        update: String(m.update),
        assetId: m.assetId || 0,
        full: String(m.full || '')
      },
      hasUpdate: isNewer(m.version, current),
      source: getSource()
    };
  } catch (err) {
    return { ok: false, current, source: getSource(), error: String((err && err.message) || err) };
  }
}

/* ==========================================================================
   执行更新：下载 → 校验 → 生成替换脚本 → 退出并重启
   ========================================================================== */
async function apply(opts = {}) {
  const p = paths();
  if (!p.portable && !opts.dryRun) return { ok: false, error: '只有便携版支持应用内更新' };

  const c = await check({ requirePortable: !opts.dryRun });
  if (!c.ok) return { ok: false, error: c.error };
  if (!c.hasUpdate && !opts.force) {
    return { ok: false, error: `已经是最新版本（${c.current}）` };
  }

  const src = resolveSource(getSource());
  const workDir = path.join(os.tmpdir(), 'rw-update-' + Date.now());
  const zipPath = path.join(workDir, c.latest.update);
  const stageRoot = path.join(workDir, 'stage');
  const stageApp = path.join(stageRoot, 'app');

  try {
    /* 1. 下载 */
    let buf;
    if (src.kind === 'github') {
      const { request } = cloud._internals;
      if (!c.latest.assetId) throw new Error('版本清单里缺少资产 id，无法下载');
      const url = `https://api.github.com/repos/${src.repo}/releases/assets/${c.latest.assetId}`;
      const r = await request('GET', url, {
        'Accept': 'application/octet-stream',
        'User-Agent': 'ResearchWorkspace'
      }, null, 300000, true, 5);
      if (r.status === 404) throw new Error('更新包已被删除（404）');
      if (r.status !== 200) throw new Error(`下载更新包失败：HTTP ${r.status}`);
      buf = r.buffer;
    } else if (src.kind === 'http') {
      const { request } = cloud._internals;
      const r = await request('GET', src.base + c.latest.update, {}, null, 300000, true, 5);
      if (r.status !== 200) throw new Error(`下载失败：HTTP ${r.status}`);
      buf = r.buffer;
    } else if (src.kind === 'webdav') {
      buf = await cloud.getBinary(src.binding, 'Releases/' + c.latest.update);
      if (!buf) throw new Error('云端没有 ' + c.latest.update);
    } else {
      throw new Error(src.error || '更新源不可用');
    }
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(zipPath, buf);

    /* 2. 解压（Windows 10+ 自带 bsdtar，支持 zip） */
    fs.mkdirSync(stageApp, { recursive: true });
    try {
      execFileSyncSpawn('tar', ['-xf', zipPath, '-C', stageApp]);
    } catch (err) {
      throw new Error('解压失败（系统缺少 tar）：' + String((err && err.message) || err));
    }

    /* 3. 校验：包里必须有 package.json 且版本对得上 */
    const pkgFile = path.join(stageApp, 'package.json');
    if (!fs.existsSync(pkgFile)) throw new Error('更新包内容不对（缺 package.json），已取消');
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); } catch (_) {}
    if (String(pkg.version || '') !== c.latest.version) {
      throw new Error(`更新包版本（${pkg.version || '未知'}）与清单（${c.latest.version}）不一致，已取消`);
    }

    /* 4. 生成替换脚本：等退出 → 改名旧 app → 复制新 app → 重启 → 清理 */
    const batPath = path.join(workDir, 'rw-updater.bat');
    fs.writeFileSync(batPath, buildBat({
      appRoot: p.appRoot, exePath: p.exePath, stageApp, workDir
    }), 'utf8');

    /* 5. dryRun 到此为止（下载/解压/校验已验证，不真替换） */
    if (opts.dryRun) {
      return {
        ok: true, dryRun: true, from: c.current, to: c.latest.version,
        zipBytes: buf.length, stageApp,
        batOk: fs.existsSync(batPath)
      };
    }

    /* 6. 脱离当前进程执行脚本 */
    const child = spawn('cmd.exe', ['/c', batPath], {
      detached: true, stdio: 'ignore', windowsHide: true,
      cwd: path.dirname(batPath)
    });
    child.unref();

    return {
      ok: true, restarting: true,
      from: c.current, to: c.latest.version, workDir
    };
  } catch (err) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function execFileSyncSpawn(cmd, args) {
  const { execFileSync } = require('child_process');
  return execFileSync(cmd, args, { stdio: 'pipe', timeout: 120000, windowsHide: true });
}

/* 路径可能含空格与中文，全部加引号；不用延迟扩展（路径里的 ! 会被吃掉） */
function buildBat({ appRoot, exePath, stageApp, workDir }) {
  const L = [];
  L.push('@echo off');
  L.push(`set "APPDIR=${appRoot}"`);
  L.push(`set "EXE=${exePath}"`);
  L.push(`set "STAGE=${stageApp}"`);
  L.push(`set "WORK=${workDir}"`);
  L.push('');
  /* 等主程序退出：先固定等 3 秒，再靠改名重试兜底（最多 10 次 × 1 秒） */
  L.push('timeout /t 3 /nobreak >nul');
  L.push('set /a m=0');
  L.push(':ren');
  L.push('ren "%APPDIR%" "app.old" 2>nul && goto copy');
  L.push('ping -n 2 127.0.0.1 >nul');
  L.push('set /a m+=1');
  L.push('if %m% LSS 10 goto ren');
  L.push('goto fail');
  L.push('');
  L.push(':copy');
  L.push('xcopy /E /I /Y "%STAGE%" "%APPDIR%" >nul');
  L.push('if errorlevel 1 goto fail');
  L.push('start "" "%EXE%"');
  L.push('rd /s /q "%APPDIR%.old" 2>nul');
  L.push('rd /s /q "%WORK%" 2>nul');
  L.push('exit');
  L.push('');
  L.push(':fail');
  L.push('if exist "%APPDIR%.old" ren "%APPDIR%.old" "app"');
  L.push('exit /b 1');
  return L.join('\r\n');
}

/* 状态（关于页显示） */
function info() {
  return {
    ok: true,
    portable: paths().portable,
    source: getSource(),
    sourceIsDefault: isDefaultSource(),
    defaultSource: DEFAULT_SOURCE,
    version: app.getVersion()
  };
}

module.exports = { check, apply, info, setSource, getSource, DEFAULT_SOURCE, _internals: { resolveSource, isNewer, buildBat, paths } };
