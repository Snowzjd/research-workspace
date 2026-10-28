/* ==========================================================================
   主进程对话 + 工具循环（POST /api/ai/chat）
   --------------------------------------------------------------------------
   单次补全走 desktop/ai.js 的 chat()，和界面 IPC ai:chat 是同一条路径。
   工具执行走渲染层 __RW_API__，和界面、外部工具是同一套实现。
   界面自己还有一层可视化循环（actions.js aiSend）；这里是无界面的探测循环，
   轮数上限与 AI_MAX_ROUNDS 对齐。用法和风险见 tests/ai-chat-api.md。

   删除类工具即使 autoApprove 也不会执行，除非参数里的 confirm 严格为 true。
   dry_run 仍只预览，不删除。
   ========================================================================== */

const AI_CHAT_MAX_ROUNDS = 6;
const AI_CHAT_MAX_TOOL_CALLS = 12;

function isDryRun(args) {
  if (!args || typeof args !== 'object') return false;
  const v = Object.prototype.hasOwnProperty.call(args, 'dry_run') ? args.dry_run : args.dryRun;
  return v === true || v === 1 || v === 'true' || v === '1';
}

function isReadOnlyTool(name) {
  return /^(get_|list_|search_)/.test(String(name || ''));
}

function isDestructiveTool(name) {
  return /^delete_/.test(String(name || ''));
}

function decideToolExecution(name, args, autoApprove) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  if (isDryRun(safeArgs)) return { run: true, reason: 'dry_run' };
  if (isDestructiveTool(name) && safeArgs.confirm !== true) {
    return {
      run: false,
      reason: 'needs_confirm',
      result: {
        ok: false,
        needsConfirm: true,
        executed: false,
        error: '删除类工具必须带 confirm=true 才会执行。autoApprove 不会跳过确认，本次没有删除。'
      }
    };
  }
  if (!isReadOnlyTool(name) && autoApprove !== true) {
    return {
      run: false,
      reason: 'needs_approval',
      result: {
        ok: false,
        needsApproval: true,
        executed: false,
        error: '未打开 autoApprove，写操作没有执行。只读检索会直接执行；删除仍要 confirm=true。'
      }
    };
  }
  return { run: true, reason: 'run' };
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  const out = [];
  for (const tc of toolCalls) {
    if (!tc || !tc.function || !tc.function.name) continue;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { args = {}; }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    out.push({
      id: tc.id || ('call_' + Math.random().toString(36).slice(2, 10)),
      name: tc.function.name,
      args
    });
  }
  return out;
}

function assistantWire(content, calls) {
  const msg = { role: 'assistant', content: content || '' };
  if (calls.length) {
    msg.tool_calls = calls.map(c => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.args || {}) }
    }));
  }
  return msg;
}

async function runAiChatLoop(opts) {
  const opt = opts || {};
  const chat = opt.chat;
  const invokeTool = opt.invokeTool;
  const fail = (error) => ({
    ok: false,
    error,
    messages: [],
    toolCalls: [],
    finalText: '',
    rounds: 0,
    capped: false,
    stopped: 'model_error'
  });
  if (typeof chat !== 'function') return fail('对话通道未接入');
  if (typeof invokeTool !== 'function') return fail('工具通道未接入');

  const maxRounds = AI_CHAT_MAX_ROUNDS;
  const maxToolCalls = AI_CHAT_MAX_TOOL_CALLS;
  const autoApprove = opt.autoApprove === true;
  const convo = Array.isArray(opt.messages) ? opt.messages.map(m => Object.assign({}, m)) : [];
  const tools = opt.tools;
  const cfg = Object.assign({}, opt.cfg || {});
  const transcript = [];
  const toolCalls = [];
  let finalText = '';
  let rounds = 0;
  let toolCount = 0;
  let capped = false;

  const stop = (extra) => Object.assign({
    ok: true,
    messages: transcript,
    toolCalls,
    finalText,
    rounds,
    capped,
    stopped: '',
    error: ''
  }, extra || {});

  try {
    for (let round = 1; round <= maxRounds; round++) {
      rounds = round;
      let r;
      try {
        r = await chat(Object.assign({}, cfg, { messages: convo, tools }));
      } catch (err) {
        return stop({ ok: false, stopped: 'model_error', error: String((err && err.message) || err) });
      }
      if (!r || r.ok === false) {
        return stop({ ok: false, stopped: 'model_error', error: (r && r.error) || '对话失败' });
      }
      const calls = normalizeToolCalls(r.toolCalls);
      const content = r.content || '';
      transcript.push({ role: 'assistant', content, toolCalls: calls });
      convo.push(assistantWire(content, calls));
      if (!calls.length) {
        finalText = content;
        return stop({ stopped: '' });
      }
      if (content) finalText = content;

      let blockedReason = '';
      for (const c of calls) {
        if (toolCount >= maxToolCalls) {
          capped = true;
          const result = { ok: false, executed: false, error: `已达到单次最多 ${maxToolCalls} 次工具调用` };
          toolCalls.push({ id: c.id, name: c.name, args: c.args, executed: false, result });
          transcript.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: JSON.stringify(result) });
          blockedReason = blockedReason || 'cap';
          continue;
        }
        toolCount += 1;
        const decision = decideToolExecution(c.name, c.args, autoApprove);
        if (!decision.run) {
          toolCalls.push({ id: c.id, name: c.name, args: c.args, executed: false, result: decision.result });
          transcript.push({
            role: 'tool',
            tool_call_id: c.id,
            name: c.name,
            content: JSON.stringify(decision.result)
          });
          blockedReason = blockedReason || decision.reason;
          continue;
        }
        let result;
        try {
          result = await invokeTool(c.name, c.args);
        } catch (err) {
          result = { ok: false, error: String((err && err.message) || err) };
        }
        if (result == null) result = { ok: false, error: '工具无返回' };
        toolCalls.push({ id: c.id, name: c.name, args: c.args, executed: true, result });
        const packed = JSON.stringify(result);
        transcript.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: packed });
        convo.push({ role: 'tool', tool_call_id: c.id, content: packed });
      }
      if (blockedReason === 'needs_confirm' || blockedReason === 'needs_approval') {
        return stop({ stopped: blockedReason });
      }
      if (capped || toolCount >= maxToolCalls) {
        capped = true;
        return stop({
          capped: true,
          stopped: 'cap',
          error: `已达到单次对话工具调用上限（${maxToolCalls} 次）`
        });
      }
    }
    capped = true;
    return stop({
      capped: true,
      stopped: 'cap',
      error: `已达到单次对话最多 ${maxRounds} 轮工具调用上限`
    });
  } catch (err) {
    return stop({ ok: false, stopped: 'model_error', error: String((err && err.message) || err) });
  }
}

module.exports = {
  AI_CHAT_MAX_ROUNDS,
  AI_CHAT_MAX_TOOL_CALLS,
  isDryRun,
  decideToolExecution,
  runAiChatLoop
};
