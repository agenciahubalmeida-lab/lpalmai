const { authorized, createSession, sessionCookie } = require('../../lib/admin');
const { reply, body, sameOrigin, bucket, equal } = require('../../lib/http');
const { allowRequest } = require('../../lib/database');
module.exports = async (req, res) => {
  if (req.method === 'GET') return reply(res, 200, { authenticated: authorized(req) });
  if (!['POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, POST, DELETE'); return reply(res, 405, { error: 'Método não permitido.' }); }
  if (!sameOrigin(req)) return reply(res, 403, { error: 'Origem não permitida.' });
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', sessionCookie('', true)); return reply(res, 200, { ok: true }); }
  try {
    const input = body(req, 1000);
    if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET) throw Error('ADMIN_NOT_CONFIGURED');
    if (!await allowRequest(bucket(req, 'login'), 8)) return reply(res, 429, { error: 'Muitas tentativas. Aguarde 10 minutos.' });
    if (!equal(input.password, process.env.ADMIN_PASSWORD)) return reply(res, 401, { error: 'Senha incorreta.' });
    res.setHeader('Set-Cookie', sessionCookie(createSession()));
    return reply(res, 200, { ok: true });
  } catch { return reply(res, 503, { error: 'O acesso está indisponível no momento. Tente novamente.' }); }
};
