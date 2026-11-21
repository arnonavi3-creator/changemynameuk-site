/* Name change questionnaire and personalised checklist.
   Everything runs in the browser. Answers and ticks are kept in this
   device's localStorage, and are only sent to us if the visitor submits
   the call or beta form after clicking through. */
(function () {
  'use strict';

  var STORE = 'cmn-checklist-v1';
  var quiz = document.getElementById('quiz');
  var result = document.getElementById('result');
  var intro = document.getElementById('intro');
  var steps = Array.prototype.slice.call(quiz.querySelectorAll('fieldset[data-step]'));
  var backBtn = document.getElementById('quiz-back');
  var nextBtn = document.getElementById('quiz-next');
  var errBox = document.getElementById('quiz-error');
  var current = 0;
  var state = load() || { answers: null, ticks: {} };

  /* ---------- storage (optional, never required) ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  /* ---------- reading answers ---------- */
  function radio(name) {
    var el = quiz.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }
  function checks(name) {
    return Array.prototype.map.call(quiz.querySelectorAll('input[name="' + name + '"]:checked'), function (el) { return el.value; });
  }
  function readAnswers() {
    var reason = radio('reason');
    return {
      reason: reason, name: reason === 'marriage' ? radio('name') : '', order: reason === 'divorce' ? radio('order') : '', nation: radio('nation'),
      stage: radio('stage'), wedding: quiz.wedding.value, trip: radio('trip'),
      docs: checks('docs'), life: checks('life'), accts: checks('accts')
    };
  }
  function fillForm(a) {
    ['reason', 'name', 'order', 'nation', 'stage', 'trip'].forEach(function (n) {
      var el = a[n] && quiz.querySelector('input[name="' + n + '"][value="' + a[n] + '"]');
      if (el) el.checked = true;
    });
    ['docs', 'life', 'accts'].forEach(function (n) {
      (a[n] || []).forEach(function (v) {
        var el = quiz.querySelector('input[name="' + n + '"][value="' + v + '"]');
        if (el) el.checked = true;
      });
    });
    if (a.wedding) quiz.wedding.value = a.wedding;
  }

  function needsDeedPoll(a) {
    if (a.reason === 'other') return true;
    if (a.reason === 'marriage') return a.name === 'meshed' || a.name === 'first';
    if (a.reason === 'divorce') return a.order === 'no';
    return false;
  }

  /* ---------- conditional display ---------- */
  function test(cond, a) {
    if (!cond) return true;
    if (cond === 'needdp') return needsDeedPoll(a);
    var parts = cond.split('=');
    return parts[1].split('|').indexOf(a[parts[0]]) !== -1;
  }
  function applyConditions() {
    var a = readAnswers();
    quiz.querySelectorAll('[data-if]').forEach(function (el) {
      if (el.matches('fieldset[data-step]')) return;
      var show = test(el.getAttribute('data-if'), a);
      el.hidden = !show;
      if (!show) el.querySelectorAll('input').forEach(function (i) { i.checked = false; });
    });
    document.getElementById('date-row').hidden = radio('stage') !== 'future';
  }
  function activeSteps() {
    var a = readAnswers();
    return steps.filter(function (s) { return test(s.getAttribute('data-if'), a); });
  }

  /* ---------- wizard ---------- */
  function show(i) {
    applyConditions();
    var list = activeSteps();
    current = Math.max(0, Math.min(i, list.length - 1));
    steps.forEach(function (s) { s.hidden = true; });
    list[current].hidden = false;
    errBox.hidden = true;
    backBtn.hidden = current === 0;
    var last = current === list.length - 1 || isKeep();
    nextBtn.textContent = last ? 'Show my checklist' : 'Next';
    document.getElementById('quiz-count').textContent = 'Question ' + (current + 1) + ' of ' + list.length;
    document.getElementById('quiz-bar').style.width = Math.round(((current + 1) / list.length) * 100) + '%';
  }
  function isKeep() { return radio('reason') === 'marriage' && radio('name') === 'keep'; }
  function stepValid(step) {
    var radios = step.querySelectorAll('input[type="radio"]');
    if (!radios.length) return true;
    return Array.prototype.some.call(radios, function (r) { return r.checked && !r.closest('[hidden]'); });
  }

  quiz.addEventListener('change', function () { applyConditions(); errBox.hidden = true; });
  backBtn.addEventListener('click', function () { show(current - 1); focusStep(); });
  quiz.addEventListener('submit', function (e) {
    e.preventDefault();
    var list = activeSteps();
    var step = list[current];
    if (!stepValid(step)) { errBox.hidden = false; errBox.focus(); return; }
    if (current < list.length - 1 && !isKeep()) { show(current + 1); focusStep(); return; }
    state.answers = readAnswers();
    save();
    render(state.answers, true);
  });
  function focusStep() {
    var s = activeSteps()[current];
    var first = s.querySelector('input:checked') || s.querySelector('input');
    if (first) first.focus({ preventScroll: true });
    quiz.scrollIntoView({ block: 'start' });
  }

  /* ---------- helpers for the checklist ---------- */
  function has(list, v) { return (list || []).indexOf(v) !== -1; }
  function fmt(d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function link(href, text) { return ' <a href="' + href + '" rel="noopener">' + text + '</a>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var PHASES = [
    { title: 'Before you start', blurb: 'Get your proof ready, so you can send things to several places at once.' },
    { title: 'Your passport', blurb: 'Do this first. Your new passport becomes the easiest proof of your new name everywhere else.' },
    { title: 'Government records', blurb: 'Do these while your passport is being processed. HMRC first, so your payroll and pension match.' },
    { title: 'Money and work', blurb: 'Banks accept your certificate, so you don\'t have to wait for your passport.' },
    { title: 'Home, health and insurance', blurb: 'Mostly a quick call, chat or online form. Car insurance is the urgent one.' },
    { title: 'Everything else', blurb: 'Do these when it suits you.' }
  ];

  /* Build the list of items. Each item: phase, id, title, text, tag, urgent. */
  function buildItems(a) {
    var items = [];
    var dp = needsDeedPoll(a);
    var hasPass = has(a.docs, 'passport');
    var hasLic = has(a.docs, 'licence');
    var ew = a.nation === 'england' || a.nation === 'wales';
    var proof;
    if (dp) proof = a.reason === 'marriage' ? 'your deed poll and marriage or civil partnership certificate' : 'your signed deed poll';
    else if (a.reason === 'divorce') proof = 'your final order and your marriage or civil partnership certificate';
    else proof = 'your marriage or civil partnership certificate';
    var proofShort = dp ? 'deed poll' : (a.reason === 'divorce' ? 'final order and certificate' : 'certificate');
    function add(phase, id, title, text, tag, urgent) {
      items.push({ phase: phase, id: id, title: title, text: text, tag: tag || '', urgent: !!urgent });
    }

    /* Phase 0: before you start */
    if (a.reason === 'divorce' && a.order === 'unsure') {
      add(0, 'order-check', 'Check whether you have your final order',
        'If you have your final order (called a decree absolute before April 2022), you can usually use it with your marriage certificate instead of a deed poll. If not, you can still change your name now with a deed poll.', 'Check');
    }
    if (dp) {
      var dpText;
      if (has(a.docs, 'deedpoll')) {
        dpText = 'You already have one. Check it\'s signed by you and a witness, and keep a few copies. Some organisations, including DVLA, also ask for a recent document that shows your new name, such as a bank letter or payslip.';
      } else if (a.nation === 'scotland') {
        dpText = 'In Scotland you can use a deed of change of name or a statutory declaration. If you were born in Scotland you can also record the change with National Records of Scotland. Make a few copies once it\'s signed.';
      } else {
        dpText = 'A deed poll is a signed and witnessed statement that you\'ve changed your name. You can' + link('https://www.gov.uk/change-name-deed-poll', 'write one yourself for free') + ', or enrol it with the court if you want an official record' + (a.nation === 'ni' ? ' (in Northern Ireland, at the Royal Courts of Justice)' : '') + '. Make a few signed copies.';
        dpText += ' Some organisations, including DVLA, also ask for a recent document showing your new name.';
      }
      if (a.reason === 'marriage') dpText = (a.name === 'meshed' ? 'A new combined surname' : 'A change to your first or middle name') + ' isn\'t covered by your marriage certificate, so you\'ll need a deed poll. ' + dpText;
      add(0, 'deedpoll', has(a.docs, 'deedpoll') ? 'Check your deed poll' : 'Make your deed poll', dpText + link('/guides/do-i-need-a-deed-poll/', 'Deed poll guide'), 'First');
    } else if (a.reason === 'marriage' && a.name === 'double') {
      add(0, 'double-note', 'You don\'t need a deed poll',
        'Your certificate is enough for a double-barrelled name made from both your surnames as they appear on it.' + link('/guides/double-barrelled-surnames/', 'Read more'), 'Good news');
    }
    if ((a.reason === 'marriage' || a.reason === 'divorce') && !has(a.docs, 'copies')) {
      var copyText = a.reason === 'marriage'
        ? 'Order 2 or 3 extra official copies of your certificate, so you can post to several places at once and never risk your only one. ' + (a.nation === 'scotland' ? 'Order them from National Records of Scotland or your local registrar.' : a.nation === 'ni' ? 'Order them from the General Register Office for Northern Ireland.' : 'Order them from the register office where you married, or' + link('https://www.gov.uk/order-copy-birth-death-marriage-certificate', 'from the General Register Office') + ' (£12.50 each).') + ' Photocopies aren\'t accepted by DVLA or the passport office.'
        : 'Ask the court for an extra copy of your final order, and order an extra copy of your marriage certificate' + link('https://www.gov.uk/order-copy-birth-death-marriage-certificate', 'from the General Register Office') + ', so you can post to several places at once.';
      add(0, 'copies', 'Order extra copies of your certificate', copyText, 'Online');
    }
    if (has(a.docs, 'abroad')) {
      add(0, 'abroad', 'Check your certificate from abroad',
        'If your certificate isn\'t in English, most organisations will want a certified translation. Some may ask for an apostille. We don\'t give immigration advice.' + link('/guides/married-abroad/', 'Read more'), 'Check');
    }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (a.stage === 'future' && hasPass && a.trip !== 'no') {
      var wd = a.wedding ? new Date(a.wedding + 'T00:00:00') : null;
      var when = '';
      if (wd && wd > today) {
        var opens = new Date(wd); opens.setMonth(opens.getMonth() - 3);
        when = opens <= today ? ' You can already apply for option B.' : ' For option B you can apply from about ' + fmt(opens) + '.';
      }
      add(0, 'honeymoon', 'Decide which name to travel in',
        'The name on your tickets must match your passport. <b>Option A</b> (most people): book in your current name, travel on your current passport, and change it when you\'re back. <b>Option B</b>: get a passport in your new name before the wedding, using form PD2 signed by your registrar or minister (councils often charge a fee, such as £30). Your old passport is cancelled and the new one can\'t be used until the wedding day, so you can\'t travel abroad in between.' + when + link('/guides/honeymoon-passport/', 'Honeymoon passport guide'), 'Decide', true);
    } else if (a.stage !== 'future' && hasPass && a.trip !== 'no') {
      add(0, 'travel', 'Hold off on your passport until after your trip',
        'Travel on your current passport, with tickets in the same name. Send it off for a new one when you\'re back, as you won\'t have it while it\'s being processed.', 'Timing', true);
    }
    add(0, 'inventory', 'Make a list of everywhere that has your name',
      'This checklist covers the main ones. To catch the rest, look through a few months of bank statements and search your email for "account", "policy" and "membership". Keep a note of what you send, where and when.', 'List');

    /* Phase 1: passport */
    if (hasPass) {
      var pText;
      if (a.reason === 'divorce' && !dp) {
        pText = 'Apply online (£102) or by post (£115.50). Going back to a previous surname, you\'ll need to send your birth certificate, your marriage certificate showing both names, a signed statement that you\'ve gone back to your previous name for all purposes, and a document showing you\'re using the name.';
      } else {
        pText = 'Apply online (£102) or by post (£115.50) with ' + proof + ' and your current passport. Either way, your documents go by post and are sent back to you.';
      }
      if (a.stage === 'future') pText += ' If you\'re keeping your current passport for the honeymoon, apply when you\'re back.';
      add(1, 'passport', 'Update your passport', pText + link('https://www.gov.uk/changing-passport-information', 'GOV.UK: passport name change'), 'Online + post');
    } else if (has(a.life, 'visa')) {
      add(1, 'own-passport', 'Update your passport with your own country',
        'If you have a non-UK passport, ask your country\'s embassy or consulate how to change your name on it. Your new passport then helps with UKVI and everything else.', 'Varies');
    } else {
      add(1, 'no-passport', 'No UK passport? You can skip this step',
        'Use ' + proof + ' as your proof instead. Your driving licence, once updated, will help as photo ID.', 'Skip');
    }

    /* Phase 2: government */
    add(2, 'hmrc', 'Tell HMRC',
      'Online with your Government Gateway login or the HMRC app. No documents needed. Your National Insurance number stays the same. Do this before telling your employer.' + link('https://www.gov.uk/tell-hmrc-change-of-details', 'GOV.UK: tell HMRC'), 'Online');
    if (hasLic && a.nation === 'ni') {
      add(2, 'dva', 'Update your driving licence with DVA',
        'In Northern Ireland you can\'t do this online. Fill in form DL1 and post it to DVA with your licence and ' + proof + '.' + link('https://www.nidirect.gov.uk/articles/keeping-your-driving-licence-date', 'nidirect: driving licence changes'), 'Post', true);
    } else if (hasLic) {
      add(2, 'dvla', 'Update your driving licence with DVLA',
        'Free, by post only. Fill in form D1 (from a Post Office or DVLA\'s website) and send it with your licence and your original ' + proofShort + (dp ? '' : ', or just write your new passport number on the form if you\'ve already got it') + '. The law says you must update it. You can keep driving while you wait.' + link('https://www.gov.uk/change-name-driving-licence', 'GOV.UK: driving licence'), 'Post', true);
    }
    if (has(a.life, 'car')) {
      add(2, 'v5c', 'Update your car\'s log book (V5C)',
        'Free, by post. Write your new name in the change of details section of your V5C and post it to DVLA, Swansea SA99 1BA, with a short covering letter. You can be fined up to £1,000 if it\'s out of date.' + link('/guides/driving-licence-name-change/', 'How to do it'), 'Post', true);
    }
    add(2, 'vote', 'Update the electoral register',
      'Register to vote again with your new name. It takes about 5 minutes and you\'ll need your National Insurance number.' + link('https://www.gov.uk/register-to-vote', 'GOV.UK: register to vote'), 'Online');
    if (has(a.life, 'benefits')) {
      add(2, 'benefits', 'Tell the benefits you get',
        'Universal Credit: report it in your online journal. Child Benefit: online, by phone or letter. State Pension: call or write to the Pension Service. Some may ask to see ' + proof + '.' + link('https://www.gov.uk/report-benefits-change-circumstances', 'GOV.UK: report a change'), 'Online or phone');
    }
    if (has(a.life, 'studentloan')) {
      add(2, 'slc', 'Tell the Student Loans Company',
        'Update your details in your online account or call them. They may ask for a copy of ' + proof + '.', 'Online or phone');
    }
    if (has(a.life, 'visa')) {
      add(2, 'ukvi', 'Update your UKVI account',
        'If you have an eVisa, update your name in your UKVI account, usually once you have a passport in your new name. We can\'t give immigration advice, so speak to a regulated immigration adviser if you\'re unsure about anything.' + link('https://www.gov.uk/evisa/update-ukvi-account', 'GOV.UK: update your UKVI account'), 'Online');
    }

    /* Phase 3: money and work */
    var banks = {
      lloyds: ['Lloyds, Halifax or Bank of Scotland', 'Fill in their change of name form, signed in your old and new names, and take it to a branch or post it by recorded delivery with your original or certified ' + proofShort + '. One change covers all their brands, including MBNA.', 'Branch or post'],
      hsbc: ['HSBC', 'Visit a branch with ' + proof + ' and photo ID in your previous name.', 'Branch'],
      natwest: ['NatWest or RBS', 'Use the change of name form in the app, then email a photo of ' + proof + '. Or phone or visit a branch. Takes 2 to 4 working days.', 'App'],
      barclays: ['Barclays', 'Visit a branch, or post their change of name form with ' + proof + '. Barclaycard is separate: send clear copies (not originals) by letter.', 'Branch or post'],
      nationwide: ['Nationwide', 'Visit a branch, or post their form with a certified copy of ' + proof + '. Don\'t post originals. Virgin Money accounts need a separate request.', 'Branch or post'],
      santander: ['Santander', 'Check their website for how they want to be told. Most high street banks want to see ' + proof + ' in a branch or by post.', 'Varies'],
      appbank: ['Your app bank', 'Usually done in the in-app chat with a photo of your new ID or ' + proof + '.', 'App'],
      otherbank: ['Other banks and building societies', 'Ask each one how they want to be told. Most accept ' + proof + '. Keep one card in your old name until your passport matches.', 'Varies']
    };
    Object.keys(banks).forEach(function (k) {
      if (has(a.accts, k)) add(3, 'bank-' + k, banks[k][0], banks[k][1], banks[k][2]);
    });
    if (has(a.accts, 'cards')) add(3, 'cards', 'Credit cards and loans', 'Usually an online upload, a call or a letter with a copy of ' + proof + '. Car finance too.', 'Varies');
    if (has(a.accts, 'mortgage') || has(a.life, 'home')) add(3, 'mortgage', 'Your mortgage lender', 'Usually by post or in a branch with ' + proof + '. A joint mortgage may need both your signatures.', 'Post or branch');
    if (has(a.life, 'employed')) add(3, 'employer', 'Your employer and payroll', 'Email HR with a copy of ' + proof + ', after you\'ve told HMRC. Ask them to update workplace benefits like health and life cover too.', 'Email');
    if (has(a.life, 'director')) add(3, 'companies-house', 'Tell Companies House', 'Directors must report a name change within 14 days. It\'s free online, or by post with form CH01. Update the company\'s own records too.' + link('https://www.gov.uk/file-changes-to-a-company-with-companies-house', 'GOV.UK: Companies House'), 'Online', true);
    if (has(a.accts, 'wpension')) add(3, 'wpension', 'Your workplace pension', 'Often updated through payroll. If not, use the provider\'s online account, which may ask for a certified copy of ' + proof + '.', 'Online');
    if (has(a.accts, 'ppension')) add(3, 'ppension', 'Personal and old workplace pensions', 'Mostly by post, with a signed letter or form and a certified copy of ' + proof + '. Old pensions are easy to forget, so check old payslips.', 'Post');
    if (has(a.accts, 'invest')) add(3, 'invest', 'ISAs and investments', 'Usually an online upload or post with a certified copy of ' + proof + '.', 'Online or post');
    if (has(a.accts, 'bonds')) add(3, 'bonds', 'Premium Bonds (NS&I)', 'In your NS&I online account or by post, with ' + proof + '.', 'Online or post');
    if (has(a.accts, 'paypal')) add(3, 'paypal', 'PayPal, Wise and similar', 'In your account settings, usually with an upload of your new ID or ' + proof + '.', 'Online');

    /* Phase 4: home, health, insurance */
    if (has(a.accts, 'carins') || has(a.life, 'car')) add(4, 'carins', 'Car insurance', 'Tell your insurer as soon as possible, online or by phone. Out-of-date details can put your cover at risk.', 'Online or phone', true);
    if (has(a.accts, 'travelins')) add(4, 'travelins', 'Travel insurance', 'The name on your policy should match the passport you travel on. Update it before your next trip.', 'Online or phone');
    add(4, 'gp', 'Your GP surgery', 'This updates your NHS record, so hospitals and the NHS App pick up your new name. Use the surgery\'s online form or ask at reception. Some want to see ' + proof + ' in person.', 'Online or in person');
    if (has(a.accts, 'dentist')) add(4, 'dentist', 'Dentist and optician', 'They keep their own records. Tell them by phone or at your next visit.', 'Phone');
    if (has(a.accts, 'healthins')) add(4, 'healthins', 'Private health insurance', 'In your online account or by phone. They may ask for a copy of ' + proof + '.', 'Online or phone');
    if (has(a.accts, 'homeins')) add(4, 'homeins', 'Home and contents insurance', 'Online or by phone with your policy number. Pet and gadget cover too.', 'Online or phone');
    if (has(a.accts, 'lifeins')) add(4, 'lifeins', 'Life cover', 'Usually a signed letter and a certified copy of ' + proof + ', by post or secure upload.', 'Post');
    add(4, 'council', 'Council tax', 'Use the online form on your council\'s website. Some councils ask for a copy of ' + proof + '.', 'Online');
    if (has(a.life, 'rent')) add(4, 'landlord', 'Your landlord or letting agent', 'Email them a copy of ' + proof + '.', 'Email');
    if (has(a.accts, 'energy')) add(4, 'energy', 'Gas and electricity', 'Usually by chat, email or phone, not in the app. They may ask for a copy of ' + proof + '.', 'Chat or phone');
    if (has(a.accts, 'water')) add(4, 'water', 'Water', 'Online form or phone, with your account number.', 'Online or phone');
    if (has(a.accts, 'broadband')) add(4, 'broadband', 'Broadband and TV', 'By chat or phone after security checks.', 'Chat or phone');
    if (has(a.accts, 'mobile')) add(4, 'mobile', 'Mobile phone', 'By chat, phone or in store. Some ask to see your new ID.', 'Chat or phone');
    if (has(a.accts, 'tv')) add(4, 'tv', 'TV Licence', 'Online with your licence number, your old surname and postcode. No documents needed.' + link('https://www.tvlicensing.co.uk/', 'TV Licensing'), 'Online');
    if (has(a.life, 'kids')) add(4, 'school', 'School or nursery', 'Email the office so letters and emergency contacts match.', 'Email');

    /* Phase 5: everything else */
    if (has(a.life, 'home')) {
      if (ew) add(5, 'land', 'HM Land Registry', 'Free, by post. Send form AP1 with an identity form (ID1 or ID3), ' + proof + ' (original or certified copy) and a document in your former name. Originals are sent back.', 'Post');
      else if (a.nation === 'scotland') add(5, 'land', 'Registers of Scotland', 'Ask Registers of Scotland how to update your name on your property\'s title. It\'s optional but makes selling easier.', 'Varies');
      else add(5, 'land', 'Land and Property Services', 'Ask Land and Property Services how to update your name on your property\'s title. It\'s optional but makes selling easier.', 'Varies');
    }
    if (has(a.life, 'regulated')) add(5, 'regulator', 'Your professional register', 'Your entry on the public register should match the name you work under. Regulators like the NMC, GMC, HCPC, GPhC, SRA, Teaching Regulation Agency, Social Work England and the FCA usually take an upload of ' + proof + ' (often a certified copy) in your online account. Do this before you start working under your new name.', 'Online');
    if (has(a.life, 'member')) add(5, 'member', 'Professional bodies and trade unions', 'Update your name in your member account (for example CIPD, ACCA, ICAEW, CIMA, RICS, CIOB, BACP or your union). Some ask for ' + proof + ', especially if they reissue your membership certificate.', 'Online');
    if (has(a.life, 'selfemp')) add(5, 'selfemp', 'Clients and invoices', 'Update your invoices, email signature and the bank details your clients hold.', 'Self-service');
    if (has(a.life, 'will')) add(5, 'will', 'Your will and lasting power of attorney', (a.reason === 'marriage' && a.nation !== 'scotland' ? 'In England, Wales and Northern Ireland, getting married usually cancels an earlier will, so you may need a new one anyway. ' : '') + 'Speak to a solicitor about updating them.', 'Solicitor');
    if (has(a.accts, 'airline')) add(5, 'airline', 'Airline and rail accounts', 'Update frequent flyer accounts once your new passport arrives. Railcards may need reissuing.', 'Online');
    if (has(a.accts, 'subs')) add(5, 'subs', 'Gym, subscriptions and loyalty cards', 'Usually in your account settings. No documents needed.', 'Online');
    add(5, 'online', 'Email, social media and online shopping', 'Change your display names, email signature and delivery names when it suits you.', 'Self-service');

    return items;
  }

  /* ---------- rendering ---------- */
  function render(a, scroll) {
    var resultList = document.getElementById('result-list');
    var summary = document.getElementById('result-summary');
    quiz.hidden = true;
    intro.hidden = true;
    result.hidden = false;

    if (a.reason === 'marriage' && a.name === 'keep') {
      document.getElementById('result-title').textContent = 'You don\'t need to change anything';
      summary.textContent = 'Keeping your name is your choice and nothing changes in law. You can still use your partner\'s surname socially. If your partner is changing their name, this checklist can help them too.';
      resultList.innerHTML = '';
      document.getElementById('result-progress').textContent = '';
      document.querySelector('.result-meter').hidden = true;
      if (scroll) document.getElementById('result-title').focus();
      return;
    }
    document.querySelector('.result-meter').hidden = false;
    document.getElementById('result-title').textContent = 'Your checklist';

    var items = buildItems(a);
    var post = items.filter(function (i) { return /Post|Branch/.test(i.tag); }).length;
    summary.innerHTML = 'You have <b>' + items.length + ' steps</b>' + (post ? ', and <b>' + post + '</b> of them need a letter, a form in the post or a branch visit' : '') + '. Work through them in this order. Tick each one when it\'s confirmed, not when you send it.';

    var html = '';
    PHASES.forEach(function (p, idx) {
      var group = items.filter(function (i) { return i.phase === idx; });
      if (!group.length) return;
      html += '<section class="phase"><h3><span class="phase-n">' + ('0' + (idx + 1)).slice(-2) + '</span>' + p.title + '</h3><p class="phase-blurb">' + p.blurb + '</p><ul class="todo-list">';
      group.forEach(function (it) {
        var done = !!state.ticks[it.id];
        html += '<li class="todo-item' + (done ? ' done' : '') + '">' +
          '<input type="checkbox" id="t-' + it.id + '" data-id="' + it.id + '"' + (done ? ' checked' : '') + '>' +
          '<div><label for="t-' + it.id + '"><b>' + esc(it.title) + '</b></label>' +
          (it.tag ? ' <span class="tag">' + esc(it.tag) + '</span>' : '') +
          (it.urgent ? ' <span class="tag urgent">Do soon</span>' : '') +
          '<p>' + it.text + '</p></div></li>';
      });
      html += '</ul></section>';
    });
    resultList.innerHTML = html;
    updateProgress();
    if (scroll) { document.getElementById('result-title').focus({ preventScroll: true }); result.scrollIntoView({ block: 'start' }); }
  }

  document.getElementById('result-list').addEventListener('change', function (e) {
    var id = e.target.getAttribute('data-id');
    if (!id) return;
    if (e.target.checked) state.ticks[id] = 1; else delete state.ticks[id];
    e.target.closest('.todo-item').classList.toggle('done', e.target.checked);
    save();
    updateProgress();
  });
  function updateProgress() {
    var boxes = document.querySelectorAll('#result-list input[type="checkbox"]');
    var done = Array.prototype.filter.call(boxes, function (b) { return b.checked; }).length;
    document.getElementById('result-progress').textContent = done + ' of ' + boxes.length + ' done';
    document.getElementById('result-bar').style.width = (boxes.length ? Math.round(done / boxes.length * 100) : 0) + '%';
  }

  /* Short, human-readable summary for the contact and beta forms. */
  function describe(a) {
    var parts = ['reason: ' + a.reason];
    if (a.name) parts.push('name: ' + a.name);
    if (a.order) parts.push('final order: ' + a.order);
    parts.push('nation: ' + a.nation, 'stage: ' + a.stage, 'trip: ' + a.trip);
    if (a.docs.length) parts.push('has: ' + a.docs.join(' '));
    if (a.life.length) parts.push('life: ' + a.life.join(' '));
    if (a.accts.length) parts.push('accounts: ' + a.accts.join(' '));
    return parts.join('; ');
  }
  /* ---------- result tools ---------- */
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });
  document.getElementById('edit-btn').addEventListener('click', function () {
    result.hidden = true; quiz.hidden = false; intro.hidden = false;
    if (state.answers) fillForm(state.answers);
    show(0); focusStep();
  });
  document.getElementById('link-btn').addEventListener('click', function () {
    var url = location.origin + location.pathname + '#a=' + encodeURIComponent(btoa(JSON.stringify(state.answers)));
    var note = document.getElementById('link-note');
    function done() { note.hidden = false; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link:', url); });
    } else { prompt('Copy this link:', url); }
  });

  /* Carry answers to the call and beta pages (this browser tab only). */
  function carry() {
    var a = state.answers || readAnswers();
    try {
      sessionStorage.setItem('cmn-from-checklist', JSON.stringify({
        answers: describe(a), reason: a.reason || '', nation: a.nation || '', stage: a.stage || '',
        wedding: a.wedding || '', items: document.querySelectorAll('#result-list .todo-item').length
      }));
    } catch (err) { /* ignore */ }
  }
  document.querySelectorAll('.call-link, #beta-link').forEach(function (el) { el.addEventListener('click', carry); });

  /* ---------- start ---------- */
  var fromLink = null;
  var m = location.hash.match(/^#a=(.+)$/);
  if (m) { try { fromLink = JSON.parse(atob(decodeURIComponent(m[1]))); } catch (e) { fromLink = null; } }
  if (fromLink && fromLink.reason) {
    state.answers = fromLink; save();
    history.replaceState(null, '', location.pathname);
  }
  if (state.answers && state.answers.reason) {
    fillForm(state.answers);
    applyConditions();
    render(state.answers, false);
  } else {
    show(0);
  }
})();
