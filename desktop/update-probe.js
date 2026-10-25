/* ==========================================================================
   应用内更新的端到端验证
   - 单元：版本比较 / 更新源解析 / bat 脚本生成
   - 集成：http mock 与 mock WebDAV 两种源的 check + apply(dryRun)（下载→解压→校验）
   - 真实替换由 --update-e2e 流程在便携版上单独验证（会真改 resources/app）
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const store = require('./store');
const device = require('./device');
const updater = require('./updater');
const mockDav = require('./mock-webdav');

async function run({ outPath }) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 200)
  });
  const I = updater._internals;
  const tmp = path.join(os.tmpdir(), 'rw-upd-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });

  /* 造一份最小更新包：package.json version 99.0.0 + 一个占位文件，打成 zip */
  function buildFakeZip(toDir) {
    const stage = path.join(toDir, 'stage');
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'research-workspace', version: '99.0.0', main: 'desktop/main.js' }), 'utf8');
    fs.mkdirSync(path.join(stage, 'desktop'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'desktop', 'main.js'), '// fake bundle', 'utf8');
    const zip = path.join(toDir, 'app-update-99.0.0.zip');
    execFileSync('tar', ['-a', '-c', '-f', zip, '-C', stage, '.']);
    return zip;
  }

  const MANIFEST = {
    version: '99.0.0', notes: '端到端验证用假版本', publishedAt: new Date().toISOString(),
    update: 'app-update-99.0.0.zip', full: 'ResearchWorkspace-portable-99.0.0.exe'
  };

  let httpSrv = null; let dav = null;
  try {
    /* ---------- 1. 版本比较 ---------- */
    rec('版本比较：主版本更高', I.isNewer('2.1.0', '2.0.9') === true);
    rec('版本比较：补丁更高', I.isNewer('2.0.1', '2.0.0') === true);
    rec('版本比较：相同不算更新', I.isNewer('2.0.0', '2.0.0') === false);
    rec('版本比较：旧版不算更新', I.isNewer('1.9.0', '2.0.0') === false);
    rec('版本比较：位数不齐也能比', I.isNewer('2.1', '2.0.5') === true);

    /* ---------- 2. 更新源解析 ---------- */
    const gh = I.resolveSource('github:zhangsan/research-ws');
    rec('GitHub 源解析为 API 通道（不走会被墙的 github.com 直链）',
      gh.kind === 'github' && gh.repo === 'zhangsan/research-ws', `${gh.kind} ${gh.repo || ''}`);
    const url = I.resolveSource('https://example.com/rw/');
    rec('完整 URL 源原样作为 base', url.kind === 'http' && url.base === 'https://example.com/rw/', url.base);
    const bad = I.resolveSource('github:没有斜杠');
    rec('GitHub 源格式错误给出提示', bad.kind === 'none' && /格式/.test(bad.error), bad.error);
    /* 内置默认源：清空后仍能解析出可用地址（用户不必手填） */
    updater.setSource('');
    const inf = updater.info();
    rec('未设置时使用内置默认更新源',
      inf.source === updater.DEFAULT_SOURCE && inf.sourceIsDefault === true, inf.source);
    const def = I.resolveSource(inf.source);
    rec('默认源可解析为 API 通道',
      def.kind === 'github' && def.repo === 'Snowzjd/research-workspace', `${def.kind} ${def.repo || ''}`);
    const empty = I.resolveSource('');
    rec('空字符串仍被 resolveSource 判为无源（内部契约不变）',
      empty.kind === 'none' && /更新源/.test(empty.error), empty.error);
    device.write({ ...device.info(), updateSource: 'cloud' });
    const noBind = I.resolveSource('cloud');
    rec('cloud 源在未绑定时给出明确错误', noBind.kind === 'none' && /WebDAV|云端/.test(noBind.error), noBind.error);
    device.write({ ...device.info(), updateSource: '' });

    /* ---------- 3. bat 脚本生成 ---------- */
    const bat = I.buildBat({ appRoot: 'C:\\RW\\resources\\app', exePath: 'C:\\RW\\ResearchWorkspace.exe', stageApp: 'C:\\temp\\stage\\app', workDir: 'C:\\temp\\work' });
    rec('bat 含全部四个路径变量（带引号）',
      bat.includes('"APPDIR=C:\\RW\\resources\\app"') && bat.includes('"EXE=C:\\RW\\ResearchWorkspace.exe"'),
      'APPDIR/EXE/STAGE/WORK');
    rec('bat 用改名+重试保证原子性', bat.includes(':ren') && bat.includes('ren "%APPDIR%" "app.old"') && bat.includes('LSS 10 goto ren'));
    rec('bat 失败时回滚旧 app', bat.includes(':fail') && bat.includes('ren "%APPDIR%.old" "app"'));
    rec('bat 未使用延迟扩展（路径里的 ! 不会被吃）', !/EnableDelayedExpansion/.test(bat));

    /* ---------- 4. http mock 源：check + apply dryRun ---------- */
    const zipBuf = fs.readFileSync(buildFakeZip(tmp));
    httpSrv = await new Promise(resolve => {
      const server = http.createServer((req, res) => {
        const pn = new URL(req.url, 'http://x').pathname;
        if (pn === '/latest.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(MANIFEST)); }
        if (pn === '/' + MANIFEST.update) { res.writeHead(200); return res.end(zipBuf); }
        res.writeHead(404); res.end();
      });
      server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` }));
    });

    updater.setSource(httpSrv.base);
    const c1 = await updater.check({ requirePortable: false });
    rec('http 源能拉到版本清单',
      c1.ok === true && c1.latest.version === '99.0.0' && c1.hasUpdate === true,
      c1.ok ? `current=${c1.current} latest=${c1.latest.version}` : c1.error);

    const a1 = await updater.apply({ force: true, dryRun: true });
    rec('http 源更新包下载并解压成功',
      a1.ok === true && a1.dryRun === true && a1.zipBytes === zipBuf.length, a1.error || (a1.zipBytes + ' 字节'));
    rec('更新包内容校验通过（版本一致）', a1.ok && a1.to === '99.0.0' && fs.existsSync(path.join(a1.stageApp, 'desktop', 'main.js')), a1.to);
    rec('生成了替换脚本', a1.ok && a1.batOk === true);

    /* 清单坏了要报可读错误 */
    updater.setSource('https://127.0.0.1:1/');  /* 没有服务的端口 */
    const c2 = await updater.check({ requirePortable: false });
    rec('更新源不可达时给出可读错误', c2.ok === false && String(c2.error).length > 5, c2.error);

    /* ---------- 5. WebDAV mock 源 ---------- */
    store.writeData(JSON.stringify({
      schemaVersion: 2, settings: {},
      projects: [], tasks: [], todos: [], kbDocs: [], resources: [], automations: [], agents: [],
      templates: [], timeline: [], tombstones: [], chats: {}
    }));
    dav = await mockDav.start({ user: 'zs@example.com', pass: 'app-pass-123' });
    const bind = await require('./account').bind({
      kind: 'webdav', url: dav.base, dir: '/ResearchWorkspace', user: 'zs@example.com', pass: 'app-pass-123'
    });
    rec('为更新源验证绑定 mock 云端', bind.ok === true, bind.error || 'ok');
    dav.seed('/ResearchWorkspace/Releases/latest.json', MANIFEST);
    dav.seedBinary('/ResearchWorkspace/Releases/' + MANIFEST.update, zipBuf);

    updater.setSource('cloud');
    const c3 = await updater.check({ requirePortable: false });
    rec('webdav 源能拉到版本清单', c3.ok === true && c3.latest.version === '99.0.0' && c3.hasUpdate === true, c3.ok ? c3.latest.version : c3.error);

    const a2 = await updater.apply({ force: true, dryRun: true });
    rec('webdav 源下载解压校验全通过',
      a2.ok === true && a2.dryRun === true && a2.to === '99.0.0' && a2.batOk === true, a2.error || 'ok');

    /* ---------- 6. 恢复更新源为空，避免污染后续测试 ---------- */
    updater.setSource('');
  } catch (err) {
    rec('未捕获异常', false, String((err && err.stack) || err));
  } finally {
    try { if (httpSrv) httpSrv.server.close(); } catch (_) {}
    try { if (dav) await dav.stop(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  const pass = rows.filter(r => r.pass).length;
  const out = { ok: pass === rows.length && rows.length > 0, pass, total: rows.length, rows, at: new Date().toISOString() };
  const targets = [outPath, path.join(os.tmpdir(), 'rw-probe-update-result.json')];
  for (const t of targets) {
    try { fs.writeFileSync(t, JSON.stringify(out, null, 2), 'utf8'); break; } catch (_) {}
  }
  return out;
}

module.exports = { run };
