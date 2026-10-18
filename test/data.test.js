// Checks the bundled data files: category lists, adapters and the manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { CATEGORIES } from '../src/lib/model.js';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('every category has a non-empty, well-formed list', () => {
  for (const { id } of CATEGORIES) {
    const lines = read(`lists/${id}.txt`).trim().split('\n');
    assert.ok(lines.length > 20, `${id} has ${lines.length} domains`);
    for (const line of lines.slice(0, 2000)) assert.match(line, /^[a-z0-9.-]+\.[a-z0-9-]+$/, `${id}: ${line}`);
  }
});

test('big mainstream sites are not swept into adult or gambling', () => {
  for (const id of ['adult', 'gambling']) {
    const list = new Set(read(`lists/${id}.txt`).split('\n'));
    for (const domain of ['google.com', 'reddit.com', 'x.com', 'youtube.com', 'github.com', 'wikipedia.org']) {
      assert.ok(!list.has(domain), `${domain} is in ${id}`);
    }
  }
});

function loadAdapters() {
  const context = vm.createContext({ URL });
  vm.runInContext(read('shared/adapters.js'), context);
  return context.ClearMindAdapters;
}

test('adapters are well-formed and never throw on odd URLs', () => {
  const adapters = loadAdapters();
  assert.deepEqual(Array.from(adapters, (a) => a.id), ['reddit', 'youtube', 'x', 'instagram', 'facebook', 'linkedin']);
  for (const adapter of adapters) {
    for (const option of adapter.options) {
      assert.ok(option.key && option.label && option.summary, `${adapter.id}.${option.key}`);
      assert.notEqual(option.key, 'grayscale');
      assert.equal(option.css.split('{').length, option.css.split('}').length, `${adapter.id}.${option.key} braces`);
    }
    for (const url of ['https://' + adapter.domains[0] + '/', 'https://' + adapter.domains[0] + '/some/deep/path?q=1']) {
      assert.equal(typeof adapter.route(new URL(url)), 'string');
      adapter.redirect(new URL(url));
    }
  }
});

test('YouTube Shorts redirect to the normal player', () => {
  const youtube = loadAdapters().find((a) => a.id === 'youtube');
  assert.equal(youtube.redirect(new URL('https://www.youtube.com/shorts/abc123')), 'https://www.youtube.com/watch?v=abc123');
  assert.equal(youtube.redirect(new URL('https://www.youtube.com/watch?v=abc123')), null);
});

test('manifest asks for no broad host access', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(!manifest.permissions.includes('<all_urls>'));
  for (const pattern of manifest.content_scripts[0].matches) assert.notEqual(pattern, '<all_urls>');
});
