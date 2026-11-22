'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inside, samePath } = require('./full-product');
const { inspectPath } = require('./project-root');

const maxRollout = 4 * 1024 * 1024;
const maxMeta = 512 * 1024;
const denialMessages = [
  /(?:patch rejected: )?writing is blocked by read-only sandbox(?:; rejected by user approval settings)?/i,
  /(?:rejected: )?blocked by policy/i,
  /rejected by user approval settings/i,
  /(?:operation |command |permission )denied by (?:the )?(?:sandbox|approval policy|user)/i,
  /(?:permission |access )denied/i,
  /(?:user |approval )declined/i
];

function checkedDenial(value) {
  const text = typeof value === 'string' ? value.slice(0, 24_000) : '';
  for (const pattern of denialMessages) {
    const exact = text.match(pattern);
    if (exact) return exact[0];
  }
  return '';
}

function safeCommand(command) {
  if (typeof command !== 'string') return '';
  const tool = command.match(/\b(?:node(?:\.exe)?\s+--test|pytest(?:\.exe)?|python(?:3|\.exe)?\s+-m\s+(?:pytest|unittest)|(?:npm|pnpm|yarn|cargo|go|dotnet)(?:\.exe)?\s+(?:run\s+)?test)\b/i);
  if (!tool) return '';
  const arg = command.slice(tool.index + tool[0].length).match(/^\s+([a-zA-Z0-9_./-]+\.(?:test|spec)\.(?:m?js|cjs|ts)|[a-zA-Z0-9_./-]+\.py)(?=$|[\s'"\x60\\])/i)?.[1];
  return tool[0] + (arg && !arg.includes('..') && !arg.startsWith('/') ? ' ' + arg : '');
}

function outputText(output) {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';
  return output.filter(item => item?.type === 'input_text' || item?.type === 'output_text')
    .slice(0, 12).map(item => String(item.text || '').slice(0, 3000)).join('\n');
}

function readSlice(fd, position, length) {
  const buffer = Buffer.alloc(length);
  return buffer.subarray(0, fs.readSync(fd, buffer, 0, length, position)).toString('utf8');
}

function parse(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}

function rolloutDenials({ thread, turnId, directory, sessionsDirectory, resolvePath }) {
  const reported = thread?.path;
  const file = process.platform === 'win32' && typeof reported === 'string' && /^\\\\\?\\[a-z]:\\/i.test(reported)
    ? reported.slice(4) : reported;
  if (!turnId || typeof file !== 'string' || !sessionsDirectory || !path.isAbsolute(file) ||
      !inside(sessionsDirectory, file) || path.relative(sessionsDirectory, file).split(path.sep).length !== 4 ||
      !/^rollout-/.test(path.basename(file)) || !file.endsWith('-' + thread.id + '.jsonl')) return [];
  try {
    const inspected = inspectPath(file);
    if (!inspected.exists || inspected.hasReparseInPath || !samePath(inspected.realPath, file)) return [];
    const expected = fs.lstatSync(file);
    if (!expected.isFile() || expected.nlink !== 1 || !expected.size) return [];
    const fd = fs.openSync(file, 'r');
    try {
      const actual = fs.fstatSync(fd);
      if (!actual.isFile() || actual.nlink !== 1 || actual.ino !== expected.ino || actual.dev !== expected.dev) return [];
      const header = readSlice(fd, 0, Math.min(actual.size, maxMeta));
      const first = parse(header.split('\n', 1)[0].replace(/^\uFEFF/, ''));
      if (first?.type !== 'session_meta' || first.payload?.id !== thread.id ||
          typeof first.payload.cwd !== 'string' || !samePath(first.payload.cwd, directory)) return [];
      const start = Math.max(0, actual.size - maxRollout);
      const lines = readSlice(fd, start, Math.min(actual.size, maxRollout)).split('\n');
      if (start) lines.shift();
      const calls = new Map();
      const denials = [];
      let active = false;
      for (const line of lines) {
        if (!line || line.length > maxMeta) continue;
        const record = parse(line);
        const item = record?.payload;
        if (!item) continue;
        if (record.type === 'turn_context') {
          active = item.turn_id === turnId && typeof item.cwd === 'string' &&
            samePath(item.cwd, directory);
          calls.clear();
        }
        if (!active || record.type !== 'response_item' || typeof item.call_id !== 'string') continue;
        if (['custom_tool_call', 'function_call'].includes(item.type) && calls.size < 200 &&
            ['exec', 'apply_patch', 'exec_command'].includes(item.name)) {
          calls.set(item.call_id, item);
        }
        if (!['custom_tool_call_output', 'function_call_output'].includes(item.type)) continue;
        const call = calls.get(item.call_id);
        if (!call || denials.length >= 12) continue;
        calls.delete(item.call_id);
        const text = outputText(item.output);
        // Accept only tool infrastructure errors and the matched action in this turn.
        if (!/(?:patch rejected|exec_command failed:\s*CreateProcess|approval (?:was )?declined)/i.test(text)) continue;
        const message = checkedDenial(text);
        if (!message) continue;
        const input = String(call.input || call.arguments || '').slice(0, 16_000);
        const write = call.name === 'apply_patch' || /tools\.apply_patch\s*\(/.test(input);
        const execute = call.name === 'exec_command' || /tools\.exec_command\s*\(/.test(input);
        if (!write && !execute) continue;
        const reported = write && input.match(/\*\*\* (?:Add|Update|Delete) File: ([^\r\n\\]{1,260})/)?.[1];
        const resolved = reported ? resolvePath(reported.trim()) : null;
        const command = execute ? safeCommand(input) : '';
        denials.push({ operation: write ? 'write' : 'command', message, source: 'codex-tool-rejection',
          ...(resolved ? { path: resolved.path } : {}), ...(command ? { command } : {}) });
      }
      return denials;
    } finally { fs.closeSync(fd); }
  } catch (_) { return []; }
}

module.exports = { checkedDenial, safeCommand, rolloutDenials };
