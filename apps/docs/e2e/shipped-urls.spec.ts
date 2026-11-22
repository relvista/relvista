// The site moved twice before 1.0 (decision 0002, amendments): from uncovered-songs.github.io to
// relvista.github.io/relvista, then to https://relvista.org. The old hosts answer 404 or will stop
// serving relvista, so no shipped file may still point there. The only exception is the old layout
// schema ids as exact strings (LEGACY_SCHEMA_IDS): files written with them stay valid, and docs may
// name them as such.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const siteDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** Every file under `dir`, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Old `$schema` ids that relvista still accepts (decision 0002). Identifiers only, never links. */
const LEGACY_SCHEMA_IDS = [
  'https://relvista.github.io/relvista/schemas/layout-1.json',
  'https://uncovered-songs.github.io/relvista/schemas/layout-1.json',
];
const STALE =
  /uncovered-songs\.github\.io|github\.com\/Uncovered-Songs|relvista\.github\.io\/relvista/i;

/** The text with every legacy schema id taken out. */
function withoutLegacyIds(text: string): string {
  return LEGACY_SCHEMA_IDS.reduce((t, id) => t.split(id).join(''), text);
}

test('no shipped file names a pre-move host', () => {
  const shipped = [
    ...walk(`${siteDir}build`),
    'schemas/layout.schema.json',
    'README.md',
    ...[
      ['core', 'dist'],
      ['renderer', 'dist'],
      ['docusaurus-plugin', 'lib'],
    ].flatMap(([p, out]) => [
      ...walk(`${repoRoot}packages/${p}/${out}`),
      `packages/${p}/package.json`,
      `packages/${p}/README.md`,
    ]),
    'packages/core/layout.schema.json',
  ].map((f) => (isAbsolute(f) ? f : `${repoRoot}${f}`));
  expect(shipped.length).toBeGreaterThan(100);
  const hits = shipped.filter(
    (f) =>
      /\.(html|js|mjs|cjs|css|json|map|md|txt|xml|svg|d\.ts)$/.test(f) &&
      STALE.test(withoutLegacyIds(readFileSync(f, 'utf8'))),
  );
  expect(hits).toEqual([]);
});

test('the guard itself: legacy ids pass, other old URLs fail', () => {
  for (const id of LEGACY_SCHEMA_IDS)
    expect(STALE.test(withoutLegacyIds(`"$schema": "${id}"`))).toBe(false);
  expect(STALE.test(withoutLegacyIds('https://relvista.github.io/relvista/editor/'))).toBe(true);
  expect(STALE.test(withoutLegacyIds('https://uncovered-songs.github.io/relvista/'))).toBe(true);
});

test('the build is the relvista.org site: CNAME and the layout schema at its id', () => {
  expect(readFileSync(`${siteDir}build/CNAME`, 'utf8')).toBe('relvista.org\n');
  const schema = JSON.parse(readFileSync(`${siteDir}build/schemas/layout-1.json`, 'utf8'));
  expect(schema.$id).toBe('https://relvista.org/schemas/layout-1.json');
  expect(new URL(schema.$id).pathname).toBe('/schemas/layout-1.json');
});
