/* ==========================================================================
   运行环境桥接层
   - 桌面端（Electron）：走 IPC，数据落盘到 userData/workspace-data.json
   - 浏览器端：降级到 localStorage，本地文件操作给出明确不可用提示
   ========================================================================== */

const Bridge = {
  get desktop() { return !!(window.workspace && window.workspace.isDesktop); },
  get platform() { return (window.workspace && window.workspace.platform) || 'browser'; },
  /* 桌面端才启用真实 <webview>；浏览器降级模式下内置浏览器只显示说明 */
  get webview() { return !!(window.workspace && window.workspace.isDesktop && window.workspace.webview !== false); },

  /* ---------- 持久化 ---------- */
  async load() {
    try {
      const raw = this.desktop ? await window.workspace.loadData() : localStorage.getItem('rw.data');
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (saved && typeof saved === 'object') {
        /* 以 freshData 作为结构底座：只补字段，不把示例项目灌进用户数据 */
        return migrate({
          ...freshData(),
          ...saved,
          settings: { ...SETTINGS_DEFAULT, ...(saved.settings || {}) }
        });
      }
    } catch (e) {
      console.warn('[Bridge] 读取数据失败，按全新安装处理', e);
    }
    /* 没有数据文件 = 全新安装 */
    return null;
  },

  async save(data) {
    try {
      const payload = JSON.stringify(data);
      if (this.desktop) return await window.workspace.saveData(payload);
      localStorage.setItem('rw.data', payload);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  },

  async reset() {
    if (this.desktop) await window.workspace.resetData();
    else localStorage.removeItem('rw.data');
  },

  /* ---------- 本地文件 ---------- */
  async openFolder(p) {
    if (!p) return { ok: false, error: '未配置文件夹路径' };
    if (!this.desktop) return { ok: false, error: '浏览器模式无法打开本地文件夹，请复制路径手动打开' };
    return await window.workspace.openPath(p);
  },

  async openFile(p) {
    return this.openFolder(p);
  },

  /* ---------- 工程软件 ---------- */
  async launchApp(payload) {
    if (!this.desktop) return { ok: false, error: '浏览器模式无法启动本地程序，请用桌面端运行' };
    return await window.workspace.launchApp(payload);
  },
  async stopApp(name) {
    if (!this.desktop) return { ok: false, error: '浏览器模式无法结束进程' };
    return await window.workspace.stopApp(name);
  },
  async listRunning() {
    if (!this.desktop) return [];
    return await window.workspace.listRunning();
  },
  async pickExecutable() {
    if (!this.desktop) return null;
    return await window.workspace.pickExecutable();
  },
  async pickDirectory() {
    if (!this.desktop) return null;
    return await window.workspace.pickDirectory();
  },

  /* ---------- 启动台导入（快捷方式 / 程序 / 文件夹） ---------- */
  async pickLaunchTarget(mode) {
    if (!this.desktop) return null;
    return await window.workspace.pickLaunchTarget(mode);
  },
  async resolveLaunchTarget(p) {
    if (!this.desktop) return { ok: false, error: '浏览器模式无法解析本地快捷方式，请在桌面端操作' };
    return await window.workspace.resolveLaunchTarget(p);
  },

  /* ---------- AI 接入（密钥由主进程 safeStorage 保管，渲染层永远拿不到明文） ---------- */
  async aiProviders() {
    if (!this.desktop) return [];
    return await window.workspace.aiProviders();
  },
  async aiKeyState() {
    if (!this.desktop) return { stored: false, encrypted: false, reason: 'browser' };
    return await window.workspace.aiKeyState();
  },
  async aiSetKey(plain) {
    if (!this.desktop) return { ok: false, error: '浏览器模式无法安全保存密钥，请在桌面端配置' };
    return await window.workspace.aiSetKey(plain);
  },
  async aiChat(cfg) {
    if (!this.desktop) return { ok: false, error: 'AI 接入需要桌面端运行：浏览器模式无法安全保存密钥，也无法绕过跨域限制发起请求。' };
    return await window.workspace.aiChat(cfg);
  },
  async aiTest(cfg) {
    if (!this.desktop) return { ok: false, error: 'AI 接入需要桌面端运行。' };
    return await window.workspace.aiTest(cfg);
  },

  /* ---------- 多设备同步：三方合并 ---------- */
  async syncMerge(payload) {
    if (!this.desktop) return { ok: false, error: '合并需要桌面端运行' };
    return await window.workspace.syncMerge(payload);
  },
  async syncInfo() {
    if (!this.desktop) return { ok: false, enabled: false, error: '同步需要桌面端运行' };
    return await window.workspace.syncInfo();
  },
  async syncSetDir(dir) {
    if (!this.desktop) return { ok: false, error: '同步需要桌面端运行' };
    return await window.workspace.syncSetDir(dir);
  },
  async syncRun(opts) {
    if (!this.desktop) return { ok: false, error: '同步需要桌面端运行' };
    return await window.workspace.syncRun(opts || {});
  },

  /* ---------- 账户与云端绑定 ---------- */
  async accountStatus() {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountStatus();
  },
  async accountRegister(payload) {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountRegister(payload || {});
  },
  async accountRename(name) {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountRename(name);
  },
  async accountSetPass(pass) {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountSetPass(pass);
  },
  async accountClearPass() {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountClearPass();
  },
  async accountUnlock(pass) {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountUnlock(pass);
  },
  async accountLock() {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountLock();
  },
  async accountTestCloud(cfg) {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountTestCloud(cfg || {});
  },
  async accountBind(cfg) {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountBind(cfg || {});
  },
  async accountUnbind() {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountUnbind();
  },
  async accountResetLocal() {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.accountResetLocal();
  },
  async cloudProbe() {
    if (!this.desktop) return { ok: false, error: '账户功能需要桌面端运行' };
    return await window.workspace.cloudProbe();
  },

  /* ---------- 应用内更新 ---------- */
  async updateInfo() {
    if (!this.desktop) return { ok: false, portable: false, error: '浏览器模式不支持更新' };
    return await window.workspace.updateInfo();
  },
  async updateCheck() {
    if (!this.desktop) return { ok: false, error: '浏览器模式不支持更新' };
    return await window.workspace.updateCheck();
  },
  async updateApply() {
    if (!this.desktop) return { ok: false, error: '浏览器模式不支持更新' };
    return await window.workspace.updateApply();
  },
  async updateSetSource(v) {
    if (!this.desktop) return { ok: false, error: '浏览器模式不支持更新' };
    return await window.workspace.updateSetSource(v);
  },

  /* ---------- 交接文件 ---------- */
  async handoffInfo() {
    if (!this.desktop) return { ok: false, error: '交接文件需要桌面端运行' };
    return await window.workspace.handoffInfo();
  },
  async handoffExport() {
    if (!this.desktop) return { ok: false, error: '交接文件需要桌面端运行' };
    return await window.workspace.handoffExport();
  },
  async handoffImport() {
    if (!this.desktop) return { ok: false, error: '交接文件需要桌面端运行' };
    return await window.workspace.handoffImport();
  },
  async handoffApply(opts) {
    if (!this.desktop) return { ok: false, error: '交接文件需要桌面端运行' };
    return await window.workspace.handoffApply(opts || {});
  },
  async handoffDoc() {
    if (!this.desktop) return { ok: false, error: '交接文件需要桌面端运行' };
    return await window.workspace.handoffDoc();
  },

  /* ---------- 删除文件夹（走系统回收站） ---------- */
  async trashPath(target) {
    if (!this.desktop) return { ok: false, error: '删除文件夹需要桌面端运行' };
    return await window.workspace.trashPath(target);
  },

  /* ---------- 全新安装预览（另开窗口，临时数据） ---------- */
  async previewFresh() {
    if (!this.desktop) return { ok: false, error: '预览需要桌面端运行' };
    return await window.workspace.previewFresh();
  },

  /* ---------- 本机标识 ---------- */
  async deviceInfo() {
    if (!this.desktop) return { deviceId: '', deviceName: '浏览器', browser: true };
    return await window.workspace.deviceInfo();
  },

  /* ---------- 数据备份 ---------- */
  async backupInfo() {
    if (!this.desktop) return { count: 0, latest: null, items: [], dir: '' };
    return await window.workspace.backupInfo();
  },
  async backupNow() {
    if (!this.desktop) return { ok: false, error: '备份需要桌面端运行' };
    return await window.workspace.backupNow();
  },
  async backupAuto() {
    if (!this.desktop) return { ok: true, skipped: true };
    return await window.workspace.backupAuto();
  },
  async backupRestore(name) {
    if (!this.desktop) return { ok: false, error: '恢复需要桌面端运行' };
    return await window.workspace.backupRestore(name);
  },

  /* ---------- 外部 RAG 检索 ---------- */
  async ragState() {
    if (!this.desktop) return { stored: false, encrypted: false };
    return await window.workspace.ragState();
  },
  async ragSetToken(plain) {
    if (!this.desktop) return { ok: false, error: '需要在桌面端运行' };
    return await window.workspace.ragSetToken(plain);
  },
  async ragHealth(cfg) {
    if (!this.desktop) return { ok: false, error: '外部 RAG 需要桌面端运行（浏览器无法绕过跨域）。' };
    return await window.workspace.ragHealth(cfg);
  },
  async ragSearch(cfg) {
    if (!this.desktop) return { ok: false, error: '外部 RAG 需要桌面端运行。' };
    return await window.workspace.ragSearch(cfg);
  },
  async ragAsk(cfg) {
    if (!this.desktop) return { ok: false, error: '外部 RAG 需要桌面端运行（问答由主进程转发，页面不直接请求知识库端口）。' };
    if (typeof window.workspace.ragAsk !== 'function') return { ok: false, error: '当前桌面桥没有 ragAsk' };
    return await window.workspace.ragAsk(cfg);
  },
  async ragReindex(cfg) {
    if (!this.desktop) return { ok: false, error: '外部 RAG 需要桌面端运行。' };
    return await window.workspace.ragReindex(cfg);
  },

  /* ---------- 外部 Agent 接入（本地 API + MCP） ---------- */
  async apiInfo() {
    if (!this.desktop) return { running: false, port: 0, baseUrl: '', token: '', browserMode: true };
    return await window.workspace.apiInfo();
  },
  async apiRotate() {
    if (!this.desktop) return null;
    return await window.workspace.apiRotate();
  },
  async apiMcpConfig() {
    if (!this.desktop) return null;
    return await window.workspace.apiMcpConfig();
  },
  async connScan() {
    if (!this.desktop) return { ok: false, clients: [] };
    return await window.workspace.connScan();
  },
  async connApply(id) {
    if (!this.desktop) return { ok: false, error: '需要桌面端运行' };
    return await window.workspace.connApply(id);
  },
  async connRemove(id) {
    if (!this.desktop) return { ok: false, error: '需要桌面端运行' };
    return await window.workspace.connRemove(id);
  },
  async connPrompt() {
    if (!this.desktop) return { ok: false, error: '需要桌面端运行' };
    return await window.workspace.connPrompt();
  },
  async connExport() {
    if (!this.desktop) return { ok: false, error: '需要桌面端运行' };
    return await window.workspace.connExport();
  },
  async connReveal(id) {
    if (!this.desktop) return { ok: false, error: '需要桌面端运行' };
    return await window.workspace.connReveal(id);
  },

  /* ---------- 剪贴板 ---------- */
  async copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true };
      }
      throw new Error('clipboard unavailable');
    } catch (_) {
      return { ok: false, error: '复制失败，请手动选择文本' };
    }
  }
};

/* 立即落盘（同步前调用）：先等排队中的保存结束，再写一次 */
async function flushSave() {
  clearTimeout(_saveTimer);
  let guard = 0;
  while (_saving && guard++ < 40) await new Promise(r => setTimeout(r, 30));
  try { if (typeof stampChanges === 'function') stampChanges(); } catch (_) {}
  try { return await Bridge.save(DB); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/* ---------- 数据落盘（去抖 + 串行化，保证最后一次改动一定落盘） ----------
   旧实现里 `if (_saving) return;` 会把保存期间发生的改动**直接丢掉**且不重试 ——
   快速连续操作、或撤销时的 persist(true) 撞上正在进行的保存，那次改动就永远不写盘。
   现在改为：保存中只打脏标记，本次结束后自动补写一次。 */
let _saveTimer = null;
let _saving = false;
let _dirty = false;
let _saveFails = 0;
let _backupDay = '';

function persist(immediate) {
  clearTimeout(_saveTimer);

  const run = async () => {
    if (_saving) { _dirty = true; return; }
    _saving = true;
    _dirty = false;
    /* 落盘前统一打修订标记（rev）与删除墓碑，供后续多设备合并使用 */
    try { if (typeof stampChanges === 'function') stampChanges(); } catch (_) {}
    let r;
    try {
      r = await Bridge.save(DB);
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    }
    _saving = false;

    if (r && r.ok) {
      _saveFails = 0;
      /* 自动备份：按天节流，一天只做一次（开关关闭时跳过） */
      if (DB.settings && DB.settings.autoBackup) {
        const d0 = new Date();
        const tag = `${d0.getFullYear()}-${d0.getMonth()}-${d0.getDate()}`;
        if (_backupDay !== tag) {
          _backupDay = tag;
          Bridge.backupAuto().then(res => {
            if (res && res.ok && !res.skipped && typeof refreshBackupState === 'function') refreshBackupState();
          }).catch(() => {});
        }
      }
    } else {
      _saveFails++;
      /* 失败后有限重试；仍然失败就明确告知，不静默吞掉 */
      if (_saveFails <= 2) {
        _dirty = true;
        setTimeout(run, 1200);
        return;
      }
      toast(`数据保存失败（已重试）：${esc((r && r.error) || '未知错误')}`, 'err');
    }
    if (_dirty) run();
  };

  if (immediate) run();
  else _saveTimer = setTimeout(run, 350);
}

/* ---------- 活动日志（真实写入，全局共享） ---------- */
const LOG_ICONS = { create: 'plus', edit: 'pencil', delete: 'trash', run: 'play', stop: 'stop', search: 'search', open: 'folderOpen', save: 'save', agent: 'bot' };
function logActivity(text, kind, color) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  DB.activities.unshift({
    c: color || '#3E63DD',
    i: LOG_ICONS[kind] || 'pulse',
    kind: kind || 'edit',
    t: text,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    at: d.getTime()
  });
  if (DB.activities.length > 40) DB.activities.length = 40;
}
