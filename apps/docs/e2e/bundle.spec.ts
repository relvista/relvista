// JavaScript budgets of the docs site (docs/design/phase3-v1.md §13 "Bundle size"). What a page
// costs is every script it downloads until the network is idle, the prefetches of the pages it
// links to included (Docusaurus prefetches the chunks of every internal link in view). Which of
// those files hold relvista code comes from the bundle manifest the build writes
// (plugins/bundle-manifest.ts): modules of the relvista packages, and modules of npm packages
// that only they import (the DBML parser, React Flow, ELK, jsPDF, …).
//
// - Pages without diagrams load none of it, but for the MDX `code` hook (a stub with
//   Docusaurus' MDX components: it hands ```dbml fences to the diagram code, which only pages
//   with a fence load) and the DBML Prism grammar (the plugin's `highlight` option).
// - Pages with diagrams load the theme code and the viewer, within a ceiling; PDF export, ELK
//   (the browser never lays out a server-rendered diagram) and react-dom/server load on use only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { BundleFile } from '../plugins/bundle-manifest';

const jsDir = fileURLToPath(new URL('../build/assets/js/', import.meta.url));
/** Written by plugins/bundle-manifest.ts (its MANIFEST). */
const MANIFEST = fileURLToPath(
  new URL('../../../node_modules/.cache/relvista-bundle/docs.json', import.meta.url),
);

/** The relvista modules every MDX page may load (see above). */
const ALWAYS = new Set([
  'packages/docusaurus-plugin/lib/theme/MDXComponents/Code/index.js',
  'packages/docusaurus-plugin/lib/client/fence.js',
  'packages/docusaurus-plugin/lib/client/prism-dbml.js',
]);

/** npm packages of features that load on use, never with a page. */
const ON_USE = ['jspdf', 'svg2pdf.js', 'elkjs', 'react-dom'];

function manifest(): Record<string, BundleFile> {
  expect(existsSync(MANIFEST), `${MANIFEST} is missing: build the docs site first`).toBe(true);
  return (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { files: Record<string, BundleFile> })
    .files;
}

interface Script {
  /** Path in the build (`assets/js/…`). */
  file: string;
  gz: number;
  /** The relvista code it holds, the modules every page may load left out (null: none). */
  relvista: BundleFile | null;
}

/** Every script the page downloads (prefetches included) until it settles, gzipped sizes. */
async function scripts(page: Page, path: string): Promise<Script[]> {
  const files = manifest();
  const bodies = new Map<string, Buffer>();
  const pending: Promise<void>[] = [];
  page.on('response', (r) => {
    if (!r.url().endsWith('.js')) return;
    pending.push(
      r.body().then(
        (b) => void bodies.set(new URL(r.url()).pathname.replace(/^\//, ''), b),
        () => {},
      ),
    );
  });
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await Promise.all(pending);
  return [...bodies].map(([file, body]) => {
    const f = files[file];
    const own = f && { ...f, relvista: f.relvista.filter((m) => !ALWAYS.has(m)) };
    const relvista = own && (own.relvista.length || own.relvistaDeps.length) ? own : null;
    return { file, gz: gzipSync(body).length, relvista };
  });
}

const total = (list: Script[]) => list.reduce((n, s) => n + s.gz, 0);
const name = (s: Script) => s.file.split('/').pop()!;

test('the theme code is in one shared chunk, not copied into page chunks', () => {
  const withTheme = readdirSync(jsDir).filter(
    (f) => f.endsWith('.js') && readFileSync(join(jsDir, f), 'utf8').includes('relvista-ssr'),
  );
  expect(withTheme).toHaveLength(1);
  expect(withTheme[0]).toMatch(/^relvista-theme\.[0-9a-f]+\.js$/);
});

for (const path of ['docs/layout-file', 'docs/editor', 'docs/api/', 'blog', 'third-party-notices'])
  test(`${path} (no diagram) loads no relvista code`, async ({ page }) => {
    const list = await scripts(page, path);
    const found = list.flatMap((s) => [
      ...(s.relvista?.relvista ?? []).map((m) => `${name(s)}: ${m}`),
      ...(s.relvista?.relvistaDeps ?? []).map((d) => `${name(s)}: npm ${d}`),
    ]);
    console.log(`[size] ${path}: ${total(list)} B of JavaScript (gzip), ${list.length} files`);
    expect(found).toEqual([]);
  });

test('a docs page without diagrams stays within its JavaScript budget', async ({ page }) => {
  const list = await scripts(page, 'docs/layout-file');
  const gz = total(list);
  console.log(`[size] docs/layout-file: ${gz} B of JavaScript (gzip), ${list.length} files`);
  // About 281 KB on 2026-11-22 (phase 2: ~221 KB with 23 pages; the site now has ~340, and
  // main.js and the route map carry the ~320 API routes; docs/design/phase3-v1.md "Bundle size").
  expect(gz).toBeLessThan(300_000);
  const files = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
  // The API sidebar metadata (~18 KB gzip) is not even prefetched: the navbar and sidebar links
  // to /docs/api are plain links (docusaurus.config.ts, sidebars.ts).
  const apiMeta = files.filter((f) => {
    const code = readFileSync(join(jsDir, f), 'utf8');
    return code.includes('"pluginId":"api"') && code.includes('"docsSidebars"');
  });
  expect(apiMeta).toHaveLength(1);
  expect(list.map(name)).not.toContain(apiMeta[0]);
  // Nor is it part of the main docs instance's metadata, which every docs page loads.
  const mainMeta = files.filter((f) => {
    const code = readFileSync(join(jsDir, f), 'utf8');
    return code.includes('"pluginId":"default"') && code.includes('"docsSidebars"');
  });
  expect(mainMeta).toHaveLength(1);
  const meta = readFileSync(join(jsDir, mainMeta[0]!), 'utf8');
  expect(meta).not.toContain('/docs/api/core/');
  expect(meta.length).toBeLessThan(30_000);
});

// A page with ```dbml fences and one that imports @theme/DbmlDiagram (the gallery).
for (const path of ['docs/getting-started', 'docs/gallery/02-ecommerce'])
  test(`${path} (diagrams) loads the viewer within its budget, export and ELK on use`, async ({
    page,
  }) => {
    const list = await scripts(page, path);
    const own = list.filter((s) => s.relvista);
    const gz = total(own);
    console.log(
      `[size] ${path}: ${gz} B of relvista JavaScript (gzip) of ${total(list)} B, ` +
        own.map((s) => `${name(s)} ${s.gz}`).join(', '),
    );
    // The viewer is there: it replaces the static picture.
    await expect(page.locator('.rv-viewer[data-rv-layout="done"]').first()).toBeVisible();
    // About 335 KB on 2026-11-22: the DBML parser, React Flow and dagre (~260 KB), the viewer
    // (~67 KB), the theme code (~8 KB). 1.0 shipped 404 KB (react-dom/server came with the viewer).
    expect(gz).toBeLessThan(345_000);
    const early = own.flatMap((s) => [
      ...s.relvista!.relvistaDeps.filter((d) => ON_USE.includes(d)).map((d) => `npm ${d}`),
      ...s.relvista!.relvista.filter((m) =>
        /renderer\/dist\/(?:export\/(?:pdf\/|png|print|svgString)|nav\/PdfDialog|viewer\/PdfExport)/.test(
          m,
        ),
      ),
    ]);
    expect(early).toEqual([]);
  });
