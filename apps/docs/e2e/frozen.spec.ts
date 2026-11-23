// Frozen diagrams (docs/decisions/0007-frozen-diagrams.md): docs diagrams start locked (dragging a
// table pans, a group's header does not collapse it, everything else works), the toolbar's lock
// button unlocks them and puts the author's arrangement back, and `frozen=false` opts out.
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Waits until a diagram has its final layout and returns its viewer root. */
async function settled(diagram: Locator): Promise<Locator> {
  await diagram.scrollIntoViewIfNeeded();
  const viewer = diagram.locator('.rv-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-rv-layout', 'done');
  // The static layer goes once the canvas has its final layout.
  await expect(diagram.locator('.relvista-static')).toBeHidden();
  return viewer;
}

async function openGroups(page: Page): Promise<Locator> {
  await page.goto('docs/gallery/05-table-groups');
  const viewer = await settled(page.locator('.relvista-diagram').first());
  // The first view's animations.
  await page.waitForTimeout(300);
  return viewer;
}

const node = (viewer: Locator, id: string) => viewer.locator(`.react-flow__node[data-id="${id}"]`);

/** A node's position in diagram coordinates (its React Flow transform), whatever the viewport. */
function world(viewer: Locator, id: string): Promise<{ x: number; y: number }> {
  return node(viewer, id).evaluate((el) => {
    const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
      (el as HTMLElement).style.transform,
    );
    return { x: Number(m![1]), y: Number(m![2]) };
  });
}

/** The pan and zoom shown (React Flow's viewport transform). */
function viewport(viewer: Locator): Promise<string> {
  return viewer
    .locator('.react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform);
}

/** Presses a table's header band and drags it by (dx, dy) screen px. */
async function dragHeader(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 30 + dx, box.y + 12 + dy, { steps: 8 });
  await page.mouse.up();
}

/** Double-clicks a group's header band. */
async function dblclickGroup(viewer: Locator, id: string): Promise<void> {
  await node(viewer, id).dblclick({ position: { x: 30, y: 8 } });
}

const collapsedCards = (viewer: Locator) => viewer.locator('.react-flow__node[data-rv-collapsed]');

test('a docs diagram is frozen: tables stay put, groups stay open; pan, zoom and search work', async ({
  page,
}) => {
  const viewer = await openGroups(page);
  await expect(viewer.locator('.rv-canvas')).toHaveAttribute('data-rv-locked', 'true');
  const lock = viewer.getByRole('button', { name: 'Unlock layout' });
  await expect(lock).toHaveAttribute('aria-pressed', 'true');

  // Dragging a table's header pans the diagram instead of moving the table.
  const products = node(viewer, 'public.products');
  const at = await world(viewer, 'public.products');
  const vp = await viewport(viewer);
  await dragHeader(page, products, 120, 70);
  expect(await world(viewer, 'public.products')).toEqual(at);
  await expect.poll(() => viewport(viewer)).not.toBe(vp);
  // The arrow keys do not move a focused table either.
  await products.focus();
  for (const key of ['ArrowRight', 'ArrowDown', 'Shift+ArrowLeft']) await page.keyboard.press(key);
  expect(await world(viewer, 'public.products')).toEqual(at);

  // Double-clicking a group's header does not collapse it.
  await viewer.getByRole('button', { name: 'Fit to view' }).click();
  await page.waitForTimeout(400);
  await dblclickGroup(viewer, 'group:catalog');
  await page.waitForTimeout(200);
  await expect(collapsedCards(viewer)).toHaveCount(0);
  await expect(node(viewer, 'public.orders')).toHaveCount(1);

  // Zoom (button and wheel) still works.
  const fitted = await viewport(viewer);
  await viewer.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => viewport(viewer)).not.toBe(fitted);
  const zoomed = await viewport(viewer);
  const canvas = (await viewer.locator('.rv-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => viewport(viewer)).not.toBe(zoomed);

  // Search highlights its hits.
  await viewer.getByRole('button', { name: 'Search' }).click();
  await viewer.getByRole('combobox', { name: 'Search' }).fill('invoice');
  await expect(node(viewer, 'billing.invoices').locator('.rv-table')).toHaveAttribute(
    'data-rv-tone',
    'match',
  );
  expect(await world(viewer, 'public.products')).toEqual(at);
});

test('the lock button unlocks: tables drag, groups collapse; locking again puts them back', async ({
  page,
}) => {
  const viewer = await openGroups(page);
  const at = await world(viewer, 'public.products');
  await viewer.getByRole('button', { name: 'Unlock layout' }).click();
  const lock = viewer.getByRole('button', { name: 'Lock layout' });
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await expect(viewer.locator('.rv-canvas')).not.toHaveAttribute('data-rv-locked', /.*/);

  // A group collapses into one card…
  await dblclickGroup(viewer, 'group:people');
  await expect(collapsedCards(viewer)).toHaveCount(1);
  await expect(node(viewer, 'public.users')).toHaveCount(0);
  // …and a table moves.
  const vp = await viewport(viewer);
  await dragHeader(page, node(viewer, 'public.products'), 120, 70);
  await expect.poll(() => world(viewer, 'public.products')).not.toEqual(at);
  // Dragging a table does not pan.
  expect(await viewport(viewer)).toBe(vp);

  // Locked again: the author's arrangement, the viewport where it was.
  await lock.click();
  await expect(viewer.getByRole('button', { name: 'Unlock layout' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(viewer.locator('.rv-canvas')).toHaveAttribute('data-rv-locked', 'true');
  await expect.poll(() => world(viewer, 'public.products')).toEqual(at);
  await expect(collapsedCards(viewer)).toHaveCount(0);
  await expect(node(viewer, 'public.users')).toHaveCount(1);
  expect(await viewport(viewer)).toBe(vp);
});

test('a frozen=false diagram drags right away and has no lock button', async ({ page }) => {
  await page.goto('docs/usage');
  const diagram = page.locator('.relvista-diagram#not-frozen');
  const viewer = await settled(diagram);
  await page.waitForTimeout(300);
  await expect(viewer.locator('.rv-toolbar')).toBeVisible();
  await expect(viewer.getByRole('button', { name: /^(Unlock|Lock) layout$/ })).toHaveCount(0);
  await expect(viewer.locator('.rv-canvas')).not.toHaveAttribute('data-rv-locked', /.*/);
  const at = await world(viewer, 'public.users');
  await dragHeader(page, node(viewer, 'public.users'), 80, 40);
  await expect.poll(() => world(viewer, 'public.users')).not.toEqual(at);
  // The other diagrams of the page are frozen.
  await expect(
    page.locator('.relvista-diagram .rv-canvas[data-rv-locked="true"]').first(),
  ).toBeAttached();
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  /** A one-finger drag from the middle of a table's header (Chromium touch events, as on a phone). */
  async function touchDrag(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
    const box = (await target.boundingBox())!;
    const [x, y] = [box.x + 30, box.y + 12];
    const cdp = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: Array<{ x: number; y: number }>,
    ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await touch('touchStart', [{ x, y }]);
    for (let i = 1; i <= 8; i++)
      await touch('touchMove', [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }]);
    await touch('touchEnd', []);
    await cdp.detach();
  }

  test('a finger moves a table only once the layout is unlocked', async ({ page }) => {
    const viewer = await openGroups(page);
    const at = await world(viewer, 'public.products');
    await touchDrag(page, node(viewer, 'public.products'), 100, 60);
    await page.waitForTimeout(200);
    expect(await world(viewer, 'public.products')).toEqual(at);
    await viewer.getByRole('button', { name: 'Unlock layout' }).tap();
    await expect(viewer.getByRole('button', { name: 'Lock layout' })).toBeVisible();
    await touchDrag(page, node(viewer, 'public.products'), 100, 60);
    await expect.poll(() => world(viewer, 'public.products')).not.toEqual(at);
  });
});
