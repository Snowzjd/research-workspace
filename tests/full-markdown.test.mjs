import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, link, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import markdown from '../desktop/full-markdown.js';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function setup(t) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'rw-mark-fixture-'));
  const vault = path.join(root, 'vault');
  const project = path.join(root, 'coating');
  const outside = path.join(root, 'outside');
  const backupDir = path.join(root, 'candidate', 'markdown-backups');
  const changes = [];
  const opened = [];
  await Promise.all([mkdir(vault), mkdir(project), mkdir(outside)]);
  const service = markdown.createMarkdownService({
    vaultRoot: vault, backupDir, pollIntervalMs: 75, onChange: change => changes.push(change),
    openAttachment: async filename => { opened.push(filename); return ''; },
    resolveProject: async id => ({
      coating: { root: project }, reader: { root: project, readOnly: true },
      protected: { root: project, metadataOnly: true }
    })[id]
  });
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true, maxRetries: 4 }); });
  return { service, root, vault, project, outside, changes, opened, backupDir };
}

async function until(predicate) {
  for (let attempts = 0; attempts < 40; attempts++) {
    const result = predicate();
    if (result) return result;
    await sleep(75);
  }
  assert.fail('no expected watcher event');
}

test('lists Vault and registered project originals independently without reading payloads', async t => {
  const { service, vault, project } = await setup(t);
  await mkdir(path.join(vault, '测试笔记'));
  await writeFile(path.join(vault, '测试笔记', '研究.md'), 'fixture text\n');
  await writeFile(path.join(vault, 'data.csv'), 'x\n');
  await writeFile(path.join(vault, 'credentials.md'), 'prohibited fixture\n');
  await writeFile(path.join(project, 'method.markdown'), 'project fixture\n');
  await mkdir(path.join(project, '00_Project_Management'));
  await writeFile(path.join(project, '00_Project_Management', 'TASKS.md'), 'prohibited fixture\n');
  assert.deepEqual((await service.list({ query: '研究' })).files, [{ path: '测试笔记/研究.md', name: '研究.md' }]);
  assert.deepEqual((await service.list({ directory: '测试笔记' })).files.map(row => row.name), ['研究.md']);
  assert.deepEqual((await service.list({ projectId: 'coating' })).files.map(row => row.path), ['method.markdown']);
  assert.equal((await service.read({ projectId: 'coating', path: 'method.markdown' })).text, 'project fixture\n');
  assert.equal((await service.list({ projectId: 'unknown' })).code, 'unconnected');
});

test('saves, backs up and restores exact UTF-8 BOM + CRLF bytes', async t => {
  const { service, vault, backupDir } = await setup(t);
  const note = { path: 'note.md' };
  const file = path.join(vault, note.path);
  const initial = Buffer.concat([BOM, Buffer.from('起始\r\n原始\r\n')]);
  await writeFile(file, initial);
  const read = await service.read(note);
  assert.equal(read.ok, true, read.message);
  assert.equal(read.bom, true);
  assert.equal(read.newline, 'CRLF');
  assert.equal(read.text, '起始\n原始\n');
  assert.deepEqual((await service.versions(note)).versions, []);
  const noChange = await service.save({ ...note, revision: read.revision, text: read.text });
  assert.equal(noChange.revision, read.revision);
  const saved = await service.save({ ...note, revision: read.revision, text: '起始\n更新\n' });
  assert.equal(saved.ok, true, saved.message);
  assert.notEqual(saved.revision, read.revision);
  assert.deepEqual(await readFile(file), Buffer.concat([BOM, Buffer.from('起始\r\n更新\r\n')]));
  const items = (await service.versions(note)).versions;
  assert.equal(items.length, 1);
  assert.equal(items[0].versionId, saved.backupVersionId);
  assert.equal(items[0].size, initial.length);
  assert.notEqual((await readdir(backupDir)).length, 0);
  const staleRestore = await service.restore({ ...note, revision: read.revision, versionId: items[0].versionId });
  assert.equal(staleRestore.code, 'conflict');
  const restored = await service.restore({ ...note, revision: saved.revision, versionId: items[0].versionId });
  assert.equal(restored.ok, true, restored.message);
  assert.deepEqual(await readFile(file), initial);
  assert.equal((await service.versions(note)).versions.length, 2);
  assert.deepEqual(await readdir(vault), [note.path]);
});

test('preserves LF, CR and mixed newline styles through existing tracked files', async t => {
  const { service, project } = await setup(t);
  for (const [filename, original, expected] of [
    ['lf.md', 'first\nold\nlast', 'first\nnew\nlast'],
    ['cr.md', 'first\rold\rlast', 'first\rnew\rlast'],
    ['mixed.md', 'first\r\nold\nlast\r', 'first\r\nnew\nlast\r']
  ]) {
    const target = { projectId: 'coating', path: filename };
    await writeFile(path.join(project, filename), original);
    const read = await service.read(target);
    const saved = await service.save({ ...target, revision: read.revision, text: read.text.replace('old', 'new') });
    assert.equal(saved.ok, true, saved.message);
    assert.equal(saved.bom, false);
    assert.equal(await readFile(path.join(project, filename), 'utf8'), expected);
  }
});

test('rejects stale edits and serializes simultaneous candidate saves', async t => {
  const { service, vault } = await setup(t);
  const target = { path: 'shared.md' };
  const file = path.join(vault, target.path);
  await writeFile(file, 'earlier\n');
  const earlier = await service.read(target);
  await writeFile(file, 'external edit\n');
  const stale = await service.save({ ...target, revision: earlier.revision, text: 'stale edit\n' });
  assert.equal(stale.code, 'conflict');
  const external = await service.read(target);
  assert.equal(stale.revision, external.revision);
  assert.equal(external.text, 'external edit\n');
  const pair = await Promise.all(['first\n', 'second\n'].map(text => service.save({ ...target, revision: external.revision, text })));
  assert.equal(pair.filter(row => row.ok).length, 1);
  assert.ok(pair.some(row => ['busy', 'conflict'].includes(row.code)));
  assert.equal(await readFile(file, 'utf8'), pair.find(row => row.ok).text);
});

test('watches external replacement, deletion, and reappearance and supports unwatch', async t => {
  const { service, vault, changes } = await setup(t);
  const target = { path: 'watch.md' };
  const file = path.join(vault, target.path);
  const tmp = path.join(vault, 'extern.tmp');
  await writeFile(file, 'initial\n');
  const watched = await service.watch(target);
  assert.equal(watched.ok, true, watched.message);
  await writeFile(tmp, 'replaced\n');
  await rename(tmp, file);
  const replacement = await until(() => changes.find(change => change.revision && change.revision !== watched.revision));
  assert.equal(replacement.path, target.path);
  await rm(file);
  await until(() => changes.find(change => change.code === 'not_found'));
  await writeFile(file, 'reappeared\n');
  const reappeared = await service.read(target);
  await until(() => changes.find(change => change.revision === reappeared.revision));
  assert.equal((await service.unwatch(target)).ok, true);
  const count = changes.length;
  await writeFile(file, 'after unwatch\n');
  await sleep(250);
  assert.equal(changes.length, count);
});

test('rejects traversal, special names, blocked roots, bad encoding, and readonly writes', async t => {
  const { service, project, vault } = await setup(t);
  await writeFile(path.join(project, 'original.md'), 'readonly fixture');
  await writeFile(path.join(vault, 'invalid.md'), Buffer.from([0xff, 0xfe]));
  for (const bad of ['../escape.md', 'C:\\Users\\escape.md', '\\absolute.md', 'a/../escape.md', 'a.md:stream.md',
    'AUX.md', '.obsidian/escape.md', 'credentials.md', 'foo./bar.md', '00_Project_Management/plan.md']) {
    assert.equal((await service.read({ path: bad })).code, 'unsafe_path', bad);
  }
  assert.equal((await service.read({ projectId: 'protected', path: 'original.md' })).code, 'metadata_only');
  assert.equal((await service.read({ path: 'invalid.md' })).code, 'invalid_encoding');
  const reader = { projectId: 'reader', path: 'original.md' };
  const read = await service.read(reader);
  assert.equal(read.readOnly, true);
  assert.equal((await service.save({ ...reader, revision: read.revision, text: 'change' })).code, 'read_only');
  assert.equal((await service.restore({ ...reader, revision: read.revision, versionId: 'ignored' })).code, 'read_only');
  assert.equal(await readFile(path.join(project, 'original.md'), 'utf8'), 'readonly fixture');
});

test('rejects directory junctions, hard links and symlinked backup roots', async t => {
  const { service, vault, outside, backupDir } = await setup(t);
  const file = path.join(outside, 'outside.md');
  await writeFile(file, 'external fixture\n');
  await symlink(outside, path.join(vault, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, path.join(vault, 'outside.md'), process.platform === 'win32' ? 'junction' : 'dir');
  await link(file, path.join(vault, 'hard.md'));
  assert.equal((await service.read({ path: 'outside/outside.md' })).code, 'unsafe_path');
  assert.equal((await service.read({ path: 'outside.md' })).code, 'unsafe_path');
  assert.equal((await service.read({ path: 'hard.md' })).code, 'unsafe_path');
  assert.ok(!(await service.list({})).files.some(row => row.path.startsWith('outside/')));
  await mkdir(path.dirname(backupDir));
  await symlink(outside, backupDir, process.platform === 'win32' ? 'junction' : 'dir');
  const note = { path: 'inside.md' };
  await writeFile(path.join(vault, note.path), 'inside fixture\n');
  const read = await service.read(note);
  assert.equal((await service.save({ ...note, revision: read.revision, text: 'mutated' })).code, 'unsafe_path');
  assert.equal(await readFile(path.join(vault, note.path), 'utf8'), 'inside fixture\n');
  assert.deepEqual(await readdir(outside), ['outside.md']);
});

test('rejects a linked Markdown file or reports platform link privilege', async t => {
  const { service, vault, outside } = await setup(t);
  const external = path.join(outside, 'file.md');
  await writeFile(external, 'external fixture\n');
  try { await symlink(external, path.join(vault, 'link.md'), 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.skip('Windows file symlink privilege unavailable; junction and hard-link paths tested separately');
    return;
  }
  assert.equal((await service.read({ path: 'link.md' })).code, 'unsafe_path');
  assert.deepEqual((await service.list({})).files, []);
});

function browserMarkdown() {
  const context = vm.createContext({});
  for (const script of ['../assets/vendor/markdown-it.min.js', '../assets/vendor/katex.min.js',
    '../assets/vendor/js-yaml.min.js', '../assets/js/markdown-content.js']) {
    vm.runInContext(readFileSync(new URL(script, import.meta.url), 'utf8'), context);
  }
  return context.ResearchMarkdown;
}

test('renders Obsidian-style Properties, formulae, local links and attachments offline', () => {
  const renderer = browserMarkdown();
  const note = [
    '---', '标题: 超临界换热', 'tags: [实验, 复核]', 'completed: false', '---', '', '# 研究记录',
    '内联公式 $\\alpha+\\beta$ 与 [[研究笔记#摘要|打开摘要]]。', '',
    '$$', '\\frac{a}{b}', '$$', '',
    '![图](<图像/热流 (2).png>)', '![[图像/热流 (2).png|热流图]]',
    '[相关](<同目录/标题%23有空格.md>)', '',
    '<script>discard()</script>', '', '~~~md', '[[代码中的链接]]', '~~~'
  ].join('\n');
  const html = renderer.render(note);
  assert.match(html, /<h1>研究记录<\/h1>/);
  assert.match(html, /<math[^>]*>/);
  assert.match(html, /<mfrac>/);
  assert.match(html, /data-note-embed="true"/);
  assert.match(html, /打开摘要/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /标题:|<script>/);
  const links = Array.from(renderer.links(note), ref => ref.target);
  assert.ok(links.includes('研究笔记#摘要'));
  assert.ok(links.includes('图像/热流 (2).png'));
  assert.ok(!links.includes('代码中的链接'));
  assert.deepEqual(JSON.parse(JSON.stringify(renderer.properties(note).rows)),
    [['标题', '超临界换热'], ['tags', '实验、复核'], ['completed', 'false']]);
});

test('loads links, attachment previews and backlinks from the same original Vault paths', async t => {
  const { service, vault, outside, opened } = await setup(t);
  const source = { path: '记录 & 元素/入口.md' };
  const target = '记录 & 元素/测试# 特殊符号.md';
  await mkdir(path.join(vault, '记录 & 元素'));
  await mkdir(path.join(vault, '图片 (备份)'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
  const attachment = path.join(vault, '图片 (备份)', '图形 & 1.png');
  await writeFile(attachment, png);
  await writeFile(path.join(outside, '外部图片.png'), png);
  await writeFile(path.join(vault, target), '# 实际目标');
  await writeFile(path.join(vault, '未打开的来源.md'), '这是一条 [[记录 & 元素/入口|入口]] 链接。');
  await writeFile(path.join(vault, '只是代码.md'), '```\n[[记录 & 元素/入口]]\n```');
  await writeFile(path.join(vault, source.path), [
    '![图](<../图片 (备份)/图形 & 1.png>)', '[目标](<测试%23 特殊符号.md>)',
    '![[../../outside/外部图片.png]]', '[[不存在]]'
  ].join('\n'));
  const links = browserMarkdown().links((await service.read(source)).text);
  const image = links.find(ref => ref.embedded && !ref.wiki);
  const link = links.find(ref => !ref.embedded && !ref.wiki);
  assert.deepEqual(await service.resolveLink({ ...source, ...link }), { ok: true, kind: 'note', path: target });
  const preview = await service.resolveLink({ ...source, ...image, action: 'preview' });
  assert.equal(preview.preview, 'data:image/png;base64,' + png.toString('base64'));
  assert.equal((await service.resolveLink({ ...source, ...image, action: 'open' })).opened, true);
  assert.deepEqual(opened, [attachment]);
  assert.equal((await service.resolveLink({ ...source, target: '../../outside/外部图片.png', wiki: true, action: 'open' })).code, 'not_found');
  assert.equal((await service.resolveLink({ ...source, target: '图片 (备份)/图形 & 1.png', wiki: true, action: 'open' })).code, 'unlinked_file');
  assert.deepEqual((await service.backlinks(source)).backlinks.map(row => row.path), ['未打开的来源.md']);
});

test('creates a research template in the original folder without overwriting existing files', async t => {
  const { service, project } = await setup(t);
  const target = { projectId: 'coating', path: '实验 & 复核 (续).md', template: 'research' };
  const created = await service.create(target);
  assert.equal(created.ok, true, created.message);
  const original = path.join(project, target.path);
  const text = await readFile(original, 'utf8');
  assert.match(text, /^---\ntags:/);
  assert.match(text, /观察与证据/);
  assert.equal((await service.create(target)).code, 'EEXIST');
  assert.equal((await service.create({ ...target, projectId: 'reader', path: 'blocked.md' })).code, 'read_only');
  assert.equal(await readFile(original, 'utf8'), text);
});


test('reports literal positions when identical text also appears inside code or nested Markdown', async t => {
  const { service, vault } = await setup(t);
  await writeFile(path.join(vault, 'A.md'), '# A');
  await writeFile(path.join(vault, 'evidence.md'), '> `[[A]]` then [[A]]\n> later [[A]]\n');
  const indexed = await service.references({});
  assert.deepEqual(indexed.links.map(row => [row.line, row.column]), [[1, 16], [2, 9]]);
});

test('indexes literal wikilink occurrences, preserves note identities and removes stale edges', async t => {
  const { service, project, vault } = await setup(t);
  const scope = { projectId: 'coating' };
  const original = { ...scope, path: '原始 #1.md' };
  await mkdir(path.join(project, 'x'));
  await mkdir(path.join(project, 'y'));
  await writeFile(path.join(project, original.path), '# Project\n');
  await writeFile(path.join(project, '目标.md'), '# Project target\n');
  await writeFile(path.join(project, 'x', '重复.md'), '# first\n');
  await writeFile(path.join(project, 'y', '重复.md'), '# second\n');
  await writeFile(path.join(vault, '目标.md'), '# Vault target\n');
  await writeFile(path.join(vault, '不存在.md'), '# Only in Vault\n');

  const initial = await service.references(scope);
  assert.equal(initial.ok, true);
  assert.equal(initial.links.length, 0);
  const revision = await service.read(original);
  const saved = await service.save({ ...original, revision: revision.revision, text:
    '---\ntags: [验收]\n---\n# Project\n访问 [[目标|别名]] 和 [[目标]]。\n' +
    '[[重复]] [[不存在]] `[[代码]]` ![[图片.png]] [[../../外部]]\n' +
    '\n```md\n[[代码块]]\n```\n' });
  assert.equal(saved.ok, true);
  const indexed = await service.references({ ...scope, ifRevision: initial.revision });
  assert.equal(indexed.ok, true);
  assert.notEqual(indexed.revision, initial.revision);
  const id = initial.notes.find(row => row.path === original.path).id;
  const targetId = indexed.notes.find(row => row.path === '目标.md').id;
  assert.equal(indexed.notes.find(row => row.path === original.path).id, id);
  assert.equal(indexed.links.length, 5);
  assert.deepEqual(indexed.links.slice(0, 2).map(row => [row.sourceId, row.targetId, row.line, row.column, row.status]),
    [[id, targetId, 5, 4, 'resolved'], [id, targetId, 5, 16, 'resolved']]);
  assert.equal(indexed.links[0].label, '别名');
  assert.equal(indexed.links[0].sourcePath, original.path);
  assert.equal(indexed.links[0].targetPath, '目标.md');
  assert.equal(typeof indexed.links[0].updatedAt, 'string');
  assert.ok(indexed.links.slice(2).every(row => row.targetId === null && row.targetPath === null));
  assert.deepEqual(indexed.links.slice(2).map(row => row.status), ['ambiguous', 'unresolved', 'invalid']);
  const vaultIndex = await service.references({});
  assert.equal(vaultIndex.links.length, 0);
  assert.notEqual(vaultIndex.notes.find(row => row.path === '目标.md').id, targetId);
  assert.deepEqual((await service.backlinks({ ...scope, path: '目标.md' })).backlinks.map(row => row.path), [original.path]);
  assert.equal((await service.backlinks({ path: '目标.md' })).backlinks.length, 0);

  const same = await service.references({ ...scope, ifRevision: indexed.revision });
  assert.equal(same.notModified, true);
  assert.equal(same.links, undefined);
  await writeFile(path.join(project, original.path), '修改为 [[x/重复]]\n');
  const external = await service.references({ ...scope, ifRevision: same.revision });
  assert.equal(external.links.length, 1);
  assert.equal(external.links[0].sourceId, id);
  assert.equal(external.links[0].targetPath, 'x/重复.md');
  assert.equal((await service.backlinks({ ...scope, path: '目标.md' })).backlinks.length, 0);
  await writeFile(path.join(project, '未打开.md'), '新增 [[目标]]\n');
  const unopened = await service.references(scope);
  assert.equal(unopened.links.some(row => row.sourcePath === '未打开.md' && row.targetId === targetId), true);
  await rename(path.join(project, '目标.md'), path.join(project, '已重命名.md'));
  const removed = await service.references(scope);
  assert.equal(removed.links.find(row => row.sourcePath === '未打开.md').status, 'unresolved');
  assert.equal(removed.notes.some(row => row.id === targetId), false);
  await writeFile(path.join(project, original.path), '删除唯一引用\n');
  assert.equal((await service.references(scope)).links.some(row => row.sourceId === id), false);
});

test('reference index stays read-only and omits nested registered project notes and hard links', async t => {
  const { root, project, service } = await setup(t);
  const nested = path.join(project, 'nested');
  const outside = path.join(root, 'outside', 'secret.md');
  await mkdir(nested);
  await writeFile(path.join(nested, 'duplicate.md'), 'another project');
  await writeFile(path.join(project, 'parent.md'), '[[nested/duplicate]] [[alias]]');
  await writeFile(outside, 'protected');
  await link(outside, path.join(project, 'alias.md'));
  const guarded = markdown.createMarkdownService({
    resolveProject: async id => ({
      parent: { root: project, readOnly: true, registeredRoots: [project, nested] },
      blocked: { root: project, metadataOnly: true }
    })[id]
  });
  try {
    const result = await guarded.references({ projectId: 'parent' });
    assert.equal(result.ok, true);
    assert.equal(result.partial, true);
    assert.deepEqual(result.notes.map(row => row.path), ['parent.md']);
    assert.ok(result.links.every(row => !row.targetId));
    assert.equal((await guarded.references({ projectId: 'blocked' })).code, 'metadata_only');
    assert.equal((await guarded.create({ projectId: 'parent', path: 'new.md' })).code, 'read_only');
  } finally { guarded.close(); }
});
