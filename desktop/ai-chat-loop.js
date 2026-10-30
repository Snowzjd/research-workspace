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

/* 与渲染层 data.js 的 engineDownNotice / unverifiedClaimNote 保持一致（主进程不能直接加载渲染层脚本）。 */
const ENGINE_DOWN_FALLBACK = '知识库服务未启动（127.0.0.1:8765）。本次检索没有拿到任何文献，所以没有写稿，也没有保存任何文稿。\n请先启动 RAG_Snowz 服务（默认端口 8765），或到「设置 → AI 与知识库引擎」核对服务地址，确认后再重新发送这句话。';

function isEngineDownResult(name, res) {
  return String(name || '') === 'search_knowledge' && !!res && typeof res === 'object' && res.code === 'engine_down';
}

const SAVE_CLAIM_RE = /(?:已经?|已为你|已帮你)(?:保存|存档|落盘|写好|写完)|保存(?:到|至|在)了?\s*[`「"“]?[A-Za-z]:[\\/]|上一轮[^\n。]{0,20}(?:写好|写完|保存|生成|完成)/;
function unverifiedClaimNote(text, results) {
  const t = String(text || '');
  if (!t) return '';
  const list = Array.isArray(results) ? results : [];
  const saved = list.some(x => x && x.name === 'save_document' && x.result && x.result.ok !== false && x.result.savedPath);
  const notes = [];
  if (!saved && SAVE_CLAIM_RE.test(t)) {
    notes.push('本轮没有成功调用 save_document，文稿并未保存；上文若提到「已保存」「已写好」或「上一轮已完成」，以这条为准。');
  }
  const errs = t.match(/[A-Za-z_$][\w$.]*\s+is not a function/g) || [];
  if (errs.length) {
    const blob = list.map(x => { try { return JSON.stringify(x && x.result); } catch (_) { return ''; } }).join('\n');
    if (errs.some(e => !blob.includes(e))) notes.push('上文引用的「… is not a function」报错不是本轮工具返回的，属于历史信息，不代表当前状态。');
  }
  return notes.length ? '（系统核对）' + notes.join('') : '';
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
        const note = unverifiedClaimNote(finalText, toolCalls.filter(t => t.executed));
        if (note) {
          finalText = (finalText ? finalText + '\n\n' : '') + note;
          transcript[transcript.length - 1].content = finalText;
        }
        return stop({ stopped: '' });
      }
      if (content) finalText = content;

      let blockedReason = '';
      let engineDown = null;
      for (const c of calls) {
        if (engineDown) break;
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
        if (isEngineDownResult(c.name, result)) engineDown = result;
      }
      if (engineDown) {
        /* 知识库服务未启动：不再请求模型，直接给出确定的说明 */
        finalText = (typeof engineDown.user_message === 'string' && engineDown.user_message) || ENGINE_DOWN_FALLBACK;
        transcript.push({ role: 'assistant', content: finalText, toolCalls: [] });
        return stop({ stopped: 'engine_down' });
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
  isEngineDownResult,
  unverifiedClaimNote,
  decideToolExecution,
  runAiChatLoop
};
