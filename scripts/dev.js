const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
require('./build');
const root = path.resolve('public');
const routes = {
  '/api/analytics': '../api/analytics', '/api/admin/analytics': '../api/admin/analytics',
  '/api/event': '../api/event', '/api/leads': '../api/leads',
  '/api/admin/session': '../api/admin/session', '/api/admin/leads': '../api/admin/leads',
  '/api/admin/push': '../api/admin/push', '/api/cron/deliveries': '../api/cron/deliveries',
};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return res; };
  const url = new URL(req.url, 'http://localhost:3030');
  const isolatedTest = process.env.ALM_TEST_MODE === '1' && !process.env.VERCEL;
  if (isolatedTest && url.pathname === '/mock-fbevents.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end('window.fbq.callMethod=function(){};window.fbq.queue=[];'); return;
  }
  if (routes[url.pathname]) {
    let raw = '';
    try {
      for await (const chunk of req) { raw += chunk; if (raw.length > 20000) { res.status(413).json({ error: 'Payload too large' }); return; } }
      req.body = raw || undefined;
      if (process.env.ALM_TEST_MODE === '1' && !process.env.VERCEL && url.pathname === '/api/event') { res.status(200).json({ ok: true, events_received: 1, test: true }); return; }
      await require(routes[url.pathname])(req, res);
    } catch (error) { console.error(error.message); if (!res.writableEnded) res.status(500).json({ error: 'Internal error' }); }
    return;
  }
  let name;
  try { name = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (name === '/') name = '/index.html';
  if (name === '/painel' || name === '/painel/') name = '/painel.html';
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  if (isolatedTest && name === '/index.html') {
    res.end(fs.readFileSync(file, 'utf8').replace('https://connect.facebook.net/en_US/fbevents.js', '/mock-fbevents.js')); return;
  }
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT || 3030), '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + (process.env.PORT || 3030)));
