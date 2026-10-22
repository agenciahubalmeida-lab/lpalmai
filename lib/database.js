async function database(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Error('DATABASE_NOT_CONFIGURED');
  const response = await fetch(base.replace(/\/$/, '') + '/rest/v1/' + path, {
    method,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const error = Error('DATABASE_REQUEST_FAILED');
    error.code = details.code;
    error.status = response.status;
    throw error;
  }
  if (method === 'HEAD') return response.headers;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const query = data => new URLSearchParams(data).toString();
async function allowRequest(key, limit = 8) {
  return database('rpc/alm_ai_allow_request', { method: 'POST', body: { p_key: key, p_limit: limit } });
}
module.exports = { database, query, allowRequest };
