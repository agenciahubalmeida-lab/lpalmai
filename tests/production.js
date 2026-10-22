// Verificação explícita após deploy. Dados fictícios são removidos; só cadastra sem aparelhos inscritos.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { env } = require('../scripts/setup');
(async () => {
  const config = env(); Object.assign(process.env, config);
  const { database, query } = require('../lib/database');
  const origin = config.ALM_PUBLIC_ORIGIN;
  const login = await fetch(origin + '/api/admin/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: config.ADMIN_PASSWORD }), signal: AbortSignal.timeout(25000) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' };
  const panel = await (await fetch(origin + '/api/admin/leads', { headers })).json();
  let id;
  try {
    if (panel.deviceCount === 0) {
      const input = { submission_id: crypto.randomUUID(), nome: 'Teste publicação ALM AI', empresa: 'Validação publicação · remover', whats: '11900000000', ig: '', answers: { atende: 'Um time comercial', espera: 'Algumas horas', leads: 'De 500 a 2.000', perdas: ['Demora no primeiro atendimento'], segmento: 'Serviços e consultoria', investimento: 'Sim, se resolver, faz sentido' }, utm: { utm_source: 'production-verification' } };
      const response = await fetch(origin + '/api/leads', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(25000) });
      const saved = await response.json();
      assert.equal(response.status, 200, saved.error); id = saved.id;
      const detail = await (await fetch(origin + '/api/admin/leads?id=' + id, { headers })).json();
      assert.equal(detail.leads[0].respostas.espera, 'Algumas horas');
      assert.equal(detail.leads[0].utm.utm_source, 'production-verification');
      const duplicate = await (await fetch(origin + '/api/leads', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json();
      assert.equal(duplicate.id, id);
      console.log('PASS production: submission stored, answers, UTMs and duplicate retry; no registered phones.');
    } else console.log('Synthetic submission skipped: real phone is registered.');
  } finally {
    if (id) { await database('alm_ai_leads?' + query({ id: 'eq.' + id, nome: 'eq.Teste publicação ALM AI', empresa: 'eq.Validação publicação · remover' }), { method: 'DELETE' }); console.log('Synthetic production record removed.'); }
    await fetch(origin + '/api/admin/session', { method: 'DELETE', headers });
  }
  for (const route of ['/lib/admin.js', '/scripts/setup.js', '/supabase/001_alm_ai.sql', '/.env.local', '/package.json']) assert.equal((await fetch(origin + route)).status, 404, route);
  const response = await fetch(origin + '/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'ALM-Launch-Audit/1.0' }, body: JSON.stringify({ event_name: 'PageView', event_id: 'PageView.panel-deploy.' + Date.now(), event_source_url: origin + '/', test_event_code: 'TESTAUDIT20261022' }) });
  const meta = await response.json(); assert.equal(response.status, 200); assert.equal(meta.events_received, 1);
  console.log('PASS production: private source blocked; Meta CAPI accepted test event.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
