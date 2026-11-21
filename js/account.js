/* Customer accounts: email sign-in links (no passwords) and saving progress
   to the database (Supabase, London region). Optional everywhere: if accounts
   are switched off (js/account-config.js has no url), or the visitor never
   signs in, pages keep working from the browser's local storage as before.

   Pages use window.CMNAccount:
     CMNAccount.enabled                 true when accounts are switched on
     CMNAccount.ready                   Promise -> signed-in user or null
     CMNAccount.user()                  the signed-in user or null
     CMNAccount.onChange(fn)            fn(user) after sign-in or sign-out
     CMNAccount.mount(el, opts)         draws the sign-in box into el
     CMNAccount.loadChecklist()         -> { answers, rows } or null
     CMNAccount.saveChecklist(answers, items, ticks)
     CMNAccount.setItem(key, fields)    update one progress row
     CMNAccount.syncScan(state, orgFor) save the inbox scanner's tracker
     CMNAccount.client()                the Supabase client (admin page) */
(function () {
  'use strict';

  var LIB = '/js/vendor/supabase-2.118.0.js';
  var cfg = window.CMN_SUPABASE || {};
  var enabled = !!(cfg.url && cfg.key);
  var client = null;
  var user = null;
  var isReady = false;
  var listeners = [];
  var linkError = '';
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });

  /* A sign-in link that failed (expired or used) comes back as #error=... */
  (function () {
    var h = location.hash || '';
    if (/[#&]error=/.test(h)) {
      var m = h.match(/error_description=([^&]+)/);
      linkError = /expired|invalid/i.test(m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '')
        ? 'That sign-in link has expired or was already used. Please ask for a new one.'
        : 'That sign-in link didn\'t work. Please ask for a new one.';
      history.replaceState(null, '', location.pathname + location.search);
    }
  })();

  function notify() {
    var u = user;
    listeners.forEach(function (fn) { setTimeout(function () { fn(u); }, 0); });
  }

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load sign-in.')); };
      document.head.appendChild(s);
    });
  }

  function start() {
    if (!enabled) { isReady = true; resolveReady(null); return; }
    loadLib().then(function () {
      client = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cmn-auth' }
      });
      client.auth.onAuthStateChange(function (event, session) {
        var u = session ? session.user : null;
        var changed = (u && u.id) !== (user && user.id);
        user = u;
        if (isReady && changed) notify();
      });
      return client.auth.getSession();
    }).then(function (r) {
      user = r && r.data && r.data.session ? r.data.session.user : null;
      isReady = true;
      resolveReady(user);
    }, function () {
      enabled = false;
      isReady = true;
      resolveReady(null);
    });
  }

  function need() {
    if (!client || !user) return Promise.reject(new Error('Not signed in'));
    return Promise.resolve();
  }
  function check(res) {
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }

  /* ---------- sign in / out ---------- */

  function sendLink(email) {
    return ready.then(function () {
      if (!client) throw new Error('Sign-in isn\'t available right now.');
      return client.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true }
      });
    }).then(check);
  }
  function signOut() {
    return ready.then(function () { return client ? client.auth.signOut() : null; });
  }

  /* ---------- checklist ---------- */

  function loadChecklist() {
    return need().then(function () {
      return Promise.all([
        client.from('checklists').select('answers, updated_at').eq('user_id', user.id).maybeSingle(),
        client.from('progress').select('item_key, status, confirmed_how, status_on').eq('user_id', user.id).eq('source', 'checklist')
      ]);
    }).then(function (r) {
      var c = check(r[0]);
      var rows = check(r[1]) || [];
      if (!c && !rows.length) return null;
      return { answers: c ? c.answers : null, updatedAt: c ? c.updated_at : null, rows: rows };
    });
  }

  /* Checklist step ids that match an organisation in the catalogue. */
  var CHECKLIST_ORGS = {
    passport: 'hm-passport-office', dvla: 'dvla-licence', dva: 'dva-licence', v5c: 'dvla-v5c',
    hmrc: 'hmrc', slc: 'slc', ukvi: 'ukvi-evisa', 'companies-house': 'companies-house',
    bonds: 'nsi', paypal: 'paypal', tv: 'tv-licensing',
    'bank-lloyds': 'lloyds', 'bank-hsbc': 'hsbc', 'bank-natwest': 'natwest', 'bank-barclays': 'barclays',
    'bank-nationwide': 'nationwide', 'bank-santander': 'santander'
  };

  /* Save the answers, add a row for every step on the list, mark steps that
     dropped off the list as not needed, and bring ticks in line. */
  function saveChecklist(answers, items, ticks) {
    ticks = ticks || {};
    return need().then(function () {
      return client.from('checklists').upsert({ user_id: user.id, answers: answers, item_count: items.length }, { onConflict: 'user_id' });
    }).then(check).then(function () {
      return client.from('progress').select('item_key, status').eq('user_id', user.id).eq('source', 'checklist');
    }).then(check).then(function (rows) {
      var have = {};
      (rows || []).forEach(function (r) { have[r.item_key] = r.status; });
      var onList = {};
      var inserts = [];
      var jobs = [];
      items.forEach(function (it) {
        onList[it.id] = true;
        var ticked = !!ticks[it.id];
        var cur = have[it.id];
        if (cur === undefined) {
          inserts.push({
            user_id: user.id, item_key: it.id, org_id: CHECKLIST_ORGS[it.id] || null, title: it.title,
            source: 'checklist', phase: it.phase, status: ticked ? 'done' : 'to_do', confirmed_how: ticked ? 'ticked' : null
          });
        } else if (cur === 'not_needed') {
          jobs.push(setItem(it.id, ticked ? { status: 'done', confirmed_how: 'ticked' } : { status: 'to_do', confirmed_how: null }));
        } else if (ticked && (cur === 'to_do' || cur === 'asked')) {
          jobs.push(setItem(it.id, { status: 'done', confirmed_how: 'ticked' }));
        } else if (!ticked && cur === 'done') {
          jobs.push(setItem(it.id, { status: 'to_do', confirmed_how: null }));
        }
      });
      Object.keys(have).forEach(function (k) {
        if (!onList[k] && have[k] === 'to_do') jobs.push(setItem(k, { status: 'not_needed' }));
      });
      if (inserts.length) jobs.push(client.from('progress').upsert(inserts, { onConflict: 'user_id,item_key', ignoreDuplicates: true }).then(check));
      return Promise.all(jobs);
    });
  }

  function setItem(key, fields) {
    return need().then(function () {
      return client.from('progress').update(fields).eq('user_id', user.id).eq('item_key', key);
    }).then(check);
  }

  /* ---------- inbox scanner ---------- */

  var scanTimer = null;
  /* Saves one row per organisation in the scanner's tracker. Called after
     every local save; waits 1.5 seconds so a burst of changes is one save.
     orgFor(id) returns { name, phase } for an organisation id. */
  function syncScan(state, orgFor) {
    if (!state || state.demo) return Promise.resolve();
    clearTimeout(scanTimer);
    return new Promise(function (resolve) {
      scanTimer = setTimeout(function () { resolve(doSyncScan(state, orgFor).catch(function () { /* stays in this browser */ })); }, 1500);
    });
  }
  function iso(ms) { return ms ? new Date(ms).toISOString() : null; }
  function doSyncScan(state, orgFor) {
    return need().then(function () {
      var rows = Object.keys(state.orgs || {}).filter(function (id) {
        var s = state.orgs[id];
        return s.kept || s.hidden;
      }).map(function (id) {
        var s = state.orgs[id];
        var o = orgFor(id) || {};
        var status = 'to_do', how = null, on = iso(state.scannedAt);
        if (s.hidden) status = 'not_needed';
        else if (s.confirmed) {
          if (s.confirmed.byName) { status = 'confirmed'; how = 'new_name_in_email'; }
          else if (s.confirmed.auto) { status = 'confirmed'; how = 'confirmation_email'; }
          else { status = 'done'; how = 'ticked'; }
          on = iso(s.confirmed.date);
        } else if (s.askedOn) { status = 'asked'; on = iso(s.askedOn); }
        var used = s.body && s.body.status && s.body.status !== 'unknown' ? s.body.status : 'unknown';
        return {
          user_id: user.id, item_key: id, org_id: /^x-/.test(id) ? null : id, title: o.name || id,
          source: 'scanner', phase: o.phase || null, status: status, status_on: on || new Date().toISOString(),
          asked_on: iso(s.askedOn), confirmed_how: how, name_in_use: used, remind_on: s.remindOn ? iso(s.remindOn).slice(0, 10) : null
        };
      });
      var jobs = [];
      if (rows.length) jobs.push(client.from('progress').upsert(rows, { onConflict: 'user_id,item_key' }).then(check));
      var names = {};
      if (state.oldSurname) names.old_surname = state.oldSurname;
      if (state.newSurname) names.new_surname = state.newSurname;
      if (names.old_surname || names.new_surname) jobs.push(client.from('profiles').update(names).eq('id', user.id).then(check));
      jobs.push(client.from('profiles').update({ stage: 'scanned' }).eq('id', user.id).in('stage', ['signed_up', 'checklist']).then(check));
      return Promise.all(jobs);
    });
  }

  /* ---------- sign-in box ---------- */

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* opts: { title, blurb, signedIn(email) -> html, compact } */
  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    var sent = '';
    var testHost = /^deploy-preview-|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
    var allowed = opts.admin || cfg.publicSignIn !== false || testHost;
    function draw(msg, isErr) {
      if (!enabled || (!allowed && !user)) { el.hidden = true; return; }
      el.hidden = false;
      if (user) {
        el.innerHTML = '<p class="acct-in"><span class="acct-dot" aria-hidden="true"></span>' +
          (opts.signedIn ? opts.signedIn(esc(user.email)) : 'Saved to your account (' + esc(user.email) + ').') +
          ' <button type="button" class="link-btn" data-acct="out">Sign out</button></p>';
        return;
      }
      if (sent) {
        el.innerHTML = '<p class="acct-sent"><b>Check your email.</b> We\'ve sent a sign-in link to ' + esc(sent) +
          '. Open it on this device to save your progress. <button type="button" class="link-btn" data-acct="again">Use a different email</button></p>';
        return;
      }
      el.innerHTML = '<form class="acct-form" novalidate>' +
        '<p class="acct-title"><b>' + esc(opts.title || 'Save your progress') + '</b> ' + (opts.blurb || '') + '</p>' +
        '<div class="acct-row"><label class="sr" for="acct-email">Email address</label>' +
        '<input id="acct-email" type="email" autocomplete="email" placeholder="you@example.com" required>' +
        '<button type="submit" class="ghost-btn">Email me a sign-in link</button></div>' +
        (msg ? '<p class="' + (isErr ? 'error' : 'fine') + '" role="status">' + esc(msg) + '</p>' : '') +
        '<p class="fine">No password needed. We\'ll save your answers and progress so you can pick up on any device. See our <a href="/privacy.html#accounts">privacy notice</a>.</p>' +
        '</form>';
    }
    el.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = el.querySelector('#acct-email');
      var email = (input.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { draw('Please enter a valid email address.', true); return; }
      var btn = el.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      sendLink(email).then(function () { sent = email; draw(); }, function (err) {
        draw(/rate|seconds/i.test(err && err.message) ? 'Please wait a minute before asking for another link.' : 'Sorry, we couldn\'t send the link. Please try again.', true);
      });
    });
    el.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-acct');
      if (act === 'out') signOut().then(function () { draw(); });
      if (act === 'again') { sent = ''; draw(); }
    });
    ready.then(function () { draw(linkError, !!linkError); });
    onChange(function () { sent = ''; draw(); });
  }

  function onChange(fn) { listeners.push(fn); }

  window.CMNAccount = {
    get enabled() { return enabled; },
    ready: ready,
    user: function () { return user; },
    onChange: onChange,
    mount: mount,
    sendLink: sendLink,
    signOut: signOut,
    loadChecklist: loadChecklist,
    saveChecklist: saveChecklist,
    setItem: setItem,
    syncScan: syncScan,
    client: function () { return client; }
  };

  start();
})();
