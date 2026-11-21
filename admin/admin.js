/* Admin: see every customer's progress. Only works for accounts listed in the
   admins table (row level security in supabase/schema.sql enforces this on
   the server; hiding things here is only for tidiness). */
(function () {
  'use strict';

  var A = window.CMNAccount;
  var $ = function (id) { return document.getElementById(id); };
  var customers = [];
  var STATUS = { to_do: 'To do', asked: 'Asked', done: 'Done', confirmed: 'Confirmed', not_needed: 'Not needed' };
  var HOW = {
    ticked: 'Customer ticked it', confirmation_email: 'Confirmation email found', new_name_in_email: 'Their email uses the new name',
    reply_from_org: 'Organisation told us', staff: 'We confirmed it'
  };
  var STAGE = { signed_up: 'Signed up', checklist: 'Has a checklist', scanned: 'Scanned inbox', in_progress: 'In progress', finished: 'Finished', paused: 'Paused' };
  var REASON = { marriage: 'Marriage', divorce: 'Divorce', other: 'Other' };
  var NATION = { england: 'England', wales: 'Wales', scotland: 'Scotland', ni: 'Northern Ireland' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(v) { return v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function when(v) { return v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }
  function fail(err) { $('load-error').textContent = 'Something went wrong: ' + (err && err.message ? err.message : err); $('load-error').hidden = false; }
  function db() { return A.client(); }
  function check(r) { if (r.error) throw r.error; return r.data; }

  A.mount($('acct-box'), {
    title: 'Sign in',
    blurb: 'with your admin email. We\'ll email you a link.',
    signedIn: function (email) { return 'Signed in as ' + email + '.'; }
  });

  function start(user) {
    ['list', 'detail', 'not-admin', 'load-error'].forEach(function (id) { $(id).hidden = true; });
    if (!A.enabled) { $('off').hidden = false; return; }
    if (!user) return;
    db().from('admins').select('user_id').eq('user_id', user.id).maybeSingle().then(check).then(function (row) {
      if (!row) { $('not-admin').hidden = false; return; }
      return loadList().then(route);
    }).catch(fail);
  }

  /* ---------- list ---------- */

  function loadList() {
    return db().from('customer_overview').select('*').order('last_change', { ascending: false, nullsFirst: false }).then(check).then(function (rows) {
      customers = rows || [];
    });
  }

  function drawList() {
    var q = ($('q').value || '').trim().toLowerCase();
    var st = $('stage-filter').value;
    var rows = customers.filter(function (c) {
      if (st && c.stage !== st) return false;
      return !q || (c.email || '').toLowerCase().indexOf(q) !== -1 || (c.first_name || '').toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = rows.length + ' of ' + customers.length + ' customer' + (customers.length === 1 ? '' : 's');
    $('rows').innerHTML = rows.map(function (c) {
      var finished = Number(c.done) + Number(c.confirmed);
      var pct = c.items ? Math.round(finished / c.items * 100) : 0;
      return '<tr class="click" data-id="' + esc(c.id) + '" tabindex="0">' +
        '<td><b>' + esc(c.first_name || c.email) + '</b>' + (c.first_name ? '<span class="sub">' + esc(c.email) + '</span>' : '') +
        '<span class="sub">Joined ' + esc(day(c.created_at)) + '</span></td>' +
        '<td>' + esc(REASON[c.reason] || '') + (c.event_date ? '<span class="sub">' + esc(day(c.event_date)) + '</span>' : '') + '</td>' +
        '<td>' + esc(STAGE[c.stage] || c.stage) + '</td>' +
        '<td><span class="bar"><span data-pct="' + pct + '"></span></span>' + finished + ' of ' + c.items + '</td>' +
        '<td class="num">' + c.to_do + '</td><td class="num">' + c.asked + '</td><td class="num">' + c.done + '</td><td class="num">' + c.confirmed + '</td>' +
        '<td>' + esc(when(c.last_change || c.last_seen_at)) + '</td></tr>';
    }).join('') || '<tr><td colspan="9" class="fine">No customers yet.</td></tr>';
    /* Widths set from script: the page's security policy blocks inline styles. */
    $('rows').querySelectorAll('[data-pct]').forEach(function (el) { el.style.width = el.getAttribute('data-pct') + '%'; });
  }

  $('q').addEventListener('input', drawList);
  $('stage-filter').addEventListener('change', drawList);
  function open(e) {
    var tr = e.target.closest && e.target.closest('tr[data-id]');
    if (!tr || (e.type === 'keydown' && e.key !== 'Enter')) return;
    location.hash = 'c=' + tr.getAttribute('data-id');
  }
  $('rows').addEventListener('click', open);
  $('rows').addEventListener('keydown', open);
  $('back').addEventListener('click', function (e) { e.preventDefault(); location.hash = ''; });
  window.addEventListener('hashchange', route);

  function route() {
    if (!A.user()) return;
    var m = location.hash.match(/^#c=([0-9a-f-]{36})$/);
    if (m) { $('list').hidden = true; $('detail').hidden = false; drawDetail(m[1]); }
    else { $('detail').hidden = true; $('list').hidden = false; drawList(); }
  }

  /* ---------- one customer ---------- */

  function drawDetail(id) {
    var body = $('detail-body');
    body.innerHTML = '<p class="fine">Loading…</p>';
    Promise.all([
      db().from('profiles').select('*').eq('id', id).single(),
      db().from('progress').select('*').eq('user_id', id).order('phase', { ascending: true, nullsFirst: false }).order('title'),
      db().from('checklists').select('answers, item_count, updated_at').eq('user_id', id).maybeSingle(),
      db().from('events').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(60)
    ]).then(function (r) {
      var p = check(r[0]), items = check(r[1]) || [], cl = check(r[2]), ev = check(r[3]) || [];
      /* Steps that dropped off the customer's list go last. */
      items.sort(function (x, y) { return (x.status === 'not_needed') - (y.status === 'not_needed'); });
      var title = {};
      items.forEach(function (i) { title[i.item_key] = i.title; });
      var live = items.filter(function (i) { return i.status !== 'not_needed'; });
      var count = function (s) { return live.filter(function (i) { return i.status === s; }).length; };

      var html = '<h2>' + esc(p.first_name || p.email) + '</h2>' +
        '<div class="facts">' +
        fact('Email', p.email) + fact('Reason', REASON[p.reason]) + fact('Where', NATION[p.nation]) +
        fact('Wedding or divorce date', day(p.event_date)) + fact('Old surname', p.old_surname) + fact('New surname', p.new_surname) +
        fact('Joined', day(p.created_at)) + fact('Last seen', when(p.last_seen_at)) +
        fact('Progress', (count('done') + count('confirmed')) + ' of ' + live.length + ' done (' + count('confirmed') + ' confirmed, ' + count('asked') + ' asked)') +
        '</div>' +
        '<label for="stage"><b>Stage</b></label> <select id="stage">' + Object.keys(STAGE).map(function (k) {
          return '<option value="' + k + '"' + (p.stage === k ? ' selected' : '') + '>' + STAGE[k] + '</option>';
        }).join('') + '</select>' +
        '<h2>Notes</h2><textarea id="notes" placeholder="Only admins can see these notes">' + esc(p.notes || '') + '</textarea>' +
        '<div class="notes-row"><button type="button" class="ghost-btn" id="save-notes">Save notes and stage</button><span id="saved" class="fine" role="status"></span></div>';

      html += '<h2>Organisations and steps</h2>' + (live.length ? '' : '<p class="fine">Nothing saved yet.</p>') +
        '<div class="tbl"><table class="admin-table"><thead><tr><th>Organisation or step</th><th>From</th><th>Status</th><th>Since</th><th>How confirmed</th><th>Name in their latest email</th></tr></thead><tbody>' +
        items.map(function (i) {
          return '<tr><td><b>' + esc(i.title) + '</b>' + (i.org_id && i.org_id !== i.item_key ? '<span class="sub">' + esc(i.org_id) + '</span>' : '') + '</td>' +
            '<td>' + (i.source === 'scanner' ? 'Inbox scan' : i.source === 'checklist' ? 'Checklist' : 'Us') + '</td>' +
            '<td><select data-key="' + esc(i.item_key) + '" aria-label="Status for ' + esc(i.title) + '">' + Object.keys(STATUS).map(function (k) {
              return '<option value="' + k + '"' + (i.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>';
            }).join('') + '</select></td>' +
            '<td>' + esc(day(i.status_on)) + '</td>' +
            '<td>' + esc(HOW[i.confirmed_how] || '') + '</td>' +
            '<td>' + (i.name_in_use === 'old' ? '<span class="pill old">Old name</span>' : i.name_in_use === 'new' ? '<span class="pill done">New name</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';

      if (cl) html += '<h2>Checklist answers</h2><p class="answers">' + esc(describe(cl.answers)) + '<br>Saved ' + esc(when(cl.updated_at)) + ', ' + esc(cl.item_count) + ' steps.</p>';

      html += '<h2>History</h2><ul class="timeline">' + ev.map(function (e) {
        var t;
        if (e.kind === 'signed_up') t = 'Signed up';
        else if (e.kind === 'checklist_saved') t = 'Saved checklist answers';
        else if (e.kind === 'status_changed') t = esc(title[e.item_key] || e.item_key) + ': ' + esc(STATUS[e.from_status] || 'new') + ' → <b>' + esc(STATUS[e.to_status] || e.to_status) + '</b>' +
          (e.detail && e.detail.how ? ' (' + esc(HOW[e.detail.how] || e.detail.how) + ')' : '') + (e.detail && e.detail.by_admin ? ' by us' : '');
        else t = esc(e.kind);
        return '<li><time>' + esc(when(e.created_at)) + '</time>' + t + '</li>';
      }).join('') + '</ul>';

      body.innerHTML = html;
      $('save-notes').addEventListener('click', function () {
        db().from('profiles').update({ notes: $('notes').value, stage: $('stage').value }).eq('id', id).then(check).then(function () {
          $('saved').textContent = 'Saved.';
          return loadList();
        }).catch(fail);
      });
      body.querySelectorAll('select[data-key]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var s = sel.value;
          var fields = { status: s };
          if (s === 'done' || s === 'confirmed') fields.confirmed_how = 'staff';
          db().from('progress').update(fields).eq('user_id', id).eq('item_key', sel.getAttribute('data-key')).then(check)
            .then(function () { return loadList(); }).then(function () { drawDetail(id); }).catch(fail);
        });
      });
    }).catch(fail);
  }

  function fact(label, value) { return '<div><b>' + esc(label) + '</b>' + (value ? esc(value) : '<span class="fine">Not given</span>') + '</div>'; }

  function describe(a) {
    if (!a) return '';
    var parts = [];
    ['reason', 'name', 'order', 'nation', 'stage', 'trip', 'wedding'].forEach(function (k) { if (a[k]) parts.push(k + ': ' + a[k]); });
    ['docs', 'life', 'accts'].forEach(function (k) { if (a[k] && a[k].length) parts.push(k + ': ' + a[k].join(', ')); });
    return parts.join('; ');
  }

  A.ready.then(start);
  A.onChange(start);
})();
