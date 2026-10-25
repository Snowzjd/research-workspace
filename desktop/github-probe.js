/* ==========================================================================
   真实 GitHub 更新通道验证（走 api.github.com，不替换文件）
   用途：确认「检查更新」在真实网络下能拿到版本清单并下载更新包。
   仅用于诊断，不参与自动回归（依赖外网）。
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const updater = require('./updater');

async function run({ outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 240)
  });

  try {
    const I = updater._internals;
    const src = I.resolveSource(updater.DEFAULT_SOURCE);
    rec('默认源解析为 github 通道', src.kind === 'github' && src.repo === 'Snowzjd/research-workspace', `${src.kind} ${src.repo || ''}`);

    const t0 = Date.now();
    const c = await updater.check({ requirePortable: false });
    rec('真实拉取版本清单（api.github.com）',
      c.ok === true && !!c.latest && /^\d+\.\d+\.\d+$/.test(c.latest.version || ''),
      c.ok ? `latest=${c.latest.version} 当前=${c.current} 用时=${((Date.now() - t0) / 1000).toFixed(1)}s` : c.error);
    rec('清单里带资产 id（用于下载）', !!(c.ok && c.latest.assetId), c.ok ? String(c.latest.assetId) : '-');

    const t1 = Date.now();
    const a = await updater.apply({ force: true, dryRun: true });
    rec('真实下载更新包并校验',
      a.ok === true && a.dryRun === true && a.zipBytes > 100000,
      a.ok ? `${(a.zipBytes / 1024).toFixed(0)} KB · 用时=${((Date.now() - t1) / 1000).toFixed(1)}s · 版本 ${a.to}` : a.error);
  } catch (err) {
    rec('未捕获异常', false, String((err && err.message) || err));
  }

  const pass = rows.filter(r => r.pass).length;
  const out = { ok: pass === rows.length && rows.length > 0, pass, total: rows.length, rows, at: new Date().toISOString() };
  for (const t of [outPath, path.join(os.tmpdir(), 'rw-probe-github.json')]) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

module.exports = { run };
