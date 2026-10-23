const { reply, body, sameOrigin, bucket } = require('../lib/http');
const { database, allowRequest } = require('../lib/database');
const { validateAnalytics } = require('../lib/analytics');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return reply(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return reply(res, 403, { error: 'origin_not_allowed' });
  const ua = String(req.headers['user-agent'] || '');
  if (/bot\b|crawler|spider|headless|lighthouse|facebookexternalhit|vercel-screenshot/i.test(ua)) return reply(res, 200, { ok: true, ignored: true });
  let input;
  try { input = validateAnalytics(body(req, 12000), ua); } catch { return reply(res, 400, { error: 'invalid_analytics' }); }
  try {
    if (!await allowRequest(bucket(req, 'analytics').slice(0, 60) + ':' + input.session_id, 100)) return reply(res, 429, { error: 'rate_limited' });
    await database('rpc/alm_ai_ingest_analytics', { method: 'POST', body: { p: input } });
    return reply(res, 200, { ok: true });
  } catch { console.error('ALM_ANALYTICS_PENDING'); return reply(res, 503, { error: 'analytics_unavailable' }); }
};
