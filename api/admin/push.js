const { authorized } = require('../../lib/admin');
const { reply, body, sameOrigin } = require('../../lib/http');
const { database, query } = require('../../lib/database');
const { subscription, sendPush, deliverNotifications } = require('../../lib/push');
module.exports = async (req, res) => {
  if (!authorized(req)) return reply(res, 401, { error: 'Entre no painel para continuar.' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(res, 405, { error: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return reply(res, 403, { error: 'Origem não permitida.' });
  let input, sub;
  try { input = body(req, 5000); sub = subscription(input.subscription); }
  catch { return reply(res, 400, { error: 'Inscrição de notificações inválida.' }); }
  try {
    if (input.action === 'subscribe') {
      await database('alm_ai_push_subscriptions?on_conflict=endpoint', { method: 'POST', body: sub, prefer: 'resolution=merge-duplicates,return=minimal' });
      try { await deliverNotifications(); } catch { console.error('ALM_PUSH_BACKLOG_PENDING'); }
    } else if (input.action === 'remove') {
      await database('alm_ai_push_subscriptions?' + query({ endpoint: 'eq.' + sub.endpoint }), { method: 'DELETE' });
    } else if (input.action === 'test') {
      const rows = await database('alm_ai_push_subscriptions?' + query({ select: 'endpoint,keys', endpoint: 'eq.' + sub.endpoint, limit: '1' }));
      if (!rows?.length) return reply(res, 404, { error: 'Ative as notificações neste aparelho primeiro.' });
      await sendPush(rows[0], { title: 'ALM AI · Teste de notificação', body: 'Os avisos estão prontos. Novos diagnósticos vão aparecer aqui.', tag: 'alm-test' });
    } else return reply(res, 400, { error: 'Ação inválida.' });
    return reply(res, 200, { ok: true });
  } catch { return reply(res, 503, { error: 'Não foi possível concluir. Verifique sua conexão e tente novamente.' }); }
};
