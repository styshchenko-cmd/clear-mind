// Category domain lists, bundled with the extension under lists/<id>.txt
// (one domain per line). Loaded lazily, only for categories that are on.

import { api } from './api.js';
import { suffixes } from './domain.js';

const loaded = new Map();

export function parseList(text) {
  const set = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim().toLowerCase();
    if (line && !line.startsWith('#')) set.add(line.replace(/^www\./, ''));
  }
  return set;
}

export function loadList(id) {
  if (!loaded.has(id)) {
    const promise = fetch(api.runtime.getURL(`lists/${id}.txt`))
      .then((res) => (res.ok ? res.text() : ''))
      .then(parseList)
      .catch(() => new Set());
    loaded.set(id, promise);
  }
  return loaded.get(id);
}

// Every one of `ids` whose list covers host, as [{category, domain}].
export async function matchCategories(host, ids) {
  const matches = [];
  for (const id of ids) {
    const list = await loadList(id);
    const domain = [...suffixes(host)].find((candidate) => list.has(candidate));
    if (domain) matches.push({ category: id, domain });
  }
  return matches;
}

// How a configured site overlaps a category list: `covering` is the list entry
// that covers the site's domain (reddit.com for old.reddit.com), and `under`
// counts list entries inside it (news.google.com under google.com).
export function listOverlap(domain, list) {
  const covering = [...suffixes(domain)].find((d) => list.has(d)) ?? null;
  let under = 0;
  const examples = [];
  if (!covering) {
    for (const d of list) {
      if (!d.endsWith('.' + domain)) continue;
      under += 1;
      if (examples.length < 2) examples.push(d);
    }
  }
  return covering || under ? { covering, under, examples } : null;
}

export async function listSizes(ids) {
  const sizes = {};
  for (const id of ids) sizes[id] = (await loadList(id)).size;
  return sizes;
}
