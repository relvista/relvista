/**
 * Export ▾ PDF… (design phase3 §6.12): the renderer's PdfDialog over the editor — tiled across
 * pages at a print scale, or one page per view — and the download of `<name>.pdf`. In compare mode
 * the open view prints with its diff decorations.
 */
import { DEFAULT_VIEW, selectView } from '@relvista/core';
import {
  PdfDialog,
  diffDecorations,
  downloadBlob,
  exportPdfWithReport,
  pdfCanDrawText,
  type PdfOptions,
  type PdfPageSource,
} from '@relvista/renderer';
import { useMemo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { focusedModel, pdfSources, pdfViews, planFor } from '../diagram/pdf.js';
import { mergedForView } from '../state/compare.js';
import { shownDetail } from '../state/navigation.js';
import { store, useEditor } from '../state/store.js';
import { useTheme } from '../theme.js';
import './navigation.css';

/** Writes the PDF and downloads it; progress and the outcome as toasts. */
export async function exportPdfFile(
  pages: PdfPageSource[],
  options: PdfOptions,
  fileBase: string,
): Promise<void> {
  if (!pages.length) return;
  // A progress toast, replaced by the outcome (it never stays behind or piles up).
  const preparing = store.toast('info', 'Preparing the PDF…');
  try {
    const report = await exportPdfWithReport(pages, options);
    downloadBlob(report.blob, `${fileBase}.pdf`);
    store.dismissToast(preparing);
    store.toast(
      report.rasterPages > 0 ? 'warning' : 'success',
      report.rasterPages > 0
        ? 'PDF downloaded. Some text uses characters the PDF fonts lack; pages are embedded as images.'
        : `PDF downloaded (${report.pageCount} ${report.pageCount === 1 ? 'page' : 'pages'}).`,
    );
  } catch (e) {
    store.dismissToast(preparing);
    store.toast(
      'error',
      `PDF export failed: ${e instanceof Error ? e.message.replace(/^relvista: /, '') : String(e)}`,
    );
  }
}

export function PdfExportDialog(props: { onClose(): void }): ReactElement | null {
  const model = useEditor((s) => s.compile.model);
  const layout = useEditor((s) => s.ws.layout);
  const view = useEditor((s) => s.ws.view);
  const focus = useEditor((s) => s.focus);
  const compare = useEditor((s) => s.compare);
  const detailOverride = useEditor((s) => s.detailOverride);
  const { mode } = useTheme();
  const detail = shownDetail(layout, detailOverride, view);

  const source = useMemo(() => {
    if (!model) return null;
    const merged = compare?.result?.merged ?? null;
    const base = merged
      ? mergedForView(merged, view)
      : view === DEFAULT_VIEW
        ? model
        : (selectView(model, view) ?? model);
    return pdfSources({
      model,
      layout,
      activeView: view,
      drawn: focusedModel(base, focus),
      canvas: store.canvas,
      detail,
      decorations: compare?.result ? diffDecorations(compare.result.diff) : null,
    });
  }, [model, layout, view, focus, compare, detail]);
  const plan = useMemo(() => (source ? planFor(source, view) : null), [source, view]);

  if (!model || !source || !plan) return null;
  const views = pdfViews(model);
  // The common case of the writer's raster fallback (it checks every drawn string).
  const raster = model.tables.some(
    (t) => !pdfCanDrawText(t.name) || t.columns.some((c) => !pdfCanDrawText(c.name)),
  );

  return createPortal(
    <div className="ed-pdf-layer" data-rv-color-mode={mode}>
      <PdfDialog
        views={views}
        current={views.some((v) => v.name === view) ? view : DEFAULT_VIEW}
        planFor={plan}
        note={
          raster
            ? 'Some text uses characters the PDF fonts lack; pages are embedded as images.'
            : null
        }
        onClose={props.onClose}
        onExport={(o) => {
          const { views: names, ...options } = o;
          const pages = names.map(source).filter((p): p is PdfPageSource => !!p);
          const title = store.exportTitle();
          props.onClose();
          void exportPdfFile(
            pages,
            { ...options, detailLevel: detail, ...(title ? { title } : {}) },
            store.exportBase(),
          );
        }}
      />
    </div>,
    document.body,
  );
}
