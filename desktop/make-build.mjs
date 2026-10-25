/* 一次性组装：直接把 Electron 运行时 + app 拼到目标目录（不依赖清理逻辑）
   用法：node make-build.mjs <输出目录> */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, 'release', 'build-221'));
const dist = path.join(here, 'node_modules', 'electron', 'dist');
const appDir = path.join(here, 'app');
const EXE = 'ResearchWorkspace.exe';

console.log('[build] out =', out);
if (fs.existsSync(out)) {
  console.error('[build] 目标目录已存在，请换一个空目录名（避免触发删除逻辑）');
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
fs.cpSync(dist, out, { recursive: true });
console.log('[build] 运行时已复制，文件数:', fs.readdirSync(out).length);

const appTarget = path.join(out, 'resources', 'app');
fs.mkdirSync(appTarget, { recursive: true });
fs.cpSync(appDir, appTarget, { recursive: true });
for (const junk of ['resources/default_app.asar', 'resources/app/desktop/smoke-result.json', 'resources/app/desktop/crash.log']) {
  try { fs.rmSync(path.join(out, junk), { force: true }); } catch (_) {}
}
console.log('[build] app 已放入，version =', JSON.parse(fs.readFileSync(path.join(appTarget, 'package.json'), 'utf8')).version);

fs.renameSync(path.join(out, 'electron.exe'), path.join(out, EXE));
console.log('[build] 已重命名为', EXE);

/* 图标与版本信息 */
function findRcedit() {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cache)) return null;
  for (const d of fs.readdirSync(cache)) {
    const p = path.join(cache, d, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const ico = path.join(here, 'build', 'icon.ico');
const rcedit = findRcedit();
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const exePath = path.join(out, EXE);
if (rcedit && fs.existsSync(ico)) {
  try {
    execFileSync(rcedit, [exePath,
      '--set-icon', ico,
      '--set-file-version', pkg.version,
      '--set-product-version', pkg.version,
      '--set-version-string', 'CompanyName', 'Research Workspace',
      '--set-version-string', 'FileDescription', 'Personal AI Research & Engineering Workspace',
      '--set-version-string', 'LegalCopyright', 'MIT License'
    ], { stdio: 'ignore', timeout: 60000 });
    console.log('[build] 图标与版本信息已写入');
  } catch (e) { console.warn('[build] 写图标失败（不影响运行）:', e.message); }
}

const size = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`[build] 完成：${exePath}`);
console.log(`[build] 体积 ${(size(out) / 1024 / 1024).toFixed(1)} MB`);
