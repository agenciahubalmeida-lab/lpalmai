const crypto = require('node:crypto');

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function reply(res, status, data) {
  noStore(res);
  return res.status(status).json(data);
}
function body(req, max = 16000) {
  const raw = req.body;
  if (Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw || {})) > max) throw Error('BODY_TOO_LARGE');
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_BODY');
  return value;
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const hash = v => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}
function sameOrigin(req) {
  const expected = process.env.ALM_PUBLIC_ORIGIN || 'https://lpalmai.hubalmeida.com.br';
  const allowed = [expected];
  if (process.env.VERCEL_URL) allowed.push('https://' + process.env.VERCEL_URL);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) allowed.push('https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) allowed.push('http://localhost:3030', 'http://127.0.0.1:3030');
  return allowed.includes(req.headers.origin);
}
function bucket(req, purpose) {
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!process.env.ADMIN_SESSION_SECRET) throw Error('ADMIN_NOT_CONFIGURED');
  return purpose + ':' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(ip).digest('hex');
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
module.exports = { noStore, reply, body, equal, sameOrigin, bucket, uuid };
