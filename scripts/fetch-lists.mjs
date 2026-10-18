// Downloads the third-party category lists into src/lists/. Run by hand
// (`npm run lists`) when refreshing them, then review the git diff before
// committing; the extension itself never fetches.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCES = {
  adult: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/nsfw-onlydomains.txt',
  gambling: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/gambling.mini-onlydomains.txt',
};

// Never let a third-party list block these, whatever it contains. NEVER is
// exact (adult blogs on *.tumblr.com are fine to block); NEVER_UNDER also
// covers every subdomain (mail.google.com, gist.github.com).
const NEVER = new Set(['reddit.com', 'x.com', 'twitter.com', 'tumblr.com']);
const NEVER_UNDER = ['google.com', 'youtube.com', 'github.com', 'wikipedia.org', 'microsoft.com', 'apple.com'];

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
// Second-level public suffixes such as co.uk or com.ua: never a whole entry.
const PUBLIC_SUFFIX = /^(?:co|com|net|org|gov|edu|ac|or|ne|go)\.[a-z]{2}$/;
const MAX_ENTRIES = 2_000_000;
const allowed = (d) =>
  DOMAIN.test(d) && !PUBLIC_SUFFIX.test(d) && !NEVER.has(d) && !NEVER_UNDER.some((n) => d === n || d.endsWith('.' + n));

for (const [id, url] of Object.entries(SOURCES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const domains = new Set();
  for (const raw of (await res.text()).split('\n')) {
    const line = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
    if (line && !line.startsWith('#') && allowed(line)) domains.add(line);
  }
  if (domains.size > MAX_ENTRIES) throw new Error(`${id}: ${domains.size} entries, refusing (review upstream)`);
  const sorted = [...domains].sort();
  const out = fileURLToPath(new URL(`../src/lists/${id}.txt`, import.meta.url));
  await writeFile(out, sorted.join('\n') + '\n');
  console.log(`${id}: ${sorted.length} domains`);
}
