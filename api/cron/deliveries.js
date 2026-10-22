const { equal, reply } = require('../../lib/http');
const { deliverNotifications } = require('../../lib/push');
module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return reply(res, 405, { error: 'method_not_allowed' });
  if (!equal(req.headers.authorization || '', 'Bearer ' + (process.env.CRON_SECRET || '')) || !process.env.CRON_SECRET) return reply(res, 401, { error: 'unauthorized' });
  try { return reply(res, 200, { ok: true, ...await deliverNotifications() }); }
  catch { return reply(res, 503, { error: 'delivery_unavailable' }); }
};
