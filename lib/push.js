const webpush = require('web-push');
const { database, query } = require('./database');
const { uuid } = require('./http');
function safeEndpoint(value) {
  try {
    const u = new URL(value);
    return value.length <= 2048 && u.protocol === 'https:' && !u.username && !u.password && !u.port && (
      u.hostname === 'web.push.apple.com' || u.hostname.endsWith('.push.apple.com') || u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com'
    );
  } catch { return false; }
}
function subscription(input) {
  if (!input || typeof input.endpoint !== 'string' || !safeEndpoint(input.endpoint)) throw Error('INVALID_SUBSCRIPTION');
  const keys = input.keys;
  if (!keys || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)) throw Error('INVALID_SUBSCRIPTION');
  if (Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) throw Error('INVALID_SUBSCRIPTION');
  return { endpoint: input.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
async function sendPush(sub, payload) {
  if (!safeEndpoint(sub.endpoint)) throw Error('INVALID_PUSH_ENDPOINT');
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env;
  if (!publicKey || !privateKey || !subject) throw Error('PUSH_NOT_CONFIGURED');
  return webpush.sendNotification(sub, JSON.stringify(payload), { vapidDetails: { publicKey, privateKey, subject }, TTL: 86400, timeout: 8000 });
}
async function deliverNotifications(leadId = null) {
  if (leadId && !uuid(leadId)) throw Error('INVALID_LEAD_ID');
  const devices = await database('alm_ai_push_subscriptions?select=endpoint,keys&limit=20');
  if (!devices?.length) return { sent: 0, waitingForDevice: true };
  const jobs = await database('rpc/alm_ai_claim_notifications', { method: 'POST', body: { p_limit: leadId ? 1 : 5, p_lead_id: leadId } });
  let sent = 0;
  for (const job of jobs || []) {
    try {
      let accepted = 0;
      for (const device of devices) {
        const receipts = await database('alm_ai_push_receipts?' + query({ select: 'lead_id', lead_id: 'eq.' + job.id, endpoint: 'eq.' + device.endpoint, limit: '1' }));
        if (receipts?.length) { accepted++; continue; }
        try {
          await sendPush(device, { title: 'ALM AI · Novo diagnóstico', body: 'Um novo diagnóstico chegou. Toque para ver todas as respostas.', tag: 'alm-' + job.id, lead_id: job.id });
          await database('alm_ai_push_receipts?on_conflict=lead_id,endpoint', { method: 'POST', body: { lead_id: job.id, endpoint: device.endpoint }, prefer: 'resolution=ignore-duplicates,return=minimal' });
          accepted++;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await database('alm_ai_push_subscriptions?' + query({ endpoint: 'eq.' + device.endpoint }), { method: 'DELETE' });
          } else throw Error('PUSH_DELIVERY_FAILED');
        }
      }
      if (!accepted) throw Error('NO_ACTIVE_PUSH_DEVICES');
      await database('alm_ai_leads?' + query({ id: 'eq.' + job.id }), { method: 'PATCH', body: { notification_sent_at: new Date().toISOString(), notification_error: null, notification_lock_until: null } });
      sent++;
    } catch (error) {
      const retry = Math.min(3600, 60 * 2 ** Math.min(job.notification_attempts - 1, 6));
      await database('alm_ai_leads?' + query({ id: 'eq.' + job.id }), { method: 'PATCH', body: { notification_error: error.message === 'NO_ACTIVE_PUSH_DEVICES' ? error.message : 'PUSH_DELIVERY_FAILED', notification_lock_until: null, notification_next_at: new Date(Date.now() + retry * 1000).toISOString() } });
    }
  }
  return { sent, attempted: jobs?.length || 0 };
}
module.exports = { safeEndpoint, subscription, sendPush, deliverNotifications };
