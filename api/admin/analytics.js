const { authorized } = require('../../lib/admin');
const { reply } = require('../../lib/http');
const { database } = require('../../lib/database');
module.exports = async (req, res) => {
  if (!authorized(req)) return reply(res, 401, { error: 'Entre no painel para continuar.' });
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  const days = Number(new URL(req.url, 'https://local.invalid').searchParams.get('days') || 7);
  if (![1, 7, 30, 90, 0].includes(days)) return reply(res, 400, { error: 'Período inválido.' });
  try {
    const data = await database('rpc/alm_ai_analytics_report', { method: 'POST', body: { p_days: days } });
    return reply(res, 200, data);
  } catch { console.error('ALM_ANALYTICS_REPORT_FAILED'); return reply(res, 503, { error: 'Não foi possível carregar as métricas. Tente novamente.' }); }
};
