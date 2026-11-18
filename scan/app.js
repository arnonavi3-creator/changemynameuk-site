/* Inbox scanner page: connects Gmail (read headers only), finds the
   organisations that have your name, and ticks them off as their
   confirmation emails arrive. Everything runs and stays in this browser. */
(function () {
  'use strict';

  var SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
  var KEY = 'cmn-scan-v1';
  var DAY = 86400000;
  var E = window.ScanEngine;
  var cfg = window.SCAN_CONFIG || {};

  var $ = function (id) { return document.getElementById(id); };
  var views = ['intro', 'scanning', 'tracker'];

  var catalogue = null;
  var index = null;
  var state = null;
  var token = null;         // in memory only
  var tokenExpires = 0;
  var tokenClient = null;
  var abort = null;
  var busy = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(ms) { return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmtShort(ms) { return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function fmtNum(n) { return Number(n).toLocaleString('en-GB'); }

  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: works for this visit only */ } }

  function show(view) {
    views.forEach(function (v) { $(v).hidden = v !== view; });
    window.scrollTo(0, 0);
  }

  function setError(msg) {
    var el = $('scan-error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ---------- Google sign-in (Google Identity Services, token model) ---------- */

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load Google sign-in. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }

  function getToken(interactive) {
    if (state && state.demo) return Promise.resolve('demo');
    if (token && Date.now() < tokenExpires - 60000) return Promise.resolve(token);
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.clientId,
          scope: SCOPE,
          callback: function (resp) {
            if (resp.error) return reject(new Error('Google sign-in was not completed.'));
            if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
              return reject(new Error('Please tick the box that lets us see your email headers, then try again.'));
            }
            token = resp.access_token;
            tokenExpires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
            resolve(token);
          },
          error_callback: function (err) {
            reject(new Error(err && err.type === 'popup_closed' ? 'The Google window was closed before you finished.' : 'Google sign-in was not completed.'));
          }
        });
        tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      });
    });
  }

  function reader() {
    return window.GmailReader.create({
      fetch: state.demo ? window.DemoGmail.createFetch(state.demoNow) : null,
      getToken: function () { return state.demo ? 'demo' : token; }
    });
  }

  /* ---------- First scan ---------- */

  function startScan(demo) {
    if (busy) return;
    setError('');
    var months = Number($('period').value) || 24;
    var started = $('started').value ? Date.parse($('started').value) : null;
    if (demo && !started) started = Date.now() - 30 * DAY; // so the sample shows confirmations
    var prev = state;
    state = {
      v: 1, demo: !!demo, demoNow: demo ? Date.now() : null,
      months: months, startedOn: started, scannedAt: Date.now(), lastCheckAt: null,
      checked: 0, orgs: {}
    };
    getToken(!demo).then(function () {
      return runScan(Date.now() - months * 30.44 * DAY);
    }).catch(function (err) {
      state = prev;
      busy = false;
      show('intro');
      setError(err.message);
    });
  }

  function runScan(sinceMs) {
    busy = true;
    abort = new AbortController();
    show('scanning');
    $('scan-count').textContent = 'Starting…';
    $('scan-bar').style.width = '2%';
    var findings = {};
    var tracked = trackAll();
    var max = 6000;
    var r = reader();
    return r.readSince(sinceMs, {
      maxMessages: max,
      signal: abort.signal,
      onBatch: function (raw) {
        var msgs = raw.map(E.fromGmail);
        E.matchMessages(msgs, index, findings);
        var conf = E.findConfirmations(msgs, index, tracked);
        Object.keys(conf).forEach(function (id) { (findings[id] || {}).pendingConfirm = conf[id]; });
      },
      onProgress: function (p) {
        var n = Object.keys(findings).length;
        $('scan-count').textContent = 'Checked ' + fmtNum(p.checked) + ' emails. Found ' + n + ' organisation' + (n === 1 ? '' : 's') + ' so far.';
        $('scan-bar').style.width = Math.min(96, 2 + p.checked / max * 94) + '%';
      }
    }).then(function (res) {
      busy = false;
      state.checked = res.checked;
      state.stopped = res.stopped;
      state.lastCheckAt = Date.now();
      Object.keys(findings).forEach(function (id) {
        var f = findings[id];
        state.orgs[id] = {
          match: f.match, group: f.group, count: f.count, firstSeen: f.firstSeen, lastSeen: f.lastSeen,
          kept: f.match === 'sure', hidden: false, askedOn: null,
          confirmed: f.pendingConfirm ? { date: f.pendingConfirm.date, subject: f.pendingConfirm.subject, auto: true } : null
        };
      });
      save();
      render();
      show('tracker');
    });
  }

  /* Before a check, every catalogue organisation counts from the start date. */
  function trackAll() {
    var t = {};
    if (!state.startedOn) return t;
    catalogue.organisations.forEach(function (o) { t[o.id] = state.startedOn; });
    return t;
  }

  /* ---------- Monitoring: check for confirmation emails ---------- */

  function checkNow() {
    if (busy) return;
    setError('');
    var btn = $('check-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    var tracked = {};
    Object.keys(state.orgs).forEach(function (id) {
      var o = state.orgs[id];
      if (o.hidden || o.confirmed || !o.kept) return;
      tracked[id] = o.askedOn || state.startedOn || state.scannedAt;
    });
    var since = (state.lastCheckAt || state.scannedAt) - 2 * DAY;
    var fresh = {};
    var conf = {};
    busy = true;
    getToken(false).then(function () {
      return reader().readSince(since, {
        maxMessages: 3000,
        onBatch: function (raw) {
          var msgs = raw.map(E.fromGmail);
          E.matchMessages(msgs, index, fresh);
          var c = E.findConfirmations(msgs, index, tracked);
          Object.keys(c).forEach(function (id) { if (!conf[id] || c[id].date < conf[id].date) conf[id] = c[id]; });
        }
      });
    }).then(function () {
      var newConf = 0, newOrgs = 0;
      Object.keys(conf).forEach(function (id) {
        state.orgs[id].confirmed = { date: conf[id].date, subject: conf[id].subject, auto: true };
        newConf++;
      });
      Object.keys(fresh).forEach(function (id) {
        if (state.orgs[id]) return;
        var f = fresh[id];
        state.orgs[id] = { match: f.match, group: f.group, count: f.count, firstSeen: f.firstSeen, lastSeen: f.lastSeen, kept: f.match === 'sure', hidden: false, askedOn: null, confirmed: null, isNew: true };
        newOrgs++;
      });
      state.lastCheckAt = Date.now();
      state.lastResult = (newConf ? newConf + ' new confirmation' + (newConf === 1 ? '' : 's') : 'No new confirmations') +
        (newOrgs ? ' and ' + newOrgs + ' new organisation' + (newOrgs === 1 ? '' : 's') : '') + '.';
      save();
    }).catch(function (err) {
      setError(err.message);
    }).then(function () {
      busy = false;
      render();
    });
  }

  /* ---------- Tracker ---------- */

  function org(id) { return index.byId[id] || { id: id, name: id, phase: 5, category: '' }; }

  function itemHtml(id) {
    var s = state.orgs[id];
    var o = org(id);
    var cat = catalogue.categories[o.category] || '';
    var meta = fmtNum(s.count) + ' email' + (s.count === 1 ? '' : 's') + ', latest ' + fmtDate(s.lastSeen);
    var status, actions;
    if (s.confirmed) {
      status = '<p class="org-status done">' + (s.confirmed.auto
        ? 'Confirmed by email on ' + esc(fmtShort(s.confirmed.date)) + ': <q>' + esc(s.confirmed.subject) + '</q>'
        : 'Marked as done on ' + esc(fmtShort(s.confirmed.date))) + '</p>';
      actions = '<button type="button" class="link-btn" data-act="undo-done" data-id="' + esc(id) + '">Undo</button>';
    } else {
      status = s.askedOn ? '<p class="org-status asked">You asked them on ' + esc(fmtShort(s.askedOn)) + '. We\'ll look for their reply.</p>' : '';
      actions = (s.askedOn
        ? '<button type="button" class="small ghost-btn" data-act="unask" data-id="' + esc(id) + '">Not asked yet</button>'
        : '<button type="button" class="small ghost-btn" data-act="ask" data-id="' + esc(id) + '">I\'ve asked them</button>') +
        '<button type="button" class="small ghost-btn" data-act="done" data-id="' + esc(id) + '">Mark as done</button>' +
        '<button type="button" class="link-btn" data-act="hide" data-id="' + esc(id) + '">Not mine</button>';
    }
    return '<li class="org-item' + (s.confirmed ? ' is-done' : '') + '">' +
      '<div class="org-head"><h4>' + esc(o.name) + (s.isNew ? ' <span class="tag">New</span>' : '') + '</h4>' +
      (cat ? '<span class="tag">' + esc(cat) + '</span>' : '') + '</div>' +
      '<p class="org-meta">' + esc(meta) + '</p>' + status +
      '<div class="org-actions">' + actions + '</div></li>';
  }

  function render() {
    var ids = Object.keys(state.orgs);
    var visible = ids.filter(function (id) { var s = state.orgs[id]; return s.kept && !s.hidden; });
    var pending = ids.filter(function (id) { var s = state.orgs[id]; return !s.kept && !s.hidden; });
    var hidden = ids.filter(function (id) { return state.orgs[id].hidden; });
    var done = visible.filter(function (id) { return state.orgs[id].confirmed; }).length;

    $('demo-banner').hidden = !state.demo;
    $('sum-found').textContent = visible.length;
    $('sum-done').textContent = done;
    $('sum-emails').textContent = fmtNum(state.checked);
    $('sum-period').textContent = state.months >= 24 ? (state.months / 12) + ' years' : state.months + ' months';
    $('sum-limit').hidden = state.stopped !== 'limit';
    $('done-bar').style.width = (visible.length ? Math.round(done / visible.length * 100) : 0) + '%';
    $('last-check').textContent = state.lastCheckAt ? 'Last checked ' + new Date(state.lastCheckAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '. ' + (state.lastResult || '') : '';
    var btn = $('check-btn');
    btn.disabled = false;
    btn.textContent = 'Check for confirmations';

    /* Shared senders: ask which ones apply. */
    var groups = {};
    pending.forEach(function (id) { var g = state.orgs[id].group || id; (groups[g] = groups[g] || []).push(id); });
    var gh = '';
    Object.keys(groups).forEach(function (g) {
      var label = catalogue.groups[g] || g;
      gh += '<div class="group-card"><p class="group-q">We found emails from <strong>' + esc(label) + '</strong>. Which of these do you have?</p><ul class="group-list">';
      groups[g].forEach(function (id) {
        gh += '<li><span>' + esc(org(id).name) + '</span><span class="group-btns">' +
          '<button type="button" class="small" data-act="keep" data-id="' + esc(id) + '">I have this</button>' +
          '<button type="button" class="small ghost-btn" data-act="hide" data-id="' + esc(id) + '">No</button></span></li>';
      });
      gh += '</ul></div>';
    });
    $('maybe').hidden = !gh;
    $('maybe-list').innerHTML = gh;

    /* Organisations, in the order to change them. */
    var html = '';
    Object.keys(catalogue.phases).forEach(function (p) {
      var inPhase = visible.filter(function (id) { return String(org(id).phase) === p; })
        .sort(function (a, b) { return org(a).name.localeCompare(org(b).name); });
      if (!inPhase.length) return;
      html += '<section class="phase"><h3><span class="phase-n">0' + esc(p) + '</span>' + esc(catalogue.phases[p]) + '</h3><ul class="org-list">' +
        inPhase.map(itemHtml).join('') + '</ul></section>';
    });
    if (!visible.length && !pending.length) {
      html = '<p class="empty">We didn\'t find any organisations we know in this period. Try a longer period, or use the <a href="/check/">checklist</a> instead.</p>';
    }
    $('org-phases').innerHTML = html;

    $('hidden-wrap').hidden = !hidden.length;
    $('hidden-count').textContent = hidden.length;
    $('hidden-list').innerHTML = hidden.map(function (id) {
      return '<li>' + esc(org(id).name) + ' <button type="button" class="link-btn" data-act="unhide" data-id="' + esc(id) + '">Put back</button></li>';
    }).join('');
  }

  function act(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var s = state.orgs[b.getAttribute('data-id')];
    if (!s) return;
    switch (b.getAttribute('data-act')) {
      case 'ask': s.askedOn = Date.now(); break;
      case 'unask': s.askedOn = null; break;
      case 'done': s.confirmed = { date: Date.now(), auto: false }; break;
      case 'undo-done': s.confirmed = null; break;
      case 'hide': s.hidden = true; break;
      case 'unhide': s.hidden = false; break;
      case 'keep': s.kept = true; break;
    }
    s.isNew = false;
    save();
    render();
  }

  function forget() {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token, function () {}); } catch (e) { /* ignore */ }
    }
    token = null;
    tokenExpires = 0;
    state = null;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    setError('');
    show('intro');
  }

  /* ---------- Start ---------- */

  function init() {
    var connect = $('connect-btn');
    if (!cfg.clientId) {
      connect.disabled = true;
      $('no-client').hidden = false;
    }
    connect.addEventListener('click', function () { startScan(false); });
    $('demo-btn').addEventListener('click', function () { startScan(true); });
    $('cancel-btn').addEventListener('click', function () { if (abort) abort.abort(); });
    $('check-btn').addEventListener('click', checkNow);
    $('forget-btn').addEventListener('click', forget);
    $('tracker').addEventListener('click', act);

    fetch('/scan/catalogue.json').then(function (r) { return r.json(); }).then(function (c) {
      catalogue = c;
      index = E.buildIndex(c);
      state = load();
      if (state && state.v === 1) { render(); show('tracker'); }
      else { state = null; show('intro'); }
    }).catch(function () {
      show('intro');
      setError('The organisation list did not load. Please refresh the page.');
    });
  }

  init();
})();
