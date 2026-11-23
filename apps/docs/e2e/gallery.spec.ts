// Phase-1 gate: the docs site renders every file in examples/ (decision 0001).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { examplePages } from './examples.js';

// Screenshots of every page in both colour modes, for review. Override with RELVISTA_SHOTS=<dir>.
const SHOTS = process.env.RELVISTA_SHOTS ?? join(process.cwd(), 'test-results', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const pages = examplePages();

/** Waits until a diagram has its final layout and returns its viewer root. */
async function settled(diagram: Locator): Promise<Locator> {
  const viewer = diagram.locator('.rv-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-rv-layout', 'done');
  return viewer;
}

async function expectNoErrors(page: Page): Promise<void> {
  await expect(page.locator('.relvista-error')).toHaveCount(0);
  await expect(page.locator('.rv-banner')).toHaveCount(0);
  await expect(page.locator('.rv-empty')).toHaveCount(0);
}

/** Whether every table of a viewer is inside its canvas. */
function allOnScreen(viewer: Locator): Promise<boolean> {
  return viewer.evaluate((el) => {
    const c = el.querySelector('.rv-canvas')!.getBoundingClientRect();
    return Array.from(el.querySelectorAll('.react-flow__node-rvTable')).every((n) => {
      const r = n.getBoundingClientRect();
      return (
        r.left >= c.left - 4 &&
        r.right <= c.right + 4 &&
        r.top >= c.top - 4 &&
        r.bottom <= c.bottom + 4
      );
    });
  });
}

/** Every diagram on the page shows the tables of its view; larger ones also get a minimap. */
async function checkDiagrams(page: Page, tables: Record<string, number>): Promise<number> {
  const diagrams = page.locator('.relvista-diagram');
  await expect(diagrams.first()).toBeVisible();
  const count = await diagrams.count();
  for (let i = 0; i < count; i++) {
    const diagram = diagrams.nth(i);
    await diagram.scrollIntoViewIfNeeded();
    const view = (await diagram.getAttribute('data-rv-view')) ?? '*';
    expect(tables[view], `view ${view} exists`).toBeDefined();
    const viewer = await settled(diagram);
    await expect(viewer.locator('.react-flow__node-rvTable')).toHaveCount(tables[view]!);
    // 'auto' minimap: 8 or more tables in a viewer at least 600px wide (the test viewport is),
    // or whenever tables are off-screen; a diagram that is all on screen has none.
    const minimap = viewer.locator('.react-flow__minimap');
    if (tables[view]! >= 8) {
      // A first view that leaves a table where the minimap goes holds it back until the first
      // pan or zoom.
      if ((await minimap.count()) === 0)
        await viewer.getByRole('button', { name: 'Fit to view' }).click();
      await expect(minimap).toBeVisible();
    } else if ((await minimap.count()) === 0) expect(await allOnScreen(viewer)).toBe(true);
    // React Flow's attribution is credited in the README instead.
    await expect(viewer.locator('.react-flow__attribution')).toHaveCount(0);
  }
  return count;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  // Let fit-view animations finish.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const example of pages) {
  test.describe(`gallery ${example.slug}`, () => {
    for (const mode of ['light', 'dark'] as const) {
      test(`renders every table (${mode})`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.emulateMedia({ colorScheme: mode });
        await page.goto(`docs/gallery/${example.slug}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        const count = await checkDiagrams(page, example.tables);
        expect(count).toBeGreaterThanOrEqual(1);
        await expect(page.locator('.rv-viewer').first()).toHaveAttribute(
          'data-rv-color-mode',
          mode,
        );
        await expectNoErrors(page);
        expect(errors).toEqual([]);
        await screenshot(page, `${example.slug}-${mode}`);
      });
    }
  });
}

test('gallery index links every example', async ({ page }) => {
  await page.goto('docs/gallery');
  for (const example of pages) {
    await expect(page.locator(`a[href$="/docs/gallery/${example.slug}"]`).first()).toBeVisible();
  }
  await screenshot(page, 'gallery-index-light');
});

test('landing page shows the live e-commerce diagram', async ({ page }) => {
  await page.goto('');
  const ecommerce = pages.find((p) => p.slug === '02-ecommerce')!;
  const hero = page.locator('.relvista-diagram').first();
  const viewer = await settled(hero);
  await expect(viewer.locator('.react-flow__node-rvTable')).toHaveCount(ecommerce.tables['*']!);
  await expectNoErrors(page);
  await screenshot(page, 'home-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await settled(page.locator('.relvista-diagram').first());
  await screenshot(page, 'home-dark');
});

test('no page scrolls sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['', 'docs/getting-started', 'docs/usage', 'docs/gallery/02-ecommerce']) {
    await page.goto(path);
    await settled(page.locator('.relvista-diagram').first());
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, `${path || 'landing'} is ${width}px wide`).toBeLessThanOrEqual(390);
  }
});

test('usage page: fences, src, layout files and source tabs all render', async ({ page }) => {
  await page.goto('docs/usage');
  const diagrams = page.locator('.relvista-diagram');
  // The fourth is the frozen=false fence (frozen.spec.ts).
  await expect(diagrams).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await diagrams.nth(i).scrollIntoViewIfNeeded();
    await settled(diagrams.nth(i));
  }
  await expectNoErrors(page);
  // The layout file puts posts left of users.
  const withLayout = diagrams.nth(2);
  const posts = await withLayout.locator('.react-flow__node[data-id="public.posts"]').boundingBox();
  const users = await withLayout.locator('.react-flow__node[data-id="public.users"]').boundingBox();
  expect(posts && users && posts.x < users.x).toBe(true);
  // Source tab shows the DBML.
  await diagrams.first().getByRole('tab', { name: 'Source' }).click();
  await expect(diagrams.first().locator('pre')).toContainText('Table invoices');
  await screenshot(page, 'usage-light');
});

test('fullscreen button toggles fullscreen', async ({ page }) => {
  await page.goto('docs/gallery/02-ecommerce');
  const viewer = await settled(page.locator('.relvista-diagram').first());
  await viewer.getByRole('button', { name: 'Fullscreen' }).click();
  await expect(viewer).toHaveClass(/rv-viewer--(fullscreen|overlay)/);
  const box = await viewer.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(1300);
  await viewer.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect(viewer).not.toHaveClass(/rv-viewer--(fullscreen|overlay)/);
  await expect(viewer.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
});

test('export SVG downloads a standalone SVG', async ({ page }) => {
  await page.goto('docs/gallery/05-table-groups');
  const viewer = await settled(page.locator('.relvista-diagram').first());
  await viewer.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    viewer.getByRole('menuitem', { name: /SVG/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const svg = readFileSync((await download.path())!, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('merchants');
});

test('theme toggle switches the diagram colour mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('docs/gallery/01-minimal');
  const viewer = await settled(page.locator('.relvista-diagram').first());
  await expect(viewer).toHaveAttribute('data-rv-color-mode', 'light');
  const toggle = page.locator('.navbar').getByRole('button', { name: /dark|light|mode/i });
  for (let i = 0; i < 3; i++) {
    if ((await page.locator('html').getAttribute('data-theme')) === 'dark') break;
    await toggle.click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(viewer).toHaveAttribute('data-rv-color-mode', 'dark');
  // The canvas really changes colour, too: to the site's dark surfaces (the site palette).
  await expect(viewer).toHaveClass(/rv-palette-site/);
  const bg = await viewer.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = (bg.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
  const scale = bg.startsWith('color(') ? 255 : 1;
  expect(Math.max(r, g, b) * scale).toBeLessThan(60);
});

test('the navbar links to the editor, which is part of the build', async ({ page }) => {
  await page.goto('');
  const link = page.locator('.navbar').getByRole('link', { name: 'Editor', exact: true });
  await expect(link).toHaveAttribute('href', '/editor/');
  // Served by the editor's own e2e (`docusaurus serve` strips the folder's trailing slash).
  const index = join(process.cwd(), 'build', 'editor', 'index.html');
  expect(existsSync(index)).toBe(true);
  expect(readFileSync(index, 'utf8')).toContain('<title>relvista editor</title>');
});

test('gallery diagrams link to the editor with their DBML', async ({ page }) => {
  await page.goto('docs/gallery/01-minimal');
  const viewer = await settled(page.locator('.relvista-diagram').first());
  await expect(viewer.getByRole('link', { name: 'Open in editor' })).toHaveAttribute(
    'href',
    /^\/editor\/#dbml=[A-Za-z0-9_-]+/,
  );
});
