// Verificação explícita: apenas sessões de teste, sem cadastros ou notificações.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { env } = require('../scripts/setup');
(async () => {
  const config = env(); Object.assign(process.env, config);
  const { database, query } = require('../lib/database');
  const origin = process.argv[2] || config.ALM_PUBLIC_ORIGIN;
  const id = crypto.randomUUID();
  const payload = { session_id: id, page_id: crypto.randomUUID(), visitor_id: crypto.randomUUID(), is_test: true, utm: { utm_source: 'analytics-verification' }, referrer: 'https://example.com/private?secret=removed', active_seconds: 30, scroll_percent: 75, events: [{ id: crypto.randomUUID(), name: 'page_view' }, { id: crypto.randomUUID(), name: 'form_error', step: 2, privateText: 'never-store-field-value' }] };
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'User-Agent': 'ALM-Analytics-Verification/1.0' };
  let cookie;
  try {
    assert.equal((await fetch(origin + '/api/admin/analytics')).status, 401);
    const login = await fetch(origin + '/api/admin/session', { method: 'POST', headers, body: JSON.stringify({ password: config.ADMIN_PASSWORD }) });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
    for (let i = 0; i < 2; i++) {
      const r = await fetch(origin + '/api/analytics', { method: 'POST', headers, body: JSON.stringify(payload) });
      assert.equal(r.status, 200, JSON.stringify(await r.json()));
    }
    const rows = await database('alm_ai_sessions?' + query({ id: 'eq.' + id }));
    assert.equal(rows.length, 1); assert.equal(rows[0].is_test, true); assert.equal(rows[0].form_errors, 1);
    assert.equal(rows[0].referrer_host, 'example.com'); assert.notEqual(rows[0].visitor_hash, payload.visitor_id);
    const events = await database('alm_ai_analytics_events?' + query({ session_id: 'eq.' + id }));
    assert.equal(events.length, 2); assert.equal(JSON.stringify(events).includes('never-store-field-value'), false);
    const pages = await database('alm_ai_page_visits?' + query({ session_id: 'eq.' + id }));
    assert.equal(pages.length, 1); assert.equal(pages[0].active_seconds, 30); assert.equal(pages[0].scroll_percent, 75);
    const report = await fetch(origin + '/api/admin/analytics?days=0', { headers: { Cookie: cookie } });
    assert.equal(report.status, 200); assert.match(report.headers.get('cache-control'), /no-store/);
    const data = await report.json(); assert.ok(data.summary); assert.equal(data.recent.some(r => r.id === id), false);
    assert.equal((await fetch(origin + '/api/analytics', { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: JSON.stringify(payload) })).status, 403);
    console.log('PASS analytics production: authentication, persistence, deduplication, privacy, page metrics, report and test exclusion.');
    console.log(JSON.stringify({ realSessions: data.summary.sessions, realVisitors: data.summary.visitors, startedAt: data.startedAt }));
  } finally {
    await database('alm_ai_sessions?' + query({ id: 'eq.' + id, is_test: 'eq.true', 'utm->>utm_source': 'eq.analytics-verification' }), { method: 'DELETE' });
    if (cookie) await fetch(origin + '/api/admin/session', { method: 'DELETE', headers: { ...headers, Cookie: cookie } });
    console.log('Synthetic analytics session removed.');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
