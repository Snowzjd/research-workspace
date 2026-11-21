'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {createInterface} = require('node:readline');
const {createKnowledgeReader} = require('../workbench-rpm-knowledge.cjs');

const [adapterFile, skillRoot, tempParent] = process.argv.slice(2);
if (!adapterFile || !skillRoot || !tempParent) {
  throw new Error('node tests/test_stage3_transport.cjs <absolute-rpm-adapter.js> <rpm-skill-root> <existing-test-parent>');
}
const adapter = require(path.resolve(adapterFile));
const skill = path.resolve(skillRoot);
const api = path.resolve(__dirname,'../rpm_knowledge_api.py');
const wire = [
  'import sys, tempfile, json',
  'from fixture import Fixture',
  'with tempfile.TemporaryDirectory(prefix="rpm-interface-",dir=sys.argv[1]) as directory:',
  '    fixture=Fixture(directory,sys.argv[2],sys.argv[3])',
  '    fixture.seed()',
  '    print(json.dumps({"settings":str(fixture.settings),"project_id":fixture.ids["a"]}),flush=True)',
  '    if sys.stdin.readline().strip()=="advance":',
  '        fixture.update()',
  '        print("updated",flush=True)',
  '        sys.stdin.readline()',
].join('\n');

async function run() {
  const python = adapter.resolvePython({});
  const child = spawn(python, ['-X','utf8','-B','-c',wire,path.resolve(tempParent),skill,api],{
    cwd:__dirname, shell:false, windowsHide:true
  });
  child.stderr.pipe(process.stderr);
  const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
  const exited = once(child,'exit');
  const timer = setTimeout(()=>child.kill(),60000);
  try {
    const ready = await lines.next();
    assert(!ready.done,'fixture session did not start');
    const binding = JSON.parse(ready.value);
    const reader = createKnowledgeReader(adapter,{scriptPath:path.join(skill,'scripts','rpm.py'),settingsPath:binding.settings});
    const before = await reader.snapshot({projectId:binding.project_id});
    assert(before.ok,JSON.stringify(before));
    assert(before.edges.some(edge=>edge.relation_type==='规定采样间隔'));
    child.stdin.write('advance\n');
    assert.equal((await lines.next()).value,'updated');
    const after = await reader.snapshot({projectId:binding.project_id,ifRevision:before.revision});
    assert(after.ok&&!after.not_modified&&after.revision!==before.revision,JSON.stringify(after));
    assert.equal(after.projects[0].stage,'首轮样本复核');
    assert.equal(after.projects[0].tasks[0].status,'done');
    assert.equal(after.files.length,before.files.length+1);
    assert(!after.edges.some(edge=>edge.relation_type==='规定采样间隔'));
    const previous = before.edges.find(edge=>edge.relation_type==='提供实地点位');
    const revision = after.edges.find(edge=>edge.relation_type==='提供实地点位');
    assert.equal(previous.id,revision.id);
    assert.notEqual(previous.evidence,revision.evidence);
    assert.deepEqual(before.nodes.filter(n=>n.claims).map(n=>n.id).sort(),
      after.nodes.filter(n=>n.claims&&n.type!=='conclusion').map(n=>n.id).sort());
    const verified = await reader.resolveFile(binding.project_id,revision.evidence_sources[0].id);
    assert(verified.ok&&fs.statSync(verified.file.path).isFile());
    child.stdin.end('done\n');
    assert.equal((await exited)[0],0);
    console.log('PASS Stage 3 actual adapter: same-process uncached refresh, stable IDs, edge removal, updated evidence, original lookup');
  } finally {
    clearTimeout(timer);
    if (child.exitCode===null) {
      child.stdin.end();
      await exited.catch(()=>{});
    }
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
