// Run: node --test scan/tests/
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const E = require('../engine.js');
const Demo = require('../demo.js');
const Gmail = require('../gmail.js');
const catalogue = require('../catalogue.json');

const index = E.buildIndex(catalogue);

test('parseFrom handles common header shapes', () => {
  assert.deepStrictEqual(E.parseFrom('Lloyds Bank <Alerts@Info.LloydsBank.co.uk>').domain, 'info.lloydsbank.co.uk');
  assert.strictEqual(E.parseFrom('noreply@hmpo.gov.uk').domain, 'hmpo.gov.uk');
  assert.strictEqual(E.parseFrom('"Monzo, Help" <help@monzo.com>').email, 'help@monzo.com');
  assert.strictEqual(E.parseFrom('Undisclosed recipients'), null);
  assert.strictEqual(E.parseFrom(''), null);
});

test('lookupDomain matches parents but never a bare suffix', () => {
  assert.strictEqual(E.lookupDomain('email.nationwide.co.uk', index), 'nationwide.co.uk');
  assert.strictEqual(E.lookupDomain('nationwide.co.uk', index), 'nationwide.co.uk');
  assert.strictEqual(E.lookupDomain('co.uk', index), null);
  assert.strictEqual(E.lookupDomain('gov.uk', index), null);
  assert.strictEqual(E.lookupDomain('notnationwide.co.uk', index), null);
});

test('catalogue has no broad shared domains', () => {
  for (const d of ['gov.uk', 'nhs.uk', 'nhs.net', 'ac.uk', 'gmail.com']) assert.ok(!index.byDomain[d], d);
});

test('matchMessages counts per organisation and flags shared senders', () => {
  const t = Date.UTC(2026, 0, 1);
  const f = E.matchMessages([
    { from: 'Monzo <help@monzo.com>', subject: 'a', date: t },
    { from: 'Monzo <help@monzo.com>', subject: 'b', date: t + 1000 },
    { from: 'DVLA <noreply@dvla.gov.uk>', subject: 'c', date: t },
    { from: 'Mum <mum@hotmail.co.uk>', subject: 'd', date: t }
  ], index);
  assert.strictEqual(f.monzo.count, 2);
  assert.strictEqual(f.monzo.match, 'sure');
  assert.strictEqual(f.monzo.lastSeen, t + 1000);
  assert.strictEqual(f['dvla-licence'].match, 'maybe');
  assert.strictEqual(f['dvla-licence'].group, 'dvla.gov.uk');
  assert.strictEqual(Object.keys(f).length, 4); // monzo + 3 DVLA records
});

test('isConfirmation is strict', () => {
  for (const s of ["We've updated your name", 'Confirmation of your change of name', 'Your account details have been updated',
    'Your name has been changed', 'Name change request complete']) assert.ok(E.isConfirmation(s), s);
  for (const s of ['Your monthly statement is ready', 'Security code: 123', 'Your password has been changed',
    'Thinking of changing your name? Here is how', 'Sign-in details updated', '']) assert.ok(!E.isConfirmation(s), s);
});

test('findConfirmations only counts tracked organisations after their date', () => {
  const t = Date.UTC(2026, 5, 1);
  const msgs = [
    { from: 'help@monzo.com', subject: "We've updated your name", date: t },
    { from: 'help@monzo.com', subject: "We've updated your name", date: t - 5 * 86400000 },
    { from: 'service@barclaycard.co.uk', subject: 'Change of name confirmed', date: t }
  ];
  const c = E.findConfirmations(msgs, index, { monzo: t - 86400000 });
  assert.deepStrictEqual(Object.keys(c), ['monzo']);
  assert.strictEqual(c.monzo.date, t);
});

test('reader searches only catalogue senders and finds the sample organisations', async () => {
  const now = Date.UTC(2026, 10, 18);
  const r = Gmail.create({ fetch: Demo.createFetch(now, 50), getToken: () => 'x' });
  const found = {};
  const conf = {};
  const tracked = Object.fromEntries(catalogue.organisations.map(o => [o.id, now - 30 * 86400000]));
  const domains = Object.keys(index.byDomain);
  const res = await r.readFrom(domains, now - 730 * 86400000, {
    onBatch: raw => {
      const msgs = raw.map(E.fromGmail);
      for (const m of msgs) assert.ok(E.lookupDomain(E.parseFrom(m.from).domain, index), 'downloaded a non-catalogue email: ' + m.from);
      E.matchMessages(msgs, index, found, 'sample.inbox@example.com');
      Object.assign(conf, E.findConfirmations(msgs, index, tracked));
    }
  });
  assert.strictEqual(res.stopped, 'end');
  for (const id of ['hm-passport-office', 'hmrc', 'monzo', 'nationwide', 'barclaycard', 'octopus-energy', 'ee', 'amazon', 'netflix', 'trainline'])
    assert.ok(found[id], 'missing ' + id);
  assert.deepStrictEqual(Object.keys(conf).sort(), ['ee', 'monzo', 'nationwide']);
  assert.strictEqual(found.monzo.toName, 'Sam Rivers');
  assert.strictEqual(found.netflix.toName, 'Sam Taylor');
  assert.strictEqual(found.amazon.toName, undefined); // bare address in To
  // Open the latest Octopus email and read the name in it.
  let body;
  await r.readFull([found['octopus-energy'].lastId], m => { body = E.textFromPayload(m.payload); });
  assert.deepStrictEqual(E.nameInBody(body, 'Taylor', 'Rivers'), { status: 'new', greeting: 'Dear Sam Rivers' });
});

test('buildQuery builds a Gmail search', () => {
  assert.strictEqual(Gmail.buildQuery(['monzo.com', 'ee.co.uk'], Date.UTC(2025, 0, 5)), 'from:(monzo.com OR ee.co.uk) after:2025/1/5');
});

test('nameInTo picks your own name from the To line', () => {
  assert.strictEqual(E.nameInTo('"Sam Taylor" <me@x.com>', 'me@x.com'), 'Sam Taylor');
  assert.strictEqual(E.nameInTo('Bob <b@y.com>, Sam Rivers <ME@x.com>', 'me@x.com'), 'Sam Rivers');
  assert.strictEqual(E.nameInTo('me@x.com', 'me@x.com'), '');
  assert.strictEqual(E.nameInTo('"Taylor, Sam" <me@x.com>', ''), 'Taylor, Sam');
});

test('nameStatus and nameInBody tell old from new surnames', () => {
  assert.strictEqual(E.nameStatus('Mrs S Taylor', 'Taylor', 'Rivers'), 'old');
  assert.strictEqual(E.nameStatus('Sam Taylor-Rivers', 'Taylor', 'Taylor-Rivers'), 'new');
  assert.strictEqual(E.nameStatus('Sam', 'Taylor', 'Rivers'), 'unknown');
  assert.strictEqual(E.nameStatus('Sam Taylors', 'Taylor', 'Rivers'), 'unknown');
  assert.deepStrictEqual(E.nameInBody('Dear Mrs Rivers,\nThanks for writing.', 'Taylor', 'Rivers'), { status: 'new', greeting: 'Dear Mrs Rivers' });
  assert.strictEqual(E.nameInBody('Hi Sam, your statement for S TAYLOR is ready', 'Taylor', 'Rivers').status, 'old');
  // The greeting decides, even if the text mentions both names.
  assert.strictEqual(E.nameInBody('Dear Ms Rivers, we changed your name from Taylor to Rivers.', 'Taylor', 'Rivers').status, 'new');
});

test('textFromPayload reads plain text or strips HTML', () => {
  const enc = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  assert.match(E.textFromPayload({ mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/html', body: { data: enc('<p>Dear <b>Sam</b> Rivers</p>') } },
    { mimeType: 'text/plain', body: { data: enc('Dear Sam Rivers, plain') } }] }), /plain/);
  assert.match(E.textFromPayload({ mimeType: 'text/html', body: { data: enc('<style>x{}</style><p>Dear&nbsp;Sam Rivers</p>') } }), /Dear Sam Rivers/);
});

test('reader retries on rate limit and reports expired sign-in', async () => {
  let calls = 0;
  const flaky = (url) => {
    calls++;
    if (calls === 1) return Promise.resolve({ ok: false, status: 429 });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ emailAddress: 'a@b.c' }) });
  };
  const p = await Gmail.create({ fetch: flaky, getToken: () => 'x' }).profile();
  assert.strictEqual(p.emailAddress, 'a@b.c');
  const expired = () => Promise.resolve({ ok: false, status: 401 });
  await assert.rejects(Gmail.create({ fetch: expired, getToken: () => 'x' }).profile(), /expired/);
});

test('groupOthers keeps unknown organisations and drops people and known senders', () => {
  const t = Date.UTC(2026, 9, 1);
  const g = E.groupOthers([
    { id: 'a', from: 'Riverside Dental <reception@riversidedental.co.uk>', to: '"Sam Taylor" <me@x.com>', subject: 's', date: t },
    { id: 'b', from: 'Acme Payroll <payslips@mail.acmepayroll.co.uk>', to: 'me@x.com', subject: 's', date: t },
    { id: 'c', from: 'Acme Payroll <payslips@mail.acmepayroll.co.uk>', to: 'me@x.com', subject: 's', date: t + 5 },
    { id: 'd', from: 'Jo <jo@gmail.com>', to: 'me@x.com', subject: 's', date: t },
    { id: 'e', from: 'Monzo <help@monzo.com>', to: 'me@x.com', subject: 's', date: t }
  ], index, 'me@x.com');
  assert.deepStrictEqual(Object.keys(g).sort(), ['acmepayroll.co.uk', 'riversidedental.co.uk']);
  assert.strictEqual(g['acmepayroll.co.uk'].count, 2);
  assert.strictEqual(g['acmepayroll.co.uk'].lastId, 'c');
  assert.strictEqual(g['acmepayroll.co.uk'].name, 'Acme Payroll');
  assert.strictEqual(g['riversidedental.co.uk'].toName, 'Sam Taylor');
});

test('isPersonalSender skips personal providers and your own workplace', () => {
  assert.ok(E.isPersonalSender(E.parseFrom('x@hotmail.co.uk')));
  assert.ok(E.isPersonalSender(E.parseFrom('boss@acme.co.uk'), 'me@mail.acme.co.uk'));
  assert.ok(!E.isPersonalSender(E.parseFrom('noreply@acme.co.uk'), 'me@gmail.com'));
});

test('surnameQuery leaves out sent mail, chats, social and forums', () => {
  assert.strictEqual(Gmail.surnameQuery('Taylor', Date.UTC(2025, 0, 5)), '"Taylor" -from:me -in:chats -category:social -category:forums after:2025/1/5');
});
