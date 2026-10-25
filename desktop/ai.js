/* ==========================================================================
   AI 接入层（主进程）
   - 支持任意 OpenAI 兼容端点（OpenAI / DeepSeek / 通义 / 智谱 / Moonshot / Ollama / 自建）
   - API Key 用 Electron safeStorage 加密后落盘，**绝不明文写入数据文件**
   - 渲染层拿不到明文密钥，只能拿到「是否已配置」
   - 只负责「单次请求」；多轮 tool-calling 循环由渲染层驱动，便于把每一步可视化
   ========================================================================== */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const keyFile = () => path.join(app.getPath('userData'), 'ai-key.bin');
const PLAIN_PREFIX = 'plain:';   // safeStorage 不可用时的降级标记

/* ---------- 服务商预设 ---------- */
const PROVIDERS = [
  { id: 'deepseek',  label: 'DeepSeek',              baseUrl: 'https://api.deepseek.com/v1',                          model: 'deepseek-chat',        needsKey: true },
  { id: 'openai',    label: 'OpenAI',                baseUrl: 'https://api.openai.com/v1',                            model: 'gpt-4o-mini',          needsKey: true },
  { id: 'dashscope', label: '通义千问（阿里云）',      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',     model: 'qwen-plus',            needsKey: true },
  { id: 'zhipu',     label: '智谱 GLM',              baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                 model: 'glm-4-flash',          needsKey: true },
  { id: 'moonshot',  label: 'Moonshot Kimi',         baseUrl: 'https://api.moonshot.cn/v1',                           model: 'moonshot-v1-8k',       needsKey: true },
  { id: 'ollama',    label: 'Ollama（本地）',         baseUrl: 'http://localhost:11434/v1',                            model: 'qwen2.5:7b',           needsKey: false },
  { id: 'custom',    label: '自定义（OpenAI 兼容）',   baseUrl: '',                                                     model: '',                     needsKey: true }
];

/* ---------- 端点归一化 ---------- */
function endpointOf(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (/\/chat\/completions$/i.test(b)) return b;
  if (!/\/v\d+[a-z]*$/i.test(b)) b += '/v1';       // 已带 /v1、/v4 等版本段就不再补
  return b + '/chat/completions';
}

/* ---------- 密钥存储 ---------- */
function saveKey(plain) {
  try {
    const f = keyFile();
    if (!plain) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
      return { ok: true, cleared: true };
    }
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(f, safeStorage.encryptString(plain));
      return { ok: true, encrypted: true };
    }
    // 极少数环境（部分 Linux 无 keyring）无法加密：做混淆存储并如实告知
    fs.writeFileSync(f, PLAIN_PREFIX + Buffer.from(plain, 'utf8').toString('base64'), 'utf8');
    return { ok: true, encrypted: false, warning: '当前系统不支持加密存储，密钥以混淆形式保存' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function readKey() {
  try {
    const f = keyFile();
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f);
    if (raw.slice(0, PLAIN_PREFIX.length).toString('utf8') === PLAIN_PREFIX) {
      return Buffer.from(raw.slice(PLAIN_PREFIX.length).toString('utf8'), 'base64').toString('utf8');
    }
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(raw);
  } catch (_) {
    return null;
  }
}

const hasKey = () => !!readKey();
const keyState = () => {
  const f = keyFile();
  if (!fs.existsSync(f)) return { stored: false, encrypted: false };
  const raw = fs.readFileSync(f);
  const isPlain = raw.slice(0, PLAIN_PREFIX.length).toString('utf8') === PLAIN_PREFIX;
  return { stored: true, encrypted: !isPlain };
};

/* ---------- 单次对话请求 ---------- */
async function chat(cfg = {}) {
  const { baseUrl, model, temperature = 0.3, maxTokens, messages = [], tools } = cfg;
  const url = endpointOf(baseUrl);
  if (!url) return { ok: false, error: '未配置 Base URL' };
  if (!model) return { ok: false, error: '未配置模型名称' };

  const key = readKey();
  const provider = PROVIDERS.find(p => p.id === cfg.provider);
  if ((!provider || provider.needsKey) && !key) {
    return { ok: false, error: '尚未配置 API Key，请先在「设置 → AI 接入」中填写' };
  }

  const body = { model, messages, stream: false };
  if (Number.isFinite(+temperature)) body.temperature = +temperature;
  if (Number.isFinite(+maxTokens) && +maxTokens > 0) body.max_tokens = +maxTokens;
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/timeout|aborted/i.test(msg)) return { ok: false, error: '请求超时（120s）。本地模型首次加载可能较慢，可稍后重试。' };
    return { ok: false, error: `网络请求失败：${msg}\n请检查 Base URL 与网络连通性。` };
  }

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 600);
    try { const j = JSON.parse(text); detail = (j.error && (j.error.message || j.error.code)) || detail; } catch (_) {}
    return { ok: false, error: `HTTP ${res.status}：${detail}`, status: res.status };
  }

  let json;
  try { json = JSON.parse(text); }
  catch (_) { return { ok: false, error: '响应不是合法 JSON：' + text.slice(0, 300) }; }

  const choice = (json.choices || [])[0];
  if (!choice) return { ok: false, error: '响应中没有 choices：' + text.slice(0, 300) };

  const msg = choice.message || {};
  return {
    ok: true,
    content: msg.content || '',
    toolCalls: msg.tool_calls || null,
    finishReason: choice.finish_reason || '',
    usage: json.usage || null,
    model: json.model || model
  };
}

/* ---------- 连通性测试 ---------- */
async function test(cfg = {}) {
  const r = await chat({
    ...cfg,
    messages: [
      { role: 'system', content: '你是连通性测试助手，只回复一个词。' },
      { role: 'user', content: 'ping' }
    ]
  });
  if (!r.ok) return r;
  return { ok: true, reply: (r.content || '').slice(0, 60), model: r.model, usage: r.usage };
}

module.exports = { PROVIDERS, endpointOf, saveKey, readKey, hasKey, keyState, chat, test };
