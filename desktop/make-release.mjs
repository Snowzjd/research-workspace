/* ==========================================================================
   发布产物打包
   产出三件套到 desktop/release/dist/：
     1. app-update-<版本>.zip     轻量更新包（仅 app 资源，约 1MB）
     2. latest.json               版本清单（检查更新用）
     3. 发布说明.txt              上传指引
   完整 exe 不复制（体积大），沿用 release/portable/ResearchWorkspace.exe，
   上传时把这三样 + exe 放同一目录即可。
   ========================================================================== */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const appDir = path.join(here, 'app');
const distDir = path.join(here, 'release', 'dist');

if (!fs.existsSync(path.join(appDir, 'package.json'))) {
  console.error('[release] 未找到 desktop/app，请先执行 npm run pack:app && npm run portable');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const v = pkg.version;
const updateName = `app-update-${v}.zip`;
/* 完整包用固定文件名：latest/download/<固定名> 永远指向最新版，安装脚本不用改 */
const fullZipName = 'ResearchWorkspace-win64.zip';

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

/* 完整包 = 整个 portable 目录（exe 必须与运行时文件同目录，裸 exe 跑不起来）。
   打包前清掉目录里的运行残留，避免垃圾进分发包 */
const portableDir = process.env.PORTABLE_OUT ? path.resolve(process.env.PORTABLE_OUT) : path.join(here, 'release', 'portable');
if (!fs.existsSync(path.join(portableDir, 'ResearchWorkspace.exe'))) {
  console.error('[release] 未找到 release/portable/ResearchWorkspace.exe，请先 npm run portable');
  process.exit(1);
}
for (const junk of ['debug.log', 'crash.log']) {
  try { fs.rmSync(path.join(portableDir, junk), { force: true }); } catch (_) {}
}
try {
  for (const f of fs.readdirSync(portableDir)) {
    if (f.startsWith('ResearchWorkspace.exe.old-')) fs.rmSync(path.join(portableDir, f), { force: true, recursive: true });
  }
} catch (_) {}

/* 1. 轻量更新包：只含 app 资源（运行时 250MB 不变，不用重复下载）
      Windows 10+ 自带 bsdtar，按扩展名自动产出 zip */
const zipPath = path.join(distDir, updateName);
fs.rmSync(zipPath, { force: true });
/* Windows 内置 bsdtar 会把 "F://xxx" 里的盘符冒号当成远程主机，必须用相对文件名 + cwd 规避 */
execFileSync('tar', ['-a', '-c', '-f', updateName, '-C', appDir, '.'], { cwd: distDir, stdio: 'inherit' });

/* 2b. 完整包 zip（解压即用；Electron 文件已压缩，zip 不会再小多少） */
const fullZipPath = path.join(distDir, fullZipName);
fs.rmSync(fullZipPath, { force: true });
execFileSync('tar', ['-a', '-c', '-f', fullZipName, '-C', portableDir, '.'], { cwd: distDir, stdio: 'inherit' });

/* 2. 版本清单 */
const manifest = {
  version: v,
  notes: '',
  publishedAt: new Date().toISOString(),
  update: updateName,
  full: fullZipName
};
fs.writeFileSync(path.join(distDir, 'latest.json'), JSON.stringify(manifest, null, 2), 'utf8');

/* 3. 上传指引 */
const fullMb = (fs.statSync(fullZipPath).size / 1024 / 1024).toFixed(1);
const guide = `发布步骤（二选一，或都做）
======================================================

【方式 A：GitHub Releases（推荐，免费、直链稳定）】
1. 在 GitHub 建一个仓库（可以 private，但 private 的 Release 下载需要登录；
   要让另一台设备直接下载，用 public 仓库）
2. 到 Releases → Draft a new release → 新建 tag：v${v}
3. 上传 3 个文件：
   - ${fullZipName}          （完整安装包，解压即用；约 ${fullMb} MB）
   - ${updateName}
   - latest.json
4. Publish release。应用内更新源填：github:<你的用户名>/<仓库名>
   检查更新会自动请求：
   https://github.com/<用户名>/<仓库>/releases/latest/download/latest.json

【方式 B：坚果云（国内快，无需 GitHub）】
1. 坚果云里建一个目录，如 /ResearchWorkspace/releases/
2. 把上面 3 个文件传进去
3. 软件里更新源选「跟随云端绑定」（用已绑定的坚果云账号），
   并把云端目录改为 /ResearchWorkspace/releases
   —— 注意：免费版有每月流量限制，exe 完整包 250MB 级，完整安装建议
      用官网/网盘分享手动下载，应用内更新只走几 MB 的轻量更新包。

【装到新设备】
下载 ${fullZipName}，解压到任意位置（如 %LOCALAPPDATA%\\ResearchWorkspace），
双击里面的 ResearchWorkspace.exe。⚠️ exe 必须和同目录的运行时文件在一起，
单独拷 exe 出去跑不起来。数据存在 %APPDATA%\\个人科研工作台\\，
exe 里不含任何项目数据——新设备打开就是空的，只有标准模板。

【应用内更新流程（已内置）】
检查更新 → 下载 ${updateName}（约 1MB）→ 校验 → 关闭软件后自动替换
resources\\app 并重启。Electron 运行时不重复下载。
`;
fs.writeFileSync(path.join(distDir, '发布说明.txt'), guide, 'utf8');

const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log(`[release] 已生成 release/dist/`);
console.log(`  - ${updateName}  (${mb} MB)`);
console.log(`  - ${fullZipName}  (${fullMb} MB)  <- 完整安装包`);
console.log(`  - latest.json  (version ${v})`);
console.log(`  - 发布说明.txt`);
