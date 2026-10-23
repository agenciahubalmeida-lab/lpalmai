const crypto = require('node:crypto');
const { uuid } = require('./http');
const EVENTS = new Set(['page_view', 'heartbeat', 'cta_click', 'quiz_view', 'quiz_start', 'step_view', 'question_answer', 'contact_input', 'form_error', 'submit_error', 'whatsapp_click']);
const clean = (s, max = 120) => typeof s === 'string' ? s.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
function visitorHash(id) {
  if (!uuid(id) || !process.env.ADMIN_SESSION_SECRET) throw Error('invalid_visitor');
  return crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update('analytics:' + id.toLowerCase()).digest('hex');
}
function referrerHost(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.hostname.slice(0, 200) : ''; } catch { return ''; }
}
function device(userAgent) {
  const ua = String(userAgent || '');
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Outro';
  const browser = /Edg/i.test(ua) ? 'Edge' : /CriOS|Chrome/i.test(ua) ? 'Chrome' : /FxiOS|Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Outro';
  return { device: /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobile|iPhone|Android/i.test(ua) ? 'Celular' : 'Computador', os, browser };
}
function validateAnalytics(input, ua) {
  if (!uuid(input.session_id) || !uuid(input.page_id) || !uuid(input.visitor_id)) throw Error('invalid_identity');
  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 20) throw Error('invalid_events');
  const events = input.events.map(e => {
    if (!e || !uuid(e.id) || !EVENTS.has(e.name)) throw Error('invalid_event');
    const step = Number(e.step || 0);
    if (!Number.isInteger(step) || step < 0 || step > 7) throw Error('invalid_step');
    const allowedLabels = ['header', 'hero', 'final', 'floating', 'other', 'required', 'phone', 'server', 'network'];
    return { id: e.id, name: e.name, step, label: allowedLabels.includes(e.label) ? e.label : '' };
  });
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id']) if (typeof input.utm?.[k] === 'string') utm[k] = clean(input.utm[k], 200);
  const integer = (v, max) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.floor(Number(v)))) : 0;
  return { session_id: input.session_id, page_id: input.page_id, visitor_hash: visitorHash(input.visitor_id), ...device(ua), referrer_host: referrerHost(input.referrer), utm, is_test: input.is_test === true, active_seconds: integer(input.active_seconds, 14400), scroll_percent: integer(input.scroll_percent, 100), events };
}
module.exports = { validateAnalytics, visitorHash, device, EVENTS };
