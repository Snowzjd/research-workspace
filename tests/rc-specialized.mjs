import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [programArg, evidenceArg, fixtureParent, rpmSkill] = process.argv.slice(2);
if (!programArg || !evidenceArg || !fixtureParent || !rpmSkill) {
  throw new Error('Usage: node tests/rc-specialized.mjs <clean-extracted-candidate> <evidence-dir> <isolated-fixture-parent> <RPM-skill-dir>');
}
const program = fs.realpathSync.native(programArg);
const evidence = path.resolve(evidenceArg);
const userData = path.join(program, 'portable-user-data');
assert.equal(fs.existsSync(userData), false, 'use a clean extracted candidate');
fs.mkdirSync(evidence, { recursive: true });
const room = fs.mkdtempSync(path.join(fs.realpathSync.native(fixtureParent), 'rpm-interface-'));
const vault = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'rw-rc-vault-'));
const debugPort = 17406;
let child, channel, passes = 0;
let fixture, note, initial;

async function until(action, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await action(); if (result) return result; } catch (error) { last = error.message; }
    await delay(125);
  }
  throw new Error(label + (last ? ': ' + last : ''));
}

class Channel {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const frame = JSON.parse(event.data);
      if (frame.method === 'Page.javascriptDialogOpening') {
        this.request('Page.handleJavaScriptDialog', { accept: this.acceptNextDialog === true }).catch(() => {});
        this.acceptNextDialog = false;
        return;
      }
      const action = this.pending.get(frame.id);
      if (!action) return;
      this.pending.delete(frame.id);
      clearTimeout(action.timer);
      if (frame.error) action.reject(new Error(frame.error.message));
      else action.resolve(frame.result);
    });
  }

  async request(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timed out: ' + method));
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const frame = await this.request('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (frame.exceptionDetails) throw new Error(frame.exceptionDetails.exception?.description || 'Renderer evaluation failed');
    return frame.result.value;
  }

  async screen(name) {
    const frame = await this.request('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const image = Buffer.from(frame.data, 'base64');
    assert.ok(image.length > 10000);
    fs.writeFileSync(path.join(evidence, name + '.png'), image);
  }
}

async function start() {
  child = spawn(path.join(program, 'ResearchWorkspace.exe'), [
    `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'
  ], { cwd: program, env: { ...process.env, RPM_SETTINGS: fixture.settings, RW_VAULT_ROOT: vault }, stdio: 'ignore' });
  const devtools = await until(async () => {
    if (child.exitCode !== null) throw new Error('Electron exited with ' + child.exitCode);
    const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1000) }).then(r => r.json());
    return pages.find(row => row.type === 'page' && /\/resources\/app\/index\.html(?:[#?]|$)/.test(row.url));
  }, 'native window unavailable');
  channel = new Channel(devtools.webSocketDebuggerUrl);
  await channel.request('Page.enable');
  await until(() => channel.eval('window.workspace?.full?.enabled'), 'candidate bridge unavailable');
  const status = await channel.eval('window.workspace.full.status()');
  assert.equal(status.apiPort, 17403);
  assert.equal(status.version, '4.0.0');
  assert.equal(status.apiReady, true);
  await until(async () => {
    const health = await fetch('http://127.0.0.1:17403/api/health', {signal: AbortSignal.timeout(1200)}).then(row => row.json());
    return health.windowReady && await channel.eval('document.readyState === "complete" && window.FullWorkspace?.enabled');
  }, 'Electron window is fully loaded');
  const profile = await channel.eval('window.workspace.dataFilePath()');
  assert.equal(path.normalize(profile).toLowerCase(), path.join(userData, 'workspace-data.json').toLowerCase(),
    'control window belongs to this isolated candidate');

}

async function close() {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    if (channel) channel.request('Browser.close').catch(() => {});
    const result = await Promise.race([exited, delay(9000).then(() => null)]);
    assert.deepEqual(result, [0, null], 'Electron exited cleanly');
  }
  channel?.socket.close();
  channel = null;
  child = null;
}

async function check(label, action) {
  await action();
  passes++;
  console.log('PASS ' + label);
}

async function route(name) {
  await channel.eval(`location.hash = ${JSON.stringify(name)}`);
  await until(() => channel.eval(`state.route === ${JSON.stringify(name)}`), name + ' route');
}

async function click(selector) {
  const target = `document.querySelector(${JSON.stringify(selector)})`;
  await until(() => channel.eval(`!!${target}`), selector);
  await channel.eval(`${target}.click()`);
}

async function openNote(notePath) {
  const button = `[...document.querySelectorAll('#fw-note-tree [data-full=note]')].find(row=>row.value===${JSON.stringify(notePath)})`;
  await until(() => channel.eval(`!!(${button})`), 'find note ' + notePath);
  await channel.eval(`(${button}).click()`);
  await until(() => channel.eval(`document.querySelector('#fw-note-properties')?.innerText.includes(${JSON.stringify(notePath)})`), 'open note ' + notePath);
}

const markdown = (method, input) => channel.eval(`window.workspace.full.markdown.${method}(${JSON.stringify(input)})`);

try {
  fixture = JSON.parse(execFileSync('python', ['-X', 'utf8', '-B', 'tests/rc-specialized-fixture.py',
    room, vault, rpmSkill], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
  note = { path: fixture.vaultNote };
  initial = fs.readFileSync(path.join(vault, note.path));
  if (process.platform === 'win32') {
    assert.notEqual(path.parse(vault).root.toLowerCase(), path.parse(fixture.projectRoot).root.toLowerCase(),
      'Vault and RPM project must occupy different actual mounted volumes');
  }
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'workspace-data.json'), JSON.stringify({
    projects: [{ id: 'rc-specialized', name: '隔离河口研究课题', rpmRoot: fixture.projectRoot, rpmProjectId: fixture.projectId }],
    tasks: []
  }));
  await start();
  await check('force-directed graph one-hop focus, two-hop expansion and relationship evidence', async () => {
    await route('graph');
    await until(() => channel.eval('window.rpmNetworkTest?.snapshot()?.nodes?.length > 0'), 'RPM graph ready');
    const result = await channel.eval(`(() => {
      const test = window.rpmNetworkTest, cy = test.cy;
      const area = document.querySelector('#knowledge-network-pane');
      const depth = area.querySelector('#depth');
      const graph = test.snapshot();
      const eligible = graph.nodes.filter(n => n.project_id === ${JSON.stringify(fixture.projectId)}
        && n.type !== 'source' && n.type !== 'project');
      for (const seed of eligible) {
        window.KnowledgeNetwork.focus({ nodeId: seed.id });
        const first = cy.nodes().map(n=>n.id());
        if (test.state.depth !== 1 || !cy.getElementById(seed.id).hasClass('focused')) continue;
        const highlight = cy.getElementById(seed.id).connectedEdges().filter('.highlight').length;
        if (!highlight) continue;
        depth.value = '2';
        depth.dispatchEvent(new Event('change', { bubbles: true }));
        const second = cy.nodes().map(n=>n.id());
        if (test.state.depth !== 2 || !second.some(n=>!first.includes(n))) continue;
        const evidence = cy.edges().toArray().find(e=>graph.edges.some(r=>r.id===e.id() && r.evidence));
        if (!evidence) continue;
        evidence.emit('tap');
        const detail = area.querySelector('#detail').innerText;
        if (!detail.includes('关系依据')) continue;
        return { focus: seed.id, first: first.length, second: second.length, highlighted: highlight, traced: evidence.id() };
      }
      return null;
    })()`);
    assert.ok(result?.traced, 'an RPM node must have verified first- and second-order relations');
    console.log(JSON.stringify(result));
    await channel.screen('supplemental-graph-two-hop');
  });
  await check('central Vault and RPM original on different drives, frontmatter, working wikilink and backlink', async () => {
    const vaultText = await markdown('read', note);
    const projectText = await markdown('read', { projectId: 'rc-specialized', path: fixture.projectNote });
    assert.ok(vaultText.ok, 'central Vault read: ' + JSON.stringify({ code: vaultText.code, message: vaultText.message }));
    assert.ok(projectText.ok, 'RPM note read: ' + JSON.stringify({ code: projectText.code, message: projectText.message }));
    assert.match(projectText.text, /两站观测方案/);
    assert.ok(vaultText.text.startsWith(fixture.yaml.replaceAll('\r\n', '\n')));
    await route('notes');
    await openNote(note.path);
    assert.match(await channel.eval('document.querySelector("#fw-note-properties").innerText'), /title\s+两相测量/);
    await click('#fw-note-properties [data-full="follow-note"][value="校准基准"]');
    await until(() => channel.eval('document.querySelector("#fw-note-properties")?.innerText.includes("校准基准.md")'), 'wikilink opens target');
    await click('#fw-note-properties [data-full="note-backlinks"]');
    await until(() => channel.eval(`[...document.querySelectorAll('#fw-note-properties [data-full=note]')].some(b=>b.value===${JSON.stringify(note.path)})`), 'opened-note backlink');
    assert.match(await channel.eval('document.querySelector("#fw-note-properties").innerText'), /反向链接/);
    await channel.screen('supplemental-vault-backlink');
  });
  await check('central Vault external replacement warns editor and preserves unsaved draft', async () => {
    await openNote(note.path);
    const opened = await markdown('read', note);
    await channel.eval(`(() => {
      const editor = document.querySelector('#fw-note-editor');
      editor.value += '\\n待合并的本地更改';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const actual = path.join(vault, note.path);
    const replacement = path.join(vault, 'external-work.tmp');
    fs.writeFileSync(replacement, Buffer.concat([initial, Buffer.from('外部修改\r\n')]));
    fs.renameSync(replacement, actual);
    await until(() => channel.eval(`Boolean(document.querySelector('#fw-note-status [data-full="compare-note"]'))`), 'watch detects external replacement');
    assert.ok(await channel.eval('document.querySelector("#fw-note-editor").value.includes("待合并的本地更改")'));
    assert.ok(await channel.eval(`document.querySelector('#fw-note-toolbar [data-full="save-note"]').disabled`));
    const refused = await markdown('save', { ...note, revision: opened.revision, text: opened.text + '过期草稿\n' });
    assert.equal(refused.code, 'conflict');
    assert.ok(fs.readFileSync(actual, 'utf8').includes('外部修改'));
    await channel.screen('supplemental-vault-conflict');
    fs.writeFileSync(actual, initial);
    channel.acceptNextDialog = true;
    await click('[data-full="reload-note"]');
    await until(() => channel.eval('!document.querySelector("#fw-note-editor").value.includes("待合并的本地更改")'), 'reload resolves isolated fixture conflict');
  });
  await check('central Vault original retains YAML and BOM/CRLF after save, restart, and restoration', async () => {
    await openNote(note.path);
    const original = await markdown('read', note);
    const edited = await markdown('save', { ...note, revision: original.revision, text: original.text + '追加合成复核\n' });
    assert.ok(edited.ok, edited.message);
    const bytes = fs.readFileSync(path.join(vault, note.path));
    assert.ok(bytes.subarray(0, initial.length).equals(initial), 'original YAML/BOM/CRLF bytes were preserved');
    assert.equal(bytes.subarray(initial.length).toString('utf8'), '追加合成复核\r\n');
    const versions = await markdown('versions', note);
    assert.equal(versions.versions[0].versionId, edited.backupVersionId);
    await close();
    await start();
    const after = await markdown('read', note);
    assert.equal(after.revision, edited.revision);
    const restored = await markdown('restore', { ...note, revision: after.revision, versionId: edited.backupVersionId });
    assert.ok(restored.ok, restored.message);
    assert.deepEqual(fs.readFileSync(path.join(vault, note.path)), initial);
  });
  await close();
  console.log(`SUPPLEMENTAL SUMMARY ${passes} passed; fixture drives ${path.parse(vault).root} / ${path.parse(room).root}`);
} finally {
  if (child && child.exitCode === null) {
    channel?.request('Browser.close').catch(() => {});
    await Promise.race([once(child, 'exit'), delay(2500)]);
    if (child.exitCode === null) child.kill();
  }
  channel?.socket.close();
}
