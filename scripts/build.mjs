// Builds dist/<browser>/ (unpacked) and dist/clearmind-<browser>-<version>.zip.
// src/ is the Chromium build as-is; other browsers get a patched manifest.
//
//   node scripts/build.mjs            all browsers
//   node scripts/build.mjs firefox    one browser

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}src`;
const base = JSON.parse(await readFile(`${src}/manifest.json`, 'utf8'));

const TARGETS = {
  chrome: (m) => m,
  firefox: (m) => {
    const { service_worker, ...background } = m.background;
    const { minimum_chrome_version, ...rest } = m;
    return {
      ...rest,
      background: { ...background, scripts: [service_worker] },
      browser_specific_settings: {
        gecko: {
          id: 'clearmind@clearmind.local',
          // 140 (ESR) is the first release with built-in data-consent, which AMO requires.
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    };
  },
};

const wanted = process.argv.slice(2);
for (const [name, patch] of Object.entries(TARGETS)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const out = `${root}dist/${name}`;
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(src, out, { recursive: true });
  // The GPL text travels with every copy.
  await cp(`${root}LICENSE`, `${out}/LICENSE`);
  await writeFile(`${out}/manifest.json`, JSON.stringify(patch(structuredClone(base)), null, 2) + '\n');
  const zip = `${root}dist/clearmind-${name}-${base.version}.zip`;
  // Only the current version's archive is kept.
  for (const file of await readdir(`${root}dist`)) {
    if (file.startsWith(`clearmind-${name}-`) && file.endsWith('.zip')) await rm(`${root}dist/${file}`);
  }
  try {
    execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
    console.log(`${name}: dist/${name}/ and ${zip.slice(root.length)}`);
  } catch {
    console.log(`${name}: dist/${name}/ (zip not installed, skipped the archive)`);
  }
}
