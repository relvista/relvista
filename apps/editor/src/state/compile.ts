/**
 * Debounced `compileDbml` (design phase2 §4.2, phase3 §6.2): 150 ms after typing, immediately after
 * open. Each run picks where it compiles:
 *
 * - **sync** (main thread) while the previous compile took ≤ `WORKER_THRESHOLD_MS` and the texts
 *   total ≤ `WORKER_MAX_CHARS`: small schemas stay as fast as before (no message round trip);
 * - otherwise a **module worker** (`compile.worker.ts`), so typing in a large schema never blocks
 *   the main thread for the length of a compile.
 *
 * Runs are numbered; a result of a run that a newer one superseded is dropped. One worker compile
 * is in flight at a time: newer inputs wait (only the latest) and go out when it returns. A worker
 * that fails (load error, crash) is dropped and compiles go back to sync, logged once.
 * The caller keeps the last good model and handles rename detection on each new good model.
 */
import { compileDbml, type CompileResult } from '@relvista/core';
import type { CompileRequest, CompileResponse } from './compile.worker.js';

export const COMPILE_DEBOUNCE_MS = 150;
/** A previous compile slower than this sends the next one to the worker. */
export const WORKER_THRESHOLD_MS = 25;
/** Texts larger than this (UTF-16 code units, about 256 KB of ASCII) always compile in the worker. */
export const WORKER_MAX_CHARS = 256 * 1024;
/** From this previous compile time on, the worker is started ahead of need (its bundle loads). */
export const WORKER_PREWARM_MS = 15;

export type CompileInputFiles = { files: Record<string, string>; entry: string };

export interface CompileOutcome {
  result: CompileResult;
  /** Compile time in ms, measured where it ran (budget: ≤ 40 ms for 14-large in Node). */
  ms: number;
  /** Where it ran. */
  mode: 'sync' | 'worker';
  /** Schedule → result in ms (debounce excluded): what the user waits for after the pause. */
  latencyMs: number;
  /** The texts this result was compiled from. */
  input: CompileInputFiles;
}

/** The part of `Worker` the scheduler uses (a fake in unit tests). */
export interface CompileWorkerLike {
  postMessage(message: CompileRequest): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<CompileResponse>) => void) | null;
  onerror: ((ev: ErrorEvent | Event) => void) | null;
  onmessageerror?: ((ev: MessageEvent) => void) | null;
}

export interface CompileSchedulerOptions {
  /** Creates the worker; null when workers are unavailable (Node, very old browsers). */
  createWorker?: () => CompileWorkerLike | null;
  compile?: (input: CompileInputFiles) => CompileResult;
  now?: () => number;
  /** Logged once when the worker fails. */
  warn?: (message: string, error?: unknown) => void;
  thresholdMs?: number;
  maxSyncChars?: number;
}

function defaultCreateWorker(): CompileWorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./compile.worker.ts', import.meta.url), {
    type: 'module',
    name: 'relvista-compile',
  }) as unknown as CompileWorkerLike;
}

function textSize(files: Record<string, string>): number {
  let n = 0;
  for (const k in files) n += files[k]!.length;
  return n;
}

export class CompileScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => CompileInputFiles) | null = null;
  /** Number of the latest run started (sync or worker). */
  private seq = 0;
  private lastMs = 0;
  private worker: CompileWorkerLike | null = null;
  private workerFailed = false;
  /** Run in the worker right now: its number, input and start time. */
  private inFlight: { seq: number; input: CompileInputFiles; started: number } | null = null;
  /** Latest input waiting for the in-flight run to return. */
  private queued: { seq: number; input: CompileInputFiles; started: number } | null = null;
  private readonly createWorker: () => CompileWorkerLike | null;
  private readonly compile: (input: CompileInputFiles) => CompileResult;
  private readonly now: () => number;
  private readonly warn: (message: string, error?: unknown) => void;
  private readonly thresholdMs: number;
  private readonly maxSyncChars: number;

  constructor(
    private readonly onResult: (o: CompileOutcome) => void,
    options: CompileSchedulerOptions = {},
  ) {
    this.createWorker = options.createWorker ?? defaultCreateWorker;
    this.compile = options.compile ?? compileDbml;
    this.now = options.now ?? (() => performance.now());
    this.warn = options.warn ?? ((m, e) => console.warn(m, e));
    this.thresholdMs = options.thresholdMs ?? WORKER_THRESHOLD_MS;
    this.maxSyncChars = options.maxSyncChars ?? WORKER_MAX_CHARS;
  }

  /** Schedules a compile; `input` is read when the timer fires (latest texts win). */
  schedule(input: () => CompileInputFiles, delay = COMPILE_DEBOUNCE_MS): void {
    this.pending = input;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (delay <= 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => this.flush(), delay);
  }

  /** Runs the pending compile now (sync, or posted to the worker). */
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const read = this.pending;
    this.pending = null;
    if (!read) return;
    const input = read();
    const started = this.now();
    const seq = ++this.seq;
    if (this.useWorker(input)) {
      const run = { seq, input, started };
      if (this.inFlight) this.queued = run;
      else this.post(run);
      return;
    }
    // A sync run supersedes whatever the worker is still doing.
    this.queued = null;
    this.runSync(input, started);
    if (this.lastMs > WORKER_PREWARM_MS) this.ensureWorker();
  }

  /** Drops the pending compile and makes any result still to come stale. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.queued = null;
    this.seq++;
  }

  /** Where the next run would compile (for tests and diagnostics). */
  nextMode(input: CompileInputFiles): 'sync' | 'worker' {
    return this.useWorker(input, false) ? 'worker' : 'sync';
  }

  /** Terminates the worker (tests; page unload frees it anyway). */
  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = null;
  }

  private useWorker(input: CompileInputFiles, start = true): boolean {
    if (this.workerFailed) return false;
    const slow = this.lastMs > this.thresholdMs || textSize(input.files) > this.maxSyncChars;
    if (!slow) return false;
    return start ? this.ensureWorker() !== null : true;
  }

  private runSync(input: CompileInputFiles, started: number): void {
    const t = this.now();
    const result = this.compile(input);
    const end = this.now();
    this.lastMs = end - t;
    this.deliver({ result, ms: this.lastMs, mode: 'sync', latencyMs: end - started, input });
  }

  /**
   * Hands a result to the caller, and leaves a `relvista:compile` performance mark (detail: ms,
   * mode, latency) for DevTools and the e2e performance budgets.
   */
  private deliver(outcome: CompileOutcome): void {
    try {
      performance.mark('relvista:compile', {
        detail: { ms: outcome.ms, mode: outcome.mode, latencyMs: outcome.latencyMs },
      });
    } catch {
      // no User Timing here
    }
    this.onResult(outcome);
  }

  private ensureWorker(): CompileWorkerLike | null {
    if (this.worker || this.workerFailed) return this.worker;
    let w: CompileWorkerLike | null;
    try {
      w = this.createWorker();
    } catch (e) {
      this.fail(e);
      return null;
    }
    if (!w) {
      this.workerFailed = true;
      return null;
    }
    w.onmessage = (ev) => this.onMessage(ev.data);
    w.onerror = (ev) => {
      // A load error of the module worker arrives here; do not let it reach window.onerror.
      ev.preventDefault?.();
      this.fail((ev as ErrorEvent).message ?? ev);
    };
    w.onmessageerror = (ev) => this.fail(ev);
    this.worker = w;
    return w;
  }

  private post(run: { seq: number; input: CompileInputFiles; started: number }): void {
    const w = this.worker;
    if (!w) {
      this.runSync(run.input, run.started);
      return;
    }
    this.inFlight = run;
    try {
      w.postMessage({ seq: run.seq, files: run.input.files, entry: run.input.entry });
    } catch (e) {
      this.fail(e);
    }
  }

  private onMessage(msg: CompileResponse): void {
    const run = this.inFlight;
    if (!run || msg.seq !== run.seq) return;
    if (!msg.ok) {
      this.fail(msg.error); // redoes the in-flight (or queued) input on the main thread
      return;
    }
    this.inFlight = null;
    this.lastMs = msg.ms;
    const next = this.queued;
    this.queued = null;
    // Superseded (a newer run was started, or cancel()): drop the result.
    if (msg.seq === this.seq) {
      this.deliver({
        result: msg.result,
        ms: msg.ms,
        mode: 'worker',
        latencyMs: this.now() - run.started,
        input: run.input,
      });
    }
    if (next && next.seq === this.seq) {
      if (this.useWorker(next.input)) this.post(next);
      else this.runSync(next.input, next.started);
    }
  }

  /** The worker is unusable: back to sync for good, finishing what it was doing. */
  private fail(error: unknown): void {
    if (this.workerFailed && !this.worker) return;
    this.warn(
      'relvista: the compile worker failed; compiling on the main thread from now on.',
      error,
    );
    this.workerFailed = true;
    try {
      this.worker?.terminate();
    } catch {
      // already gone
    }
    this.worker = null;
    const redo = this.queued ?? this.inFlight;
    this.inFlight = null;
    this.queued = null;
    if (redo && redo.seq === this.seq) this.runSync(redo.input, redo.started);
  }
}
