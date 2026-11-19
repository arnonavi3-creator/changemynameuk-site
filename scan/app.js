/* Inbox scanner page: connects Gmail (read-only), finds the organisations
   that have your name, checks which name their emails use, and ticks them
   off as they confirm the change. Only emails from organisations on our list
   are opened. Everything runs and stays in this browser. */
(function () {
  'use strict';

  var SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
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
  var ownEmail = '';        // in memory only, used to pick your name out of the To line
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

  function loadProfile() {
    if (ownEmail) return Promise.resolve();
    return reader().profile().then(function (p) { ownEmail = (p && p.emailAddress) || ''; }, function () { /* fall back to first named recipient */ });
  }

  /* Which name does this organisation use? The latest email's text wins,
     then the To line. -> { status: 'new'|'old'|'unknown', label, date, from } */
  function nameOf(s) {
    if (s.body && s.body.status !== 'unknown') return { status: s.body.status, label: s.body.greeting, date: s.body.date, from: 'body' };
    if (s.toName) {
      var st = E.nameStatus(s.toName, state.oldSurname, state.newSurname);
      if (st !== 'unknown' || !(s.body && s.body.greeting)) return { status: st, label: s.toName, date: s.nameDate, from: 'to' };
    }
    if (s.body && s.body.greeting) return { status: 'unknown', label: s.body.greeting, date: s.body.date, from: 'body' };
    return { status: 'unknown', label: '', date: null, from: '' };
  }

  /* An email using the new surname is proof the organisation has changed it. */
  function confirmByName(id) {
    var s = state.orgs[id];
    if (!s || s.confirmed) return false;
    var n = nameOf(s);
    if (n.status !== 'new') return false;
    s.confirmed = { date: n.date, byName: n.label || state.newSurname, auto: true };
    return true;
  }

  /* Open the latest email from each of these organisations and read the name in it. */
  function readNames(ids, signal, onEach) {
    var byMsg = {};
    ids.forEach(function (id) {
      var s = state.orgs[id];
      if (!s || !s.lastId || (s.body && s.body.msgId === s.lastId)) return;
      (byMsg[s.lastId] = byMsg[s.lastId] || []).push(id);
    });
    var msgIds = Object.keys(byMsg);
    var done = 0;
    return reader().readFull(msgIds, function (m) {
      var r = E.nameInBody(E.textFromPayload(m.payload), state.oldSurname, state.newSurname);
      (byMsg[m.id] || []).forEach(function (id) {
        state.orgs[id].body = { status: r.status, greeting: r.greeting, date: Number(m.internalDate) || state.orgs[id].lastSeen, msgId: m.id };
      });
      done++;
      if (onEach) onEach(done, msgIds.length);
    }, signal);
  }

  function allDomains() { return Object.keys(index.byDomain); }

  /* Organisations the person added from "others" join the list for this browser only. */
  function rebuildIndex() {
    var custom = state && state.custom ? Object.keys(state.custom).map(function (k) { return state.custom[k]; }) : [];
    index = E.buildIndex({ organisations: catalogue.organisations.concat(custom), groups: catalogue.groups });
  }

  /* ---------- Senders not on our list that still use the old surname ---------- */

  function scanOthers(sinceMs, signal, onProgress) {
    if (!state.oldSurname) return Promise.resolve(0);
    state.others = state.others || {};
    var acc = {};
    var r = reader();
    return r.readQuery(window.GmailReader.surnameQuery(state.oldSurname, sinceMs), {
      maxMessages: 3000,
      signal: signal,
      onBatch: function (raw) { E.groupOthers(raw.map(E.fromGmail), index, ownEmail, acc); }
    }).then(function () {
      var cands = Object.keys(acc).map(function (k) { return acc[k]; })
        .filter(function (o) { var ex = state.others[o.domain]; return !ex || o.lastSeen > ex.lastSeen; })
        .sort(function (a, b) { return b.count - a.count; }).slice(0, 120);
      var byMsg = {};
      cands.forEach(function (o) { (byMsg[o.lastId] = byMsg[o.lastId] || []).push(o); });
      var ids = Object.keys(byMsg);
      var done = 0, added = 0;
      return r.readFull(ids, function (m) {
        var res = E.nameInBody(E.textFromPayload(m.payload), state.oldSurname, state.newSurname);
        (byMsg[m.id] || []).forEach(function (o) {
          var toSt = o.toName ? E.nameStatus(o.toName, state.oldSurname, state.newSurname) : 'unknown';
          var st = res.status !== 'unknown' ? res.status : toSt;
          var ex = state.others[o.domain];
          if (st !== 'old') { if (ex && st === 'new') ex.status = 'new'; return; }
          if (!ex) added++;
          state.others[o.domain] = {
            domain: o.domain, name: o.name, count: (ex ? ex.count : 0) + o.count, lastSeen: o.lastSeen,
            greeting: res.greeting || o.toName || '', status: 'old',
            hidden: ex ? ex.hidden : false, suggested: ex ? ex.suggested : false
          };
        });
        done++;
        if (onProgress) onProgress(done, ids.length);
      }, signal).then(function () { return added; });
    });
  }

  function addOther(domain) {
    var o = state.others[domain];
    if (!o) return;
    state.custom = state.custom || {};
    var id = 'x-' + domain.replace(/[^a-z0-9]+/g, '-');
    state.custom[id] = { id: id, name: o.name, category: 'other', phase: 6, domains: [domain] };
    rebuildIndex();
    state.orgs[id] = {
      match: 'sure', group: null, count: o.count, firstSeen: o.lastSeen, lastSeen: o.lastSeen, kept: true, hidden: false,
      askedOn: null, confirmed: null, toName: '', nameDate: null,
      body: { status: 'old', greeting: o.greeting, date: o.lastSeen, msgId: null }
    };
    o.added = true;
  }

  /* Ask the site to consider adding this organisation for everyone. Sends only
     the organisation's name and web address, never anything from an email. */
  function suggestOther(domain) {
    var o = state.others[domain];
    if (!o || state.demo) { if (o) o.suggested = true; return Promise.resolve(); }
    var body = 'form-name=org-suggestion&domain=' + encodeURIComponent(o.domain) + '&name=' + encodeURIComponent(o.name);
    return fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function (r) { if (r.ok) o.suggested = true; else throw new Error(); })
      .catch(function () { setError('Sorry, that didn\'t send. Please try again.'); });
  }

  /* A reminder in your own calendar, made on this device (nothing is sent). */
  function remindMe(id) {
    var o = org(id);
    var d = new Date(Date.now() + 7 * DAY);
    var ymd = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    var safe = function (s) { return String(s).replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\n/g, ' '); };
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Change My Name UK//Scanner//EN', 'BEGIN:VEVENT',
      'UID:' + id + '-' + ymd + '@changemynameuk.com', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + ymd,
      'SUMMARY:' + safe('Change your name with ' + o.name),
      'DESCRIPTION:' + safe('They still use your old name. Open your tracker: https://changemynameuk.com/scan/'),
      'BEGIN:VALARM', 'TRIGGER:PT9H', 'ACTION:DISPLAY', 'DESCRIPTION:' + safe('Change your name with ' + o.name), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'change-name-' + id + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    state.orgs[id].remindOn = d.getTime();
  }

  /* ---------- First scan ---------- */

  function startScan(demo) {
    if (busy) return;
    setError('');
    var months = Number($('period').value) || 24;
    var started = $('started').value ? Date.parse($('started').value) : null;
    if (demo && !started) started = Date.now() - 30 * DAY; // so the sample shows confirmations
    var oldS = $('old-surname').value.trim();
    var newS = $('new-surname').value.trim();
    if (demo && !oldS && !newS) { oldS = window.DemoGmail.oldSurname; newS = window.DemoGmail.newSurname; }
    var prev = state;
    state = {
      v: 1, demo: !!demo, demoNow: demo ? Date.now() : null,
      months: months, startedOn: started, scannedAt: Date.now(), lastCheckAt: null,
      oldSurname: oldS, newSurname: newS,
      checked: 0, orgs: {}, others: {}, custom: {}
    };
    rebuildIndex();
    getToken(!demo).then(loadProfile).then(function () {
      return runScan(Date.now() - months * 30.44 * DAY);
    }).catch(function (err) {
      state = prev;
      rebuildIndex();
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
    var max = 8000;
    var r = reader();
    return r.readFrom(allDomains(), sinceMs, {
      maxMessages: max,
      signal: abort.signal,
      onBatch: function (raw) {
        var msgs = raw.map(E.fromGmail);
        E.matchMessages(msgs, index, findings, ownEmail);
        var conf = E.findConfirmations(msgs, index, tracked);
        Object.keys(conf).forEach(function (id) { (findings[id] || {}).pendingConfirm = conf[id]; });
      },
      onProgress: function (p) {
        var n = Object.keys(findings).length;
        $('scan-count').textContent = 'Found ' + fmtNum(p.checked) + ' emails from ' + n + ' organisation' + (n === 1 ? '' : 's') + ' so far.';
        $('scan-bar').style.width = Math.min(70, 2 + (p.group - 1 + 0.5) / p.groups * 68) + '%';
      }
    }).then(function (res) {
      state.checked = res.checked;
      state.stopped = res.stopped;
      state.lastCheckAt = Date.now();
      Object.keys(findings).forEach(function (id) {
        var f = findings[id];
        state.orgs[id] = {
          match: f.match, group: f.group, count: f.count, firstSeen: f.firstSeen, lastSeen: f.lastSeen,
          kept: f.match === 'sure', hidden: false, askedOn: null, toName: f.toName || '', nameDate: f.nameDate || null,
          confirmed: f.pendingConfirm ? { date: f.pendingConfirm.date, subject: f.pendingConfirm.subject, auto: true } : null
        };
        state.orgs[id].lastId = f.lastId;
      });
      $('scan-count').textContent = 'Checking which name each organisation uses…';
      return readNames(Object.keys(state.orgs), abort.signal, function (done, total) {
        $('scan-count').textContent = 'Checking which name each organisation uses (' + done + ' of ' + total + ')…';
        $('scan-bar').style.width = (70 + done / total * 28) + '%';
      });
    }).then(function () {
      if (!state.oldSurname) return;
      $('scan-count').textContent = 'Looking for anyone else still using your old name…';
      return scanOthers(sinceMs, abort.signal, function (done, total) {
        $('scan-count').textContent = 'Looking for anyone else still using your old name (' + done + ' of ' + total + ')…';
      });
    }).then(function () {
      Object.keys(state.orgs).forEach(confirmByName);
      busy = false;
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
    getToken(false).then(loadProfile).then(function () {
      return reader().readFrom(allDomains(), since, {
        maxMessages: 3000,
        onBatch: function (raw) {
          var msgs = raw.map(E.fromGmail);
          E.matchMessages(msgs, index, fresh, ownEmail);
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
        var f = fresh[id];
        var s = state.orgs[id];
        if (s) {
          if (f.toName && (!s.nameDate || f.nameDate > s.nameDate)) { s.toName = f.toName; s.nameDate = f.nameDate; }
          if (f.lastSeen >= s.lastSeen) { s.lastSeen = f.lastSeen; s.lastId = f.lastId; }
          return;
        }
        state.orgs[id] = { match: f.match, group: f.group, count: f.count, firstSeen: f.firstSeen, lastSeen: f.lastSeen, lastId: f.lastId, kept: f.match === 'sure', hidden: false, askedOn: null, confirmed: null, isNew: true, toName: f.toName || '', nameDate: f.nameDate || null };
        newOrgs++;
      });
      return readNames(Object.keys(fresh)).then(function () {
        Object.keys(fresh).forEach(function (id) {
          var s = state.orgs[id];
          if (s.kept && !s.hidden && confirmByName(id) && !s.isNew) newConf++;
        });
        return scanOthers(since);
      }).then(function (newOthers) {
        return [newConf, newOrgs + (newOthers || 0)];
      });
    }).then(function (counts) {
      var newConf = counts[0], newOrgs = counts[1];
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
    var nm = nameOf(s);
    var ns = nm.status;
    var nameLine = nm.label
      ? '<p class="org-name">' + (nm.from === 'body' ? 'Their latest email says' : 'Their emails call you') + ' <q>' + esc(nm.label) + '</q>' +
        (ns === 'old' ? ' <span class="tag name-old">Old name</span>' : ns === 'new' ? ' <span class="tag name-new">New name</span>' : '') + '</p>'
      : '';
    var status, actions;
    if (s.confirmed) {
      var how;
      if (s.confirmed.byName) how = 'Confirmed: their email on ' + esc(fmtShort(s.confirmed.date)) + ' uses your new name';
      else if (s.confirmed.auto) how = 'Confirmed by email on ' + esc(fmtShort(s.confirmed.date)) + ': <q>' + esc(s.confirmed.subject) + '</q>';
      else how = 'Marked as done on ' + esc(fmtShort(s.confirmed.date));
      if (ns === 'old' && !s.confirmed.byName) how += '. <strong>But their latest email still uses your old name.</strong>';
      status = '<p class="org-status done">' + how + '</p>';
      actions = '<button type="button" class="link-btn" data-act="undo-done" data-id="' + esc(id) + '">Undo</button>';
    } else {
      status = s.askedOn ? '<p class="org-status asked">You asked them on ' + esc(fmtShort(s.askedOn)) + '. We\'ll look for their reply.</p>' : '';
      actions = (s.askedOn
        ? '<button type="button" class="small ghost-btn" data-act="unask" data-id="' + esc(id) + '">Not asked yet</button>'
        : '<button type="button" class="small ghost-btn" data-act="ask" data-id="' + esc(id) + '">I\'ve asked them</button>') +
        '<button type="button" class="small ghost-btn" data-act="done" data-id="' + esc(id) + '">Mark as done</button>' +
        (ns === 'old' ? '<button type="button" class="link-btn" data-act="remind" data-id="' + esc(id) + '">' + (s.remindOn ? 'Reminder added for ' + esc(fmtShort(s.remindOn)) : 'Remind me in a week') + '</button>' : '') +
        '<button type="button" class="link-btn" data-act="hide" data-id="' + esc(id) + '">Not mine</button>';
    }
    return '<li class="org-item' + (s.confirmed ? ' is-done' : '') + '">' +
      '<div class="org-head"><h4>' + esc(o.name) + (s.isNew ? ' <span class="tag">New</span>' : '') + '</h4>' +
      (cat ? '<span class="tag">' + esc(cat) + '</span>' : '') + '</div>' +
      '<p class="org-meta">' + esc(meta) + '</p>' + nameLine + status +
      '<div class="org-actions">' + actions + '</div></li>';
  }

  function render() {
    var ids = Object.keys(state.orgs);
    var visible = ids.filter(function (id) { var s = state.orgs[id]; return s.kept && !s.hidden; });
    var pending = ids.filter(function (id) { var s = state.orgs[id]; return !s.kept && !s.hidden; });
    var hidden = ids.filter(function (id) { return state.orgs[id].hidden; });
    var done = visible.filter(function (id) { return state.orgs[id].confirmed; }).length;
    var oldCount = visible.filter(function (id) {
      var s = state.orgs[id];
      return !s.confirmed && nameOf(s).status === 'old';
    }).length;
    $('sum-old').hidden = !oldCount;
    $('sum-old').textContent = oldCount + ' still email you using your old name.';
    $('names-ask').hidden = !!(state.oldSurname || state.newSurname);

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

    /* Senders not on our list still using the old surname. */
    var others = state.others || {};
    var ok = Object.keys(others).filter(function (k) { var o = others[k]; return o.status === 'old' && !o.hidden && !o.added; })
      .sort(function (a, b) { return others[b].count - others[a].count; });
    $('others').hidden = !ok.length;
    $('others-list').innerHTML = ok.map(function (k) {
      var o = others[k];
      return '<li class="org-item other-item"><div class="org-head"><h4>' + esc(o.name) + '</h4><span class="tag">' + esc(o.domain) + '</span></div>' +
        '<p class="org-meta">' + fmtNum(o.count) + ' email' + (o.count === 1 ? '' : 's') + ', latest ' + esc(fmtDate(o.lastSeen)) + '</p>' +
        (o.greeting ? '<p class="org-name">Their latest email says <q>' + esc(o.greeting) + '</q> <span class="tag name-old">Old name</span></p>' : '') +
        '<div class="org-actions"><button type="button" class="small" data-act="add-other" data-domain="' + esc(k) + '">Add to my tracker</button>' +
        '<button type="button" class="link-btn" data-act="hide-other" data-domain="' + esc(k) + '">Not an organisation</button>' +
        (o.suggested ? '<span class="hint">Thanks, sent to us</span>'
          : '<button type="button" class="link-btn" data-act="suggest-other" data-domain="' + esc(k) + '" title="Sends us only this organisation\'s name and web address, nothing from your emails">Suggest it for everyone\'s list</button>') +
        '</div></li>';
    }).join('');

    $('hidden-wrap').hidden = !hidden.length;
    $('hidden-count').textContent = hidden.length;
    $('hidden-list').innerHTML = hidden.map(function (id) {
      return '<li>' + esc(org(id).name) + ' <button type="button" class="link-btn" data-act="unhide" data-id="' + esc(id) + '">Put back</button></li>';
    }).join('');
  }

  function act(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var dom = b.getAttribute('data-domain');
    if (dom && state.others && state.others[dom]) {
      var kind = b.getAttribute('data-act');
      if (kind === 'add-other') addOther(dom);
      else if (kind === 'hide-other') state.others[dom].hidden = true;
      else if (kind === 'suggest-other') { suggestOther(dom).then(function () { save(); render(); }); return; }
      save();
      render();
      return;
    }
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
      case 'remind': remindMe(b.getAttribute('data-id')); break;
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
      catalogue.phases['6'] = 'Others found in your inbox';
      catalogue.categories.other = 'Found in your inbox';
      state = load();
      rebuildIndex();
      if (state && state.v === 1) { render(); show('tracker'); }
      else { state = null; show('intro'); }
    }).catch(function () {
      show('intro');
      setError('The organisation list did not load. Please refresh the page.');
    });
  }

  init();
})();
