/* ==========================================================================
   预加载脚本：以 contextBridge 暴露最小权限的桌面能力
   渲染层通过 window.workspace.* 调用；在浏览器中打开时该对象为 undefined，
   渲染层会自动降级到 localStorage。
   ========================================================================== */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('workspace', {
  deviceInfo:  () => ipcRenderer.invoke('device:info'),
  backupInfo:  () => ipcRenderer.invoke('backup:info'),
  backupNow:   () => ipcRenderer.invoke('backup:now'),
  backupAuto:  () => ipcRenderer.invoke('backup:auto'),
  backupRestore: (name) => ipcRenderer.invoke('backup:restore', name),

  isDesktop: true,
  webview: true,                       /* 主窗口已启用 webviewTag，内置浏览器可渲染真实网页 */
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },

  /* 数据持久化 */
  loadData:     () => ipcRenderer.invoke('data:load'),
  saveData:     (json) => ipcRenderer.invoke('data:save', json),
  resetData:    () => ipcRenderer.invoke('data:reset'),
  dataFilePath: () => ipcRenderer.invoke('data:path'),

  /* 本地文件与文件夹 */
  openPath:        (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem:        (p) => ipcRenderer.invoke('shell:showItem', p),
  exists:          (p) => ipcRenderer.invoke('fs:exists', p),
  ensureStructure: (payload) => ipcRenderer.invoke('fs:ensureStructure', payload),
  trashPath:       (p) => ipcRenderer.invoke('fs:trashPath', p),
  previewFresh:    () => ipcRenderer.invoke('app:previewFresh'),

  /* 多设备同步：合并与共享文件夹载体 */
  syncMerge:       (payload) => ipcRenderer.invoke('sync:merge', payload),
  syncInfo:        () => ipcRenderer.invoke('sync:info'),
  syncSetDir:      (dir) => ipcRenderer.invoke('sync:setDir', dir),
  syncRun:         (opts) => ipcRenderer.invoke('sync:run', opts),

  /* 账户：身份 / 本机密码 / 云端绑定 */
  accountStatus:    () => ipcRenderer.invoke('account:status'),
  accountRegister:  (p) => ipcRenderer.invoke('account:register', p),
  accountRename:    (n) => ipcRenderer.invoke('account:rename', n),
  accountSetPass:   (p) => ipcRenderer.invoke('account:setPass', p),
  accountClearPass: () => ipcRenderer.invoke('account:clearPass'),
  accountUnlock:    (p) => ipcRenderer.invoke('account:unlock', p),
  accountLock:      () => ipcRenderer.invoke('account:lock'),
  accountTestCloud: (cfg) => ipcRenderer.invoke('account:testCloud', cfg),
  accountBind:      (cfg) => ipcRenderer.invoke('account:bind', cfg),
  accountUnbind:    () => ipcRenderer.invoke('account:unbind'),
  accountResetLocal:() => ipcRenderer.invoke('account:resetLocal'),
  saveWritingDoc:   (p) => ipcRenderer.invoke('doc:save-writing', p),
  cloudProbe:       () => ipcRenderer.invoke('cloud:probe'),

  /* 应用内更新 */
  updateInfo:       () => ipcRenderer.invoke('update:info'),
  updateCheck:      () => ipcRenderer.invoke('update:check'),
  updateApply:      () => ipcRenderer.invoke('update:apply'),
  updateSetSource:  (v) => ipcRenderer.invoke('update:setSource', v),

  /* 交接文件：数据包导出 / 导入、交接单导出 */
  handoffInfo:     () => ipcRenderer.invoke('handoff:info'),
  handoffExport:   () => ipcRenderer.invoke('handoff:export'),
  handoffImport:   () => ipcRenderer.invoke('handoff:import'),
  handoffApply:    (opts) => ipcRenderer.invoke('handoff:apply', opts),
  handoffDoc:      () => ipcRenderer.invoke('handoff:doc'),

  pickDirectory:   () => ipcRenderer.invoke('dialog:pickDirectory'),
  pickExecutable:  () => ipcRenderer.invoke('dialog:pickExecutable'),
  /* Sprint B：拖拽导入 —— webUtils 才能拿到真实路径（Electron 32+） */
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (_) { return (file && file.path) || ''; } },
  resolveDropped:  (absPath) => ipcRenderer.invoke('app:resolve-dropped', absPath),
  scanMaterials:   (payload) => ipcRenderer.invoke('materials:scan', payload),
  exportTemplates: (payload) => ipcRenderer.invoke('templates:export', payload),
  importTemplates: () => ipcRenderer.invoke('templates:import'),

  /* 启动台导入：快捷方式 / 程序 / 文件夹 */
  pickLaunchTarget:    (mode) => ipcRenderer.invoke('launch:pick', mode),
  resolveLaunchTarget: (p) => ipcRenderer.invoke('launch:resolve', p),

  /* 工程软件进程 */
  launchApp:   (payload) => ipcRenderer.invoke('app:launch', payload),
  stopApp:     (name) => ipcRenderer.invoke('app:stop', name),
  listRunning: () => ipcRenderer.invoke('app:list'),

  /* AI 接入（密钥只在主进程读写，渲染层拿不到明文） */
  aiProviders: () => ipcRenderer.invoke('ai:providers'),
  aiKeyState:  () => ipcRenderer.invoke('ai:keyState'),
  aiSetKey:    (plain) => ipcRenderer.invoke('ai:setKey', plain),
  aiChat:      (cfg) => ipcRenderer.invoke('ai:chat', cfg),
  aiTest:      (cfg) => ipcRenderer.invoke('ai:test', cfg),

  /* 外部 RAG 检索（令牌只在主进程，渲染层拿不到明文） */
  ragState:    () => ipcRenderer.invoke('rag:state'),
  ragSetToken: (plain) => ipcRenderer.invoke('rag:setToken', plain),
  ragHealth:   (cfg) => ipcRenderer.invoke('rag:health', cfg),
  ragSearch:   (cfg) => ipcRenderer.invoke('rag:search', cfg),
  ragReindex:  (cfg) => ipcRenderer.invoke('rag:reindex', cfg),

  /* 外部 Agent 接入（本地 API + MCP） */
  apiInfo:      () => ipcRenderer.invoke('api:info'),
  apiRotate:    () => ipcRenderer.invoke('api:rotate'),
  apiMcpConfig: () => ipcRenderer.invoke('api:mcpConfig'),

  /* 一键连接：检测并写入各 MCP 客户端配置 */
  connScan:   () => ipcRenderer.invoke('conn:scan'),
  connApply:  (id) => ipcRenderer.invoke('conn:apply', id),
  connRemove: (id) => ipcRenderer.invoke('conn:remove', id),
  connPrompt: () => ipcRenderer.invoke('conn:prompt'),
  connExport: () => ipcRenderer.invoke('conn:export'),
  connReveal: (id) => ipcRenderer.invoke('conn:reveal', id)
});
