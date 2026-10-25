/* ==========================================================================
   云端载体抽象
   - 一个统一接口：test / list / get / put，同步引擎只认绑定对象，不关心底层是网盘还是目录
   - webdav：直连坚果云（也适用于任何标准 WebDAV：Nextcloud、群晖、TeraCLOUD）
   - folder：本地/局域网目录（原来的同步文件夹路径，原样保留）
   - onedrive / dropbox：留插槽，需要 OAuth 应用注册，当前明确标为未接入
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/* 云端根目录下的子目录名（可自定义）。所有设备副本都放这里 */
const DEFAULT_DIR = '/ResearchWorkspace';

/* ==========================================================================
   载体清单：界面上的选项卡来自这里，加一个载体只需要在这里加一项 + 实现 4 个方法
   ========================================================================== */
const PROVIDERS = [
  {
    id: 'webdav',
    name: '坚果云',
    short: '坚果云',
    kind: 'webdav',
    recommended: true,
    status: 'ready',
    desc: '国内服务器、免费版 1GB/月够用。网页端生成「应用密码」后直接填进来，不用装客户端。',
    /* 预设：只影响表单默认值，用户可改 */
    preset: {
      url: 'https://dav.jianguoyun.com/dav/',
      dir: DEFAULT_DIR,
      hint: '账号填坚果云注册邮箱；密码填「应用密码」（不是登录密码）'
    },
    /* 其它支持标准 WebDAV 的服务，用同一套代码即可 */
    alsoWorks: 'Nextcloud / 群晖 / TeraCLOUD / pCloud 等任何标准 WebDAV'
  },
  {
    id: 'folder',
    name: '本地或局域网目录',
    short: '目录',
    kind: 'folder',
    status: 'ready',
    desc: '选一个本地文件夹，或局域网共享盘（\\\\主机名\\共享名）。不经过任何服务器，最快。',
    preset: { dir: '' }
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    short: 'OneDrive',
    kind: 'oauth',
    status: 'planned',
    desc: '需要注册 Azure 应用走 OAuth 授权，当前版本没有接入。可以先用「本地目录」绑定本机 OneDrive 文件夹。'
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    short: 'Dropbox',
    kind: 'oauth',
    status: 'planned',
    desc: '同上，需要 OAuth 应用注册。可以先用「本地目录」绑定本机 Dropbox 文件夹。'
  }
];

function providerById(id) {
  return PROVIDERS.find(p => p.id === id) || null;
}

/* ==========================================================================
   通用 HTTP：直接用 https 模块，不引入依赖，也不受 fetch 的 method 限制
   ========================================================================== */
function request(method, url, headers, body, timeoutMs = 20000, asBuffer = false, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (_) { return reject(new Error('地址格式不对：' + url)); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: headers || {}
    }, res => {
      /* 跟随重定向：GitHub 的 releases 直链和 API 资产下载都会 302 到 CDN。
         不跟随的话会被当成"HTTP 302 失败"，表现为检查更新失败/超时。
         跳到 CDN 时不带 Authorization（签名 URL 不需要，也不该泄露凭证）。 */
      const loc = res.headers.location;
      if (loc && [301, 302, 303, 307, 308].includes(res.statusCode) && redirects > 0) {
        res.resume();
        let next = '';
        try { next = new URL(loc, url).href; } catch (_) {}
        if (next) {
          const h2 = { ...(headers || {}) };
          delete h2.Authorization;
          delete h2.authorization;
          resolve(request('GET', next, h2, null, timeoutMs, asBuffer, redirects - 1));
          return;
        }
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: asBuffer ? buf : buf.toString('utf8'),
          buffer: buf
        });
      });
    });
    req.on('error', err => {
      const code = err && err.code;
      if (code === 'ENOTFOUND') return reject(new Error('找不到服务器，请检查地址'));
      if (code === 'ECONNREFUSED') return reject(new Error('连接被拒绝，服务器或端口不对'));
      if (/CERT|SSL|TLS/i.test(String(code || err.message))) return reject(new Error('证书校验失败：' + (err.message || code)));
      reject(new Error('网络错误：' + String((err && err.message) || err)));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）')));
    if (body != null) req.write(body);
    req.end();
  });
}

/* ==========================================================================
   WebDAV
   ========================================================================== */
const XML_PROPFIND = '<?xml version="1.0" encoding="utf-8"?>'
  + '<d:propfind xmlns:d="DAV:"><d:prop>'
  + '<d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>'
  + '</d:prop></d:propfind>';

function authHeader(binding) {
  const raw = String(binding.user || '') + ':' + String(binding.pass || '');
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

function joinUrl(base, rel) {
  const b = String(base || '').replace(/\/+$/, '');
  let r = String(rel || '');
  if (!r.startsWith('/')) r = '/' + r;
  return b + r;
}

/* 目录请求必须带结尾斜杠：不带的话标准 WebDAV 会回 301 重定向，而 PROPFIND 不跟随 */
function dirUrl(base, dir) {
  return joinUrl(base, dir || DEFAULT_DIR).replace(/\/+$/, '') + '/';
}

/* 从 207 Multi-Status 里取出所有 href */
function parseHrefs(xml) {
  const out = [];
  const re = /<(?:D:|d:)?href[^>]*>([\s\S]*?)<\/(?:D:|d:)?href>/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    let h = m[1].trim();
    if (!h) continue;
    try { h = decodeURIComponent(h); } catch (_) {}
    out.push(h);
  }
  return out;
}

/* 把一个 href 归一到「相对用户填的 url」的路径 */
function toRelPath(href, baseUrl) {
  let h = href;
  try { h = new URL(href, baseUrl).pathname; } catch (_) {}
  let basePath = '';
  try { basePath = new URL(baseUrl).pathname.replace(/\/+$/, ''); } catch (_) {}
  if (basePath && h.startsWith(basePath)) h = h.slice(basePath.length);
  if (!h.startsWith('/')) h = '/' + h;
  return h;
}

const dav = {
  async test(binding) {
    const url = dirUrl(binding.url, binding.dir);
    const r = await request('PROPFIND', url, {
      Authorization: authHeader(binding),
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(XML_PROPFIND)
    }, XML_PROPFIND);
    if (r.status === 401) throw new Error('账号或应用密码不对（401）。密码要用「应用密码」，不是登录密码');
    if (r.status === 403) throw new Error('账号没有访问这个目录的权限（403）');
    if (r.status === 404) {
      /* 目录还不存在——能连上但目录没建。这算可用，等第一次同步时创建 */
      const root = await this.testRoot(binding);
      if (!root.ok) throw new Error(root.error);
      return { ok: true, needCreate: true, dir: binding.dir || DEFAULT_DIR };
    }
    if (r.status !== 207 && r.status !== 200) {
      throw new Error(`服务器返回 HTTP ${r.status}${r.body ? '：' + r.body.slice(0, 120) : ''}`);
    }
    return { ok: true, needCreate: false, dir: binding.dir || DEFAULT_DIR };
  },

  /* 只验证「地址 + 账号 + 密码」，不管目录存不存在 */
  async testRoot(binding) {
    const r = await request('PROPFIND', binding.url, {
      Authorization: authHeader(binding),
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(XML_PROPFIND)
    }, XML_PROPFIND);
    if (r.status === 401) return { ok: false, error: '账号或应用密码不对（401）。密码要用「应用密码」，不是登录密码' };
    if (r.status === 403) return { ok: false, error: '这个地址不允许访问（403）' };
    if (r.status !== 207 && r.status !== 200) return { ok: false, error: `服务器返回 HTTP ${r.status}` };
    return { ok: true };
  },

  async mkdir(binding, rel) {
    const r = await request('MKCOL', joinUrl(binding.url, rel), {
      Authorization: authHeader(binding),
      'Content-Length': 0
    }, null);
    /* 201 建好；405 已存在，都算成功 */
    if (r.status === 201 || r.status === 405 || r.status === 200) return { ok: true };
    if (r.status === 409) return { ok: false, error: '上级目录不存在（409）' };
    return { ok: false, error: `创建目录失败：HTTP ${r.status}` };
  },

  async list(binding) {
    const dir = binding.dir || DEFAULT_DIR;
    const r = await request('PROPFIND', dirUrl(binding.url, dir), {
      Authorization: authHeader(binding),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(XML_PROPFIND)
    }, XML_PROPFIND);
    if (r.status === 404) return [];                 /* 目录还没建，等于空的 */
    if (r.status === 401) throw new Error('账号或应用密码不对（401）');
    if (r.status !== 207 && r.status !== 200) throw new Error(`列出目录失败：HTTP ${r.status}`);

    const selfPath = dir.replace(/\/+$/, '');
    return parseHrefs(r.body)
      .map(h => toRelPath(h, binding.url))
      .filter(p => {
        const norm = p.replace(/\/+$/, '');
        return norm && norm !== selfPath && norm !== '';   /* 去掉目录自身 */
      })
      .map(p => ({
        name: p.split('/').filter(Boolean).pop() || '',
        path: p,
        isDir: /\/$/.test(p)
      }))
      .filter(f => f.name && !f.isDir);
  },

  async get(binding, name) {
    const dir = (binding.dir || DEFAULT_DIR).replace(/\/+$/, '');
    const r = await request('GET', joinUrl(binding.url, dir + '/' + name), {
      Authorization: authHeader(binding)
    }, null, 30000);
    if (r.status === 404) return null;
    if (r.status === 401) throw new Error('账号或应用密码不对（401）');
    if (r.status !== 200) throw new Error(`读取 ${name} 失败：HTTP ${r.status}`);
    return r.body;
  },

  /* 二进制下载（更新包 zip 用；文本走 get） */
  async getBinary(binding, name) {
    const dir = (binding.dir || DEFAULT_DIR).replace(/\/+$/, '');
    const r = await request('GET', joinUrl(binding.url, dir + '/' + name), {
      Authorization: authHeader(binding)
    }, null, 60000, true);
    if (r.status === 404) return null;
    if (r.status === 401) throw new Error('账号或应用密码不对（401）');
    if (r.status !== 200) throw new Error(`下载 ${name} 失败：HTTP ${r.status}`);
    return r.buffer;
  },

  /* 二进制上传（更新包 zip 用） */
  async putBinary(binding, name, buffer) {
    const dir = (binding.dir || DEFAULT_DIR).replace(/\/+$/, '');
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const r = await request('PUT', joinUrl(binding.url, dir + '/' + name), {
      Authorization: authHeader(binding),
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length
    }, buf, 60000);
    if (r.status === 401) return { ok: false, error: '账号或应用密码不对（401）' };
    if (r.status === 413) return { ok: false, error: '文件超过云端单文件上限' };
    if (r.status === 507) return { ok: false, error: '云端空间或流量不足（507）' };
    if (r.status !== 200 && r.status !== 201 && r.status !== 204) {
      return { ok: false, error: `写入 ${name} 失败：HTTP ${r.status}` };
    }
    return { ok: true, bytes: buf.length };
  },

  async put(binding, name, text) {
    const dir = (binding.dir || DEFAULT_DIR).replace(/\/+$/, '');
    const buf = Buffer.from(text, 'utf8');
    const r = await request('PUT', joinUrl(binding.url, dir + '/' + name), {
      Authorization: authHeader(binding),
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': buf.length
    }, buf, 60000);
    if (r.status === 401) return { ok: false, error: '账号或应用密码不对（401）' };
    if (r.status === 413) return { ok: false, error: '文件超过云端单文件上限' };
    if (r.status === 507) return { ok: false, error: '云端空间或流量不足（507）' };
    if (r.status !== 200 && r.status !== 201 && r.status !== 204) {
      return { ok: false, error: `写入 ${name} 失败：HTTP ${r.status}` };
    }
    return { ok: true, bytes: buf.length };
  }
};

/* ==========================================================================
   本地目录（含局域网共享）
   ========================================================================== */
const folder = {
  async test(binding) {
    const dir = String(binding.dir || '').trim();
    if (!dir) throw new Error('还没有选目录');
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs)) throw new Error('目录不存在：' + abs);
    if (!fs.statSync(abs).isDirectory()) throw new Error('不是文件夹：' + abs);
    /* 真写一次再删，确认可写（只读的共享盘很常见） */
    const probe = path.join(abs, '.rw-write-test');
    try {
      fs.writeFileSync(probe, 'ok', 'utf8');
      fs.unlinkSync(probe);
    } catch (err) {
      throw new Error('这个目录不能写：' + String((err && err.message) || err));
    }
    return { ok: true, dir: abs };
  },

  async list(binding) {
    const abs = path.resolve(binding.dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs)
      .filter(f => /^workspace-[a-z0-9_-]+\.json$/i.test(f))
      .map(f => {
        let size = 0; let mtime = 0;
        try { const st = fs.statSync(path.join(abs, f)); size = st.size; mtime = st.mtimeMs; } catch (_) {}
        return { name: f, path: f, isDir: false, size, mtime };
      });
  },

  async get(binding, name) {
    const full = path.join(path.resolve(binding.dir), name);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf8');
  },

  async getBinary(binding, name) {
    const full = path.join(path.resolve(binding.dir), name);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  },

  async put(binding, name, text) {
    const abs = path.resolve(binding.dir);
    fs.mkdirSync(abs, { recursive: true });
    const full = path.join(abs, name);
    const tmp = full + '.tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, full);
    return { ok: true, bytes: Buffer.byteLength(text) };
  },

  async putBinary(binding, name, buffer) {
    const abs = path.resolve(binding.dir);
    fs.mkdirSync(abs, { recursive: true });
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const full = path.join(abs, name);
    const tmp = full + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, full);
    return { ok: true, bytes: buf.length };
  }
};

const IMPL = { webdav: dav, folder };

/* ==========================================================================
   对外：统一入口。binding = { kind, url, dir, user, pass, label }
   ========================================================================== */
function implOf(binding) {
  const kind = binding && binding.kind;
  const impl = IMPL[kind];
  if (!impl) {
    const p = providerById(kind);
    if (p && p.status === 'planned') throw new Error(`${p.name} 还没接入（需要 OAuth 授权）`);
    throw new Error('未知的云端类型：' + kind);
  }
  return impl;
}

async function test(binding) { return implOf(binding).test(binding); }
async function list(binding) { return implOf(binding).list(binding); }
async function get(binding, name) { return implOf(binding).get(binding, name); }
async function put(binding, name, text) { return implOf(binding).put(binding, name, text); }
async function putBinary(binding, name, buffer) { return implOf(binding).putBinary(binding, name, buffer); }
async function getBinary(binding, name) { return implOf(binding).getBinary(binding, name); }

/* 第一次同步前确保云端目录存在（WebDAV 需要；本地目录直接建） */
async function ensureDir(binding) {
  if (binding.kind === 'webdav') {
    const r = await implOf(binding).mkdir(binding, binding.dir || DEFAULT_DIR);
    return r;
  }
  if (binding.kind === 'folder') {
    fs.mkdirSync(path.resolve(binding.dir), { recursive: true });
    return { ok: true };
  }
  return { ok: false, error: '未知的云端类型' };
}

/* 给界面用的载体清单（脱敏，不含任何凭证） */
function catalog() {
  return PROVIDERS.map(p => ({
    id: p.id, name: p.name, short: p.short, kind: p.kind,
    recommended: !!p.recommended, status: p.status, desc: p.desc,
    preset: p.preset || null, alsoWorks: p.alsoWorks || ''
  }));
}

module.exports = {
  PROVIDERS, catalog, providerById,
  test, list, get, getBinary, put, putBinary, ensureDir,
  DEFAULT_DIR,
  _internals: { request, parseHrefs, toRelPath, joinUrl, dirUrl, dav, folder }
};
