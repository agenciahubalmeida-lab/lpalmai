const crypto = require('node:crypto');
const { equal } = require('./http');
const cookieName = 'alm_ai_admin';
const lifetime = 7 * 86400;
function sign(value) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw Error('ADMIN_NOT_CONFIGURED');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}
function createSession() {
  const value = Math.floor(Date.now() / 1000) + lifetime + '.' + crypto.randomBytes(16).toString('hex');
  return value + '.' + sign(value);
}
function authorized(req) {
  try {
    const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim());
    const value = cookies.find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
    const parts = value.split('.');
    const now = Math.floor(Date.now() / 1000);
    return parts.length === 3 && /^\d{10}$/.test(parts[0]) && /^[0-9a-f]{32}$/.test(parts[1]) && Number(parts[0]) > now && Number(parts[0]) <= now + lifetime && equal(parts[2], sign(parts[0] + '.' + parts[1]));
  } catch { return false; }
}
function sessionCookie(value, expires = false) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL;
  return cookieName + '=' + value + '; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=' + (expires ? 0 : lifetime) + (secure ? '; Secure' : '');
}
module.exports = { authorized, createSession, sessionCookie };
