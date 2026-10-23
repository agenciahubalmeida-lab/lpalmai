const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const { validateAnalytics, visitorHash } = require('../lib/analytics');
const input = () => ({ session_id: crypto.randomUUID(), page_id: crypto.randomUUID(), visitor_id: crypto.randomUUID(), active_seconds: 20, scroll_percent: 55, referrer: 'https://instagram.com/private?email=secret', utm: { utm_source: 'instagram', bad: 'drop' }, events: [{ id: crypto.randomUUID(), name: 'question_answer', step: 2, label: 'Personal details must be dropped', value: 'Private form input' }] });
test('telemetria permite apenas metadados e remove valores de formulário e caminho de referência', () => {
  process.env.ADMIN_SESSION_SECRET = 'analytics-test'.repeat(4);
  const raw = input(), value = validateAnalytics(raw, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1');
  assert.equal(value.referrer_host, 'instagram.com'); assert.equal(value.device, 'Celular'); assert.equal(value.os, 'iOS'); assert.equal(value.browser, 'Safari');
  assert.equal(value.visitor_hash, visitorHash(raw.visitor_id)); assert.equal(value.visitor_id, undefined);
  assert.deepEqual(value.utm, { utm_source: 'instagram' }); assert.deepEqual(value.events[0], { id: raw.events[0].id, name: 'question_answer', step: 2, label: '' });
  assert.equal(JSON.stringify(value).includes('Private form input'), false);
});
test('telemetria rejeita eventos forjados e limita métricas cumulativas', () => {
  process.env.ADMIN_SESSION_SECRET = 'analytics-test'.repeat(4);
  const raw = input(); raw.active_seconds = 999999; raw.scroll_percent = 600;
  assert.equal(validateAnalytics(raw, '').active_seconds, 14400); assert.equal(validateAnalytics(raw, '').scroll_percent, 100);
  raw.events[0].name = 'submit_success'; assert.throws(() => validateAnalytics(raw, ''));
  raw.events[0].name = 'question_answer'; raw.events[0].step = 8; assert.throws(() => validateAnalytics(raw, ''));
  raw.events = Array(21).fill({}); assert.throws(() => validateAnalytics(raw, ''));
});
function browser({ path = '/', search = '', ignore = false, saved = null } = {}) {
  let now = Date.now(); const sent = [], timers = [], listeners = {}, docEvents = {}, intervals = [], store = new Map();
  if (ignore) store.set('alm_analytics_ignore', '1');
  if (saved) store.set('alm_analytics_session', JSON.stringify(saved));
  const document = { visibilityState: 'visible', referrer: '', documentElement: { scrollHeight: 2000 }, addEventListener: (n, f) => { docEvents[n] = f; }, getElementById: () => null };
  const context = { location: { pathname: path, search }, document, localStorage: { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) }, crypto: crypto.webcrypto, URLSearchParams, Blob, AbortSignal,
    fetch: async (url,o) => { sent.push(JSON.parse(o.body)); return { ok: true }; }, navigator: { sendBeacon: () => false },
    setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout: () => {}, setInterval: f => intervals.push(f), addEventListener: (n,f) => { listeners[n] = f; },
    Date: class extends Date { static now() { return now; } }, innerHeight: 500, scrollY: 0,
  };
  context.window = context; vm.runInNewContext(fs.readFileSync('web/analytics.js','utf8'), context);
  return { context, sent, store, listeners, docEvents, intervals, timers, advance: ms => { now += ms; } };
}
test('cliente: sessão persistente, novos carregamentos e exclusão de visitas do administrador', async () => {
  const a = browser(); assert.ok(a.context.ALMAnalytics); await a.timers[0](); assert.equal(a.sent[0].events[0].name, 'page_view');
  const saved = JSON.parse(a.store.get('alm_analytics_session'));
  const b = browser({ saved }); assert.equal(b.context.ALMAnalytics.context().session_id, saved.id);
  assert.notEqual(b.context.ALMAnalytics.context().page_id, a.context.ALMAnalytics.context().page_id);
  const c = browser({ saved: { ...saved, last: Date.now() - 1900000 } }); assert.notEqual(c.context.ALMAnalytics.context().session_id, saved.id);
  assert.equal(browser({ path: '/painel' }).context.ALMAnalytics, undefined);
  assert.equal(browser({ ignore: true }).context.ALMAnalytics, undefined);
  assert.equal(browser({ ignore: true, search: '?analytics_test=1' }).context.ALMAnalytics.context().is_test, true);
});
test('cliente: tempo ativo, eventos sem duplicatas e nenhum valor dos campos de contato', async () => {
  const b = browser(); const a = b.context.ALMAnalytics;
  a.meta('ViewContent', {}); a.meta('ViewContent', {});
  b.docEvents.input({ target: { matches: () => true, value: 'Private password or phone' } });
  b.advance(5000); b.intervals[0](); assert.equal(a.context().active_seconds, 5);
  b.context.document.visibilityState = 'hidden'; b.advance(5000); b.intervals[0](); assert.equal(a.context().active_seconds, 5);
  await b.timers[b.timers.length - 1]();
  const events = b.sent.flatMap(s => s.events); assert.equal(events.filter(e => e.name === 'quiz_view').length, 1);
  assert.equal(events.filter(e => e.name === 'contact_input').length, 1); assert.equal(JSON.stringify(b.sent).includes('Private password or phone'), false);
});
