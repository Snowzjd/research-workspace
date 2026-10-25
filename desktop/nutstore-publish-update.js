/* ==========================================================================
   把更新包发布到已绑定的坚果云（备用更新源）
   - 读真实绑定凭证，把 dist 里的 latest.json + app-update zip 传到
     <绑定目录>/Releases/ 下
   - 只上传小文件（更新包 1MB 级），不传完整 exe
   用法：electron nutstore-publish-update.mjs
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const account = require('./account');
const cloud = require('./cloud');

async function run() {
  const out = { ok: false, steps: [] };
  const step = (n, pass, d) => out.steps.push({ n, pass: !!pass, detail: String(d || '').slice(0, 160) });
  try {
    const b = account.currentBinding();
    if (!b || b.kind !== 'webdav') {
      step('读取绑定', false, b ? '绑定类型不是 webdav' : '尚未绑定云端');
      throw new Error('no-binding');
    }
    step('读取绑定', true, `${b.url} · ${b.user}`);

    const dist = path.join(__dirname, 'release', 'dist');
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'latest.json'), 'utf8'));
    const zipFile = path.join(dist, manifest.update);
    if (!fs.existsSync(zipFile)) throw new Error('找不到 ' + zipFile);

    /* 确保目录存在 */
    await cloud.ensureDir({ ...b, dir: (b.dir || cloud.DEFAULT_DIR).replace(/\/+$/, '') + '/Releases' });
    step('云端 Releases/ 目录就绪', true);

    const p1 = await cloud.put(b, 'Releases/latest.json', fs.readFileSync(path.join(dist, 'latest.json'), 'utf8'));
    step('上传 latest.json', p1.ok, p1.error || p1.bytes + ' 字节');
    const p2 = await cloud.putBinary(b, 'Releases/' + manifest.update, fs.readFileSync(zipFile));
    step('上传 ' + manifest.update, p2.ok, p2.error || p2.bytes + ' 字节');

    /* 回读校验 */
    const check = await cloud.get(b, 'Releases/latest.json');
    const okCheck = check && check.includes('"version"');
    step('回读校验', okCheck, okCheck ? check.trim().slice(0, 100) : '内容为空');
    out.ok = okCheck && p1.ok && p2.ok;
    out.dir = b.dir;
  } catch (err) {
    if (!out.steps.length) out.steps.push({ n: '异常', pass: false, detail: String((err && err.message) || err) });
    out.ok = false;
    out.error = String((err && err.message) || err);
  }
  const targets = [path.join(__dirname, 'nutstore-publish-result.json'), path.join(require('os').tmpdir(), 'rw-nutstore-publish-result.json')];
  for (const t of targets) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

module.exports = { run };
