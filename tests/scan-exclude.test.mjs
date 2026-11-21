/**
 * 扫描排除名单：可配置，默认不含具体课题名。
 * 运行：node --test tests/scan-exclude.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const scanExclude = require('../assets/js/scan-exclude.js');

test('default patterns exclude knowledge-engine folder names only', () => {
  assert.deepEqual(scanExclude.DEFAULT_PATTERNS, ['rag[_-]?snowz', 'RAG引擎', '知识库引擎']);
  assert.equal(scanExclude.isExcluded('RAG_Snowz'), true);
  assert.equal(scanExclude.isExcluded('rag-snowz-cache'), true);
  assert.equal(scanExclude.isExcluded('RAG引擎'), true);
  assert.equal(scanExclude.isExcluded('知识库引擎'), true);
  assert.equal(scanExclude.isExcluded('01_Planning'), false);
  assert.equal(scanExclude.isExcluded('TPMS'), false);
  assert.equal(scanExclude.isExcluded('research-topic'), false);
});

test('settings.materialScanExclude replaces defaults when provided', () => {
  const settings = { materialScanExclude: ['tmp[_-]?scratch', 'Sandbox'] };
  assert.equal(scanExclude.isExcluded('tmp-scratch', settings), true);
  assert.equal(scanExclude.isExcluded('Sandbox', settings), true);
  assert.equal(scanExclude.isExcluded('RAG_Snowz', settings), false);
});

test('source module does not hardcode research topic names as default patterns', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '..', 'assets', 'js', 'scan-exclude.js'), 'utf8');
  /* 默认名单只应出现知识库引擎相关模式 */
  const defaults = scanExclude.listPatterns(undefined).join('\n');
  assert.equal(defaults.includes('rag'), true);
  assert.equal(/DEFAULT_PATTERNS[\s\S]{0,200}知识库引擎/.test(src), true);
});
