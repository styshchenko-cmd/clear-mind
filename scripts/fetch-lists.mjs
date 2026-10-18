// Downloads the third-party category lists into src/lists/. Run by hand
// (`npm run lists`) when refreshing them; the extension itself never fetches.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCES = {
  adult: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/nsfw-onlydomains.txt',
  gambling: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/gambling.mini-onlydomains.txt',
};

// Never let a third-party list block these, whatever it contains.
const NEVER = new Set(['reddit.com', 'x.com', 'twitter.com', 'tumblr.com', 'google.com', 'youtube.com', 'github.com']);

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

for (const [id, url] of Object.entries(SOURCES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const domains = new Set();
  for (const raw of (await res.text()).split('\n')) {
    const line = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
    if (line && !line.startsWith('#') && DOMAIN.test(line) && !NEVER.has(line)) domains.add(line);
  }
  const sorted = [...domains].sort();
  const out = fileURLToPath(new URL(`../src/lists/${id}.txt`, import.meta.url));
  await writeFile(out, sorted.join('\n') + '\n');
  console.log(`${id}: ${sorted.length} domains`);
}
