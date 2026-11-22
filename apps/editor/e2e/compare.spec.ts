// Compare (schema diff) in the editor (docs/design/phase3-v1.md §6.11).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLES_DIR } from './fixtures.js';
import { diagramReady, exportItem, openEditor, pasteAtEnd } from './helpers.js';

const ECOMMERCE = readFileSync(join(EXAMPLES_DIR, '02-ecommerce.dbml'), 'utf8');

/**
 * An older version of 02-ecommerce: no `tags` table nor its `product_tags` ref (added since), an extra `wishlists` table
 * (removed since), and `users.email` was varchar(100) (changed since).
 */
function olderVersion(): string {
  const noTags = ECOMMERCE.replace(/\nTable tags \{[\s\S]*?\n\}\n/, '\n');
  if (noTags === ECOMMERCE) throw new Error('fixture: tags table not found');
  const noRef = noTags.replace(/\nRef product_tags:[^\n]*\n/, '\n');
  if (noRef === noTags) throw new Error('fixture: product_tags ref not found');
  const email = noRef.replace('email varchar(255)', 'email varchar(100)');
  if (email === noRef) throw new Error('fixture: users.email not found');
  return `${email}\nTable wishlists {\n  id integer [pk]\n  name varchar\n}\n`;
}

async function openEcommerce(page: Page): Promise<void> {
  await openEditor(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From example' }).click();
  await page.getByRole('menuitem', { name: /E-commerce/ }).click();
  await diagramReady(page);
}

async function compareWithPaste(page: Page, text: string): Promise<void> {
  await page.locator('.ed-filename').click();
  await page.keyboard.press('ControlOrMeta+Alt+KeyD');
  const dialog = page.getByRole('dialog', { name: 'Compare' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Paste' }).check();
  await dialog.getByLabel('DBML of the other version').fill(text);
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const table = (page: Page, id: string) =>
  page.locator(`.ed-diagram .react-flow__node[data-id="${id}"] .rv-table`);

test('paste an older schema: tones, Changes panel counts as formatDiff, code diff, Exit', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEcommerce(page);
  const other = olderVersion();
  await compareWithPaste(page, other);

  // Added / removed / changed tones on the canvas (other = before, the open document = after).
  await expect(table(page, 'public.tags')).toHaveAttribute('data-rv-tone', 'added');
  await expect(table(page, 'public.wishlists')).toHaveAttribute('data-rv-tone', 'removed');
  await expect(table(page, 'public.users')).toHaveAttribute('data-rv-tone', 'changed');
  await expect(
    page.locator(
      '.ed-diagram .react-flow__node[data-id="public.users"] .rv-column[data-rv-column="email"]',
    ),
  ).toHaveAttribute('data-rv-tone', 'changed');

  // The panel's counts are formatDiff's.
  const { compileDbml, diffModels, formatDiff } = await import('@relvista/core');
  const diff = diffModels(compileDbml(other).model!, compileDbml(ECOMMERCE).model!);
  const panel = page.getByRole('complementary', { name: 'Changes' });
  const summary = panel.getByRole('status');
  await expect(summary).toHaveText(formatDiff(diff).split('\n')[0]!);
  await expect(summary).toHaveAttribute('data-added', String(diff.summary.added));
  await expect(summary).toHaveAttribute('data-removed', String(diff.summary.removed));
  await expect(summary).toHaveAttribute('data-changed', String(diff.summary.changed));
  // The legend chip.
  await expect(page.getByRole('list', { name: 'Changes in this comparison' })).toContainText(
    `${diff.summary.added}`,
  );

  // Filters (one category at a time; All, or the shown one again, lists everything) and click → focus.
  const filter = (name: RegExp) =>
    panel.getByRole('group', { name: 'Show' }).getByRole('button', { name });
  await expect(filter(/^All/)).toHaveAttribute('aria-pressed', 'true');
  await filter(/Changed/).click();
  await expect(filter(/Changed/)).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(/^All/)).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('button', { name: /users/ }).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: /tags/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /wishlists/ })).toHaveCount(0);
  await filter(/Added/).click();
  await expect(panel.getByRole('button', { name: /tags/ }).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: /wishlists/ })).toHaveCount(0);
  await filter(/Added/).click();
  await expect(filter(/^All/)).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: /wishlists/ }).click();
  await expect(
    page.locator('.ed-diagram .react-flow__node[data-id="public.wishlists"] .rv-node'),
  ).toHaveClass(/rv-highlighted/);

  // Copy summary: Markdown from formatDiff. The text the page wrote is checked, not the system
  // clipboard: parallel tests share it, and Windows hands it back with CRLF line ends.
  await page.evaluate(() => {
    const clipboard = navigator.clipboard;
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = (text: string) => {
      (window as { relvistaCopied?: string }).relvistaCopied = text;
      return write(text);
    };
  });
  await panel.getByRole('button', { name: 'Copy summary' }).click();
  await expect(page.locator('.ed-toast', { hasText: 'Summary copied' })).toBeVisible();
  expect(await page.evaluate(() => (window as { relvistaCopied?: string }).relvistaCopied)).toBe(
    formatDiff(diff, { markdown: true }),
  );

  // Exports in compare mode carry the decorations.
  expect((await exportItem(page, /SVG/)).toString()).toContain('data-rv-tone="removed"');

  // The read-only diff editor toggles with the code editor.
  await panel.getByRole('button', { name: 'Code diff' }).click();
  const diffEditor = page.locator('.ed-codediff .monaco-diff-editor');
  await expect(diffEditor).toBeVisible();
  // Both sides: the other version (original) and the open document (modified).
  await expect(diffEditor.locator('.editor.original')).toBeAttached();
  await expect(diffEditor.locator('.editor.modified')).toBeAttached();
  await page.locator('.ed-codediff').getByRole('button', { name: 'Edit code' }).click();
  await expect(page.locator('.ed-codediff')).toHaveCount(0);

  // Live: editing the open document updates the diff.
  await pasteAtEnd(page, '\nTable brand_new {\n  id int\n}\n');
  await expect(table(page, 'public.brand_new')).toHaveAttribute('data-rv-tone', 'added');
  await expect(summary).toHaveAttribute('data-added', String(diff.summary.added + 1));

  // Exit (Esc on the diagram) restores the normal picture.
  await page.locator('.ed-diagram .react-flow__node[data-id="public.users"]').focus();
  await page.keyboard.press('Escape'); // the lit table
  await page.keyboard.press('Escape'); // compare mode
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.ed-diagram [data-rv-tone]')).toHaveCount(0);
  await expect(
    page.locator('.ed-diagram .react-flow__node[data-id="public.wishlists"]'),
  ).toHaveCount(0);
});

test('swap: the open document as the older side flips added and removed', async ({ page }) => {
  await openEcommerce(page);
  await compareWithPaste(page, olderVersion());
  const panel = page.getByRole('complementary', { name: 'Changes' });
  await panel.getByRole('button', { name: 'Swap before and after' }).click();
  await expect(table(page, 'public.tags')).toHaveAttribute('data-rv-tone', 'removed');
  await expect(table(page, 'public.wishlists')).toHaveAttribute('data-rv-tone', 'added');
  await panel.getByRole('button', { name: 'Exit compare' }).click();
  await expect(panel).toHaveCount(0);
});

test('URL source: a GitHub blob URL is fetched raw; errors stay in the dialog', async ({
  page,
}) => {
  const raw = 'https://raw.githubusercontent.com/o/r/main/old.dbml';
  await page.route('https://raw.githubusercontent.com/**', (r) =>
    r.request().url() === raw
      ? r.fulfill({ body: olderVersion(), headers: { 'access-control-allow-origin': '*' } })
      : r.fulfill({ status: 404, body: 'no', headers: { 'access-control-allow-origin': '*' } }),
  );
  await openEcommerce(page);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Compare/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare' });
  await dialog.getByRole('radio', { name: 'URL' }).check();
  await dialog.getByLabel('URL of a .dbml file').fill('https://github.com/o/r/blob/main/nope.dbml');
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('404');
  await dialog.getByLabel('URL of a .dbml file').fill('https://github.com/o/r/blob/main/old.dbml');
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(table(page, 'public.tags')).toHaveAttribute('data-rv-tone', 'added');
});

test('Git ref source: offered for a GitHub document, the ref segment is rewritten', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route('https://raw.githubusercontent.com/**', (r) => {
    requested.push(r.request().url());
    const body = r.request().url().includes('/v1/') ? olderVersion() : ECOMMERCE;
    return r.fulfill({ body, headers: { 'access-control-allow-origin': '*' } });
  });
  await openEditor(
    page,
    `?url=${encodeURIComponent('https://github.com/o/r/blob/main/db/schema.dbml')}`,
  );
  await diagramReady(page);
  await page.locator('.ed-filename').click();
  await page.keyboard.press('ControlOrMeta+Alt+KeyD');
  const dialog = page.getByRole('dialog', { name: 'Compare' });
  await expect(dialog.getByRole('radio', { name: 'Git ref' })).toBeChecked();
  await dialog.getByLabel('Branch, tag or commit').fill('v1');
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requested).toEqual([
    'https://raw.githubusercontent.com/o/r/main/db/schema.dbml',
    'https://raw.githubusercontent.com/o/r/v1/db/schema.dbml',
  ]);
  await expect(page.getByRole('complementary', { name: 'Changes' })).toContainText(
    'v1: schema.dbml',
  );
});
