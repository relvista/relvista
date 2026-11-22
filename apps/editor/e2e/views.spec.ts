/**
 * The views manager (design phase3 §6.7): New view from selection, Edit view… (rename, contents),
 * Delete view…, the searchable switcher; the DiagramView blocks and the layout views follow.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { EXAMPLES_DIR } from './fixtures.js';
import { installFsMock } from './fsMock.js';
import { diagramReady, documentText, openEditor } from './helpers.js';

const VIEWS = readFileSync(join(EXAMPLES_DIR, '08-diagram-views.dbml'), 'utf8');

interface SavedLayout {
  views: Record<string, { nodes: Record<string, { x?: number; y?: number }> }>;
}

async function openDoc(page: Page, text: string): Promise<void> {
  await page.addInitScript(installFsMock, 'fsa');
  await openEditor(page);
  await page.evaluate((t) => {
    window.__fsMock.put('p/main.dbml', t);
    window.__fsMock.nextDirectory = 'p';
  }, text);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('menuitem', { name: /Open folder/ }).click();
  await expect(page.locator('.ed-filename__name')).toHaveText('main.dbml');
  await diagramReady(page);
}

async function saved(page: Page): Promise<SavedLayout> {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.ed-filename__dot')).toHaveCount(0);
  const bytes = await page.evaluate(() => window.__fsMock.get('p/main.dbml.layout.json'));
  expect(bytes).not.toBeNull();
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes!))) as SavedLayout;
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const viewButton = (page: Page) => page.getByRole('button', { name: /^View: / });

async function axe(page: Page): Promise<void> {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('.monaco-editor')
    .analyze();
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

/** The text of `DiagramView <name> { … }`, or null. */
function block(dbml: string, name: string): string | null {
  const m = new RegExp(`DiagramView ${name} \\{[\\s\\S]*?\\n\\}`).exec(dbml);
  return m ? m[0] : null;
}

test('new view from selection, edit, rename, delete: DBML and layout views follow', async ({
  page,
}) => {
  await openDoc(page, VIEWS);
  await node(page, 'public.users').click({ position: { x: 30, y: 10 } });
  await node(page, 'public.orders').click({ position: { x: 30, y: 10 }, modifiers: ['Shift'] });
  await viewButton(page).click();
  await page.getByRole('menuitem', { name: /New view from selection/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New view' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Name')).toHaveValue('view_1');
  await expect(dialog.getByRole('checkbox', { name: 'users', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'orders', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'products', exact: true })).not.toBeChecked();
  await axe(page); // the view dialog open
  await dialog.getByRole('button', { name: 'Create view' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'View: view_1' })).toBeVisible();
  await expect(page.locator('.rv-canvas .react-flow__node[data-id^="public."]')).toHaveCount(2);
  let dbml = await documentText(page);
  expect(dbml.startsWith(VIEWS.trimEnd())).toBe(true);
  expect(block(dbml, 'view_1')).toMatch(/Tables \{\s*users\s+orders\s*\}/);

  // A drag in the new view gives it a layout entry.
  await diagramReady(page);
  const users = node(page, 'public.users');
  const b = (await users.boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 90, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.ed-filename__dot')).toBeVisible();
  expect(Object.keys((await saved(page)).views)).toContain('view_1');

  // Edit view…: rename and add a table.
  await viewButton(page).click();
  await page.getByRole('menuitem', { name: 'Edit view…' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit view view_1' });
  await edit.getByLabel('Name').fill('picked');
  await edit.getByRole('checkbox', { name: 'products', exact: true }).check();
  await edit.getByRole('button', { name: 'Save view' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('button', { name: 'View: picked' })).toBeVisible();
  await expect(page.locator('.rv-canvas .react-flow__node[data-id^="public."]')).toHaveCount(3);
  dbml = await documentText(page);
  expect(block(dbml, 'view_1')).toBeNull();
  expect(block(dbml, 'picked')).toMatch(/products/);
  let layout = await saved(page);
  expect(Object.keys(layout.views)).toContain('picked');
  expect(Object.keys(layout.views)).not.toContain('view_1');

  // A bad name is refused in the dialog.
  await viewButton(page).click();
  await page.getByRole('menuitem', { name: 'Edit view…' }).click();
  const again = page.getByRole('dialog', { name: 'Edit view picked' });
  await again.getByLabel('Name').fill('sales_view');
  await again.getByRole('button', { name: 'Save view' }).click();
  await expect(again.getByRole('alert')).toHaveText(/already exists/);
  await again.getByRole('button', { name: 'Cancel' }).click();

  // Delete view… asks, then removes the block and the layout entry; the switcher shows all.
  await viewButton(page).click();
  await page.getByRole('menuitem', { name: 'Delete view…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete the view picked?' });
  await confirm.getByRole('button', { name: 'Delete view' }).click();
  await expect(page.getByRole('button', { name: 'View: All tables' })).toBeVisible();
  dbml = await documentText(page);
  expect(dbml).toBe(VIEWS);
  layout = await saved(page);
  expect(Object.keys(layout.views)).not.toContain('picked');
});

test('node menu: Add to view ▸ and Remove from view', async ({ page }) => {
  await openDoc(page, VIEWS);
  await node(page, 'core.feature_flags').click({ button: 'right', position: { x: 30, y: 10 } });
  await page.getByRole('menuitem', { name: 'Add to view' }).click();
  await page.getByRole('menuitem', { name: 'sales_view' }).click();
  await expect
    .poll(async () => block(await documentText(page), 'sales_view'))
    .toMatch(/core\.feature_flags/);

  await viewButton(page).click();
  await page.getByRole('menuitemradio', { name: 'sales_view' }).click();
  await expect(node(page, 'core.feature_flags')).toBeVisible();
  await node(page, 'public.products').click({ button: 'right', position: { x: 30, y: 10 } });
  await page.getByRole('menuitem', { name: 'Remove from view' }).click();
  await expect(node(page, 'public.products')).toHaveCount(0);
  const sales = block(await documentText(page), 'sales_view')!;
  expect(sales).not.toMatch(/\bproducts\b/);
  expect(sales).toMatch(/order_items/);
});

test('the switcher filters once there are more than 7 views', async ({ page }) => {
  const views = Array.from(
    { length: 10 },
    (_, i) => `DiagramView team_${i} {\n  Tables { a }\n}\n`,
  );
  await openDoc(page, `Table a {\n  id int\n}\n\nTable b {\n  id int\n}\n\n${views.join('\n')}`);
  await viewButton(page).click();
  const filter = page.getByRole('searchbox', { name: 'Filter views' });
  await expect(filter).toBeFocused();
  await expect(page.getByRole('menuitemradio')).toHaveCount(11); // All tables + 10
  await filter.fill('team_7');
  await expect(page.getByRole('menuitemradio')).toHaveCount(1);
  await expect(page.getByRole('menuitemradio', { name: 'team_7' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'View: team_7' })).toBeVisible();
  await expect(page.locator('.rv-canvas .react-flow__node[data-id^="public."]')).toHaveCount(1);
  // Keyboard: ArrowDown from the filter reaches the list; Esc clears, then closes.
  await viewButton(page).click();
  await filter.fill('nothing');
  await expect(page.getByText('No view matches')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(filter).toHaveValue('');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'All tables' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(viewButton(page)).toBeFocused();
});

test('detail level per view: stored on the open view, applied when switching back', async ({
  page,
}) => {
  await openDoc(page, VIEWS);
  const rows = page.locator('.rv-canvas .rv-column');
  const detail = page.getByRole('radiogroup', { name: /Detail level/ });
  const checked = (name: 'Names' | 'Keys' | 'All') =>
    expect(detail.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
  const switchTo = async (name: string) => {
    await viewButton(page).click();
    await page.getByRole('menuitemradio', { name }).click();
    await expect(page.getByRole('button', { name: `View: ${name}` })).toBeVisible();
  };
  // The diagram-wide default: Keys.
  await detail.getByRole('radio', { name: 'Keys' }).click();
  await checked('Keys');
  // A view without its own level follows the default; Names is stored on that view only.
  await switchTo('sales_view');
  await checked('Keys');
  await expect.poll(() => rows.count()).toBeGreaterThan(0);
  await detail.getByRole('radio', { name: 'Names' }).click();
  await checked('Names');
  await expect.poll(() => rows.count()).toBe(0);
  await switchTo('All tables');
  await checked('Keys');
  await expect.poll(() => rows.count()).toBeGreaterThan(0);
  await switchTo('sales_view');
  await checked('Names');
  await expect.poll(() => rows.count()).toBe(0);
  let layout = (await saved(page)) as SavedLayout & { settings?: Record<string, unknown> };
  expect(layout.settings).toEqual({
    detailLevel: 'keys',
    'x-relvista-view-settings': { sales_view: { detailLevel: 'names' } },
  });

  // Renaming the view keeps its level.
  await viewButton(page).click();
  await page.getByRole('menuitem', { name: 'Edit view…' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit view sales_view' });
  await edit.getByLabel('Name').fill('sales');
  await edit.getByRole('button', { name: 'Save view' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('button', { name: 'View: sales' })).toBeVisible();
  await checked('Names');
  layout = (await saved(page)) as SavedLayout & { settings?: Record<string, unknown> };
  expect(layout.settings).toEqual({
    detailLevel: 'keys',
    'x-relvista-view-settings': { sales: { detailLevel: 'names' } },
  });

  // Picking the default's level again makes the view follow the default.
  await detail.getByRole('radio', { name: 'Keys' }).click();
  layout = (await saved(page)) as SavedLayout & { settings?: Record<string, unknown> };
  expect(layout.settings).toEqual({ detailLevel: 'keys' });
});
