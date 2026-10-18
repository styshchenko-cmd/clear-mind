// Data model: defaults, categories and the labels shown for rules.
//
// storage.local keys:
//   settings  { password: {salt, hash, iterations} | null, passwordSetAt, statsSince, installedAt }
//   sites     { [domain]: Site }
//   auto      { categories: {[id]: bool}, categorySince: {[id]: time}, how: 'window' | 'full',
//               windowLength, window: {start, end} | null, fullSince }
//   days      { [dayKey]: Day }
//
// Site = { domain, mode: 'block' | 'limit' | 'watch', limitMin, cooldownSec,
//          show: 'message' | 'redirect', message, redirectUrl, cooldownMessage,
//          modify: {[optionKey]: bool}, addedAt }
// Day  = { sites: {[domain]: {ms, blocks, unlocks, limitMin?}},
//          categories: {[id]: {blocks, unlocks}}, forced: {[domain]: true} }

import { HOUR, MINUTE, nextMidnight, todayAt } from './time.js';

export const VERSION = '1.0';

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

// `forced` categories are always blocked completely while switched on;
// the "how hard" choice applies to the rest.
export const CATEGORIES = [
  { id: 'adult', label: 'Adult content', hint: 'always a block page', forced: true },
  { id: 'social', label: 'Social feeds', hint: 'reddit, x, instagram, tiktok…' },
  { id: 'news', label: 'News', hint: 'headlines & comment sections' },
  { id: 'video', label: 'Video & streaming', hint: 'youtube, twitch, netflix…' },
  { id: 'shopping', label: 'Shopping', hint: 'marketplaces & deal sites' },
  { id: 'gambling', label: 'Gambling', hint: 'betting & casino', forced: true },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);

export const WINDOW_LENGTHS = [
  { id: '25m', label: '25 min', end: (now) => now + 25 * MINUTE },
  { id: '2h', label: '2 hours', end: (now) => now + 2 * HOUR },
  { id: 'until18', label: 'until 18:00', end: (now) => todayAt(18, 0, now) },
  { id: 'today', label: 'rest of today', end: (now) => nextMidnight(now) },
];

export function defaultAuto() {
  return {
    categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, false])),
    categorySince: {},
    how: 'window',
    windowLength: '2h',
    window: null,
    fullSince: null,
  };
}

export function emptyDay() {
  return { sites: {}, categories: {}, forced: {} };
}

// Whether a category's domains are blocked right now.
export function categoryActive(id, auto, now = Date.now()) {
  if (!auto?.categories?.[id]) return false;
  if (categoryById(id)?.forced || auto.how === 'full') return true;
  return Boolean(auto.window && now >= auto.window.start && now < auto.window.end);
}

export function activeCategories(auto, now = Date.now()) {
  return CATEGORIES.filter((c) => categoryActive(c.id, auto, now)).map((c) => c.id);
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

// Category ids that block now under `before` but would not under `after`.
export function autoLoosens(before, after, now = Date.now()) {
  const wasActive = (id) => categoryActive(id, before, now);
  const willBe = (id) => {
    if (!after.categories[id]) return false;
    if (categoryById(id)?.forced || after.how === 'full') return true;
    // A running focus window keeps going when "how hard" is switched.
    return Boolean(before.window && now < before.window.end);
  };
  const enabledFull = (a, id) => a.categories[id] && (categoryById(id)?.forced || a.how === 'full');
  return CATEGORIES.some(
    (c) => (wasActive(c.id) && !willBe(c.id)) || (enabledFull(before, c.id) && !enabledFull(after, c.id)),
  );
}
