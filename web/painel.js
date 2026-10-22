(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { authenticated: false, leads: [], stats: {}, cursor: null, filter: 'all', search: '', request: 0, loading: false, registration: null, subscription: null, publicKey: '', deviceCount: 0, pushBusy: false };
  var requestedLead = new URLSearchParams(location.search).get('lead');
  var isInstalled = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  var supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  var fullDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  var teams = { sdr: 'SDR', closer: 'Closer', rec: 'Recuperação', sup: 'Suporte' };
  var labels = { alto: 'Perfil A', medio: 'Perfil B', baixo: 'Perfil C' };
  function node(tag, className, text) { var item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
  function message(id, text) { $(id).textContent = text || ''; }
  function timeout(promise, ms, text) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(Error(text)); }, ms);
      Promise.resolve(promise).then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }
  function friendly(error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'A conexão demorou demais. Tente novamente.';
    if (!navigator.onLine || error instanceof TypeError) return 'Sem conexão. Confira sua internet e tente novamente.';
    return error.message || 'Não foi possível concluir. Tente novamente.';
  }
  async function api(path, options) {
    options = options || {};
    var response = await fetch(path, { method: options.method || 'GET', headers: options.body ? { 'Content-Type': 'application/json' } : {}, body: options.body ? JSON.stringify(options.body) : undefined, cache: 'no-store', signal: AbortSignal.timeout(25000) });
    var data = await response.json().catch(function () { return {}; });
    if (response.status === 401 && path !== '/api/admin/session') showLogin();
    if (!response.ok) throw Error(data.error || 'Não foi possível concluir. Tente novamente.');
    return data;
  }
  function showLogin() {
    state.authenticated = false; state.leads = []; state.stats = {}; state.cursor = null;
    $('leads').replaceChildren(); $('dashboard').hidden = true; $('logout').hidden = true;
    $('login-view').hidden = false; $('opening').hidden = true;
  }
  async function showDashboard() {
    state.authenticated = true; $('login-view').hidden = true; $('opening').hidden = true;
    $('dashboard').hidden = false; $('logout').hidden = false;
    await refresh();
    void preparePush();
  }
  function stats() {
    ['unread', 'today', 'qualified', 'total'].forEach(function (key) { message('stat-' + key, String(state.stats[key] || 0)); });
    if (navigator.setAppBadge && state.authenticated) {
      var value = state.stats.unread || 0;
      Promise.resolve(value ? navigator.setAppBadge(value) : navigator.clearAppBadge()).catch(function () {});
    }
    var pending = state.stats.pendingNotifications || 0;
    $('queue-note').hidden = pending === 0;
    message('queue-note', state.deviceCount === 0 ? 'Seus diagnósticos já estão salvos. Ative as notificações para receber os avisos no iPhone.' : pending + (pending === 1 ? ' aviso aguardando envio. ' : ' avisos aguardando envio. ') + 'O sistema tenta novamente automaticamente.');
  }
  function relative(value) {
    var mins = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
    if (mins < 1) return 'agora';
    if (mins < 60) return 'há ' + mins + ' min';
    if (mins < 1440) return 'há ' + Math.floor(mins / 60) + ' h';
    return date.format(new Date(value));
  }
  function answer(list, label, value, wide) {
    var item = node('div', 'answer' + (wide ? ' wide' : ''));
    item.append(node('dt', '', label));
    var content = node('dd');
    if (Array.isArray(value)) { var ul = node('ul'); value.forEach(function (text) { ul.append(node('li', '', text)); }); content.append(ul); }
    else content.textContent = value || 'Não informado';
    item.append(content); list.append(item);
  }
  async function markRead(lead, card) {
    if (lead.read_at) return;
    try {
      await api('/api/admin/leads', { method: 'POST', body: { action: 'read', id: lead.id } });
      lead.read_at = new Date().toISOString();
      var dot = card.querySelector('.unread-dot'); if (dot) dot.remove();
      state.stats.unread = Math.max(0, (state.stats.unread || 0) - 1); stats();
    } catch (error) { message('panel-error', friendly(error)); $('panel-error').hidden = false; }
  }
  function leadCard(lead) {
    var card = node('details', 'lead-card'); card.dataset.id = lead.id;
    var summary = node('summary');
    summary.append(node('span', 'avatar', (lead.nome || '?').split(/\s+/).slice(0, 2).map(function (v) { return v.charAt(0); }).join('').toUpperCase()));
    var title = node('span', 'lead-title'); title.append(node('b', '', lead.empresa));
    var subtitle = node('span', 'lead-subtitle');
    if (!lead.read_at) { var dot = node('span', 'unread-dot'); dot.setAttribute('aria-label', 'Não lido'); subtitle.append(dot); }
    subtitle.append(node('span', '', lead.nome)); title.append(subtitle); summary.append(title);
    var side = node('span', 'lead-side'); side.append(node('span', 'tier ' + lead.tier, labels[lead.tier] || 'Perfil'), node('span', 'lead-date', relative(lead.created_at)));
    summary.append(side, node('span', 'chevron', '›')); card.append(summary);
    var content = node('div', 'lead-content'), contact = node('div', 'lead-contact');
    var contactText = node('p'); contactText.append(node('b', '', lead.nome), document.createElement('br'), document.createTextNode('+' + lead.whatsapp));
    var wa = node('a', 'whatsapp', 'Chamar no WhatsApp ↗');
    wa.href = 'https://wa.me/' + lead.whatsapp + '?text=' + encodeURIComponent('Olá, ' + lead.nome + '! Aqui é da ALM AI. Recebemos o diagnóstico da ' + lead.empresa + ' (' + lead.protocolo + ') e gostaria de conversar sobre o seu time de agentes.');
    wa.target = '_blank'; wa.rel = 'noopener noreferrer'; contact.append(contactText, wa); content.append(contact);
    var answers = node('dl', 'answers'), a = lead.respostas || {};
    answer(answers, 'Empresa', lead.empresa, true);
    answer(answers, 'Quem atende os leads hoje?', a.atende);
    answer(answers, 'Tempo da primeira resposta', a.espera);
    answer(answers, 'Leads novos por mês', a.leads);
    answer(answers, 'Segmento', a.segmento);
    answer(answers, 'Onde perde vendas', a.perdas || [], true);
    answer(answers, 'Como vê o investimento?', a.investimento, true);
    answer(answers, 'Time sugerido', (lead.team || []).map(function (key) { return teams[key] || key; }).join(' · '));
    answer(answers, 'Instagram ou site', lead.instagram || 'Não informado');
    var utm = lead.utm || {};
    answer(answers, 'Origem', [utm.utm_source, utm.utm_medium].filter(Boolean).join(' / ') || 'Acesso direto ou não identificado');
    answer(answers, 'Campanha', utm.utm_campaign || 'Não informada');
    if (utm.utm_content) answer(answers, 'Anúncio / conteúdo', utm.utm_content);
    if (utm.utm_term) answer(answers, 'Termo', utm.utm_term);
    if (utm.utm_id) answer(answers, 'ID da campanha', utm.utm_id);
    content.append(answers);
    var meta = node('div', 'lead-meta'); meta.append(node('span', '', lead.protocolo), node('span', '', fullDate.format(new Date(lead.created_at)))); content.append(meta); card.append(content);
    card.addEventListener('toggle', function () { if (card.open) void markRead(lead, card); });
    return card;
  }
  function render() {
    var opened = new Set(Array.from($('leads').querySelectorAll('details[open]')).map(function (item) { return item.dataset.id; }));
    var fragment = document.createDocumentFragment();
    state.leads.forEach(function (lead) { var card = leadCard(lead); if (opened.has(lead.id)) card.open = true; fragment.append(card); });
    $('leads').replaceChildren(fragment);
    $('empty').hidden = state.leads.length > 0;
    var filtered = state.filter !== 'all' || !!state.search;
    message('empty-title', filtered ? 'Nenhum diagnóstico com esse filtro.' : 'Tudo pronto para o primeiro contato.');
    message('empty-copy', filtered ? 'Tente outro nome, empresa ou perfil para encontrar o contato.' : 'Assim que alguém concluir o diagnóstico na página, as respostas vão aparecer aqui.');
    message('list-count', state.leads.length ? state.leads.length + ' exibidos' : '');
    $('load-more').hidden = !state.cursor;
    stats();
  }
  async function refresh(more) {
    if (!state.authenticated) return;
    var generation = ++state.request;
    state.loading = true; $('refresh').disabled = true; $('load-more').disabled = true;
    var params = new URLSearchParams();
    if (more && state.cursor) params.set('cursor', state.cursor);
    if (state.search) params.set('q', state.search);
    if (state.filter === 'unread') params.set('unread', '1');
    else if (state.filter !== 'all') params.set('tier', state.filter);
    try {
      var data = await api('/api/admin/leads?' + params);
      if (generation !== state.request || !state.authenticated) return;
      state.leads = more ? state.leads.concat(data.leads.filter(function (lead) { return !state.leads.some(function (item) { return item.id === lead.id; }); })) : data.leads;
      state.stats = data.stats || {}; state.cursor = data.nextCursor; state.publicKey = data.publicKey; state.deviceCount = data.deviceCount;
      $('panel-error').hidden = true; render();
      message('updated-at', 'Atualizado às ' + new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date()) + ' · Horário de Brasília');
      if (requestedLead && /^[0-9a-f-]{36}$/i.test(requestedLead)) {
        var id = requestedLead; requestedLead = null;
        if (!state.leads.some(function (lead) { return lead.id === id; })) {
          var detail = await api('/api/admin/leads?id=' + encodeURIComponent(id));
          if (detail.leads[0]) { state.leads.unshift(detail.leads[0]); render(); }
        }
        var selected = $('leads').querySelector('[data-id="' + id + '"]');
        if (selected) { selected.open = true; selected.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    } catch (error) { if (generation === state.request && state.authenticated) { message('panel-error', friendly(error)); $('panel-error').hidden = false; } }
    finally { if (generation === state.request) { state.loading = false; $('refresh').disabled = false; $('load-more').disabled = false; } }
  }
  function pushButtons() {
    var active = !!state.subscription;
    $('enable-push').disabled = state.pushBusy;
    message('enable-push', active ? 'Reconectar notificações' : 'Ativar notificações');
    $('test-push').hidden = !active; $('disable-push').hidden = !active;
    $('test-push').disabled = state.pushBusy; $('disable-push').disabled = state.pushBusy;
    message('push-state', active ? 'Este aparelho está inscrito nos avisos. Envie um teste para conferir.' : isIOS && !isInstalled ? 'No iPhone, adicione o painel à Tela de Início e abra pelo ícone para ativar.' : 'Ative os avisos para acompanhar novos diagnósticos, mesmo com o painel fechado.');
    $('install-help').hidden = isInstalled && active;
  }
  async function preparePush() {
    if (!('serviceWorker' in navigator)) { pushButtons(); return; }
    state.pushBusy = true; $('enable-push').disabled = true; message('enable-push', 'Preparando avisos…');
    try {
      var registration = await timeout(navigator.serviceWorker.register('/sw.js', { scope: '/painel', updateViaCache: 'none' }), 12000, 'Não foi possível preparar os avisos. Atualize o painel.');
      if (registration.active?.state !== 'activated') {
        await timeout(new Promise(function (resolve, reject) {
          var worker = registration.installing || registration.waiting || registration.active;
          if (!worker) { reject(Error('Atualize o painel para preparar os avisos.')); return; }
          function check() { if (worker.state === 'activated') { worker.removeEventListener('statechange', check); resolve(); } else if (worker.state === 'redundant') { worker.removeEventListener('statechange', check); reject(Error('Atualize o painel para preparar os avisos.')); } }
          worker.addEventListener('statechange', check); check();
        }), 12000, 'A preparação dos avisos demorou demais. Atualize o painel.');
      }
      state.registration = registration;
      if (registration.pushManager) state.subscription = await timeout(registration.pushManager.getSubscription(), 10000, 'Não foi possível verificar os avisos. Atualize o painel.');
    } catch (error) { message('push-message', friendly(error)); }
    finally { state.pushBusy = false; pushButtons(); }
  }
  async function pushAction(action, sub) { return api('/api/admin/push', { method: 'POST', body: { action: action, subscription: sub.toJSON() } }); }
  async function enablePush() {
    if (state.pushBusy) return;
    message('push-message', '');
    if (isIOS && !isInstalled || !supportsPush) { $('install-help').open = true; message('push-message', 'No iPhone, adicione este painel à Tela de Início e abra pelo ícone (iOS 16.4 ou posterior).'); return; }
    if (!state.publicKey) { message('push-message', 'Os avisos ainda não estão disponíveis. Tente atualizar o painel.'); return; }
    if (!state.registration?.active) { await preparePush(); if (state.registration?.active) message('push-message', 'Tudo pronto. Toque em Ativar notificações para continuar.'); return; }
    state.pushBusy = true; $('enable-push').disabled = true;
    try {
      // A permissão é solicitada diretamente no toque, antes de qualquer espera.
      var permission = Notification.permission === 'granted' ? 'granted' : await timeout(Notification.requestPermission(), 30000, 'Confira a permissão de notificações nos Ajustes do iPhone.');
      if (permission !== 'granted') throw Error('Permita as notificações nos Ajustes do iPhone para continuar.');
      message('push-message', 'Conectando este aparelho aos avisos…');
      var raw = atob(state.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
      var key = Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
      var sub = state.subscription || await timeout(state.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 20000, 'A conexão dos avisos demorou demais. Tente novamente.');
      await pushAction('subscribe', sub); state.subscription = sub;
      message('push-message', 'Notificações ativadas neste aparelho. Use Enviar teste e confira no iPhone.');
      void refresh();
    } catch (error) { message('push-message', friendly(error)); }
    finally { state.pushBusy = false; pushButtons(); }
  }
  $('login-form').addEventListener('submit', async function (event) {
    event.preventDefault(); $('login-button').disabled = true; message('login-error', '');
    try { await api('/api/admin/session', { method: 'POST', body: { password: $('password').value } }); $('password').value = ''; await showDashboard(); }
    catch (error) { message('login-error', friendly(error)); }
    finally { $('login-button').disabled = false; }
  });
  $('show-password').addEventListener('click', function () { var show = $('password').type === 'password'; $('password').type = show ? 'text' : 'password'; this.textContent = show ? 'Ocultar' : 'Mostrar'; this.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha'); });
  $('logout').addEventListener('click', async function () { try { await api('/api/admin/session', { method: 'DELETE' }); showLogin(); } catch (error) { message('panel-error', friendly(error)); $('panel-error').hidden = false; } });
  $('refresh').addEventListener('click', function () { void refresh(); });
  $('load-more').addEventListener('click', function () { void refresh(true); });
  $('search-form').addEventListener('submit', function (event) { event.preventDefault(); state.search = $('search').value.trim(); void refresh(); });
  $('search').addEventListener('search', function () { if (!this.value) { state.search = ''; void refresh(); } });
  document.querySelectorAll('[data-filter]').forEach(function (button) { button.addEventListener('click', function () { state.filter = this.dataset.filter; document.querySelectorAll('[data-filter]').forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); }); void refresh(); }); });
  $('enable-push').addEventListener('click', enablePush);
  $('test-push').addEventListener('click', async function () {
    if (!state.subscription || state.pushBusy) return;
    state.pushBusy = true; pushButtons();
    try { await pushAction('test', state.subscription); message('push-message', 'Teste aceito pelo serviço de notificações. Confira se o aviso apareceu no iPhone.'); }
    catch (error) { message('push-message', friendly(error)); }
    finally { state.pushBusy = false; pushButtons(); }
  });
  $('disable-push').addEventListener('click', async function () {
    if (!state.subscription || state.pushBusy) return;
    state.pushBusy = true; pushButtons();
    try { await pushAction('remove', state.subscription); await timeout(state.subscription.unsubscribe(), 10000, 'A inscrição foi removida no servidor. Atualize o painel.'); state.subscription = null; message('push-message', 'Notificações desativadas neste aparelho.'); void refresh(); }
    catch (error) { message('push-message', friendly(error)); }
    finally { state.pushBusy = false; pushButtons(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && state.authenticated && !state.loading) void refresh(); });
  window.addEventListener('online', function () { if (state.authenticated) void refresh(); });
  setInterval(function () { if (document.visibilityState === 'visible' && state.authenticated && !state.loading && !$('leads').querySelector('details[open]') && document.activeElement !== $('search')) void refresh(); }, 30000);
  (async function () { try { var result = await api('/api/admin/session'); if (result.authenticated) await showDashboard(); else showLogin(); } catch (error) { showLogin(); message('login-error', friendly(error)); } })();
})();
