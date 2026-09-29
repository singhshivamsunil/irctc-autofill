// Takes an IRCTC booking from the moment you click Book Now to the payment page:
//   passenger details: selects each saved name from the master list dropdown, then presses Continue
//   review journey:    presses Continue, or puts the cursor in the captcha box for you to type
//   payment:           selects your payment option; with "Complete payment" on and E-Wallet, presses Pay & Book
//   eWallet confirm:   with "Complete payment" on, presses CONFIRM, unless IRCTC asks for an OTP
// A panel on the right of every IRCTC page has the switches and shows what it's doing.
// It never types a captcha or OTP, never answers IRCTC's prompts, and presses each payment button at most once.
(() => {
  const VERSION = globalThis.chrome?.runtime?.getManifest?.().version ?? 'test';
  const WAIT_FOR_IRCTC = 10 * 60 * 1000; // how long each page may take to arrive before giving up
  const PICK_TIMEOUT = 8000; // how long to keep trying one passenger's dropdown (the master list may load late)
  const TEXT = {
    addPassenger: 'add passenger',
    bookNow: 'book now',
    continue: 'continue',
    payBook: 'pay & book',
    confirm: 'confirm',
  };

  // IRCTC's address for each page (from its router). Only checked on the live site: the local test page is a file.
  const PATHS = {
    passenger: '/nget/booking/psgninput',
    review: '/nget/booking/reviewBooking',
    payment: '/nget/payment/bkgPaymentOptions',
    wallet: '/nget/payment/ewallet-confirm',
  };
  const onPath = (stage) => location.protocol !== 'https:' || location.pathname.startsWith(PATHS[stage]);

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => !!el && el.getClientRects().length > 0;

  // Something IRCTC has put in front of the page: its loading screen, or a prompt (PrimeNG dialog or
  // confirmation). Returns what it is, or null. The extension never answers prompts; it waits for you.
  function blocker() {
    if ([...document.querySelectorAll('.my-loading, #loaderP, #preloaderP')].some(visible)) return 'IRCTC is loading';
    const dialog = [...document.querySelectorAll('.ui-dialog, .p-dialog')].find(visible);
    if (!dialog) return null;
    const title = (dialog.querySelector('.ui-dialog-title, .p-dialog-title')?.textContent || dialog.textContent)
      .replace(/\s+/g, ' ').trim().slice(0, 60);
    return title ? `the "${title}" prompt is open` : 'a prompt is open';
  }

  // Resolves with check()'s first truthy result, re-checking on every DOM change and every 25 ms
  // (typed values don't show up as DOM changes). Resolves with the last result on timeout.
  function waitFor(check, timeout = 2000) {
    return new Promise((resolve) => {
      const first = check();
      if (first) return resolve(first);
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(limit);
        resolve(value);
      };
      const test = () => {
        const value = check();
        if (value) finish(value);
      };
      const observer = new MutationObserver(test);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const poll = setInterval(test, 25);
      const limit = setTimeout(() => finish(check()), timeout);
    });
  }

  // What happened during the current run, for the panel's "Copy details".
  let trace = [];
  let traceStart = 0;
  const note = (text) => trace.push(`${Math.round(performance.now() - traceStart)} ms  ${text}`);

  // Waits while a prompt or IRCTC's loading screen is in front of the page, saying so in the panel.
  // Returns false if it's still there after WAIT_FOR_IRCTC.
  async function whenClear() {
    const reason = blocker();
    if (!reason) return true;
    note(`waiting: ${reason}`);
    panel.blocked(reason);
    const clear = await waitFor(() => {
      const now = blocker();
      panel.blocked(now);
      return !now;
    }, WAIT_FOR_IRCTC);
    note(clear ? 'page clear again' : `gave up waiting: ${reason}`);
    return clear;
  }

  // Innermost visible elements whose text contains the phrase.
  function byText(phrase, selector, root = document) {
    const p = norm(phrase);
    const hits = [...root.querySelectorAll(selector)].filter((el) => visible(el) && norm(el.textContent).includes(p));
    return hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
  }

  // The page's Continue button, else its form's submit button.
  function continueButton(root) {
    const buttons = [...root.querySelectorAll('button, input[type="submit"]')].filter((b) => visible(b) && !b.disabled);
    return buttons.find((b) => norm(b.textContent || b.value) === TEXT.continue)
      || buttons.find((b) => b.type === 'submit' && b.closest('form'));
  }

  // One name box per passenger row (<app-passenger>, holding a PrimeNG autocomplete).
  function nameBoxes() {
    const box = 'p-autocomplete input, [formcontrolname="passengerName"] input, input[formcontrolname="passengerName"]';
    const rows = [...document.querySelectorAll('app-passenger')];
    const boxes = rows.length ? rows.map((row) => row.querySelector(box)) : [...document.querySelectorAll(box)];
    return boxes.filter(visible);
  }

  // IRCTC's name box is a PrimeNG autocomplete whose focus event opens the whole master list
  // (onFocus → handleDropdownClick, which closes the list instead if it's already open).
  function focusBox(input) {
    let fired = false;
    const onFocus = () => { fired = true; };
    input.addEventListener('focus', onFocus);
    input.focus();
    input.removeEventListener('focus', onFocus);
    // No focus event if the box already had focus or the window doesn't (e.g. DevTools has it): send it ourselves.
    if (!fired) input.dispatchEvent(new FocusEvent('focus'));
    return fired;
  }

  // Master list entries currently listed under this name box, and only this one's. When PrimeNG closes a list,
  // its entries stop responding at once but it stays on screen for its 100 ms fade-out, so a list only counts
  // while the box says it's open (aria-expanded). If one is fading while a new one opens, the new one comes last.
  function suggestions(input) {
    if (input.getAttribute('aria-expanded') === 'false') return [];
    const host = input.closest('p-autocomplete') || input.parentElement;
    const list = [...host.querySelectorAll('ul')].at(-1) || document.getElementById(input.getAttribute('aria-controls'));
    return list ? [...list.querySelectorAll('li')].filter(visible) : [];
  }

  // IRCTC's entries read "<strong>Full Name</strong> | 38 yrs | Male".
  const entryName = (li) => (li.firstElementChild?.textContent || li.textContent).replace(/\s+/g, ' ').trim();

  // The entry for this full name. An entry may show more after the name (age, gender) or cut a long name short.
  function entryFor(input, wanted) {
    const want = norm(wanted);
    const items = suggestions(input);
    return items.find((li) => norm(entryName(li)) === want || norm(li.textContent) === want)
      || items.find((li) => norm(li.textContent).startsWith(`${want} `))
      || items.find((li) => norm(entryName(li)).length >= 15 && want.startsWith(norm(entryName(li))));
  }

  // The box already shows this person (for example after running the shortcut twice).
  function showsName(input, wanted) {
    const shown = norm(input.value);
    const want = norm(wanted);
    return !!shown && (shown === want || (shown.length >= 15 && want.startsWith(shown)));
  }

  // Selects the name from the dropdown under row `row`'s name box. Returns a problem, or null.
  // Keeps reopening the dropdown for a while: right after Book Now, IRCTC may still be loading the master list.
  // The box is looked up again on every try, in case IRCTC has redrawn the row.
  async function pickFromMasterList(row, wanted) {
    const deadline = Date.now() + PICK_TIMEOUT;
    let shown = [];
    let missed = null;
    for (let attempt = 1; Date.now() < deadline; attempt++) {
      const input = nameBoxes()[row];
      if (!input) {
        await waitFor(() => nameBoxes()[row], 300);
        continue;
      }
      if (showsName(input, wanted)) return note(`${wanted}: in the box`), null;
      if (attempt === 1) input.scrollIntoView({ block: 'center' });
      if (!suggestions(input).length) {
        const fired = focusBox(input);
        if (attempt === 1 || attempt % 5 === 0) {
          note(`${wanted}: focused the box, try ${attempt} (focus event ${fired ? 'fired' : 'sent by hand'}; `
            + `box ${document.activeElement === input ? 'is' : 'is NOT'} the focused element)`);
        }
      }
      const entry = await waitFor(() => entryFor(input, wanted), 300);
      const listed = suggestions(input).map(entryName);
      if (listed.length && !shown.length) note(`${wanted}: dropdown lists ${listed.length}: ${listed.join(' | ')}`);
      if (listed.length) shown = listed;
      if (!entry) continue;

      const before = input.value;
      (entry.firstElementChild || entry).click();
      if (await waitFor(() => input.value !== before && input.value.trim(), 500)) {
        note(`${wanted}: selected, box shows "${input.value}"`);
        return null;
      }
      // Try again with a freshly opened list.
      missed = entryName(entry);
      note(`${wanted}: clicked "${missed}", box still shows "${input.value}" (box on page: ${input.isConnected}, `
        + `list open: ${input.getAttribute('aria-expanded')}, entry on page: ${entry.isConnected})`);
      if (input.isConnected && suggestions(input).length) focusBox(input); // a focus while open closes it
    }
    note(`${wanted}: gave up after ${PICK_TIMEOUT / 1000} s`);
    if (missed) return `clicked "${missed}" in the dropdown but IRCTC didn't take it (tried for ${PICK_TIMEOUT / 1000} s).`;
    if (!shown.length) return `the dropdown never opened (tried for ${PICK_TIMEOUT / 1000} s).`;
    return `not in the dropdown, which showed: ${shown.slice(0, 6).join(', ')}.`;
  }

  // IRCTC's link is <a (click)="addPassenger()"><span>+ Add Passenger</span><span>/ Add Infant With Berth</span></a>.
  // It can appear a moment after the first name box.
  const addLink = () => byText(TEXT.addPassenger, 'a, span, button').find((el) => /^\+?\s*add passenger$/.test(norm(el.textContent)));

  // IRCTC's pop-up messages (PrimeNG toasts), e.g. when it won't add another passenger.
  const toasts = () => [...document.querySelectorAll('.ui-toast-message, .p-toast-message')].filter(visible)
    .map((t) => t.innerText.replace(/\s+/g, ' ').trim()).join(' / ');
  // Only its error messages (PrimeNG adds ui-toast-message-error). It also shows an info message on the way to the
  // eWallet page, which isn't a problem.
  const errorToasts = () => [...document.querySelectorAll('.ui-toast-message-error, .p-toast-message-error')].filter(visible)
    .map((t) => t.innerText.replace(/\s+/g, ' ').trim()).join(' / ');

  const rowCounts = () => `${document.querySelectorAll('app-passenger').length} app-passenger, ${nameBoxes().length} name boxes`;

  // Clicks "+ Add Passenger" until there are `wanted` name boxes. Returns a problem, or null.
  async function addRow(wanted) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const link = await waitFor(addLink, 3000);
      if (!link) return 'Could not find "+ Add Passenger".';
      note(`clicking + Add Passenger for row ${wanted} (${rowCounts()})`);
      link.click();
      if (await waitFor(() => nameBoxes().length >= wanted, 3000)) return note(`row ${wanted} added (${rowCounts()})`), null;
      const message = toasts();
      note(`no row ${wanted} 3 s after the click (${rowCounts()})${message ? `; IRCTC says: ${message}` : ''}`);
      if (message) return `IRCTC didn't add row ${wanted}: ${message}`;
    }
    return `"+ Add Passenger" didn't add row ${wanted} (the page has ${nameBoxes().length}).`;
  }

  // IRCTC's "Other Preferences" checkbox: <input type="checkbox" formcontrolname="bookOnlyIfCnf" id="confirmberths"
  // class="css-checkbox"> with <label for="confirmberths">. It's drawn by the label (the input itself is hidden) and
  // only shown when the class isn't waitlisted.
  const confirmBox = () => document.querySelector('input#confirmberths[type="checkbox"], input[type="checkbox"][formcontrolname="bookOnlyIfCnf"]');
  const confirmState = () => {
    const box = confirmBox();
    return !box ? 'missing' : box.checked ? 'ticked' : 'unticked';
  };

  // Ticks the checkbox. Returns a problem, or null.
  async function tickConfirmOnly() {
    const input = await waitFor(confirmBox, 2000);
    if (!input) {
      note('no "Book only if confirm berths are allotted" option on the page');
      return '"Book only if confirm berths are allotted" isn\'t on this page (IRCTC only offers it when the class '
        + "isn't waitlisted), so it stopped before Continue. Press Continue yourself if you still want to book.";
    }
    if (!input.checked) input.click(); // a click on the checkbox fires the change event Angular listens for
    if (!(await waitFor(() => input.checked, 500))) return 'Couldn\'t tick "Book only if confirm berths are allotted".';
    note('ticked "Book only if confirm berths are allotted"');
    return null;
  }

  async function fill(profile) {
    const done = [];
    const problems = [];
    const report = () => ({ done, problems, continued: false });
    const names = profile.passengers.map((p) => p.name);
    const page = document.querySelector('app-passenger-input') || document;
    const stuck = () => (problems.push('Stopped: a prompt or loading screen stayed on the page.'), report());
    note(`passenger page: ${rowCounts()}`);

    // Like doing it by hand: select passenger 1, add a row, select passenger 2, and so on. Each name box is
    // looked up right before it's used, in case IRCTC redraws the rows.
    for (const [i, name] of names.entries()) {
      // Selecting someone can bring up a prompt (IRCTC shows some for children, for example).
      if (!(await whenClear())) return stuck();
      if (nameBoxes().length <= i) {
        const problem = await addRow(i + 1);
        if (problem) return problems.push(problem), report();
        if (!(await whenClear())) return stuck();
      }
      const box = await waitFor(() => nameBoxes()[i], 3000);
      const problem = box ? await pickFromMasterList(i, name) : `row ${i + 1} has no name box.`;
      if (problem) problems.push(`${name}: ${problem}`);
      else done.push(name);
    }
    // Nothing to select for a missing name, and Continue would only get IRCTC's error, so stop here.
    if (problems.length) return report();

    if (profile.confirmOnly) {
      if (!(await whenClear())) return stuck();
      const problem = await tickConfirmOnly();
      panel.confirm(confirmState());
      if (problem) return problems.push(problem), report();
    }

    if (!(await whenClear())) return stuck();
    // Whatever the setting, show what IRCTC's page says (you may have ticked it yourself).
    panel.confirm(confirmState());
    const button = await waitFor(() => continueButton(page), 2000);
    if (!button) return problems.push('Continue button not found.'), report();
    button.click();
    note('pressed Continue on the passenger page');
    return { ...report(), continued: true };
  }

  const captchaBox = (root) => [...root.querySelectorAll('input')].find((i) => visible(i)
    && /captcha/i.test([i.id, i.name, i.getAttribute('formcontrolname'), i.placeholder].join(' ')));

  async function review() {
    const page = document.querySelector('app-review-booking') || document;
    const captcha = captchaBox(page);
    if (captcha) {
      captcha.scrollIntoView({ block: 'center' });
      captcha.focus();
      note('review page: captcha box, waiting for you');
      return { title: 'Type the captcha, then press Enter' };
    }
    if (!(await whenClear())) return { title: "Didn't press Continue", problems: ['A prompt or loading screen stayed on the page.'] };
    const button = await waitFor(() => continueButton(page), 5000);
    if (!button) return { title: "Didn't press Continue", problems: ['Continue button not found on the review page.'] };
    button.click();
    note('pressed Continue on the review page');
    return { title: 'Pressed Continue on the review page. Waiting for IRCTC…' };
  }

  function paymentOption(page, wanted) {
    const want = norm(wanted);
    const tile = [...page.querySelectorAll('.bank-type')].find((t) => visible(t) && norm(t.textContent).includes(want));
    if (tile) return tile.querySelector(':scope > div') || tile;
    return byText(wanted, 'div, span, label, li', page).find((el) => !el.closest('button'));
  }

  // A payment tile's lines, e.g. "E-Wallet (Instant Payment) · Balance: ₹5,000.25".
  const optionName = (el) => el.innerText.split('\n').map((line) => line.trim()).filter(Boolean).join(' · ');
  const isWallet = (text) => /\be-?wallet/.test(norm(text));

  // Pay & Book and CONFIRM: each button is pressed at most once, so a payment is never sent twice.
  const pressed = new WeakSet();
  function press(button, what) {
    if (pressed.has(button)) return false;
    pressed.add(button);
    button.click();
    note(`pressed ${what}`);
    return true;
  }

  // IRCTC's Pay & Book is <button class="btn btn-primary hidden-xs" (click)="payNow()">, shown once an option is
  // chosen. Its copy for phones is in a bottom sidebar that's hidden on a computer.
  const payBookButton = (page) => [...page.querySelectorAll('button')]
    .find((b) => visible(b) && !b.disabled && norm(b.textContent) === TEXT.payBook);

  // Selects the payment option. With "Complete payment" on and E-Wallet chosen, also presses Pay & Book, after which
  // IRCTC opens its eWallet confirmation page. Returns [report, next page or null].
  async function payment(profile) {
    const page = document.querySelector('app-payment-options') || document;
    const option = await waitFor(() => paymentOption(page, profile.paymentOption), 10000);
    if (!option) {
      return [{ title: 'Pick the payment option yourself', problems: [`"${profile.paymentOption}" not found on the payment page.`] }, null];
    }
    option.click();
    const name = optionName(option);
    note(`selected ${name}`);
    const done = [`Selected ${name}`];
    if (!saved.completePayment) return [{ title: 'Done. Your turn: check the fare and pay', done }, null];

    const yourTurn = (problem) => [{ title: 'Your turn: check the fare and pay', done, problems: [problem] }, null];
    if (!isWallet(name)) return yourTurn(`Complete payment only pays by E-Wallet, so it didn't press Pay & Book for "${name}".`);
    // IRCTC marks the chosen tile bank-type-active.
    const chosen = () => [...page.querySelectorAll('.bank-type.bank-type-active')].some((t) => visible(t) && isWallet(t.textContent));
    if (!(await waitFor(chosen, 2000))) return yourTurn("IRCTC didn't show E-Wallet as chosen, so it didn't press Pay & Book.");
    if (!(await whenClear())) return yourTurn("A prompt or loading screen stayed on the page, so it didn't press Pay & Book.");
    // An error already on screen would be mistaken for IRCTC's answer to Pay & Book.
    const error = errorToasts();
    if (error) return yourTurn(`IRCTC shows an error, so it didn't press Pay & Book: ${error}`);
    const button = await waitFor(() => payBookButton(page), 5000);
    if (!button) return yourTurn('Pay & Book button not found.');
    if (!press(button, 'Pay & Book')) return yourTurn("It already pressed Pay & Book on this page, so it didn't press it again.");
    done.push('Pressed Pay & Book');
    return [{ title: 'Pressed Pay & Book. Waiting for IRCTC…', done }, 'wallet'];
  }

  // IRCTC's eWallet confirmation page (app-ewallet-confirm): balance and amount rows, then CONFIRM and Cancel (both
  // button.mob-bot-btn), plus an OTP box when IRCTC wants one. With the OTP box, IRCTC's CONFIRM logs you out unless
  // at least 3 keys were typed on the page, so that case is left to you.
  const walletPage = () => document.querySelector('app-ewallet-confirm');
  const confirmButton = () => [...(walletPage()?.querySelectorAll('button') || [])]
    .find((b) => visible(b) && !b.disabled && norm(b.textContent) === TEXT.confirm);
  const walletRow = (label) => [...(walletPage()?.querySelectorAll('.inputBoxPad') || [])]
    .find((row) => norm(row.querySelector('.pull-left')?.textContent).includes(label))
    ?.querySelector('.pull-right')?.textContent.replace(/\s+/g, ' ').trim();

  async function walletConfirm() {
    const amount = walletRow('amount to deduct') || 'the amount';
    if (!saved.completePayment) return { title: 'Complete payment is off. Your turn: press CONFIRM or Cancel' };
    const otp = [...walletPage().querySelectorAll('input')].find(visible);
    if (otp) {
      otp.scrollIntoView({ block: 'center' });
      otp.focus();
      note('eWallet page asks for an OTP: waiting for you');
      return { title: 'IRCTC wants an OTP: type it, then press CONFIRM yourself' };
    }
    const stopped = (problem) => ({ title: "Didn't press CONFIRM", problems: [problem] });
    if (!(await whenClear())) return stopped('A prompt or loading screen stayed on the page.');
    const button = confirmButton();
    if (!button) return stopped('CONFIRM button not found on the eWallet page.');
    if (!press(button, `CONFIRM (${amount})`)) return stopped("It already pressed CONFIRM on this page, so it didn't press it again.");
    return {
      title: 'Pressed CONFIRM. IRCTC is booking your ticket; the result shows on this page',
      done: [`Pressed CONFIRM to pay ${amount} from your eWallet`],
    };
  }

  // Each page: when it's on screen, and what to do there. run() returns [report, next page or null].
  // advance() also holds off while blocker() finds a prompt or the loading screen. While a page is awaited, its
  // failed(), if it has one, returns IRCTC's error message, which ends the run.
  const STEPS = {
    passenger: {
      ready: () => onPath('passenger') && nameBoxes().length > 0,
      async run(profile) {
        const report = await fill(profile);
        report.title = report.continued ? 'Passengers selected, pressed Continue. Waiting for IRCTC…'
          : report.problems.length ? "Stopped before Continue:" : 'Passengers selected';
        return [report, report.problems.length ? null : 'review'];
      },
    },
    review: {
      ready: () => onPath('review')
        && [...(document.querySelector('app-review-booking')?.querySelectorAll('button') || [])].some(visible),
      run: async (profile) => [await review(), profile.paymentOption ? 'payment' : null],
    },
    payment: {
      ready: () => onPath('payment') && !!document.querySelector('app-payment-options'),
      run: payment,
    },
    wallet: {
      ready: () => onPath('wallet') && !!confirmButton(),
      // After Pay & Book, IRCTC may show an error and stay on the payment page (not enough balance, say).
      failed: errorToasts,
      run: async () => [await walletConfirm(), null],
    },
  };

  let flow = null; // { stage, profile } while a booking run is waiting for its next page
  let busy = false;
  let watcher = null;
  let giveUp = null;
  let queued = false;

  function begin(stage) {
    trace = [];
    traceStart = performance.now();
    note(`started on the ${stage} page, complete payment ${saved.completePayment ? 'on' : 'off'}`);
    panel.clearLog();
    panel.confirm(saved.profile.confirmOnly ? 'on' : 'off');
    start(stage, saved.profile);
  }

  function start(stage, profile) {
    flow = { stage, profile };
    clearTimeout(giveUp);
    giveUp = setTimeout(() => {
      panel.report({ title: "Stopped: the next IRCTC page didn't load within 10 minutes" });
      stop();
    }, WAIT_FOR_IRCTC);
    if (!watcher) {
      watcher = new MutationObserver(queue);
      // Attribute changes too, in case a prompt or the loading screen is hidden rather than removed.
      watcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
    queue();
  }

  function stop() {
    flow = null;
    clearTimeout(giveUp);
    watcher?.disconnect();
    watcher = null;
    panel.blocked(null);
  }

  // Coalesces a burst of DOM changes into one check.
  function queue() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      advance();
    });
  }

  async function advance() {
    if (!flow || busy) return;
    const reason = blocker();
    panel.blocked(reason);
    if (reason) return;
    const error = STEPS[flow.stage].failed?.();
    if (error) {
      note(`IRCTC says: ${error}`);
      panel.report({ title: 'Stopped. IRCTC says:', problems: [error] });
      stop();
      return;
    }
    if (!STEPS[flow.stage].ready()) return;
    busy = true;
    const current = flow;
    try {
      note(`${current.stage} page is on screen`);
      const [report, next] = await STEPS[current.stage].run(current.profile);
      panel.report(report);
      if (flow === current) next ? start(next, current.profile) : stop();
    } catch (err) {
      note(`error: ${err.stack || err.message}`);
      panel.report({ title: 'Stopped', problems: [`Error: ${err.message}`] });
      stop();
    } finally {
      busy = false;
    }
  }

  // Saved settings, kept in step with the options page and the panel switches in other tabs. The switches are read
  // when they're needed, so turning one off mid-run takes effect straight away.
  const saved = { profile: null, armed: false, completePayment: false };
  const usable = (profile) => (profile?.passengers?.some((p) => p.name)
    ? { ...profile, passengers: profile.passengers.filter((p) => p.name) } : null);

  // Your own click on Book Now starts the run; a scripted click (isTrusted false) doesn't.
  window.addEventListener('click', (event) => {
    if (!event.isTrusted || !saved.armed || busy) return;
    const button = event.target instanceof Element && event.target.closest('button, a');
    if (!button || norm(button.textContent) !== TEXT.bookNow) return;
    if (!saved.profile) return panel.report({ title: 'No passengers saved', problems: ['Click "Edit passengers" to add them.'] });
    begin('passenger');
    panel.report({ title: 'Book Now clicked. Selecting passengers as soon as the page loads…' });
  }, true);

  // The shortcut: handle whichever booking page is open, and carry on from there.
  function runHere() {
    if (busy) return;
    const stage = ['wallet', 'payment', 'review', 'passenger'].find((s) => STEPS[s].ready());
    if (!stage) return panel.report({ title: 'Nothing to fill on this page' });
    if (!saved.profile) return panel.report({ title: 'No passengers saved', problems: ['Click "Edit passengers" to add them.'] });
    begin(stage);
  }

  function details() {
    const boxes = nameBoxes().map((input, i) => {
      const host = input.closest('p-autocomplete') || input.parentElement;
      return `--- name box ${i + 1}: value "${input.value}", focused ${document.activeElement === input}\n${host.outerHTML.slice(0, 5000)}`;
    });
    return [
      `IRCTC Autofill ${VERSION} on ${location.pathname}, ${navigator.userAgent}`,
      `switch ${saved.armed ? 'on' : 'off'}, complete payment ${saved.completePayment ? 'on' : 'off'}, `
        + `${saved.profile?.passengers.length ?? 0} passengers saved, payment "${saved.profile?.paymentOption ?? ''}"`,
      '--- last run', ...(trace.length ? trace : ['(none)']),
      ...boxes,
    ].join('\n');
  }

  const panel = (() => {
    const host = document.createElement('div');
    host.id = 'irctc-autofill-panel';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel, .tab { position: fixed; top: 120px; right: 12px; z-index: 2147483647; font: 13px/1.45 system-ui, sans-serif; }
        .panel { width: 260px; background: #fff; color: #1f2937; border: 1px solid #cbd5e1; border-radius: 10px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, .2); overflow: hidden; }
        header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px;
          background: #213d77; color: #fff; font-weight: 600; }
        header button { all: unset; cursor: pointer; padding: 0 6px; font-size: 18px; line-height: 1; }
        .body { padding: 10px 12px 12px; display: grid; gap: 10px; }
        .switch { display: flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 600; }
        .switch input { appearance: none; margin: 0; width: 40px; height: 22px; border-radius: 11px; background: #cbd5e1;
          position: relative; cursor: pointer; transition: background .15s; flex: none; }
        .switch input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
          border-radius: 50%; background: #fff; transition: left .15s; }
        .switch input:checked { background: #16a34a; }
        .switch input.pay:checked { background: #ea580c; }
        .switch input:checked::after { left: 21px; }
        .status { font-weight: 600; }
        .status.on { color: #15803d; }
        .wait { color: #92400e; background: #fef3c7; border-radius: 6px; padding: 6px 8px; }
        .names { margin: 0; padding-left: 20px; color: #475569; }
        .names:empty, .confirm:empty { display: none; }
        .confirm { color: #475569; }
        .confirm.good { color: #15803d; }
        .confirm.warn { color: #92400e; }
        .log { display: grid; gap: 2px; }
        .log:empty { display: none; }
        .ok { color: #15803d; }
        .problem { color: #b91c1c; }
        .links { display: flex; justify-content: space-between; }
        .links button { all: unset; cursor: pointer; color: #1d4ed8; text-decoration: underline; }
        textarea { width: 100%; height: 120px; font: 11px/1.3 ui-monospace, monospace; }
        .tab { right: 0; padding: 10px 6px; border: none; border-radius: 8px 0 0 8px; background: #213d77; color: #fff;
          writing-mode: vertical-rl; cursor: pointer; font-weight: 600; }
        [hidden] { display: none !important; }
      </style>
      <div class="panel">
        <header><span>IRCTC Autofill</span><button class="hide" title="Hide panel">–</button></header>
        <div class="body">
          <label class="switch"><input type="checkbox" class="armed"> Fill after Book Now</label>
          <label class="switch" title="Presses Pay &amp; Book and CONFIRM, paying from your IRCTC eWallet">
            <input type="checkbox" class="pay"> Complete payment (E-Wallet)</label>
          <div class="status"></div>
          <div class="wait" hidden></div>
          <ol class="names"></ol>
          <div class="confirm"></div>
          <div class="log"></div>
          <textarea class="details" readonly hidden></textarea>
          <div class="links"><button class="edit">Edit passengers</button><button class="copy">Copy details</button></div>
        </div>
      </div>
      <button class="tab" hidden>IRCTC Autofill</button>`;
    const $ = (s) => root.querySelector(s);
    const items = (list, lines, className) => lines.forEach((text) => {
      const line = document.createElement(list.tagName === 'OL' ? 'li' : 'div');
      line.textContent = text;
      if (className) line.className = className;
      list.append(line);
    });

    function switches() {
      $('.armed').checked = saved.armed;
      $('.pay').checked = saved.completePayment;
    }

    function idle() {
      switches();
      $('.status').textContent = saved.armed ? 'On: waiting for you to click Book Now' : 'Off: turn on, then click Book Now';
      $('.status').className = `status${saved.armed ? ' on' : ''}`;
      $('.names').replaceChildren();
      confirm(saved.profile ? (saved.profile.confirmOnly ? 'on' : 'off') : null);
      if (saved.profile) items($('.names'), saved.profile.passengers.map((p) => p.name));
      else $('.status').textContent = 'No passengers saved. Click "Edit passengers".';
    }

    function report({ title, done = [], problems = [] }) {
      $('.status').textContent = title || (problems.length ? 'Stopped:' : 'Done');
      $('.status').className = 'status';
      $('.log').replaceChildren();
      items($('.log'), problems, 'problem');
      items($('.log'), done.map((t) => `✓ ${t}`), 'ok');
    }

    // The "Book only if confirm berths are allotted" line: the saved setting ('on'/'off') until the passenger page
    // is done, then what IRCTC's page shows ('ticked'/'unticked'/'missing'). It stays through review and payment.
    const CONFIRM = {
      on: ['Book only if confirm berths are allotted: On', 'good'],
      off: ['Book only if confirm berths are allotted: Off', ''],
      ticked: ['✓ Book only if confirm berths are allotted: ticked on IRCTC', 'good'],
      unticked: ['Book only if confirm berths are allotted: not ticked on IRCTC', ''],
      missing: ['Book only if confirm berths are allotted: not offered by IRCTC (waitlisted class)', 'warn'],
    };
    function confirm(state) {
      const [text, tone] = CONFIRM[state] || ['', ''];
      $('.confirm').textContent = text;
      $('.confirm').className = `confirm ${tone}`.trim();
    }

    // What the run is waiting on (a prompt, IRCTC loading), or null once the page is clear.
    function blocked(reason) {
      const text = reason ? `Waiting: ${reason}. It carries on once that's gone.` : '';
      if ($('.wait').textContent === text) return;
      $('.wait').textContent = text;
      $('.wait').hidden = !text;
    }

    const show = (open) => {
      $('.panel').hidden = !open;
      $('.tab').hidden = open;
    };

    $('.armed').addEventListener('change', () => {
      saved.armed = $('.armed').checked;
      if (!saved.armed) stop();
      chrome.storage.local.set({ armed: saved.armed });
      $('.log').replaceChildren();
      idle();
    });
    $('.pay').addEventListener('change', () => {
      saved.completePayment = $('.pay').checked;
      chrome.storage.local.set({ completePayment: saved.completePayment });
    });
    $('.hide').addEventListener('click', () => show(false));
    $('.tab').addEventListener('click', () => show(true));
    $('.edit').addEventListener('click', () => globalThis.chrome?.runtime?.sendMessage?.({ type: 'options' }));
    // Copy on pointerdown: an open dropdown closes on the click that follows, and it's what we want to see.
    $('.copy').addEventListener('pointerdown', async (event) => {
      event.preventDefault();
      const text = details();
      try {
        await navigator.clipboard.writeText(text);
        $('.copy').textContent = 'Copied';
      } catch {
        $('.details').hidden = false;
        $('.details').value = text;
        $('.details').select();
        $('.copy').textContent = 'Select all and copy';
      }
      setTimeout(() => { $('.copy').textContent = 'Copy details'; }, 3000);
    });

    document.body.append(host);
    return { idle, report, blocked, confirm, switches, clearLog: () => $('.log').replaceChildren(), show };
  })();

  chrome.storage.local.get(['profile', 'armed', 'completePayment']).then((stored) => {
    saved.profile = usable(stored.profile);
    saved.armed = !!stored.armed;
    saved.completePayment = !!stored.completePayment;
    panel.idle();
  });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.profile) saved.profile = usable(changes.profile.newValue);
    if (changes.armed) saved.armed = !!changes.armed.newValue;
    if (changes.completePayment) saved.completePayment = !!changes.completePayment.newValue;
    panel.switches();
    if (!flow && !busy) panel.idle();
  });

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'fill') runHere();
      if (message?.type === 'panel') panel.show(true);
    });
  }
})();
