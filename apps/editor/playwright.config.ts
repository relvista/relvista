import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

/** A free TCP port, found synchronously (the config must be synchronous). */
function freePort(): number {
  const out = execFileSync(process.execPath, [
    '-e',
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
  ]);
  return Number(String(out).trim());
}

// Workers re-evaluate this file; keep the port the main process picked.
process.env.RELVISTA_EDITOR_E2E_PORT ??= String(freePort());
const port = Number(process.env.RELVISTA_EDITOR_E2E_PORT);

// Default: the combined Pages site (apps/docs/build with the editor copied into build/editor/,
// made by `pnpm docs:build`), served like GitHub Pages, so docs → editor links are tested too.
// RELVISTA_EDITOR_E2E_SERVER=preview serves only the editor (`vite preview` of dist/); the specs
// that need the docs site skip themselves then.
const preview = process.env.RELVISTA_EDITOR_E2E_SERVER === 'preview';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}/editor/`,
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [/mobile\.spec\.ts/, /perf\.spec\.ts/],
      // Not devices['Desktop Chrome']: its Windows user agent makes Monaco bind Ctrl while a
      // macOS host sends Meta for ControlOrMeta.
      use: { browserName: 'chromium', viewport: { width: 1360, height: 900 } },
    },
    {
      // The timing budgets run last and alone: in parallel with the other specs (fullyParallel)
      // they share the CI runner's few cores with Monaco and the canvas of other tests, and the
      // measured latency is mostly that contention. `dependencies` makes them wait until both
      // other projects finish; perf.spec.ts is serial, so they also run one at a time. To run
      // only them: `pnpm exec playwright test --project=perf --no-deps`.
      name: 'perf',
      testMatch: /perf\.spec\.ts/,
      dependencies: ['chromium', 'mobile'],
      use: {
        browserName: 'chromium',
        viewport: { width: 1360, height: 900 },
        // The trace of a failed budget keeps its actions and logs, but no DOM snapshots and no
        // screencast: Playwright takes a snapshot of the whole DOM before and after every action,
        // on the page's main thread and inside the measured time (about +130 ms per keystroke on
        // 600 tables), and the screencast delays frames.
        trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false },
      },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: {
    command: preview
      ? `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`
      : `node ../docs/scripts/serve-site.mjs --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/editor/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
