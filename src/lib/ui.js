// Small DOM helpers shared by the extension pages.

import { api } from './api.js';

// h('div', {class: 'card', onclick}, child, 'text', [more children])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Stroke icons from the mockups.
const ICONS = {
  grid: ['rect:3,3,7,7', 'rect:14,3,7,7', 'rect:3,14,7,7', 'rect:14,14,7,7'],
  edit: ['path:M12 20h9', 'path:M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  trash: ['path:M3 6h18', 'path:M8 6V4h8v2', 'path:M19 6l-1 14H6L5 6', 'path:M10 11v6', 'path:M14 11v6'],
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  for (const part of ICONS[name]) {
    const [kind, data] = part.split(':');
    const el = document.createElementNS(SVG_NS, kind);
    if (kind === 'rect') {
      const [x, y, w, hgt] = data.split(',');
      Object.entries({ x, y, width: w, height: hgt }).forEach(([k, v]) => el.setAttribute(k, v));
    } else el.setAttribute('d', data);
    svg.append(el);
  }
  return svg;
}

export function bar(fraction, tone, label) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return h('div', { class: `bar ${tone ?? ''}`, role: 'img', 'aria-label': label }, h('span', { style: { width: `${pct}%` } }));
}

// Green under 60%, amber up to the limit, red at or over it.
export function usageTone(fraction) {
  if (fraction >= 1) return 'red';
  if (fraction >= 0.6) return 'amber';
  return '';
}

// Message to the background; resolves with its reply.
export function send(type, payload = {}) {
  return api.runtime.sendMessage({ type, ...payload });
}

export function readLocal(keys) {
  return api.storage.local.get(keys);
}

export function onLocalChange(callback) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') callback(changes);
  });
}

export const optionsUrl = (hash = '') => api.runtime.getURL('pages/options.html') + (hash ? `#${hash}` : '');

export const supportedAdapter = (domain) =>
  (globalThis.ClearMindAdapters ?? []).find((a) =>
    a.domains.some((d) => domain === d || domain.endsWith('.' + d) || d.endsWith('.' + domain)),
  ) ?? null;
