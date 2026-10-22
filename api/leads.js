const crypto = require('node:crypto');
const { reply, body, sameOrigin, bucket } = require('../lib/http');
const { database, allowRequest } = require('../lib/database');
const { validateLead } = require('../lib/validation');
const { deliverNotifications } = require('../lib/push');
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(res, 405, { error: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return reply(res, 403, { error: 'Origem não permitida.' });
  let lead;
  try { lead = validateLead(body(req)); }
  catch (error) { return reply(res, 400, { error: error.message === 'BODY_TOO_LARGE' ? 'Confira os dados e tente novamente.' : error.message }); }
  try {
    if (!await allowRequest(bucket(req, 'lead'), 12)) return reply(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    const id = crypto.randomUUID();
    const record = { ...lead, id, protocolo: 'ALM-' + id.replace(/-/g, '').slice(0, 10).toUpperCase() };
    const saved = await database('rpc/alm_ai_save_lead', { method: 'POST', body: { p_lead: record } });
    try { await deliverNotifications(saved.id); }
    catch { console.error('ALM_NOTIFICATION_PENDING'); }
    return reply(res, 200, { ok: true, id: saved.id, protocolo: saved.protocolo, tier: saved.tier, team: saved.team });
  } catch (error) {
    console.error('ALM_LEAD_SAVE_FAILED', error.code || error.message);
    return reply(res, 503, { error: 'Não foi possível salvar seu diagnóstico agora. Suas respostas continuam aqui. Tente novamente.' });
  }
};
