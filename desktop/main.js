/* ==========================================================================
   个人 AI 科研工程工作台 · Electron 主进程
   - 承载渲染层（../index.html）
   - 数据持久化 / 本地文件与文件夹打开 / 工程软件进程管理
   - `--smoke` 无头自检模式：验证渲染层在真实 Electron 环境可加载
   ========================================================================== */
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('node:url');
const full = require('./full-product');
const store = require('./store');
const backup = require('./backup');
const device = require('./device');
const syncMerge = require('./sync-merge');
const syncCarrier = require('./sync-carrier');
const handoff = require('./handoff');
const account = require('./account');
const cloud = require('./cloud');
const syncCloud = require('./sync-cloud');
const updater = require('./updater');
const ai = require('./ai');
const rag = require('./rag');
const kbService = require('./kb-service');
const apiServer = require('./api-server');
apiServer.setChat(cfg => ai.chat(cfg));
const connectors = require('./connectors');

/* 启动期异常落盘，便于在无控制台的桌面环境下定位问题 */
process.on('uncaughtException', err => {
  const text = `argv: ${process.argv.join(' ')}\nwhen: ${new Date().toISOString()}\n\n${(err && err.stack) || err}`;
  try { fs.writeFileSync(path.join(__dirname, 'crash.log'), text, 'utf8'); } catch (_) {}
  logBoot('UNCAUGHT: ' + text.replace(/\n/g, ' | '));
  process.exit(1);
});

const ROOT = path.join(__dirname, '..');
const packagedConfig = require(path.join(ROOT, 'package.json'));
const fullCandidate = packagedConfig.fullCandidate === true ||
  [ROOT, path.dirname(process.execPath)].some(dir => fs.existsSync(path.join(dir, full.MARKER)));
if (fullCandidate) {
  try {
    const daily = path.join(app.getPath('appData'), '个人科研工作台');
    app.setPath('userData', full.isolatedDirectory(process.execPath, ROOT, daily));
    if (process.argv.slice(1).some(arg => /^--(?:data-dir|api-port|user-data-dir|demo|shot|fresh|sync|handoff|account|update|github|nutstore|probe|dev|smoke|no-sandbox)(?:$|[-=])/.test(arg))) {
      throw new Error('This portable release does not accept data, port, probe or security overrides');
    }
    apiServer.setChat(() => ({ ok: false, error: '工作台仅启用本机检索' }));
    if (!app.requestSingleInstanceLock()) process.exit(0);
    require('./full-migration').applyBeforeStartup(app.getPath('userData'));
  } catch (error) {
    process.stderr.write('Portable startup declined: ' + error.message + '\n');
    process.exit(1);
  }
}
const ICON_PATH = path.join(ROOT, 'icon.ico');
const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');
/* 全新设备验证模式：把 userData 指到临时目录，模拟一台干净机器 */
const isFreshProbe = process.argv.includes('--fresh-probe');
if (isFreshProbe) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-fresh-' + Date.now()));
}
/* 同步双设备验证：临时 userData，跑完即退出 */
const isSyncProbe = process.argv.includes('--sync-probe');
/* 交接文件验证：临时 userData，避免动到真实数据与同步基准 */
if (process.argv.includes('--handoff-probe')) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-handoff-probe-' + Date.now()));
}
/* 账户与云端绑定验证：临时 userData，跑完即退出 */
if (process.argv.includes('--account-probe')) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-acct-probe-' + Date.now()));
}
const isHandoffProbe = process.argv.includes('--handoff-probe');
const isAccountProbe = process.argv.includes('--account-probe');
/* 更新探针：临时 userData——"cloud 源未绑定"等用例依赖干净环境 */
if (process.argv.includes('--update-probe')) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-update-probe-' + Date.now()));
}
const isUpdateProbe = process.argv.includes('--update-probe');
const isUpdateE2E = process.argv.includes('--update-e2e');
const isNutstorePublish = process.argv.includes('--nutstore-publish');

/* 全新安装账户门验证：临时 userData，等同于一台刚装好的机器 */
if (process.argv.includes('--fresh-account')) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-fresh-acct-' + Date.now()));
}
const isFreshAccount = process.argv.includes('--fresh-account');

/* 设置页渲染诊断：临时 userData */
if (process.argv.includes('--probe-settings')) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-settings-probe-' + Date.now()));
}
const isSettingsProbe = process.argv.includes('--probe-settings');

/* 冲突重复询问验证：临时 userData */
if (process.argv.includes('--probe-conflict')) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-conflict-probe-' + Date.now()));
}
const isConflictProbe = process.argv.includes('--probe-conflict');

/* 真实 GitHub 通道诊断：临时 userData，只下载不替换 */
if (process.argv.includes('--probe-github')) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-github-probe-' + Date.now()));
}
const isGithubProbe = process.argv.includes('--probe-github');

/* 截图探针：临时 userData，导航到指定路由截一张图 */
if (process.argv.includes('--shot')) {
  /* --data-dir 可指定现有数据目录（用于验证真实数据迁移），否则用干净的临时目录 */
  const di = process.argv.indexOf('--data-dir');
  app.setPath('userData', (di > 0 && process.argv[di + 1])
    ? path.resolve(process.argv[di + 1])
    : path.join(require('os').tmpdir(), 'rw-shot-' + Date.now()));
}
const isShot = process.argv.includes('--shot');
const isShotStage3 = process.argv.includes('--shot-stage3');
const isShotStage4 = process.argv.includes('--shot-stage4');
const isShotDemo = process.argv.includes('--shot-demo');
const isDemoCli = process.argv.includes('--demo') || isShotDemo || process.env.RESEARCH_WORKSPACE_DEMO === '1';
const DEMO_API_PORT = 17323;
const demoMarkerPath = path.join(path.dirname(process.execPath), 'DEMO-PORTABLE.txt');
let isDemoPortable = !fullCandidate && (isDemoCli || fs.existsSync(demoMarkerPath));
if (isSyncProbe) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'rw-sync-' + Date.now()));
}
/* 全新安装预览：另一个窗口 + 临时 userData，关闭即丢弃 */
const isFreshPreview = process.argv.includes('--fresh-preview');
let previewDir = '';
if (isFreshPreview) {
  previewDir = path.join(require('os').tmpdir(), 'rw-preview-' + Date.now());
  app.setPath('userData', previewDir);
}
/* 独立测试实例也可指定 userData，不必搭配 --shot */
const dataDirIdx = process.argv.indexOf('--data-dir');
if (!fullCandidate && dataDirIdx > 0 && process.argv[dataDirIdx + 1] && !isFreshPreview) {
  app.setPath('userData', path.resolve(process.argv[dataDirIdx + 1]));
} else if (!fullCandidate && !isFreshPreview) {
  /* 候选便携包标记：默认使用 exe 旁的 candidate-user-data，避免误写入日常 AppData。--data-dir 仍优先。 */
  const marker = path.join(path.dirname(process.execPath), 'CANDIDATE-PORTABLE.txt');
  const demoMarker = path.join(path.dirname(process.execPath), 'DEMO-PORTABLE.txt');
  if (fs.existsSync(marker)) {
    const cand = path.join(path.dirname(process.execPath), 'candidate-user-data');
    fs.mkdirSync(cand, { recursive: true });
    app.setPath('userData', cand);
  } else if (fs.existsSync(demoMarker) || isDemoCli) {
    /* 演示数据便携包：默认使用 exe 旁的 demo-user-data，避免误写入日常 AppData。--data-dir 仍优先。 */
    isDemoPortable = true;
    const packaged = (typeof app.isPackaged === 'boolean' && app.isPackaged) || fs.existsSync(demoMarker);
    const demoDir = packaged
      ? path.join(path.dirname(process.execPath), 'demo-user-data')
      : path.join(require('os').tmpdir(), 'rw-demo-' + Date.now());
    fs.mkdirSync(demoDir, { recursive: true });
    app.setPath('userData', demoDir);
  }
}
function requestedApiPort() {
  if (fullCandidate) return full.PORT;
  const i = process.argv.indexOf('--api-port');
  if (i > 0 && process.argv[i + 1] && /^\d+$/.test(process.argv[i + 1])) {
    return Number(process.argv[i + 1]);
  }
  if (process.env.RW_API_PORT && /^\d+$/.test(process.env.RW_API_PORT)) {
    return Number(process.env.RW_API_PORT);
  }
  if (isDemoPortable) return DEMO_API_PORT;
  return apiServer.DEFAULT_PORT;
}

/* ---------- 启动日志：桌面应用没有控制台，出问题只能靠落盘日志 ---------- */
let LOG_PATH = null;
function logBoot(msg) {
  try {
    if (!LOG_PATH) LOG_PATH = path.join(require('electron').app.getPath('userData'), 'startup.log');
    require('fs').appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch (_) {}
}
function resetBootLog() {
  try {
    if (!LOG_PATH) LOG_PATH = path.join(require('electron').app.getPath('userData'), 'startup.log');
    require('fs').writeFileSync(LOG_PATH, `=== 启动 ${new Date().toISOString()} ===\n`, 'utf8');
  } catch (_) {}
}

/* 自检模式使用软件渲染，避免无显卡 / 远程桌面环境下启动失败；
   正常运行保留 GPU 加速，保证 backdrop-filter 磨砂效果流畅 */
if (isSmoke) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

/** 已由工作台拉起的进程：name -> { child, pid, startedAt } */
const children = new Map();

/* ---------- 窗口 ---------- */
function createWindow(opts = {}) {
  resetBootLog();
  logBoot(`createWindow: 开始, electron=${process.versions.electron}, argv=${process.argv.slice(1).join(' ')}`);

  const win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: fullCandidate ? 820 : 1160,
    minHeight: 700,
    backgroundColor: isDemoPortable || fullCandidate ? '#FFF9F5' : '#F4F4F7',
    title: opts.title || (fullCandidate ? '个人科研工程工作台 V' + app.getVersion() : isDemoPortable ? '科研工程工作台 · 演示数据' : '个人 AI 科研工程工作台'),
    show: false,
    autoHideMenuBar: true,
    ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: fullCandidate,
      webSecurity: true,
      additionalArguments: fullCandidate ? ['--rw-full-bridge', '--rw-full-version=' + app.getVersion()] : [],
      spellcheck: false,
      /* 内置浏览器用 <webview> 渲染真实网页。候选便携包关闭 webview。 */
      webviewTag: !fullCandidate
    }
  });

  let pageLoaded = false;
  let paintReady = false;
  let startupFailed = false;
  const showWindow = () => {
    if (startupFailed || win.isDestroyed() || win.isVisible()) return;
    win.show();
    logBoot(`show() 已调用, isVisible=${win.isVisible()}, isMinimized=${win.isMinimized()}`);
  };
  const failStartup = detail => {
    if (startupFailed) return;
    startupFailed = true;
    logBoot('Portable startup failed: ' + detail);
    apiServer.setWindow(null);
    stopDesktopServices();
    app.exit(1);
  };

  /* 主路径：内容就绪后再显示，避免白屏 */
  /* 页面 <title> 会覆盖窗口标题，预览窗口需要固定住 */
  if (opts.title || fullCandidate) {
    win.on('page-title-updated', e => { e.preventDefault(); win.setTitle(opts.title || '个人科研工程工作台 V' + app.getVersion()); });
  }

  win.once('ready-to-show', () => {
    logBoot('ready-to-show 触发');
    paintReady = true;
    if (!fullCandidate || pageLoaded) showWindow();
  });

  /* 兜底：个别环境下 ready-to-show 可能不触发，加载完成即显示 */
  win.webContents.once('did-finish-load', () => {
    if (startupFailed) return;
    pageLoaded = true;
    logBoot(`did-finish-load, isVisible=${win.isVisible()}`);
    if (fullCandidate) apiServer.setWindow(win);
    if (paintReady) showWindow();
    else if (!win.isVisible()) setTimeout(showWindow, 800);
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    logBoot(`did-fail-load: ${code} ${desc} ${url}`);
    if (fullCandidate && !pageLoaded && isMainFrame && code !== -3) failStartup('main page load error ' + code);
  });
  if (fullCandidate) {
    win.webContents.on('preload-error', () => failStartup('sandboxed preload failed'));
  }
  win.webContents.on('render-process-gone', (_e, d) => {
    logBoot('render-process-gone: ' + JSON.stringify(d));
    if (fullCandidate && d.reason === 'launch-failed') {
      if (process.platform === 'win32' && d.exitCode === 49) {
        logBoot('Chromium Windows sandbox could not create a restricted renderer token.');
      }
      failStartup('renderer launch error ' + d.exitCode);
    }
  });
  win.on('unresponsive', () => logBoot('窗口无响应'));
  win.on('closed', () => logBoot('窗口已关闭'));

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!fullCandidate) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (fullCandidate) win.webContents.on('will-navigate', event => event.preventDefault());

  /* 窗口重建后让 API 服务指向新窗口（外接 Agent 调用始终打到活跃窗口） */
  if (!fullCandidate) apiServer.setWindow(win);

  win.loadFile(path.join(ROOT, isDemoPortable ? 'demo.html' : 'index.html'), opts.query ? { query: opts.query } : undefined)
    .then(() => logBoot('loadFile 已返回'))
    .catch(err => {
      logBoot('loadFile 失败: ' + ((err && err.message) || err));
      if (fullCandidate && !pageLoaded) failStartup('initial page could not be loaded');
    });

  return win;
}

/* ==========================================================================
   webview 安全护栏
   内置浏览器加载的是任意外部网页，必须保证它拿不到 Node 能力、也跳不到本地文件。
   ========================================================================== */
app.on('web-contents-created', (_e, contents) => {
  /* 外部网页（webview 内）：只允许 http/https 导航，弹窗转交系统浏览器 */
  if (contents.getType() === 'webview') {
    contents.on('will-navigate', (evt, url) => {
      if (!/^https?:\/\//i.test(String(url || ''))) evt.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(String(url || ''))) shell.openExternal(url);
      return { action: 'deny' };
    });
    return;
  }

  /* 主窗口：拦截 webview 挂载，绝不给外部页面挂应用 preload 或 Node 能力 */
  contents.on('will-attach-webview', (evt, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    const src = String((params && params.src) || '');
    if (src && !/^https?:\/\//i.test(src)) evt.preventDefault();
  });
});

app.whenReady().then(async () => {
  logBoot('app ready');

  /* 全新安装预览：独立窗口 + 临时数据；不启动本地 API，避免与主实例抢端口 */
  if (isFreshPreview) {
    const win = createWindow({ query: { fresh: '1' }, title: '个人科研工作台 · 全新安装预览' });
    win.on('closed', () => { try { fs.rmSync(previewDir, { recursive: true, force: true }); } catch (_) {} });
    app.on('window-all-closed', () => app.quit());
    return;
  }

  /* 本地 API：供外部 Agent（Codex / WorkBuddy / Claude 等）接入。
     自检模式同样启动 —— 这样自检能顺带验证「外部接入通道」本身是否可用。 */
  const started = await apiServer.start({
    userDataDir: app.getPath('userData'),
    port: requestedApiPort(),
    strictPort: fullCandidate,
    version: fullCandidate ? app.getVersion() : '',
    searchKnowledge: fullCandidate ? () => ({ ok: false, code: 'deferred', error: 'RAG_Snowz 全文检索尚未接入。' }) : undefined,
    log: m => logBoot('[api] ' + m)
  });
  logBoot(started.ok ? `本地 API 就绪 http://127.0.0.1:${started.port}` : '本地 API 启动失败: ' + started.error);
  if (isDemoPortable) {
    logBoot('演示数据运行时：跳过 RPM 适配绑定，不初始化真实项目或知识网络接口');
  } else {
    try { bindRpmAdapter(); } catch (err) {
      logBoot('RPM 只读适配层绑定失败: ' + String((err && err.message) || err));
    }
  }

  /* 有本机密码就先锁上：窗口起来后由渲染层显示解锁页 */
  if (!fullCandidate) {
    try {
      const lk = account.bootLock();
      logBoot(lk.locked ? '本机已锁定，等待解锁' : '本机未设密码，直接进入');
    } catch (err) {
      logBoot('启动锁定失败: ' + String((err && err.message) || err));
    }
  }

  if (isFreshProbe) {
    const r = await require('./fresh-probe').run({ ROOT, outPath: path.join(__dirname, 'probe-fresh-result.json') });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isSyncProbe) {
    const r = await require('./sync-probe').run({ outPath: path.join(__dirname, 'probe-sync-result.json') });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isHandoffProbe) {
    const r = await require('./handoff-probe').run({ outPath: path.join(__dirname, 'probe-handoff-result.json') });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isShotStage3) {
    const outIdx = process.argv.indexOf('--shot-out');
    const outDir = (outIdx > 0 && process.argv[outIdx + 1])
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(ROOT, '.preview', 'stage3');
    const r = await require('./shot-stage3').run({ ROOT, outDir });
    app.exit(r && r.ok ? 0 : 1);
    return;
  }
  if (isShotStage4) {
    const outIdx = process.argv.indexOf('--shot-out');
    const outDir = (outIdx > 0 && process.argv[outIdx + 1])
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(ROOT, '.preview', 'stage4');
    const r = await require('./shot-stage4').run({ ROOT, outDir });
    app.exit(r && r.ok ? 0 : 1);
    return;
  }
  if (isShotDemo) {
    const outIdx = process.argv.indexOf('--shot-out');
    const outDir = (outIdx > 0 && process.argv[outIdx + 1])
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(ROOT, '.preview', 'proto-demo');
    const r = await require('./shot-demo').run({ ROOT, outDir });
    app.exit(r && r.ok ? 0 : 1);
    return;
  }
  if (isShot) {
    const idx = process.argv.indexOf('--shot');
    const route = process.argv[idx + 1] || 'agents';
    await require('./shot-probe').run({
      ROOT, route,
      out: path.join(ROOT, '.preview', `shot-${route}.png`)
    });
    app.exit(0);
    return;
  }
  if (isGithubProbe) {
    const r = await require('./github-probe').run({
      outPath: path.join(__dirname, 'probe-github-result.json')
    });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isConflictProbe) {
    const r = await require('./conflict-repeat-probe').run({
      outPath: path.join(__dirname, 'probe-conflict-result.json')
    });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isSettingsProbe) {
    const r = await require('./settings-probe').run({
      ROOT, outPath: path.join(__dirname, 'probe-settings-result.json')
    });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isFreshAccount) {
    const r = await require('./fresh-account-probe').run({
      ROOT, outPath: path.join(__dirname, 'probe-fresh-account-result.json')
    });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isNutstorePublish) {
    const r = await require('./nutstore-publish-update').run();
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isUpdateE2E) {
    const r = await require('./e2e-update').run();
    if (!r || !r.ok) app.exit(1);
    return;  /* 成功路径由 bat 负责重启，进程在这里自然退出 */
  }
  if (isUpdateProbe) {
    const r = await require('./update-probe').run({ outPath: path.join(__dirname, 'probe-update-result.json') });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isAccountProbe) {
    const r = await require('./account-probe').run({ outPath: path.join(__dirname, 'probe-account-result.json') });
    app.exit(r.ok ? 0 : 1);
    return;
  }
  if (isSmoke) { await runSmoke(); return; }

  const win = createWindow();
  if (fullCandidate) initializeFullProduct(win, started.ok);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  stopAll();
  if (process.platform !== 'darwin') app.quit();
});

function stopDesktopServices() {
  fullServices?.markdown.close();
  fullServices?.codex.close();
  stopAll();
  apiServer.stop();
}

app.on('before-quit', stopDesktopServices);


function parseWorkspaceData() {
  if (fullCandidate) return readCanonicalWorkspace();
  try {
    const raw = store.readData();
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return {};
  }
}

let fullServices;
let fullWindow;
const fullChannels = new Set([
  'data:load', 'data:save', 'data:path', 'account:status', 'account:unlock',
  'backup:info', 'backup:auto', 'backup:now', 'device:info',
  'rpm:projectRoot', 'rpm:files', 'rpm:relations', 'rpm:rpm-audit',
  'rpm:knowledgeSnapshot', 'rpm:knowledgeResolve', 'rpm:knowledgeOpenFile',
  'full:status', 'full:vault:status', 'full:vault:choose', 'full:search', 'full:openMaterial', 'full:openOriginal', 'full:import', 'full:rpmProjects', 'full:rpmBinding', 'full:rpmRegister',
  'full:migration:profile', 'full:migration:backup', 'full:migration:status',
  'full:markdown:list', 'full:markdown:read', 'full:markdown:save', 'full:markdown:versions',
  'full:markdown:restore', 'full:markdown:watch', 'full:markdown:unwatch',
  'full:markdown:create', 'full:markdown:backlinks', 'full:markdown:resolveLink', 'full:markdown:references',
  'full:rpmOnboarding:preview', 'full:rpmOnboarding:page', 'full:rpmOnboarding:confirm',
  'full:rpmOnboarding:list', 'full:rpmOnboarding:save', 'full:rpmOnboarding:rescan',
  'full:rpmOnboarding:abandon', 'full:rpmOnboarding:finish',
  'full:codex:capabilities', 'full:codex:pending', 'full:codex:discover', 'full:codex:bind', 'full:codex:list',
  'full:codex:refresh', 'full:codex:handoff', 'full:codex:artifact'
]);

function registerIpc(channel, handler) {
  if (!fullCandidate) {
    ipcMain.handle(channel, handler);
    return;
  }
  if (!fullChannels.has(channel)) return;
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    if (!fullWindow || event.sender !== fullWindow.webContents || frame !== event.sender.mainFrame ||
        !frame.url.startsWith('file:') || !full.samePath(fileURLToPath(frame.url), path.join(ROOT, 'index.html'))) {
      return { ok: false, code: 'untrusted_frame', error: '请求来源无效' };
    }
    return handler(event, ...args);
  });
}

async function registeredProjectRoot(projectId) {
  const ctx = rpmContext();
  const project = ctx.listWorkbenchProjects().find(row => row.id === projectId);
  if (!project) return null;
  const { resolved, listed } = await require('./rpm-http').resolveForProject(ctx, project);
  const registeredRoot = listed.ok && listed.data[resolved.rpmProjectId];
  if (!resolved.ok || !resolved.rpmBound || !registeredRoot || !full.samePath(registeredRoot, resolved.resolvedRoot)) return null;
  return {
    root: resolved.resolvedRoot,
    rpmProjectId: resolved.rpmProjectId,
    registeredRoots: Object.values(listed.data).filter(value => typeof value === 'string' && path.isAbsolute(value)),
    metadataOnly: full.metadataOnly(resolved.rpmProjectId, resolved.resolvedRoot),
    readOnly: full.protectedProjectWrite(resolved.rpmProjectId, resolved.resolvedRoot)
  };
}

async function codexReferences(project) {
  const result = await require('./rpm-knowledge').querySnapshot(rpmContext().getConfig(), { projectId: project.rpmProjectId });
  if (!result.ok) return null;
  const ids = new Set();
  for (const record of [...(result.files || []), ...(result.nodes || [])]) {
    const scoped = record.project_id === project.rpmProjectId || record.project_ids?.includes(project.rpmProjectId);
    if (!scoped) continue;
    if (record.id) ids.add(record.id);
    if (record.file_id) ids.add(record.file_id);
  }
  return ids;
}

async function codexProjectRoot(projectId) {
  const project = await registeredProjectRoot(projectId);
  if (!project) return null;
  const inspected = require('./project-root').inspectPath(project.root);
  if (!inspected.exists || inspected.hasReparseInPath || !full.samePath(inspected.realPath, project.root)) return null;
  return { ...project, allowActivityTracking: true };
}

function validatedVaultDirectory(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || folder.startsWith('\\') ||
      full.samePath(folder, path.parse(folder).root) || full.metadataOnly('', folder)) return '';
  const checked = require('./project-root').inspectPath(folder);
  try {
    return checked.exists && !checked.hasReparseInPath && full.samePath(folder, checked.realPath) &&
      fs.statSync(checked.realPath).isDirectory() ? checked.realPath : '';
  } catch (_) { return ''; }
}

function configuredVault(userData) {
  if (process.env.RW_VAULT_ROOT) return validatedVaultDirectory(process.env.RW_VAULT_ROOT);
  try {
    const file = path.join(userData, 'vault-config.json');
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.nlink !== 1 || info.size > 16384 || !full.samePath(file, fs.realpathSync.native(file))) return '';
    return validatedVaultDirectory(JSON.parse(fs.readFileSync(file, 'utf8')).vaultRoot);
  } catch (_) { return ''; }
}

function initializeFullProduct(win, apiReady) {
  fullWindow = win;
  const { createMarkdownService } = require('./full-markdown');
  const { createSearch } = require('./full-search');
  const userData = app.getPath('userData');
  const notify = (channel, data) => { if (!win.isDestroyed()) win.webContents.send(channel, data); };
  const vaultRoot = configuredVault(userData);
  const markdown = createMarkdownService({
    vaultRoot,
    backupDir: path.join(userData, 'markdown-versions'),
    resolveProject: registeredProjectRoot,
    openAttachment: file => shell.openPath(file),
    onChange: event => notify('full:markdown:change', event)
  });

  const search = createSearch({
    readWorkspace: parseWorkspaceData,
    searchRpm: (projectId, query) => handleRpmQuery('files', projectId, { query, limit: 15 }),
    readGraph: () => require('./rpm-knowledge').querySnapshot(rpmContext().getConfig()),
    listNotes: query => markdown.list(query)
  });
  const { createCodexCollaboration } = require('./codex-collaboration');
  const codex = createCodexCollaboration({
    file: path.join(userData, 'codex-executions.json'),
    readWorkspace: readCanonicalWorkspace,
    resolveProject: codexProjectRoot,
    openArtifact: target => shell.openPath(target),
    revealArtifact: target => shell.showItemInFolder(target),
    confirmArtifact: async ({ path: originalPath }) => {
      const choice = await dialog.showMessageBox(fullWindow, {
        type: 'question', buttons: ['取消', '登记到 RPM'], defaultId: 0, cancelId: 0,
        message: '将此执行文件原位登记到 RPM？',
        detail: originalPath + '\n\n此文件作为任务资料，科研成果和任务状态保持原样。'
      });
      return choice.response === 1;
    },
    rpmConfig: () => rpmContext().getConfig(),
    onChange: change => notify('full:codex:change', change)
  });
  fullServices = { markdown, search, codex, apiReady, vaultRoot };

}

function readCanonicalWorkspace() {
  try {
    return JSON.parse(fs.readFileSync(store.dataFile(), 'utf8'));
  } catch (_) { return {}; }
}

function saveWorkspaceData(json) {
  if (!fullCandidate) return store.writeData(json);
  try {
    const data = JSON.parse(json);
    if (!Array.isArray(data.projects) || !Array.isArray(data.tasks)) throw new Error('Invalid workspace');
    if (fs.existsSync(store.dataFile()) && !Array.isArray(readCanonicalWorkspace().projects)) {
      return { ok: false, error: '当前工作台数据无法读取，请备份后使用导入恢复' };
    }
    full.atomicWrite(store.dataFile(), JSON.stringify(data));
    return { ok: true };
  } catch (_) { return { ok: false, error: '工作台数据格式无效' }; }
}

if (fullCandidate) {
  const unavailable = { ok: false, code: 'unavailable', error: '工作台连接还未就绪' };
  registerIpc('full:status', () => ({ ok: true, apiReady: !!fullServices?.apiReady, apiPort: full.PORT, version: full.VERSION }));
  registerIpc('full:vault:status', () => ({
    ok: true, bound: Boolean(fullServices?.vaultRoot), launchOverride: Boolean(process.env.RW_VAULT_ROOT)
  }));
  registerIpc('full:vault:choose', async () => {
    if (!fullServices) return unavailable;
    if (process.env.RW_VAULT_ROOT) return { ok: false, error: '当前启动已指定 Vault 目录' };
    const selected = await dialog.showOpenDialog(fullWindow, {
      title: '选择当前工作台使用的中央 Obsidian Vault', properties: ['openDirectory']
    });
    if (selected.canceled) return { ok: false, code: 'cancelled' };
    const vaultRoot = validatedVaultDirectory(selected.filePaths[0]);
    if (!vaultRoot) return { ok: false, error: '目录无效、受保护或经过重定向' };
    try {
      full.atomicWrite(path.join(app.getPath('userData'), 'vault-config.json'), JSON.stringify({ vaultRoot }));
      return { ok: true, restartRequired: true };
    } catch (_) { return { ok: false, error: '无法保存工作台 Vault 设置' }; }
  });
  async function registeredRpmProjects() {
    const result = await require('./rpm-adapter').listProjects(rpmContext().getConfig());
    return result.ok ? { ok: true, projects: result.projects }
      : { ok: false, code: result.code, error: 'RPM 项目登记表不可用' };
  }
  registerIpc('full:rpmProjects', registeredRpmProjects);
  registerIpc('full:rpmBinding', async (_e, payload) => {
    const result = await registeredRpmProjects();
    if (!result.ok) return result;
    const binding = result.projects.find(row => row.rpmProjectId === payload?.rpmProjectId);
    if (!binding) return { ok: false, error: '该项目不在 RPM 登记表中' };
    const valid = require('./project-root').inspectPath(binding.rpmRoot);
    return valid.exists && !valid.hasReparseInPath && full.samePath(valid.realPath, binding.rpmRoot)
      ? { ok: true, binding } : { ok: false, error: 'RPM 登记项目的真实根目录不可用' };
  });
  registerIpc('full:rpmRegister', async (_e, payload) => {
    const project = readCanonicalWorkspace().projects?.find(row => row.id === payload?.projectId);
    if (!project) return { ok: false, error: '找不到要绑定的工作台项目' };
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const direction = typeof payload.direction === 'string' ? payload.direction.trim() : '';
    if (!name || !direction) return { ok: false, error: '请填写项目名称和研究方向' };
    try {
      const selected = await dialog.showOpenDialog(fullWindow, {
        title: '选择或新建 RPM 项目根目录', properties: ['openDirectory', 'createDirectory']
      });
      if (selected.canceled || selected.filePaths.length !== 1) return { ok: false, code: 'cancelled' };
      const root = selected.filePaths[0];
      const choice = await dialog.showMessageBox(fullWindow, {
        type: 'question', buttons: ['取消', '登记并绑定'], defaultId: 0, cancelId: 0,
        message: '登记并绑定此 RPM 项目？',
        detail: root + '\n\n已有登记会沿用。新登记会创建标准目录和管理记录，原位建立文件索引，并同步 RPM 的中央导航。'
      });
      if (choice.response !== 1) return { ok: false, code: 'cancelled' };
      return await require('./rpm-registration').registerProject({ root, name, direction, emptyOnly: true }, rpmContext().getConfig());
    } catch (_) { return { ok: false, error: 'RPM 登记未完成，请核对目录和 RPM 安装' }; }
  });
  const rpmRegistration = () => require('./rpm-registration');
  const onboardingConfig = () => ({
    ...rpmContext().getConfig(), onboardingDirectory: path.join(app.getPath('userData'),'rpm-onboarding')
  });
  const scopedOnboarding = payload => {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.projectId == null || payload.projectId === '') return { ...payload, projectId: 'new-workspace-project' };
    return readCanonicalWorkspace().projects?.some(row => row.id === payload.projectId) ? payload : null;
  };
  const missingOnboardingProject = { ok: false, error: '找不到当前工作台项目' };
  registerIpc('full:rpmOnboarding:preview', async (_event, supplied) => {
    const payload = scopedOnboarding(supplied);
    if (!payload) return missingOnboardingProject;
    const chosen = await dialog.showOpenDialog(fullWindow, {
      title: '选择要接管的已有项目文件夹', properties: ['openDirectory']
    });
    if (chosen.canceled || chosen.filePaths.length !== 1) return { ok: false, code: 'cancelled' };
    return rpmRegistration().previewOnboarding({
      projectId: payload.projectId, name: payload.name, direction: payload.direction,
      projectType: payload.projectType, root: chosen.filePaths[0]
    }, onboardingConfig());
  });
  registerIpc('full:rpmOnboarding:list', () => rpmRegistration().listOnboarding(onboardingConfig()));
  for (const [action, method] of Object.entries({
    save: 'saveOnboarding', rescan: 'rescanOnboarding', abandon: 'abandonOnboarding', finish: 'finishOnboarding'
  })) {
    registerIpc('full:rpmOnboarding:' + action, (_event, supplied) => {
      const payload = scopedOnboarding(supplied);
      return payload ? rpmRegistration()[method](payload, onboardingConfig()) : missingOnboardingProject;
    });
  }
  registerIpc('full:rpmOnboarding:page', (_event, supplied) => {
    const payload = scopedOnboarding(supplied);
    return payload ? rpmRegistration().onboardingPage(payload, onboardingConfig()) : missingOnboardingProject;
  });
  registerIpc('full:rpmOnboarding:confirm', async (_event, supplied) => {
    const payload = scopedOnboarding(supplied);
    if (!payload) return missingOnboardingProject;
    const preview = await rpmRegistration().onboardingPage({ token: payload.token, projectId: payload.projectId }, onboardingConfig());
    if (!preview.ok) return preview;
    if (preview.phase === 'registered') return rpmRegistration().confirmOnboarding(payload, onboardingConfig());
    if (preview.blocked) return { ok: false, code: 'preview_blocked', error: preview.blocked };
    const selected = await dialog.showMessageBox(fullWindow, {
      type: 'question', buttons: ['取消', '确认原位登记'], defaultId: 0, cancelId: 0,
      message: '允许写入项目管理记录并更新 RPM 中央导航？',
      detail: preview.root + '\n\n将建立或更新项目管理记录和中央导航。原始文件路径保持不变。'
    });
    if (selected.response !== 1) return { ok: false, code: 'cancelled' };
    return rpmRegistration().confirmOnboarding(payload, onboardingConfig());
  });
  for (const method of ['list', 'read', 'save', 'versions', 'restore', 'watch', 'unwatch', 'create', 'backlinks', 'resolveLink', 'references']) {
    registerIpc('full:markdown:' + method, (_e, payload) => fullServices?.markdown[method](payload || {}) || unavailable);
  }
  registerIpc('full:search', (_e, query) => fullServices?.search.search(query) || unavailable);
  for (const method of ['capabilities', 'pending', 'discover', 'bind', 'list', 'refresh', 'artifact']) {
    registerIpc('full:codex:' + method, async (_event, payload) => {
      try { return await fullServices?.codex[method](payload || {}) || unavailable; }
      catch (_) { return { ok: false, code: 'codex_unavailable', error: 'Codex 本机连接或执行记录暂不可用' }; }
    });
  }
  registerIpc('full:codex:handoff', async (_event, payload) => {
    if (!fullServices) return unavailable;
    try {
      const draft = await require('./codex-handoff').createHandoff({
        context: payload, readWorkspace: readCanonicalWorkspace, resolveProject: codexProjectRoot,
        resolveReferences: codexReferences
      });
      if (!draft.ok) return draft;
      await clipboard.writeText(draft.text);
      return { ok: true, mode: 'copy' };
    } catch (_) {
      return { ok: false, code: 'handoff_unavailable', error: '无法核对项目或写入本机剪贴板' };
    }
  });
  registerIpc('full:openOriginal', async (_e, payload) => {
    try {
      return await require('./rpm-knowledge').openOriginal(rpmContext().getConfig(), payload);
    } catch (_) { return { ok: false, error: '原件暂时无法打开' }; }
  });
  registerIpc('full:openMaterial', async (_e, payload) => {
    try {
      const project = await registeredProjectRoot(payload?.projectId);
      if (!project) return { ok: false, error: '项目尚未绑定 RPM' };
      return await require('./rpm-knowledge').accessMaterial(rpmContext().getConfig(), project, payload, {
        open: target => shell.openPath(target),
        reveal: target => shell.showItemInFolder(target),
        copy: target => clipboard.writeText(target)
      });
    } catch (_) { return { ok: false, error: '暂时无法访问此文件' }; }
  });
  const migration = require('./full-migration');
  const migrationError = error => ({ ok: false, error: error instanceof Error ? error.message : '迁移未完成' });
  let migrationBusy = false;
  async function requestMigration(kind) {
    if (migrationBusy) return { ok: false, error: '已有迁移操作正在进行' };
    migrationBusy = true;
    try {
      const target = app.getPath('userData');
      const status = migration.readStatus(target);
      if (!status.ok || status.pending) return { ok: false, error: status.error || '已有迁移等待重启' };
      const selected = await dialog.showOpenDialog(fullWindow, kind === 'json' ? {
        title: '选择工作台 JSON 副本', properties: ['openFile'],
        filters: [{ name: '工作台数据', extensions: ['json'] }]
      } : { title: '选择旧版程序旁的数据文件夹或迁移备份', properties: ['openDirectory'] });
      if (selected.canceled || selected.filePaths.length !== 1) return { ok: false, code: 'cancelled' };
      const source = selected.filePaths[0];
      const before = migration.preview(target, source, kind, validatedVaultDirectory);
      const choice = await dialog.showMessageBox(fullWindow, {
        type: 'warning', buttons: ['取消', '备份并迁移'], defaultId: 0, cancelId: 0,
        message: '迁移到科研工程工作台 4.0.0？',
        detail: [
          before.version + ' · ' + before.projects + ' 个项目 · ' + before.tasks + ' 个任务' +
            (kind === 'json' ? '' : ' · ' + before.runs + ' 条 Codex 执行记录'),
          '重新启动时会备份 4.0.0 数据，再替换相应记录。旧版程序和原始文件保持原样。',
          ...before.warnings
        ].join('\n')
      });
      if (choice.response !== 1) return { ok: false, code: 'cancelled' };
      const after = migration.preview(target, source, kind, validatedVaultDirectory);
      if (before.version !== after.version || JSON.stringify(before.sourceDigest) !== JSON.stringify(after.sourceDigest)) {
        return { ok: false, error: '原数据在确认期间有变化，请关闭旧版程序后重试' };
      }
      return migration.stage(target, after);
    } catch (error) { return migrationError(error); }
    finally { migrationBusy = false; }
  }
  registerIpc('full:import', () => requestMigration('json'));
  registerIpc('full:migration:profile', () => requestMigration('profile'));
  registerIpc('full:migration:backup', () => {
    try { return { ok: true, ...migration.captureBackup(app.getPath('userData')) }; }
    catch (error) { return migrationError(error); }
  });
  registerIpc('full:migration:status', () => migration.readStatus(app.getPath('userData')));
}

async function openFullRpmFile(projectId, fileId) {
  if (full.metadataOnly(projectId)) return { ok: false, error: '此项目仅接入元数据', opened: false };
  const knowledge = require('./rpm-knowledge');
  const result = await knowledge.queryResolve(rpmContext().getConfig(), projectId, fileId);
  if (!result.ok) return { ...result, opened: false };
  const file = result.file;
  if (!file?.path || !file.relative_path) return { ok: false, error: '原件无法定位', opened: false };
  const relative = file.relative_path.split(/[\\/]/);
  const root = path.resolve(file.path, ...relative.map(() => '..'));
  const target = full.safeDocument(root, file.relative_path);
  if (!target || !full.samePath(target, file.path)) return { ok: false, error: '原件路径或格式不可打开', opened: false };
  const error = await shell.openPath(target);
  return error ? { ok: false, error: '系统无法打开原件', opened: false } : { ok: true, opened: true };
}

function rpmContext() {
  const rpmAdapter = require('./rpm-adapter');
  return {
    getConfig() {
      if (fullCandidate) return {};
      const fromDevice = device.rpmConfig ? device.rpmConfig() : {};
      const data = parseWorkspaceData();
      return rpmAdapter.configFrom(fromDevice, data);
    },
    getRootDir() {
      if (fullCandidate) return '';
      try { return String((device.read() || {}).rootDir || ''); } catch (_) { return ''; }
    },
    getBindings() {
      const data = parseWorkspaceData();
      const map = (data.settings && data.settings.rpmBindings) || {};
      const out = { ...map };
      (data.projects || []).forEach(p => {
        if (!p || !p.id) return;
        if (p.rpmRoot || p.rpmProjectId || p.projectRoot) {
          out[p.id] = Object.assign({}, out[p.id], {
            rpmProjectId: p.rpmProjectId || (out[p.id] && out[p.id].rpmProjectId) || '',
            rpmRoot: p.rpmRoot || p.projectRoot || (out[p.id] && out[p.id].rpmRoot) || ''
          });
        }
      });
      return out;
    },
    listWorkbenchProjects() {
      const data = parseWorkspaceData();
      return Array.isArray(data.projects) ? data.projects : [];
    }
  };
}

function bindRpmAdapter() {
  apiServer.setRpmContext(rpmContext());
}

async function handleRpmQuery(kind, projectId, opts) {
  try {
    const rpmHttp = require('./rpm-http');
    const ctx = rpmContext();
    if (kind === 'root') return await rpmHttp.queryRoot(ctx, projectId);
    if (kind === 'files') return await rpmHttp.queryFiles(ctx, projectId, opts || {});
    if (kind === 'relations') return await rpmHttp.queryRelations(ctx, projectId);
    if (kind === 'rpm-audit') return await rpmHttp.queryAudit(ctx, projectId);
    return { ok: false, error: '未知查询' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function stopAll() {
  children.forEach(({ child }) => { try { killTree(child.pid); } catch (_) {} });
  children.clear();
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFile('taskkill', ['/pid', String(pid), '/T', '/F']); } catch (_) {}
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  }
}

/* ==========================================================================
   IPC：数据持久化
   ========================================================================== */
registerIpc('data:load', () => {
  if (!fullCandidate) return store.readData();
  const data = readCanonicalWorkspace();
  return Array.isArray(data.projects) ? JSON.stringify(data) : null;
});
registerIpc('data:save', (_e, json) => saveWorkspaceData(json));
registerIpc('data:reset', () => store.resetData());
registerIpc('data:path', () => store.dataFile());

/* ==========================================================================
   IPC：数据备份（真备份 —— 副本落盘，可列历史、可恢复）
   ========================================================================== */
registerIpc('device:info', () => fullCandidate ? { deviceId: 'full-candidate', deviceName: '便携版' } : device.info());

/* 多设备同步：三方合并（纯逻辑，不读写文件） */
registerIpc('sync:merge', (_e, payload) => {
  try { return syncMerge.merge(payload || {}); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

/* 共享文件夹载体：状态 / 选择目录 / 执行同步 */
/* ==========================================================================
   IPC：账户（身份 / 本机密码 / 云端绑定）
   --------------------------------------------------------------------------
   身份存在数据文件里（随同步走），本机密码与云端凭证存在 device.json（不参与同步）。
   ========================================================================== */
registerIpc('account:status', () => {
  if (fullCandidate) return { ok: true, registered: false, locked: false };
  try { return account.status(); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:providers', () => cloud.catalog());
registerIpc('account:register', (_e, payload) => {
  try { return account.register(payload || {}); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:rename', (_e, name) => {
  try { return account.renameAccount(name); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:setPass', (_e, p) => {
  try { return account.setPass(p); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:clearPass', () => account.clearPass());
registerIpc('account:unlock', (_e, p) => {
  if (fullCandidate) return { ok: false, error: '便携版使用独立本机数据' };
  try { return account.unlock(p); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:lock', () => account.lock());
registerIpc('account:testCloud', async (_e, cfg) => {
  try { return await account.testCloud(cfg || {}); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:bind', async (_e, cfg) => {
  try {
    const r = await account.bind(cfg || {});
    if (r && r.ok) {
      /* 换了远端还拿旧基准比对，会凭空算出「对方删了 / 本地删了」——必须清掉 */
      syncCloud.clearBase();
      try { r.remote = await syncCloud.probeRemote(); } catch (_) {}
    }
    return r;
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:unbind', () => {
  try {
    const r = account.unbind();
    syncCloud.clearBase();
    return r;
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('account:resetLocal', () => {
  try {
    const r = account.resetLocal();
    syncCloud.clearBase();
    return r;
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
/* ==========================================================================
   IPC：应用内更新（便携版；增量更新 resources/app）
   ========================================================================== */
/* 保存写作产出（Agent/aiChat 的 save_document 工具）：
   路径相对工作区根目录，逐段过滤非法段，禁止目录逃逸 */
/* 项目只存相对文件夹名，绝对位置只在 device.json 的 rootDir。
   没有根目录时不借用 suggestedRoot，也不把文件夹名拼到当前盘。 */
function writingRootMissingError(payload) {
  const name = String((payload && payload.projectName) || '').trim();
  const folder = String((payload && payload.projectFolder) || '').trim();
  const who = name
    ? `当前项目「${name}」只记录了文件夹名「${folder || '未命名'}」，没有可用的绝对路径。`
    : '项目记录里没有可用的绝对路径。';
  return '尚未设置工作区根目录，文档没有写入磁盘。请打开「设置 → 数据与同步」，点「工作区根目录」右侧的「更改」，选择本机已经存放项目材料的文件夹；也可以在新建项目时指定根目录。'
    + who
    + '不会猜测盘符，也不会写到别的位置。';
}
registerIpc('doc:save-writing', (_e, payload) => {
  try {
    const root = String(device.info().rootDir || '').trim();
    if (!root) return { ok: false, error: writingRootMissingError(payload), code: 'root_missing' };
    const rel = String((payload && payload.relPath) || '');
    const segs = rel.replace(/\\/g, '/').split('/')
      .map(x => x.trim()).filter(x => x && x !== '.' && x !== '..' && !/[<>:"|?*]/.test(x));
    if (!segs.length) return { ok: false, error: '路径不合法：' + rel };
    const abs = path.join(root, ...segs);
    let overwritten = false;
    try { overwritten = fs.existsSync(abs) && fs.statSync(abs).isFile(); } catch (_) { overwritten = false; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String((payload && payload.content) || ''), 'utf8');
    return { ok: true, absPath: abs, relPath: segs.join('/'), overwritten };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
registerIpc('update:info', () => {
  try { return updater.info(); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('update:check', async () => {
  try { return await updater.check(); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('update:apply', async () => {
  try {
    const r = await updater.apply();
    /* bat 在等主进程退出，这里给渲染层一拍时间弹提示再退 */
    if (r && r.ok && r.restarting) setTimeout(() => app.quit(), 1200);
    return r;
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('update:setSource', (_e, v) => {
  try { return updater.setSource(v); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('cloud:probe', async () => {
  try { return await syncCloud.probeRemote(); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

/* ==========================================================================
   IPC：同步入口（绑了云端走云端，否则退回本地目录载体）
   ========================================================================== */
registerIpc('sync:info', async () => {
  try {
    const b = account.currentBinding();
    if (b && b.kind === 'webdav') {
      const c = syncCloud.info();
      const p = await syncCloud.peers();
      return {
        ok: true, mode: 'cloud', enabled: true, carrier: 'webdav',
        dir: b.dir || '', url: b.url || '', user: b.user || '',
        deviceId: c.deviceId, deviceName: c.deviceName,
        lastSyncAt: c.lastSyncAt, hasBase: c.hasBase,
        peers: (p.peers || []).map(x => ({
          file: x.file, deviceId: x.deviceId,
          deviceName: x.deviceId ? x.deviceId.slice(0, 8) : x.file, mtime: x.mtime
        }))
      };
    }
    const f = syncCarrier.info();
    return {
      ok: true, mode: b ? 'folder' : (f.dir ? 'folder' : ''),
      enabled: !!(b || f.dir), carrier: 'folder',
      dir: b ? (b.dir || '') : f.dir,
      deviceId: f.deviceId, deviceName: f.deviceName,
      lastSyncAt: f.lastSyncAt, hasBase: f.hasBase, peers: f.peers || []
    };
  } catch (err) {
    return { ok: false, enabled: false, dir: '', peers: [], error: String((err && err.message) || err) };
  }
});
registerIpc('sync:setDir', (_e, dir) => syncCarrier.setDir(dir));
registerIpc('sync:run', async (_e, opts) => {
  try {
    const b = account.currentBinding();
    if (b) return await syncCloud.run(opts || {});
    return syncCarrier.run(opts || {});
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

/* ==========================================================================
   IPC：交接文件（不依赖网盘 / 局域网的搬数据方式）
   - 数据包 .json：导到 U 盘或发出去，另一台导入时走同一套三方合并
   - 交接单 .md：给人或给 AI 读的现状摘要，不参与合并
   ========================================================================== */
registerIpc('handoff:info', () => handoff.info());

registerIpc('handoff:export', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false, error: '没有可用窗口' };
  const r = await dialog.showSaveDialog(win, {
    title: '导出数据包',
    defaultPath: handoff.suggestedName('pack'),
    filters: [{ name: '工作台数据', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { return handoff.exportPack(r.filePath); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

registerIpc('handoff:import', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false, error: '没有可用窗口' };
  const r = await dialog.showOpenDialog(win, {
    title: '选择要导入的数据包',
    properties: ['openFile'],
    filters: [{ name: '工作台数据', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
  try { return handoff.importPack(r.filePaths[0], {}); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

registerIpc('handoff:apply', (_e, opts) => {
  try {
    const o = opts || {};
    if (!o.file) return { ok: false, error: '缺少文件路径' };
    return handoff.importPack(o.file, { choices: o.choices || {}, _force: !!o.force });
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

registerIpc('handoff:doc', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false, error: '没有可用窗口' };
  const r = await dialog.showSaveDialog(win, {
    title: '导出交接单',
    defaultPath: handoff.suggestedName('doc'),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { return handoff.exportDoc(r.filePath); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
registerIpc('backup:info', () => backup.info());
registerIpc('backup:now', () => backup.create('manual'));
registerIpc('backup:auto', () => backup.auto());
registerIpc('backup:restore', (_e, name) => backup.restore(name));

/* ==========================================================================
   IPC：本地文件 / 文件夹
   ========================================================================== */
registerIpc('shell:openPath', async (_e, target) => {
  if (!target) return { ok: false, error: '路径为空' };
  if (!fs.existsSync(target)) return { ok: false, error: `路径不存在：${target}` };
  const err = await shell.openPath(target);
  return err ? { ok: false, error: err } : { ok: true };
});

registerIpc('shell:showItem', async (_e, target) => {
  if (!target || !fs.existsSync(target)) return { ok: false, error: `路径不存在：${target}` };
  shell.showItemInFolder(target);
  return { ok: true };
});

registerIpc('fs:exists', async (_e, target) => {
  try { return { ok: true, exists: !!target && fs.existsSync(target) }; }
  catch (err) { return { ok: false, error: String(err.message) }; }
});

registerIpc('fs:ensureStructure', (_e, payload) => store.ensureStructure(payload));

/* 删除项目文件夹：走系统回收站，可还原；并加多重防误删护栏 */
registerIpc('fs:trashPath', async (_e, target) => {
  try {
    if (!target || typeof target !== 'string') return { ok: false, error: '未指定路径' };
    const abs = path.resolve(target);
    if (!fs.existsSync(abs)) return { ok: false, error: '路径不存在：' + abs };
    if (!fs.statSync(abs).isDirectory()) return { ok: false, error: '只允许删除文件夹' };
    if (path.dirname(abs) === abs) return { ok: false, error: '拒绝删除磁盘根目录' };
    const ud = path.resolve(app.getPath('userData'));
    if (abs === ud || abs.startsWith(ud + path.sep)) return { ok: false, error: '拒绝删除应用数据目录' };
    const root = path.resolve(ROOT);
    if (abs === root || abs.startsWith(root + path.sep)) return { ok: false, error: '拒绝删除程序目录' };
    await shell.trashItem(abs);
    return { ok: true, path: abs };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

/* 打开「全新安装预览」窗口：独立进程 + 临时 userData */
registerIpc('app:previewFresh', async () => {
  try {
    const { spawn } = require('child_process');
    const args = app.isPackaged ? ['--fresh-preview'] : [app.getAppPath(), '--fresh-preview'];
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, pid: child.pid || 0 };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

registerIpc('dialog:pickDirectory', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

/* ==========================================================================
   IPC：工程软件进程管理
   ========================================================================== */
registerIpc('app:launch', async (_e, payload = {}) => {
  const { name = '未命名', args = [] } = payload;
  const execPath = expandEnv(payload.execPath);
  const cwdRaw = expandEnv(payload.cwd);
  if (!execPath) return { ok: false, error: '未配置可执行文件路径' };
  if (!fs.existsSync(execPath)) {
    return { ok: false, error: `未找到可执行文件：${execPath}\n可在「设置 → 科研工具链」中重新指定。` };
  }
  const exist = children.get(name);
  if (exist && !exist.child.killed) {
    return { ok: false, error: `${name} 已在运行中（PID ${exist.pid}）` };
  }
  try {
    const child = spawn(execPath, args, {
      cwd: cwdRaw || path.dirname(execPath),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    children.set(name, { child, pid: child.pid, startedAt: Date.now() });
    child.on('exit', () => { const r = children.get(name); if (r && r.pid === child.pid) children.delete(name); });
    child.on('error', err => { children.delete(name); console.error(`[launch] ${name} 启动异常:`, err); });
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

registerIpc('app:stop', async (_e, name) => {
  const rec = children.get(name);
  if (!rec) return { ok: false, error: '该程序不是由工作台启动的，无法在此结束' };
  try {
    killTree(rec.pid);
    children.delete(name);
    return { ok: true, pid: rec.pid };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

registerIpc('app:list', async () =>
  Array.from(children.entries()).map(([name, r]) => ({ name, pid: r.pid, startedAt: r.startedAt })));

/* 模板导入/导出：公开 JSON 格式，便于团队共享项目模板 */
registerIpc('templates:export', async (_e, payload) => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const r = await dialog.showSaveDialog(win, {
      title: '导出项目模板',
      defaultPath: 'research-workspace-templates.json',
      filters: [{ name: '模板 JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, String((payload && payload.json) || '{}'), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

registerIpc('templates:import', async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: '导入项目模板',
      properties: ['openFile'],
      filters: [{ name: '模板 JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const text = fs.readFileSync(r.filePaths[0], 'utf8');
    return { ok: true, path: r.filePaths[0], text };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

/* 材料双视图：扫描项目目录的真实磁盘内容（只读一层子目录，避免大目录拖慢） */
registerIpc('rpm:projectRoot', (_e, id) => handleRpmQuery('root', id));
registerIpc('rpm:files', (_e, id, opts) => handleRpmQuery('files', id, opts));
registerIpc('rpm:relations', (_e, id) => handleRpmQuery('relations', id));
registerIpc('rpm:rpm-audit', (_e, id) => handleRpmQuery('rpm-audit', id));

registerIpc('rpm:knowledgeSnapshot', async (_e, opts) => {
  try {
    const rpmKnowledge = require('./rpm-knowledge');
    return await rpmKnowledge.querySnapshot(rpmContext().getConfig(), opts || {});
  } catch (err) {
    return { ok: false, schema_version: 1, code: 'read_failed', error: String((err && err.message) || err) };
  }
});
registerIpc('rpm:knowledgeResolve', async (_e, opts) => {
  try {
    const rpmKnowledge = require('./rpm-knowledge');
    const projectId = opts && opts.projectId;
    const fileId = opts && (opts.fileId || opts.sourceId);
    return await rpmKnowledge.queryResolve(rpmContext().getConfig(), projectId, fileId);
  } catch (err) {
    return { ok: false, schema_version: 1, code: 'read_failed', error: String((err && err.message) || err) };
  }
});
/* 渲染层只能传 project_id + source/file id；忽略任何绝对路径参数。 */
registerIpc('rpm:knowledgeOpenFile', async (_e, opts) => {
  try {
    const rpmKnowledge = require('./rpm-knowledge');
    const projectId = opts && opts.projectId;
    const fileId = opts && (opts.fileId || opts.sourceId);
    if (fullCandidate) return await openFullRpmFile(projectId, fileId);
    return await rpmKnowledge.openResolvedFile(rpmContext().getConfig(), projectId, fileId);
  } catch (err) {
    return { ok: false, schema_version: 1, code: 'read_failed', error: String((err && err.message) || err), opened: false };
  }
});



registerIpc('materials:scan', (_e, payload) => {
  try {
    const root = String(device.info().rootDir || '');
    if (!root) return { ok: false, error: '尚未设置工作区根目录' };
    const folder = String((payload && payload.folder) || '').trim();
    if (!folder || /[\\/]|\.\./.test(folder)) return { ok: false, error: '项目文件夹名不合法' };
    const dir = path.join(root, folder);
    if (!fs.existsSync(dir)) return { ok: false, error: '项目目录不存在：' + dir };

    let linkTarget = '';
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) linkTarget = fs.realpathSync(dir);
    } catch (_) { linkTarget = ''; }
    const scanExclude = require('../assets/js/scan-exclude');
    const settings = (() => {
      try {
        const data = parseWorkspaceData();
        return (data && data.settings) || {};
      } catch (_) { return {}; }
    })();
    const excludedName = (name) => scanExclude.isExcluded(name, settings);
    const out = [];
    const seen = new Set();
    let projectReal = dir;
    try { projectReal = fs.realpathSync(dir); } catch (_) {}
    seen.add(projectReal);
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
      if (ent.name.startsWith('.')) continue;
      const sub = path.join(dir, ent.name);
      let st;
      try { st = fs.lstatSync(sub); } catch (_) { continue; }
      let real = '';
      try { real = fs.realpathSync(sub); } catch (_) { real = ''; }
      if (!real || !fs.existsSync(real)) {
        out.push({ dir: ent.name, files: [], junction_broken: true, count: 0 });
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      if (excludedName(ent.name)) {
        out.push({ dir: ent.name, files: [], excluded: true, exists: true, count: 0 });
        continue;
      }
      const files = [];
      let listing;
      try { listing = fs.readdirSync(real, { withFileTypes: true }); }
      catch (_) {
        out.push({ dir: ent.name, files: [], junction_broken: !!st.isSymbolicLink(), count: 0 });
        continue;
      }
      for (const f of listing) {
        if (!f.isFile() || f.name.startsWith('.')) continue;
        const filePath = path.join(real, f.name);
        let size = 0;
        let mtime = '';
        try {
          const fst = fs.statSync(filePath);
          size = fst.size;
          mtime = fst.mtime ? fst.mtime.toISOString() : '';
        } catch (_) {}
        files.push({
          n: f.name,
          bytes: size,
          size: fmtSize(size),
          mtime,
          ext: path.extname(f.name).replace('.', '').toLowerCase() || 'file'
        });
      }
      out.push({ dir: ent.name, files, count: files.length, target: st.isSymbolicLink() ? real : '', excluded: false });
    }
    const count = out.reduce((n, d) => n + (d.excluded || d.junction_broken ? 0 : d.files.length), 0);
    return {
      ok: true, root: dir, dirs: out, count, link_target: linkTarget,
      note: out.length ? undefined : '项目目录下没有材料子目录。'
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

function fmtSize(b) {
  if (!b) return '0 B';
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + ' GB';
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}

/* Sprint B：解析拖入的快捷方式/程序/文件夹（禁止让用户手填路径） */
registerIpc('app:resolve-dropped', (_e, absPath) => {
  try {
    const p = String(absPath || '').trim();
    if (!p) return { ok: false, error: '没有拿到文件路径' };
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在：' + p };
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      return { ok: true, kind: 'folder', name: path.basename(p), path: p, cwd: p, args: [] };
    }
    const ext = path.extname(p).toLowerCase();
    if (ext === '.lnk') {
      let link = null;
      try { link = shell.readShortcutLink(p); } catch (err) { return { ok: false, error: '快捷方式读不了：' + (err.message || err) }; }
      const target = (link && link.target) || '';
      if (!target) return { ok: false, error: '这个快捷方式没有目标程序' };
      if (!fs.existsSync(target)) return { ok: false, error: '快捷方式指向的程序已不存在：' + target };
      const base = path.basename(target, path.extname(target));
      const argsText = String(link.args || '').trim();
      return {
        ok: true, kind: 'exe', name: base, path: target,
        cwd: link.cwd || path.dirname(target),
        args: argsText ? argsText.match(/"[^"]*"|\S+/g) || [] : [],
        icon: link.icon || ''
      };
    }
    if (['.exe', '.bat', '.cmd', '.com'].includes(ext)) {
      return { ok: true, kind: 'exe', name: path.basename(p, ext), path: p, cwd: path.dirname(p), args: [] };
    }
    return { ok: false, error: '不支持的类型 ' + (ext || '(无扩展名)') + '：只支持 .lnk 快捷方式、.exe/.bat/.cmd 程序、文件夹' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

registerIpc('dialog:pickExecutable', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: '可执行文件', extensions: ['exe', 'bat', 'cmd'] }, { name: '全部文件', extensions: ['*'] }]
      : [{ name: '全部文件', extensions: ['*'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});

/* ==========================================================================
   IPC：启动台导入（快捷方式 / 程序 / 文件夹）
   ========================================================================== */

/** 把快捷方式的参数字符串安全拆成 argv（尊重引号） */
function splitArgs(str) {
  const out = [];
  let cur = '', quote = null;
  for (const ch of String(str || '')) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** 展开 %VAR% 形式的环境变量：不少快捷方式的「起始位置」写的是未展开变量 */
function expandEnv(p) {
  const s = String(p || '');
  if (!s.includes('%')) return s;
  return s.replace(/%([^%]+)%/g, (_, k) => process.env[k] || process.env[k.toUpperCase()] || '');
}

registerIpc('launch:pick', async (_e, mode = 'any') => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const FILTERS = {
    shortcut: [{ name: '快捷方式', extensions: ['lnk'] }],
    any: process.platform === 'win32'
      ? [{ name: '快捷方式 / 程序', extensions: ['lnk', 'exe', 'bat', 'cmd'] }, { name: '全部文件', extensions: ['*'] }]
      : [{ name: '全部文件', extensions: ['*'] }]
  };
  const opts = mode === 'folder'
    ? { properties: ['openDirectory', 'createDirectory'] }
    : { properties: ['openFile'], filters: FILTERS[mode] || FILTERS.any };
  const r = await dialog.showOpenDialog(win, opts);
  return r.canceled ? null : r.filePaths[0];
});

registerIpc('launch:resolve', async (_e, target) => {
  if (!target) return { ok: false, error: '路径为空' };
  if (!fs.existsSync(target)) return { ok: false, error: `路径不存在：${target}` };

  let st;
  try { st = fs.statSync(target); }
  catch (err) { return { ok: false, error: String(err.message) }; }

  const isDir = st.isDirectory();
  const base = path.basename(target);
  const result = {
    ok: true,
    sourcePath: target,
    kind: isDir ? 'folder' : 'exe',
    name: base.replace(/\.(exe|lnk|bat|cmd)$/i, ''),
    targetPath: target,
    args: [],
    cwd: isDir ? target : path.dirname(target),
    description: '',
    targetExists: true,
    icon: null
  };

  /* .lnk：解析出真实目标、参数与工作目录 */
  if (!isDir && /\.lnk$/i.test(target)) {
    try {
      const link = shell.readShortcutLink(target);
      result.kind = 'exe';
      result.displayName = (link.description || base.replace(/\.lnk$/i, '')).trim();
      result.targetPath = expandEnv(link.target) || target;
      result.args = splitArgs(link.args);
      result.rawArgs = link.args || '';
      result.cwd = expandEnv(link.cwd) || (link.target ? path.dirname(result.targetPath) : result.cwd);
      result.targetExists = !!result.targetPath && fs.existsSync(result.targetPath);
      if (!result.targetExists) {
        result.warning = `快捷方式指向的目标已不存在：${result.targetPath || '(空)'}`;
      }
    } catch (err) {
      return { ok: false, error: '解析快捷方式失败：' + String((err && err.message) || err) };
    }
  }

  /* 提取真实图标（32px PNG dataURL），供启动台直接展示 */
  try {
    const iconSrc = result.targetExists ? result.targetPath : target;
    const img = await app.getFileIcon(iconSrc, { size: 'normal' });
    if (img && !img.isEmpty()) result.icon = img.toDataURL();
  } catch (_) { /* 取不到图标不致命，界面会退回字母色块 */ }

  return result;
});

/* ==========================================================================
   IPC：AI 接入
   ========================================================================== */
registerIpc('ai:providers', () => ai.PROVIDERS);
registerIpc('ai:keyState', () => ai.keyState());
registerIpc('ai:setKey', (_e, plain) => ai.saveKey(plain));
registerIpc('ai:chat', (_e, cfg) => ai.chat(cfg));
registerIpc('ai:test', (_e, cfg) => ai.test(cfg));

/* ==========================================================================
   IPC：外部 RAG 检索
   配置（地址 / 条数 / 开关）由渲染层随请求带上，令牌只在主进程读写，
   这样 rag.js 无需知道数据文件长什么样。
   ========================================================================== */
registerIpc('rag:state', () => rag.state());
registerIpc('rag:setToken', (_e, plain) => rag.saveToken(plain));
registerIpc('rag:health', (_e, cfg = {}) => rag.health(cfg));
/* 检索 / 问答失败且服务不在线时，按设置里的启动命令自动拉起，再重发一次（见 kb-service.js） */
kbService.setHealth(cfg => rag.health(cfg));
kbService.setNotifier(payload => {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send('kb:status', payload); } catch (_) {}
  }
});
if (!fullCandidate) kbService.startIdleTimer(60000);
registerIpc('rag:search', (_e, cfg = {}) => kbService.withService(cfg, () => rag.search(cfg)));
registerIpc('rag:ask', (_e, cfg = {}) => kbService.withService(cfg, () => rag.ask(cfg)));
registerIpc('kb:start', (_e, cfg = {}) => kbService.ensureUp(cfg, { manual: true }));
registerIpc('kb:stop', (_e, cfg = {}) => kbService.stop(cfg, { reason: 'manual' }));
registerIpc('kb:status', () => kbService.status());
registerIpc('rag:reindex', (_e, cfg = {}) => rag.reindex(cfg));

/* ==========================================================================
   IPC：外部 Agent 接入（本地 API）
   ========================================================================== */

/** 组装外部 Agent 需要的接入参数（exe 与脚本都用打包后的真实路径） */
/**
 * 解析 MCP 入口脚本的真实位置。
 * 打包后是 resources/app/desktop/mcp-server.mjs；开发期 app.getAppPath() 指向 desktop 本身，
 * 拼接会得到 desktop/desktop/... 这种不存在的路径，所以要按候选位置逐个探测。
 */
function resolveMcpScript() {
  const candidates = [
    path.join(app.getAppPath(), 'desktop', 'mcp-server.mjs'),
    path.join(__dirname, 'mcp-server.mjs'),
    path.join(ROOT, 'desktop', 'mcp-server.mjs')
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  return candidates[0];
}

function buildEntry() {
  const info = apiServer.info();
  return {
    command: process.execPath,
    args: [resolveMcpScript()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      RW_API_PORT: String(info.port || apiServer.DEFAULT_PORT),
      RW_API_TOKEN: info.token
    }
  };
}

/** 生成可直接粘贴给「任意 Agent」的接管指令（自包含，不依赖本机路径） */
function buildAgentPrompt() {
  const info = apiServer.info();
  const base = info.baseUrl || `http://127.0.0.1:${apiServer.DEFAULT_PORT}`;
  const tk = info.token;
  const link = `${base}/agent-setup?token=${encodeURIComponent(tk)}`;
  return `【接管请求】请接管我的「科研工作台」，并用它来管理我的科研项目。

这是一个运行在本机的桌面软件，向本机开放了接口。你可以任选一种方式获取完整接入信息：

▍方式一（推荐）：直接读取下面这个链接，里面是完整的接入手册
${link}

▍方式二：按下述信息直接操作
· 基地址：${base}
· 鉴权：所有请求需带请求头  Authorization: Bearer ${tk}
· 看有哪些项目：GET ${base}/api/projects
· 读某项目完整现状（任务/待办/材料目录）：GET ${base}/api/context?project=<项目ID>
· 看全部可用操作及参数定义：GET ${base}/api/tools
· 调用某个操作：POST ${base}/api/tools/<操作名>，请求体为 JSON 参数

▍请先做这三步
1. 调用 GET ${base}/api/projects 看有哪些项目
2. 调用 GET ${base}/api/context 读一次现状
3. 用一句话告诉我你看到了什么，然后等我的具体指令

▍注意
· 该接口只在本机 127.0.0.1 可用。若你运行在云端、访问不到本机地址，请直接告诉我，我改在本机执行。
· 这个令牌仅在本机有效，请不要写入任何会外传的文件或提交到代码仓库。`;
}

/** 生成 Agent 接管链接：Agent 打开即可读到完整手册 */
function buildAgentLink() {
  const info = apiServer.info();
  const base = info.baseUrl || `http://127.0.0.1:${apiServer.DEFAULT_PORT}`;
  return `${base}/agent-setup?token=${encodeURIComponent(info.token)}`;
}

/** 生成可直接粘贴进 MCP 客户端配置的片段（路径与 token 都填好） */
function buildMcpConfig() {
  const info = apiServer.info();
  const entry = buildEntry();
  return {
    ok: true,
    exe: entry.command,
    mcpScript: entry.args[0],
    mcpScriptExists: fs.existsSync(entry.args[0]),
    baseUrl: info.baseUrl,
    port: info.port,
    token: info.token,
    mcpServers: { [connectors.SERVER_KEY]: entry }
  };
}

registerIpc('api:info', () => apiServer.info());
registerIpc('api:rotate', () => { apiServer.rotateToken(); return apiServer.info(); });
registerIpc('api:mcpConfig', () => buildMcpConfig());

/* ---------- 一键连接：检测 / 写入 / 移除 MCP 客户端配置 ---------- */
registerIpc('conn:scan', () => ({ ok: true, clients: connectors.scan(), entryReady: fs.existsSync(buildEntry().args[0]) }));
registerIpc('conn:apply', (_e, id) => connectors.applyTo(id, buildEntry()));
registerIpc('conn:remove', (_e, id) => connectors.removeFrom(id));
registerIpc('conn:prompt', () => {
  const info = apiServer.info();
  return {
    ok: true,
    prompt: buildAgentPrompt(),
    link: buildAgentLink(),
    baseUrl: info.baseUrl,
    port: info.port,
    running: info.running
  };
});

/* 导出接入手册为文件：内容直接取自 /agent-setup，保证与链接所见完全一致 */
registerIpc('conn:export', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false, error: '没有可用窗口' };
  const info = apiServer.info();
  if (!info.running) return { ok: false, error: '本地服务未启动' };

  const r = await dialog.showSaveDialog(win, {
    title: '导出 Agent 接入手册',
    defaultPath: '科研工作台-Agent接入手册.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '纯文本', extensions: ['txt'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };

  try {
    const res = await fetch(`${info.baseUrl}/agent-setup?token=${encodeURIComponent(info.token)}`);
    const body = await res.text();
    fs.writeFileSync(r.filePath, body, 'utf8');
    return { ok: true, path: r.filePath, bytes: Buffer.byteLength(body) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
registerIpc('conn:reveal', async (_e, id) => {
  const t = connectors.TARGETS.find(x => x.id === id);
  if (!t) return { ok: false, error: '未知客户端' };
  const cfg = connectors.expand(t.files[0]);
  const dir = fs.existsSync(cfg) ? path.dirname(cfg) : (fs.existsSync(path.dirname(cfg)) ? path.dirname(cfg) : '');
  if (!dir) return { ok: false, error: '配置目录不存在' };
  const err = await shell.openPath(dir);
  return err ? { ok: false, error: err } : { ok: true, path: dir };
});

/* ==========================================================================
   无头自检：验证真实 Electron 环境能加载渲染层
   ========================================================================== */
async function runSmoke() {
  const out = { ok: false, stage: 'init', errors: [], warnings: [], checks: {} };
  let win;
  let resultPath = null;
  try {
    win = new BrowserWindow({
      show: false, width: 1520, height: 940,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false,
        webviewTag: true                    /* 与正式窗口一致，才能验证内置浏览器 */
      }
    });
    /* 只把真实错误计入；过滤 Electron 开发期安全提示 */
    const NOISE = /Content-Security-Policy|Electron Security Warning|DevTools|Autofill|GPU stall|Request Autofill/;
    win.webContents.on('console-message', (_e, level, message) => {
      if (level < 2) return;
      if (NOISE.test(message)) { out.warnings.push(message.split('\n')[0].slice(0, 120)); return; }
      out.errors.push('console: ' + message);
    });
    win.webContents.on('render-process-gone', (_e, d) => out.errors.push('render-gone: ' + JSON.stringify(d)));

    out.stage = 'load';
    logBoot('smoke: 创建窗口');
    await win.loadFile(path.join(ROOT, 'index.html'));
    apiServer.setWindow(win);          /* 让 HTTP 通道指向这个自检窗口 */
    logBoot('smoke: 页面已加载');
    await new Promise(r => setTimeout(r, 1600));

    out.stage = 'probe';
    logBoot('smoke: 开始渲染层探针');
    out.checks = await win.webContents.executeJavaScript(`(() => {
      const routes = ['home','projects','tasks','timeline','knowledge','ai','agents','automation','dock','browser','settings'];
      const sizes = {}; const fails = [];
      routes.forEach(r => {
        try {
          go(r);
          /* 内置浏览器渲染在常驻面板里（webview 不能随重绘销毁），#view 此时为空 */
          const el = r === 'browser' ? document.getElementById('browser-pane') : document.getElementById('view');
          const len = el ? el.innerHTML.length : 0;
          sizes[r] = len;
          if (len < 400) fails.push(r);
        } catch (e) { fails.push(r + ':' + e.message); }
      });
      go('home');
      return {
        desktop: !!(window.workspace && window.workspace.isDesktop),
        bridgeReady: !!(window.workspace && typeof window.workspace.loadData === 'function'),
        aiBridgeReady: !!(window.workspace && typeof window.workspace.aiChat === 'function'),
        launchBridgeReady: !!(window.workspace && typeof window.workspace.resolveLaunchTarget === 'function'),
        ragBridgeReady: !!(window.workspace && typeof window.workspace.ragSearch === 'function'
          && typeof window.workspace.ragHealth === 'function' && typeof window.workspace.ragAsk === 'function'
          && typeof window.workspace.ragReindex === 'function'),
        writingBridgeReady: typeof Bridge !== 'undefined' && typeof Bridge.saveWritingDoc === 'function',
        webviewReady: !!(window.workspace && window.workspace.webview === true
          && document.createElement('webview') && 'getWebContentsId' in document.createElement('webview')),
        undoReady: (typeof undoLast === 'function') && (typeof undoStack !== 'undefined'),
        auditReady: (typeof executeTool === 'function') && (typeof recordAudit === 'function'),
        routes: sizes, routeFails: fails,
        navItems: document.querySelectorAll('.nav-item').length,
        projCards: document.querySelectorAll('.proj-card').length,
        svgThumbs: document.querySelectorAll('.proj-card .thumb svg').length,
        icons: document.querySelectorAll('.icon svg').length,
        aiTools: (typeof AI_TOOLS !== 'undefined') ? AI_TOOLS.length : -1,
        aiToolImpls: (typeof AI_TOOL_IMPL !== 'undefined') ? Object.keys(AI_TOOL_IMPL).length : -1,
        projects: (typeof DB !== 'undefined') ? DB.projects.length : -1,
        tasks: (typeof DB !== 'undefined') ? DB.tasks.length : -1,
        onboarded: (typeof DB !== 'undefined' && DB.settings) ? !!DB.settings.onboarded : null,
        taskSample: (typeof DB !== 'undefined' && DB.tasks[0]) ? DB.tasks[0].t : null,
        todoCount: (typeof DB !== 'undefined') ? DB.todos.length : -1,
        appsCount: (typeof DB !== 'undefined') ? DB.apps.length : -1
      };
    })()`);

    const c = out.checks;
    out.ok = out.errors.length === 0 && c.routeFails.length === 0 &&
             c.navItems === 11 && c.projCards === c.projects && c.svgThumbs === c.projCards &&
             c.desktop && c.bridgeReady && c.aiBridgeReady && c.launchBridgeReady &&
             c.ragBridgeReady && c.writingBridgeReady && c.webviewReady && c.undoReady && c.auditReady &&
             c.aiTools >= 17 && c.aiToolImpls >= 17;

    /* ---------- 能力自检：逐个真实调用 IPC 与本地 API，确认「功能真能用」 ---------- */
    out.stage = 'capabilities';
    logBoot('smoke: 开始能力自检');
    const caps = await win.webContents.executeJavaScript(`(async () => {
      const rows = [];
      const rec = (name, pass, detail) => rows.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) });
      const W = window.workspace || {};
      const S = async (fn, ...a) => { try { return await fn(...a); } catch (e) { return { __err: String(e && e.message || e) }; } };

      /* 数据持久化 */
      const p = await S(W.dataFilePath);
      rec('数据文件路径可获取', p && !p.__err, p && p.__err || p);
      const raw = await S(W.loadData);
      const empty = !raw || !String(raw).trim();
      let parsed = null; try { parsed = JSON.parse(raw); } catch (_) {}
      rec('本地数据可读且 JSON 合法',
        empty ? true : (!!parsed && Array.isArray(parsed.projects) && Array.isArray(parsed.tasks)),
        empty ? '全新安装：尚无数据文件（预期）'
          : (parsed ? (parsed.projects || []).length + ' 个项目 / ' + (parsed.tasks || []).length + ' 条任务' : '解析失败'));
      if (empty) {
        rec('数据可写盘（原样回写）', true, '全新安装：无文件可回写，首次写入由创建项目触发');
      } else {
        const rt = await S(W.saveData, raw);
        rec('数据可写盘（原样回写）', rt && rt.ok !== false && !rt.__err, JSON.stringify(rt).slice(0, 120));
      }

      /* 文件系统 */
      const ex = await S(W.exists, ${JSON.stringify(process.execPath)});
      rec('fs:exists 识别真实文件', ex && ex.exists === true, JSON.stringify(ex));
      const no = await S(W.exists, 'Z:\\\\__rw_不存在__\\\\x.exe');
      rec('fs:exists 拒绝不存在路径', no && no.exists === false, JSON.stringify(no));
      const ob = await S(W.openPath, 'Z:\\\\__rw_不存在__\\\\x.exe');
      rec('打开无效路径返回明确错误', ob && ob.ok === false, JSON.stringify(ob).slice(0, 120));
      const lr = await S(W.resolveLaunchTarget, ${JSON.stringify(process.execPath)});
      rec('软件启动目标解析可用', lr && lr.ok !== false && !lr.__err, JSON.stringify(lr).slice(0, 140));
      const lrun = await S(W.listRunning);
      rec('进程列表可读取', Array.isArray(lrun) || (lrun && !lrun.__err), JSON.stringify(lrun).slice(0, 120));

      /* 外部 Agent 接入 */
      const info = await S(W.apiInfo);
      rec('本地 API 服务运行中', info && info.running === true, info ? '端口 ' + info.port : '无返回');
      const mcp = await S(W.apiMcpConfig);
      rec('MCP 配置生成（脚本就位）', mcp && mcp.ok && mcp.mcpScriptExists, mcp ? 'mcp-server.mjs 存在=' + mcp.mcpScriptExists : '无返回');
      const pr = await S(W.connPrompt);
      rec('接管凭证可生成', pr && pr.ok && (pr.prompt || '').length > 200, pr ? (pr.prompt || '').length + ' 字符' : '无返回');
      const sc = await S(W.connScan);
      rec('Agent 客户端探测可用', sc && sc.ok && Array.isArray(sc.clients), sc ? '检测到 ' + sc.clients.length + ' 个客户端 · 入口就绪=' + sc.entryReady : '无返回');

      /* AI 接入（不写密钥） */
      const pv = await S(W.aiProviders);
      rec('AI 服务商预设可用', Array.isArray(pv) && pv.length >= 5, Array.isArray(pv) ? pv.length + ' 个预设' : '无返回');
      const ks = await S(W.aiKeyState);
      rec('密钥状态可查询', ks && typeof ks.stored === 'boolean', JSON.stringify(ks));

      /* 项目管理工具：Agent 接管的前提 */
      const hasCreate = typeof AI_TOOL_IMPL.create_project === 'function';
      const hasDelete = typeof AI_TOOL_IMPL.delete_project === 'function';
      const writable = !READ_ONLY_TOOLS.has('create_project') && !READ_ONLY_TOOLS.has('delete_project');
      rec('Agent 可管理项目（增 / 删 / 改）',
        hasCreate && hasDelete && writable && typeof AI_TOOL_IMPL.update_project === 'function',
        'create/delete/update 均已实现且计入审计');

      /* 同步合并通道 */
      const sm = await S(W.syncMerge, {
        local: { tasks: [{ id: 'a', t: 'A', st: 'todo' }, { id: 'b', t: 'B', st: 'todo' }] },
        remote: { tasks: [{ id: 'a', t: 'A', st: 'done' }, { id: 'b', t: 'B', st: 'todo' }] },
        base: { tasks: [{ id: 'a', t: 'A', st: 'todo' }, { id: 'b', t: 'B', st: 'todo' }] }
      });
      rec('同步合并通道可用',
        sm && sm.ok && (sm.data.tasks || []).length === 2 && (sm.data.tasks || []).some(x => x.id === 'a' && x.st === 'done'),
        sm && sm.ok ? ('冲突 ' + (sm.conflicts || []).length + ' 个 · 结果 ' + sm.data.tasks.length + ' 条') : String(sm && sm.error));

      /* 同步载体通道（只读检查，不改用户配置） */
      const si = await S(W.syncInfo);
      rec('同步载体通道可用', si && si.ok === true && typeof si.dir === 'string',
        si ? (si.dir ? '已配置：' + si.dir : '未配置同步目录') : '无返回');
      const sbad = await S(W.syncSetDir, ${JSON.stringify(app.getPath('userData'))});
      rec('同步目录拒绝应用数据目录', sbad && sbad.ok === false, String(sbad && sbad.error));

      /* 数据备份通道 */
      const binfo = await S(W.backupInfo);
      rec('备份通道就绪（真实文件列表）',
        binfo && typeof binfo.count === 'number' && typeof binfo.dir === 'string',
        binfo ? ('已有 ' + binfo.count + ' 份 · ' + binfo.dir) : '无返回');

      /* 外部 RAG 检索通道 */
      const rgs = await S(W.ragState);
      rec('RAG 通道桥接就绪', rgs && typeof rgs.stored === 'boolean', JSON.stringify(rgs));
      const rgb = await S(W.ragHealth, { endpoint: 'http://127.0.0.1:59997' });
      rec('RAG 不可达时给出可读错误而非崩溃',
        rgb && rgb.ok === false && typeof rgb.error === 'string' && rgb.error.length > 8,
        String((rgb && rgb.error) || '无返回').slice(0, 110));
      rec('写作保存桥接就绪', typeof Bridge !== 'undefined' && typeof Bridge.saveWritingDoc === 'function',
        typeof Bridge !== 'undefined' && typeof Bridge.saveWritingDoc);

      /* HTTP 通道真请求 */
      if (info && info.running) {
        const j = async (url, opt) => { try { const r = await fetch(url, opt); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: String(e) }; } };
        const auth = { headers: { Authorization: 'Bearer ' + info.token } };
        const h = await j(info.baseUrl + '/api/health');
        rec('健康检查免鉴权', h.status === 200, 'HTTP ' + h.status);
        const bad = await j(info.baseUrl + '/api/projects');
        rec('无令牌请求被拒', bad.status === 401, 'HTTP ' + bad.status);
        const good = await j(info.baseUrl + '/api/projects', auth);
        let n = 0; try { n = (JSON.parse(good.body).projects || []).length; } catch (_) {}
        let hadArr = false; try { hadArr = Array.isArray(JSON.parse(good.body).projects); } catch (_) {}
        rec('带令牌可读项目', good.status === 200 && hadArr, 'HTTP ' + good.status + ' · ' + n + ' 个项目');
        const tl = await j(info.baseUrl + '/api/tools', auth);
        let tc = 0; try { tc = (JSON.parse(tl.body).tools || []).length; } catch (_) {}
        rec('工具清单可达', tl.status === 200 && tc > 0, tc + ' 个工具');
        const su = await j(info.baseUrl + '/agent-setup?token=' + encodeURIComponent(info.token));
        rec('接管凭证端点可用', su.status === 200 && su.body.length > 500, 'HTTP ' + su.status + ' · ' + su.body.length + ' 字符');
        const er = await j(info.baseUrl + '/api/tools/__not_a_tool__', { method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json' }, body: '{}' });
        rec('未知工具被拒绝', er.status === 400 || er.status === 404, 'HTTP ' + er.status);
      } else {
        rec('HTTP 通道未验证', false, '本地 API 未运行');
      }

      /* 账户与云端绑定通道（桥接完整性，只读） */
      const aKeys = ['accountStatus','accountRegister','accountUnlock','accountBind','accountUnbind','accountTestCloud','cloudProbe'];
      const aMissing = aKeys.filter(k => typeof W[k] !== 'function');
      rec('账户通道就绪', aMissing.length === 0,
        aMissing.length ? '缺少 ' + aMissing.join(', ') : aKeys.length + ' 个接口齐全');
      const ast = await S(W.accountStatus);
      rec('账户状态可查询', ast && ast.ok === true && typeof ast.hasAccount === 'boolean',
        ast ? ('hasAccount=' + ast.hasAccount + ' · 绑定=' + (ast.binding || false) + ' · 锁定=' + (ast.locked || false)) : '无返回');
      rec('载体清单可用（坚果云就绪 / OAuth 类标未接入）',
        ast && Array.isArray(ast.providers) && ast.providers.some(p => p.id === 'webdav' && p.status === 'ready')
          && ast.providers.some(p => p.id === 'onedrive' && p.status === 'planned'),
        (ast.providers || []).map(p => p.id + ':' + p.status).join(' · '));
      /* cloudProbe 会真的去连云端，留探针（--account-probe）验证，自检不碰网络 */

      /* 交接文件通道（桥接完整性，只读） */
      const hKeys = ['handoffInfo', 'handoffExport', 'handoffImport', 'handoffApply', 'handoffDoc'];
      const hMissing = hKeys.filter(k => typeof W[k] !== 'function');
      rec('交接文件通道就绪', hMissing.length === 0,
        hMissing.length ? '缺少 ' + hMissing.join(', ') : hKeys.length + ' 个接口齐全');
      const hi = await S(W.handoffInfo);
      rec('交接状态可查询', hi && hi.ok === true, JSON.stringify(hi).slice(0, 120));

      /* AI 连通性属于外部网络调用，默认不跑（自检必须离线可复现）；
         带 --with-ai 时才真实请求一次，用来确认当前密钥与模型配置可用 */
      return { rows, pass: rows.filter(r => r.pass).length, total: rows.length };
    })()`);

    /* 交接文件：主进程内真跑一次导出，验证生成的文件格式可回读（临时文件，用完即删）
       noBase 保证不动用户已有的同步基准 */
    out.stage = 'handoff';
    try {
      const tmp = path.join(app.getPath('temp'), 'rw-handoff-smoke-' + Date.now() + '.json');
      const hr = handoff.exportPack(tmp, { noBase: true });
      let valid = false; let detail = '';
      if (hr.ok) {
        try {
          const obj = JSON.parse(fs.readFileSync(tmp, 'utf8'));
          valid = !!obj.__device && !!obj.__handoff && Array.isArray(obj.projects);
          detail = (obj.projects || []).length + ' 个项目 / ' + (obj.tasks || []).length + ' 条任务 / ' + hr.bytes + ' 字节';
        } catch (e) { detail = '回读失败：' + String((e && e.message) || e); }
        try { fs.unlinkSync(tmp); } catch (_) {}
        caps.rows.push({ name: '交接数据包可导出（格式可回读）', pass: valid, detail });
      } else if (/还没有数据/.test(String(hr.error || ''))) {
        caps.rows.push({ name: '交接数据包可导出（格式可回读）', pass: true, detail: '全新安装：暂无数据可导出（预期）' });
      } else {
        caps.rows.push({ name: '交接数据包可导出（格式可回读）', pass: false, detail: String(hr.error) });
      }
      const docText = handoff.buildDoc();
      caps.rows.push({
        name: '交接单可生成',
        pass: !!(docText && docText.length > 120 && docText.indexOf('# 科研工作台') === 0),
        detail: (docText || '').length + ' 字符'
      });
    } catch (e) {
      caps.rows.push({ name: '交接数据包可导出（格式可回读）', pass: false, detail: String((e && e.message) || e) });
    }
    caps.total = caps.rows.length;
    caps.pass = caps.rows.filter(r => r.pass).length;

    if (process.argv.includes('--with-ai')) {
      out.stage = 'ai';
      const aiCfg = await win.webContents.executeJavaScript(`(typeof DB !== 'undefined' && DB.ai) ? JSON.parse(JSON.stringify(DB.ai)) : null`);
      let aiRes;
      try {
        aiRes = await ai.test(aiCfg || {});
      } catch (e) {
        aiRes = { ok: false, error: String((e && e.message) || e) };
      }
      caps.rows.push({
        name: 'AI 真实连通性（--with-ai）',
        pass: !!(aiRes && aiRes.ok),
        detail: aiRes && aiRes.ok
          ? `模型 ${aiRes.model || (aiCfg && aiCfg.model)} · 回复「${aiRes.reply}」`
          : String((aiRes && (aiRes.error || aiRes.message)) || '无返回')
      });
      caps.total = caps.rows.length;
      caps.pass = caps.rows.filter(r => r.pass).length;
    }

    out.capabilities = caps;
    out.ok = out.ok && caps.pass === caps.total;
    out.stage = 'done';
  } catch (err) {
    out.errors.push('fatal: ' + String((err && err.stack) || err));
  } finally {
    /* 收尾必须绝对稳：任何一步失败都要留下可读的结果，否则无控制台的桌面环境里
       只能看到进程退出码，无法定位 */
    let payload;
    try {
      payload = JSON.stringify(out, null, 2);
    } catch (serErr) {
      out.ok = false;
      out.errors.push('serialize: ' + String((serErr && serErr.message) || serErr));
      try {
        payload = JSON.stringify({ ok: false, stage: out.stage, errors: out.errors, checks: out.checks, capabilities: out.capabilities }, null, 2);
      } catch (_) {
        payload = JSON.stringify({ ok: false, stage: out.stage, errors: out.errors }, null, 2);
      }
    }
    logBoot('smoke 结束 ok=' + out.ok + ' stage=' + out.stage + ' errors=' + out.errors.length);
    console.log('SMOKE_RESULT ' + payload);
    /* 自检结果优先写入用户数据目录：安装目录在打包后可能不可写，
       用户数据目录始终可写，且是排查问题时最该看的地方 */
    const targets = [];
    try { targets.push(path.join(app.getPath('userData'), 'smoke-result.json')); } catch (_) {}
    targets.push(path.join(__dirname, 'smoke-result.json'));
    resultPath = null;
    for (const t of targets) {
      try { fs.writeFileSync(t, payload, 'utf8'); resultPath = t; break; }
      catch (wErr) { logBoot('结果写盘失败 ' + t + ': ' + String((wErr && wErr.message) || wErr)); }
    }
    if (resultPath) logBoot('自检结果已写入 ' + resultPath);
    try { win && win.destroy(); } catch (_) {}
    app.exit(out.ok ? 0 : 1);
  }
}
