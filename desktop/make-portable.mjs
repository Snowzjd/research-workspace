/* ==========================================================================
   组装绿色便携版（免安装独立软件）
   用途：`electron-builder` 在无「创建符号链接」特权的 Windows 账户下无法解包
        winCodeSign / Electron，此脚本直接组合 Electron 运行时与已组装的 app，
        产出一个可双击运行、可整体拷贝到其他机器的独立程序。

   产出：desktop/release/portable/ResearchWorkspace.exe
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, 'app');
const distDir = path.join(here, 'node_modules', 'electron', 'dist');
/* 支持 PORTABLE_OUT：本机正开着便携版时，release/portable 会被锁住，
   打到独立目录就能继续出包，不必打断正在用软件的人 */
const outDir = process.env.PORTABLE_OUT ? path.resolve(process.env.PORTABLE_OUT) : path.join(here, 'release', 'portable');
const EXE_NAME = 'ResearchWorkspace.exe';

/* 删除单个文件：失败不算错（可能被系统索引/杀毒短暂占用） */
function dropFile(p, why) {
  try { fs.rmSync(p, { force: true }); return true; }
  catch (e) {
    console.warn(`[portable] 跳过删除 ${path.basename(p)}（${why || '被占用'}），不影响运行`);
    return false;
  }
}

/* 清空输出目录：失败时继续覆盖写入，避免因一个被占用的文件卡死整个构建 */
function cleanOut(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  catch (e) {
    console.warn('[portable] 旧产物未能完全清理（' + (e && e.message) + '），将继续覆盖写入');
    return false;
  }
}

if (!fs.existsSync(appDir)) {
  console.error('[portable] 未找到 desktop/app，请先执行 npm run pack:app');
  process.exit(1);
}
if (!fs.existsSync(path.join(distDir, 'electron.exe'))) {
  console.error('[portable] 未找到 Electron 运行时，请先执行 npm install');
  process.exit(1);
}

/* 旧产物目录可能正被运行中的软件占用：运行中的 exe/DLL 都删不掉，但整个目录可以改名
   （句柄跟着目录走，进程不受影响）。改名腾位后装新的，旧目录等下次打包时清理。
   注意：这会让桌面快捷方式暂时失效，打包完要重建快捷方式。 */
function parkLockedExe() {
  if (!fs.existsSync(outDir)) return;
  try { fs.rmSync(outDir, { recursive: true, force: true }); return; } catch (_) {}
  const parent = path.dirname(outDir);
  const base = path.basename(outDir);
  const parked = path.join(parent, base + '.old-' + Date.now());
  try {
    fs.renameSync(outDir, parked);
    console.log('[portable] 便携版正在运行，旧目录已改名腾位（下次打包时自动清理）');
    console.log('[portable] 打包完成后请刷新桌面快捷方式');
  } catch (e) {
    /* 改不了名就硬着头皮覆盖写入：只要没有进程锁着文件，覆盖本身能成功
       （safe-delete 钩子半途而废留下的目录就属于这种） */
    console.warn('[portable] 旧产物目录无法改名（' + (e && e.message) + '），尝试覆盖写入');
  }
  /* 清理历史遗留的 .old 目录（软件不在运行时就能删掉了） */
  try {
    for (const d of fs.readdirSync(parent)) {
      if (d.startsWith(base + '.old-') && d !== path.basename(parked)) {
        try { fs.rmSync(path.join(parent, d), { recursive: true, force: true }); } catch (_) {}
      }
    }
  } catch (_) {}
}





/* 1. 复制 Electron 运行时
   注意：目录不存在时不要调 rmSync——部分环境把删除劫持成"延迟回收站"，
   会在 cpSync 之后才真正删，把刚复制出来的文件全清掉（表现为空目录 + rename ENOENT） */
if (fs.existsSync(outDir)) cleanOut(outDir);
fs.mkdirSync(outDir, { recursive: true });
parkLockedExe();
fs.cpSync(distDir, outDir, { recursive: true });

/* 2. 放入应用本体 */
const appTarget = path.join(outDir, 'resources', 'app');
fs.mkdirSync(appTarget, { recursive: true });
fs.cpSync(appDir, appTarget, { recursive: true });
dropFile(path.join(outDir, 'resources', 'default_app.asar'), 'Electron 默认应用占位');
/* 自检产物不应进入分发包 */
dropFile(path.join(appTarget, 'desktop', 'smoke-result.json'));
dropFile(path.join(appTarget, 'desktop', 'crash.log'));

/* 3. 重命名可执行文件（Windows 下重命名比复制快得多）
   注意：这里不能再调 parkLockedExe()——它会把刚复制好的整个 outDir 删掉，
   导致随后 rename electron.exe 报 ENOENT。只处理目标 exe 占用即可。 */
const from = path.join(outDir, 'electron.exe');
const to = path.join(outDir, EXE_NAME);
if (fs.existsSync(to)) {
  try { fs.rmSync(to, { force: true }); }
  catch (_) {
    try { fs.renameSync(to, to + '.old-' + Date.now()); }
    catch (e) { console.warn('[portable] 旧 ' + EXE_NAME + ' 无法腾位: ' + ((e && e.message) || e)); }
  }
}
if (!fs.existsSync(from)) {
  console.error('[portable] 复制后未找到 electron.exe，中止');
  process.exit(1);
}
fs.renameSync(from, to);

/* 4. 写入 exe 图标与版本信息（rcedit 随 electron-builder 缓存分发） */
function findRcedit() {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cache)) return null;
  for (const d of fs.readdirSync(cache)) {
    const p = path.join(cache, d, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const icoPath = path.join(here, 'build', 'icon.ico');
const rcedit = findRcedit();
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
if (rcedit && fs.existsSync(icoPath)) {
  try {
    execFileSync(rcedit, [
      to,
      '--set-icon', icoPath,
      '--set-file-version', pkg.version,
      '--set-product-version', pkg.version,
      '--set-version-string', 'CompanyName', 'Research Workspace',
      '--set-version-string', 'FileDescription', 'Personal AI Research & Engineering Workspace',
      '--set-version-string', 'LegalCopyright', 'MIT License'
    ], { stdio: 'ignore', timeout: 60000 });
    console.log('[portable] 已写入 exe 图标与版本信息');
  } catch (err) {
    console.warn('[portable] 写入 exe 图标失败（不影响运行）: ' + ((err && err.message) || err));
  }
} else {
  console.warn('[portable] 未找到 rcedit 或 icon.ico，跳过 exe 图标写入（桌面快捷方式图标不受影响）');
}

const total = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? total(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);

console.log(`[portable] 已生成 ${path.relative(here, to)}`);
console.log(`[portable] 体积 ${(total(outDir) / 1024 / 1024).toFixed(1)} MB · 可直接双击运行或整体拷贝分发`);
console.log(`[portable] 自检：release\\portable\\${EXE_NAME} --smoke`);
