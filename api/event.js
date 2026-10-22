// Meta Conversions API: recebe os eventos da LP e reenvia ao Meta pelo servidor,
// com o mesmo event_id do Pixel para que o Meta deduplique os dois envios.
const crypto = require('crypto');

const PIXEL_ID = process.env.META_PIXEL_ID || '4396005223955499';
const TOKEN = process.env.META_CAPI_TOKEN;
const API_VERSION = process.env.META_API_VERSION || 'v24.0';
const ALLOWED = new Set(['PageView', 'ViewContent', 'IniciouDiagnostico', 'DiagnosticoEtapa', 'Lead', 'LeadQualificado', 'Contact']);

const sha = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
const lower = (s) => String(s || '').trim().toLowerCase();
const ascii = (s) => lower(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : '';
}

function splitName(full) {
  const parts = lower(full).replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean);
  return { fn: parts[0] || '', ln: parts.length > 1 ? parts[parts.length - 1] : '' };
}

function header(req, name) {
  const v = req.headers[name];
  if (!v) return '';
  try { return decodeURIComponent(Array.isArray(v) ? v[0] : v); } catch (_) { return String(v); }
}

function cleanCustom(cd) {
  const out = {};
  if (!cd || typeof cd !== 'object') return out;
  Object.keys(cd).slice(0, 30).forEach((k) => {
    const v = cd[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 300);
  });
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  if (!TOKEN) {
    console.error('META_CAPI_TOKEN não configurado');
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 12000) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  if (!ALLOWED.has(body.event_name) || typeof body.event_id !== 'string' || body.event_id.length > 120) {
    return res.status(400).json({ ok: false, error: 'bad_event' });
  }

  const ip = (header(req, 'x-vercel-forwarded-for') || header(req, 'x-forwarded-for') || header(req, 'x-real-ip')).split(',')[0].trim();
  const ua = header(req, 'user-agent');

  const user = {};
  if (ip) user.client_ip_address = ip;
  if (ua) user.client_user_agent = ua;
  if (typeof body.fbp === 'string' && /^fb\.\d\./.test(body.fbp)) user.fbp = body.fbp.slice(0, 200);
  if (typeof body.fbc === 'string' && /^fb\.\d\./.test(body.fbc)) user.fbc = body.fbc.slice(0, 500);
  if (typeof body.external_id === 'string' && body.external_id) user.external_id = [sha(lower(body.external_id).slice(0, 100))];

  if (body.user && typeof body.user === 'object') {
    const ph = normPhone(body.user.whats);
    if (ph) user.ph = [sha(ph)];
    const { fn, ln } = splitName(body.user.nome);
    if (fn) user.fn = [sha(fn)];
    if (ln) user.ln = [sha(ln)];
  }

  // Localização aproximada pelo IP (cabeçalhos da Vercel) melhora a qualidade da correspondência.
  const country = lower(header(req, 'x-vercel-ip-country'));
  const st = lower(header(req, 'x-vercel-ip-country-region'));
  const ct = ascii(header(req, 'x-vercel-ip-city')).replace(/[^a-z]/g, '');
  const zp = header(req, 'x-vercel-ip-postal-code').replace(/\D/g, '');
  if (/^[a-z]{2}$/.test(country)) user.country = [sha(country)];
  if (/^[a-z]{2}$/.test(st)) user.st = [sha(st)];
  if (ct) user.ct = [sha(ct)];
  if (zp) user.zp = [sha(zp)];

  const event = {
    event_name: body.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.event_id,
    action_source: 'website',
    event_source_url: typeof body.event_source_url === 'string' ? body.event_source_url.slice(0, 1000) : undefined,
    user_data: user,
    custom_data: cleanCustom(body.custom_data),
  };

  const payload = { data: [event] };
  const testCode = process.env.META_TEST_EVENT_CODE || (typeof body.test_event_code === 'string' && /^TEST\w{1,20}$/.test(body.test_event_code) ? body.test_event_code : '');
  if (testCode) payload.test_event_code = testCode;

  try {
    const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('CAPI erro', r.status, JSON.stringify(j.error || j));
      return res.status(502).json({ ok: false });
    }
    return res.status(200).json({ ok: true, events_received: j.events_received, test: !!testCode });
  } catch (e) {
    console.error('CAPI falha', e && e.message);
    return res.status(502).json({ ok: false });
  }
};
