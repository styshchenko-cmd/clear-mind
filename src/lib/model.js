// Data model: defaults, categories and the labels shown for rules.
//
// storage.local keys:
//   settings  { password: {salt, hash, iterations} | null, passwordSetAt, statsSince, installedAt }
//   sites     { [domain]: Site }
//   auto      { categories: {[id]: CategoryConfig} }
//   days      { [dayKey]: Day }
//
// Site = { domain, mode: 'block' | 'limit' | 'watch', limitMin, cooldownSec,
//          show: 'message' | 'redirect', message, redirectUrl, cooldownMessage,
//          modify: {[optionKey]: bool}, addedAt }
// CategoryConfig = { mode: 'off' | 'window' | 'limit' | 'full', windowLength, limitMin,
//                    window: {start, end} | null, since }
// Day  = { sites: {[domain]: {ms, blocks, unlocks, limitMin?}},
//          categories: {[id]: {ms, blocks, unlocks, limitMin?}}, forced: {[domain]: true} }

import { HOUR, MINUTE, nextMidnight, todayAt } from './time.js';

export const VERSION = '1.1';

export const DEFAULT_MESSAGE = 'Go do the thing you opened the browser for.';
export const DEFAULT_COOLDOWN_MESSAGE = 'Thirty seconds. What were you about to do before this?';
export const DEFAULT_COOLDOWN_SEC = 30;
export const MIN_COOLDOWN_SEC = 5;
export const MAX_COOLDOWN_SEC = 300;

export function newSite(domain, now = Date.now()) {
  return {
    domain,
    mode: 'limit',
    limitMin: 30,
    cooldownSec: DEFAULT_COOLDOWN_SEC,
    show: 'message',
    message: DEFAULT_MESSAGE,
    redirectUrl: '',
    cooldownMessage: DEFAULT_COOLDOWN_MESSAGE,
    modify: {},
    addedAt: now,
  };
}

export const CATEGORIES = [
  { id: 'adult', label: 'Adult content', hint: 'explicit & NSFW sites' },
  { id: 'social', label: 'Social feeds', hint: 'reddit, x, instagram, tiktok…' },
  { id: 'news', label: 'News', hint: 'headlines & comment sections' },
  { id: 'video', label: 'Video & streaming', hint: 'youtube, twitch, netflix…' },
  { id: 'shopping', label: 'Shopping', hint: 'marketplaces & deal sites' },
  { id: 'gambling', label: 'Gambling', hint: 'betting & casino' },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);

export const WINDOW_LENGTHS = [
  { id: '25m', label: '25 min', end: (now) => now + 25 * MINUTE },
  { id: '2h', label: '2 hours', end: (now) => now + 2 * HOUR },
  { id: 'until18', label: 'until 18:00', end: (now) => todayAt(18, 0, now) },
  { id: 'today', label: 'rest of today', end: (now) => nextMidnight(now) },
];

// Each category has its own strength:
//   off     not blocked
//   window  blocked during a focus window the user starts
//   limit   the category's sites share N minutes per day
//   full    always blocked
export const CATEGORY_MODES = ['off', 'window', 'limit', 'full'];

export function defaultCategory() {
  return { mode: 'off', windowLength: '2h', limitMin: 30, window: null, since: null };
}

export function defaultAuto() {
  return { categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, defaultCategory()])) };
}

// Fills gaps and upgrades the 1.0 shape ({categories: {id: bool}, how, window}).
export function normalizeAuto(raw) {
  const auto = defaultAuto();
  for (const { id } of CATEGORIES) {
    const value = raw?.categories?.[id];
    if (value && typeof value === 'object') {
      auto.categories[id] = { ...auto.categories[id], ...value };
    } else if (value === true) {
      const full = id === 'adult' || id === 'gambling' || raw.how === 'full';
      auto.categories[id] = {
        ...auto.categories[id],
        mode: full ? 'full' : 'window',
        windowLength: raw.windowLength ?? '2h',
        window: full ? null : raw.window ?? null,
        since: raw.categorySince?.[id] ?? null,
      };
    }
  }
  return auto;
}

export function windowRunning(config, now = Date.now()) {
  return Boolean(config?.window && now >= config.window.start && now < config.window.end);
}

// Whether a category's domains are subject to blocking right now. A limited
// category applies all day; its sites stay open until the shared time runs out.
export function categoryActive(id, auto, now = Date.now()) {
  const config = auto?.categories?.[id];
  if (!config) return false;
  if (config.mode === 'full' || config.mode === 'limit') return true;
  return config.mode === 'window' && windowRunning(config, now);
}

export function activeCategories(auto, now = Date.now()) {
  return CATEGORIES.filter((c) => categoryActive(c.id, auto, now)).map((c) => c.id);
}

// "always on", "30 min / day", "focus window · 2 hours", "off"
export function categoryRuleLabel(config) {
  if (!config || config.mode === 'off') return 'off';
  if (config.mode === 'full') return 'always on';
  if (config.mode === 'limit') return `${config.limitMin} min / day`;
  return `focus window · ${WINDOW_LENGTHS.find((w) => w.id === config.windowLength)?.label ?? ''}`;
}

export function emptyDay() {
  return { sites: {}, categories: {}, forced: {} };
}

// "30 min / day", "blocked completely", "watch only"
export function ruleLabel(site) {
  if (!site) return 'none';
  if (site.mode === 'block') return 'blocked completely';
  if (site.mode === 'watch') return 'watch only';
  return `${site.limitMin} min / day`;
}

// How strict a site rule is, for deciding whether an edit loosens it.
export function loosens(before, after) {
  const rank = { watch: 0, limit: 1, block: 2 };
  if (rank[after.mode] < rank[before.mode]) return true;
  if (before.mode === 'limit' && after.mode === 'limit' && after.limitMin > before.limitMin) return true;
  if (after.cooldownSec < before.cooldownSec) return true;
  return false;
}

// Whether a site rule that takes over a category's domains is weaker than the
// category: anything short of a block with at least the default cooldown
// (time limits and focus windows included, which a site limit would escape).
export function overrideLoosens(site, config) {
  if (!config || config.mode === 'off') return false;
  return site.mode !== 'block' || site.cooldownSec < DEFAULT_COOLDOWN_SEC;
}

// Whether changing one category from `before` to `after` weakens it: leaving
// "always on", lifting or raising a time limit, or ending a running focus
// window early.
export function categoryLoosens(before, after, now = Date.now()) {
  if (before.mode === 'full') return after.mode !== 'full';
  if (before.mode === 'limit') {
    if (after.mode === 'full') return false;
    return after.mode !== 'limit' || after.limitMin > before.limitMin;
  }
  if (before.mode === 'window' && windowRunning(before, now)) {
    if (after.mode === 'full') return false;
    return after.mode !== 'window' || !after.window || after.window.end < before.window.end;
  }
  return false;
}

export function autoLoosens(before, after, now = Date.now()) {
  return CATEGORIES.some((c) => categoryLoosens(before.categories[c.id], after.categories[c.id], now));
}
