const http = require('node:http');
const crypto = require('node:crypto');
function fixture(overrides = {}) {
  return { id: crypto.randomUUID(), submission_id: crypto.randomUUID(), protocolo: 'ALM-DEMONSTRACAO', nome: 'Marina Teste', empresa: 'Aurora Studio · demonstração', whatsapp: '5511900000000', instagram: '@demonstracao', respostas: { atende: 'Uma pessoa do time', espera: 'Algumas horas', leads: 'De 500 a 2.000', perdas: ['Demora no primeiro atendimento', 'Follow-up que ninguém faz'], segmento: 'Serviços e consultoria', investimento: 'Sim, se resolver, faz sentido' }, tier: 'alto', team: ['sdr', 'closer'], utm: { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'Time comercial de IA' }, source_url: 'https://lpalmai.hubalmeida.com.br/', created_at: new Date().toISOString(), read_at: null, notification_sent_at: null, notification_attempts: 0, notification_next_at: new Date().toISOString(), notification_lock_until: null, notification_error: null, ...overrides };
}
async function startMockDatabase(port = 0, seed = []) {
  const state = { leads: [...seed], subscriptions: [], receipts: [], requests: 0, rates: new Map() };
  const server = http.createServer(async (req, res) => {
    state.requests++;
    res.setHeader('Content-Type', 'application/json');
    const respond = (code, data) => { res.statusCode = code; res.end(data === undefined ? '' : JSON.stringify(data)); };
    if (req.headers.apikey !== 'test-service-key') return respond(401, { message: 'wrong test key' });
    const url = new URL(req.url, 'http://local');
    const route = url.pathname.replace('/rest/v1/', '');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (route === 'rpc/alm_ai_allow_request') {
      const rate = (state.rates.get(body.p_key) || 0) + 1; state.rates.set(body.p_key, rate); return respond(200, rate <= body.p_limit);
    }
    if (route === 'rpc/alm_ai_save_lead') {
      let lead = state.leads.find(item => item.submission_id === body.p_lead.submission_id);
      if (!lead) { lead = fixture(body.p_lead); state.leads.push(lead); }
      return respond(200, { id: lead.id, protocolo: lead.protocolo, tier: lead.tier, team: lead.team });
    }
    if (route === 'rpc/alm_ai_stats') return respond(200, { total: state.leads.length, unread: state.leads.filter(l => !l.read_at).length, qualified: state.leads.filter(l => l.tier !== 'baixo').length, today: state.leads.length, pendingNotifications: state.leads.filter(l => !l.notification_sent_at).length });
    if (route === 'rpc/alm_ai_claim_notifications') {
      const pending = state.leads.filter(l => !l.notification_sent_at && Date.parse(l.notification_next_at) <= Date.now() && (!l.notification_lock_until || Date.parse(l.notification_lock_until) < Date.now()) && (!body.p_lead_id || body.p_lead_id === l.id)).slice(0, body.p_limit);
      for (const lead of pending) { lead.notification_attempts++; lead.notification_lock_until = new Date(Date.now() + 120000).toISOString(); }
      return respond(200, pending);
    }
    if (route === 'alm_ai_leads') {
      let rows = [...state.leads].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const id = url.searchParams.get('id'); if (id) rows = rows.filter(l => l.id === id.slice(3));
      const tier = url.searchParams.get('tier'); if (tier) rows = rows.filter(l => l.tier === tier.slice(3));
      if (url.searchParams.get('read_at') === 'is.null') rows = rows.filter(l => !l.read_at);
      const combined = (url.searchParams.get('or') || '') + (url.searchParams.get('and') || '');
      const term = combined.match(/nome\.ilike\.\*([^*]+)\*/)?.[1];
      if (term) rows = rows.filter(l => (l.nome + ' ' + l.empresa + ' ' + l.whatsapp).toLowerCase().includes(term.toLowerCase()));
      const cursor = combined.match(/created_at\.lt\.([^,]+)/)?.[1];
      if (cursor) rows = rows.filter(l => l.created_at < cursor || l.created_at === cursor && l.id < (combined.match(/id\.lt\.([0-9a-f-]+)/)?.[1] || ''));
      if (req.method === 'PATCH') { rows.forEach(l => Object.assign(l, body)); return respond(204); }
      if (req.method === 'DELETE') { state.leads = state.leads.filter(l => !rows.includes(l)); return respond(204); }
      return respond(200, rows.slice(0, Number(url.searchParams.get('limit') || 1000)));
    }
    if (route === 'alm_ai_push_subscriptions') {
      if (req.method === 'HEAD') { res.setHeader('Content-Range', '*/' + state.subscriptions.length); return respond(200); }
      const endpoint = url.searchParams.get('endpoint')?.slice(3);
      if (req.method === 'POST') { state.subscriptions = state.subscriptions.filter(s => s.endpoint !== body.endpoint); state.subscriptions.push(body); return respond(201); }
      if (req.method === 'DELETE') { state.subscriptions = state.subscriptions.filter(s => s.endpoint !== endpoint); return respond(204); }
      return respond(200, state.subscriptions.filter(s => !endpoint || s.endpoint === endpoint));
    }
    if (route === 'alm_ai_push_receipts') {
      if (req.method === 'POST') { state.receipts.push(body); return respond(201); }
      return respond(200, state.receipts.filter(r => r.lead_id === url.searchParams.get('lead_id')?.slice(3) && r.endpoint === url.searchParams.get('endpoint')?.slice(3)));
    }
    return respond(404, { message: 'unknown mock route ' + route });
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { state, server, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { startMockDatabase, fixture };
