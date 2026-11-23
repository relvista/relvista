/**
 * Performance budgets (design phase3 §7), logged precisely and asserted loosely (CI machines are
 * slower and noisier than a laptop):
 *
 * - keystroke → diagram on 14-large: ≤ 250 ms (the 150 ms typing debounce included);
 * - keystroke → diagram on a generated 300-table schema (≈ 90 KB, seeded): ≤ 600 ms, every
 *   compile in the compile worker. Main-thread long tasks while typing are logged with their
 *   offset from the keydown; the §7 goal "no task > 50 ms" is asserted only as a loose ceiling:
 *   what remains on the main thread there is the language service's completion parse (~+80 ms),
 *   not the compile;
 * - a generated 600-table schema (≈ 186 KB, same generator): the open (drop → final layout,
 *   timed in the page) ≤ 4 s; keystroke → diagram ≤ 800 ms, compiles in the worker; dragging a
 *   table: no task over 100 ms, neither per pointer move nor when it is let go (the full re-route
 *   and the 'move' layout change). Typing long tasks are only logged: at this size the completion
 *   parse alone (@dbml/parse's language service, ~180 ms) is one. Most of a drag move is Chrome's
 *   layerization of the 600 cards and 599 edge SVGs (~45 ms), not relvista's code.
 *
 * The perf project records traces without DOM snapshots (playwright.config.ts), and the waits of
 * the 600-table test poll page flags instead of locator `expect`s: both would otherwise put
 * Playwright's own walks over the page's DOM on its main thread, inside the measured times.
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

/** `tables` tables with notes, indexes and about one ref per table (seeded; 300 ≈ 90 KB, 600 ≈ 186 KB). */
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
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const fmtFrames = (xs: number[]) =>
  `${xs.length} frames, median ${median(xs).toFixed(1)}, p95 ${pct(xs, 0.95).toFixed(1)}, max ${Math.max(...xs).toFixed(1)} ms`;

/**
 * Drops `text` as a file and times the open in the page, from the drop event: the first node
 * drawn, then the final layout (`data-rv-layout="done"` with `nodes` nodes drawn). The wait polls
 * a page flag rather than an `expect`: while a locator `expect` fails, Playwright renders an aria
 * snapshot of the whole page on every retry, which with 600 tables blocks the main thread for
 * about half a second each time.
 */
async function timedOpen(
  page: Page,
  name: string,
  text: string,
  nodes: number,
): Promise<{ firstMs: number; layoutMs: number }> {
  await page.evaluate((count) => {
    const w = window as unknown as { __open: { t0: number; first: number; done: number } };
    const o = (w.__open = { t0: -1, first: -1, done: -1 });
    window.addEventListener('drop', () => (o.t0 = performance.now()), {
      capture: true,
      once: true,
    });
    const obs = new MutationObserver(() => {
      if (o.t0 < 0) return;
      const drawn = document.querySelectorAll('.rv-canvas .react-flow__node').length;
      const now = performance.now() - o.t0;
      if (o.first < 0 && drawn > 0) o.first = now;
      if (drawn === count && document.querySelector('.rv-canvas[data-rv-layout="done"]')) {
        o.done = now;
        obs.disconnect();
      }
    });
    obs.observe(document.querySelector('.ed-app')!, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-rv-layout'],
    });
  }, nodes);
  await dropText(page, name, text);
  await page.waitForFunction(
    () => (window as unknown as { __open: { done: number } }).__open.done >= 0,
    null,
    { timeout: 120_000, polling: 100 },
  );
  return page.evaluate(() => {
    const o = (window as unknown as { __open: { first: number; done: number } }).__open;
    return { firstMs: o.first, layoutMs: o.done };
  });
}

/** What `framesDuring` records in the page. */
interface Recording {
  frames: number[];
  tasks: number[];
  on: boolean;
  obs: PerformanceObserver;
}

/**
 * Frame intervals (requestAnimationFrame deltas) and main-thread long tasks (ms) while `run`
 * drives the page.
 */
async function framesDuring(
  page: Page,
  run: () => Promise<void>,
): Promise<{ frames: number[]; tasks: number[] }> {
  await page.evaluate(() => {
    const frames: number[] = [];
    const tasks: number[] = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) tasks.push(e.duration);
    });
    const rec: Recording = { frames, tasks, on: true, obs };
    (window as unknown as { __rec: Recording }).__rec = rec;
    obs.observe({ type: 'longtask' });
    let last = performance.now();
    const tick = (t: number) => {
      rec.frames.push(t - last);
      last = t;
      if (rec.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await run();
  return page.evaluate(() => {
    const rec = (window as unknown as { __rec: Recording }).__rec;
    rec.on = false;
    for (const e of rec.obs.takeRecords()) rec.tasks.push(e.duration);
    rec.obs.disconnect();
    return { frames: rec.frames.slice(1), tasks: rec.tasks };
  });
}

/** The table nearest the canvas centre whose header is in view and not covered (its id). */
async function tableNearCentre(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const r = document.querySelector('.rv-canvas')!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: { id: string; d: number } | null = null;
    for (const n of document.querySelectorAll<HTMLElement>(
      '.rv-canvas .react-flow__node-rvTable',
    )) {
      const b = n.getBoundingClientRect();
      if (b.left < r.left || b.right > r.right - 200 || b.top < r.top || b.bottom > r.bottom - 100)
        continue;
      const x = b.left + Math.min(30, b.width / 2);
      const y = b.top + 8;
      if (document.elementFromPoint(x, y)?.closest('.react-flow__node') !== n) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d) best = { id: n.dataset.id!, d };
    }
    return best?.id ?? null;
  });
  if (!id) throw new Error('no table to drag in view');
  return id;
}

/**
 * Drags table `id` by its header, `steps` pointer moves of (4, 2) px. Returns the frames and long
 * tasks of the drag, and the long tasks of the drop (the full re-route and the 'move' layout
 * change), recorded until 600 ms after the button is let go.
 */
async function timedDrag(
  page: Page,
  id: string,
  steps: number,
): Promise<{ drag: { frames: number[]; tasks: number[] }; drop: number[] }> {
  const b = (await page.locator(`.rv-canvas .react-flow__node[data-id="${id}"]`).boundingBox())!;
  const at = { x: b.x + Math.min(30, b.width / 2), y: b.y + 8 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const drag = await framesDuring(page, async () => {
    for (let i = 1; i <= steps; i++) await page.mouse.move(at.x + i * 4, at.y + i * 2);
  });
  const { tasks: drop } = await framesDuring(page, async () => {
    await page.mouse.up();
    await page.waitForTimeout(600);
  });
  return { drag, drop };
}

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

test('a 600-table schema: open ≤ 4 s, keystroke → diagram ≤ 800 ms, drag tasks ≤ 100 ms', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await openEditor(page);
  await expect(page.locator('.rv-canvas .react-flow__node')).toHaveCount(0);
  const schema = bigSchema(600);
  console.log(`[perf] generated schema: ${(schema.length / 1024).toFixed(1)} KB, 600 tables`);
  await compileMarks(page);
  const open = await timedOpen(page, 'generated.dbml', schema, 600);
  const openCompiles = await compileMarks(page);
  await diagramReady(page);

  await addProbe(page);
  await measure(page, 2); // warm-up
  await recordLongTasks(page);
  await compileMarks(page);
  const times = await measure(page, 6);
  const tasks = await longTasks(page);
  const compiles = await compileMarks(page);
  await diagramReady(page);

  // The same table twice: the first drag also selects it and lifts it above the others.
  const table = await tableNearCentre(page);
  const first = await timedDrag(page, table, 10);
  await diagramReady(page);
  const { drag, drop } = await timedDrag(page, table, 40);

  const ms = (xs: number[]) => xs.map((x) => x.toFixed(0)).join(', ');
  console.log(
    `[perf] 600 tables open ms: first table ${open.firstMs.toFixed(0)}, layout done ${open.layoutMs.toFixed(0)}; compile ${fmtCompiles(openCompiles)}`,
  );
  console.log(`[perf] 600 tables compiles: ${fmtCompiles(compiles)}`);
  console.log(
    `[perf] 600 tables keystroke→diagram ms: median ${median(times).toFixed(1)}, max ${Math.max(...times).toFixed(1)} [${fmt(times)}]; long tasks while typing: ${tasks.length} [${fmtTasks(tasks)}]`,
  );
  console.log(
    `[perf] 600 tables drag: ${fmtFrames(drag.frames)}; long tasks ${drag.tasks.length} [${ms(drag.tasks)}]; drop long tasks [${ms(drop)}]; first drag (selects the table) long tasks [${ms(first.drag.tasks)}], drop [${ms(first.drop)}]`,
  );
  expect(compiles.length).toBeGreaterThan(0);
  expect(compiles.every((c) => c.mode === 'worker')).toBe(true);
  expect(open.layoutMs).toBeLessThanOrEqual(4000 * SLACK);
  expect(median(times)).toBeLessThanOrEqual(800 * SLACK);
  expect(Math.max(0, ...drag.tasks)).toBeLessThanOrEqual(100 * SLACK);
  expect(Math.max(0, ...drop)).toBeLessThanOrEqual(100 * SLACK);
});

test('typing in a small schema stays on the main thread', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await openEditor(page);
  await pasteAtEnd(page, 'Table small {\n  id int [pk]\n}\n');
  await expect(page.locator('.rv-canvas .react-flow__node', { hasText: 'small' })).toHaveCount(1);
  expect(workers.some((u) => u.includes('compile.worker'))).toBe(false);
});
