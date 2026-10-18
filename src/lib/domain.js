// Domain parsing and matching. A rule for `reddit.com` covers `reddit.com`
// and every subdomain (`old.reddit.com`), but not `notreddit.com`.

const LABEL = /^[a-z0-9-]{1,63}$/;

// Turns user input ("https://www.Reddit.com/r/x", "reddit.com:443") into a bare
// lowercase host without a leading "www.". Returns null when it isn't a domain.
export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  // "*.example.com" and ".example.com" mean the same as a rule: every subdomain.
  let text = input.trim().toLowerCase().replace(/^\*?\./, '');
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = 'http://' + text;
  let host;
  try {
    host = new URL(text).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  const labels = host.split('.');
  if (labels.length < 2 && host !== 'localhost') return null;
  if (!labels.every((l) => LABEL.test(l) && !l.startsWith('-') && !l.endsWith('-'))) return null;
  return host;
}

// Host of a web page URL, or null for anything that isn't http(s).
export function hostOf(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname.replace(/\.$/, '').replace(/^www\./, '') || null;
}

export function matchesDomain(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

// The host itself followed by each parent domain: a.b.c.com, b.c.com, c.com.
export function* suffixes(host) {
  let rest = host;
  while (rest.includes('.')) {
    yield rest;
    rest = rest.slice(rest.indexOf('.') + 1);
  }
  if (rest === 'localhost') yield rest;
}

// The most specific configured domain that covers `host`, or null.
export function findSiteDomain(host, sites) {
  if (!host) return null;
  for (const candidate of suffixes(host)) {
    if (Object.hasOwn(sites, candidate)) return candidate;
  }
  return null;
}
