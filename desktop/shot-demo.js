/* Demo-data portable screenshots and review-loop check. Isolated runtime only. */
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

async function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function progress(outDir, msg) {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.appendFileSync(path.join(outDir, 'progress.log'), new Date().toISOString() + ' ' + msg + '\n', 'utf8');
  } catch (_) {}
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout ' + label + ' after ' + ms + 'ms')), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function evalSafe(win, js, logs, label, timeoutMs) {
  try {
    return await withTimeout(win.webContents.executeJavaScript(js, true), timeoutMs || 15000, label);
  } catch (err) {
    const message = String((err && err.message) || err);
    logs.push({ level: 'eval', label, message });
    return { __error: message };
  }
}

async function capture(win, out, label, logs) {
  if (!win.isDestroyed()) {
    if (!win.isVisible()) win.showInactive();
    win.webContents.invalidate();
  }
  await delay(500);
  const img = await withTimeout(win.webContents.capturePage(), 15000, 'capture ' + label);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  logs.push({ level: 'capture', label, file: out, size: fs.statSync(out).size });
  return { file: out, size: fs.statSync(out).size };
}

function clickScript(selectorOrText, opts) {
  const exact = !!(opts && opts.exact);
  const role = (opts && opts.role) || 'button';
  const sel = (opts && opts.selector) || '';
  return `(() => {
    const exact = ${JSON.stringify(exact)};
    const wanted = ${JSON.stringify(selectorOrText)};
    const selector = ${JSON.stringify(sel)};
    if (selector) {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, reason: 'missing ' + selector };
      el.click();
      return { ok: true, via: 'selector', text: (el.textContent || '').trim().slice(0, 80) };
    }
    const nodes = [...document.querySelectorAll('${role}, [role="${role}"], button, a, [data-route], [data-task], [data-material], [data-command]')];
    const el = nodes.find((n) => {
      const t = (n.getAttribute('aria-label') || n.textContent || '').replace(/\\s+/g, ' ').trim();
      return exact ? t === wanted : t.includes(wanted);
    });
    if (!el) return { ok: false, reason: 'no control for ' + wanted };
    el.click();
    return { ok: true, text: (el.textContent || '').trim().slice(0, 80) };
  })()`;
}

async function run({ ROOT, outDir, win: existing }) {
  const logs = [];
  const checks = [];
  const shots = [];
  progress(outDir, 'shot-demo start');
  fs.mkdirSync(outDir, { recursive: true });

  let win = existing;
  const created = !win;
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: true,
      autoHideMenuBar: true,
      backgroundColor: '#FFF9F5',
      title: '科研工程工作台 · 演示数据',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false
      }
    });
  }

  const demoPage = path.join(ROOT, 'demo.html');
  if (!fs.existsSync(demoPage)) {
    const err = 'missing demo.html at ' + demoPage;
    progress(outDir, err);
    fs.writeFileSync(path.join(outDir, 'shot-demo-result.json'), JSON.stringify({ ok: false, error: err }, null, 2));
    if (created && !win.isDestroyed()) win.close();
    return { ok: false, error: err };
  }

  await withTimeout(win.loadFile(demoPage), 20000, 'load demo.html');
  await delay(1200);

  const boot = await evalSafe(win, `({
    title: document.title,
    brand: (document.querySelector('.brand strong') && document.querySelector('.brand strong').textContent) || '',
    foot: (document.querySelector('.side-foot') && document.querySelector('.side-foot').innerText) || '',
    route: (typeof state !== 'undefined' && state.route) || '',
    demoPill: !!document.querySelector('.pill.mint'),
    yantai: document.documentElement.innerText.includes('砚台'),
    heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || ''
  })`, logs, 'boot');
  checks.push({ name: 'boot-demo-brand', pass: !!(boot && boot.brand && boot.brand.includes('科研工程工作台') && boot.route === 'graph' && boot.demoPill && !boot.yantai), detail: boot });

  shots.push(await capture(win, path.join(outDir, '01-launch.png'), 'launch', logs));

  await evalSafe(win, `go('dashboard'); true`, logs, 'go-dashboard');
  await delay(400);
  shots.push(await capture(win, path.join(outDir, '02-dashboard.png'), '工作总览', logs));
  const dash = await evalSafe(win, `({
    heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || '',
    hasReview: [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('复核边缘缺陷标记'))
  })`, logs, 'dash-info');
  checks.push({ name: 'dashboard', pass: !!(dash && dash.heading === '工作总览' && dash.hasReview), detail: dash });

  await evalSafe(win, clickScript('浏览项目'), logs, 'open-projects');
  await delay(300);
  await evalSafe(win, `(() => {
    const card = [...document.querySelectorAll('.project-card')].find(el => (el.textContent || '').includes('耐蚀涂层'));
    if (!card) return { ok: false };
    card.click();
    return { ok: true };
  })()`, logs, 'open-coatings');
  await delay(400);
  shots.push(await capture(win, path.join(outDir, '03-project-detail.png'), '项目详情', logs));
  const proj = await evalSafe(win, `({
    heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || '',
    tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent.trim())
  })`, logs, 'proj-info');
  checks.push({ name: 'project-detail', pass: !!(proj && String(proj.heading).includes('耐蚀涂层') && (proj.tabs || []).includes('任务')), detail: proj });

  await evalSafe(win, `go('graph'); true`, logs, 'go-graph');
  await delay(1100);
  shots.push(await capture(win, path.join(outDir, '04-graph-global.png'), '全局图谱', logs));
  const graph = await evalSafe(win, `({
    heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || '',
    count: (document.querySelector('#graph-count') && document.querySelector('#graph-count').textContent) || '',
    theme: document.documentElement.getAttribute('data-theme')
  })`, logs, 'graph-info');
  checks.push({ name: 'global-graph', pass: !!(graph && String(graph.count).includes('90') && graph.theme === 'warm'), detail: graph });
  shots.push(await capture(win, path.join(outDir, '11-palette-default.png'), '默认清新粉蓝', logs));

  await evalSafe(win, `(() => {
    if (typeof go === 'function') go('graph');
    state.graph.selected = 'tpms';
    state.graph.hops = 1;
    if (typeof render === 'function') render();
    return state.graph.selected;
  })()`, logs, 'select-tpms');
  await delay(600);
  shots.push(await capture(win, path.join(outDir, '05-graph-selected.png'), '图谱选中邻域', logs));
  const sel = await evalSafe(win, `({
    selected: state.graph.selected,
    inspector: (document.querySelector('#graph-inspector h2') && document.querySelector('#graph-inspector h2').textContent) || ''
  })`, logs, 'sel-info');
  checks.push({ name: 'graph-selected', pass: !!(sel && sel.selected === 'tpms' && String(sel.inspector).includes('TPMS')), detail: sel });

  await evalSafe(win, `go('notes', 'tp-architecture'); true`, logs, 'go-notes');
  await delay(500);
  shots.push(await capture(win, path.join(outDir, '06-notes.png'), '知识工作区', logs));
  const notes = await evalSafe(win, `({
    heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || '',
    hasPreview: !!document.querySelector('#markdown-preview')
  })`, logs, 'notes-info');
  checks.push({ name: 'notes', pass: !!(notes && notes.heading === '知识工作区' && notes.hasPreview), detail: notes });

  await evalSafe(win, `go('dashboard'); true`, logs, 'go-dash-review');
  await delay(300);
  const openReview = await evalSafe(win, clickScript('复核边缘缺陷标记', { exact: false }), logs, 'open-review-task');
  await delay(400);
  shots.push(await capture(win, path.join(outDir, '08-review-task.png'), '任务复核', logs));
  const reviewTask = await evalSafe(win, `(() => {
    const d = document.querySelector('dialog, #dialog');
    const text = (d && d.innerText) || '';
    return {
      hasConditions: text.includes('复核完成条件') || text.includes('样片编号'),
      hasSim: text.includes('Codex · 模拟') || text.includes('模拟'),
      hasPending: text.includes('C07') && text.includes('F02'),
      status: (document.querySelector('#task-state') && document.querySelector('#task-state').value) || ''
    };
  })()`, logs, 'review-task-info');
  checks.push({ name: 'review-task', pass: !!(openReview && openReview.ok && reviewTask && reviewTask.hasPending && reviewTask.status === '待复核'), detail: { openReview, reviewTask } });

  await evalSafe(win, clickScript('双评阅一致性记录', { exact: false }), logs, 'open-material');
  await delay(400);
  shots.push(await capture(win, path.join(outDir, '07-material-detail.png'), '材料详情', logs));
  const material = await evalSafe(win, `(() => {
    const d = document.querySelector('dialog, #dialog');
    const text = (d && d.innerText) || '';
    return { text: text.slice(0, 500), hasTable: !!document.querySelector('dialog table, #dialog table, .review-table') };
  })()`, logs, 'material-info');
  checks.push({ name: 'material-excerpt', pass: !!(material && /缺方向标记/.test(material.text || '') && material.hasTable), detail: material });

  await evalSafe(win, clickScript('在图谱中定位'), logs, 'locate-graph');
  await delay(700);
  const located = await evalSafe(win, `({
    route: state.route,
    inspector: (document.querySelector('#graph-inspector h2') && document.querySelector('#graph-inspector h2').textContent) || ''
  })`, logs, 'located');
  checks.push({ name: 'locate-in-graph', pass: !!(located && located.route === 'graph' && String(located.inspector).includes('双评阅一致性记录')), detail: located });

  await evalSafe(win, clickScript('失效模式判读', { exact: false }), logs, 'select-fail-mode');
  await delay(400);
  await evalSafe(win, clickScript('在知识工作区打开'), logs, 'open-criteria-note');
  await delay(500);
  const noteOpen = await evalSafe(win, `({
    route: state.route,
    heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || '',
    preview: ((document.querySelector('#markdown-preview') && document.querySelector('#markdown-preview').innerText) || '').slice(0, 400),
    noteTitle: (document.querySelector('h2, .workspace h2, #note-title') && (document.querySelector('.workspace h2, [data-note-title], #markdown-preview') ? document.body.innerText : '')).includes('边缘缺陷复核口径')
  })`, logs, 'note-open');
  const noteOk = await evalSafe(win, `({
    hasPending: ((document.querySelector('#markdown-preview') && document.querySelector('#markdown-preview').innerText) || document.body.innerText).includes('C07 / F02 缺少方向标记'),
    hasTitle: document.body.innerText.includes('边缘缺陷复核口径')
  })`, logs, 'note-pending');
  checks.push({ name: 'review-note', pass: !!(noteOk && noteOk.hasPending && noteOk.hasTitle), detail: { noteOpen, noteOk } });

  await evalSafe(win, clickScript('返回原任务'), logs, 'return-task');
  await delay(500);
  shots.push(await capture(win, path.join(outDir, '09-return-task.png'), '返回原任务', logs));
  const returned = await evalSafe(win, `(() => {
    const d = document.querySelector('dialog, #dialog');
    const text = (d && d.innerText) || '';
    return {
      route: state.route,
      heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || '',
      sameTask: text.includes('复核边缘缺陷标记'),
      status: (document.querySelector('#task-state') && document.querySelector('#task-state').value) || '',
      pending: text.includes('C07') && text.includes('F02')
    };
  })()`, logs, 'returned');
  checks.push({ name: 'return-task', pass: !!(returned && returned.heading === '工作总览' && returned.sameTask && returned.status === '待复核' && returned.pending), detail: returned });

  // Second path: project task tab restore
  await evalSafe(win, `(() => {
    const closeBtn = document.querySelector('[aria-label="关闭弹窗"], #dialog .icon-btn, dialog .icon-btn');
    if (closeBtn) closeBtn.click();
    const open = document.querySelector('button[data-route="project"][data-id="coatings"], .project-btn[data-id="coatings"]');
    if (open) { open.click(); return 'project-btn'; }
    if (typeof go === 'function') { go('project', 'coatings', '任务'); return 'go'; }
    return 'none';
  })()`, logs, 'open-project-tasks-prep');
  await delay(300);
  await evalSafe(win, clickScript('打开所属项目'), logs, 'open-project-from-task');
  await delay(300);
  await evalSafe(win, clickScript('任务', { exact: true }), logs, 'tab-tasks');
  await delay(200);
  await evalSafe(win, clickScript('复核边缘缺陷标记', { exact: false }), logs, 'reopen-review-from-project');
  await delay(300);
  await evalSafe(win, clickScript('失效模式判读', { exact: false }), logs, 'open-note-from-project-task');
  await delay(400);
  await evalSafe(win, clickScript('返回原任务'), logs, 'return-to-project-tab');
  await delay(500);
  const projectReturn = await evalSafe(win, `({
    route: state.route,
    id: state.id,
    tab: state.tab,
    heading: (document.querySelector('h1') && document.querySelector('h1').textContent) || '',
    taskTabPressed: [...document.querySelectorAll('.tab, button')].some(b => b.textContent.trim() === '任务' && (b.getAttribute('aria-pressed') === 'true' || b.classList.contains('active'))),
    sameTask: ((document.querySelector('dialog, #dialog') && document.querySelector('dialog, #dialog').innerText) || '').includes('复核边缘缺陷标记'),
    status: (document.querySelector('#task-state') && document.querySelector('#task-state').value) || ''
  })`, logs, 'project-return');
  checks.push({ name: 'return-project-tab', pass: !!(projectReturn && projectReturn.route === 'project' && projectReturn.tab === '任务' && projectReturn.sameTask && projectReturn.status === '待复核'), detail: projectReturn });

  await evalSafe(win, `(() => {
    const closeBtn = document.querySelector('[aria-label="关闭弹窗"]');
    if (closeBtn) closeBtn.click();
    const btn = document.querySelector('[data-command], button.quick');
    if (btn) { btn.click(); return true; }
    return false;
  })()`, logs, 'open-search');
  await delay(200);
  await evalSafe(win, `(() => {
    const input = document.querySelector('#command-input, input[aria-label="搜索项目、笔记、任务或材料"]');
    if (!input) return { ok: false };
    input.focus();
    input.value = '耐蚀涂层';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, count: (document.querySelector('#command-results') && document.querySelector('#command-results').innerText) || '' };
  })()`, logs, 'type-search');
  await delay(300);
  shots.push(await capture(win, path.join(outDir, '10-global-search.png'), '全局搜索', logs));
  const search = await evalSafe(win, `({
    open: !!document.querySelector('#command-input, dialog, #dialog'),
    text: ((document.querySelector('#command-results') && document.querySelector('#command-results').innerText) || (document.querySelector('dialog, #dialog') && document.querySelector('dialog, #dialog').innerText) || '').slice(0, 400)
  })`, logs, 'search-info');
  checks.push({ name: 'global-search', pass: !!(search && /耐蚀涂层/.test(search.text || '')), detail: search });

  const failed = checks.filter((c) => !c.pass);
  const result = {
    ok: failed.length === 0,
    passed: checks.filter((c) => c.pass).length,
    failed: failed.length,
    checks,
    shots: shots.map((s) => ({ file: s.file, size: s.size })),
    logs
  };
  fs.writeFileSync(path.join(outDir, 'shot-demo-result.json'), JSON.stringify(result, null, 2), 'utf8');
  progress(outDir, 'shot-demo done ok=' + result.ok + ' passed=' + result.passed + ' failed=' + result.failed);
  if (created && !win.isDestroyed()) win.close();
  return result;
}

module.exports = { run };
