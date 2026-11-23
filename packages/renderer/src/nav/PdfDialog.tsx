/**
 * PDF export dialog (docs/design/phase3-v1.md §4.4, §4.7): tiled (print scale across pages, with
 * overlap, cut marks and an overview page) or one page per view; paper, orientation, the views to
 * include, and a live page count from `planTiles` ("6 pages (2 × 3)"). A modal dialog inside its
 * container: focus stays in it, Esc closes it, focus returns where it was.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import type { PdfOptions } from '../export/pdf/index.js';
import { MAX_PDF_PAGES, defaultPaper, type PaperSize, type TilePlan } from '../export/pdf/plan.js';
import { CloseIcon } from '../viewer/icons.js';

/** 100 % print scale: 1 px = 1/96 in = 0.75 pt. */
const PT_PER_PX_100 = 0.75;
/** Smallest print scale the PDF dialog accepts, in percent. */
export const MIN_PDF_SCALE = 50;
/** Largest print scale the PDF dialog accepts, in percent. */
export const MAX_PDF_SCALE = 200;
/** Largest tile overlap the PDF dialog accepts, in mm. */
export const MAX_PDF_OVERLAP_MM = 30;

/** Props of `PdfDialog`. */
export interface PdfDialogProps {
  /**
   * Views that can be printed (`name` '*' = all tables). An `empty` view (no tables, notes or
   * groups; `isViewEmpty`) is never printed: the page count says it is left out.
   */
  views: { name: string; label: string; empty?: boolean }[];
  /** View shown now (checked by default). */
  current: string;
  /** Called with the chosen options and views when the user exports. */
  onExport(o: PdfOptions & { views: string[] }): void;
  /** Called when the dialog is dismissed (Esc, Cancel, or after export). */
  onClose(): void;
  /** Tile grid of a view for these options (default: the current view). */
  planFor(o: PdfOptions, view?: string): TilePlan;
  /** Note under the summary, e.g. "Some text uses characters the PDF fonts lack…". */
  note?: string | null;
  /** Class of the dialog element. */
  className?: string;
}

export { isViewEmpty } from './viewEmpty.js';

function emptyLeftOut(n: number): string {
  return n ? `, ${n} empty ${n === 1 ? 'view' : 'views'} left out` : '';
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

/** Pages one view takes in tiled mode: its tiles, plus the overview when there are several. */
export function tiledPageCount(plan: TilePlan, overview: boolean): number {
  const n = plan.tiles.length;
  return n + (overview && n > 1 ? 1 : 0);
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The PDF export dialog: views, paper, orientation, tiled or fit-to-page, scale and overlap, with a live page count.
 *
 * @param props - See {@link PdfDialogProps}.
 */
export function PdfDialog({
  views,
  current,
  onExport,
  onClose,
  planFor,
  note,
  className,
}: PdfDialogProps): ReactElement {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PdfOptions['mode']>('tiled');
  const [paper, setPaper] = useState<PaperSize>(() => defaultPaper());
  const [orientation, setOrientation] = useState<NonNullable<PdfOptions['orientation']>>('auto');
  const [percent, setPercent] = useState('100');
  const [overlap, setOverlap] = useState('10');
  const [marks, setMarks] = useState(true);
  const [overview, setOverview] = useState(true);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const initial = (): string[] =>
    views.some((v) => v.name === current) ? [current] : views.slice(0, 1).map((v) => v.name);
  const [chosen, setChosen] = useState<string[]>(initial);
  /** Until the user ticks a view: tiled prints the open view, one page per view prints them all. */
  const [viewsTouched, setViewsTouched] = useState(false);
  const chooseMode = (next: PdfOptions['mode']) => {
    setMode(next);
    if (!viewsTouched) setChosen(next === 'pages' ? views.map((v) => v.name) : initial());
  };

  const scalePct = clamp(Number(percent), MIN_PDF_SCALE, MAX_PDF_SCALE, 100);
  const overlapMm = clamp(Number(overlap), 0, MAX_PDF_OVERLAP_MM, 10);
  const options: PdfOptions = {
    mode,
    paper,
    orientation,
    ...(mode === 'tiled'
      ? { scale: (PT_PER_PX_100 * scalePct) / 100, overlapMm, marks, overview, skipEmpty }
      : {}),
  };
  const ordered = views.map((v) => v.name).filter((n) => chosen.includes(n));
  /** The chosen views that draw something: only they are printed. */
  const printed = views.filter((v) => !v.empty && chosen.includes(v.name)).map((v) => v.name);
  const emptyChosen = ordered.length - printed.length;

  const plans = useMemo(
    () =>
      mode === 'tiled'
        ? printed.map((v) => {
            try {
              return planFor(options, v);
            } catch {
              return null;
            }
          })
        : [],
    [mode, paper, orientation, scalePct, overlapMm, skipEmpty, printed.join('\u0000'), planFor],
  );
  let pages = 0;
  let summary: string;
  if (mode === 'pages') {
    pages = printed.length;
    summary = `${pages} ${pages === 1 ? 'page' : 'pages'}, one per view${emptyLeftOut(emptyChosen)}`;
  } else {
    for (const p of plans) if (p) pages += tiledPageCount(p, overview);
    const one = plans.length === 1 ? plans[0] : null;
    if (one) {
      const tiles = one.tiles.length;
      const left = one.skipped.length;
      summary = `${tiles} ${tiles === 1 ? 'page' : 'pages'} (${one.rows} × ${one.cols}${left ? `, ${left} empty left out` : ''})`;
      if (overview && tiles > 1) summary += ' and an overview page';
    } else summary = `${pages} ${pages === 1 ? 'page' : 'pages'} for ${plans.length} views`;
    if (emptyChosen) summary += emptyLeftOut(emptyChosen);
  }
  const tooMany = pages > MAX_PDF_PAGES;
  const canExport = printed.length > 0 && !tooMany;
  const single = plans.length === 1 ? plans[0] : null;

  // Focus: the first field on open, back to the opener on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => {
      if (before && before !== document.body && before.isConnected) before.focus();
    };
  }, []);

  const close = useRef(onClose);
  close.current = onClose;
  // Esc closes (capture, so it never reaches an overlay behind the dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const titleId = `${id}-title`;
  const summaryId = `${id}-summary`;
  return (
    <div className="rv-nav-backdrop rv-nav-layer nodrag nopan nowheel">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        className={['rv-nav-dialog', 'rv-nav-pdf', className ?? ''].filter(Boolean).join(' ')}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          // Keep Tab inside the dialog.
          const items = Array.from(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
          if (!items.length) return;
          const i = items.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey
            ? i <= 0
              ? items.length - 1
              : -1
            : i === items.length - 1
              ? 0
              : -1;
          if (next >= 0) {
            e.preventDefault();
            items[next]!.focus();
          }
        }}
      >
        <header className="rv-nav-dialog-head">
          <h2 id={titleId}>Export PDF</h2>
          <button
            type="button"
            className="rv-nav-icon-button"
            title="Close (Esc)"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <form
          className="rv-nav-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (canExport) onExport({ ...options, views: printed });
          }}
        >
          <fieldset className="rv-nav-fieldset">
            <legend>Pages</legend>
            <label className="rv-nav-check">
              <input
                type="radio"
                name={`${id}-mode`}
                value="tiled"
                checked={mode === 'tiled'}
                onChange={() => chooseMode('tiled')}
              />
              <span>
                Tiled
                <small>At print scale, across as many pages as needed</small>
              </span>
            </label>
            <label className="rv-nav-check">
              <input
                type="radio"
                name={`${id}-mode`}
                value="pages"
                checked={mode === 'pages'}
                onChange={() => chooseMode('pages')}
              />
              <span>
                One page per view
                <small>Each view scaled to fit its page</small>
              </span>
            </label>
          </fieldset>

          {views.length > 1 ? (
            <fieldset className="rv-nav-fieldset">
              <legend>Views</legend>
              {views.map((v) => (
                <label key={v.name} className="rv-nav-check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(v.name)}
                    onChange={(e) => {
                      setViewsTouched(true);
                      setChosen((c) =>
                        e.target.checked ? [...c, v.name] : c.filter((x) => x !== v.name),
                      );
                    }}
                  />
                  <span>{v.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="rv-nav-row">
            <label className="rv-nav-labelled">
              <span>Paper</span>
              <select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            <label className="rv-nav-labelled">
              <span>Orientation</span>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as typeof orientation)}
              >
                <option value="auto">Automatic</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
          </div>

          {mode === 'tiled' ? (
            <>
              <div className="rv-nav-row">
                <label className="rv-nav-labelled">
                  <span>Scale (%)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={MIN_PDF_SCALE}
                    max={MAX_PDF_SCALE}
                    step={5}
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    onBlur={() => setPercent(String(scalePct))}
                  />
                </label>
                <label className="rv-nav-labelled">
                  <span>Overlap (mm)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_PDF_OVERLAP_MM}
                    step={1}
                    value={overlap}
                    onChange={(e) => setOverlap(e.target.value)}
                    onBlur={() => setOverlap(String(overlapMm))}
                  />
                </label>
              </div>
              <label className="rv-nav-check">
                <input
                  type="checkbox"
                  checked={marks}
                  onChange={(e) => setMarks(e.target.checked)}
                />
                <span>Cut marks and page labels</span>
              </label>
              <label className="rv-nav-check">
                <input
                  type="checkbox"
                  checked={overview}
                  onChange={(e) => setOverview(e.target.checked)}
                />
                <span>Overview page first</span>
              </label>
              <label className="rv-nav-check">
                <input
                  type="checkbox"
                  checked={skipEmpty}
                  onChange={(e) => setSkipEmpty(e.target.checked)}
                />
                <span>Skip empty pages</span>
              </label>
            </>
          ) : null}

          <p
            id={summaryId}
            className="rv-nav-status"
            role="status"
            aria-live="polite"
            data-rv-pages={pages}
            data-rv-empty-views={emptyChosen}
            {...(single
              ? {
                  'data-rv-rows': single.rows,
                  'data-rv-cols': single.cols,
                  'data-rv-skipped': single.skipped.length,
                }
              : {})}
          >
            {ordered.length === 0
              ? 'Choose at least one view'
              : printed.length === 0
                ? `Nothing to print: ${ordered.length === 1 ? 'this view is' : 'these views are'} empty`
                : tooMany
                  ? `${pages} pages is more than the ${MAX_PDF_PAGES}-page limit: lower the scale`
                  : summary}
          </p>
          {note ? <p className="rv-nav-note">{note}</p> : null}

          <div className="rv-nav-actions">
            <button type="button" className="rv-nav-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="rv-nav-button rv-nav-button--primary"
              aria-disabled={!canExport}
            >
              Export PDF
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
