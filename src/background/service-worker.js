// Background: decides on every top-level navigation, tracks time on listed
// sites, and owns every change that may need the password.

import { api } from '../lib/api.js';
import { findSiteDomain, hostOf, matchesDomain } from '../lib/domain.js';
import { matchCategory, listSizes } from '../lib/lists.js';
import * as model from '../lib/model.js';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../lib/password.js';
import { decide, redirectTarget, sanitizeSite } from '../lib/rules.js';
import { addBlock, addTime, addUnlock, pruneDays, unlocksSince } from '../lib/stats.js';
import { dayKey, nextMidnight, startOfDay, DAY, MINUTE } from '../lib/time.js';

const TICK_ALARM = 'tick';
const LIMIT_ALARM = 'limit';
const IDLE_SECONDS = 120;
// Longest span credited in one go; anything longer means the machine slept.
const MAX_SPAN = 3 * MINUTE;
const PAGES = api.runtime.getURL('pages/');

// ---------------------------------------------------------------- state

let local = null;
let sess = null;
let idleState = 'active';
const recentBlocks = new Map();

function defaultSettings(now = Date.now()) {
  return { password: null, passwordSetAt: null, statsSince: now, installedAt: now };
}

async function load() {
  if (!local) {
    const s = await api.storage.local.get(['settings', 'sites', 'auto', 'days']);
    local = {
      settings: s.settings ?? defaultSettings(),
      sites: s.sites ?? {},
      auto: { ...model.defaultAuto(), ...s.auto },
      days: s.days ?? {},
    };
  }
  return local;
}

// grants:  { [tabId]: { [domain]: until } }  — unlocks, per tab, until 00:00
// pending: { [token]: { tabId, domain, category, url, startedAt, cooldownSec } }
// active:  { tabId, domain, since } | null    — the listed site in the foreground
async function session() {
  if (!sess) {
    const s = await api.storage.session.get(['grants', 'pending', 'active']);
    sess = { grants: s.grants ?? {}, pending: s.pending ?? {}, active: s.active ?? null };
  }
  return sess;
}

const saveSession = () => api.storage.session.set(sess);
const saveLocal = (...keys) => api.storage.local.set(Object.fromEntries(keys.map((k) => [k, local[k]])));

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && local) {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in local && newValue !== undefined) local[key] = newValue;
    }
  }
});

// Every handler runs one at a time so read-modify-write never interleaves.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch((error) => console.error('[clearmind]', error));
  return run;
}

// ---------------------------------------------------------------- decisions

function isGranted(tabId, domain, now) {
  return (sess.grants[tabId]?.[domain] ?? 0) > now;
}

function usedMs(domain, now) {
  const stored = local.days[dayKey(now)]?.sites[domain]?.ms ?? 0;
  const active = sess.active;
  if (active?.domain !== domain) return stored;
  return stored + Math.min(MAX_SPAN, Math.max(0, now - Math.max(active.since, startOfDay(now))));
}

async function evaluate(tabId, url, now = Date.now()) {
  const host = hostOf(url);
  if (!host) return { action: 'allow', reason: 'not-web', domain: null };
  await load();
  await session();
  const ids = model.activeCategories(local.auto, now);
  const match = ids.length && !findSiteDomain(host, local.sites) ? await matchCategory(host, ids) : null;
  return decide({
    host,
    sites: local.sites,
    day: local.days[dayKey(now)],
    usedMs: (domain) => usedMs(domain, now),
    granted: (domain) => isGranted(tabId, domain, now),
    category: () => match,
  });
}

function blockPageUrl(decision, originalUrl) {
  const params = new URLSearchParams({ d: decision.domain, r: decision.reason, u: originalUrl });
  if (decision.category) params.set('c', decision.category);
  return `${PAGES}blocked.html?${params}`;
}

// Sends the tab to the block page (or the user's redirect) when it must not
// show `url`. Safe to call repeatedly for the same navigation.
async function enforce(tabId, url) {
  if (tabId < 0) return null;
  const now = Date.now();
  const decision = await evaluate(tabId, url, now);
  if (decision.action !== 'block') return decision;

  // One navigation can be reported several times (HTTPS upgrades, commit
  // events): always redirect, but count the block once.
  const last = recentBlocks.get(tabId);
  if (!(last?.url === url && now - last.at < 3000)) {
    addBlock(local.days, decision, now);
    await saveLocal('days');
  }
  recentBlocks.set(tabId, { url, at: now });
  const wouldBlock = (host) => {
    const domain = findSiteDomain(host, local.sites);
    return Boolean(domain && local.sites[domain].mode !== 'watch');
  };
  const target = redirectTarget(decision.site, wouldBlock) ?? blockPageUrl(decision, url);
  await api.tabs.update(tabId, { url: target }).catch(() => {});
  return decision;
}

async function enforceAll() {
  for (const tab of await api.tabs.query({})) {
    if (tab.url && hostOf(tab.url)) await enforce(tab.id, tab.url);
  }
}

// ---------------------------------------------------------------- time tracking

async function foreground() {
  const win = await api.windows.getLastFocused().catch(() => null);
  if (!win?.focused) return null;
  const [tab] = await api.tabs.query({ active: true, windowId: win.id });
  if (!tab?.url) return null;
  const host = hostOf(tab.url);
  const domain = host ? findSiteDomain(host, local.sites) : null;
  const away = idleState === 'locked' || (idleState === 'idle' && !tab.audible);
  return { tab, domain: away ? null : domain };
}

// Credits the running span, works out what is in the foreground now, and
// re-checks that tab (this is how a limit that runs out mid-visit blocks).
async function track(now = Date.now()) {
  await load();
  await session();
  const previous = sess.active;
  if (previous && local.sites[previous.domain]) {
    const site = local.sites[previous.domain];
    const start = Math.max(previous.since, now - MAX_SPAN);
    addTime(local.days, previous.domain, start, now, site.mode === 'limit' ? site.limitMin : undefined);
    await saveLocal('days');
  }
  const fg = await foreground();
  sess.active = fg?.domain ? { tabId: fg.tab.id, domain: fg.domain, since: now } : null;
  await saveSession();
  if (fg?.tab) await enforce(fg.tab.id, fg.tab.url);
  await updateBadgeAndAlarm(now);
}

async function updateBadgeAndAlarm(now) {
  const active = sess.active;
  const site = active && local.sites[active.domain];
  if (site?.mode === 'limit' && !isGranted(active.tabId, active.domain, now)) {
    const left = site.limitMin * MINUTE - usedMs(active.domain, now);
    await api.action.setBadgeBackgroundColor({ color: '#e8b45a' });
    await api.action.setBadgeText({ text: `${Math.max(0, Math.ceil(left / MINUTE))}m` });
    if (left > 0) await api.alarms.create(LIMIT_ALARM, { when: now + left + 500 });
    return;
  }
  await api.action.setBadgeText({ text: '' });
  await api.alarms.clear(LIMIT_ALARM);
}

// ---------------------------------------------------------------- password

function passwordSet() {
  return Boolean(local.settings.password);
}

// True when no password is set yet, or when `password` matches it.
async function passwordOk(password) {
  if (!passwordSet()) return true;
  return verifyPassword(password ?? '', local.settings.password);
}

const needPassword = (password) => ({
  ok: false,
  needPassword: true,
  error: password ? 'wrong password' : 'password required',
});

// ---------------------------------------------------------------- messages

async function tabInfo(tabId) {
  const tab = await api.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return { tab, url: null };
  if (tab.url.startsWith(PAGES)) {
    const params = new URL(tab.url).searchParams;
    return { tab, url: params.get('u'), page: true, domain: params.get('d'), category: params.get('c') };
  }
  return { tab, url: tab.url };
}

const handlers = {
  async getPopupState({ tabId }) {
    await load();
    await session();
    const now = Date.now();
    const info = await tabInfo(tabId);
    const host = hostOf(info.url ?? '');
    if (!host) return { ok: true, host: null };
    const decision = info.page
      ? { action: 'block', domain: info.domain, category: info.category, site: local.sites[info.domain] }
      : await evaluate(tabId, info.url, now);
    const domain = decision.domain ?? findSiteDomain(host, local.sites);
    const site = domain ? local.sites[domain] : null;
    return {
      ok: true,
      host,
      domain: domain ?? host,
      site,
      category: decision.category ? model.categoryById(decision.category)?.label : null,
      status: decision.action === 'block' ? 'blocked' : 'allowed',
      unlocked: decision.reason === 'unlocked',
      usedMs: site ? usedMs(site.domain, now) : 0,
      passwordSet: passwordSet(),
    };
  },

  // Popup: "[ unblock for today ]" — show the password step in this tab.
  async openUnlock({ tabId }) {
    const info = await tabInfo(tabId);
    if (info.page || !info.url) return { ok: true };
    const decision = await evaluate(tabId, info.url);
    if (decision.action === 'block') await api.tabs.update(tabId, { url: blockPageUrl(decision, info.url) });
    return { ok: true };
  },

  // Popup: "[ block this site ]".
  async blockSite({ tabId }) {
    await load();
    await session();
    const info = await tabInfo(tabId);
    const host = hostOf(info.url ?? '');
    if (!host) return { ok: false, error: 'not a web page' };
    const now = Date.now();
    const domain = findSiteDomain(host, local.sites) ?? (await matchCategory(host, model.activeCategories(local.auto, now)))?.domain;
    if (domain && local.sites[domain]) {
      const day = (local.days[dayKey(now)] ??= model.emptyDay());
      day.forced[domain] = true;
      await saveLocal('days');
    } else if (!domain) {
      local.sites[host] = { ...model.newSite(host, now), mode: 'block' };
      await saveLocal('sites');
    }
    for (const grants of Object.values(sess.grants)) {
      for (const d of Object.keys(grants)) if (d === domain || d === host) delete grants[d];
    }
    await saveSession();
    await enforce(tabId, info.url);
    await track();
    return { ok: true };
  },

  async getBlockInfo({ domain, category }) {
    await load();
    const now = Date.now();
    const site = category ? null : local.sites[domain];
    return {
      ok: true,
      site,
      categoryLabel: category ? model.categoryById(category)?.label : null,
      windowEnd: category && local.auto.window && now < local.auto.window.end && !model.categoryById(category)?.forced && local.auto.how !== 'full' ? local.auto.window.end : null,
      usedMs: site ? usedMs(domain, now) : 0,
      unlocksThisWeek: unlocksSince(local.days, startOfDay(now) - 6 * DAY),
      passwordSet: passwordSet(),
      cooldownSec: site?.cooldownSec ?? model.DEFAULT_COOLDOWN_SEC,
    };
  },

  async startUnlock({ domain, category, url, password }, sender) {
    await load();
    await session();
    if (!(await passwordOk(password))) return { ok: false, error: 'wrong password' };
    const token = crypto.randomUUID();
    sess.pending[token] = {
      tabId: sender.tab.id,
      domain,
      category: category || null,
      url,
      startedAt: Date.now(),
      cooldownSec: local.sites[domain]?.cooldownSec ?? model.DEFAULT_COOLDOWN_SEC,
    };
    await saveSession();
    return { ok: true, token };
  },

  async getUnlock({ token }) {
    await load();
    await session();
    const pending = sess.pending[token];
    if (!pending) return { ok: false, error: 'unlock expired' };
    const site = local.sites[pending.domain];
    return {
      ok: true,
      ...pending,
      message: site ? site.cooldownMessage : model.DEFAULT_COOLDOWN_MESSAGE,
      elapsedMs: Date.now() - pending.startedAt,
    };
  },

  async finishUnlock({ token }, sender) {
    await load();
    await session();
    const pending = sess.pending[token];
    if (!pending || pending.tabId !== sender.tab.id) return { ok: false, error: 'unlock expired' };
    const now = Date.now();
    if (now - pending.startedAt < pending.cooldownSec * 1000 - 250) return { ok: false, error: 'cooldown not over' };
    delete sess.pending[token];
    (sess.grants[pending.tabId] ??= {})[pending.domain] = nextMidnight(now);
    await saveSession();
    addUnlock(local.days, pending, now);
    await saveLocal('days');
    return { ok: true, url: pending.url };
  },

  async cancelUnlock({ token }) {
    await session();
    delete sess.pending[token];
    await saveSession();
    return { ok: true };
  },

  // Unlocking page: "[ keep it blocked ]" after the cooldown.
  async revokeUnlock({ domain }, sender) {
    await session();
    delete sess.grants[sender.tab.id]?.[domain];
    await saveSession();
    return { ok: true };
  },

  async saveSite({ site: input, password }) {
    await load();
    const { site, error } = sanitizeSite(input, {
      minCooldown: model.MIN_COOLDOWN_SEC,
      maxCooldown: model.MAX_COOLDOWN_SEC,
    });
    if (error) return { ok: false, error };
    const existing = local.sites[site.domain];
    if (existing && model.loosens(existing, site) && !(await passwordOk(password))) return needPassword(password);
    if (existing) site.addedAt = existing.addedAt;
    local.sites[site.domain] = site;
    await saveLocal('sites');
    await enforceAll();
    await track();
    return { ok: true, domain: site.domain };
  },

  async removeSite({ domain, password }) {
    await load();
    if (!local.sites[domain]) return { ok: true };
    if (!(await passwordOk(password))) return needPassword(password);
    delete local.sites[domain];
    await saveLocal('sites');
    await track();
    return { ok: true };
  },

  async saveAuto({ categories, how, windowLength, password, startWindow }) {
    await load();
    const now = Date.now();
    const before = local.auto;
    const next = {
      ...before,
      categories: Object.fromEntries(model.CATEGORIES.map((c) => [c.id, Boolean(categories?.[c.id])])),
      how: how === 'full' ? 'full' : 'window',
      windowLength: model.WINDOW_LENGTHS.some((w) => w.id === windowLength) ? windowLength : before.windowLength,
      categorySince: { ...before.categorySince },
    };
    for (const c of model.CATEGORIES) {
      if (next.categories[c.id] && !before.categories[c.id]) next.categorySince[c.id] = now;
    }
    if (next.how === 'full' && before.how !== 'full') next.fullSince = now;
    if (next.how !== 'full') next.fullSince = null;
    if (startWindow) {
      const end = model.WINDOW_LENGTHS.find((w) => w.id === next.windowLength).end(now);
      if (end <= now) return { ok: false, error: 'that time has already passed today' };
      const running = before.window && now < before.window.end ? before.window : null;
      next.window = { start: running?.start ?? now, end: Math.max(end, running?.end ?? 0) };
    }
    if (model.autoLoosens(before, next, now) && !(await passwordOk(password))) return needPassword(password);
    local.auto = next;
    await saveLocal('auto');
    await enforceAll();
    return { ok: true };
  },

  async setPassword({ current, next }) {
    await load();
    if (!(await passwordOk(current))) return { ok: false, error: 'current password is wrong' };
    if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: `use at least ${MIN_PASSWORD_LENGTH} characters` };
    }
    local.settings = { ...local.settings, password: await hashPassword(next), passwordSetAt: Date.now() };
    await saveLocal('settings');
    return { ok: true };
  },

  async resetStats({ password }) {
    await load();
    await session();
    if (!(await passwordOk(password))) return needPassword(password);
    const now = Date.now();
    local.days = {};
    local.settings = { ...local.settings, statsSince: now };
    await saveLocal('days', 'settings');
    if (sess.active) sess.active.since = now;
    await saveSession();
    return { ok: true };
  },

  async getListSizes() {
    return { ok: true, sizes: await listSizes(model.CATEGORIES.map((c) => c.id)) };
  },

  // Flushes the running span so pages read up-to-date numbers.
  async flush() {
    await track();
    return { ok: true };
  },
};

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  // Only our own extension pages may change rules.
  if (!handler || sender.id !== api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(''))) return false;
  serial(() => handler(message, sender)).then(sendResponse, (error) =>
    sendResponse({ ok: false, error: String(error?.message ?? error) }),
  );
  return true;
});

// ---------------------------------------------------------------- browser events

api.runtime.onInstalled.addListener(({ reason }) =>
  serial(async () => {
    await load();
    const stored = await api.storage.local.get(['settings', 'auto', 'sites', 'days']);
    if (!stored.settings) await saveLocal('settings');
    if (!stored.auto) await saveLocal('auto');
    if (!stored.sites) await saveLocal('sites');
    if (!stored.days) await saveLocal('days');
    if (reason === 'install') await api.tabs.create({ url: api.runtime.getURL('pages/options.html#settings') });
  }),
);

async function ensureTicking() {
  if (!(await api.alarms.get(TICK_ALARM))) await api.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
}

api.runtime.onStartup.addListener(() =>
  serial(async () => {
    await load();
    pruneDays(local.days);
    await saveLocal('days');
  }),
);

api.alarms.onAlarm.addListener(() => serial(() => track()));

api.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0) serial(() => enforce(tabId, url));
});

api.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0) serial(() => enforce(tabId, url).then(() => track()));
});

api.webNavigation.onHistoryStateUpdated.addListener(({ frameId }) => {
  if (frameId === 0) serial(() => track());
});

api.tabs.onActivated.addListener(() => serial(() => track()));
api.windows.onFocusChanged.addListener(() => serial(() => track()));
api.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.audible !== undefined) serial(() => track());
});

// A link opened from an unlocked tab into the same site stays unlocked; any
// other new tab (Ctrl+T also sets an opener) starts blocked.
api.tabs.onCreated.addListener((tab) =>
  serial(async () => {
    await session();
    const opener = tab.openerTabId !== undefined && sess.grants[tab.openerTabId];
    const host = hostOf(tab.pendingUrl || tab.url || '');
    if (!opener || !host) return;
    const inherited = Object.entries(opener).filter(([domain]) => matchesDomain(host, domain));
    if (inherited.length) {
      sess.grants[tab.id] = Object.fromEntries(inherited);
      await saveSession();
    }
  }),
);

// Closing the tab ends its unlocks and cancels a running cooldown.
api.tabs.onRemoved.addListener((tabId) =>
  serial(async () => {
    await session();
    delete sess.grants[tabId];
    for (const [token, pending] of Object.entries(sess.pending)) if (pending.tabId === tabId) delete sess.pending[token];
    recentBlocks.delete(tabId);
    await saveSession();
    await track();
  }),
);

api.tabs.onReplaced?.addListener((addedTabId, removedTabId) =>
  serial(async () => {
    await session();
    if (sess.grants[removedTabId]) {
      sess.grants[addedTabId] = sess.grants[removedTabId];
      delete sess.grants[removedTabId];
      await saveSession();
    }
  }),
);

api.idle.setDetectionInterval(IDLE_SECONDS);
api.idle.onStateChanged.addListener((state) => {
  idleState = state;
  serial(() => track());
});
api.idle.queryState(IDLE_SECONDS).then((state) => (idleState = state));

ensureTicking();
