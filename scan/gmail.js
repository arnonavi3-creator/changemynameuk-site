/* Gmail reader for the inbox scanner. Uses the gmail.metadata scope only:
   message headers (From, Subject, Date), never message bodies.
   Everything stays in this browser tab. The access token lives in memory and
   is never written to storage or sent anywhere except Google.

   gmail.metadata does not allow Gmail search (q=), so we page through the
   message list newest first and stop at the date limit. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GmailReader = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  var CONCURRENCY = 8;

  function GmailError(message, status) {
    var e = new Error(message);
    e.status = status;
    return e;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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

    /* Read headers of messages newer than sinceMs, newest first.
       onBatch(messages) is called as each page is read; onProgress({ checked }).
       Stops at maxMessages or when signal.aborted. */
    async function readSince(sinceMs, o) {
      o = o || {};
      var max = o.maxMessages || 6000;
      var checked = 0;
      var pageToken = '';
      while (true) {
        if (o.signal && o.signal.aborted) return { checked: checked, stopped: 'cancelled' };
        var list = await call('/messages?maxResults=500' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
        var ids = (list.messages || []).map(function (m) { return m.id; });
        if (!ids.length) return { checked: checked, stopped: 'end' };
        var msgs = [];
        var i = 0;
        var worker = async function () {
          while (i < ids.length) {
            if (o.signal && o.signal.aborted) return;
            var id = ids[i++];
            var m = await call('/messages/' + encodeURIComponent(id) +
              '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&fields=id,internalDate,payload/headers');
            msgs.push(m);
            checked++;
            if (o.onProgress && checked % 10 === 0) o.onProgress({ checked: checked });
          }
        };
        var workers = [];
        for (var w = 0; w < CONCURRENCY; w++) workers.push(worker());
        await Promise.all(workers);
        var oldest = Infinity;
        var inRange = msgs.filter(function (m) {
          var t = Number(m.internalDate) || 0;
          if (t < oldest) oldest = t;
          return t >= sinceMs;
        });
        if (o.onBatch) o.onBatch(inRange);
        if (o.onProgress) o.onProgress({ checked: checked });
        if (oldest < sinceMs) return { checked: checked, stopped: 'date' };
        if (checked >= max) return { checked: checked, stopped: 'limit' };
        if (!list.nextPageToken) return { checked: checked, stopped: 'end' };
        pageToken = list.nextPageToken;
      }
    }

    return { profile: profile, readSince: readSince };
  }

  return { create: create };
}));
