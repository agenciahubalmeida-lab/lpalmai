# ALM AI · Landing page e painel de diagnósticos

Landing page na Vercel, com Pixel/CAPI e atendimento pelo WhatsApp **+55 11 94556-1399**. As respostas são gravadas no Supabase e podem ser consultadas no painel privado em `/painel`, com Web Push para iPhone.

## Estado da implantação

Publicado em **https://lpalmai.hubalmeida.com.br/painel**. Banco: projeto ativo da ALM AI `tbtqdpnbelqpvxgquoeq`, com tabelas exclusivas `alm_ai_*`. O fluxo de captação grava antes de mostrar sucesso. O job `alm-ai-notifications` consulta a fila a cada minuto no Supabase Cron; o envio imediato ocorre na conclusão do cadastro.

Validação: nove testes automatizados locais, teste transacional no PostgreSQL real, bloqueio de leitura anônima, gravação real, respostas, UTMs, idempotência, login, cookie seguro, APIs privadas e cadastro no domínio de produção. Os registros fictícios foram removidos. A API Meta continuou aceitando eventos de teste após a publicação. A exibição de notificações no iPhone depende da inscrição e permissão no próprio aparelho e ainda precisa ser confirmada nele.

## Uso no iPhone

Abra `https://lpalmai.hubalmeida.com.br/painel` no Safari, escolha **Compartilhar → Adicionar à Tela de Início**, abra o ícone **ALM AI**, entre com a mesma senha do painel Sala 404 e toque em **Ativar notificações → Permitir**. Use **Enviar teste** e confira no iPhone. Requer iOS 16.4 ou posterior. A inscrição do aparelho e a entrega real só podem ser verificadas no próprio telefone.

O painel mostra todas as respostas, contato, empresa, perfil, agentes sugeridos e UTMs. Há busca, filtros, paginação de 50 em 50, indicadores e marcação como lido ao abrir um diagnóstico. Os horários usam America/Sao_Paulo.

## Desenvolvimento

`npm install`, `npm run build`, `npm test`. `npm run dev` inicia em `http://127.0.0.1:3030`, usando `.env.local`. `node tests/preview.js` inicia uma prévia isolada com banco simulado e senha de teste `teste-local-alm`; nenhum envio externo é realizado nessa prévia. Não publique a prévia como produção.

## Servidor e proteção dos dados

O formulário só exibe sucesso e emite Lead depois que `/api/leads` confirma a gravação. Um identificador de submissão evita duplicação em tentativas repetidas. Nome e telefone continuam seguindo à CAPI para hash no servidor; Lead compartilha o identificador do cadastro entre Pixel/CAPI.

Tabelas `alm_ai_*` separadas das tabelas Sala 404, com RLS e acesso apenas do servidor. Sessão assinada de sete dias em cookie HttpOnly, SameSite Strict e Secure na Vercel. APIs privadas usam no-store e validação de origem. Há limite persistente de tentativas de login e cadastro. Arquivos de servidor, testes, SQL e segredos ficam fora da saída estática. O service worker não armazena respostas ou cadastros offline.

Avisos não incluem nome, empresa ou telefone na tela bloqueada. Endpoints de push são validados; recibos por diagnóstico/aparelho evitam reenvios já confirmados. Falhas ficam na fila com novas tentativas e backoff, e endpoints expirados são removidos. Um timeout depois da aceitação pelo provedor pode gerar repetição; a tag do diagnóstico substitui o aviso anterior. Aceitação pelo serviço push não confirma exibição ou leitura no telefone. Sair do painel encerra o acesso aos dados; **Desativar** remove os avisos daquele aparelho.

## Implantação

As variáveis privadas ficam em `.env.local` e na Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `ALM_PUBLIC_ORIGIN`, `CRON_SECRET`. As variáveis Meta existentes devem ser preservadas. Nunca copie segredos para arquivos públicos.

`supabase/001_alm_ai.sql` já foi aplicado no banco ALM AI. `scripts/setup.js` oferece os modos `check`, `bootstrap`, `use-alm-database`, `database`, `env`, `schedule`, `verify-schedule`, mantendo segredos fora dos argumentos e da saída. Em configuração nova, `bootstrap` prepara senha/chaves e `use-alm-database` seleciona o banco ativo da ALM AI. Preserve as chaves VAPID entre deploys. `schedule` configura somente o job `alm-ai-notifications`, a cada minuto no Supabase Cron, com segredo no Vault, para chamar o reenvio na Vercel. O agendamento só deve ser ativado depois do endpoint publicado.

Referências oficiais: [Web Push no iPhone](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Supabase Cron](https://supabase.com/docs/guides/cron), [Vault e agendamentos](https://supabase.com/docs/guides/functions/schedule-functions).
