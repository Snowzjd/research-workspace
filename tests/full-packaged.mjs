import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [mode, candidateArgument, outputArgument, codexFixture] = process.argv.slice(2);
if (!['fixture', 'live', 'codex'].includes(mode) || !candidateArgument || !outputArgument || (mode === 'codex' && !codexFixture)) {
  throw new Error('Usage: node tests/full-packaged.mjs fixture|live|codex <candidate-dir> <evidence-dir> [codex-fixture.json]');
}
const candidate = fs.realpathSync.native(candidateArgument);
const output = path.resolve(outputArgument);
const exe = path.join(candidate, 'ResearchWorkspace.exe');
const profile = path.join(candidate, 'candidate-user-data');
const workspace = path.join(profile, 'workspace-data.json');
const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const debug = 17326;
fs.mkdirSync(output, { recursive: true });

let passes = 0;
async function check(name, action) {
  await action();
  console.log('PASS ' + name);
  passes++;
}

async function until(action, description, timeout = 25000, beforePoll = () => {}) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    beforePoll();
    try {
      const result = await action();
      if (result) return result;
    } catch (caught) { error = caught; }
    await wait(250);
  }
  throw new Error('Timed out: ' + description + (error ? ' (' + error.message + ')' : ''));
}

class DevTools {
  static async connect(checkLaunch) {
    const endpoint = 'http://127.0.0.1:' + debug + '/json/list';
    const page = await until(async () => {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1200) });
      const pages = await response.json();
      return pages.find(row => row.type === 'page' && /\/resources\/app\/index\.html(?:[#?]|$)/.test(row.url));
    }, 'packaged window', 25000, checkLaunch);
    const devtools = new DevTools(page.webSocketDebuggerUrl);
    await devtools.ready;
    return devtools;
  }

  constructor(url) {
    this.socket = new WebSocket(url);
    this.requests = new Map();
    this.next = 1;
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      this.requests.get(message.id)?.(message);
    });
  }

  async request(method, params = {}) {
    const id = this.next++;
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        this.requests.set(id, resolve);
        timer = setTimeout(() => reject(new Error(method + ' timed out')), 12000);
        this.socket.send(JSON.stringify({ id, method, params }));
      });
      if (response.error) throw new Error(method + ' failed: ' + response.error.message);
      return response.result;
    } finally {
      clearTimeout(timer);
      this.requests.delete(id);
    }
  }

  async evaluate(expression) {
    const result = await this.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description?.split('\n')[0] || 'Renderer exception');
    return result.result.value;
  }

  async screenshot(name) {
    const result = await this.request('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = path.join(output, name + '.png');
    const bytes = Buffer.from(result.data, 'base64');
    assert.ok(bytes.length > 10000, 'screenshot should contain a rendered window');
    fs.writeFileSync(file, bytes);
    console.log('PNG ' + file);
  }
}

const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
let fixture, lines, metadata, electron, devtools;
try {
  if (mode === 'fixture') {
    fixture = spawn('python', [
      '-X', 'utf8', '-B', path.join(source, 'tests', 'full-fixture-session.py'), output,
      'F:/ai/codex/skills/research-project-manager', workspace
    ], { cwd: source, env, shell: false, windowsHide: true });
    fixture.stdin.on('error', () => {});
    fixture.stderr.pipe(process.stderr);
    lines = createInterface({ input: fixture.stdout })[Symbol.asyncIterator]();
    const first = await lines.next();
    assert.equal(first.done, false, 'fixture session starts');
    metadata = JSON.parse(first.value);
    env.RPM_SETTINGS = metadata.settings;
  } else if (mode === 'codex') {
    metadata = JSON.parse(fs.readFileSync(codexFixture, 'utf8'));
    assert.equal(fs.existsSync(workspace), false, 'Codex native acceptance uses a clean profile');
    assert.ok(process.env.RESEARCH_WORKSPACE_QA_CODEX);
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(workspace, JSON.stringify(metadata.workspace));
    env.RPM_SETTINGS = metadata.settings;
  } else {
    assert.equal(fs.existsSync(workspace), false, 'live run starts with clean candidate data');
    delete env.RPM_SETTINGS;
  }
  let launchTime;
  function launch() {
    launchTime = Date.now();
    return spawn(exe, ['--remote-debugging-port=' + debug, '--remote-debugging-address=127.0.0.1'], {
      cwd: candidate, env, shell: false, stdio: ['ignore', 'ignore', 'ignore']
    });
  }
  electron = launch();
  function checkLaunch() {
    const log = path.join(profile, 'startup.log');
    if (fs.existsSync(log) && fs.statSync(log).mtimeMs >= launchTime) {
      const exited = fs.readFileSync(log, 'utf8').match(/render-process-gone: (\{[^\n]+\})/);
      if (exited) throw new Error('Packaged renderer failed during native launch ' + exited[1]);
    }
    if (electron.exitCode !== null) throw new Error('Packaged process exited before renderer ready: ' + electron.exitCode);
  }
  devtools = await DevTools.connect(checkLaunch);
  const evaluate = expression => devtools.evaluate(expression);
  const asset = selector => 'document.querySelector(' + JSON.stringify(selector) + ')';
  const click = async (selector, timeout) => {
    const ready = await until(() => evaluate('!!' + asset(selector)), selector, timeout);
    assert.ok(ready);
    await evaluate(asset(selector) + '.click()');
  };
  const call = (method, args) => evaluate('window.workspace.full.' + method + '(' + JSON.stringify(args) + ')');
  const graph = () => evaluate('window.KnowledgeNetwork?.status?.()');
  const runTool = (tool, args = {}) => evaluate('window.__RW_API__(' + JSON.stringify({ tool, args, client: 'synthetic acceptance' }) + ')');
  const workspaceHealth = () => fetch('http://127.0.0.1:17400/api/health', { signal: AbortSignal.timeout(1500) }).then(r => r.json());

  await check('direct packaged launch, strict port, sandbox bridge, no demo entry', async () => {
    await until(() => evaluate('window.workspace?.full?.enabled && typeof window.__RW_API__ === "function"'), 'candidate bridge', 25000, checkLaunch);
    const status = await call('status');
    assert.equal(status.apiPort, 17400);
    assert.equal(status.apiReady, true);
    const health = await until(() => workspaceHealth().then(row => row.windowReady && row), 'candidate health');
    assert.equal(health.version, '4.0.0-rc.1');
    assert.equal(health.port, 17400);
    assert.equal(await evaluate('typeof require === "undefined" && !window.workspace.openPath && !window.workspace.launchApp && !window.workspace.ragReindex && !window.workspace.webview'), true);
    assert.equal(await evaluate('document.querySelector("meta[http-equiv=Content-Security-Policy]").content.includes("connect-src")'), true);
    assert.equal(fs.existsSync(path.join(candidate, 'resources', 'app', 'demo.html')), false);
    assert.equal(fs.existsSync(path.join(profile, 'device.json')), false);
    const dataPath = await evaluate('window.workspace.dataFilePath()');
    assert.equal(path.normalize(dataPath).toLowerCase(), workspace.toLowerCase());
  });

  if (mode === 'codex') {
    const codex = (method, args) => call('codex.' + method, args);
    const projectId = 'fixture-estuary';
    let inbound;
    async function openTask(taskId) {
      await click('.fw-nav [data-route="dashboard"]');
      await click('[data-full="task"][value="' + taskId + '"]');
    }
    const clipboardText = () => execFileSync('powershell.exe', ['-NoProfile', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Write((Get-Clipboard -Raw))'], { encoding: 'utf8' });
    const sessionOption = sessionId => '[data-full="codex-bind"][value="' + sessionId + '"]';
    async function bindSession(sessionId) {
      await click(sessionOption(sessionId), 45000);
      await until(() => evaluate('!!document.querySelector("[data-fw-codex-task] [data-fw-codex-run]")'), 'bound native execution');
      await click('[data-fw-codex-task] [data-fw-codex-run] summary');
    }
    async function fixtureTurn(prompt, resumeSession, onEvent = () => {}) {
      const flags = [
        'exec', '--ignore-user-config', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'respect_system_proxy',
        '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', metadata.root
      ];
      const command = resumeSession ? [...flags, 'resume', '--json', resumeSession, '-'] : [...flags, '--json', '-'];
      const runner = spawn(process.env.RESEARCH_WORKSPACE_QA_CODEX, command,
        { cwd: metadata.root, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const rows = [];
      let pending = '';
      runner.stdout.setEncoding('utf8').on('data', chunk => {
        const lines = (pending + chunk).split('\n');
        pending = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const row = JSON.parse(line);
          rows.push(row);
          onEvent(row);
        }
      });
      runner.stdin.on('error', () => {});
      runner.stdin.end(prompt);
      const timer = setTimeout(() => runner.kill(), 80000);
      try {
        const [exit] = await once(runner, 'close');
        assert.equal(exit, 0, 'Codex completed the synthetic read-only interaction');
      } finally { clearTimeout(timer); }
      assert.ok(rows.some(row => row.type === 'turn.completed'));
      return rows;
    }
    await check('real Codex CLI session discovery and task binding in Electron', async () => {
      assert.equal((await codex('discover', { projectId: 'fixture-unbound' })).ok, false);
      await click('.fw-nav [data-route="dashboard"]');
      await until(() => evaluate('!!document.querySelector("[data-fw-codex-summary]:not([hidden])")'), 'dashboard signals pending Codex sessions', 45000);
      await openTask('fixture-codex-in');
      await bindSession(metadata.inboundSession);
      const records = await codex('list', { projectId, taskId: 'fixture-codex-in' });
      inbound = records.runs.find(run => run.sessionId === metadata.inboundSession);
      assert.ok(inbound?.events.length, 'structured Codex records are present');
      assert.equal(await evaluate('DB.tasks.find(row=>row.id==="fixture-codex-in").st'), 'review');
      if (metadata.inboundFile) {
        assert.equal(inbound.directory, metadata.inboundDirectory);
        assert.ok(inbound.files.some(file => file.path === metadata.inboundFile && file.kind === 'added' && file.present));
        assert.ok(inbound.checks.some(check => check.exitCode === 0));
        assert.match(fs.readFileSync(path.join(metadata.root, metadata.inboundFile), 'utf8'), /0\.14/);
      } else {
        assert.equal(inbound.files.length, 0, 'a refused write must not appear as a generated file');
        assert.equal(inbound.checks.length, 0, 'a refused command has no verified exit code');
      }
      await devtools.screenshot('01-codex-inbound');
      await click('[data-full="close-dialog"]');
    });
    if (metadata.researchFileId) await check('the researcher can copy stable IDs from the actual materials and graph UI', async () => {
      await click('.fw-nav [data-route="materials"]');
      await evaluate(`(() => {
        const picker = document.querySelector('#fw-material-project');
        picker.value = 'fixture-estuary';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await click('[data-full="material"][value="fixture-estuary:' + metadata.researchFileId + '"]');
      await click('[data-full="material-copy-id"]');
      await until(() => clipboardText() === metadata.researchFileId, 'copied indexed research material ID');
      await devtools.screenshot('01b-copy-material-id');
      await click('.fw-nav [data-route="graph"]');
      const nodeId = await until(() => evaluate('window.rpmNetworkTest?.snapshot()?.nodes.find(row=>row.type==="research_question")?.id'),
        'research graph loaded');
      assert.equal(await evaluate('window.KnowledgeNetwork.focus({nodeId:' + JSON.stringify(nodeId) + '})'), true);
      await click('[data-copy-knowledge-id="' + nodeId + '"]');
      await until(() => clipboardText() === nodeId, 'copied real graph node ID');
    });
    await check('create a workbench task, copy and explicitly run its handoff, then automatically discover the Codex session', async () => {
      await click('.fw-nav [data-route="projects-center"]');
      await click('[data-full="project"][value="fixture-estuary"]');
      await click('[data-full="project-tab"][value="tasks"]');
      await click('[data-act="new-task"]');
      await evaluate(`(() => {
        const modal = document.querySelector('.modal');
        modal.querySelector('[name=t]').value = 'Codex 双向协同合成验收';
        modal.querySelector('[name=tool]').value = 'Codex';
        modal.querySelector('[name=description]').value = '仅回复 HANDOFF_OK。禁止运行命令和修改文件。';
        modal.querySelector('[name=acceptance]').value = '产生可关联的真实 Codex 回合。';
      })()`);
      await click('[data-act="task-create"]');
      const task = await until(() => evaluate('DB.tasks.find(row=>row.t==="Codex 双向协同合成验收")'), 'created task');
      assert.ok(task.id && task.p === projectId);
      await until(() => {
        const db = JSON.parse(fs.readFileSync(workspace, 'utf8'));
        return db.tasks.find(row => row.id === task.id);
      }, 'task persisted');
      await openTask(task.id);
      await click('[data-full="codex-handoff"]');
      await until(() => evaluate('document.querySelector("[data-fw-codex-status]").textContent.includes("已复制")'), 'copy handoff');
      const handoff = clipboardText();
      assert.ok(handoff.includes(task.id) && handoff.includes('HANDOFF_OK') && handoff.includes(metadata.root));
      let settleStarted;
      const rows = await fixtureTurn(handoff, undefined, row => {
        if (row.type === 'turn.completed') settleStarted = Date.now();
      });
      const sessionId = rows.find(row => row.type === 'thread.started')?.thread_id;
      assert.ok(sessionId && sessionId !== metadata.inboundSession);
      await until(() => evaluate('!!' + asset(sessionOption(sessionId))), 'automatic pending session', 12000);
      const discoveredMs = Date.now() - settleStarted;
      assert.ok(discoveredMs < 12000);
      console.log('TIMING automatic pending after completed event: ' + discoveredMs + ' ms');
      await bindSession(sessionId);
      const current = await codex('list', { projectId, taskId: task.id });
      assert.equal(current.runs[0]?.sessionId, sessionId);
      assert.equal(await evaluate('DB.tasks.find(row=>row.id===' + JSON.stringify(task.id) + ').st'), task.st);
      await devtools.screenshot('02-codex-handoff');
      await check('a real resumed Codex turn updates the bound run without a manual refresh', async () => {
        const capabilities = await codex('capabilities');
        assert.equal(capabilities.notificationMode, 'filesystem-signal');
        const previous = current.runs[0];
        let finishedAt;
        await fixtureTurn('For this synthetic acceptance fixture, reply only FOLLOW_UP_OK. Do not run commands, use tools or change files.',
          sessionId, row => { if (row.type === 'turn.completed') finishedAt = Date.now(); });
        const updated = await until(async () => {
          const next = (await codex('list', { projectId, taskId: task.id })).runs[0];
          return next?.id === previous.id && next.turnId !== previous.turnId && next.status === 'completed' && next;
        }, 'automatic bound execution update', 12000);
        const updateMs = Date.now() - finishedAt;
        assert.ok(updateMs < 12000 && updated.events.length > previous.events.length);
        console.log('TIMING bound run after completed event: ' + updateMs + ' ms');
      });
      await click('[data-full="close-dialog"]');
    });
    await check('Electron restart restores both session bindings without duplicating tasks', async () => {
      const exited = once(electron, 'exit');
      await devtools.request('Browser.close').catch(() => {});
      assert.deepEqual(await Promise.race([exited, wait(8000).then(() => null)]), [0, null]);
      devtools.socket.close();
      electron = launch();
      devtools = await DevTools.connect(checkLaunch);
      await until(() => devtools.evaluate('window.workspace?.full?.codex && typeof DB === "object"'), 'restarted workspace');
      const records = await codex('list', { projectId });
      assert.equal(records.runs.length, 2);
      assert.equal(await evaluate('DB.tasks.filter(row=>row.t==="Codex 双向协同合成验收").length'), 1);
      assert.equal(records.runs.find(run => run.sessionId === metadata.inboundSession).id, inbound.id);
      await click('.fw-nav [data-route="dashboard"]');
      await until(() => evaluate('document.querySelectorAll("[data-fw-codex-run]").length === 2'), 'dashboard hydrated');
      await devtools.screenshot('03-codex-dashboard');
    });
  } else {
  await check('real RPM graph is initial route, revisions are available', async () => {
    const status = await until(() => graph().then(row => row?.revision && !row.loading && row), 'RPM graph revision');
    assert.ok(status.projects >= (mode === 'fixture' ? 2 : 1));
    assert.ok(status.nodes > 0 && status.edges > 0);
    console.log(JSON.stringify({ projects: status.projects, nodes: status.nodes, edges: status.edges, complete: status.registry_complete }));
    await devtools.screenshot(mode === 'live' ? '01-real-rpm-graph' : '01-fixture-graph');
  });

  if (mode === 'live') {
    await check('live graph retains the official RPM ID with metadata-only access', async () => {
      const result = await evaluate(`(async () => {
        const data = await window.workspace.rpmKnowledgeSnapshot({projectId:"d72165400fae48eb9466e8151cdd15e3"});
        return { ok: data.ok, projectId: data.projects?.[0]?.id, fileId: data.files?.[0]?.id };
      })()`);
      assert.equal(result.ok, true);
      assert.ok(result.fileId);
      const opened = await evaluate('window.workspace.rpmKnowledgeOpenFile(' +
        JSON.stringify(result.projectId) + ',' + JSON.stringify(result.fileId) + ')');
      assert.equal(opened.opened, false);
      assert.equal(await evaluate('DB.projects.length === 0 && DB.tasks.length === 0'), true);
    });
  } else {
    await check('actual force-directed canvas has many-to-many relationships', async () => {
      const layout = await evaluate(`(() => {
        const test = window.rpmNetworkTest;
        const snapshot = test.snapshot();
        const shared = snapshot.nodes.find(node => node.project_ids?.length > 1);
        const edges = snapshot.edges.filter(edge => edge.source === shared?.id || edge.target === shared?.id);
        const connected = new Set(edges.flatMap(edge => edge.project_ids));
        const positions = test.cy.nodes().map(node => node.position());
        return { shared: !!shared, connected: connected.size, edges: edges.length,
          positions: new Set(positions.map(p => Math.round(p.x) + ':' + Math.round(p.y))).size };
      })()`);
      assert.ok(layout.shared && layout.connected >= 2 && layout.edges >= 2 && layout.positions >= 4);
      assert.equal(await evaluate('!!document.querySelector("#knowledge-network-pane canvas")'), true);
    });

    await check('native graph controls zoom, filter, search and focus a node', async () => {
      const pane = '#knowledge-network-pane ';
      const initial = await evaluate('window.rpmNetworkTest.cy.zoom()');
      await click(pane + '#zoom-in');
      assert.ok(await evaluate('window.rpmNetworkTest.cy.zoom()') > initial);
      const counts = await evaluate(`(() => {
        const selector = document.querySelector('#knowledge-network-pane #global-filter');
        const before = window.rpmNetworkTest.cy.nodes().length;
        selector.value = selector.options[1].value;
        selector.dispatchEvent(new Event('change', { bubbles:true }));
        return { before, after: window.rpmNetworkTest.cy.nodes().length };
      })()`);
      assert.ok(counts.after > 0 && counts.after < counts.before);
      await click(pane + '#clear-filters');
      const selection = await evaluate(`(() => {
        const test = window.rpmNetworkTest;
        const node = test.snapshot().nodes.find(row => row.project_ids?.length > 1);
        const field = document.querySelector('#knowledge-network-pane #search');
        field.value = node.title;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#knowledge-network-pane #search-results button').click();
        return { expected: node.id, actual: test.state.selected,
          detail: document.querySelector('#knowledge-network-pane #detail').innerText };
      })()`);
      assert.equal(selection.actual, selection.expected);
      assert.ok(selection.detail.length > 10);
      await devtools.screenshot('02a-fixture-graph-selection');
      const position = await evaluate(`(() => {
        const test = window.rpmNetworkTest;
        const graph = document.querySelector('#knowledge-network-pane #graph');
        const rect = graph.getBoundingClientRect();
        const node = test.cy.nodes().toArray().find(row => {
          const point = row.renderedPosition();
          return row.grabbable() && point.x > 40 && point.y > 35 &&
            point.x + 55 < rect.width && point.y + 50 < rect.height &&
            graph.contains(document.elementFromPoint(rect.left + point.x, rect.top + point.y));
        });
        if (!node) return null;
        const rendered = node.renderedPosition();
        return { id: node.id(), x: rect.left + rendered.x, y: rect.top + rendered.y, before: node.position() };
      })()`);
      assert.ok(position, 'a draggable node is visible');
      const { x, y } = position;
      await devtools.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await devtools.request('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (const offset of [8, 18, 30, 42]) {
        await devtools.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + offset, y: y + offset / 2, buttons: 1 });
      }
      await devtools.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 42, y: y + 21, button: 'left', clickCount: 1 });
      const after = await evaluate('window.rpmNetworkTest.cy.getElementById(' + JSON.stringify(position.id) + ').position()');
      assert.ok(Math.hypot(after.x - position.before.x, after.y - position.before.y) > 10, 'drag changes a node position');
    });

    await check('packaged graph refreshes after a real RPM revision and keeps stable IDs', async () => {
      const before = await graph();
      const oldIds = await evaluate('window.rpmNetworkTest.snapshot().nodes.map(node=>node.id)');
      fixture.stdin.write('advance\n');
      assert.equal((await lines.next()).value, 'updated');
      await click('#knowledge-network-pane #refresh');
      const current = await until(() => graph().then(row => row?.revision !== before.revision && !row?.loading && row), 'updated graph');
      assert.ok(current.nodes > before.nodes);
      const newIds = await evaluate('window.rpmNetworkTest.snapshot().nodes.map(node=>node.id)');
      assert.ok(oldIds.filter(id => newIds.includes(id)).length >= oldIds.length - 2);
      await devtools.screenshot('02-fixture-graph-refreshed');
    });
  }

  const navigate = async route => {
    await evaluate('location.hash=' + JSON.stringify(route));
    await until(() => evaluate('state.route===' + JSON.stringify(route)), route);
    await wait(350);
  };
  const pages = ['dashboard', 'projects-center', 'notes', 'materials', 'activity'];
  for (const [index, route] of pages.entries()) {
    await check('page ' + route + ' renders in the actual candidate', async () => {
      await navigate(route);
      assert.equal(await evaluate('document.getElementById("view").innerText.trim().length > 15'), true);
      if (mode === 'fixture' || route !== 'notes') await devtools.screenshot(String(index + 3).padStart(2, '0') + '-' + mode + '-' + route);
    });
  }

  if (mode === 'fixture') {
    await check('mature project and task API preserves IDs, stage and workbench-only task authority', async () => {
      const taskList = await runTool('list_tasks', { project: 'fixture-estuary' });
      assert.equal(taskList.tasks[0].task_id, 'fixture-task');
      const stage = await runTool('update_project', { project: 'fixture-estuary',
        stage: '候选验收复核阶段', nodes: [{ l: '合成记录归档', s: 'done' }, { l: '候选验收复核阶段', s: 'current' }] });
      assert.equal(stage.ok, true);
      const save = await evaluate('flushSave()');
      assert.equal(save.ok, true);
      const saved = JSON.parse(fs.readFileSync(workspace, 'utf8'));
      assert.equal(saved.projects.find(item => item.id === 'fixture-estuary').stage, '候选验收复核阶段');
      assert.equal(saved.projects.find(item => item.id === 'fixture-estuary').nodes[0].l, '合成记录归档');
      assert.equal(saved.tasks.filter(task => task.id === 'fixture-task').length, 1);
    });

    await check('native dashboard review opens its task and saves its status', async () => {
      await navigate('dashboard');
      await click('[data-full="task"][value="fixture-task"]');
      assert.equal(await evaluate('document.querySelector("#fw-edit-task-status").value'), 'review');
      await click('[data-full="task-materials"]');
      await until(() => evaluate('state.route === "materials" && !document.querySelector("#fw-dialog[open]")'), 'task to materials closes its modal');
      const fileRow = `[...document.querySelectorAll('#fw-material-list [data-full="material"]')]
        .find(row => row.innerText.includes(${JSON.stringify(metadata.relative.split('/').at(-1))}))`;
      await until(() => evaluate('!!(' + fileRow + ')'), 'task project evidence');
      await evaluate(fileRow + '.click()');
      await click('[data-full="material-note"]');
      await until(() => evaluate('state.route === "notes" && !!document.querySelector("#fw-note-editor")'), 'evidence note');
      await click('.fw-nav [data-route="dashboard"]');
      await click('[data-full="task"][value="fixture-task"]');
      assert.equal(await evaluate('document.querySelector("#fw-edit-task-status").value'), 'review');
      await evaluate(`(() => {
        const status = document.querySelector('#fw-edit-task-status');
        status.value = 'done';
        status.dispatchEvent(new Event('change', { bubbles:true }));
      })()`);
      await until(() => JSON.parse(fs.readFileSync(workspace, 'utf8')).tasks
        .some(task => task.id === 'fixture-task' && task.st === 'done'), 'task status saved on disk');
      await click('[data-full="close-dialog"]');
    });

    await check('packaged Markdown original read, watcher, conflict, save and restore', async () => {
      const note = { projectId: 'fixture-estuary', path: metadata.relative };
      const start = await call('markdown.read', note);
      assert.equal(start.ok, true);
      await evaluate('window.fullWatchEvents=[]; window.workspace.full.markdown.onChange(event=>window.fullWatchEvents.push(event)); true');
      assert.equal((await call('markdown.watch', note)).ok, true);
      const endings = { CRLF: '\r\n', CR: '\r', LF: '\n' };
      const ending = endings[start.newline];
      assert.ok(ending, 'fixture uses a consistent line ending');
      fs.appendFileSync(metadata.original, ending + 'fixture external edit' + ending, 'utf8');
      await until(() => evaluate('window.fullWatchEvents.length > 0'), 'external change watcher');
      const conflict = await call('markdown.save', { ...note, revision: start.revision, text: 'fixture stale edit' });
      assert.equal(conflict.code, 'conflict');
      const newer = await call('markdown.read', note);
      const edit = await call('markdown.save', { ...note, revision: newer.revision, text: 'fixture saved from candidate\n' });
      assert.equal(edit.ok, true);
      assert.ok(endings[newer.newline], 'fixture uses a consistent line ending');
      assert.equal(fs.readFileSync(metadata.original, 'utf8'), 'fixture saved from candidate' + endings[newer.newline]);
      const versions = await call('markdown.versions', note);
      assert.ok(versions.versions.length);
      const restore = await call('markdown.restore', { ...note, revision: edit.revision, versionId: versions.versions[0].versionId });
      assert.equal(restore.ok, true);
      assert.match(fs.readFileSync(metadata.original, 'utf8'), /fixture external edit/);
      await call('markdown.unwatch', note);
    });

    await check('Markdown UI opens an original, renders editing controls and saves to its fixture', async () => {
      await navigate('notes');
      await evaluate(`(() => {
        const picker = document.querySelector('#fw-note-project');
        picker.value = 'fixture-estuary';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      const selectFile = '[...document.querySelectorAll(\'[data-full="note"]\')].find(button=>button.value==='+JSON.stringify(metadata.relative)+')';
      await until(() => evaluate('!!(' + selectFile + ')'), 'fixture Markdown file row');
      await evaluate(selectFile + '.click()');
      await until(() => evaluate('document.querySelector("#fw-note-editor")?.value.includes("fixture external edit")'), 'editor original text');
      await evaluate(`(() => {
        const editor = document.querySelector('#fw-note-editor');
        editor.value += '\\nUI synthetic edit';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await click('[data-full="save-note"]');
      await until(() => fs.readFileSync(metadata.original, 'utf8').includes('UI synthetic edit'), 'editor save on disk');
      await devtools.screenshot('08-fixture-markdown-edit');
    });

    await check('indexed materials and local search return source-tagged records', async () => {
      const files = await evaluate('window.workspace.rpmProjectFiles("fixture-estuary", {limit:20})');
      assert.equal(files.ok, true);
      assert.ok(files.files.some(row => row.relative_path === metadata.relative));
      const search = await call('search', { query: '合成' });
      assert.ok(search.results.some(row => row.source === 'workspace' && row.id === 'fixture-task'));
      await click('#fw-search-open');
      await evaluate(`(() => {
        document.querySelector('#fw-search-input').value = '合成';
        document.querySelector('#fw-search-form').requestSubmit();
      })()`);
      await until(() => evaluate('!!document.querySelector("#fw-search-results [data-full=search-result]")'), 'search results');
      await devtools.screenshot('09-fixture-global-search');
    });
    await check('clean Electron restart restores project, task and shared Markdown', async () => {
      const startupLog = path.join(profile, 'startup.log');
      fs.copyFileSync(startupLog, path.join(output, 'startup-first.log'));
      const exited = once(electron, 'exit');
      await devtools.request('Browser.close').catch(() => {});
      const result = await Promise.race([exited, wait(8000).then(() => null)]);
      assert.deepEqual(result, [0, null], 'Electron exits cleanly');
      devtools.socket.close();
      electron = launch();
      devtools = await DevTools.connect(checkLaunch);
      await until(() => workspaceHealth().then(row => row.windowReady), 'restarted candidate health', 25000, checkLaunch);
      const persisted = await devtools.evaluate(`(() => ({
        stage: DB.projects.find(row => row.id === 'fixture-estuary')?.stage,
        milestone: DB.projects.find(row => row.id === 'fixture-estuary')?.nodes?.[0]?.l,
        task: DB.tasks.find(row => row.id === 'fixture-task')?.st
      }))()`);
      assert.deepEqual(persisted, { stage: '候选验收复核阶段', milestone: '合成记录归档', task: 'done' });
      const note = await devtools.evaluate('window.workspace.full.markdown.read(' +
        JSON.stringify({ projectId: 'fixture-estuary', path: metadata.relative }) + ')');
      assert.equal(note.ok, true);
      assert.match(note.text, /UI synthetic edit/);
      await devtools.screenshot('10-fixture-after-restart');
      fs.copyFileSync(startupLog, path.join(output, 'startup-restart.log'));
    });
  }
  }
  console.log('SUMMARY ' + passes + ' passed, 0 failed (' + mode + ')');
} catch (error) {
  console.error(error.stack);
  console.log('SUMMARY ' + passes + ' passed, 1 failed (' + mode + ')');
  process.exitCode = 1;
} finally {
  if (devtools) {
    try { await Promise.race([devtools.request('Browser.close'), wait(1000)]); } catch (_) {}
    devtools.socket.close();
  }
  if (electron && electron.exitCode === null) {
    await Promise.race([once(electron, 'exit'), wait(3000)]);
    if (electron.exitCode === null) electron.kill();
  }
  if (fixture?.exitCode === null) {
    if (fixture.stdin.writable) fixture.stdin.end('quit\n');
    await Promise.race([once(fixture, 'exit'), wait(4000)]);
    if (fixture.exitCode === null) fixture.kill();
  }
}
