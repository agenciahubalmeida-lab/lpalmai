(function () {
  'use strict';
  // Somente comportamento e atribuição; nenhum valor digitado é coletado aqui.
  if (location.pathname !== '/' && location.pathname !== '/index.html') return;
  var params = new URLSearchParams(location.search);
  var test = params.get('analytics_test') === '1' || params.has('meta_test');
  function storage(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (_) {} return null; }
  if (storage('alm_analytics_ignore') === '1' && !test) return;
  function id() { return crypto.randomUUID(); }
  if (!window.crypto || !crypto.randomUUID) return;
  var visitor = storage('alm_eid');
  if (!/^[0-9a-f-]{36}$/i.test(visitor || '')) { visitor = id(); storage('alm_eid', visitor); }
  var attribution = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'].forEach(function (k) { if (params.get(k)) attribution[k] = params.get(k).slice(0, 200); });
  var session, page, active = 0, scroll = 0, queue = [], inflight = false, ready = false, seen = {}, lastTick = Date.now(), lastActivity = Date.now(), lastStored = 0, flushTimer;
  function openSession() {
    var saved;
    try { saved = JSON.parse(storage('alm_analytics_session') || 'null'); } catch (_) {}
    var now = Date.now();
    if (saved && /^[0-9a-f-]{36}$/i.test(saved.id || '') && now - saved.last < 1800000 && saved.test === test) session = saved;
    else session = { id: id(), last: now, test: test, utm: attribution, referrer: document.referrer };
    // Uma campanha nova em uma sessão ainda ativa mantém a origem de entrada.
    session.last = now; storage('alm_analytics_session', JSON.stringify(session));
    page = id(); active = 0; scroll = 0; seen = {}; queue = []; lastTick = now;
  }
  function touch() {
    if (Date.now() - session.last > 1800000) { openSession(); emit('page_view'); }
    session.last = Date.now(); lastActivity = Date.now();
    if(lastActivity-lastStored>5000){storage('alm_analytics_session', JSON.stringify(session));lastStored=lastActivity;}
  }
  function measure() {
    var now = Date.now();
    if (document.visibilityState === 'visible' && now - lastActivity < 60000) active += Math.min(5, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    var height = document.documentElement.scrollHeight - innerHeight;
    if (height > 0) scroll = Math.max(scroll, Math.min(100, Math.round(scrollY / height * 100)));
  }
  function context() {
    measure();
    return { session_id: session.id, page_id: page, visitor_id: visitor, utm: session.utm || {}, referrer: session.referrer || '', is_test: test, active_seconds: Math.floor(active), scroll_percent: scroll };
  }
  function emit(name, data, once) {
    if (!ready && name !== 'page_view') return;
    data = data || {};
    var key = once || '';
    if (key && seen[key]) return;
    if (key) seen[key] = true;
    queue.push({ id: id(), name: name, step: data.step || 0, label: data.label || '' });
    if (queue.length > 100) queue.shift();
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, name === 'page_view' ? 0 : 400);
  }
  async function flush(beacon) {
    if (!ready || !queue.length || inflight && !beacon) return;
    var batch = queue.splice(0, 20), payload = JSON.stringify(Object.assign(context(), { events: batch }));
    if (beacon && navigator.sendBeacon) {
      if (navigator.sendBeacon('/api/analytics', new Blob([payload], { type: 'application/json' }))) return;
    }
    inflight = true;
    try {
      var r = await fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true, signal: AbortSignal.timeout(8000) });
      if (!r.ok && r.status !== 400 && r.status !== 403 && r.status !== 429) queue = batch.concat(queue).slice(0, 100);
    } catch (_) { queue = batch.concat(queue).slice(0, 100); }
    finally { inflight = false; }
  }
  openSession();
  function start() { if (!ready && document.visibilityState === 'visible') { ready = true; emit('page_view', {}, 'page_view'); } }
  start();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { measure(); emit('heartbeat'); void flush(true); } else { lastTick = Date.now(); touch(); start(); } });
  addEventListener('pagehide', function () { measure(); emit('heartbeat'); void flush(true); });
  addEventListener('pageshow', function (e) { if (e.persisted) { lastTick = Date.now(); touch(); start(); } });
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(function (event) { addEventListener(event, function () { measure(); touch(); }, { passive: true }); });
  setInterval(measure, 5000);
  setInterval(function () { if (ready && document.visibilityState === 'visible' && Date.now() - lastActivity < 60000) { emit('heartbeat'); void flush(); } else if (queue.length) void flush(); }, 20000);
  document.addEventListener('click', function (e) {
    var target = e.target.closest && e.target.closest('a,button'); if (!target) return;
    if (target.matches('a[href="#entrevista"]')) {
      var label = target.closest('header') ? 'header' : target.closest('.hero') ? 'hero' : target.closest('.final') ? 'final' : target.closest('.mcta') ? 'floating' : 'other';
      emit('cta_click', { label: label });
    }
    if (target.matches('#quiz .opt')) {
      var q = target.closest('[data-step]'); var step = q ? Number(q.dataset.step) + 1 : 0;
      emit('quiz_start', {}, 'quiz_start'); emit('question_answer', { step: step }, 'answered_' + step);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.matches('#quiz input')) { emit('quiz_start', {}, 'quiz_start'); emit('contact_input', { step: 7 }, 'contact_input'); }
  });
  document.addEventListener('DOMContentLoaded', function () {
    var error = document.getElementById('err');
    if (error) new MutationObserver(function () {
      if (!error.textContent.trim()) return;
      var q = document.querySelector('#quiz .q:not([hidden])');
      emit('form_error', { step: q ? Number(q.dataset.step) + 1 : 0, label: /WhatsApp/.test(error.textContent) ? 'phone' : 'required' });
    }).observe(error, { childList: true, characterData: true, subtree: true });
  });
  window.ALMAnalytics = {
    context: context,
    emit: emit,
    meta: function (name, data) {
      if (name === 'ViewContent') { emit('quiz_view', {}, 'quiz_view'); emit('step_view', { step: 1 }, 'step_1'); }
      if (name === 'IniciouDiagnostico') emit('quiz_start', {}, 'quiz_start');
      if (name === 'DiagnosticoEtapa') emit('step_view', { step: Number(data.etapa) }, 'step_' + data.etapa);
      if (name === 'Contact') { emit('whatsapp_click', {}, 'whatsapp'); void flush(true); }
    }
  };
})();
