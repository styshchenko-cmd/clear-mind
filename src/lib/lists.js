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

// The first of `ids` whose list covers host, as {category, domain}, or null.
export async function matchCategory(host, ids) {
  for (const id of ids) {
    const list = await loadList(id);
    for (const candidate of suffixes(host)) {
      if (list.has(candidate)) return { category: id, domain: candidate };
    }
  }
  return null;
}

export async function listSizes(ids) {
  const sizes = {};
  for (const id of ids) sizes[id] = (await loadList(id)).size;
  return sizes;
}
