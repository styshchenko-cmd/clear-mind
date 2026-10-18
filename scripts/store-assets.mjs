// Renders the store images into store/: captioned 1280×800 screenshots of the
// real extension (seeded with demo data) and the promo tiles.
//
//   npm run build && node scripts/store-assets.mjs
//   BROWSER=chromium node scripts/store-assets.mjs
//
// Like scripts/e2e.mjs, every hostname resolves to a local server.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const extension = join(root, 'dist/chrome');
const out = join(root, 'store');
const browser = process.env.BROWSER ?? 'brave-browser';
const PORT = 8775;
const DEBUG_PORT = 9355;
const PASSWORD = 'demo-password-123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60_000;

// ---------------------------------------------------------------- local server

// Pages under /__store/ are the caption frames and tiles; anything else is a
// plain stand-in page for whatever site was requested.
const pages = new Map();
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path.startsWith('/__store/fonts/')) {
    res.writeHead(200, { 'content-type': 'font/woff2' });
    return res.end(await readFile(join(root, 'src/styles/fonts', path.slice('/__store/fonts/'.length))));
  }
  if (pages.has(path)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(pages.get(path));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${req.headers.host}</title><body style="margin:0;background:#f6f7f8;font:16px system-ui;padding:40px">${req.headers.host}</body>`);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = await mkdtemp(join(tmpdir(), 'clearmind-store-'));
const proc = spawn(browser, [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`,
  `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
  `--host-resolver-rules=MAP * 127.0.0.1:${PORT}, EXCLUDE 127.0.0.1`,
  '--disable-features=HttpsUpgrades', '--no-first-run', '--no-default-browser-check', '--disable-component-update',
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
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  const pending = msg.id && waiting.get(msg.id);
  if (!pending) return;
  waiting.delete(msg.id);
  msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
};
const cdp = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function evaluate(sessionId, expression) {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function open(url, width, height, scale = 2) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
  await cdp('Page.navigate', { url }, sessionId);
  await sleep(1200);
  return { targetId, sessionId };
}

async function capture(sessionId) {
  await evaluate(sessionId, 'document.fonts.ready.then(() => true)');
  // Scrollbars are noise in a store image. (Set through CSSOM: the extension's
  // CSP rightly refuses injected <style> elements.)
  await evaluate(sessionId, `document.documentElement.style.scrollbarWidth = 'none'`);
  await sleep(150);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId);
  return data;
}

// ---------------------------------------------------------------- frames

const FONT_FACE = [400, 500, 600].map((w) =>
  `@font-face { font-family: 'Plex'; font-weight: ${w}; src: url(/__store/fonts/ibm-plex-mono-latin-${w}-normal.woff2) format('woff2'); }`).join('\n');
const BASE_CSS = `${FONT_FACE}
* { box-sizing: border-box; } html, body { margin: 0; }
body { background: #0a0c0a; color: #d9ded5; font-family: 'Plex', monospace; overflow: hidden; }
.g { color: #5de28a; } .m { color: #8d968e; } .a { color: #e8b45a; } .r { color: #e86f6f; }`;

// A 1280×800 store screenshot: caption on top, the real page below.
function framed(kicker, title, png) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
  .wrap { width: 1280px; height: 800px; padding: 40px 80px 0; display: flex; flex-direction: column; gap: 28px; }
  .kicker { font-size: 15px; letter-spacing: 0.08em; }
  h1 { margin: 10px 0 0; font-size: 34px; line-height: 44px; font-weight: 600; }
  .shot { flex: 1; min-height: 0; border: 1px solid #262c27; border-bottom: 0; border-radius: 8px 8px 0 0; overflow: hidden; }
  .shot img { width: 100%; display: block; }
  </style><div class="wrap"><div><div class="kicker"><span class="g">&gt;</span> clearmind <span class="m">// ${kicker}</span></div><h1>${title}</h1></div>
  <div class="shot"><img src="data:image/png;base64,${png}"></div></div>`;
}

// The popup beside a short pitch.
function popupFrame(png) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
  .wrap { width: 1280px; height: 800px; padding: 0 120px; display: flex; align-items: center; justify-content: space-between; gap: 80px; }
  .text { display: flex; flex-direction: column; gap: 22px; max-width: 560px; }
  .kicker { font-size: 15px; letter-spacing: 0.08em; }
  h1 { margin: 0; font-size: 40px; line-height: 52px; font-weight: 600; }
  p { margin: 0; font-size: 19px; line-height: 30px; }
  .popup { width: 362px; border: 1px solid #3a433c; border-radius: 8px; overflow: hidden; flex: none; }
  .popup img { width: 360px; display: block; }
  </style><div class="wrap"><div class="text"><div class="kicker"><span class="g">&gt;</span> clearmind <span class="m">// toolbar</span></div>
  <h1>Time left today, one click away.</h1>
  <p class="m">See the rule for the site you're on and how much of today's allowance is left. Block it on the spot, or tidy its feed with modify view.</p>
  <p><span class="a">block · limit · tidy</span> <span class="m">· resets at 00:00 · all data stays local</span></p></div>
  <div class="popup"><img src="data:image/png;base64,${png}"></div></div>`;
}

function tile(width, height) {
  const big = width > 600;
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
  .wrap { width: ${width}px; height: ${height}px; padding: ${big ? '0 110px' : '0 34px'}; display: flex; flex-direction: column; justify-content: center; gap: ${big ? 26 : 14}px;
    background: #0a0c0a; border: 1px solid #262c27; }
  .brand { font-size: ${big ? 72 : 38}px; font-weight: 600; display: flex; align-items: center; gap: ${big ? 22 : 12}px; }
  .cursor { display: inline-block; width: ${big ? 30 : 16}px; height: ${big ? 66 : 34}px; background: #5de28a; }
  .tag { font-size: ${big ? 30 : 17}px; line-height: 1.35; }
  .rows { display: flex; flex-direction: column; gap: ${big ? 14 : 8}px; font-size: ${big ? 21 : 12.5}px; }
  .bar { height: ${big ? 10 : 6}px; background: #1a201b; border-radius: 2px; overflow: hidden; width: ${big ? 520 : 150}px; }
  .bar > span { display: block; height: 100%; }
  .row { display: flex; align-items: center; gap: ${big ? 18 : 10}px; }
  .site { width: ${big ? 190 : 108}px; }
  </style><div class="wrap">
  <div class="brand"><span class="g">&gt;</span><span>clearmind</span><span class="cursor"></span></div>
  <div class="tag">Your attention, back. <span class="m">Block, limit and tidy the sites you choose.</span></div>
  <div class="rows">
    <div class="row"><span class="site">reddit.com</span><span class="bar"><span style="width:100%;background:#e86f6f"></span></span><span class="r">limit hit</span></div>
    <div class="row"><span class="site">youtube.com</span><span class="bar"><span style="width:62%;background:#e8b45a"></span></span><span class="a">22m left</span></div>
    ${big ? '<div class="row"><span class="site">news</span><span class="bar"><span style="width:0%"></span></span><span class="g">focus window · 2h</span></div>' : ''}
  </div></div>`;
}

async function renderPage(name, html, width, height) {
  pages.set(`/__store/${name}.html`, html);
  const page = await open(`http://127.0.0.1:${PORT}/__store/${name}.html`, width, height, 1);
  await writeFile(join(out, `${name}.png`), Buffer.from(await capture(page.sessionId), 'base64'));
  await cdp('Target.closeTarget', { targetId: page.targetId });
  console.log(`store/${name}.png`);
}

// ---------------------------------------------------------------- run

try {
  await mkdir(out, { recursive: true });
  let extId;
  for (let i = 0; i < 50 && !extId; i++) {
    const { targetInfos } = await cdp('Target.getTargets');
    const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background/service-worker.js'));
    if (sw) extId = new URL(sw.url).host;
    else await sleep(200);
  }
  if (!extId) throw new Error('extension did not load');
  const page = (path) => `chrome-extension://${extId}/pages/${path}`;

  // Demo data.
  const options = await open(page('options.html#help'), 1280, 697);
  const send = (msg) => evaluate(options.sessionId, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
  await send({ type: 'setPassword', next: PASSWORD });
  const site = (domain, extra) => ({
    domain, mode: 'limit', limitMin: 30, cooldownSec: 30, show: 'message', redirectUrl: '', modify: {},
    message: 'Go do the thing you opened the browser for.',
    cooldownMessage: 'Thirty seconds. What were you about to do before this?', ...extra,
  });
  for (const s of [
    site('reddit.com', { message: 'Go write the thing. Reddit will still be here at 18:00.' }),
    site('youtube.com', { limitMin: 60 }),
    site('x.com', { limitMin: 20 }),
    site('instagram.com', { mode: 'block' }),
    site('news.ycombinator.com', { mode: 'watch' }),
  ]) await send({ type: 'saveSite', site: s, password: PASSWORD });
  await evaluate(options.sessionId, `(async () => {
    const key = (offset) => { const d = new Date(); d.setDate(d.getDate() - offset); return d.toLocaleDateString('sv-SE'); };
    const min = ${MIN}, days = {};
    const day = (r, y, x, hn, blocks) => ({ sites: {
      'reddit.com': { ms: r * min, blocks, unlocks: 0, limitMin: 30 }, 'youtube.com': { ms: y * min, blocks: 0, unlocks: 0, limitMin: 60 },
      'x.com': { ms: x * min, blocks: 0, unlocks: 0, limitMin: 20 }, 'instagram.com': { ms: 0, blocks: 2, unlocks: 0 },
      'news.ycombinator.com': { ms: hn * min, blocks: 0, unlocks: 0 } }, categories: { social: { ms: 0, blocks: 1, unlocks: 0 } }, forced: {} });
    [[28, 41, 12, 18, 1], [19, 35, 9, 25, 0], [30, 64, 20, 31, 3], [24, 38, 15, 12, 1], [22, 50, 8, 20, 0], [27, 44, 17, 9, 2]]
      .forEach((d, i) => days[key(6 - i)] = day(...d));
    days[key(0)] = day(30, 38, 12, 14, 3);
    days[key(0)].sites['reddit.com'].ms = 30 * min + 20000;
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ days, settings: { ...settings, statsSince: Date.now() - 12 * 86400000 } });
  })()`);
  await send({
    type: 'saveAuto', password: PASSWORD, startWindow: 'social',
    categories: { adult: { mode: 'full' }, gambling: { mode: 'full' }, social: { mode: 'window', windowLength: '2h' }, news: { mode: 'limit', limitMin: 20 } },
  });
  await sleep(500);

  const shots = {};
  // Block page.
  const blocked = await open('http://reddit.com/', 1280, 697);
  await sleep(1200);
  shots.blocked = await capture(blocked.sessionId);
  // Options views.
  for (const [name, hash] of [['stats', 'stats'], ['auto', 'auto/social'], ['site', 'site/reddit.com']]) {
    await evaluate(options.sessionId, `location.hash = '${hash}'`);
    await sleep(900);
    // The site page is about modify view: scroll its checkboxes into the shot.
    await evaluate(options.sessionId, name === 'site'
      ? `(() => { document.getElementById('limit').closest('.grid-auto').scrollIntoView({ block: 'start' }); scrollBy(0, -24); })()`
      : 'window.scrollTo(0, 0)');
    shots[name] = await capture(options.sessionId);
  }
  // Popup for a site with time left.
  const yt = await open('http://youtube.com/', 1280, 697);
  await sleep(800);
  const ytTab = (await evaluate(options.sessionId, `chrome.tabs.query({}).then((ts) => ts.find((t) => /youtube/.test(t.url)).id)`));
  const popup = await open(page(`popup.html?tab=${ytTab}`), 360, 600);
  await sleep(600);
  shots.popup = await capture(popup.sessionId);
  void yt;

  await renderPage('screenshot-1-block-page', framed('block page', 'Your own message. A password and 30 s to get past it.', shots.blocked), 1280, 800);
  await renderPage('screenshot-2-popup', popupFrame(shots.popup), 1280, 800);
  await renderPage('screenshot-3-stats', framed('stats', 'See where the time goes. It never leaves your device.', shots.stats), 1280, 800);
  await renderPage('screenshot-4-auto-mode', framed('auto mode', 'Categories: a focus window, a daily limit, or always.', shots.auto), 1280, 800);
  await renderPage('screenshot-5-modify-view', framed('blocked sites', 'Your rules per site. Feeds hidden on sites you keep.', shots.site), 1280, 800);
  await renderPage('promo-small-440x280', tile(440, 280), 440, 280);
  await renderPage('promo-marquee-1400x560', tile(1400, 560), 1400, 560);
} finally {
  ws.close();
  try { process.kill(-proc.pid); } catch {}
  server.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}
