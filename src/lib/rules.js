// The blocking decision, kept free of browser APIs so it can be unit-tested.

import { findSiteDomain, normalizeDomain, hostOf } from './domain.js';
import { MINUTE } from './time.js';

// Decides what happens when a tab shows `host`.
//
//   sites       configured sites
//   day         today's Day record (usage, forced blocks)
//   usedMs      (domain) => time used today including the running span
//   granted     (domain) => true when this tab holds an unlock for domain
//   category    (host) => {category, domain} | null, for active categories only
//
// Returns { action: 'allow' | 'block', domain, reason, site?, category? } where
// reason is 'block' | 'limit' | 'manual' | 'category' for blocks.
export function decide({ host, sites, day, usedMs, granted, category }) {
  if (!host) return { action: 'allow', domain: null, reason: 'not-web' };

  const domain = findSiteDomain(host, sites);
  if (domain) {
    const site = sites[domain];
    if (site.mode === 'watch') return { action: 'allow', domain, site, reason: 'watch' };
    if (granted(domain)) return { action: 'allow', domain, site, reason: 'unlocked' };
    if (day?.forced?.[domain]) return { action: 'block', domain, site, reason: 'manual' };
    if (site.mode === 'block') return { action: 'block', domain, site, reason: 'block' };
    if (usedMs(domain) >= site.limitMin * MINUTE) return { action: 'block', domain, site, reason: 'limit' };
    return { action: 'allow', domain, site, reason: 'within-limit' };
  }

  const match = category(host);
  if (match) {
    if (granted(match.domain)) return { action: 'allow', domain: match.domain, category: match.category, reason: 'unlocked' };
    return { action: 'block', domain: match.domain, category: match.category, reason: 'category' };
  }
  return { action: 'allow', domain: null, reason: 'unlisted' };
}

// Where a blocked site with "redirect to" should send the tab, or null to show
// the block page. A redirect that would itself be blocked falls back to the page.
export function redirectTarget(site, wouldBlock) {
  if (site?.show !== 'redirect' || !site.redirectUrl) return null;
  const host = hostOf(site.redirectUrl);
  if (!host || wouldBlock(host)) return null;
  return site.redirectUrl;
}

// Validates and cleans a site coming from the edit form.
export function sanitizeSite(input, limits) {
  const domain = normalizeDomain(input.domain);
  if (!domain) return { error: 'Enter a domain like news.ycombinator.com' };
  const mode = ['block', 'limit', 'watch'].includes(input.mode) ? input.mode : 'limit';
  const limitMin = Math.round(Number(input.limitMin));
  if (mode === 'limit' && !(limitMin >= 1 && limitMin <= 1440)) return { error: 'Daily limit must be 1–1440 minutes' };
  const cooldownSec = Math.round(Number(input.cooldownSec));
  if (!(cooldownSec >= limits.minCooldown && cooldownSec <= limits.maxCooldown)) {
    return { error: `Cooldown must be ${limits.minCooldown}–${limits.maxCooldown} seconds` };
  }
  const show = input.show === 'redirect' ? 'redirect' : 'message';
  let redirectUrl = String(input.redirectUrl ?? '').trim();
  if (show === 'redirect') {
    if (!/^https?:\/\//i.test(redirectUrl)) redirectUrl = 'https://' + redirectUrl;
    if (!hostOf(redirectUrl)) return { error: 'Redirect needs a web address' };
  }
  const modify = {};
  for (const [key, on] of Object.entries(input.modify ?? {})) modify[key] = Boolean(on);
  return {
    site: {
      domain,
      mode,
      limitMin: mode === 'limit' ? limitMin : (Number.isFinite(limitMin) && limitMin > 0 ? limitMin : 30),
      cooldownSec,
      show,
      message: String(input.message ?? '').slice(0, 500),
      redirectUrl: show === 'redirect' ? redirectUrl : String(input.redirectUrl ?? '').trim(),
      cooldownMessage: String(input.cooldownMessage ?? '').slice(0, 500),
      modify,
      addedAt: Number(input.addedAt) || Date.now(),
    },
  };
}
