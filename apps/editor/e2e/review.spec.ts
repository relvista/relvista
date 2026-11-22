/** Regression tests for the phase-2 review findings (zoom, sessions, saving, top bar, keyboard). */
import { expect, test, type Page } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { installFsMock } from './fsMock.js';
import { diagramReady, documentText, focusEditor, openEditor, pasteAtEnd } from './helpers.js';

async function openExample(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From example' }).click();
  await page.getByRole('menuitem', { name }).click();
}

function scaleOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('.rv-canvas .react-flow__viewport')!.style
      .transform;
    return Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? 'NaN');
  });
}

const transformOf = (page: Page) =>
  page
    .locator('.rv-canvas .react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform);

const numbersOf = (transform: string): number[] =>
  (transform.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);

const paused = (page: Page) => page.getByText('autosave is paused here');

test('examples open at a readable zoom, not fitted to specks', async ({ page }) => {
  await openEditor(page);
  // Big diagrams open readable; small ones (review round 3) may fit down to the floor (0.45 for
  // up to 12 tables, 0.55 above) rather than hide tables.
  for (const [name, min] of [
    [/Large SaaS/, 0.84],
    [/Table groups/, 0.45],
    [/E-commerce/, 0.55],
  ] as const) {
    await openExample(page, name);
    await diagramReady(page);
    expect(await scaleOf(page), String(name)).toBeGreaterThanOrEqual(min);
  }
});

test('reload restores the viewport and the Arranging chip goes away', async ({ page }) => {
  await openEditor(page);
  await openExample(page, /E-commerce/);
  await diagramReady(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await diagramReady(page);
  const before = await transformOf(page);
  await page.waitForTimeout(800); // autosave debounce after the zoom
  await page.reload();
  await expect(page.locator('.ed-app[data-ready="true"]')).toBeVisible();
  await diagramReady(page);
  // The layout file stores x/y to 2 decimals and zoom to 4 significant digits (core round2 /
  // roundZoom), so the restored viewport matches to that precision, not to the last digit.
  const after = numbersOf(await transformOf(page));
  numbersOf(before).forEach((n, i) => expect(after[i]).toBeCloseTo(n, 2));
  await expect(page.getByText('Arranging…')).toHaveCount(0);
});

test('exactly one tab autosaves; another takes over when it closes', async ({ context }) => {
  const one = await context.newPage();
  await openEditor(one);
  const two = await context.newPage();
  await openEditor(two);
  await expect(paused(two)).toBeVisible();
  await expect(paused(one)).toHaveCount(0);
  // Reloading the autosaving tab hands autosave to the other one; never both paused.
  await one.reload();
  await expect(one.locator('.ed-app[data-ready="true"]')).toBeVisible();
  await expect(paused(one)).toBeVisible();
  await expect(paused(two)).toHaveCount(0);
  await two.close();
  await expect(paused(one)).toHaveCount(0);
});

test('replacing unsaved work asks first, and the work can be restored', async ({ page }) => {
  await openEditor(page);
  await pasteAtEnd(page, 'Table keep_me {\n  id int\n}\n');
  await diagramReady(page);
  await openExample(page, /Minimal/);
  await expect(page.getByRole('dialog', { name: 'Replace the open document?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.react-flow__node[data-id="public.keep_me"]')).toBeVisible();

  // Typed right before the open (within the autosave debounce) is kept too.
  await pasteAtEnd(page, 'Table late {\n  id int\n}\n');
  await openExample(page, /Minimal/);
  await page.getByRole('button', { name: 'Open anyway' }).click();
  await expect(page.locator('.ed-filename__name')).toHaveText('01-minimal.dbml');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  const restore = page.getByRole('menuitem', { name: 'Restore previous session' });
  await expect(restore).not.toHaveAttribute('aria-disabled', 'true');
  await restore.click();
  await expect(page.locator('.react-flow__node[data-id="public.keep_me"]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="public.late"]')).toBeVisible();
});

test('a share link opened in a tab that already runs the editor opens', async ({ page }) => {
  await openEditor(page);
  const text = 'Table shared_here {\n  id int\n}\n';
  const b64 = deflateRawSync(Buffer.from(text)).toString('base64url');
  await page.goto(`#dbml=${b64}`);
  await expect(page.locator('.react-flow__node[data-id="public.shared_here"]')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(await documentText(page)).toBe(text);
});

test('a share link that inflates past 5 MB is refused', async ({ page }) => {
  const b64 = deflateRawSync(Buffer.from('Table t { id int }\n'.repeat(400_000))).toString(
    'base64url',
  );
  await openEditor(page, `#dbml=${b64}`);
  await expect(page.getByText(/more than 5\.0 MB of text/)).toBeVisible();
  await expect(page.locator('.ed-filename__name')).toHaveText('Untitled.dbml');
});

test('Enter after a complete column name starts a new line', async ({ page }) => {
  await openEditor(page);
  await pasteAtEnd(page, 'Table users {\n  id int\n}\n\nTable orders {\n  user_id int\n}\n');
  await diagramReady(page);
  await focusEditor(page);
  // End of line 6 (`  user_id int`).
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.type(' [ref: > users.id');
  await expect(page.locator('.suggest-widget.visible')).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await documentText(page)).toContain('users.id\n');
});

for (const width of [780, 800, 900, 1000, 1100, 1180, 1360]) {
  test(`top bar at ${width}px: nothing overlaps or overflows`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    await openExample(page, /Large SaaS/);
    await diagramReady(page);
    const boxes = await page.evaluate(() => {
      const bar = document.querySelector('.ed-topbar')!;
      const items = [
        ...bar.querySelectorAll(
          ':scope > .ed-logo, :scope > .ed-filename, .ed-topbar__menus > *, .ed-topbar__end > *',
        ),
      ]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0);
      return {
        items: items.map((r) => [r.left, r.right]),
        scroll: bar.scrollWidth - bar.clientWidth,
      };
    });
    expect(boxes.scroll).toBeLessThanOrEqual(0);
    const sorted = [...boxes.items].sort((a, b) => a[0]! - b[0]!);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i]![0]!, `item ${i} at ${width}px`).toBeGreaterThanOrEqual(
        sorted[i - 1]![1]! - 0.5,
      );
    expect(sorted[sorted.length - 1]![1]!).toBeLessThanOrEqual(width);
  });
}

test('Esc in the node menu gives focus back to the node', async ({ page }) => {
  await openEditor(page);
  await openExample(page, /E-commerce/);
  await diagramReady(page);
  await page.keyboard.press('Alt+2');
  await expect(page.locator('.react-flow__node:focus')).toHaveCount(1);
  const id = await page.locator('.react-flow__node:focus').getAttribute('data-id');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Reveal in code' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeFocused();
});

test('Save of an edited folder example asks for a folder and writes every file', async ({
  page,
}) => {
  await page.addInitScript(installFsMock, 'fsa');
  await openEditor(page);
  await openExample(page, /Modules/);
  await diagramReady(page);
  await page.getByRole('tab', { name: /users\.dbml/ }).click();
  await pasteAtEnd(page, '\n// edited\n');
  await expect(page.getByRole('tab', { name: /users\.dbml/ })).toContainText('●');
  await page.evaluate(() => (window.__fsMock.nextDirectory = 'out'));
  await page.keyboard.press('ControlOrMeta+s');
  await expect
    .poll(() => page.evaluate(() => [...window.__fsMock.writes].sort()))
    .toEqual(
      expect.arrayContaining([
        'out/main.dbml',
        'out/auth.dbml',
        'out/billing.dbml',
        'out/common/index.dbml',
        'out/common/orders.dbml',
        'out/common/users.dbml',
      ]),
    );
  const users = await page.evaluate(() => window.__fsMock.get('out/common/users.dbml'));
  expect(Buffer.from(users!).toString('utf8')).toContain('// edited');
  await expect(page.locator('.ed-filename__dot')).toHaveCount(0);
  await expect(page.locator('.ed-filename__name')).toHaveText('main.dbml');
});

// --- review round 2: startup opens never overwrite the autosaved session ----------------------

const shareLink = (text: string) =>
  `#dbml=${deflateRawSync(Buffer.from(text)).toString('base64url')}`;

/** Types unsaved untitled work and waits for it to be autosaved. */
async function precious(page: Page): Promise<void> {
  await openEditor(page);
  await pasteAtEnd(page, 'Table precious {\n  id int\n}\n');
  await diagramReady(page);
  await page.waitForTimeout(800); // autosave debounce
}

async function restorePrevious(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  const restore = page.getByRole('menuitem', { name: 'Restore previous session' });
  await expect(restore).not.toHaveAttribute('aria-disabled', 'true');
  await restore.click();
  await expect(page.locator('.react-flow__node[data-id="public.precious"]')).toBeVisible();
}

test('a share link in a fresh tab keeps the autosaved work as the previous session', async ({
  context,
}) => {
  const first = await context.newPage();
  await precious(first);
  await first.close();
  const page = await context.newPage();
  await openEditor(page, shareLink('Table shared {\n  id int\n}\n'));
  await expect(page.locator('.react-flow__node[data-id="public.shared"]')).toBeVisible();
  await expect(page.getByText('Open → Restore previous session')).toBeVisible();
  await restorePrevious(page);
});

test('a ?url= link in a fresh tab keeps the autosaved work as the previous session', async ({
  context,
}) => {
  const first = await context.newPage();
  await precious(first);
  await first.close();
  const page = await context.newPage();
  await page.route('https://example.test/remote.dbml', (r) =>
    r.fulfill({
      body: 'Table remote {\n  id int\n}\n',
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await page.route('https://example.test/remote.dbml.layout.json', (r) =>
    r.fulfill({ status: 404 }),
  );
  await openEditor(page, `?url=${encodeURIComponent('https://example.test/remote.dbml')}`);
  await expect(page.locator('.react-flow__node[data-id="public.remote"]')).toBeVisible();
  await restorePrevious(page);
});

test('a paused tab taking over autosave keeps the other tab’s work as previous', async ({
  context,
}) => {
  const one = await context.newPage();
  await precious(one);
  const two = await context.newPage();
  await openEditor(two, shareLink('Table shared {\n  id int\n}\n'));
  await expect(
    two.getByText('The editor is open in another tab — autosave is paused here.'),
  ).toBeVisible();
  await one.close();
  await expect(paused(two)).toHaveCount(0);
  await two.waitForTimeout(800); // the missed autosave runs
  await restorePrevious(two);
});
