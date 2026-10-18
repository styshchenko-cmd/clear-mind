import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findSiteDomain, hostOf, normalizeDomain } from '../src/lib/domain.js';
import { listOverlap, parseList } from '../src/lib/lists.js';
import { autoLoosens, categoryActive, defaultAuto, loosens, newSite, normalizeAuto, overrideLoosens } from '../src/lib/model.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { decide, redirectTarget, sanitizeSite } from '../src/lib/rules.js';
import { addTime, summarize, underLimitStreak } from '../src/lib/stats.js';
import { dayKey, formatClock, formatDuration, lastDays, MINUTE, HOUR } from '../src/lib/time.js';

test('normalizeDomain accepts URLs and bare hosts', () => {
  assert.equal(normalizeDomain('https://www.Reddit.com/r/x?y=1'), 'reddit.com');
  assert.equal(normalizeDomain('https://www.reddit.com/'), 'reddit.com');
  assert.equal(normalizeDomain('www.reddit.com/'), 'reddit.com');
  assert.equal(normalizeDomain('https://old.reddit.com/'), 'old.reddit.com');
  assert.equal(normalizeDomain('news.ycombinator.com'), 'news.ycombinator.com');
  assert.equal(normalizeDomain('  example.org:8080  '), 'example.org');
  assert.equal(normalizeDomain('localhost'), 'localhost');
  for (const bad of ['', 'not a domain', 'foo', '-bad-.com', null]) assert.equal(normalizeDomain(bad), null);
});

test('any way of typing a site gives the same rule, for every site', () => {
  for (const domain of ['youtube.com', 'news.ycombinator.com', 'bbc.co.uk', 'x.com', 'пример.укр']) {
    const expected = normalizeDomain(domain);
    const forms = [
      `www.${domain}`, `www.${domain}/`, `http://${domain}`, `https://www.${domain}/`,
      `HTTPS://WWW.${domain.toUpperCase()}/path?q=1#x`, `  ${domain}  `, `${domain}:443`,
      `https://${domain}:8080/x`, `${domain}.`, `*.${domain}`, `.${domain}`, `https://user@${domain}/`,
    ];
    for (const form of forms) assert.equal(normalizeDomain(form), expected, form);
    const sites = { [expected]: {} };
    for (const url of [`https://www.${domain}/`, `http://${domain}/a`, `https://m.${domain}/`]) {
      assert.equal(findSiteDomain(hostOf(url), sites), expected, url);
    }
    assert.equal(findSiteDomain(hostOf(`https://not${domain}/`), sites), null);
  }
});

test('hostOf ignores non-web URLs', () => {
  assert.equal(hostOf('https://old.reddit.com/r/all'), 'old.reddit.com');
  assert.equal(hostOf('chrome://extensions'), null);
  assert.equal(hostOf('chrome-extension://abc/pages/blocked.html'), null);
  assert.equal(hostOf('garbage'), null);
});

test('a reddit.com rule covers www, bare and other subdomains', () => {
  const sites = { 'reddit.com': {} };
  for (const url of ['https://www.reddit.com/', 'http://reddit.com/r/all', 'https://old.reddit.com/']) {
    assert.equal(findSiteDomain(hostOf(url), sites), 'reddit.com', url);
  }
});

test('listOverlap finds covering entries and entries inside a site', () => {
  const list = new Set(['reddit.com', 'news.google.com', 'sport.google.com']);
  assert.deepEqual(listOverlap('old.reddit.com', list), { covering: 'reddit.com', under: 0, examples: [] });
  assert.deepEqual(listOverlap('google.com', list), { covering: null, under: 2, examples: ['news.google.com', 'sport.google.com'] });
  assert.equal(listOverlap('example.org', list), null);
});

test('overrideLoosens: anything short of a full-cooldown block escapes a category', () => {
  const site = (mode, cooldownSec = 30) => ({ ...newSite('x.com'), mode, cooldownSec });
  assert.equal(overrideLoosens(site('block'), { mode: 'full' }), false);
  assert.equal(overrideLoosens(site('block', 5), { mode: 'full' }), true, 'shorter cooldown');
  assert.equal(overrideLoosens(site('limit'), { mode: 'full' }), true);
  assert.equal(overrideLoosens(site('limit'), { mode: 'window' }), true, 'a site limit escapes a running window');
  assert.equal(overrideLoosens(site('limit'), { mode: 'limit' }), true, 'its own budget escapes the shared one');
  assert.equal(overrideLoosens(site('watch'), { mode: 'window' }), true);
  assert.equal(overrideLoosens(site('watch'), { mode: 'off' }), false);
});

test('findSiteDomain picks the most specific rule and respects label boundaries', () => {
  const sites = { 'reddit.com': {}, 'old.reddit.com': {}, 'x.com': {} };
  assert.equal(findSiteDomain('old.reddit.com', sites), 'old.reddit.com');
  assert.equal(findSiteDomain('new.reddit.com', sites), 'reddit.com');
  assert.equal(findSiteDomain('notreddit.com', sites), null);
  assert.equal(findSiteDomain('box.com', sites), null);
});

const base = (overrides = {}) => ({
  host: 'reddit.com',
  sites: { 'reddit.com': { ...newSite('reddit.com'), ...overrides } },
  day: { sites: {}, categories: {}, forced: {} },
  usedMs: () => 0,
  granted: () => false,
  category: () => null,
});

test('decide: time limit allows until used up, then blocks', () => {
  assert.equal(decide(base()).action, 'allow');
  const over = decide({ ...base(), usedMs: () => 30 * MINUTE });
  assert.deepEqual([over.action, over.reason], ['block', 'limit']);
});

test('decide: block mode, watch mode, unlocks and manual blocks', () => {
  assert.equal(decide(base({ mode: 'block' })).reason, 'block');
  assert.equal(decide({ ...base({ mode: 'watch' }), usedMs: () => 10 * HOUR }).action, 'allow');
  assert.equal(decide({ ...base({ mode: 'block' }), granted: () => true }).reason, 'unlocked');
  const forced = base();
  forced.day.forced['reddit.com'] = true;
  assert.equal(decide(forced).reason, 'manual');
});

test('decide: categories apply only to sites without their own rule', () => {
  const ctx = { ...base({ mode: 'watch' }), host: 'pornsite.example', category: () => ({ category: 'adult', domain: 'pornsite.example' }) };
  assert.deepEqual([decide(ctx).action, decide(ctx).category], ['block', 'adult']);
  assert.equal(decide({ ...ctx, granted: (d) => d === 'pornsite.example' }).action, 'allow');
  assert.equal(decide({ ...ctx, host: 'reddit.com' }).action, 'allow');
});

test('decide: "block this site" (forced) also blocks a watch-only site', () => {
  const ctx = base({ mode: 'watch' });
  ctx.day.forced['reddit.com'] = true;
  assert.equal(decide(ctx).reason, 'manual');
  assert.equal(decide({ ...ctx, granted: () => true }).action, 'allow');
});

test('sanitizeSite rejects redirects that are not real web addresses', () => {
  const limits = { minCooldown: 5, maxCooldown: 300 };
  for (const bad of ['ftp://x.com/a', 'reddit', 'javascript:alert(1)']) {
    assert.ok(sanitizeSite({ ...newSite('x.com'), show: 'redirect', redirectUrl: bad }, limits).error, bad);
  }
});

test('redirectTarget refuses redirects into another blocked site', () => {
  const site = { show: 'redirect', redirectUrl: 'https://getpocket.com/saves' };
  assert.equal(redirectTarget(site, () => false), 'https://getpocket.com/saves');
  assert.equal(redirectTarget(site, () => true), null);
  assert.equal(redirectTarget({ show: 'message' }, () => false), null);
});

test('sanitizeSite validates numbers and redirect URLs', () => {
  const limits = { minCooldown: 5, maxCooldown: 300 };
  const ok = sanitizeSite({ ...newSite('x.com'), domain: 'https://x.com/home', limitMin: '20' }, limits);
  assert.equal(ok.site.domain, 'x.com');
  assert.equal(ok.site.limitMin, 20);
  assert.match(sanitizeSite({ ...newSite('x.com'), limitMin: 0 }, limits).error, /limit/);
  assert.match(sanitizeSite({ ...newSite('x.com'), cooldownSec: 1 }, limits).error, /Cooldown/);
  const redirect = sanitizeSite({ ...newSite('x.com'), show: 'redirect', redirectUrl: 'example.org/read' }, limits);
  assert.equal(redirect.site.redirectUrl, 'https://example.org/read');
});

test('loosens detects weaker site rules', () => {
  const limit = newSite('x.com');
  assert.equal(loosens(limit, { ...limit, mode: 'watch' }), true);
  assert.equal(loosens(limit, { ...limit, limitMin: 45 }), true);
  assert.equal(loosens(limit, { ...limit, cooldownSec: 10 }), true);
  assert.equal(loosens(limit, { ...limit, mode: 'block' }), false);
  assert.equal(loosens(limit, { ...limit, limitMin: 10, message: 'hi' }), false);
});

const autoWith = (overrides) => {
  const auto = defaultAuto();
  for (const [id, config] of Object.entries(overrides)) Object.assign(auto.categories[id], config);
  return auto;
};

test('auto mode: each category has its own strength', () => {
  const now = Date.now();
  const window = { start: now - MINUTE, end: now + HOUR };
  const auto = autoWith({ adult: { mode: 'full' }, social: { mode: 'window', window }, news: { mode: 'limit' }, video: { mode: 'window' } });
  assert.equal(categoryActive('adult', auto, now), true);
  assert.equal(categoryActive('social', auto, now), true);
  assert.equal(categoryActive('news', auto, now), true);
  assert.equal(categoryActive('video', auto, now), false, 'window not started');
  assert.equal(categoryActive('social', auto, now + 2 * HOUR), false, 'window over');
  assert.equal(categoryActive('shopping', auto, now), false);
});

test('auto mode: loosening is judged per category', () => {
  const now = Date.now();
  const running = { start: now - MINUTE, end: now + HOUR };
  const before = autoWith({ adult: { mode: 'full' }, social: { mode: 'window', window: running }, news: { mode: 'limit', limitMin: 30 } });
  const change = (id, config) => autoWith({ ...structuredClone(before.categories), [id]: { ...before.categories[id], ...config } });
  assert.equal(autoLoosens(before, change('adult', { mode: 'limit' }), now), true);
  assert.equal(autoLoosens(before, change('social', { mode: 'off', window: null }), now), true);
  assert.equal(autoLoosens(before, change('social', { mode: 'full' }), now), false);
  assert.equal(autoLoosens(before, change('news', { limitMin: 45 }), now), true);
  assert.equal(autoLoosens(before, change('news', { limitMin: 15 }), now), false);
  assert.equal(autoLoosens(before, change('video', { mode: 'full' }), now), false);
});

test('normalizeAuto upgrades the 1.0 shape', () => {
  const window = { start: 1, end: 2 };
  const auto = normalizeAuto({ categories: { adult: true, social: true, news: false }, how: 'window', windowLength: '25m', window });
  assert.equal(auto.categories.adult.mode, 'full');
  assert.deepEqual([auto.categories.social.mode, auto.categories.social.windowLength, auto.categories.social.window], ['window', '25m', window]);
  assert.equal(auto.categories.news.mode, 'off');
  assert.equal(auto.categories.video.mode, 'off');
});

test('decide: time-limited categories open until the shared time is used', () => {
  const ctx = { ...base(), host: 'bbc.com', category: () => ({ category: 'news', domain: 'bbc.com', limitMin: 20 }), categoryMs: () => 5 * MINUTE };
  assert.equal(decide(ctx).action, 'allow');
  assert.equal(decide({ ...ctx, categoryMs: () => 20 * MINUTE }).reason, 'category-limit');
  ctx.day.forced['bbc.com'] = true;
  assert.equal(decide(ctx).reason, 'manual');
});

test('addTime splits spans across midnight', () => {
  const days = {};
  const midnight = new Date(2026, 9, 18).getTime();
  addTime(days, { domain: 'reddit.com' }, midnight - 10 * MINUTE, midnight + 5 * MINUTE, 30);
  assert.equal(days['2026-10-17'].sites['reddit.com'].ms, 10 * MINUTE);
  assert.equal(days['2026-10-18'].sites['reddit.com'].ms, 5 * MINUTE);
  assert.equal(days['2026-10-18'].sites['reddit.com'].limitMin, 30);
});

test('underLimitStreak counts back to the first over-limit day', () => {
  const now = new Date(2026, 9, 18, 15).getTime();
  const day = (ms) => ({ sites: { 'x.com': { ms, blocks: 0, unlocks: 0, limitMin: 20 } }, categories: {}, forced: {} });
  const days = { '2026-10-14': day(25 * MINUTE), '2026-10-15': day(5 * MINUTE), '2026-10-17': day(20 * MINUTE), '2026-10-18': day(0) };
  assert.equal(underLimitStreak(days, new Date(2026, 9, 1).getTime(), now), 4);
  assert.equal(underLimitStreak(days, new Date(2026, 9, 17).getTime(), now), 2);
  // The limit alarm fires a little late: a few seconds over is not "over".
  days['2026-10-18'] = day(20 * MINUTE + 30_000);
  assert.equal(underLimitStreak(days, new Date(2026, 9, 1).getTime(), now), 4);
});

test('summarize builds tiles, rows and a 7-day chart', () => {
  const now = new Date(2026, 9, 18, 15).getTime();
  const sites = { 'reddit.com': newSite('reddit.com'), 'instagram.com': { ...newSite('instagram.com'), mode: 'block' } };
  const days = { '2026-10-18': { sites: { 'reddit.com': { ms: 24 * MINUTE, blocks: 1, unlocks: 1 }, 'instagram.com': { ms: 0, blocks: 3, unlocks: 0 } }, categories: {}, forced: {} } };
  const s = summarize({ range: 'today', days, sites, auto: defaultAuto(), settings: { statsSince: now - 3 * 24 * HOUR }, now });
  assert.equal(s.ms, 24 * MINUTE);
  assert.equal(s.allowedMs, 30 * MINUTE);
  assert.equal(s.blocks, 4);
  assert.equal(s.unlocks, 1);
  assert.equal(s.siteRows[0].domain, 'reddit.com');
  assert.equal(s.chart.length, 7);
  assert.equal(s.chart.at(-1).today, true);
});

test('time formatting', () => {
  assert.equal(formatClock(24 * MINUTE + 10_000), '00:24:10');
  assert.equal(formatDuration(72 * MINUTE), '1h 12m');
  assert.equal(formatDuration(45 * MINUTE), '45m');
  assert.equal(dayKey(new Date(2026, 0, 5).getTime()), '2026-01-05');
  assert.deepEqual(lastDays(3, new Date(2026, 2, 1).getTime()), ['2026-02-27', '2026-02-28', '2026-03-01']);
});

test('password hash round-trips and rejects wrong passwords', async () => {
  const record = await hashPassword('correct horse', 1000);
  assert.equal(await verifyPassword('correct horse', record), true);
  assert.equal(await verifyPassword('wrong horse', record), false);
  assert.equal(await verifyPassword('', null), false);
});

test('parseList skips comments and www prefixes', () => {
  assert.deepEqual([...parseList('# header\nwww.Example.com\n\nfoo.org\n')], ['example.com', 'foo.org']);
});
