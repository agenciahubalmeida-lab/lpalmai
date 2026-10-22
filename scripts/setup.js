// Configuração do projeto. Segredos são lidos em memória e nunca impressos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const webpush = require('web-push');
const root = path.resolve(__dirname, '..');
const localFile = path.join(root, '.env.local');
const sourceFile = path.resolve(root, '../SALA 404 -LP WHATSAPP/.env.local');
const managementTokenFile = 'C:/Users/sonyv/.supabase/access-token';
function env(file = localFile) { return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}; }
function projectRef() {
  const url = new URL(env().SUPABASE_URL);
  const ref = url.hostname.split('.')[0];
  if (!/^[a-z]{20}$/.test(ref) || url.hostname !== ref + '.supabase.co') throw Error('Projeto Supabase inválido.');
  return ref;
}
async function sql(query, sensitive = false) {
  const token = fs.readFileSync(managementTokenFile, 'utf8').trim();
  const response = await fetch('https://api.supabase.com/v1/projects/' + projectRef() + '/database/query', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error('Supabase SQL HTTP ' + response.status + (sensitive ? '' : ': ' + JSON.stringify(data).slice(0, 1000)));
  return data;
}
async function run(mode) {
  if (mode === 'check') {
    console.log(JSON.stringify(await sql("select current_database() as database, exists(select 1 from pg_extension where extname='pg_cron') as cron, exists(select 1 from pg_extension where extname='pg_net') as net, exists(select 1 from pg_extension where extname='supabase_vault') as vault, exists(select 1 from pg_tables where schemaname='public' and tablename='alm_ai_leads') as alm_table")));
  } else if (mode === 'bootstrap') {
    const current = env(), source = env(sourceFile);
    if (!source.ADMIN_PASSWORD) throw Error('A senha do painel de referência não está configurada.');
    current.ADMIN_PASSWORD ||= source.ADMIN_PASSWORD;
    current.ADMIN_SESSION_SECRET ||= crypto.randomBytes(48).toString('base64url');
    current.CRON_SECRET ||= crypto.randomBytes(48).toString('base64url');
    if (!current.VAPID_PUBLIC_KEY || !current.VAPID_PRIVATE_KEY) {
      const keys = webpush.generateVAPIDKeys(); current.VAPID_PUBLIC_KEY = keys.publicKey; current.VAPID_PRIVATE_KEY = keys.privateKey;
    }
    current.ALM_PUBLIC_ORIGIN ||= 'https://lpalmai.hubalmeida.com.br';
    current.VAPID_SUBJECT ||= current.ALM_PUBLIC_ORIGIN + '/painel';
    fs.writeFileSync(localFile, Object.entries(current).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n');
    console.log('Configuração privada local preparada; chaves de sessão e push próprias da ALM AI.');
  } else if (mode === 'use-alm-database') {
    const ref = 'tbtqdpnbelqpvxgquoeq';
    const token = fs.readFileSync(managementTokenFile, 'utf8').trim();
    const response = await fetch('https://api.supabase.com/v1/projects/' + ref + '/api-keys', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
    const keys = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(keys)) throw Error('Não foi possível obter a configuração do banco ALM AI.');
    const server = keys.find(key => key.name === 'service_role');
    if (!server?.api_key) throw Error('Chave de servidor não disponível.');
    const current = env(); current.SUPABASE_URL = 'https://' + ref + '.supabase.co'; current.SUPABASE_SERVICE_ROLE_KEY = server.api_key;
    fs.writeFileSync(localFile, Object.entries(current).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n');
    console.log('Banco ativo da ALM AI selecionado; configuração salva apenas no ambiente privado.');
  } else if (mode === 'database') {
    await sql(fs.readFileSync(path.join(root, 'supabase/001_alm_ai.sql'), 'utf8'));
    console.log('Tabelas, políticas e funções da ALM AI criadas.');
  } else if (mode === 'env') {
    const config = env();
    const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET', 'CRON_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'ALM_PUBLIC_ORIGIN'];
    const auth = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'com.vercel.cli/Data/auth.json'), 'utf8'));
    const project = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'));
    if (keys.some(key => !config[key])) throw Error('Configuração local incompleta.');
    const response = await fetch('https://api.vercel.com/v10/projects/' + project.projectId + '/env?upsert=true&teamId=' + project.orgId, {
      method: 'POST', headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(keys.map(key => ({ key, value: config[key], type: 'sensitive', target: ['production', 'preview'] }))), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error || result.failed?.length) throw Error('Falha ao configurar o ambiente Vercel (HTTP ' + response.status + ').');
    console.log('Nove variáveis privadas configuradas na Vercel; variáveis Meta preservadas.');
  } else if (mode === 'schedule') {
    const config = env();
    if (!config.CRON_SECRET || !config.ALM_PUBLIC_ORIGIN) throw Error('Configuração incompleta.');
    const quote = text => "'" + text.replace(/'/g, "''") + "'";
    await sql("create extension if not exists pg_cron with schema pg_catalog; create extension if not exists pg_net with schema extensions;");
    const secret = quote(config.CRON_SECRET);
    await sql(`do $setup$ declare secret_id uuid; begin
      select id into secret_id from vault.secrets where name='alm_ai_cron_secret';
      if secret_id is null then perform vault.create_secret(${secret},'alm_ai_cron_secret','ALM AI notification retry');
      else perform vault.update_secret(secret_id,${secret}); end if;
    end; $setup$;`, true);
    const command = `select net.http_post(url:=${quote(config.ALM_PUBLIC_ORIGIN + '/api/cron/deliveries')}, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='alm_ai_cron_secret' limit 1)),body:='{}'::jsonb,timeout_milliseconds:=55000);`;
    const result = await sql('select cron.schedule(\'alm-ai-notifications\',\'* * * * *\',' + quote(command) + ') as job_id;');
    console.log(JSON.stringify({ scheduled: true, job: result[0]?.job_id, interval: '1 minute' }));
    const response = await fetch(config.ALM_PUBLIC_ORIGIN + '/api/cron/deliveries', { method: 'POST', headers: { Authorization: 'Bearer ' + config.CRON_SECRET }, signal: AbortSignal.timeout(60000) });
    console.log('Delivery endpoint check:', response.status, await response.text());
  } else if (mode === 'verify-schedule') {
    console.log(JSON.stringify(await sql("select j.jobid,j.jobname,j.schedule,j.active,(select r.status from cron.job_run_details r where r.jobid=j.jobid order by r.start_time desc limit 1) as last_status,(select n.status_code from net._http_response n where n.content like '%waitingForDevice%' order by n.created desc limit 1) as http_status from cron.job j where j.jobname='alm-ai-notifications'")));
  } else throw Error('Modo desconhecido.');
}
if (require.main === module) run(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { env, sql, run };
