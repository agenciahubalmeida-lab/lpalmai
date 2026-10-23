(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); }, generation = 0, authenticated = false;
  var numbers = new Intl.NumberFormat('pt-BR');
  var formatDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  function n(value) { return numbers.format(Number(value) || 0); }
  function percent(part, total) { return total ? (part / total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '0%'; }
  function duration(value) { value = Number(value) || 0; return value >= 60 ? Math.floor(value / 60) + ' min ' + value % 60 + ' s' : value + ' s'; }
  function node(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; }
  function table(id, rows) {
    var target = $(id); target.replaceChildren();
    if (!rows.length) { var empty = node('tr'); var cell = node('td', '', 'Ainda sem registros neste período.'); cell.colSpan = 6; empty.append(cell); target.append(empty); return; }
    rows.forEach(function (cells) { var tr = node('tr'); cells.forEach(function (value) { var td = node('td'); if (Array.isArray(value)) { td.append(document.createTextNode(value[0] || '—'), node('small', '', value[1] || '')); } else td.textContent = value; tr.append(td); }); target.append(tr); });
  }
  function metrics(id, rows) { $(id).replaceChildren(); rows.forEach(function (r) { var row = node('div', 'metric-row'); row.append(node('span', '', r[0]), node('b', '', r[1])); $(id).append(row); }); }
  function render(data) {
    var s = data.summary || {}, cards = [
      ['Visitas / sessões', n(s.sessions), n(s.pageviews) + ' carregamentos da página'],
      ['Navegadores únicos', n(s.visitors), n(s.returningSessions) + ' sessões de retorno'],
      ['Saíram sem responder', n(s.untouched), 'Sem iniciar; 30 min sem atividade'],
      ['Abandonaram o diagnóstico', n(s.abandoned), 'Iniciaram, mas não salvaram'],
      ['Cadastros / sessões', n(s.conversions), percent(s.conversions, s.sessions) + ' de conversão da visita'],
      ['Cliques no WhatsApp', n(s.whatsapp), 'Sessões com clique; não confirma envio'],
      ['Saíram sem concluir', n(s.notConverted), 'Inclui quem nem começou a responder'],
      ['Atividade nos últimos 2 min', n(s.online), 'Sinal recente; estimativa de presença']
    ];
    $('traffic-cards').replaceChildren(); cards.forEach(function (c) { var card = node('div', 'traffic-card'); card.append(node('span', '', c[0]), node('b', '', c[1]), node('small', '', c[2])); $('traffic-cards').append(card); });
    var funnel = [['Entraram no site', s.sessions], ['Clicaram para o diagnóstico', s.cta], ['Viram o formulário', s.quizViewed], ['Começaram a responder', s.quizStarted], ['Digitaram no contato', s.contactStarted], ['Diagnósticos salvos', s.conversions], ['Clicaram no WhatsApp', s.whatsapp]];
    $('traffic-funnel').replaceChildren(); funnel.forEach(function (item) { var row = node('div', 'funnel-row'), text = node('div'), value = node('b', '', n(item[1])); value.append(node('small', '', ' · ' + percent(item[1], s.sessions) + ' das sessões')); text.append(node('span', '', item[0]), value); var bar = node('progress'); bar.max = Math.max(1, s.sessions || 0); bar.value = item[1] || 0; bar.setAttribute('aria-label', item[0]); row.append(text, bar); $('traffic-funnel').append(row); });
    var steps = ['Quem atende', 'Tempo de resposta', 'Volume de leads', 'Perdas de venda', 'Segmento', 'Investimento', 'Contato'];
    table('traffic-steps', (data.steps || []).map(function (r) { return [r.step + '. ' + steps[r.step - 1], n(r.reached), n(r.answered), n(r.abandoned)]; }));
    metrics('traffic-engagement', [['Tempo ativo médio', duration(s.avgActiveSeconds)], ['Sessões com interesse', n(s.engaged) + ' · ' + percent(s.engaged, s.sessions)], ['Ainda não encerradas', n(s.activeSessions)], ['Erros de preenchimento', n(s.formErrors)], ['Falhas ao salvar', n(s.submitErrors)]]);
    metrics('traffic-scroll', (data.scroll || []).map(function (r) { return ['Chegaram a ' + r.percent + '%', n(r.sessions) + ' · ' + percent(r.sessions, s.sessions)]; }));
    var ctas = { header: 'Menu superior', hero: 'Início da página', final: 'Fim da página', floating: 'Botão fixo no celular', other: 'Outros botões' };
    metrics('traffic-ctas', (data.ctas || []).length ? data.ctas.map(function (r) { return [ctas[r.label] || 'Botão', n(r.sessions)]; }) : [['Nenhum clique registrado', '0']]);
    table('traffic-sources', (data.sources || []).map(function (r) { return [r.label, n(r.sessions), n(r.leads), percent(r.leads, r.sessions)]; }));
    table('traffic-campaigns', (data.campaigns || []).map(function (r) { return [[r.label, [r.source,r.content].filter(Boolean).join(' · ')], n(r.sessions), n(r.started), n(r.leads), n(r.whatsapp)]; }));
    table('traffic-daily', (data.daily || []).map(function (r) { return [r.day.split('-').reverse().join('/'), n(r.sessions), n(r.visitors), n(r.leads)]; }));
    metrics('traffic-devices', (data.devices || []).length ? data.devices.map(function (r) { return [r.label, n(r.sessions) + ' · ' + percent(r.leads, r.sessions) + ' convertem']; }) : [['Nenhum dispositivo registrado', '0']]);
    var statuses = { whatsapp: 'Clicou no WhatsApp', converted: 'Diagnóstico salvo', active: 'Recente / não encerrada', untouched: 'Saiu sem responder', abandoned: 'Abandonou o diagnóstico' };
    table('traffic-recent', (data.recent || []).map(function (r) { return [formatDate.format(new Date(r.started_at)), [r.source, r.device + ' · ' + r.os + ' · ' + r.browser], statuses[r.status] || r.status, r.max_step ? String(r.max_step) + ' / 7' : '—', duration(r.active_seconds)]; }));
    $('analytics-note').textContent = 'Medição disponível desde ' + formatDate.format(new Date(data.startedAt)) + '. Período por entrada da sessão, no horário de Brasília. Atualizado: ' + formatDate.format(new Date(data.generatedAt)) + '. A exclusão de acessos de teste já está aplicada.';
  }
  async function refresh() {
    if (!authenticated) return;
    var current = ++generation;
    $('analytics-loading').hidden = false;
    try {
      var r = await fetch('/api/admin/analytics?days=' + $('analytics-period').value, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
      var data = await r.json();
      if (current !== generation || !authenticated) return;
      if (!r.ok) throw Error(data.error || 'Não foi possível carregar as métricas.');
      render(data); $('analytics-error').hidden = true; $('analytics-content').hidden = false;
    } catch (e) { if (current === generation && authenticated) { $('analytics-error').textContent = e.name === 'TimeoutError' ? 'As métricas demoraram para responder. Use Atualizar para tentar novamente.' : e.message; $('analytics-error').hidden = false; } }
    finally { if (current === generation) $('analytics-loading').hidden = true; }
  }
  $('analytics-period').addEventListener('change', refresh);
  try { $('exclude-my-visits').checked = localStorage.getItem('alm_analytics_ignore') === '1'; } catch (_) {}
  $('exclude-my-visits').addEventListener('change', function () { try { localStorage.setItem('alm_analytics_ignore', this.checked ? '1' : '0'); } catch (_) {} });
  window.ALMReport = {
    refresh: refresh,
    authenticate: function (value) { authenticated = value; if (value) void refresh(); else { generation++; $('analytics-content').hidden = true; $('traffic-recent').replaceChildren(); $('traffic-cards').replaceChildren(); } }
  };
})();
