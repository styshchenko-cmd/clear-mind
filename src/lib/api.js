// The WebExtension namespace: `browser` on Firefox and Safari, `chrome` on Chromium.
// Both return promises under Manifest V3.
export const api = globalThis.browser ?? globalThis.chrome;
