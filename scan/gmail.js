/* Gmail reader for the inbox scanner. Uses the gmail.readonly scope.
   It only ever searches for, and opens, emails from organisations on our list:
   other emails are never downloaded. Everything stays in this browser tab.
   The access token lives in memory and is never written to storage or sent
   anywhere except Google. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GmailReader = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  var CONCURRENCY = 8;
  var DOMAINS_PER_QUERY = 30;

  function GmailError(message, status) {
    var e = new Error(message);
    e.status = status;
    return e;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function gmailDate(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }

  /* Gmail search for mail from any of these domains after a date.
     from:monzo.com also matches subdomains such as email.monzo.com. */
  function buildQuery(domains, sinceMs) {
    return 'from:(' + domains.join(' OR ') + ') after:' + gmailDate(sinceMs);
  }

  async function pool(items, n, fn, signal) {
    var i = 0;
    async function worker() {
      while (i < items.length) {
        if (signal && signal.aborted) return;
        var item = items[i++];
        await fn(item);
      }
    }
    var ws = [];
    for (var w = 0; w < n; w++) ws.push(worker());
    await Promise.all(ws);
  }

  /* opts.fetch lets the demo and tests swap in a fake Gmail. */
  function create(opts) {
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(self) : null);
    var getToken = opts.getToken;

    async function call(path, attempt) {
      attempt = attempt || 0;
      var res = await doFetch(API + path, { headers: { Authorization: 'Bearer ' + getToken() } });
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500 || (res.status === 403 && attempt < 2)) && attempt < 5) {
        await sleep(Math.min(8000, 500 * Math.pow(2, attempt)) + Math.random() * 250);
        return call(path, attempt + 1);
      }
      if (res.status === 401) throw GmailError('Your Google sign-in has expired. Please reconnect.', 401);
      throw GmailError('Gmail returned an error (' + res.status + ').', res.status);
    }

    function profile() { return call('/profile'); }

    async function searchIds(q, max, signal) {
      var ids = [];
      var pageToken = '';
      do {
        if (signal && signal.aborted) break;
        var list = await call('/messages?maxResults=500&q=' + encodeURIComponent(q) +
          (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
        (list.messages || []).forEach(function (m) { ids.push(m.id); });
        pageToken = list.nextPageToken || '';
      } while (pageToken && ids.length < max);
      return ids.slice(0, max);
    }

    function headers(id) {
      return call('/messages/' + encodeURIComponent(id) +
        '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&fields=id,internalDate,payload/headers');
    }

    /* The full message, for reading the name used in the text. */
    function full(id) {
      return call('/messages/' + encodeURIComponent(id) + '?format=full&fields=id,internalDate,payload');
    }

    /* Headers of every email from these domains since sinceMs.
       onBatch(rawMessages) after each group of domains; onProgress({ checked, groups, group }). */
    async function readFrom(domains, sinceMs, o) {
      o = o || {};
      var max = o.maxMessages || 8000;
      var seen = {};
      var checked = 0;
      var groups = [];
      for (var g = 0; g < domains.length; g += DOMAINS_PER_QUERY) groups.push(domains.slice(g, g + DOMAINS_PER_QUERY));
      for (var k = 0; k < groups.length; k++) {
        if (o.signal && o.signal.aborted) return { checked: checked, stopped: 'cancelled' };
        var ids = (await searchIds(buildQuery(groups[k], sinceMs), max - checked, o.signal)).filter(function (id) {
          if (seen[id]) return false;
          seen[id] = true;
          return true;
        });
        var msgs = [];
        await pool(ids, CONCURRENCY, async function (id) {
          msgs.push(await headers(id));
          checked++;
          if (o.onProgress && checked % 10 === 0) o.onProgress({ checked: checked, groups: groups.length, group: k + 1 });
        }, o.signal);
        if (o.onBatch) o.onBatch(msgs);
        if (o.onProgress) o.onProgress({ checked: checked, groups: groups.length, group: k + 1 });
        if (checked >= max) return { checked: checked, stopped: 'limit' };
      }
      return { checked: checked, stopped: (o.signal && o.signal.aborted) ? 'cancelled' : 'end' };
    }

    /* Open several messages (by id) and hand each to fn(message). */
    async function readFull(ids, fn, signal) {
      await pool(ids, 6, async function (id) { fn(await full(id)); }, signal);
    }

    return { profile: profile, readFrom: readFrom, readFull: readFull };
  }

  return { create: create, buildQuery: buildQuery };
}));
