/* Inbox scanner engine: pure functions, no network, no DOM.
   Turns email headers (From, Subject, Date) into a list of organisations,
   and spots confirmation emails for organisations the person is tracking.
   Runs in the browser; also loaded by Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScanEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* "Lloyds Bank <alerts@info.lloydsbank.co.uk>" -> { name, email, domain } */
  function parseFrom(header) {
    if (!header) return null;
    var s = String(header);
    var m = s.match(/<([^<>\s]+@[^<>\s]+)>/) || s.match(/([^\s"<>,;:]+@[^\s"<>,;:]+)/);
    if (!m) return null;
    var email = m[1].toLowerCase().replace(/^mailto:/, '');
    var at = email.lastIndexOf('@');
    var domain = email.slice(at + 1).replace(/\.+$/, '');
    if (!domain || domain.indexOf('.') < 0) return null;
    var name = s.replace(m[0], '').replace(/["']/g, '').trim();
    return { name: name, email: email, domain: domain };
  }

  /* domain -> [org ids]. A domain shared by several organisations is a "group". */
  function buildIndex(catalogue) {
    var byDomain = {};
    var byId = {};
    (catalogue.organisations || []).forEach(function (o) {
      byId[o.id] = o;
      (o.domains || []).forEach(function (d) {
        d = d.toLowerCase();
        (byDomain[d] = byDomain[d] || []).push(o.id);
      });
    });
    return { byDomain: byDomain, byId: byId, groups: catalogue.groups || {} };
  }

  /* Find the catalogue domain for a sender domain: exact, then each parent
     (info.lloydsbank.co.uk -> lloydsbank.co.uk). Stops before bare suffixes. */
  function lookupDomain(domain, index) {
    var parts = String(domain).toLowerCase().split('.');
    for (var i = 0; i < parts.length - 1; i++) {
      var d = parts.slice(i).join('.');
      if (index.byDomain[d]) return d;
    }
    return null;
  }

  /* messages: [{ from, subject, date (ms) }] -> findings keyed by org id:
     { id, match: 'sure' | 'maybe', group, count, firstSeen, lastSeen, domains } */
  function matchMessages(messages, index, existing) {
    var found = existing || {};
    messages.forEach(function (msg) {
      var f = parseFrom(msg.from);
      if (!f) return;
      var d = lookupDomain(f.domain, index);
      if (!d) return;
      var ids = index.byDomain[d];
      var shared = ids.length > 1;
      ids.forEach(function (id) {
        var r = found[id];
        if (!r) {
          r = found[id] = { id: id, match: shared ? 'maybe' : 'sure', group: shared ? d : null, count: 0, firstSeen: msg.date, lastSeen: msg.date, domains: [] };
        }
        if (!shared && r.match === 'maybe') { r.match = 'sure'; r.group = null; }
        r.count++;
        if (msg.date < r.firstSeen) r.firstSeen = msg.date;
        if (msg.date > r.lastSeen) r.lastSeen = msg.date;
        if (r.domains.indexOf(d) < 0) r.domains.push(d);
      });
    });
    return found;
  }

  /* Subject lines that usually mean "we've changed your name". Kept strict on
     purpose: a missed confirmation costs one click, a false tick misleads. */
  var CONFIRM = [
    /\bchange of name\b/i,
    /\bname change\b/i,
    /\bname (has been |was |is now )?(changed|updated)\b/i,
    /\b(updated|changed) your name\b/i,
    /\byour new name\b/i,
    /\bname on your (account|policy|card|record)s?\b/i,
    /\b(personal )?details (have been |were |are )?(updated|changed)\b/i,
    /\bwe('ve| have) (updated|changed) your (personal )?(details|information)\b/i
  ];
  var NOT_CONFIRM = [
    /\bpassword\b/i, /\bsecurity (alert|code)\b/i, /\bverification code\b/i, /\bsign[- ]?in\b/i,
    /\b(how|want|thinking) to change\b/i, /\bchanging your name\?/i, /\bnewsletter\b/i
  ];

  function isConfirmation(subject) {
    if (!subject) return false;
    var s = String(subject);
    if (NOT_CONFIRM.some(function (re) { return re.test(s); })) return false;
    return CONFIRM.some(function (re) { return re.test(s); });
  }

  /* tracked: { orgId: sinceMs } — only emails after since count.
     Returns { orgId: { date, subject } } with the earliest matching email. */
  function findConfirmations(messages, index, tracked) {
    var out = {};
    messages.forEach(function (msg) {
      if (!isConfirmation(msg.subject)) return;
      var f = parseFrom(msg.from);
      if (!f) return;
      var d = lookupDomain(f.domain, index);
      if (!d) return;
      index.byDomain[d].forEach(function (id) {
        if (!(id in tracked)) return;
        if (msg.date < tracked[id]) return;
        if (!out[id] || msg.date < out[id].date) out[id] = { date: msg.date, subject: String(msg.subject).slice(0, 140) };
      });
    });
    return out;
  }

  /* Gmail API message (format=metadata) -> { from, subject, date } */
  function fromGmail(m) {
    var h = {};
    ((m.payload && m.payload.headers) || []).forEach(function (x) { h[x.name.toLowerCase()] = x.value; });
    var date = Number(m.internalDate) || Date.parse(h.date) || 0;
    return { id: m.id, from: h.from || '', subject: h.subject || '', date: date };
  }

  return {
    parseFrom: parseFrom,
    buildIndex: buildIndex,
    lookupDomain: lookupDomain,
    matchMessages: matchMessages,
    isConfirmation: isConfirmation,
    findConfirmations: findConfirmations,
    fromGmail: fromGmail
  };
}));
