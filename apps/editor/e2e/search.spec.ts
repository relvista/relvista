// Search, path, detail level and focus in the diagram pane (docs/design/phase3-v1.md §6.8, §6.9).
import { expect, test, type Page } from '@playwright/test';
import { exportItem, openEditor, openExampleFromMenu } from './helpers.js';

async function openLarge(page: Page): Promise<void> {
  await openEditor(page);
  await openExampleFromMenu(page, /^Large SaaS schema/);
}

const node = (page: Page, id: string) =>
  page.locator(`.rv-canvas .react-flow__node[data-id="${id}"]`);

test('Mod+K "invoice" → Enter: the table is centred, lit, focused and revealed in code', async ({
  page,
}) => {
  await openLarge(page);
  // Outside Monaco: the top bar has the focus.
  await page.locator('.ed-filename').click();
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.locator('.ed-diagram').getByRole('combobox', { name: 'Search' });
  await expect(input).toBeFocused();
  await input.fill('invoice');
  const first = page.locator('.ed-diagram .rv-nav-search').getByRole('option').first();
  await expect(first).toContainText('invoices');
  // Hits are toned while typing.
  await expect(node(page, 'public.invoices').locator('.rv-table')).toHaveAttribute(
    'data-rv-tone',
    'match',
  );
  await input.press('Enter');
  await expect(page.locator('.ed-diagram .rv-nav-search')).toHaveCount(0);
  const invoices = node(page, 'public.invoices');
  await expect(invoices.locator('.rv-node')).toHaveClass(/rv-highlighted/);
  await expect(invoices).toBeFocused();
  await page.waitForTimeout(500);
  const canvas = (await page.locator('.ed-diagram .rv-canvas').boundingBox())!;
  const box = (await invoices.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(60);
  expect(Math.abs(box.y + box.height / 2 - (canvas.y + canvas.height / 2))).toBeLessThan(60);
  // Revealed in code (the cursor on the table's line) without moving the keyboard focus.
  await expect(page.locator('.ed-status')).toContainText('Ln 167, Col 1');
  await expect(invoices).toBeFocused();
  // The URL mirrors the table.
  await expect.poll(() => new URL(page.url()).hash).toContain('table=invoices');
  // Esc clears the highlight.
  await page.keyboard.press('Escape');
  await expect(invoices.locator('.rv-node')).not.toHaveClass(/rv-highlighted/);
});

test('"/" on the diagram opens search; path mode lights two tables and the refs between', async ({
  page,
}) => {
  await openLarge(page);
  await page.getByRole('button', { name: 'Fit diagram' }).click();
  await page.locator('.ed-diagram .react-flow__pane').click({ position: { x: 20, y: 300 } });
  await page.keyboard.press('/');
  await expect(page.locator('.ed-diagram').getByRole('combobox', { name: 'Search' })).toBeFocused();
  await page.locator('.ed-diagram').getByRole('button', { name: 'Path' }).click();
  const from = page.locator('.ed-diagram').getByRole('combobox', { name: 'From' });
  await expect(from).toBeFocused();
  await from.fill('invoice_lines');
  await from.press('Enter');
  const to = page.locator('.ed-diagram').getByRole('combobox', { name: 'To' });
  await expect(to).toBeFocused();
  await to.fill('invoices');
  await to.press('Enter');
  const status = page.locator('.ed-diagram .rv-nav-status');
  await expect(status).toHaveText(/^invoice_lines → invoices, 1 ref$/);
  await expect(page.locator('.ed-diagram .rv-table[data-rv-tone="path"]')).toHaveCount(2);
  await expect(page.locator('.ed-diagram .react-flow__edge [data-rv-tone="path"]')).toHaveCount(1);
  // Esc closes the panel and clears the decorations.
  await to.press('Escape');
  await expect(page.locator('.ed-diagram .rv-nav-search')).toHaveCount(0);
  await expect(page.locator('.ed-diagram [data-rv-tone="path"]')).toHaveCount(0);
});

test('the pane magnifier opens search; Esc closes it and the dimming goes', async ({ page }) => {
  await openLarge(page);
  await page.locator('.ed-diagram').getByRole('button', { name: 'Search', exact: true }).click();
  const input = page.locator('.ed-diagram').getByRole('combobox', { name: 'Search' });
  await input.fill('user');
  await expect(page.locator('.ed-diagram .rv-table[data-rv-tone="match"]').first()).toBeVisible();
  await input.press('Escape');
  await expect(page.locator('.ed-diagram .rv-nav-search')).toHaveCount(0);
  await expect(page.locator('.ed-diagram [data-rv-tone="match"]')).toHaveCount(0);
});

test('detail switch and keys 1 / 2 / 3 write the layout once; undo restores', async ({ page }) => {
  await openLarge(page);
  const rows = page.locator('.ed-diagram .rv-column');
  const all = await rows.count();
  const detail = page.getByRole('radiogroup', { name: /Detail level/ });
  await detail.getByRole('radio', { name: 'Keys' }).click();
  await expect(detail.getByRole('radio', { name: 'Keys' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => rows.count()).toBeLessThan(all);
  const layout = JSON.parse((await exportItem(page, /Layout JSON/)).toString());
  expect(layout.settings?.detailLevel).toBe('keys');
  // Keys on the diagram: 1 = names (no rows at all).
  await page.locator('.ed-diagram .react-flow__pane').click({ position: { x: 20, y: 300 } });
  await page.keyboard.press('1');
  await expect(detail.getByRole('radio', { name: 'Names' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect.poll(() => rows.count()).toBe(0);
  await page.keyboard.press('3');
  await expect.poll(() => rows.count()).toBe(all);
  // 'all' removes the key.
  const back = JSON.parse((await exportItem(page, /Layout JSON/)).toString());
  expect(back.settings?.detailLevel).toBeUndefined();
  // Each change was one layout step.
  await page.locator('.ed-diagram .react-flow__pane').click({ position: { x: 20, y: 300 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(detail.getByRole('radio', { name: 'Names' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('search on a phone-width window: the panel spans the pane', async ({ page }) => {
  await openLarge(page);
  await page.setViewportSize({ width: 700, height: 800 });
  await page.locator('.ed-filename').click();
  await page.keyboard.press('ControlOrMeta+k');
  const panel = page.locator('.ed-diagram .rv-nav-search');
  await expect(panel).toBeVisible();
  const p = (await panel.boundingBox())!;
  const pane = (await page.locator('.ed-diagram').boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(pane.x);
  expect(p.x + p.width).toBeLessThanOrEqual(pane.x + pane.width + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(700);
});
