/* A made-up inbox that answers like the Gmail API, so the scanner can be tried
   (and tested) without connecting a real account. No real data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DemoGmail = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;

  var SENDERS = [
    ['HM Passport Office', 'noreply@hmpo.gov.uk', 'Your passport application has been received', 400],
    ['DVLA', 'noreply@dvla.gov.uk', 'Your vehicle tax reminder', 300],
    ['HMRC', 'no-reply@hmrc.gov.uk', 'You have a new message in your tax account', 200],
    ['Monzo', 'help@monzo.com', 'Your monthly statement is ready', 25],
    ['Nationwide', 'info@email.nationwide.co.uk', 'Your annual savings summary', 60],
    ['Barclaycard', 'service@barclaycard.co.uk', 'Your statement is ready to view', 30],
    ['Octopus Energy', 'hello@octopus.energy', 'Your latest bill', 31],
    ['Thames Water', 'noreply@thameswater.co.uk', 'Your water bill', 90],
    ['EE', 'ee@ee.co.uk', 'Your EE bill is ready', 30],
    ['Amazon.co.uk', 'auto-confirm@amazon.co.uk', 'Your Amazon.co.uk order has dispatched', 12],
    ['Netflix', 'info@account.netflix.com', 'Your payment details', 45],
    ['Trainline', 'noreply@info.thetrainline.com', 'Your e-ticket', 50],
    ['NS&I', 'premiumbonds@nsandi.com', 'Premium Bonds prize news', 30],
    ['Nest', 'noreply@nestpensions.org.uk', 'Your annual pension statement', 365],
    ['Aviva', 'aviva@aviva.co.uk', 'Your policy documents', 180],
    ['Tesco Clubcard', 'clubcard@tesco.com', 'Your Clubcard vouchers', 40],
    ['Jo from the book club', 'jo.bookclub@gmail.com', 'Next month\'s book', 20],
    ['Garden Weekly', 'news@gardenweekly.example', 'This week in the garden', 7],
    ['Mum', 'mum1960@hotmail.co.uk', 'Sunday lunch?', 9]
  ];

  /* Emails that arrive after the name change started. */
  var CONFIRMATIONS = [
    ['Monzo', 'help@monzo.com', 'We\'ve updated your name', 6],
    ['Nationwide', 'info@email.nationwide.co.uk', 'Confirmation of your change of name', 3],
    ['EE', 'ee@ee.co.uk', 'Your account details have been updated', 2],
    ['Barclaycard', 'service@barclaycard.co.uk', 'Security code: 482911', 1]
  ];

  function build(now) {
    var msgs = [];
    var n = 0;
    SENDERS.forEach(function (s) {
      for (var t = now - 3 * DAY - (n % 5) * DAY; t > now - 800 * DAY; t -= s[3] * DAY) {
        msgs.push({ id: 'd' + (n++), from: s[0] + ' <' + s[1] + '>', subject: s[2], date: t });
      }
    });
    CONFIRMATIONS.forEach(function (s) {
      msgs.push({ id: 'd' + (n++), from: s[0] + ' <' + s[1] + '>', subject: s[2], date: now - s[3] * DAY });
    });
    msgs.sort(function (a, b) { return b.date - a.date; });
    return msgs;
  }

  function json(body) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  }

  /* Returns a fetch() that serves /profile, /messages and /messages/{id}. */
  function createFetch(now, pageSize) {
    var msgs = build(now || Date.now());
    var byId = {};
    msgs.forEach(function (m) { byId[m.id] = m; });
    pageSize = pageSize || 100;
    return function (url) {
      var u = new URL(url);
      var path = u.pathname.replace(/^\/gmail\/v1\/users\/me/, '');
      if (path === '/profile') return json({ emailAddress: 'sample.inbox@example.com', messagesTotal: msgs.length });
      if (path === '/messages') {
        var start = Number(u.searchParams.get('pageToken') || 0);
        var page = msgs.slice(start, start + pageSize).map(function (m) { return { id: m.id }; });
        var next = start + pageSize < msgs.length ? String(start + pageSize) : undefined;
        return json({ messages: page, nextPageToken: next });
      }
      var m = byId[decodeURIComponent(path.replace('/messages/', ''))];
      if (!m) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ ok: true, status: 200, json: function () {
            return Promise.resolve({ id: m.id, internalDate: String(m.date), payload: { headers: [
              { name: 'From', value: m.from }, { name: 'Subject', value: m.subject }, { name: 'Date', value: new Date(m.date).toUTCString() }
            ] } });
          } });
        }, 4);
      });
    };
  }

  return { createFetch: createFetch, build: build };
}));
