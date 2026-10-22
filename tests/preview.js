// Prévia local com dados inteiramente fictícios. Nenhum acesso ao Supabase ou envio externo.
const { spawn } = require('node:child_process');
const webpush = require('web-push');
const { startMockDatabase, fixture } = require('./mock-database');
(async () => {
  const seed = [
    fixture(),
    fixture({ nome: 'Rafael Exemplo', empresa: 'Nexo Consultoria · demonstração', tier: 'medio', created_at: new Date(Date.now() - 3500000).toISOString(), read_at: new Date().toISOString() }),
    fixture({ nome: 'Ana Demonstração', empresa: 'Estúdio Horizonte · demonstração', tier: 'baixo', created_at: new Date(Date.now() - 7000000).toISOString() }),
  ];
  const mock = await startMockDatabase(3031, seed);
  const keys = webpush.generateVAPIDKeys();
  const child = spawn(process.execPath, ['scripts/dev.js'], { env: { ...process.env, PORT: '3030', ALM_PUBLIC_ORIGIN: 'http://127.0.0.1:3030', SUPABASE_URL: mock.url, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', ADMIN_PASSWORD: 'teste-local-alm', ADMIN_SESSION_SECRET: 'local-preview-secret'.repeat(4), VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'https://example.com', CRON_SECRET: 'local-only-preview-cron', ALM_TEST_MODE: '1' }, stdio: 'inherit', windowsHide: true });
  const close = async () => { child.kill(); await mock.close(); process.exit(0); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
  child.on('exit', async () => { await mock.close(); process.exit(); });
  console.log('Preview only: fictional records, no external deliveries.');
})();
