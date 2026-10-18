// Statistics: recording into Day records and summarising them for the dashboard.

import { emptyDay, CATEGORIES } from './model.js';
import { dayKey, lastDays, nextMidnight, parseDayKey, startOfDay, MINUTE } from './time.js';

export const KEEP_DAYS = 400;

function siteEntry(day, domain) {
  day.sites[domain] ??= { ms: 0, blocks: 0, unlocks: 0 };
  return day.sites[domain];
}

function categoryEntry(day, id) {
  day.categories[id] ??= { ms: 0, blocks: 0, unlocks: 0 };
  day.categories[id].ms ??= 0;
  return day.categories[id];
}

function dayOf(days, key) {
  days[key] ??= emptyDay();
  return days[key];
}

// Adds the time between `start` and `end` to a site ({domain}) or a
// time-limited category ({category}), split at midnights.
export function addTime(days, { domain, category }, start, end, limitMin) {
  let from = start;
  while (from < end) {
    const to = Math.min(end, nextMidnight(from));
    const day = dayOf(days, dayKey(from));
    const entry = category ? categoryEntry(day, category) : siteEntry(day, domain);
    entry.ms += to - from;
    if (limitMin) entry.limitMin = limitMin;
    from = to;
  }
}

export function addBlock(days, { domain, category }, now = Date.now()) {
  const day = dayOf(days, dayKey(now));
  if (category) categoryEntry(day, category).blocks += 1;
  else siteEntry(day, domain).blocks += 1;
}

export function addUnlock(days, { domain, category }, now = Date.now()) {
  const day = dayOf(days, dayKey(now));
  if (category) categoryEntry(day, category).unlocks += 1;
  else siteEntry(day, domain).unlocks += 1;
}

export function pruneDays(days, now = Date.now()) {
  const oldest = dayKey(startOfDay(now) - KEEP_DAYS * 24 * 60 * MINUTE);
  for (const key of Object.keys(days)) if (key < oldest) delete days[key];
}

function dayTotals(day) {
  let ms = 0;
  let blocks = 0;
  let unlocks = 0;
  let over = false;
  for (const entry of Object.values(day?.sites ?? {})) {
    ms += entry.ms;
    blocks += entry.blocks;
    unlocks += entry.unlocks;
    if (entry.limitMin && entry.ms > entry.limitMin * MINUTE) over = true;
  }
  for (const entry of Object.values(day?.categories ?? {})) {
    blocks += entry.blocks;
    unlocks += entry.unlocks;
    if (entry.limitMin && entry.ms > entry.limitMin * MINUTE) over = true;
  }
  return { ms, blocks, unlocks, over };
}

export function unlocksSince(days, since) {
  const from = dayKey(since);
  let n = 0;
  for (const [key, day] of Object.entries(days)) if (key >= from) n += dayTotals(day).unlocks;
  return n;
}

// Consecutive days, ending today, on which no time-limited site went over.
export function underLimitStreak(days, statsSince, now = Date.now()) {
  const first = dayKey(statsSince);
  let streak = 0;
  let cursor = startOfDay(now) + 12 * 60 * MINUTE;
  for (;;) {
    const key = dayKey(cursor);
    if (key < first || dayTotals(days[key]).over) return streak;
    streak += 1;
    cursor -= 24 * 60 * MINUTE;
  }
}

const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30 };

// Everything the stats page shows for a range ('today' | '7d' | '30d').
// `days` must already include the live (unflushed) time.
export function summarize({ range, days, sites, auto, settings, now = Date.now() }) {
  const n = RANGE_DAYS[range] ?? 1;
  const keys = lastDays(n, now);
  const allowedPerDay = Object.values(sites)
    .filter((s) => s.mode === 'limit')
    .reduce((sum, s) => sum + s.limitMin * MINUTE, 0);

  let ms = 0;
  let blocks = 0;
  let unlocks = 0;
  const perSite = {};
  const perCategory = {};
  for (const key of keys) {
    const day = days[key];
    const totals = dayTotals(day);
    ms += totals.ms;
    blocks += totals.blocks;
    unlocks += totals.unlocks;
    for (const [domain, entry] of Object.entries(day?.sites ?? {})) {
      perSite[domain] ??= { ms: 0, blocks: 0 };
      perSite[domain].ms += entry.ms;
      perSite[domain].blocks += entry.blocks;
    }
    for (const [id, entry] of Object.entries(day?.categories ?? {})) {
      perCategory[id] ??= { ms: 0, blocks: 0 };
      perCategory[id].ms += entry.ms ?? 0;
      perCategory[id].blocks += entry.blocks;
    }
  }

  const siteRows = Object.values(sites)
    .map((site) => ({
      domain: site.domain,
      mode: site.mode,
      ms: perSite[site.domain]?.ms ?? 0,
      limitMs: site.mode === 'limit' ? site.limitMin * MINUTE * n : null,
      blocks: perSite[site.domain]?.blocks ?? 0,
    }))
    .sort((a, b) => b.ms - a.ms || a.domain.localeCompare(b.domain));

  const categoryRows = CATEGORIES.filter((c) => (auto.categories[c.id]?.mode ?? 'off') !== 'off').map((c) => {
    const config = auto.categories[c.id];
    return {
      id: c.id,
      label: c.label,
      config,
      ms: perCategory[c.id]?.ms ?? 0,
      limitMs: config.mode === 'limit' ? config.limitMin * MINUTE * n : null,
      blocks: perCategory[c.id]?.blocks ?? 0,
    };
  });

  const chartKeys = lastDays(n === 30 ? 30 : 7, now);
  const chart = chartKeys.map((key) => {
    const totals = dayTotals(days[key]);
    return { key, time: parseDayKey(key), ms: totals.ms, over: totals.over, today: key === dayKey(now) };
  });

  return {
    ms,
    allowedMs: allowedPerDay * n,
    blocks,
    unlocks,
    streak: underLimitStreak(days, settings?.statsSince ?? now, now),
    siteRows,
    categoryRows,
    chart,
    dailyLimitMs: allowedPerDay,
  };
}
