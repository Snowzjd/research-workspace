import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import full from './full-product.js';
import { verifyElectronDistribution, verifyRuntimeFiles } from './electron-runtime.mjs';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(desktop);
const release = path.resolve(process.argv[2] || path.join(desktop, 'release'));
const output = path.join(release, 'portable-' + full.VERSION);
const packageData = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const marker = full.MARKER;
const markerContents = full.MARKER_CONTENT + '\r\n';

if (packageData.version !== full.VERSION) throw new Error('Unexpected candidate version');
if (fs.existsSync(output)) throw new Error('Candidate already exists. Keep it and use a fresh output parent for another build.');
const lock = JSON.parse(fs.readFileSync(path.join(desktop, 'package-lock.json'), 'utf8'));
if (lock.version !== full.VERSION || lock.packages['']?.version !== full.VERSION) throw new Error('Lockfile version mismatch');
const electronPackage = path.join(desktop, 'node_modules', 'electron');
if (!fs.existsSync(path.join(electronPackage, 'dist', 'electron.exe'))) {
  throw new Error('Windows x64 Electron runtime is missing. From desktop/, run npm ci and then npx install-electron on the Windows build machine.');
}
const electron = verifyElectronDistribution(electronPackage,
  packageData.devDependencies.electron, lock.packages['node_modules/electron']?.version);
fs.mkdirSync(release, { recursive: true });
if (fs.realpathSync.native(release).toLowerCase() !== release.toLowerCase()) {
  throw new Error('Build output directory must be a real directory');
}

const staging = fs.mkdtempSync(path.join(release, '.full-candidate-build-'));
const app = path.join(staging, 'resources', 'app');
fs.cpSync(electron, staging, {
  recursive: true,
  filter: source => !['default_app.asar', 'debug.log'].includes(path.basename(source))
});
fs.renameSync(path.join(staging, 'electron.exe'), path.join(staging, 'ResearchWorkspace.exe'));
if (process.env.RW_RCEDIT) {
  const numericVersion = packageData.version.replace(/-rc\.(\d+)$/, '.$1');
  execFileSync(process.env.RW_RCEDIT, [
    path.join(staging, 'ResearchWorkspace.exe'),
    '--set-icon', path.join(root, 'icon.ico'),
    '--set-file-version', numericVersion, '--set-product-version', numericVersion,
    '--set-version-string', 'ProductVersion', packageData.version,
    '--set-version-string', 'ProductName', '个人科研工程工作台',
    '--set-version-string', 'FileDescription', 'Research and Engineering Workspace'
  ], { shell: false, windowsHide: true, timeout: 30000 });
}
fs.mkdirSync(path.join(app, 'desktop'), { recursive: true });
const csp = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'none'", "object-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"
].join('; ');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<title>[^<]*<\/title>/, '<title>个人科研工程工作台</title>')
  .replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">');
fs.writeFileSync(path.join(app, 'index.html'), index);
fs.cpSync(path.join(root, 'icon.ico'), path.join(app, 'icon.ico'));
const firstPartyLicense = path.join(root, 'LICENSE');
if (!fs.existsSync(firstPartyLicense)) throw new Error('First-party LICENSE is missing');
fs.copyFileSync(firstPartyLicense, path.join(app, 'LICENSE'));
fs.cpSync(path.join(root, 'assets'), path.join(app, 'assets'), { recursive: true });
const dataFile = path.join(app, 'assets', 'js', 'data.js');
const dataSource = fs.readFileSync(dataFile, 'utf8');
const demoSeed = /^const SEED = ([\s\S]+?)^};\r?$/m;
const demoMaterials = /^const MATERIALS = [\s\S]+?^};\r?$/m;
const match = dataSource.match(demoSeed);
if (!match || !demoMaterials.test(dataSource)) throw new Error('Expected demo data boundaries are missing');
const legacy = runInNewContext('(' + match[1] + '})', {}, { timeout: 1000 });
const seed = {
  user: { name: '研究员', initial: '研', greet: '', mode: '本地工作台' }, rootDir: '',
  months: legacy.months, taskStatus: legacy.taskStatus,
  agents: legacy.agents.map(({ name }) => ({ name })),
  apps: legacy.apps.map(({ n, ico, kind, color, desc }) => ({ n, ico, kind, color, desc })),
  projects: [], tasks: [], activities: [], todos: [], resources: [], kbDocs: [], automations: [],
  timeline: [], sidebarLaunch: [], chats: {}, workspace: {}, ai: {}
};
fs.writeFileSync(dataFile, dataSource.replace(demoSeed, 'const SEED = ' + JSON.stringify(seed, null, 2) + ';')
  .replace(demoMaterials, 'const MATERIALS = {};'), 'utf8');
fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(staging, 'THIRD-PARTY-NOTICES.md'));
const modules = [
  'account.js', 'ai-chat-loop.js', 'ai.js', 'api-server.js', 'backup.js', 'cloud.js', 'connectors.js',
  'device.js', 'codex-collaboration.js', 'codex-handoff.js', 'full-markdown.js', 'full-product.js', 'full-search.js', 'handoff.js',
  'kb-service.js', 'main.js', 'preload.js', 'project-root.js', 'rag.js', 'rpm-adapter.js', 'rpm-http.js',
  'rpm-knowledge.js', 'store.js', 'sync-carrier.js', 'sync-cloud.js', 'sync-merge.js', 'updater.js'
];
for (const file of modules) fs.cpSync(path.join(desktop, file), path.join(app, 'desktop', file));
const rpm = path.join(app, 'rpm-integration');
fs.mkdirSync(rpm);
for (const file of ['rpm_knowledge_api.py', 'workbench-rpm-knowledge.cjs', 'VERSION']) {
  fs.cpSync(path.join(root, 'rpm-integration', file), path.join(rpm, file));
}
const { name, version, description, license } = packageData;
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
  name, version, description, license, productName: '个人科研工程工作台', main: 'desktop/main.js', fullCandidate: true
}, null, 2) + '\n');
for (const directory of [staging, app]) fs.writeFileSync(path.join(directory, marker), markerContents, 'ascii');
fs.writeFileSync(path.join(staging, 'start.cmd'), '@echo off\r\nstart "" /D "%~dp0" "%~dp0ResearchWorkspace.exe"\r\n', 'ascii');
verifyRuntimeFiles(staging, 'ResearchWorkspace.exe');
fs.renameSync(staging, output);
console.log(output);
