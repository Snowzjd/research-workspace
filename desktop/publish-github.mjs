/* ==========================================================================
   发布到 GitHub（前置：gh CLI 已登录）
   用法：node publish-github.mjs <owner>/<repo> [--private]
   步骤（幂等，可重跑）：
     1. 仓库不存在则创建（默认 public；private 的 Release 下载需要登录，别用）
     2. 上传仓库 README
     3. 创建 Release v2.1.0，上传 exe + 更新包 + latest.json
     4. 验证 latest 直链可访问
   ========================================================================== */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'release', 'dist');

const args = process.argv.slice(2);
const repo = args.find(a => !a.startsWith('--'));
const isPrivate = args.includes('--private');

if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('用法：node publish-github.mjs <owner>/<repo> [--private]');
  process.exit(1);
}
const tag = 'v2.1.0';
/* gh 可能不在 PATH（如便携安装），允许 GH_BIN 指定完整路径 */
const GH_BIN = process.env.GH_BIN || 'gh';
const gh = (cmd, args, opts = {}) => execFileSync(GH_BIN, [cmd, ...args], {
  stdio: opts.quiet ? 'pipe' : 'inherit', timeout: opts.timeout || 120000,
  encoding: opts.encoding || 'buffer', ...opts.extra
});

/* 登录检查：支持环境变量 GH_TOKEN（免 gh auth login，token 只要 repo scope 就够发布） */
let authed = false;
if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
  authed = true;
  console.log('[gh] 使用环境变量令牌');
} else {
  try {
    gh('auth', ['status'], { quiet: true });
    authed = true;
    console.log('[gh] 已登录');
  } catch (_) {}
}
if (!authed) {
  console.error('[gh] 未登录。设置环境变量 GH_TOKEN=<令牌>，或先运行 gh auth login');
  process.exit(1);
}

/* 只给了仓库名时自动补当前用户名 */
const fullRepo = /^[-\w.]+\/[-\w.]+$/.test(repo) ? repo : (() => {
  const login = execFileSync(GH_BIN, ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
  console.log('[repo] 自动补全为 ' + login + '/' + repo);
  return `${login}/${repo}`;
})();

/* 文件检查 */
const files = [
  path.join(dist, 'ResearchWorkspace-portable-2.1.0.exe'),
  path.join(dist, 'app-update-2.1.0.zip'),
  path.join(dist, 'latest.json')
];
for (const f of files) {
  if (!fs.existsSync(f)) { console.error('[release] 缺少文件：' + f); process.exit(1); }
}
console.log('[release] 三件套就绪');

/* 1. 仓库 */
const [owner, name] = repo.split('/');
let exists = false;
try {
  gh('repo', ['view', fullRepo, '--json', 'name'], { quiet: true });
  exists = true;
  console.log(`[repo] ${fullRepo} 已存在`);
} catch (_) {}
if (!exists) {
  console.log(`[repo] 创建 ${fullRepo}（${isPrivate ? 'private' : 'public'}）…`);
  gh('repo', ['create', fullRepo, '--public', '--description', '个人 AI 科研工程工作台 · Personal AI Research & Engineering Workspace'].concat(isPrivate ? ['--private'] : []));
}

/* 2. README */
if (fs.existsSync(path.join(dist, 'README.md'))) {
  const b64 = fs.readFileSync(path.join(dist, 'README.md')).toString('base64');
  try {
    gh('api', [`repos/${fullRepo}/contents/README.md`], { quiet: true });
    console.log('[repo] README.md 已存在，跳过');
  } catch (_) {
    try {
      gh('api', ['-X', 'PUT', `repos/${fullRepo}/contents/README.md`,
        '-f', 'message=docs: add README',
        '-f', `content=${b64}`], { quiet: true });
      console.log('[repo] README.md 已上传');
    } catch (e) { console.warn('[repo] README 上传失败（不影响 Release）：' + String(e.message).slice(0, 120)); }
  }
}

/* 3. Release（已存在则报出，不重复上传 250MB） */
const notesFile = path.join(dist, 'release-notes.md');
const existsRelease = (() => {
  try { gh('release', ['view', tag, '--repo', fullRepo], { quiet: true }); return true; } catch (_) { return false; }
})();
if (existsRelease) {
  console.error(`[release] ${tag} 已存在。若要重传，请先 gh release delete ${tag} --repo ${fullRepo} --yes`);
  process.exit(1);
}
console.log(`[release] 创建 ${tag} 并上传 3 个文件（exe 约 186MB，视网速几分钟）…`);
const relArgs = ['create', tag,
  '--repo', fullRepo,
  '--title', 'v2.1.0',
  '--notes-file', notesFile,
  files[0], files[1], files[2]
];
gh('release', relArgs, { timeout: 30 * 60 * 1000 });

/* 4. 验证直链 */
console.log('[verify] 验证 latest 直链…');
const latestUrl = `https://github.com/${fullRepo}/releases/latest/download/latest.json`;
let ok = false; let body = '';
try {
  const res = await fetch(latestUrl, { redirect: 'follow' });
  body = await res.text();
  ok = res.status === 200 && body.includes('"version"');
} catch (_) {}
console.log(ok
  ? `[verify] ✅ ${latestUrl}\n${body.trim().slice(0, 200)}`
  : `[verify] ⚠️ 直链暂不可访问（GitHub CDN 偶有延迟），稍后手动打开确认：${latestUrl}\n${body.slice(0, 120)}`);

console.log(`\n完成。另一台设备的软件里更新源填：github:${fullRepo}`);
