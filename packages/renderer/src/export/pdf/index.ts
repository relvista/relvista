/**
 * Multi-page PDF export (docs/design/phase3-v1.md §4.4). This module imports nothing heavy: jsPDF
 * and svg2pdf.js load with `import('./impl.js')` on the first export, so the package entry (and a
 * docs page that never prints) does not pay for them.
 *
 * Text outside WinAnsi: Latin, Greek, Cyrillic and CJK (ideographs, kana) are drawn with an
 * embedded font subset (Noto Sans, Droid Sans Fallback), loaded only for a document that needs it;
 * see `unicode.ts`. A page with text those fonts lack (Arabic, Hebrew, Hangul, Indic scripts,
 * emoji) is embedded as an image.
 *
 * Report: `exportPdfWithReport` resolves to `{ blob, pageCount, rasterPages }`; `rasterPages`
 * counts the pages embedded as images. The export dialog shows "Some text uses characters the PDF
 * fonts lack; pages are embedded as images" when it is above zero. `exportPdf` is the same call
 * resolving to the Blob only.
 */
import type { DetailLevel, DiagramGeometry, DiagramModel } from '@relvista/core';
import type { Decorations } from '../../svg/decorations.js';
import type { EdgeStyle } from '../../svg/routing.js';
import type { PaletteOverrides } from '../../theme.js';
import { contentBoxes, defaultPaper, planDocument, type PaperSize } from './plan.js';

export {
  DEFAULT_OVERLAP_MM,
  DEFAULT_PDF_SCALE,
  MAX_PDF_PAGES,
  PAPER_MM,
  PDF_DIAGRAM_PADDING,
  PdfPageLimitError,
  contentBoxes,
  defaultPaper,
  isWinAnsi,
  paddedBounds,
  planDocument,
  planTiles,
  tileLabel,
  type MarkPrimitive,
  type PaperSize,
  type PlannedPage,
  type TilePlan,
  type TileRect,
} from './plan.js';
export { pdfCanDrawText } from './unicode.js';

/** One diagram to print. */
export interface PdfPageSource {
  /** Page heading, e.g. the view name. */
  title: string;
  /** View-filtered model (or a `mergeForDiff` model). */
  model: DiagramModel;
  geometry: DiagramGeometry;
  decorations?: Decorations | null;
}

/** Options of `exportPdf`: paper, orientation, tiling and what goes on each page. */
export interface PdfOptions {
  /** 'tiled': each diagram over as many pages as needed at `scale`; 'pages': one page per source, fit to page. */
  mode: 'tiled' | 'pages';
  /** Default from `navigator.language`: 'letter' for en-US/en-CA/es-MX, else 'a4'. */
  paper?: PaperSize;
  /** Default 'auto': fewest pages (tiled) or largest drawing (pages); ties follow the diagram's aspect. */
  orientation?: 'auto' | 'portrait' | 'landscape';
  /** Tiled: print scale, diagram px → pt. Default 0.75 (1 px = 1/96 in, i.e. 100 %). */
  scale?: number;
  /** Tiled: overlap between neighbouring pages, mm. Default 10. */
  overlapMm?: number;
  /** Tiled: cut/registration marks in the overlap and page labels "B2 (row B, column 2)". Default true. */
  marks?: boolean;
  /** Tiled: an overview page first (whole diagram fit to page with the tile grid). Default true when > 1 tile. */
  overview?: boolean;
  /**
   * Tiled: leave out pages no table, note or collapsed group reaches (only ref-line fragments).
   * Labels keep their grid position; the overview crosses the skipped cells out. Default true.
   */
  skipEmpty?: boolean;
  /** Document title (PDF metadata and running header). */
  title?: string;
  detailLevel?: DetailLevel;
  edgeStyle?: EdgeStyle;
  /** Print is always light; only the palette's fonts are honoured (mapped to Helvetica / Courier / Times). */
  palette?: PaletteOverrides | null;
  /** Deflate page streams. Default true (false makes the bytes readable, for tests and debugging). */
  compress?: boolean;
  /**
   * Text outside WinAnsi (Greek, Cyrillic, CJK, …): draw it with an embedded font subset, so it
   * stays selectable and searchable. The fonts load on first use (Noto Sans, 0.16 MB per weight;
   * the CJK font, 2.1 MB). Pages with text the bundled fonts lack (Arabic, Hebrew, Hangul, Indic
   * scripts, emoji) are rasters either way. `false` rasterizes every page with text outside
   * WinAnsi, as relvista 1.0 did. Default true.
   */
  embedFonts?: boolean;
}

/** What `exportPdfWithReport` resolves to. */
export interface PdfExportResult {
  blob: Blob;
  pageCount: number;
  /**
   * Pages embedded as a PNG because their text has characters no embedded font covers (or
   * `embedFonts: false` and characters outside WinAnsi). Each tile page is
   * rasterized on its own at 3 device px per diagram px; a whole-diagram page (overview, one page
   * per view) is one raster at up to 3×, less for a diagram past the canvas limits (16384 px a
   * side, 16.7 MP).
   */
  rasterPages: number;
}

/**
 * Writes the PDF and reports how it went. Lazy: the first call loads jsPDF and svg2pdf.js, and
 * a document with text outside WinAnsi loads the fonts it needs.
 * Browser only. Rejects with PdfPageLimitError (before loading anything) past 200 pages.
 */
export async function exportPdfWithReport(
  pages: readonly PdfPageSource[],
  options: PdfOptions,
): Promise<PdfExportResult> {
  if (pages.length === 0) throw new Error('relvista: nothing to export to PDF');
  const paper = options.paper ?? defaultPaper();
  // Fails fast on the page limit without downloading the PDF libraries.
  planDocument(
    pages.map((p) => ({
      title: p.title,
      bounds: p.geometry.bounds,
      content: contentBoxes(p.geometry),
    })),
    { ...options, paper },
  );
  const { renderPdf } = await import('./impl.js');
  return renderPdf(pages, { ...options, paper });
}

/**
 * Lazy: `import('./impl.js')` loads jspdf + svg2pdf.js on first call. Browser only.
 *
 * @example
 * ```ts
 * import { compileDbml, layoutDiagram } from '@relvista/core';
 * import { downloadBlob, exportPdf } from '@relvista/renderer';
 *
 * const { model } = compileDbml(source);
 * const geometry = await layoutDiagram(model!);
 * const pdf = await exportPdf([{ title: 'Shop', model: model!, geometry }], { mode: 'tiled', paper: 'a4' });
 * downloadBlob(pdf, 'shop.pdf');
 * ```
 */
export async function exportPdf(
  pages: readonly PdfPageSource[],
  options: PdfOptions,
): Promise<Blob> {
  return (await exportPdfWithReport(pages, options)).blob;
}
