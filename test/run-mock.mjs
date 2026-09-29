// Runs content.js against test/mock-irctc.html (train list → passenger → review → payment) in headless
// Edge/Chrome. Each scenario starts with a real (trusted) mouse click on Book Now.
// Usage: node test/run-mock.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];
const PORT = 9333;
const page = pathToFileURL(resolve(import.meta.dirname, 'mock-irctc.html')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browserPath = BROWSERS.find(existsSync);
if (!browserPath) throw new Error('No Edge or Chrome found');
const profile = mkdtempSync(join(tmpdir(), 'irctc-autofill-test-'));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`, 'about:blank',
]);

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const target = targets.find((t) => t.type === 'page');
      if (target) return target.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Browser did not start');
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  };
  const send = (method, params = {}) => new Promise((res) => {
    pending.set(++id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return new Promise((res) => { ws.onopen = () => res({ send, close: () => ws.close() }); });
}

async function evaluate(client, expression) {
  const { result } = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

async function waitUntil(client, expression, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(client, expression)) return true;
    await sleep(50);
  }
  return false;
}

async function open(client, scenario) {
  await client.send('Page.navigate', { url: `${page}?${scenario}` });
  await sleep(100);
  if (!(await waitUntil(client, `location.search === '?${scenario}' && document.readyState === 'complete' && !!window.mock?.ready`))) {
    throw new Error(`${scenario}: mock page did not load`);
  }
}

// A real mouse click, so the page sees isTrusted = true. `element` is JS that finds the element.
async function click(client, element) {
  const point = await evaluate(client, `(() => {
    const el = ${element};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })()`);
  if (!point) throw new Error(`nothing to click: ${element}`);
  const [x, y] = point;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await client.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}

async function typeAndEnter(client, text) {
  await client.send('Input.insertText', { text });
  const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...enter });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
}

const model = (client) => evaluate(client, 'JSON.parse(JSON.stringify(mock.model))');
const PANEL = "document.getElementById('irctc-autofill-panel').shadowRoot";
const BOOK_NOW = "document.getElementById('book-now')";
const panelText = (client) => evaluate(client, `${PANEL}.querySelector('.body').innerText`);
const reachedPayment = (client) => waitUntil(client, 'mock.model.payment !== null');

// The panel's "Copy details" text. Clipboard access fails on a file page, so it lands in the panel's text box.
async function details(client) {
  await evaluate(client, `${PANEL}.querySelector('.copy').dispatchEvent(new PointerEvent('pointerdown'))`);
  await sleep(200);
  return evaluate(client, `${PANEL}.querySelector('.details').value`);
}

const checks = [];
const expect = (label, ok) => checks.push({ label, ok });
const timings = [];

// The name box holds the first 16 characters of the selected name.
function expectFamily(label, rows) {
  expect(`${label}: 3 passengers selected from the dropdown`, rows.length === 3 && rows.every((r) => r.fromMasterList));
  expect(`${label}: right people in order (not "Ravi Kumar")`,
    rows.map((r) => r.passengerName).join('|') === 'Ravi Kumar Mohan|Meena Ravi Kumar|Asha Ravi Kumar ');
}

// Runs one scenario. If it throws, that's a failed check, and the panel and run details are printed.
async function scenario(client, name, run) {
  const before = checks.length;
  try {
    await open(client, name);
    await run();
  } catch (err) {
    expect(`${name}: ran to the end (${err.message})`, false);
  }
  if (checks.slice(before).some((c) => !c.ok)) {
    console.log(`--- ${name}: panel\n${await panelText(client).catch(() => '?')}`);
    console.log(`--- ${name}: details\n${await details(client).catch(() => '?')}\n`);
  }
}

try {
  const client = await cdp(await connect());
  await client.send('Page.enable');

  // Book Now → names from the dropdown → Continue → review Continue → E-Wallet, then stop.
  await scenario(client, 'flow', async () => {
    await waitUntil(client, `${PANEL}.querySelector('.armed').checked`);
    const idle = await panelText(client);
    expect('flow: panel shows it is on and waiting', idle.includes('On: waiting for you to click Book Now'));
    expect('flow: panel lists the saved names', idle.includes('Ravi Kumar Mohan Verma') && idle.includes('Asha Ravi Kumar Verma'));
    expect('flow: panel shows confirm berths is off', idle.includes('Book only if confirm berths are allotted: Off'));
    await click(client, BOOK_NOW);
    await reachedPayment(client);
    const m = await model(client);
    expectFamily('flow', m.rows);
    expect('flow: age filled in by IRCTC from the master list', m.rows[0]?.passengerAge === '38');
    expect('flow: sent no keystrokes', !m.keystrokes);
    expect('flow: left the other passenger page options alone', Object.keys(m.choices).length === 0);
    expect('flow: pressed passenger Continue', 'passengerContinue' in m.timeline);
    expect('flow: pressed review Continue', 'reviewContinue' in m.timeline);
    expect('flow: selected E-Wallet', m.payment === 'E-Wallet (Instant Payment)');
    await sleep(500);
    expect('flow: did not press Pay & Book', !(await model(client)).payClicked);
    const end = await panelText(client);
    expect('flow: panel says your turn to pay', end.includes('Your turn'));
    expect('flow: panel says the box wasn\'t ticked on IRCTC', end.includes('Book only if confirm berths are allotted: not ticked on IRCTC'));
    const t = m.timeline;
    timings.push(['passenger page shown → Continue pressed (3 passengers)', t.passengerContinue - t.passengerShown]);
    timings.push(['review page shown → Continue pressed', t.reviewContinue - t.reviewShown]);
    timings.push(['payment page shown → E-Wallet selected', t.paymentSelected - t.paymentShown]);
  });

  // Review page with a captcha: it waits in the captcha box; the person types it and presses Enter.
  await scenario(client, 'captcha', async () => {
    await click(client, BOOK_NOW);
    const focused = await waitUntil(client, "document.activeElement?.id === 'captcha'");
    let m = await model(client);
    expect('captcha: cursor put in captcha box', focused);
    expect('captcha: did not press Continue itself', !('reviewContinue' in m.timeline) && m.captcha === null);
    expect('captcha: says to type it', (await panelText(client)).includes('Type the captcha'));
    await typeAndEnter(client, 'X7K2P');
    await reachedPayment(client);
    m = await model(client);
    expect('captcha: typed text submitted as is', m.captcha === 'X7K2P' && !m.captchaError);
    expect('captcha: then selected E-Wallet', m.payment === 'E-Wallet (Instant Payment)' && !m.payClicked);
  });

  // Master list still loading when the passenger page appears: keeps reopening the dropdown until it's there.
  await scenario(client, 'slowlist', async () => {
    await click(client, BOOK_NOW);
    await reachedPayment(client);
    const m = await model(client);
    expectFamily('slowlist', m.rows);
    expect('slowlist: reached payment', m.payment === 'E-Wallet (Instant Payment)');
  });

  // A prompt after Book Now, IRCTC's loading screen, then a prompt on the passenger page: it waits through each,
  // never answers them, and carries on once you have.
  await scenario(client, 'prompt', async () => {
    await click(client, BOOK_NOW);
    await waitUntil(client, "!!document.querySelector('.ui-dialog')");
    await sleep(500);
    expect('prompt: waits while the prompt after Book Now is open', !('passengerShown' in (await model(client)).timeline)
      && (await panelText(client)).includes('Waiting: the "Confirmation" prompt is open'));
    await click(client, "document.querySelector('.dialog-ok')");
    await waitUntil(client, "!!document.querySelector('app-passenger .ui-dialog')", 10000);
    await sleep(500);
    let m = await model(client);
    expect('prompt: waited for the loading screen to go', m.timeline.firstPick >= m.timeline.loaderGone);
    expect('prompt: waits while a prompt on the passenger page is open',
      m.rows[1]?.passengerName === 'Meena Ravi Kumar' && !m.rows[2]?.passengerName && !('passengerContinue' in m.timeline)
      && (await panelText(client)).includes('Waiting: the "Information" prompt is open'));
    await click(client, "document.querySelector('app-passenger .dialog-ok')");
    await reachedPayment(client);
    m = await model(client);
    expectFamily('prompt', m.rows);
    expect('prompt: then carried on to payment', m.payment === 'E-Wallet (Instant Payment)' && !m.payClicked);
  });

  // IRCTC won't add a third row: the panel passes on IRCTC's message, and it doesn't press Continue.
  await scenario(client, 'limit', async () => {
    await click(client, BOOK_NOW);
    await waitUntil(client, `${PANEL}.querySelector('.log').textContent.includes('row 3')`, 15000);
    const m = await model(client);
    expect('limit: selected passengers one row at a time', m.rows.length === 2 && m.rows.every((r) => r.fromMasterList));
    expect('limit: shows IRCTC\'s message', (await panelText(client)).includes("IRCTC didn't add row 3: Error Maximum 2 passengers allowed."));
    expect('limit: did not press Continue', !('passengerContinue' in m.timeline));
  });

  // "Book only if confirm berths are allotted" saved: it ticks IRCTC's box (a hidden css-checkbox), then continues.
  await scenario(client, 'confirm', async () => {
    await waitUntil(client, `${PANEL}.querySelector('.armed').checked`);
    expect('confirm: panel shows the setting is on', (await panelText(client)).includes('Book only if confirm berths are allotted: On'));
    await click(client, BOOK_NOW);
    await reachedPayment(client);
    const m = await model(client);
    expectFamily('confirm', m.rows);
    expect('confirm: ticked the box and nothing else', JSON.stringify(m.choices) === '{"bookOnlyIfCnf":true}');
    expect('confirm: then carried on to payment', 'passengerContinue' in m.timeline && m.payment === 'E-Wallet (Instant Payment)');
    expect('confirm: panel still says it was ticked, on the payment page',
      (await panelText(client)).includes('✓ Book only if confirm berths are allotted: ticked on IRCTC'));
  });

  // Saved, but IRCTC doesn't offer the box (waitlisted class): it stops before Continue and says why.
  await scenario(client, 'waitlist', async () => {
    await click(client, BOOK_NOW);
    await waitUntil(client, `${PANEL}.querySelector('.log').textContent.includes('confirm berths')`, 15000);
    await sleep(300);
    const m = await model(client);
    expectFamily('waitlist', m.rows);
    const text = await panelText(client);
    expect('waitlist: says the option is missing', text.includes("isn't on this page")
      && text.includes('Book only if confirm berths are allotted: not offered by IRCTC'));
    expect('waitlist: did not press Continue', !('passengerContinue' in m.timeline));
  });

  // A name that isn't in the master list: nothing to select, so it stops before Continue.
  await scenario(client, 'notfound', async () => {
    await click(client, BOOK_NOW);
    await waitUntil(client, `${PANEL}.querySelector('.log').textContent.includes('Sunil')`, 15000);
    const m = await model(client);
    expect('notfound: names the missing passenger and what the dropdown showed', (await panelText(client))
      .includes('Sunil Verma: not in the dropdown, which showed: Ravi Kumar, Meena Ravi Kumar Verma'));
    expect('notfound: still selected the others', m.rows[0]?.passengerName === 'Ravi Kumar Mohan');
    expect('notfound: did not press Continue', !('passengerContinue' in m.timeline));
  });

  // A scripted click on Book Now must not start anything.
  await scenario(client, 'untrusted', async () => {
    await evaluate(client, `${BOOK_NOW}.click()`);
    await waitUntil(client, "'passengerShown' in mock.model.timeline");
    await sleep(1500);
    const m = await model(client);
    expect('untrusted: passenger page not touched', !m.rows[0]?.passengerName && !('passengerContinue' in m.timeline));
  });

  // Switch off: your Book Now click does nothing. Turning it on is saved.
  await scenario(client, 'off', async () => {
    await waitUntil(client, `${PANEL}.querySelector('.status').textContent.startsWith('Off')`);
    await click(client, BOOK_NOW);
    await waitUntil(client, "'passengerShown' in mock.model.timeline");
    await sleep(1500);
    const m = await model(client);
    expect('off: passenger page not touched', !m.rows[0]?.passengerName && !('passengerContinue' in m.timeline));
    await click(client, `${PANEL}.querySelector('.armed')`);
    await sleep(200);
    expect('off: switch turns it on and saves that', (await evaluate(client, 'mock.stored.armed')) === true
      && (await panelText(client)).includes('On: waiting for you to click Book Now'));
  });

  client.close();
  for (const { label, ok } of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
  for (const [label, ms] of timings) console.log(`  ${label}: ${ms} ms`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} finally {
  // Close through DevTools: on Windows the spawned PID isn't the process that keeps running.
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const root = await cdp(webSocketDebuggerUrl);
    root.send('Browser.close');
  } catch {
    browser.kill();
  }
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      await sleep(200);
    } catch {
      break;
    }
  }
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    console.log(`(could not delete temp profile ${profile})`);
  }
}
