// End-to-end smoke test in a real Chromium browser (Brave by default).
// Every hostname resolves to a local test server, so nothing leaves the machine.
//
//   npm run build && node scripts/e2e.mjs [screenshot-dir]
//   BROWSER=google-chrome node scripts/e2e.mjs
//
// Note: branded Google Chrome 137+ ignores --load-extension; use Brave or Chromium.

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { connect, createServer as createNetServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const extension = join(root, 'dist/chrome');
const shots = process.argv[2] ?? join(root, 'dist/e2e');
const browser = process.env.BROWSER ?? 'brave-browser';
const PORT = 8765;
const DEBUG_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- local "internet"

const profile = await mkdtemp(join(tmpdir(), 'clearmind-e2e-'));

// Brave upgrades http:// to https://, so serve both on one port with a
// throwaway self-signed certificate (the browser runs with cert errors ignored).
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=clearmind-test',
  '-keyout', join(profile, 'key.pem'), '-out', join(profile, 'cert.pem')], { stdio: 'ignore' });
// A stand-in for a single-page app (reddit): the URL changes first and the
// content is swapped a second later, either replaced or refilled in place.
const SPA_PAGE = `<!doctype html><title>spa</title><body>
<shreddit-feed id="feed">home feed post</shreddit-feed>
<script>
  window.goReplace = () => {
    history.pushState({}, '', '/r/test/');
    setTimeout(() => {
      document.getElementById('feed').remove();
      const next = document.createElement('shreddit-feed');
      next.id = 'next';
      next.textContent = 'subreddit post';
      document.body.append(next);
    }, 1000);
  };
  window.goReuse = () => {
    history.pushState({}, '', '/r/reused/');
    setTimeout(() => (document.getElementById('feed').textContent = 'subreddit post'), 500);
  };
</script></body>`;

const respond = (req, res) => {
  if (req.url.includes('spa=1')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(SPA_PAGE);
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>${req.headers.host}</title><body style="background:#fff"><h1>test page: ${req.headers.host}${req.url}</h1></body>`);
};
const plain = createServer(respond);
const tls = createTlsServer({ key: await readFile(join(profile, 'key.pem')), cert: await readFile(join(profile, 'cert.pem')) }, respond);
await new Promise((r) => plain.listen(PORT + 1, '127.0.0.1', r));
await new Promise((r) => tls.listen(PORT + 2, '127.0.0.1', r));
// The public port sniffs the first byte (0x16 = TLS handshake) and proxies.
const server = createNetServer((socket) => {
  socket.once('data', (first) => {
    const upstream = connect(first[0] === 0x16 ? PORT + 2 : PORT + 1, '127.0.0.1');
    upstream.write(first);
    socket.pipe(upstream).pipe(socket);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const proc = spawn(browser, [
  '--headless=new',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--load-extension=${extension}`,
  `--disable-extensions-except=${extension}`,
  `--host-resolver-rules=MAP * 127.0.0.1:${PORT}, EXCLUDE 127.0.0.1`,
  '--ignore-certificate-errors',
  '--no-first-run', '--no-default-browser-check', '--disable-component-update', '--window-size=1280,860',
], { stdio: 'ignore', detached: true });

// ---------------------------------------------------------------- tiny CDP client

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  } catch {
    ws = null;
    await sleep(200);
  }
}
if (!ws) throw new Error(`could not start ${browser}`);

let nextId = 0;
const waiting = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};
const cdp = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function attach(targetId) {
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Page.enable', {}, sessionId).catch(() => {});
  return sessionId;
}

async function evaluate(sessionId, expression) {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function open(url) {
  const { targetId } = await cdp('Target.createTarget', { url });
  const sessionId = await attach(targetId);
  await sleep(800);
  return { targetId, sessionId };
}

async function urlOf(targetId) {
  const { targetInfo } = await cdp('Target.getTargetInfo', { targetId });
  return targetInfo.url;
}

async function shot(sessionId, name, width = 1280, height = 860) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await sleep(300);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------- the run

try {
  await mkdir(shots, { recursive: true });
  let extId;
  for (let i = 0; i < 50 && !extId; i++) {
    const { targetInfos } = await cdp('Target.getTargets');
    const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background/service-worker.js'));
    if (sw) {
      extId = new URL(sw.url).host;
      await attach(sw.targetId);
    } else await sleep(200);
  }
  check('extension loaded', Boolean(extId));
  const page = (path) => `chrome-extension://${extId}/pages/${path}`;

  let setupOpened = false;
  for (let i = 0; i < 25 && !setupOpened; i++) {
    setupOpened = (await cdp('Target.getTargets')).targetInfos.some((t) => t.url.endsWith('options.html#setup'));
    if (!setupOpened) await sleep(200);
  }
  check('setup page opened on install', setupOpened);

  const options = await open(page('options.html#setup'));
  await shot(options.sessionId, 'options-setup', 1280, 900);
  const send = (msg) => evaluate(options.sessionId, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);

  // Set the password through the setup form, as a new user would.
  await evaluate(options.sessionId, `(() => {
    document.getElementById('setup-pw').value = 'short';
    document.getElementById('setup-pw-repeat').value = 'short';
    document.querySelector('#setup-pw').form.requestSubmit();
  })()`);
  await sleep(300);
  check('setup rejects a short password', (await evaluate(options.sessionId, `document.querySelector('.error').textContent`)).includes('at least'));
  await evaluate(options.sessionId, `(() => {
    document.getElementById('setup-pw').value = 'clearmind123';
    document.getElementById('setup-pw-repeat').value = 'clearmind123';
    document.querySelector('#setup-pw').form.requestSubmit();
  })()`);
  await sleep(1500);
  const stored = await evaluate(options.sessionId, `chrome.storage.local.get('settings').then((s) => Boolean(s.settings.password))`);
  check('set password from the setup page', stored && (await evaluate(options.sessionId, `document.body.textContent.includes('add your first site')`)));
  await shot(options.sessionId, 'options-setup-done', 1280, 900);
  await evaluate(options.sessionId, `location.hash = 'help'`);
  await sleep(400);
  check('help shows the guide with a settings link instead of the form', await evaluate(options.sessionId,
    `!document.getElementById('setup-pw') && !!document.querySelector('a[href="#settings"]') && document.body.textContent.includes('blocked sites')`));
  await shot(options.sessionId, 'options-help', 1280, 900);
  const site = (domain, extra) => ({
    domain, mode: 'limit', limitMin: 30, cooldownSec: 5, show: 'message', redirectUrl: '', modify: {},
    message: 'Go write the thing. Reddit will still be here at 18:00.',
    cooldownMessage: 'Thirty seconds. What were you about to do before this?', ...extra,
  });
  for (const s of [
    site('reddit.com'),
    site('x.com', { limitMin: 20, show: 'redirect', redirectUrl: 'https://getpocket.com/saves' }),
    site('youtube.com', { limitMin: 60 }),
    site('instagram.com', { mode: 'block' }),
  ]) check(`save ${s.domain}`, (await send({ type: 'saveSite', site: s })).ok);

  // Seed usage: reddit is over its limit today; a week of history for the chart.
  await evaluate(options.sessionId, `(async () => {
    const key = (offset) => { const d = new Date(); d.setDate(d.getDate() - offset); return d.toLocaleDateString('sv-SE'); };
    const min = 60000, days = {};
    [62, 48, 140, 70, 55, 80].forEach((m, i) => days[key(6 - i)] = { sites: { 'reddit.com': { ms: m * min * 0.4, blocks: 1, unlocks: 0, limitMin: 30 }, 'youtube.com': { ms: m * min * 0.6, blocks: 0, unlocks: i === 2 ? 1 : 0, limitMin: 60 } }, categories: {}, forced: {} });
    days[key(4)].sites['reddit.com'].ms = 45 * min;
    days[key(0)] = { sites: { 'reddit.com': { ms: 31 * min, blocks: 2, unlocks: 0, limitMin: 30 }, 'x.com': { ms: 12 * min, blocks: 0, unlocks: 0, limitMin: 20 }, 'youtube.com': { ms: 30 * min, blocks: 0, unlocks: 0, limitMin: 60 }, 'instagram.com': { ms: 0, blocks: 3, unlocks: 0 } }, categories: { social: { blocks: 4, unlocks: 0 }, news: { ms: 2 * min, blocks: 0, unlocks: 0, limitMin: 1 } }, forced: {} };
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ days, settings: { ...settings, statsSince: Date.now() - 15 * 86400000 } });
  })()`);
  const categories = { adult: { mode: 'full' }, gambling: { mode: 'full' }, social: { mode: 'window', windowLength: '2h' }, news: { mode: 'limit', limitMin: 1 } };
  check('per-category auto mode + focus window', (await send({ type: 'saveAuto', categories, startWindow: 'social' })).ok);

  // Password-guarded changes.
  check('loosening a rule needs the password', (await send({ type: 'saveSite', site: site('reddit.com', { mode: 'watch' }) })).needPassword === true);
  check('removing a site needs the password', (await send({ type: 'removeSite', domain: 'youtube.com' })).needPassword === true);
  check('wrong password is rejected', (await send({ type: 'removeSite', domain: 'youtube.com', password: 'nope' })).error === 'wrong password');
  check('turning off a running category needs the password', (await send({ type: 'saveAuto', categories: { social: { mode: 'off' } } })).needPassword === true);
  check('leaving "block completely" needs the password', (await send({ type: 'saveAuto', categories: { adult: { mode: 'window' } } })).needPassword === true);
  check('tightening a category does not', (await send({ type: 'saveAuto', categories: { shopping: { mode: 'full' } } })).ok === true);

  // Adding a URL in any form lands on the same normalised entry.
  for (const typed of ['https://www.reddit.com/', 'www.reddit.com/']) {
    await evaluate(options.sessionId, `location.hash = 'sites'`);
    await sleep(400);
    await evaluate(options.sessionId, `(() => { const i = document.getElementById('domain'); i.value = ${JSON.stringify(typed)}; i.form.requestSubmit(); })()`);
    await sleep(600);
    const landed = await evaluate(options.sessionId, `[location.hash, document.querySelector('h1').textContent, document.querySelector('.chip').textContent]`);
    check(`add "${typed}" opens the existing reddit.com rule`, landed[0] === '#site/reddit.com' && landed[1] === 'reddit.com' && landed[2].startsWith('added'), JSON.stringify(landed));
  }
  check('reddit.com edit page says it overrides auto mode', await evaluate(options.sessionId,
    `new Promise((r) => setTimeout(() => r(document.querySelector('.notice')?.textContent ?? ''), 400))`).then((t) => t.includes('overrides auto mode') && t.includes('Social feeds')));

  for (const view of ['stats', 'sites', 'site/reddit.com', 'auto/social', 'settings']) {
    await evaluate(options.sessionId, `location.hash = '${view}'`);
    await sleep(500);
    await shot(options.sessionId, `options-${view.replace('/', '-')}`, 1280, view === 'stats' ? 1120 : view.startsWith('site/') ? 1000 : 860);
  }

  // Browsing: reddit is over its limit.
  const tab = await open('http://reddit.com/');
  await sleep(700);
  let url = await urlOf(tab.targetId);
  check('over-limit site shows the block page', url.startsWith(page('blocked.html')) && url.includes('r=limit'), url);
  await shot(tab.sessionId, 'blocked');

  const tabs = await evaluate(options.sessionId, `chrome.tabs.query({}).then(ts => ts.map(t => ({ id: t.id, url: t.url })))`);
  const tabId = tabs.find((t) => t.url.includes('blocked.html')).id;
  const popup = await open(page(`popup.html?tab=${tabId}`));
  await shot(popup.sessionId, 'popup-blocked', 360, 600);
  check('blocked popup: no unblock button, points to the block page', await evaluate(popup.sessionId,
    `!document.getElementById('unblock') && !document.getElementById('unlock-hint').hidden && document.getElementById('block').hidden`));
  check('popup footer shows the current version', (await evaluate(popup.sessionId, `document.getElementById('foot-note').textContent`)).startsWith('v1.1'));
  await evaluate(popup.sessionId, `document.getElementById('modify').click()`);
  await sleep(800);
  check('popup "modify view" opens the site edit page', (await cdp('Target.getTargets')).targetInfos.some((t) => t.url.endsWith('options.html#site/reddit.com')));

  check('unlock form starts folded away', await evaluate(tab.sessionId, `!document.getElementById('unlock-details').open`));
  await evaluate(tab.sessionId, `document.querySelector('#unlock-details > summary').click()`);
  await sleep(200);
  check('expanding shows the password field', await evaluate(tab.sessionId, `document.getElementById('unlock-details').open && document.activeElement.id === 'pw'`));
  await shot(tab.sessionId, 'blocked-expanded');
  await evaluate(tab.sessionId, `document.getElementById('pw').value = 'wrong'; document.getElementById('unlock').click()`);
  await sleep(600);
  check('wrong password shows an error', (await evaluate(tab.sessionId, `document.getElementById('error').textContent`)) === 'wrong password');
  await evaluate(tab.sessionId, `document.getElementById('pw').value = 'clearmind123'; document.getElementById('unlock').click()`);
  await sleep(1500);
  url = await urlOf(tab.targetId);
  check('right password starts the cooldown', url.startsWith(page('unlocking.html')), url);
  // A javascript: original URL never becomes the "continue" target.
  const evil = await evaluate(tab.sessionId, `chrome.runtime.sendMessage({ type: 'startUnlock', domain: 'reddit.com', url: 'javascript:alert(1)', password: 'clearmind123' })`);
  const evilTarget = await evaluate(tab.sessionId, `chrome.runtime.sendMessage({ type: 'getUnlock', token: ${JSON.stringify(evil.token)} }).then((u) => u.url)`);
  check('unlock ignores a javascript: target', evil.ok && evilTarget === null, JSON.stringify(evilTarget));
  await evaluate(tab.sessionId, `chrome.runtime.sendMessage({ type: 'cancelUnlock', token: ${JSON.stringify(evil.token)} })`);
  await shot(tab.sessionId, 'unlocking');
  await sleep(5000);
  check('cooldown finishes', await evaluate(tab.sessionId, `!document.getElementById('done').hidden`));
  await shot(tab.sessionId, 'unlocking-done');
  await evaluate(tab.sessionId, `document.getElementById('continue').click()`);
  await sleep(1200);
  url = await urlOf(tab.targetId);
  check('unlocked tab opens the site', /^https?:\/\/reddit\.com\/$/.test(url), url);
  check('modify view CSS injected on reddit', await evaluate(tab.sessionId, `!!document.getElementById('clearmind-modify') && document.documentElement.dataset.cmRoute === 'home'`));

  // In-page navigation must not flash the hidden home feed (reddit SPA).
  const display = (id) => evaluate(tab.sessionId, `(() => { const el = document.getElementById('${id}'); return el ? getComputedStyle(el).display : 'gone'; })()`);
  await cdp('Page.navigate', { url: 'http://reddit.com/?spa=1' }, tab.sessionId);
  await sleep(1200);
  check('home feed hidden on the SPA page', (await display('feed')) === 'none');
  await evaluate(tab.sessionId, 'goReplace()');
  const seen = [];
  for (let i = 0; i < 9; i++) {
    seen.push(await display('feed'));
    await sleep(100);
  }
  check('old feed stays hidden while the next page loads', seen.every((d) => d === 'none' || d === 'gone'), seen.join(','));
  // The page's own timers are throttled in background tabs, so wait for it.
  const shown = async (id) => {
    for (let i = 0; i < 25; i++) {
      if (!['none', 'gone'].includes(await display(id))) return true;
      await sleep(200);
    }
    return false;
  };
  check("the next page's feed is shown", await shown('next'), await display('next'));
  await cdp('Page.navigate', { url: 'http://reddit.com/?spa=1' }, tab.sessionId);
  await sleep(1200);
  await evaluate(tab.sessionId, 'goReuse()');
  await sleep(250);
  const beforeRefill = await display('feed');
  check('a feed element reused for the next page is shown once refilled', beforeRefill === 'none' && (await shown('feed')), `${beforeRefill} -> ${await display('feed')}`);

  await cdp('Target.closeTarget', { targetId: popup.targetId }).catch(() => {}); // already closed by "modify view"
  const popup2 = await open(page(`popup.html?tab=${tabId}`));
  await sleep(500);
  check('popup shows the unlock', (await evaluate(popup2.sessionId, `document.getElementById('status').textContent`)) === 'UNLOCKED');
  await shot(popup2.sessionId, 'popup-unlocked', 360, 600);
  check('unlocked popup hides the hint and offers "block this site"', await evaluate(popup2.sessionId,
    `document.getElementById('unlock-hint').hidden && !document.getElementById('block').hidden`));

  const other = await open('http://reddit.com/r/popular');
  await sleep(600);
  url = await urlOf(other.targetId);
  check('unlock is per tab', url.includes('blocked.html'), url);

  for (const [target, expect] of [
    ['https://www.reddit.com/', 'd=reddit.com&r=limit'],
    ['http://instagram.com/', 'r=block'],
    ['http://www.pornhub.com/', 'c=adult'],
    ['http://bet365.com/', 'c=gambling'],
    ['http://tiktok.com/', 'c=social'],
    ['http://bbc.com/', 'r=category-limit'],
  ]) {
    await cdp('Page.navigate', { url: target }, other.sessionId);
    await sleep(900);
    url = await urlOf(other.targetId);
    check(`${target} blocked (${expect})`, url.includes('blocked.html') && url.includes(expect), url);
  }
  await shot(other.sessionId, 'blocked-category');

  // A blocked-sites entry overrides auto mode for its domain.
  const watchTiktok = { type: 'saveSite', site: site('tiktok.com', { mode: 'watch' }) };
  check('override weaker than the category needs the password', (await send(watchTiktok)).needPassword === true);
  check('override saved with the password', (await send({ ...watchTiktok, password: 'clearmind123' })).ok === true);
  await cdp('Page.navigate', { url: 'http://tiktok.com/' }, other.sessionId);
  await sleep(900);
  check('watch rule overrides the social category', /^https?:\/\/tiktok\.com\/$/.test(await urlOf(other.targetId)));
  check('a limit override of a running window needs the password', (await send({ type: 'saveSite', site: site('9gag.com', { limitMin: 1440 }) })).needPassword === true);
  check('stricter override needs no password', (await send({ type: 'saveSite', site: site('pornhub.com', { mode: 'block', cooldownSec: 30 }) })).ok === true);
  check('a subdomain rule cannot escape its parent without the password',
    (await send({ type: 'saveSite', site: site('old.reddit.com', { mode: 'watch' }) })).needPassword === true);
  await cdp('Page.navigate', { url: 'http://pornhub.com/' }, other.sessionId);
  await sleep(900);
  url = await urlOf(other.targetId);
  check('site rule, not the category, blocks pornhub.com', url.includes('r=block') && !url.includes('c=adult'), url);

  await cdp('Page.navigate', { url: 'http://x.com/home' }, other.sessionId);
  await sleep(900);
  check('redirect rule is not applied while under the limit', /^https?:\/\/x\.com\/home$/.test(await urlOf(other.targetId)));
  await cdp('Page.navigate', { url: 'http://example.org/' }, other.sessionId);
  await sleep(900);
  check('unlisted site loads', /^https?:\/\/example\.org\/$/.test(await urlOf(other.targetId)));
  const otherId = (await evaluate(options.sessionId, `chrome.tabs.query({}).then(ts => ts.map(t => [t.id, t.url]))`))
    .find(([, u]) => /example\.org/.test(u))[0];
  const popup3 = await open(page(`popup.html?tab=${otherId}`));
  await sleep(400);
  await evaluate(popup3.sessionId, `document.getElementById('block').click()`);
  await sleep(1200);
  url = await urlOf(other.targetId);
  check('popup "block this site" adds it and blocks the tab', url.includes('blocked.html') && url.includes('d=example.org') && url.includes('r=block'), url);

  check('no uncaught errors', errors.length === 0, errors.join('\n'));
} catch (error) {
  check('run completed', false, error.stack);
} finally {
  ws.close();
  // The launcher is often a wrapper script: end the whole process group.
  try { process.kill(-proc.pid); } catch {}
  server.close();
  plain.close();
  tls.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}

console.log(`\nscreenshots: ${shots}`);
process.exit(failures ? 1 : 0);
