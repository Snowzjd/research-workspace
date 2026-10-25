/* ==========================================================================
   最小的 WebDAV 服务（仅供验证用）
   - 支持 PROPFIND(Depth 0/1) / MKCOL / GET / PUT / DELETE，Basic 认证
   - 内存存储，进程退出即消失，不碰任何真实网盘
   - 行为对齐坚果云的实际返回（401 鉴权、404 目录不存在、405 目录已存在）
   ========================================================================== */
const http = require('http');

const XML = (items) => `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${items.map(it => `  <D:response>
    <D:href>${it.href}</D:href>
    <D:propstat>
      <D:prop>
        ${it.isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>'}
        <D:getcontentlength>${it.size || 0}</D:getcontentlength>
        <D:getlastmodified>${new Date(it.mtime || Date.now()).toUTCString()}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`).join('\n')}
</D:multistatus>`;

function start({ user = 'zs@example.com', pass = 'app-pass-123', prefix = '/dav' } = {}) {
  const files = new Map();      /* path → { text, mtime } */
  const dirs = new Set([prefix]); /* 预先存在根目录 */

  const server = http.createServer((req, res) => {
    const auth = String(req.headers.authorization || '');
    const want = 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    if (auth !== want) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dav"', 'Content-Type': 'text/plain' });
      return res.end('401 unauthorized');
    }

    let pathname = '/';
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) {}
    const isCollection = pathname.endsWith('/');
    const norm = pathname.replace(/\/+$/, '') || '/';

    const body = [];
    req.on('data', c => body.push(c));
    req.on('end', () => {
      const text = Buffer.concat(body).toString('utf8');

      if (req.method === 'PROPFIND') {
        const depth = String(req.headers.depth || '0');
        if (isCollection && !dirs.has(norm)) { res.writeHead(404); return res.end('not found'); }

        const items = [];
        if (isCollection) {
          items.push({ href: norm + '/', isDir: true, mtime: Date.now() });
          if (depth !== '0') {
            for (const d of dirs) {
              if (d !== norm && d.startsWith(norm + '/') && !d.slice(norm.length + 1).includes('/')) {
                items.push({ href: d + '/', isDir: true });
              }
            }
            for (const [p, f] of files) {
              if (p.startsWith(norm + '/') && !p.slice(norm.length + 1).includes('/')) {
                items.push({ href: p, isDir: false, size: f.buf ? f.buf.length : Buffer.byteLength(f.text), mtime: f.mtime });
              }
            }
          }
        } else {
          if (!files.has(norm)) { res.writeHead(404); return res.end('not found'); }
          const f = files.get(norm);
          items.push({ href: norm, isDir: false, size: Buffer.byteLength(f.text), mtime: f.mtime });
        }
        const xml = XML(items);
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(xml);
      }

      if (req.method === 'MKCOL') {
        if (dirs.has(norm)) { res.writeHead(405); return res.end('already exists'); }
        const parent = norm.slice(0, norm.lastIndexOf('/')) || '/';
        if (parent !== '/' && !dirs.has(parent)) { res.writeHead(409); return res.end('no parent'); }
        dirs.add(norm);
        res.writeHead(201);
        return res.end();
      }

      if (req.method === 'GET') {
        if (!files.has(norm)) { res.writeHead(404); return res.end('not found'); }
        const f = files.get(norm);
        if (f.buf) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(f.buf); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(f.text);
      }

      if (req.method === 'PUT') {
        const existed = files.has(norm);
        files.set(norm, { text, mtime: Date.now() });
        res.writeHead(existed ? 204 : 201);
        return res.end();
      }

      if (req.method === 'DELETE') {
        if (files.delete(norm)) { res.writeHead(204); return res.end(); }
        res.writeHead(404);
        return res.end();
      }

      res.writeHead(405);
      res.end('method not allowed');
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        files,
        dirs,
        base: `http://127.0.0.1:${port}${prefix}/`,
        user,
        pass,
        stop: () => new Promise(r => server.close(() => r())),
        /* 直接塞一份文件，模拟「另一台设备已经同步过」 */
        seed(pathname, obj) {
          files.set(`${prefix}${pathname}`, { text: JSON.stringify(obj), mtime: Date.now() });
        },
        seedBinary(pathname, buf) {
          files.set(`${prefix}${pathname}`, { buf, mtime: Date.now() });
        },
        read(pathname) {
          const f = files.get(`${prefix}${pathname}`);
          return f ? JSON.parse(f.text) : null;
        }
      });
    });
  });
}

module.exports = { start };
