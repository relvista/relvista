import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Collects console errors and page errors (React and Monaco warnings excluded). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Opens the editor on a clean profile and waits until it is ready. */
export async function openEditor(page: Page, path = ''): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.ed-app[data-ready="true"]')).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
}

/** Focuses Monaco (clicks near the top-left of the text area, above any overlay). */
export async function focusEditor(page: Page): Promise<void> {
  await page
    .locator('.monaco-editor .view-lines')
    .first()
    .click({ position: { x: 30, y: 6 } });
}

/**
 * Pastes text at the end of the document: unlike typing, a paste is not changed by auto-closing
 * brackets or auto-indent. The paste event is synthetic, so parallel tests never race on the
 * system clipboard.
 */
export async function pasteAtEnd(page: Page, text: string): Promise<void> {
  await focusEditor(page);
  // End of document: Ctrl+End on Linux / Windows, Cmd+Down on macOS.
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

/**
 * Waits for the final layout, then for the picture to stand still: when ELK's result replaces the
 * first (sync) layout the canvas re-frames it with a short animation, and node boxes read during
 * that animation are stale. The layout stage is read again on every round, so a document that
 * arrives meanwhile is waited for too. Right after an open, `data-rv-layout` may still describe the
 * previous document: wait for the new one to be drawn first (see `openExampleFromMenu`).
 */
export async function diagramReady(page: Page): Promise<void> {
  await expect(page.locator('.rv-canvas[data-rv-layout="done"]')).toBeAttached();
  const snapshot = () =>
    page.evaluate(() => {
      const canvases = [...document.querySelectorAll<HTMLElement>('.rv-canvas')];
      const done = canvases.every((c) => c.dataset.rvLayout === 'done');
      const vp = document.querySelector<HTMLElement>('.rv-canvas .react-flow__viewport');
      const nodes = [...document.querySelectorAll<HTMLElement>('.rv-canvas .react-flow__node')];
      const picture = `${vp?.style.transform ?? ''}|${nodes.map((n) => n.style.transform).join(';')}`;
      return { done, picture };
    });
  let last = await snapshot();
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(150);
        const next = await snapshot();
        const still = next.done && last.done && next.picture === last.picture;
        last = next;
        return still;
      },
      { intervals: [0] },
    )
    .toBe(true);
}

/** The ids of the nodes drawn, in order. */
function drawnNodes(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.rv-canvas .react-flow__node')]
      .map((n) => n.dataset.id)
      .join(','),
  );
}

/**
 * Opens an example through New ▸ From example ▸ `name`, then waits for its final layout. Examples
 * load asynchronously and, on a busy machine, ELK takes seconds for the large ones: the wait
 * starts once the example's own tables are drawn, so the finished layout of the document shown
 * before is never taken for the example's. For an example other than the one shown.
 */
export async function openExampleFromMenu(page: Page, name: RegExp): Promise<void> {
  const before = await drawnNodes(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From example' }).click();
  await page.getByRole('menuitem', { name }).click();
  await expect.poll(() => drawnNodes(page)).not.toBe(before);
  await diagramReady(page);
}

/** Runs an Export menu item (and submenu item) and returns the downloaded bytes. */
export async function exportItem(page: Page, name: RegExp, sub?: RegExp): Promise<Buffer> {
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name }).click();
  if (sub) await page.getByRole('menuitem', { name: sub }).click();
  return readFileSync((await (await download).path())!);
}

/** The entry file's text as Save would write it (Export ▸ DBML file). */
export async function documentText(page: Page): Promise<string> {
  return (await exportItem(page, /DBML file/)).toString('utf8');
}

/** Opens an example through New ▸ From example ▸ Browse all examples… */
export async function openExampleFromPicker(page: Page, title: string): Promise<void> {
  const name = page.locator('.ed-filename__name');
  const before = (await name.count()) ? await name.textContent() : null;
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From example' }).click();
  await page.getByRole('menuitem', { name: /Browse all examples/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Open an example' });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('.ed-example')
    .filter({ has: page.locator('.ed-example__title', { hasText: new RegExp(`^${title}$`) }) })
    .click();
  await expect(dialog).toBeHidden();
  // Examples load asynchronously: wait for the document to change.
  if (before) await expect(name).not.toHaveText(before);
}

/**
 * True when the e2e server is the combined Pages site (docs + editor), false for `vite preview`
 * of the editor alone (RELVISTA_EDITOR_E2E_SERVER=preview).
 */
export const combinedSite = process.env.RELVISTA_EDITOR_E2E_SERVER !== 'preview';

/** Skips the calling test unless the docs site is served next to the editor. */
export function needsDocsSite(): void {
  test.skip(!combinedSite, 'needs the combined docs + editor build (pnpm docs:build)');
}
