'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
function createPreviewServer() {
  return http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { res.writeHead(400).end(); return; }
    if (pathname === '/') pathname = '/studio.html';
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    const extension = path.extname(file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part.startsWith('.')) || !types[extension] || relative.startsWith('server')) {
      res.writeHead(404).end('Not found'); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[extension], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; object-src 'none'; frame-ancestors 'none'" });
      res.end(data);
    });
  });
}
if (require.main === module) createPreviewServer().listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log('Studio preview: http://127.0.0.1:' + (process.env.PORT || 4173)));
module.exports = { createPreviewServer };
