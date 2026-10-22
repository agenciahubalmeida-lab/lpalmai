const { authorized } = require('../../lib/admin');
const { reply, body, sameOrigin, uuid } = require('../../lib/http');
const { database, query } = require('../../lib/database');
const columns = 'id,protocolo,nome,empresa,whatsapp,instagram,respostas,tier,team,utm,created_at,read_at,notification_sent_at,notification_error';
module.exports = async (req, res) => {
  if (!authorized(req)) return reply(res, 401, { error: 'Entre no painel para continuar.' });
  try {
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return reply(res, 403, { error: 'Origem não permitida.' });
      const input = body(req, 1000);
      if (!uuid(input.id) || input.action !== 'read') return reply(res, 400, { error: 'Diagnóstico inválido.' });
      await database('alm_ai_leads?' + query({ id: 'eq.' + input.id, read_at: 'is.null' }), { method: 'PATCH', body: { read_at: new Date().toISOString() } });
      return reply(res, 200, { ok: true });
    }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return reply(res, 405, { error: 'Método não permitido.' }); }
    const url = new URL(req.url, 'https://local.invalid');
    const id = url.searchParams.get('id');
    const params = { select: columns, order: 'created_at.desc,id.desc', limit: '51' };
    if (id) { if (!uuid(id)) return reply(res, 400, { error: 'Diagnóstico inválido.' }); params.id = 'eq.' + id; }
    const tier = url.searchParams.get('tier');
    if (tier && ['alto', 'medio', 'baixo'].includes(tier)) params.tier = 'eq.' + tier;
    if (url.searchParams.get('unread') === '1') params.read_at = 'is.null';
    const search = (url.searchParams.get('q') || '').slice(0, 100).replace(/[^\p{L}\p{N}\s@+-]/gu, '').trim();
    if (search) params.or = '(nome.ilike.*' + search + '*,empresa.ilike.*' + search + '*,whatsapp.ilike.*' + (search.replace(/\D/g, '') || 'nomatch') + '*)';
    const cursor = url.searchParams.get('cursor');
    if (cursor) {
      let parsed;
      try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { return reply(res, 400, { error: 'Página inválida.' }); }
      if (!uuid(parsed.id) || typeof parsed.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(parsed.created_at) || !Number.isFinite(Date.parse(parsed.created_at))) return reply(res, 400, { error: 'Página inválida.' });
      const page = '(created_at.lt.' + parsed.created_at + ',and(created_at.eq.' + parsed.created_at + ',id.lt.' + parsed.id + '))';
      if (params.or) { params.and = '(or' + params.or + ',or' + page + ')'; delete params.or; }
      else params.or = page;
    }
    const [rows, stats, devices] = await Promise.all([
      database('alm_ai_leads?' + query(params)),
      database('rpc/alm_ai_stats', { method: 'POST', body: {} }),
      database('alm_ai_push_subscriptions?select=endpoint', { method: 'HEAD', prefer: 'count=exact' }),
    ]);
    const leads = (rows || []).slice(0, 50);
    const last = leads[leads.length - 1];
    const nextCursor = rows?.length > 50 && last ? Buffer.from(JSON.stringify({ id: last.id, created_at: last.created_at })).toString('base64url') : null;
    const deviceCount = Number((devices.get('content-range') || '*/0').split('/')[1]) || 0;
    return reply(res, 200, { leads, nextCursor, stats, deviceCount, publicKey: process.env.VAPID_PUBLIC_KEY || '' });
  } catch (error) { console.error('ALM_PANEL_FAILED', error.code || error.message); return reply(res, 503, { error: 'Não foi possível carregar os diagnósticos. Tente novamente.' }); }
};
