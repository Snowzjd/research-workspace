/* ==========================================================================
   数据备份
   --------------------------------------------------------------------------
   这个软件里最不可再生的东西是数据本身（项目盘点、任务规划、整理出的思路）。
   程序坏了能重装，数据丢了就没了，所以备份必须是真的。

   策略：
   - 每天第一次写盘成功后自动备份一份（按天节流，不会把磁盘刷满）
   - 保留最近 7 份，更早的自动清理
   - 支持手动立即备份、列出历史、从某一份恢复
   - 恢复前由渲染层二次确认；恢复后调用方负责重新加载数据

   存放位置：<userData>/backups/workspace-data-YYYYMMDD-HHmmss.json
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const KEEP = 7;
const PREFIX = 'workspace-data-';
const SUFFIX = '.json';
const NAME_RE = /^workspace-data-\d{8}-\d{6}\.json$/;

let dirOverride = null;   /* 仅测试用：把数据目录指向临时路径 */
const baseDir = () => dirOverride || app.getPath('userData');
const dataFile = () => path.join(baseDir(), 'workspace-data.json');
const backupDir = () => path.join(baseDir(), 'backups');

const pad = n => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function todayTag(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function ensureDir() {
  const d = backupDir();
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  return d;
}

/* 新的在前 */
function list() {
  try {
    const dir = ensureDir();
    return fs.readdirSync(dir)
      .filter(n => NAME_RE.test(n))
      .map(n => {
        const st = fs.statSync(path.join(dir, n));
        return { name: n, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch (_) { return []; }
}

function prune(keep = KEEP) {
  const all = list();
  let removed = 0;
  all.slice(keep).forEach(item => {
    try { fs.rmSync(path.join(backupDir(), item.name), { force: true }); removed++; } catch (_) {}
  });
  return removed;
}

/* 今天是否已经备份过 */
function due() {
  const all = list();
  if (!all.length) return true;
  return !all[0].name.startsWith(PREFIX + todayTag());
}

function create(reason = 'auto') {
  try {
    const src = dataFile();
    if (!fs.existsSync(src)) return { ok: false, error: '还没有可备份的数据文件' };
    const raw = fs.readFileSync(src);
    if (!raw.length) return { ok: false, error: '数据文件为空，已跳过备份' };
    JSON.parse(raw.toString('utf8'));           /* 坏数据不备份，避免把备份也污染 */

    const dir = ensureDir();
    /* 同一秒内重复调用时直接覆盖当天同名文件，保证「立即备份」永远能成功 */
    const name = PREFIX + stamp() + SUFFIX;
    const target = path.join(dir, name);
    fs.copyFileSync(src, target);
    const pruned = prune();
    return { ok: true, name, at: new Date().toISOString(), pruned, reason, count: list().length };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/* 写盘后调用：只有开启且今天还没备份过才真正动手 */
function auto() {
  try {
    if (!due()) return { ok: true, skipped: true, reason: '今天已备份' };
    return create('auto');
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function restore(name) {
  try {
    if (!NAME_RE.test(String(name || ''))) return { ok: false, error: '备份文件名不合法' };
    const src = path.join(backupDir(), name);
    if (!fs.existsSync(src)) return { ok: false, error: '备份文件不存在' };
    const raw = fs.readFileSync(src, 'utf8');
    JSON.parse(raw);                            /* 恢复前校验，坏数据不许覆盖 */
    const dst = dataFile();
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return { ok: true, restored: name };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function info() {
  const all = list();
  return {
    dir: backupDir(),
    dataFile: dataFile(),
    count: all.length,
    latest: all[0] || null,
    keep: KEEP,
    items: all
  };
}

module.exports = { list, create, auto, restore, prune, due, info, backupDir, KEEP, __setDir: d => { dirOverride = d; } };
