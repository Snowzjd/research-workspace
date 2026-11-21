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
    return await withTimeout(win.webContents.executeJavaScript(js), timeoutMs || 15000, label);
  } catch (err) {
    const message = String((err && err.message) || err);
    logs.push({ level: 'eval', label, message });
    return { __error: message };
  }
}

async function capture(win, out, label, logs) {
  win.showInactive();
  win.webContents.invalidate();
  await delay(700);
  const img = await withTimeout(win.webContents.capturePage(), 15000, 'capture ' + label);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  const info = await evalSafe(win, `(() => {
    const status = (window.KnowledgeNetwork && KnowledgeNetwork.status) ? KnowledgeNetwork.status() : {};
    const test = window.rpmNetworkTest || {};
    const state = test.state || {};
    return {
      label: ${JSON.stringify(label)},
      view: state.view || null,
      selected: state.selected || null,
      project: state.project || null,
      status,
      head: (document.querySelector('#knowledge-network-pane #title') && document.querySelector('#knowledge-network-pane #title').textContent) || '',
      subtitle: (document.querySelector('#knowledge-network-pane #subtitle') && document.querySelector('#knowledge-network-pane #subtitle').textContent) || '',
      detail: ((document.querySelector('#knowledge-network-pane #detail') && document.querySelector('#knowledge-network-pane #detail').innerText) || '').slice(0, 800)
    };
  })()`, logs, 'info-' + label, 12000);
  return { file: out, size: fs.statSync(out).size, info };
}

async function waitForSnapshot(win, logs, timeoutMs) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await evalSafe(win, `(() => {
      const status = (window.KnowledgeNetwork && KnowledgeNetwork.status) ? KnowledgeNetwork.status() : {};
      return status;
    })()`, logs, 'wait-status', 12000);
    if (last && last.__error) return last;
    if (last && last.revision && !last.loading) return last;
    if (last && last.error && !last.loading && !last.revision) return last;
    await delay(500);
  }
  return last;
}

async function run({ ROOT, outDir }) {
  const logs = [];
  fs.mkdirSync(outDir, { recursive: true });
  progress(outDir, 'run start');
  const win = new BrowserWindow({
    width: 1440, height: 900, show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true,
      backgroundThrottling: false
    }
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    logs.push({ level, message, line, sourceId });
    progress(outDir, 'console[' + level + '] ' + String(message).slice(0, 400));
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logs.push({ level: 'fail-load', message: desc, code, url });
    progress(outDir, 'fail-load ' + desc);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logs.push({ level: 'gone', message: JSON.stringify(details) });
    progress(outDir, 'renderer gone ' + JSON.stringify(details));
  });
  try {
    progress(outDir, 'loadFile');
    await withTimeout(win.loadFile(path.join(ROOT, 'index.html')), 30000, 'loadFile');
    progress(outDir, 'loadFile done');
    await delay(2800);
    const probe = await evalSafe(win, '1+1', logs, 'probe', 8000);
    progress(outDir, 'probe=' + JSON.stringify(probe));
    fs.writeFileSync(path.join(outDir, 'console.json'), JSON.stringify({ probe, logs }, null, 2), 'utf8');
    if (probe !== 2) {
      try { win.destroy(); } catch (_) {}
      return { ok: false, error: 'renderer did not accept scripts', logs };
    }

    const shots = [];
    shots.push(await capture(win, path.join(outDir, 'launch.png'), 'candidate-launch', logs));
    progress(outDir, 'captured launch');

    const nav = await evalSafe(win, `(() => {
      try {
        state.kbTab = 'network';
        state.route = 'knowledge';
        if (typeof render === 'function') render();
        return { route: state.route, kbTab: state.kbTab, hasKN: typeof window.KnowledgeNetwork, mounted: !!(window.KnowledgeNetwork && KnowledgeNetwork.mounted && KnowledgeNetwork.mounted()) };
      } catch (err) {
        return { __error: String((err && err.message) || err) };
      }
    })()`, logs, 'open-network', 20000);
    progress(outDir, 'nav=' + JSON.stringify(nav));
    await delay(1000);

    const status = await waitForSnapshot(win, logs, 70000);
    progress(outDir, 'status=' + JSON.stringify(status));
    const snapshotInfo = await evalSafe(win, `(() => {
      const snap = (window.rpmNetworkTest && typeof window.rpmNetworkTest.snapshot === 'function')
        ? window.rpmNetworkTest.snapshot() : null;
      if (!snap) return { ok: false, status: (window.KnowledgeNetwork && KnowledgeNetwork.status && KnowledgeNetwork.status()) || {} };
      const knowledgeNodes = (snap.nodes || []).filter(n => !['project','source'].includes(n.type));
      const researchEdges = (snap.edges || []).filter(e => e.origin === 'research_relation');
      const fileEdges = (snap.edges || []).filter(e => e.origin === 'file_relation');
      return {
        ok: true,
        revision: snap.revision,
        registry_complete: snap.registry_complete,
        projects: (snap.projects || []).map(p => ({ id: p.id, title: p.title, root: p.root, tasks: (p.tasks || []).length, changes: (p.changes || []).length })),
        nodes: (snap.nodes || []).length,
        edges: (snap.edges || []).length,
        files: (snap.files || []).length,
        issues: (snap.issues || []).length,
        knowledge_nodes: knowledgeNodes.length,
        research_edges: researchEdges.length,
        file_edges: fileEdges.length,
        diagnostics: (snap.issues || []).length
      };
    })()`, logs, 'snapshot-info', 20000);
    progress(outDir, 'snapshotInfo=' + JSON.stringify(snapshotInfo));

    shots.push(await capture(win, path.join(outDir, 'global-network.png'), 'global-project-network', logs));
    progress(outDir, 'captured global');

    const clipCheck = await evalSafe(win, `(() => {
      const test = window.rpmNetworkTest;
      const cy = test && test.cy;
      const graph = document.querySelector('#knowledge-network-pane #graph');
      const bar = document.querySelector('.statusbar') || document.querySelector('#statusbar-slot');
      if (!cy || !graph) return { ok: false, error: 'missing cy or graph' };
      const g = graph.getBoundingClientRect();
      const s = bar ? bar.getBoundingClientRect() : null;
      const nodes = cy.nodes().map((n) => {
        const bb = n.renderedBoundingBox({ includeLabels: true });
        const top = g.top + bb.y1;
        const bottom = g.top + bb.y2;
        return {
          id: n.id(),
          type: (n.classes && n.hasClass('accent') ? 'project' : (n.hasClass('file') ? 'source' : n.data('kind'))),
          clippedGraph: bb.y1 < -1 || bb.y2 > g.height + 1 || bb.x1 < -1 || bb.x2 > g.width + 1,
          clippedStatus: !!(s && bottom > s.top + 1),
          y1: bb.y1, y2: bb.y2, graphHeight: g.height, statusTop: s && s.top, bottom, graphBottom: g.bottom
        };
      });
      return {
        ok: nodes.length > 0 && nodes.every((n) => !n.clippedGraph && !n.clippedStatus),
        nodeCount: nodes.length,
        graph: { width: g.width, height: g.height, top: g.top, bottom: g.bottom },
        statusTop: s && s.top,
        nodes
      };
    })()`, logs, 'clip-check', 12000);
    progress(outDir, 'clipCheck=' + JSON.stringify(clipCheck));

    const beforeCam = await evalSafe(win, `(() => {
      const test = window.rpmNetworkTest;
      return (test && test.camera) ? test.camera() : null;
    })()`, logs, 'camera-before', 8000);
    await evalSafe(win, `(() => {
      const btn = document.querySelector('#knowledge-network-pane #refresh');
      if (btn) btn.click();
      return !!(btn);
    })()`, logs, 'manual-refresh', 8000);
    await delay(2500);
    const afterRefresh = await evalSafe(win, `(() => {
      const test = window.rpmNetworkTest;
      const status = (window.KnowledgeNetwork && KnowledgeNetwork.status) ? KnowledgeNetwork.status() : {};
      return {
        status,
        camera: (test && test.camera) ? test.camera() : null,
        toast: ((document.querySelector('#knowledge-network-pane #toast') || {}).textContent) || ''
      };
    })()`, logs, 'camera-after', 12000);
    progress(outDir, 'afterRefresh=' + JSON.stringify(afterRefresh));

    await evalSafe(win, `(() => {
      const first = document.querySelector('#knowledge-network-pane .project-option');
      if (first) first.click();
      return !!(first);
    })()`, logs, 'click-project', 12000);
    await delay(1200);
    shots.push(await capture(win, path.join(outDir, 'project-network.png'), 'project-research-network', logs));
    progress(outDir, 'captured project');
    const projectClipCheck = await evalSafe(win, `(() => {
      const test = window.rpmNetworkTest;
      const cy = test && test.cy;
      const graph = document.querySelector('#knowledge-network-pane #graph');
      const bar = document.querySelector('.statusbar') || document.querySelector('#statusbar-slot');
      if (!cy || !graph) return { ok: false, error: 'missing cy or graph' };
      const g = graph.getBoundingClientRect();
      const s = bar ? bar.getBoundingClientRect() : null;
      const nodes = cy.nodes().map((n) => {
        const bb = n.renderedBoundingBox({ includeLabels: true });
        const bottom = g.top + bb.y2;
        return {
          id: n.id(),
          clippedGraph: bb.y1 < -1 || bb.y2 > g.height + 1 || bb.x1 < -1 || bb.x2 > g.width + 1,
          clippedStatus: !!(s && bottom > s.top + 1),
          y1: bb.y1, y2: bb.y2, graphHeight: g.height, statusTop: s && s.top, bottom, graphBottom: g.bottom
        };
      });
      return {
        ok: nodes.length > 0 && nodes.every((n) => !n.clippedGraph && !n.clippedStatus),
        nodeCount: nodes.length,
        graph: { width: g.width, height: g.height, top: g.top, bottom: g.bottom },
        statusTop: s && s.top,
        clipped: nodes.filter((n) => n.clippedGraph || n.clippedStatus).map((n) => n.id)
      };
    })()`, logs, 'clip-check-project', 12000);
    progress(outDir, 'projectClipCheck=' + JSON.stringify(projectClipCheck));

    await evalSafe(win, `(() => {
      const test = window.rpmNetworkTest;
      const snap = test && test.snapshot && test.snapshot();
      const node = (snap && snap.nodes || []).find(n => n.type !== 'project' && n.type !== 'source');
      const cy = test && test.cy;
      if (node && cy && cy.getElementById(node.id).nonempty()) {
        cy.getElementById(node.id).emit('tap');
      }
      return node ? { id: node.id, type: node.type, title: node.title } : null;
    })()`, logs, 'select-node', 12000);
    await delay(800);
    shots.push(await capture(win, path.join(outDir, 'node-detail.png'), 'node-detail-and-sources', logs));
    progress(outDir, 'captured detail');

    const openFile = await evalSafe(win, `(() => {
      const btn = document.querySelector('#knowledge-network-pane button.file-open');
      if (btn) btn.click();
      return btn ? (btn.textContent || '').trim() : null;
    })()`, logs, 'open-file', 15000);
    progress(outDir, 'openFile=' + JSON.stringify(openFile));
    await delay(1500);
    shots.push(await capture(win, path.join(outDir, 'file-open.png'), 'node-detail-file-open', logs));
    progress(outDir, 'captured file-open');

    await evalSafe(win, `(() => {
      const btns = Array.from(document.querySelectorAll('#knowledge-network-pane button'));
      const trace = btns.find(b => /追溯关系/.test(b.textContent || ''));
      if (trace) trace.click();
      return !!(trace);
    })()`, logs, 'trace', 12000);
    await delay(1000);
    shots.push(await capture(win, path.join(outDir, 'relation-trace.png'), 'relation-trace', logs));
    progress(outDir, 'captured relation');

    const fileToast = await evalSafe(win, `(() => {
      const toast = document.querySelector('#knowledge-network-pane #toast');
      return (toast && toast.textContent) || '';
    })()`, logs, 'file-toast', 5000);
    progress(outDir, 'fileToast=' + JSON.stringify(fileToast));
    const summary = { ok: shots.every(s => s && s.size > 0), shots, status, snapshotInfo, nav, clipCheck, projectClipCheck, beforeCam, afterRefresh, openFile, fileToast, logs };
    fs.writeFileSync(path.join(outDir, 'console.json'), JSON.stringify({ logs }, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'shot-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    try { win.destroy(); } catch (_) {}
    progress(outDir, 'done ok=' + summary.ok);
    return summary;
  } catch (err) {
    const failure = { ok: false, error: String((err && err.message) || err), logs };
    progress(outDir, 'FAIL ' + failure.error);
    try { fs.writeFileSync(path.join(outDir, 'console.json'), JSON.stringify(failure, null, 2), 'utf8'); } catch (_) {}
    try { fs.writeFileSync(path.join(outDir, 'shot-summary.json'), JSON.stringify(failure, null, 2), 'utf8'); } catch (_) {}
    try { win.destroy(); } catch (_) {}
    return failure;
  }
}

module.exports = { run };
