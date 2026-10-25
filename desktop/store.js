/* ==========================================================================
   本地数据存储
   - 数据文件：<userData>/workspace-data.json
   - 原子写入（先写 .tmp 再 rename），避免断电/崩溃产生半截文件
   ========================================================================== */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const device = require('./device');

const dataFile = () => path.join(app.getPath('userData'), 'workspace-data.json');

function readData() {
  try {
    const f = dataFile();
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, 'utf8');
    /* 数据文件里不含本机路径；读出来后在内存里补回去 */
    try {
      return JSON.stringify(device.inject(JSON.parse(raw)));
    } catch (_) {
      return raw;   /* 解析失败就原样返回，交给上层兜底 */
    }
  } catch (err) {
    console.error('[store] 读取失败:', err);
    return null;
  }
}

function writeData(json) {
  try {
    if (typeof json !== 'string') return { ok: false, error: '数据格式错误' };
    const parsed = JSON.parse(json);            /* 先校验，避免写入坏数据 */

    /* 本机字段（工作区根目录 / 软件安装路径 / 目录是否已建）抽到 device.json，
       数据文件只保留可跨设备同步的内容 */
    const { data, device: dev } = device.split(parsed);
    device.write(dev);

    const clean = JSON.stringify(data);
    const f = dataFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, clean, 'utf8');
    fs.renameSync(tmp, f);
    return { ok: true, file: f, bytes: Buffer.byteLength(clean) };
  } catch (err) {
    console.error('[store] 写入失败:', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function resetData() {
  try {
    const f = dataFile();
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/* ---------- 工作区目录骨架 ---------- */
const PLACEHOLDER = name => `# ${name}\n\n本文件由「个人 AI 科研工程工作台」自动创建，用于占位以保持目录结构完整。\n可以直接替换为真实材料，删除后再次启动会自动重建。\n`;

function ensureStructure(payload) {
  const { root, projects } = payload || {};
  if (!root) return { ok: false, error: '未指定工作区根目录' };
  const created = { dirs: 0, files: 0 };
  try {
    fs.mkdirSync(root, { recursive: true });
    (projects || []).forEach(p => {
      const pdir = path.resolve(root, String(p.folder || p.name || '').replace(/[\\/]+/g, '-'));
      /* 防御路径穿越：项目目录必须真的在根目录之下 */
      if (path.dirname(pdir) !== path.resolve(root) && !pdir.startsWith(path.resolve(root) + path.sep)) return;
      fs.mkdirSync(pdir, { recursive: true });
      created.dirs++;
      Object.entries(p.dirs || {}).forEach(([d, files]) => {
        const ddir = path.join(pdir, d);
        fs.mkdirSync(ddir, { recursive: true });
        created.dirs++;
        (files || []).forEach(f => {
          const fp = path.join(ddir, f.name);
          if (f.kind === 'dir') {
            fs.mkdirSync(fp, { recursive: true });
          } else if (!fs.existsSync(fp)) {
            fs.writeFileSync(fp, PLACEHOLDER(f.name), 'utf8');
          }
          created.files++;
        });
      });
    });
    return { ok: true, root, created };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), partial: created };
  }
}

module.exports = { readData, writeData, resetData, ensureStructure, dataFile };
