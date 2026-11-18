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

test('reader + engine find the sample inbox organisations end to end', async () => {
  const now = Date.UTC(2026, 10, 18);
  const r = Gmail.create({ fetch: Demo.createFetch(now, 50), getToken: () => 'x' });
  const found = {};
  let conf = {};
  const tracked = Object.fromEntries(catalogue.organisations.map(o => [o.id, now - 30 * 86400000]));
  const res = await r.readSince(now - 730 * 86400000, {
    onBatch: raw => {
      const msgs = raw.map(E.fromGmail);
      E.matchMessages(msgs, index, found);
      Object.assign(conf, E.findConfirmations(msgs, index, tracked));
    }
  });
  assert.strictEqual(res.stopped, 'date');
  for (const id of ['hm-passport-office', 'hmrc', 'monzo', 'nationwide', 'barclaycard', 'octopus-energy', 'ee', 'amazon', 'netflix', 'trainline'])
    assert.ok(found[id], 'missing ' + id);
  assert.ok(!Object.keys(found).some(id => /mum|garden/.test(id)));
  assert.deepStrictEqual(Object.keys(conf).sort(), ['ee', 'monzo', 'nationwide']);
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
