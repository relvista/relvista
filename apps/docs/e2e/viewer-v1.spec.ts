// Viewer v1 on the built docs site (docs/design/phase3-v1.md §4.7, §7): search, path, detail level,
// PDF export, accessibility of the new chrome, and no ELK for small diagrams drawn in the browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

/** axe-core's browser build (from the docs app's `@axe-core/playwright`), injected as a script. */
function axeSource(): string {
  const docs = createRequire(join(here, '..', 'package.json'));
  return createRequire(docs.resolve('@axe-core/playwright')).resolve('axe-core/axe.min.js');
}

/** axe (wcag2a, wcag2aa) on the given parts of the page; returns the violations. */
async function axe(page: Page, include: string[]): Promise<Array<{ id: string; nodes: string[] }>> {
  await page.addScriptTag({ path: axeSource() });
  return page.evaluate(async (sel) => {
    const w = window as unknown as {
      axe: {
        run(
          ctx: unknown,
          opts: unknown,
        ): Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }>;
      };
    };
    const r = await w.axe.run(
      { include: sel.map((s) => [s]) },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } },
    );
    return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }));
  }, include);
}

/** Waits until a diagram has its final layout and returns its viewer root. */
async function settled(diagram: Locator): Promise<Locator> {
  const viewer = diagram.locator('.rv-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-rv-layout', 'done');
  return viewer;
}

function tableNode(viewer: Locator, id: string): Locator {
  return viewer.locator(`.react-flow__node[data-id="${id}"]`);
}

async function openLarge(page: Page): Promise<Locator> {
  await page.goto('docs/gallery/14-large');
  const viewer = await settled(page.locator('.relvista-diagram').first());
  // The first view's animations.
  await page.waitForTimeout(300);
  return viewer;
}

test('search "invoice" → Enter centres and lights the invoices table', async ({ page }) => {
  const viewer = await openLarge(page);
  await viewer.getByRole('button', { name: 'Search' }).click();
  const input = viewer.getByRole('combobox', { name: 'Search' });
  await expect(input).toBeFocused();
  await input.fill('invoice');
  const first = viewer.locator('.rv-nav-search').getByRole('option').first();
  await expect(first).toContainText('invoices');
  await expect(input).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);
  // Hits are toned while typing, the rest dimmed.
  await expect(tableNode(viewer, 'public.invoices').locator('.rv-table')).toHaveAttribute(
    'data-rv-tone',
    'match',
  );
  await input.press('Enter');
  await expect(viewer.locator('.rv-nav-search')).toHaveCount(0);
  const invoices = tableNode(viewer, 'public.invoices');
  await expect(invoices.locator('.rv-node')).toHaveClass(/rv-highlighted/);
  await expect(invoices).toBeFocused();
  // Centred (after the 250 ms move).
  await page.waitForTimeout(500);
  const canvas = (await viewer.locator('.rv-canvas').boundingBox())!;
  const box = (await invoices.boundingBox())!;
  const dx = Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2));
  const dy = Math.abs(box.y + box.height / 2 - (canvas.y + canvas.height / 2));
  expect(dx, 'horizontally centred').toBeLessThan(60);
  expect(dy, 'vertically centred').toBeLessThan(60);
});

test('path between two tables: tables and refs lit, hops listed', async ({ page }) => {
  const viewer = await openLarge(page);
  await viewer.getByRole('button', { name: 'Search' }).click();
  await viewer.getByRole('button', { name: 'Path' }).click();
  const from = viewer.getByRole('combobox', { name: 'From' });
  await expect(from).toBeFocused();
  await from.fill('invoice_lines');
  await from.press('Enter');
  const to = viewer.getByRole('combobox', { name: 'To' });
  await expect(to).toBeFocused();
  await to.fill('organizations');
  await to.press('Enter');
  const status = viewer.locator('.rv-nav-status');
  await expect(status).toHaveText(/^invoice_lines → .+ → organizations, \d+ refs?$/);
  const text = (await status.textContent())!;
  const hops = Number(/, (\d+) refs?$/.exec(text)![1]);
  expect(hops).toBeGreaterThanOrEqual(2);
  await expect(viewer.locator('.rv-table[data-rv-tone="path"]')).toHaveCount(hops + 1);
  await expect(viewer.locator('.react-flow__edge [data-rv-tone="path"]')).toHaveCount(hops);
  await expect(tableNode(viewer, 'public.invoice_lines').locator('.rv-table')).toHaveAttribute(
    'data-rv-tone',
    'path',
  );
});

test('detail level Keys reduces the rows', async ({ page }) => {
  const viewer = await openLarge(page);
  const rows = viewer.locator('.rv-column');
  const all = await rows.count();
  expect(all).toBeGreaterThan(0);
  await viewer.getByRole('button', { name: 'Detail level' }).click();
  await viewer.getByRole('menuitemradio', { name: /^Keys/ }).click();
  await expect(viewer.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => rows.count()).toBeLessThan(all);
  await viewer.getByRole('button', { name: 'Detail level' }).click();
  await expect(viewer.getByRole('menuitemradio', { name: /^Keys/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('PDF tiled export downloads a PDF with the page count planTiles gave', async ({ page }) => {
  const viewer = await openLarge(page);
  await viewer.getByRole('button', { name: 'Export' }).click();
  await viewer.getByRole('menuitem', { name: 'PDF…' }).click();
  const dialog = viewer.getByRole('dialog', { name: 'Export PDF' });
  await expect(dialog).toBeVisible();
  // A smaller scale keeps the test quick; the count still comes from planTiles.
  await dialog.getByLabel('Scale (%)').fill('50');
  const status = dialog.getByRole('status');
  await expect(status).toHaveText(/^\d+ pages? \(\d+ × \d+(, \d+ empty left out)?\)/);
  const expected = Number(await status.getAttribute('data-rv-pages'));
  const rows = Number(await status.getAttribute('data-rv-rows'));
  const cols = Number(await status.getAttribute('data-rv-cols'));
  // Pages without a table are skipped by default (Skip empty pages).
  const printed = rows * cols - Number(await status.getAttribute('data-rv-skipped'));
  expect(expected).toBe(printed + (printed > 1 ? 1 : 0));
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = readFileSync((await download.path())!).toString('latin1');
  expect(bytes.startsWith('%PDF-')).toBe(true);
  const pages = bytes.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? [];
  expect(pages.length).toBe(expected);
  await expect(viewer.locator('.rv-v1-toast')).toContainText('PDF downloaded');
});

for (const mode of ['light', 'dark'] as const) {
  test(`axe: the search panel and toolbar are clean (${mode})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const viewer = await openLarge(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await viewer.getByRole('button', { name: 'Search' }).click();
    await viewer.getByRole('combobox', { name: 'Search' }).fill('user');
    await expect(viewer.locator('.rv-nav-search').getByRole('option').first()).toBeVisible();
    const scope = ['.relvista-diagram .rv-nav-search', '.relvista-diagram .rv-toolbar'];
    expect(await axe(page, scope)).toEqual([]);
    // Path mode, with a table list open.
    await viewer.getByRole('button', { name: 'Path' }).click();
    await expect(viewer.getByRole('combobox', { name: 'From' })).toBeFocused();
    await expect(viewer.locator('.rv-nav-search').getByRole('option').first()).toBeVisible();
    expect(await axe(page, scope)).toEqual([]);
    // The PDF dialog.
    await page.keyboard.press('Escape');
    await viewer.getByRole('button', { name: 'Export' }).click();
    await viewer.getByRole('menuitem', { name: 'PDF…' }).click();
    await expect(viewer.getByRole('dialog', { name: 'Export PDF' })).toBeVisible();
    expect(await axe(page, ['.relvista-diagram .rv-nav-dialog'])).toEqual([]);
  });
}

test('search on a phone: the panel fits, the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('docs/gallery/02-ecommerce');
  const viewer = await settled(page.locator('.relvista-diagram').first());
  await viewer.getByRole('button', { name: 'Search' }).click();
  await viewer.getByRole('combobox', { name: 'Search' }).fill('order');
  await expect(viewer.locator('.rv-nav-search').getByRole('option').first()).toBeVisible();
  const panel = (await viewer.locator('.rv-nav-search').boundingBox())!;
  const box = (await viewer.boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(box.x);
  expect(panel.x + panel.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  // Every toolbar button is inside the viewer.
  for (const b of await viewer.locator('.rv-toolbar .rv-tb-button:visible').all()) {
    const r = (await b.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(box.x);
    expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
});

test.describe('layout engine in the browser (§7)', () => {
  // Without build-time positions (a client-side navigation has no server HTML for the page), a
  // small diagram is laid out with the sync engine: no ELK worker. A bigger one does load ELK,
  // which shows the request is observed at all.
  async function clientNavigate(page: Page, slug: string): Promise<string[]> {
    const elk: string[] = [];
    page.context().on('request', (r) => {
      if (/elk-worker/.test(r.url())) elk.push(r.url());
    });
    await page.goto('docs/gallery');
    await expect(page.locator('.relvista-diagram')).toHaveCount(0);
    await page.locator(`a[href$="/docs/gallery/${slug}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/docs/gallery/${slug}$`));
    const diagram = page.locator('.relvista-diagram').first();
    await settled(diagram);
    // No build-time payload on a client-side navigation.
    await expect(diagram.locator('script[data-rv-ssr]')).toHaveCount(0);
    await page.waitForTimeout(500);
    return elk;
  }

  test('a small diagram drawn after a client navigation makes no elk-worker request', async ({
    page,
  }) => {
    expect(await clientNavigate(page, '01-minimal')).toEqual([]);
  });

  test('neither does one whose refs join AUTO_DAGRE_MAX_NODES (4) tables', async ({ page }) => {
    // 06-header-colors: one connected component of 4 tables and a lone table.
    expect(await clientNavigate(page, '06-header-colors')).toEqual([]);
  });

  test('control: a bigger diagram drawn after a client navigation does load ELK', async ({
    page,
  }) => {
    expect((await clientNavigate(page, '02-ecommerce')).length).toBeGreaterThan(0);
  });
});
