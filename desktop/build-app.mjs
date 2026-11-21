/* ==========================================================================
   构建打包目录：把渲染层与主进程组装成自包含的 desktop/app
   目的：electron-builder 不允许 files 逃出项目目录，所以先做一次组装。
   组装后的结构与开发时一致（main.js 通过 __dirname/.. 定位 index.html）。
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, 'app');
const buildDir = path.join(here, 'build');

const REQUIRED = ['index.html', 'assets'];

/* 主进程模块：自动收集 desktop 下所有 .js/.mjs，排除构建与调试脚本。
   这样以后新增模块（如 ai.js、api-server.js、mcp-server.mjs）不会因为忘记登记而漏打包。 */
const EXCLUDE = ['build-app.mjs', 'make-portable.mjs', 'make-icon.mjs'];
const MAIN_FILES = fs.readdirSync(here)
  .filter(f => (f.endsWith('.js') || f.endsWith('.mjs'))
    && !EXCLUDE.includes(f)
    && !f.startsWith('probe-'))        // 调试脚本不入包
  .sort();

if (!MAIN_FILES.includes('main.js')) {
  console.error('[build-app] 未找到 main.js');
  process.exit(1);
}

for (const f of [...REQUIRED, ...MAIN_FILES.map(x => 'desktop/' + x)]) {
  if (!fs.existsSync(path.join(root, f))) {
    console.error(`[build-app] 缺少必需文件：${f}`);
    process.exit(1);
  }
}

/* 清空旧产物：某些环境把 rmSync 劫持成"回收站删除"，服务超时就会抛错——
   清不掉不影响正确性（后面全是覆盖写），所以失败只告警不中断 */
try {
  fs.rmSync(out, { recursive: true, force: true });
} catch (e) {
  console.warn('[build-app] 旧产物未清理（' + ((e && e.message) || e) + '），改为覆盖写入');
}
fs.mkdirSync(path.join(out, 'desktop'), { recursive: true });

fs.cpSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
if (fs.existsSync(path.join(root, 'demo.html'))) {
  fs.cpSync(path.join(root, 'demo.html'), path.join(out, 'demo.html'));
  console.log('[build-app] 已纳入 demo.html（仅演示数据运行时加载）');
}
fs.cpSync(path.join(root, 'assets'), path.join(out, 'assets'), { recursive: true });
for (const f of MAIN_FILES) fs.cpSync(path.join(here, f), path.join(out, 'desktop', f));

/* 应用图标：有则带上，供主进程设置窗口/任务栏图标 */
const icoSrc = path.join(buildDir, 'icon.ico');
if (fs.existsSync(icoSrc)) fs.cpSync(icoSrc, path.join(out, 'icon.ico'));

const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: 'research-workspace',
  productName: '个人科研工作台',
  version: pkg.version,
  description: pkg.description,
  main: 'desktop/main.js',
  author: pkg.author,
  license: pkg.license
}, null, 2) + '\n', 'utf8');

/* 阶段四知识网络只读接口：主进程通过 ../rpm-integration 定位脚本，必须打进便携包。测试夹具不入包。 */
const rpmSrc = path.join(root, 'rpm-integration');
if (!fs.existsSync(rpmSrc)) {
  console.error('[build-app] 缺少 rpm-integration，无法打包知识网络');
  process.exit(1);
}
const rpmOut = path.join(out, 'rpm-integration');
fs.mkdirSync(rpmOut, { recursive: true });
for (const name of fs.readdirSync(rpmSrc)) {
  if (name === 'tests') continue;
  fs.cpSync(path.join(rpmSrc, name), path.join(rpmOut, name), { recursive: true });
}

const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
console.log(`[build-app] 已组装 desktop/app（${count(out)} 个文件）`);
