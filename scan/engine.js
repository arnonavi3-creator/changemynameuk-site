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

  /* The display name used for one address in a To header:
     '"Avi Levi" <avi@x.com>, Bob <b@y.com>' + 'avi@x.com' -> 'Avi Levi'.
     Without ownEmail, the first named recipient. */
  function nameInTo(header, ownEmail) {
    if (!header) return '';
    var own = (ownEmail || '').toLowerCase();
    var parts = String(header).match(/(?:"[^"]*"|[^,"])+/g) || [];
    var first = '';
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
      if (!m) continue;
      var name = m[1].trim();
      if (!name || name.indexOf('@') >= 0) continue;
      if (own && m[2].toLowerCase().trim() === own) return name;
      if (!first) first = name;
    }
    return own ? '' : first;
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z\u00c0-\u024f' -]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* Which surname does a name use? -> 'new' | 'old' | 'unknown'.
     Double-barrelled new names count as new when the full new surname is there. */
  function nameStatus(name, oldSurname, newSurname) {
    var n = ' ' + norm(name).replace(/-/g, ' ') + ' ';
    var o = norm(oldSurname).replace(/-/g, ' ');
    var w = norm(newSurname).replace(/-/g, ' ');
    if (!n.trim()) return 'unknown';
    if (w && n.indexOf(' ' + w + ' ') >= 0) return 'new';
    if (o && n.indexOf(' ' + o + ' ') >= 0) return 'old';
    return 'unknown';
  }

  /* ---------- Reading the name in an email's text ---------- */

  function b64(data) {
    var s = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
    try {
      var bytes;
      if (typeof atob === 'function') {
        var bin = atob(s);
        bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        bytes = Buffer.from(s, 'base64');
      }
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return ''; }
  }

  function stripHtml(html) {
    return String(html)
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;/gi, "'").replace(/&quot;/gi, '"')
      .replace(/[ \t]+/g, ' ');
  }

  /* Gmail API payload (format=full) -> plain text. Prefers text/plain. */
  function textFromPayload(payload) {
    var plain = '', html = '';
    (function walk(p) {
      if (!p) return;
      var type = (p.mimeType || '').toLowerCase();
      if (p.body && p.body.data) {
        if (type === 'text/plain' && !plain) plain = b64(p.body.data);
        else if (type === 'text/html' && !html) html = b64(p.body.data);
      }
      (p.parts || []).forEach(walk);
    })(payload);
    return (plain || stripHtml(html)).slice(0, 20000);
  }

  function wordRe(word) {
    var w = String(word || '').trim();
    if (!w) return null;
    return new RegExp('(^|[^A-Za-z\u00c0-\u024f])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]+/g, '[- ]') + '(?=$|[^A-Za-z\u00c0-\u024f])', 'i');
  }

  /* Which surname does the email's text use?
     -> { status: 'new' | 'old' | 'unknown', greeting } where greeting is the
     short "Dear Mrs Rivers" line if there is one (at most 60 characters). */
  function nameInBody(text, oldSurname, newSurname) {
    var t = String(text || '').slice(0, 6000);
    var g = t.match(/\b(Dear|Hello|Hi|Hey|Good (?:morning|afternoon|evening))\s+([^\n,!:;.]{2,50})/i);
    var greeting = g ? (g[1] + ' ' + g[2]).trim().slice(0, 60) : '';
    var o = wordRe(oldSurname), n = wordRe(newSurname);
    function judge(s) {
      var hasNew = n && n.test(s), hasOld = o && o.test(s);
      if (hasNew && !hasOld) return 'new';
      if (hasOld && !hasNew) return 'old';
      return 'unknown';
    }
    var status = greeting ? judge(greeting) : 'unknown';
    if (status === 'unknown') status = judge(t);
    return { status: status, greeting: greeting };
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
  function matchMessages(messages, index, existing, ownEmail) {
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
          r = found[id] = { id: id, match: shared ? 'maybe' : 'sure', group: shared ? d : null, count: 0, firstSeen: msg.date, lastSeen: msg.date, lastId: msg.id, domains: [] };
        }
        if (!shared && r.match === 'maybe') { r.match = 'sure'; r.group = null; }
        r.count++;
        if (msg.date < r.firstSeen) r.firstSeen = msg.date;
        if (msg.date >= r.lastSeen) { r.lastSeen = msg.date; r.lastId = msg.id; }
        var toName = nameInTo(msg.to, ownEmail);
        if (toName && (!r.nameDate || msg.date > r.nameDate)) { r.toName = toName; r.nameDate = msg.date; }
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
    return { id: m.id, from: h.from || '', to: h.to || '', subject: h.subject || '', date: date };
  }

  return {
    parseFrom: parseFrom,
    nameInTo: nameInTo,
    textFromPayload: textFromPayload,
    nameInBody: nameInBody,
    nameStatus: nameStatus,
    buildIndex: buildIndex,
    lookupDomain: lookupDomain,
    matchMessages: matchMessages,
    isConfirmation: isConfirmation,
    findConfirmations: findConfirmations,
    fromGmail: fromGmail
  };
}));
