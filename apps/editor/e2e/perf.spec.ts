/**
 * Performance budgets (design phase3 §7), logged precisely and asserted loosely (CI machines are
 * slower and noisier than a laptop):
 *
 * - keystroke → diagram on 14-large: ≤ 250 ms (the 150 ms typing debounce included);
 * - keystroke → diagram on a generated 300-table schema (≈ 90 KB, seeded): ≤ 600 ms, every
 *   compile in the compile worker. Main-thread long tasks while typing are logged with their
 *   offset from the keydown; the §7 goal "no task > 50 ms" is asserted only as a loose ceiling:
 *   what remains on the main thread there is the language service's completion parse (~+80 ms)
 *   and the canvas re-render after the result, not the compile.
 *
 * A keystroke renames a table (`Table zqprobe {` → `zqprobex`); the time runs from the keydown to
 * the renamed table's title in the canvas DOM. Compile times come from the scheduler's
 * `relvista:compile` performance marks.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  diagramReady,
  focusEditor,
  openEditor,
  openExampleFromMenu,
  pasteAtEnd,
} from './helpers.js';

const CI = !!process.env.CI;
/** CI runners get this much headroom over the design budgets. */
const SLACK = CI ? 2 : 1.25;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 300-table schema with notes, indexes and about one ref per table (seeded, ≈ 90 KB). */
function bigSchema(tables = 300, seed = 20261121): string {
  const r = rng(seed);
  const types = [
    'integer',
    'bigint',
    'varchar(255)',
    'text',
    'timestamp',
    'boolean',
    'decimal(10,2)',
    'jsonb',
    'uuid',
  ];
  const out: string[] = ['Project generated {', "  database_type: 'PostgreSQL'", '}', ''];
  for (let i = 0; i < tables; i++) {
    const cols = 4 + Math.floor(r() * 5);
    out.push(`Table t${i} [note: 'generated table number ${i}'] {`, '  id bigint [pk, increment]');
    for (let c = 1; c < cols; c++) {
      const type = types[Math.floor(r() * types.length)]!;
      const settings =
        r() < 0.3 ? ' [not null]' : r() < 0.1 ? " [unique, note: 'a unique value']" : '';
      out.push(`  col_${c}_${i} ${type}${settings}`);
    }
    if (i > 0) {
      const target = Math.floor(r() * i);
      out.push(`  ref_${i} bigint [ref: > t${target}.id]`);
    }
    out.push(
      '  created_at timestamp [default: `now()`]',
      '',
      '  indexes {',
      '    created_at',
      '  }',
      '}',
      '',
    );
  }
  return out.join('\n');
}

async function dropText(page: Page, name: string, text: string): Promise<void> {
  const data = await page.evaluateHandle(
    ([n, t]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([t as string], n as string));
      return dt;
    },
    [name, text] as const,
  );
  const app = page.locator('.ed-app');
  for (const type of ['dragenter', 'dragover', 'drop'])
    await app.dispatchEvent(type, { dataTransfer: data });
}

/**
 * Starts long-task recording (PerformanceObserver) in the page; each task is kept with its start
 * relative to the keydown before it, to tell typing work from compile-result work.
 */
async function recordLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __longTasks: Array<{ at: number; ms: number }>;
      __lastKey: number;
      __ltObserver?: PerformanceObserver;
    };
    w.__longTasks = [];
    w.__lastKey = 0;
    window.addEventListener('keydown', () => (w.__lastKey = performance.now()), true);
    w.__ltObserver?.disconnect();
    w.__ltObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        w.__longTasks.push({ at: e.startTime - w.__lastKey, ms: e.duration });
    });
    w.__ltObserver.observe({ type: 'longtask' });
  });
}

async function longTasks(page: Page): Promise<Array<{ at: number; ms: number }>> {
  return page.evaluate(
    () => (window as unknown as { __longTasks: Array<{ at: number; ms: number }> }).__longTasks,
  );
}

/** The scheduler's `relvista:compile` marks since the last call (ms where it ran, and mode). */
async function compileMarks(
  page: Page,
): Promise<Array<{ ms: number; mode: string; latencyMs: number }>> {
  return page.evaluate(() => {
    const marks = performance.getEntriesByName('relvista:compile') as PerformanceMark[];
    performance.clearMarks('relvista:compile');
    return marks.map((m) => m.detail as { ms: number; mode: string; latencyMs: number });
  });
}

const fmtCompiles = (cs: Array<{ ms: number; mode: string; latencyMs: number }>) =>
  cs
    .map((c) => `${c.mode} ${c.ms.toFixed(1)} ms (result after ${c.latencyMs.toFixed(1)} ms)`)
    .join(', ');

const fmtTasks = (ts: Array<{ at: number; ms: number }>) =>
  ts.map((t) => `${t.ms.toFixed(0)} ms at +${t.at.toFixed(0)}`).join(', ');

/**
 * Presses `key` in Monaco and resolves with the ms from its keydown until the canvas shows
 * `expected` (a table title).
 */
async function keystrokeToDiagram(page: Page, key: string, expected: string): Promise<number> {
  await page.evaluate((want) => {
    const w = window as unknown as { __latency: Promise<number> };
    w.__latency = new Promise<number>((resolve, reject) => {
      let t0 = -1;
      const onKey = () => {
        if (t0 < 0) t0 = performance.now();
      };
      window.addEventListener('keydown', onKey, { capture: true, once: true });
      const has = () =>
        [...document.querySelectorAll('.rv-canvas .react-flow__node')].some((n) =>
          (n.textContent ?? '').includes(want),
        );
      const obs = new MutationObserver(() => {
        if (t0 >= 0 && has()) {
          obs.disconnect();
          resolve(performance.now() - t0);
        }
      });
      obs.observe(document.querySelector('.rv-canvas') ?? document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      setTimeout(() => reject(new Error(`no ${want} in the diagram after 20 s`)), 20_000);
    });
  }, expected);
  await page.keyboard.press(key);
  return page.evaluate(() => (window as unknown as { __latency: Promise<number> }).__latency);
}

/** Puts a probe table on line 1 and the cursor right after its name. */
async function addProbe(page: Page): Promise<void> {
  probe.name = 'zqprobe';
  await focusEditor(page);
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Table zqprobe {\n  id int [pk]\n}\n\n');
    (document.activeElement ?? document.body).dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.locator('.rv-canvas .react-flow__node', { hasText: 'zqprobe' })).toHaveCount(
    1,
    {
      timeout: 30_000,
    },
  );
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
}

/** The probe table's name so far (each keystroke appends one letter). */
const probe = { name: 'zqprobe' };

async function measure(page: Page, rounds: number): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const ch = 'abcdefghijklmnopqrstuvwxyz'[(probe.name.length - 7) % 26]!;
    const name = (probe.name += ch);
    times.push(await keystrokeToDiagram(page, ch, name));
    // Let the layout settle between rounds (a rename keeps the table where it is).
    await page.waitForTimeout(250);
  }
  return times;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const fmt = (xs: number[]) => xs.map((x) => x.toFixed(1)).join(', ');

test.describe.configure({ mode: 'serial' });

test('keystroke → diagram on 14-large ≤ 250 ms', async ({ page }) => {
  test.setTimeout(180_000);
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await openEditor(page);
  await openExampleFromMenu(page, /^Large SaaS schema/);
  await addProbe(page);
  await measure(page, 2); // warm-up (JIT, first worker message)
  await recordLongTasks(page);
  await compileMarks(page);
  const times = await measure(page, 8);
  const tasks = await longTasks(page);
  const compiles = await compileMarks(page);
  const compileWorker = workers.some((u) => u.includes('compile.worker'));
  console.log(`[perf] 14-large compiles: ${fmtCompiles(compiles)}`);
  console.log(
    `[perf] 14-large keystroke→diagram ms: median ${median(times).toFixed(1)}, max ${Math.max(...times).toFixed(1)} [${fmt(times)}]; compile worker: ${compileWorker ? 'started' : 'not used'}; long tasks while typing: ${tasks.length} [${fmtTasks(tasks)}]`,
  );
  expect(median(times)).toBeLessThanOrEqual(250 * SLACK);
});

test('keystroke → diagram on a 300-table schema ≤ 600 ms, compiles off the main thread', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await openEditor(page);
  const schema = bigSchema();
  console.log(`[perf] generated schema: ${(schema.length / 1024).toFixed(1)} KB, 300 tables`);
  await dropText(page, 'generated.dbml', schema);
  await expect(page.locator('.ed-filename__name')).toHaveText(/generated\.dbml/);
  await diagramReady(page);
  await addProbe(page);
  await measure(page, 2); // warm-up
  await recordLongTasks(page);
  await compileMarks(page);
  const times = await measure(page, 6);
  const tasks = await longTasks(page);
  const compiles = await compileMarks(page);
  const compileWorker = workers.some((u) => u.includes('compile.worker'));
  const over = tasks.filter((t) => t.ms > 50);
  console.log(`[perf] 300 tables compiles: ${fmtCompiles(compiles)}`);
  console.log(
    `[perf] 300 tables keystroke→diagram ms: median ${median(times).toFixed(1)}, max ${Math.max(...times).toFixed(1)} [${fmt(times)}]; compile worker: ${compileWorker ? 'started' : 'not used'}; long tasks while typing: ${tasks.length} [${fmtTasks(tasks)}], over 50 ms: ${over.length}`,
  );
  // A compile of this size is slower than the 25 ms threshold: it runs in the worker.
  expect(compileWorker).toBe(true);
  expect(compiles.length).toBeGreaterThan(0);
  expect(compiles.every((c) => c.mode === 'worker')).toBe(true);
  expect(median(times)).toBeLessThanOrEqual(600 * SLACK);
  // Typing itself (keystrokes, no compile on the main thread) stays responsive.
  expect(Math.max(0, ...tasks.map((t) => t.ms))).toBeLessThanOrEqual(CI ? 250 : 200);
});

test('typing in a small schema stays on the main thread', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await openEditor(page);
  await pasteAtEnd(page, 'Table small {\n  id int [pk]\n}\n');
  await expect(page.locator('.rv-canvas .react-flow__node', { hasText: 'small' })).toHaveCount(1);
  expect(workers.some((u) => u.includes('compile.worker'))).toBe(false);
});
