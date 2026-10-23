const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateLead, phone } = require('../lib/validation');
const { authorized, createSession, sessionCookie } = require('../lib/admin');
const { safeEndpoint, subscription } = require('../lib/push');
const { sameOrigin } = require('../lib/http');
const fs = require('node:fs');
const vm = require('node:vm');
const input = () => ({ submission_id: crypto.randomUUID(), nome: 'Teste Técnico', empresa: 'Empresa Teste', whats: '(11) 90000-0000', ig: '', answers: { atende: 'Ninguém dá conta de tudo', espera: 'Algumas horas', leads: 'De 500 a 2.000', perdas: ['Demora no primeiro atendimento', 'Follow-up que ninguém faz'], segmento: 'Serviços e consultoria', investimento: 'Sim, se resolver, faz sentido' }, utm: { utm_source: 'teste', unwanted: 'discard' } });
test('valida respostas, normaliza telefone e calcula perfil no servidor', () => {
  const lead = validateLead(input());
  assert.equal(lead.whatsapp, '5511900000000'); assert.equal(lead.tier, 'alto');
  assert.deepEqual(lead.team, ['sdr', 'closer']); assert.deepEqual(lead.utm, { utm_source: 'teste' });
  const low = input(); low.answers.investimento = 'Agora não cabe'; low.tier = 'alto'; assert.equal(validateLead(low).tier, 'baixo');
});
test('rejeita respostas adulteradas, telefone inválido e identificadores inválidos', () => {
  for (const value of ['00000000000', '12345678901234', '11111111111', '551100000000']) assert.throws(() => phone(value));
  const bad = input(); bad.answers.atende = '__proto__'; assert.throws(() => validateLead(bad));
  const loss = input(); loss.answers.perdas = ['<script>']; assert.throws(() => validateLead(loss));
  const id = input(); id.submission_id = 'invalid'; assert.throws(() => validateLead(id));
});
test('sessões assinadas rejeitam adulteração e cookies públicos', () => {
  process.env.ADMIN_SESSION_SECRET = 's'.repeat(48);
  const session = createSession(), req = { headers: { cookie: 'alm_ai_admin=' + session } };
  assert.equal(authorized(req), true); assert.equal(authorized({ headers: {} }), false);
  assert.equal(authorized({ headers: { cookie: 'alm_ai_admin=' + session + 'x' } }), false);
  process.env.ADMIN_SESSION_SECRET = 'different'.repeat(8); assert.equal(authorized(req), false);
  assert.match(sessionCookie(session), /HttpOnly; SameSite=Strict/);
});
test('mutação rejeita origem estrangeira', () => {
  process.env.ALM_PUBLIC_ORIGIN = 'https://lpalmai.hubalmeida.com.br';
  assert.equal(sameOrigin({ headers: { origin: 'https://evil.example' } }), false);
  assert.equal(sameOrigin({ headers: {} }), false);
  assert.equal(sameOrigin({ headers: { origin: process.env.ALM_PUBLIC_ORIGIN } }), true);
});
test('push rejeita endpoints privados, esquemas inválidos e chaves truncadas', () => {
  assert.equal(safeEndpoint('https://web.push.apple.com/abc'), true);
  assert.equal(safeEndpoint('https://foo.push.apple.com/abc'), true);
  for (const endpoint of ['http://web.push.apple.com/abc', 'https://web.push.apple.com.evil.example/x', 'https://127.0.0.1/x', 'https://user:pass@web.push.apple.com/x', 'https://web.push.apple.com:444/x']) assert.equal(safeEndpoint(endpoint), false);
  assert.throws(() => subscription({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'short', auth: 'bad' } }));
});
test('dados privados e código do servidor ficam fora da saída estática', () => {
  require('../scripts/build');
  const output = fs.readdirSync('public');
  for (const name of ['.env.local', 'lib', 'api', 'scripts', 'supabase', 'package.json']) assert.equal(output.includes(name), false);
  for (const name of ['index.html', 'painel.html', 'painel.js', 'sw.js', 'manifest.webmanifest']) assert.equal(output.includes(name), true);
  const landing = fs.readFileSync('public/index.html', 'utf8');
  assert.equal(landing.includes('fonts.googleapis.com'), false);
  assert.equal(landing.includes('src="/analytics.js"'), false);
  assert.ok(landing.includes('window.ALMAnalytics ='));
  for (const match of landing.matchAll(/\/assets\/[\w.-]+\.(?:woff2|webp)/g)) assert.ok(fs.existsSync('public' + match[0]), match[0]);
  for (const match of landing.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  const sw = fs.readFileSync('web/sw.js', 'utf8'); assert.equal(sw.includes("addEventListener('fetch'"), false);
  const panel = fs.readFileSync('web/painel.js', 'utf8'); assert.equal(panel.includes('localStorage'), false); assert.equal(panel.includes('innerHTML'), false);
});
test('scripts do navegador têm sintaxe válida; gravação ocorre antes do evento Lead', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  new vm.Script(fs.readFileSync('web/painel.js', 'utf8')); new vm.Script(fs.readFileSync('web/sw.js', 'utf8'));
  assert.ok(html.indexOf("await fetch('/api/leads'") < html.indexOf("TRACK.track('Lead'"));
  assert.match(html, /event_id:'Lead\.'\+saved.id/);
});
