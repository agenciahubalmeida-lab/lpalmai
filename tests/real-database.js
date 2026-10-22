// Teste explícito no banco configurado. Sem envios Meta e somente sem aparelhos inscritos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { env, sql } = require('../scripts/setup');
(async () => {
  const config = env();
  Object.assign(process.env, config);
  const { database, query } = require('../lib/database');
  const devices = await database('alm_ai_push_subscriptions?select=endpoint&limit=1');
  if (devices.length) throw Error('Teste cancelado: há aparelhos reais inscritos.');
  await sql(fs.readFileSync('tests/database.sql', 'utf8'));
  console.log('PASS SQL: RLS, permissões, gravação, idempotência, locks da fila e limite de tentativas; transação revertida.');
  const ref = new URL(config.SUPABASE_URL).hostname.split('.')[0];
  const token = fs.readFileSync('C:/Users/sonyv/.supabase/access-token', 'utf8').trim();
  const keys = await (await fetch('https://api.supabase.com/v1/projects/' + ref + '/api-keys', { headers: { Authorization: 'Bearer ' + token } })).json();
  const anon = keys.find(key => key.name === 'anon').api_key;
  const denied = await fetch(config.SUPABASE_URL + '/rest/v1/alm_ai_leads?select=id&limit=1', { headers: { apikey: anon, Authorization: 'Bearer ' + anon } });
  const denial = await denied.json();
  assert.ok([401,403].includes(denied.status)); assert.equal(denial.code, '42501');
  console.log('PASS REST: leitura pública dos diagnósticos bloqueada por permissão (HTTP ' + denied.status + ').');
  const origin = 'http://127.0.0.1:3034';
  const app = spawn(process.execPath, ['scripts/dev.js'], { env: { ...process.env, PORT: '3034', ALM_PUBLIC_ORIGIN: origin, ALM_TEST_MODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const ids = [];
  try {
    await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(Error('App startup timed out')), 15000);
      app.stdout.on('data', chunk => { output += chunk; if (output.includes('Local:')) { clearTimeout(timer); resolve(); } });
      app.on('exit', code => { if (code) { clearTimeout(timer); reject(Error('App startup failed')); } });
      app.stderr.on('data', () => {});
    });
    let cookie = '';
    const request = (route, method = 'GET', body) => fetch(origin + route, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
    assert.equal((await request('/api/admin/leads')).status, 401);
    const login = await request('/api/admin/session', 'POST', { password: config.ADMIN_PASSWORD });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
    const input = { submission_id: crypto.randomUUID(), nome: 'Teste técnico ALM AI', empresa: 'Validação técnica · remover', whats: '11900000000', ig: '', answers: { atende: 'Um time comercial', espera: 'Algumas horas', leads: 'De 500 a 2.000', perdas: ['Demora no primeiro atendimento'], segmento: 'Serviços e consultoria', investimento: 'Sim, se resolver, faz sentido' }, utm: { utm_source: 'technical-verification', utm_campaign: 'technical-verification' } };
    const response = await request('/api/leads', 'POST', input); const saved = await response.json();
    assert.equal(response.status, 200); assert.equal(saved.ok, true); ids.push(saved.id);
    const duplicate = await (await request('/api/leads', 'POST', input)).json(); assert.equal(duplicate.id, saved.id);
    const result = await (await request('/api/admin/leads?id=' + saved.id)).json();
    assert.equal(result.leads.length, 1); assert.equal(result.leads[0].respostas.espera, 'Algumas horas');
    assert.equal(result.leads[0].utm.utm_source, 'technical-verification');
    assert.equal((await request('/api/admin/leads', 'POST', { action: 'read', id: saved.id })).status, 200);
    const read = await (await request('/api/admin/leads?id=' + saved.id)).json(); assert.ok(read.leads[0].read_at);
    console.log('PASS API + banco real: login, gravação, respostas, UTMs, repetição sem duplicata e marcação como lido.');
  } finally {
    app.kill();
    for (const id of ids) await database('alm_ai_leads?' + query({ id: 'eq.' + id, nome: 'eq.Teste técnico ALM AI', empresa: 'eq.Validação técnica · remover' }), { method: 'DELETE' });
    console.log('Registros fictícios desta verificação removidos; nenhum envio ao celular ou à Meta.');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
