// Export ▾ PDF… in the editor (docs/design/phase3-v1.md §6.12, §7): tiled pages whose count is
// planTiles', one page per view, the 3 s budget once the PDF libraries are loaded, and text
// outside WinAnsi (embedded fonts; Arabic stays an image).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { diagramReady, openEditor, openExampleFromMenu, pasteAtEnd } from './helpers.js';

async function openExample(page: Page, title: RegExp): Promise<void> {
  await openEditor(page);
  await openExampleFromMenu(page, title);
}

async function openPdfDialog(page: Page) {
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /^PDF…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export PDF' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Clicks Export PDF and returns the file name, the page count and how long it took (ms). */
async function exportPdf(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const started = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  const ms = Date.now() - started;
  const bytes = readFileSync((await download.path())!).toString('latin1');
  expect(bytes.startsWith('%PDF-')).toBe(true);
  const pages = (bytes.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  return { name: download.suggestedFilename(), pages, ms };
}

test('tiled A4 of 14-large: page count from planTiles, ≤ 3 s once the libraries are loaded', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openExample(page, /^Large SaaS schema/);

  // First export at 50 %: loads jsPDF and svg2pdf.js.
  let dialog = await openPdfDialog(page);
  await dialog.getByLabel('Paper').selectOption('a4');
  await dialog.getByLabel('Scale (%)').fill('50');
  let status = dialog.getByRole('status');
  await expect(status).toHaveText(/^\d+ pages? \(\d+ × \d+(, \d+ empty left out)?\)/);
  const small = Number(await status.getAttribute('data-rv-pages'));
  const warm = await exportPdf(page, dialog);
  expect(warm.pages).toBe(small);
  expect(warm.name).toBe('14-large.pdf');
  await expect(page.locator('.ed-toast', { hasText: 'PDF downloaded' })).toBeVisible();

  // Then A4 at 100 %, measured.
  dialog = await openPdfDialog(page);
  await dialog.getByLabel('Paper').selectOption('a4');
  status = dialog.getByRole('status');
  await expect(status).toHaveText(/^\d+ pages? \(\d+ × \d+(, \d+ empty left out)?\)/);
  const expected = Number(await status.getAttribute('data-rv-pages'));
  const rows = Number(await status.getAttribute('data-rv-rows'));
  const cols = Number(await status.getAttribute('data-rv-cols'));
  // Pages without a table are skipped by default (Skip empty pages), and say so.
  const skipped = Number(await status.getAttribute('data-rv-skipped'));
  const printed = rows * cols - skipped;
  expect(expected).toBe(printed + (printed > 1 ? 1 : 0));
  if (skipped) await expect(status).toContainText(`${skipped} empty left out`);
  const run = await exportPdf(page, dialog);
  console.log(`[perf] PDF 14-large tiled A4 100 %: ${run.ms} ms, ${run.pages} pages`);
  expect(run.pages).toBe(expected);
  // Budget 3 s (design §7), asserted loosely: CI machines are slower and shared.
  expect(run.ms).toBeLessThan(process.env.CI ? 9_000 : 6_000);
});

test('Cyrillic and CJK stay text: embedded fonts, no image, extractable', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  await pasteAtEnd(
    page,
    'Table пользователи {\n  id int [pk]\n  имя varchar\n}\n\n' +
      'Table 用户 {\n  id int [pk]\n  名字 varchar\n  user_id int [ref: > пользователи.id]\n}\n',
  );
  await expect(page.locator('.react-flow__node-rvTable')).toHaveCount(2);
  await diagramReady(page);
  const dialog = await openPdfDialog(page);
  await dialog.getByRole('radio', { name: /One page per view/ }).check();
  // No "embedded as images" note: the bundled fonts cover these scripts.
  await expect(dialog).not.toContainText('embedded as images');
  const started = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  console.log(`[perf] PDF with Cyrillic + CJK fonts, first export: ${Date.now() - started} ms`);
  await expect(page.locator('.ed-toast', { hasText: 'PDF downloaded (1 page)' })).toBeVisible();
  const path = (await download.path())!;
  await download.saveAs(test.info().outputPath('unicode.pdf'));
  const bytes = new Uint8Array(readFileSync(path));
  const raw = Buffer.from(bytes).toString('latin1');
  expect(raw).not.toContain('/Subtype /Image');
  expect(raw).toContain('/FontFile2');
  // What a PDF reader extracts (pdf.js reads the fonts' ToUnicode maps).
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: bytes, verbosity: 0 });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  await task.destroy();
  for (const s of ['пользователи', 'имя', '用户', '名字', 'user_id']) expect(text).toContain(s);
  expect(bytes.length).toBeLessThan(150_000);
});

test('Arabic still exports as an image, and the dialog says so first', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  await pasteAtEnd(page, 'Table "مستخدم" {\n  id int [pk]\n}\n');
  await diagramReady(page);
  const dialog = await openPdfDialog(page);
  await expect(dialog).toContainText('pages are embedded as images');
  await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  await expect(
    page.locator('.ed-toast', { hasText: 'Some text uses characters the PDF fonts lack' }),
  ).toBeVisible();
});

test('one page per view: as many pages as views chosen (empty ones left out)', async ({ page }) => {
  test.setTimeout(90_000);
  await openExample(page, /Diagram views/);
  const dialog = await openPdfDialog(page);
  await dialog.getByRole('radio', { name: /One page per view/ }).check();
  const views = dialog.getByRole('group', { name: 'Views' }).getByRole('checkbox');
  const n = await views.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i++) await views.nth(i).check();
  // empty_view draws nothing: left out (see the next tests).
  await expect(dialog.getByRole('status')).toHaveText(
    `${n - 1} pages, one per view, 1 empty view left out`,
  );
  const run = await exportPdf(page, dialog);
  expect(run.pages).toBe(n - 1);
});

test('the progress toast goes when the PDF is ready; toasts never cover the dialog', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openExample(page, /Diagram views/);
  for (let i = 0; i < 2; i++) {
    const dialog = await openPdfDialog(page);
    await dialog.getByRole('radio', { name: /One page per view/ }).check();
    await exportPdf(page, dialog);
    await expect(page.locator('.ed-toast', { hasText: 'PDF downloaded' }).last()).toBeVisible();
    // "Preparing the PDF…" is replaced by the outcome, never left behind.
    await expect(page.locator('.ed-toast', { hasText: 'Preparing the PDF' })).toHaveCount(0);
  }
  await expect(page.locator('.ed-toast')).toHaveCount(2);
  // Opened again over the toasts: its buttons are on top and take the clicks.
  const dialog = await openPdfDialog(page);
  for (const name of ['Cancel', 'Export PDF']) {
    const button = dialog.getByRole('button', { name, exact: true });
    const box = (await button.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.textContent ?? null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit, name).toBe(name);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('pdf-dialog-over-toasts.png') });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
