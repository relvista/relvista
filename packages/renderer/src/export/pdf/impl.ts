/**
 * The heavy half of the PDF export: loaded with `import('./impl.js')` by `exportPdf`, so jsPDF and
 * svg2pdf.js never enter the package entry's static graph (docs/design/phase3-v1.md §4.4).
 * Browser only (svg2pdf measures text with the DOM).
 *
 * Text outside WinAnsi is drawn with an embedded font subset when one of the bundled fonts covers
 * it (`unicode.ts`); a page with text none covers is embedded as a raster instead.
 */
import type { DiagramGeometry } from '@relvista/core';
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { exportPng, type PngExportOptions } from '../png.js';
import { renderDiagramSvgString, type SvgExportOptions } from '../svgString.js';
import type { PdfExportResult, PdfOptions, PdfPageSource } from './index.js';
import {
  HEADER_FONT_PT,
  PAGE_MARGIN_MM,
  PDF_DIAGRAM_PADDING,
  defaultPaper,
  isWinAnsi,
  pdfSafeText,
  contentBoxes,
  planDocument,
  standardFontFor,
  type MarkPrimitive,
  type PaperSize,
  type PlannedPage,
} from './plan.js';
import {
  PDF_FONTS,
  bytesToBinaryString,
  loadPdfFont,
  unicodeFontFor,
  type PdfFontId,
} from './unicode.js';

/** The rectangle svg2pdf draws the SVG into, in document units (mm). */
export interface SvgPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A small text image (header text the standard fonts cannot draw). */
export interface TextImage {
  /** PNG data URL. */
  data: string;
  /** Size on the page, mm. */
  wMm: number;
  hMm: number;
}

/** What `renderPdf` draws with; tests swap single entries (svg2pdf, PNG raster, text images). */
export interface PdfDeps {
  jsPDF: typeof jsPDF;
  /** Draws an SVG element into the current page. */
  drawSvg: (svg: Element, doc: jsPDF, at: SvgPlacement) => Promise<unknown>;
  /**
   * The 3× raster of a source whose text the standard fonts lack (the `exportPng` path). A tile
   * page passes a source whose `geometry.bounds` is just the tile's region (padding 0), so each
   * tile gets its own canvas and keeps 3× even when the whole diagram would exceed the canvas
   * limits.
   */
  rasterize: (source: PdfPageSource, options: PngExportOptions) => Promise<Blob | Uint8Array>;
  /** Header text the standard fonts lack, as an image; null draws it with '?' replacements. */
  textImage: (text: string, sizePt: number, grey: number) => TextImage | null;
  /** The TrueType file of a bundled font for text outside WinAnsi (`loadPdfFont`). */
  loadFont: (font: PdfFontId) => Promise<Uint8Array>;
}

/** svg2pdf.js through its function export. */
export const drawSvgWithSvg2pdf: PdfDeps['drawSvg'] = (svg, doc, at) => svg2pdf(svg, doc, at);

/** Header text drawn on a canvas at 4× (browser fonts cover every script). */
export function canvasTextImage(text: string, sizePt: number, grey: number): TextImage | null {
  if (typeof document === 'undefined') return null;
  const pxPerPt = 4;
  const fontPx = sizePt * pxPerPt;
  const font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  ctx.font = font;
  const width = Math.max(1, Math.ceil(ctx.measureText(text).width));
  const height = Math.ceil(fontPx * 1.3);
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
  ctx.fillText(text, 0, height / 2);
  const mmPerPx = 25.4 / 72 / pxPerPt;
  return { data: canvas.toDataURL('image/png'), wMm: width * mmPerPx, hMm: height * mmPerPx };
}

export const DEFAULT_PDF_DEPS: PdfDeps = {
  jsPDF,
  drawSvg: drawSvgWithSvg2pdf,
  rasterize: (source, options) => exportPng(source.model, source.geometry, options),
  textImage: canvasTextImage,
  loadFont: loadPdfFont,
};

const HEADER_GREY = 120;
const MARK_GREY = 80;
/** Overview grid lines: light, so the diagram under them stays readable. */
const GRID_GREY = 185;
/** Overview row / column labels (in the margins). */
const GRID_LABEL_GREY = 110;
/** Extra px around a node when deciding whether it shows on a tile (shadows, rings, badges). */
const CULL_MARGIN_PX = 16;
/** Device px per diagram px of a raster page. */
const RASTER_SCALE = 3;

/**
 * Numeric `font-weight`s → the two weights of the standard fonts, in markup only: attributes and
 * inline styles of tags, and `<style>` sheets. Text content (table, column and note text a user
 * typed, which may well say `font-weight: 700`) is left as it is.
 */
export function normalizeFontWeights(svg: string): string {
  return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>|<[^>]*>/g, normalizeWeightsIn);
}

function normalizeWeightsIn(markup: string): string {
  return markup
    .replace(/font-weight:\s*(\d+)/g, (_m, n: string) =>
      Number(n) >= 600 ? 'font-weight:bold' : 'font-weight:normal',
    )
    .replace(/font-weight="(\d+)"/g, (_m, n: string) =>
      Number(n) >= 600 ? 'font-weight="bold"' : 'font-weight="normal"',
    );
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Removes tables, notes and groups that lie entirely outside `visible` (keeps refs). */
function cull(svg: Element, geometry: DiagramGeometry, visible: PlannedPage['visiblePx']): void {
  const area = {
    x: visible.x - CULL_MARGIN_PX,
    y: visible.y - CULL_MARGIN_PX,
    width: visible.width + 2 * CULL_MARGIN_PX,
    height: visible.height + 2 * CULL_MARGIN_PX,
  };
  for (const el of Array.from(
    svg.querySelectorAll('[data-rv-table],[data-rv-note],[data-rv-group]'),
  )) {
    const id =
      el.getAttribute('data-rv-table') ??
      el.getAttribute('data-rv-note') ??
      el.getAttribute('data-rv-group');
    if (id === null) continue;
    const box = el.hasAttribute('data-rv-group') ? geometry.groups[id] : geometry.nodes[id];
    if (box && !intersects(box, area)) el.parentNode?.removeChild(el);
  }
}

/** Whether a `<text>` is drawn bold (weights are normalized to normal / bold by then). */
function isBold(el: Element): boolean {
  for (let n: Element | null = el; n && n.tagName.toLowerCase() !== 'svg'; n = n.parentElement) {
    const m = /font-weight:\s*(\w+)/.exec(n.getAttribute('style') ?? '');
    const w = m?.[1] ?? n.getAttribute('font-weight');
    if (w) return w === 'bold' || Number(w) >= 600;
  }
  return false;
}

/**
 * The characters a `<text>` draws: its text nodes and those of its `<tspan>`s. `<title>` (a table
 * name's tooltip, with the table note) and `<desc>` are never drawn, so their text does not count.
 */
function drawnText(el: Element): string {
  let out = '';
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.nodeValue ?? '';
    else if (n.nodeType === 1) {
      const tag = (n as Element).tagName.toLowerCase();
      if (tag !== 'title' && tag !== 'desc') out += drawnText(n as Element);
    }
  }
  return out;
}

/**
 * Each `<text>` the page draws with characters outside WinAnsi, with the bundled font that covers
 * it (null: none does).
 */
function unicodeTexts(svg: Element): Array<{ el: Element; font: PdfFontId | null }> {
  const out: Array<{ el: Element; font: PdfFontId | null }> = [];
  for (const el of Array.from(svg.getElementsByTagName('text'))) {
    const text = drawnText(el);
    if (!isWinAnsi(text)) out.push({ el, font: unicodeFontFor(text, isBold(el)) });
  }
  return out;
}

function withoutFont(style: string): string {
  return style
    .split(';')
    .filter((d) => d.trim() && !/^\s*font-(family|weight)\s*:/.test(d))
    .join(';');
}

/**
 * Switches every `<text>` that needs it to its embedded font, NFC-normalized as the font was
 * chosen. False (the clone is then discarded) when some text has no embedded font.
 */
function useUnicodeFonts(svg: Element, embedded: ReadonlySet<PdfFontId>): boolean {
  const texts = unicodeTexts(svg);
  if (texts.some((t) => t.font === null || !embedded.has(t.font))) return false;
  for (const { el, font } of texts) {
    const { family, style } = PDF_FONTS[font!];
    const decl = `font-family:${family};font-weight:${style}`;
    const own = withoutFont(el.getAttribute('style') ?? '');
    el.setAttribute('style', own ? `${own};${decl}` : decl);
    for (const child of Array.from(el.getElementsByTagName('*'))) {
      const s = child.getAttribute('style');
      if (s !== null) child.setAttribute('style', withoutFont(s));
      child.removeAttribute('font-family');
      child.removeAttribute('font-weight');
    }
    el.removeAttribute('font-family');
    el.removeAttribute('font-weight');
    const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      t.data = t.data.normalize('NFC');
    }
  }
  return true;
}

/** Fonts registered with jsPDF for this document, and a cleanup for the browser FontFaces. */
interface EmbeddedFonts {
  fonts: Set<PdfFontId>;
  dispose: () => void;
}

/**
 * Loads and registers the bundled fonts in `wanted` (each once, in parallel). A font that fails to
 * load is left out, and its text falls back to raster. In a browser each font is also added to
 * `document.fonts` under its PDF family name for the export's duration, so svg2pdf measures
 * centred and right-aligned text in the font the PDF draws it with.
 */
async function embedFonts(
  doc: jsPDF,
  deps: PdfDeps,
  wanted: ReadonlySet<PdfFontId>,
): Promise<EmbeddedFonts> {
  const fonts = new Set<PdfFontId>();
  const faces: FontFace[] = [];
  const loaded = await Promise.all(
    [...wanted].map((id) =>
      deps.loadFont(id).then(
        (bytes) => ({ id, bytes }),
        () => null,
      ),
    ),
  );
  for (const entry of loaded) {
    if (!entry) continue;
    const { id, bytes } = entry;
    const { family, style, weight } = PDF_FONTS[id];
    const file = `relvista-${id}.ttf`;
    try {
      doc.addFileToVFS(file, bytesToBinaryString(bytes));
      doc.addFont(file, family, style, undefined, 'Identity-H');
      fonts.add(id);
    } catch {
      continue;
    }
    if (typeof FontFace === 'function' && typeof document !== 'undefined' && document.fonts) {
      try {
        const face = new FontFace(family, bytes.slice().buffer, { weight: String(weight) });
        await face.load();
        document.fonts.add(face);
        faces.push(face);
      } catch {
        // svg2pdf then measures with a fallback font: anchored text is a little off, no more.
      }
    }
  }
  return {
    fonts,
    dispose: () => {
      for (const face of faces) document.fonts.delete(face);
    },
  };
}

function toBytes(data: Blob | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return Promise.resolve(data);
  if (typeof data.arrayBuffer === 'function')
    return data.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('relvista: could not read the PNG'));
    reader.readAsArrayBuffer(data);
  });
}

function winAnsiOrQuestion(text: string): string {
  let out = '';
  for (const ch of text) out += isWinAnsi(ch) ? ch : '?';
  return out;
}

/** Shortens `text` with '…' until it is at most `maxMm` wide in the current font. */
function fitText(doc: jsPDF, text: string, maxMm: number): string {
  if (doc.getTextWidth(text) <= maxMm) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(chars.slice(0, mid).join('') + '…') <= maxMm) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('') + '…';
}

function drawHeaderText(
  doc: jsPDF,
  deps: PdfDeps,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'right',
  maxMm: number,
  embedded: ReadonlySet<PdfFontId>,
): void {
  if (!text) return;
  if (isWinAnsi(text)) {
    doc.text(fitText(doc, text, maxMm), x, y, { align, baseline: 'middle' });
    return;
  }
  const font = unicodeFontFor(text, false);
  if (font && embedded.has(font)) {
    const { family, style } = PDF_FONTS[font];
    doc.setFont(family, style);
    doc.text(fitText(doc, text.normalize('NFC'), maxMm), x, y, { align, baseline: 'middle' });
    doc.setFont('helvetica', 'normal');
    return;
  }
  const img = deps.textImage(text, HEADER_FONT_PT, HEADER_GREY);
  if (img) {
    const scale = Math.min(1, maxMm / img.wMm);
    const w = img.wMm * scale;
    const h = img.hMm * scale;
    doc.addImage(img.data, 'PNG', align === 'right' ? x - w : x, y - h / 2, w, h);
    return;
  }
  doc.text(fitText(doc, winAnsiOrQuestion(text), maxMm), x, y, { align, baseline: 'middle' });
}

function drawHeader(
  doc: jsPDF,
  deps: PdfDeps,
  page: PlannedPage,
  embedded: ReadonlySet<PdfFontId>,
): void {
  const m = PAGE_MARGIN_MM;
  const y = m + 1.6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(HEADER_FONT_PT);
  doc.setTextColor(HEADER_GREY);
  const width = page.pageMm.w - 2 * m;
  const rightW = Math.min(width * 0.6, doc.getTextWidth(winAnsiOrQuestion(page.header.right)));
  const right = page.header.right;
  drawHeaderText(doc, deps, right, page.pageMm.w - m, y, 'right', width * 0.6, embedded);
  const leftW = Math.max(10, width - rightW - 4);
  drawHeaderText(doc, deps, page.header.left, m, y, 'left', leftW, embedded);
  doc.setDrawColor(210);
  doc.setLineWidth(0.15);
  doc.line(m, m + 3.4, page.pageMm.w - m, m + 3.4);
}

function drawMarks(doc: jsPDF, marks: readonly MarkPrimitive[], overview: boolean): void {
  if (marks.length === 0) return;
  doc.setDrawColor(overview ? GRID_GREY : MARK_GREY);
  doc.setTextColor(overview ? GRID_LABEL_GREY : MARK_GREY);
  doc.setLineWidth(overview ? 0.2 : 0.15);
  doc.setFont('helvetica', 'normal');
  for (const p of marks) {
    if (p.kind === 'line') doc.line(p.x1, p.y1, p.x2, p.y2);
    else if (p.kind === 'circle') doc.circle(p.cx, p.cy, p.r, 'S');
    else if (p.kind === 'rect') doc.rect(p.x, p.y, p.w, p.h, 'S');
    else {
      doc.setFontSize(p.sizePt);
      doc.text(p.text, p.x, p.y, { align: p.align, baseline: 'middle' });
    }
  }
}

interface PreparedSource {
  source: PdfPageSource;
  /** Parsed SVG root, cloned per page. */
  svg: Element;
  pngOptions: PngExportOptions;
  png?: Promise<Uint8Array>;
}

function prepare(source: PdfPageSource, options: PdfOptions): PreparedSource {
  const font = standardFontFor(options.palette?.font, 'helvetica');
  const mono = standardFontFor(options.palette?.mono, 'courier');
  const common: SvgExportOptions = {
    colorMode: 'light',
    padding: PDF_DIAGRAM_PADDING,
    background: false,
    ...(options.detailLevel ? { detailLevel: options.detailLevel } : {}),
    ...(options.edgeStyle ? { edgeStyle: options.edgeStyle } : {}),
    ...(source.decorations ? { decorations: source.decorations } : {}),
  };
  const text = renderDiagramSvgString(source.model, source.geometry, {
    ...common,
    // Print is always light: only the palette's fonts carry over, mapped to the standard fonts.
    palette: { font, mono },
  });
  const doc = new DOMParser().parseFromString(
    normalizeFontWeights(pdfSafeText(text)),
    'image/svg+xml',
  );
  const pngPalette = {
    ...(options.palette?.font ? { font: options.palette.font } : {}),
    ...(options.palette?.mono ? { mono: options.palette.mono } : {}),
  };
  return {
    source,
    svg: doc.documentElement,
    pngOptions: {
      ...common,
      scale: RASTER_SCALE,
      ...(Object.keys(pngPalette).length > 0 ? { palette: pngPalette } : {}),
    },
  };
}

/**
 * Writes the PDF: per planned page the running header, the diagram (vector through svg2pdf, or
 * the 3× raster when its text needs characters outside WinAnsi) clipped to the page's region, and
 * the marks. `exportPdf` / `exportPdfWithReport` call this after loading the module.
 */
export async function renderPdf(
  sources: readonly PdfPageSource[],
  options: PdfOptions,
  deps: Partial<PdfDeps> = {},
): Promise<PdfExportResult> {
  const d: PdfDeps = { ...DEFAULT_PDF_DEPS, ...deps };
  if (sources.length === 0) throw new Error('relvista: nothing to export to PDF');
  const paper = options.paper ?? defaultPaper();
  const plan = planDocument(
    sources.map((s) => ({
      title: s.title,
      bounds: s.geometry.bounds,
      content: contentBoxes(s.geometry),
    })),
    { ...options, paper },
  );
  const first = plan[0]!;
  const doc = new d.jsPDF({
    unit: 'mm',
    format: paper,
    orientation: first.orientation,
    compress: options.compress ?? true,
    putOnlyUsedFonts: true,
  });
  const title = options.title ?? sources[0]!.title;
  doc.setDocumentProperties({
    title: winAnsiOrQuestion(title),
    creator: 'relvista',
    subject: 'Entity-relationship diagram',
  });
  const prepared = sources.map((s) => prepare(s, options));
  let rasterPages = 0;

  // Text outside WinAnsi: load just the fonts that cover it (none for a WinAnsi-only document).
  const wanted = new Set<PdfFontId>();
  if (options.embedFonts !== false) {
    for (const p of prepared) for (const t of unicodeTexts(p.svg)) if (t.font) wanted.add(t.font);
    for (const page of plan) {
      for (const text of [page.header.left, page.header.right]) {
        const font = isWinAnsi(text) ? null : unicodeFontFor(text, false);
        if (font) wanted.add(font);
      }
    }
  }
  const embedded: EmbeddedFonts =
    wanted.size > 0
      ? await embedFonts(doc, d, wanted)
      : { fonts: new Set(), dispose: () => undefined };
  try {
    for (let i = 0; i < plan.length; i++) {
      if (await drawPage(doc, d, plan[i]!, i, prepared, paper, embedded.fonts)) rasterPages++;
    }
  } finally {
    embedded.dispose();
  }

  return { blob: doc.output('blob'), pageCount: plan.length, rasterPages };
}

/** Draws one planned page; true when it had to be a raster. */
async function drawPage(
  doc: jsPDF,
  d: PdfDeps,
  page: PlannedPage,
  i: number,
  prepared: readonly PreparedSource[],
  paper: PaperSize,
  embedded: ReadonlySet<PdfFontId>,
): Promise<boolean> {
  if (i > 0) doc.addPage(paper, page.orientation);
  const src = prepared[page.source]!;
  const svg = src.svg.cloneNode(true) as Element;
  if (page.kind === 'tile') cull(svg, src.source.geometry, page.visiblePx);
  const raster = !useUnicodeFonts(svg, embedded);

  doc.saveGraphicsState();
  doc.rect(page.clip.x, page.clip.y, page.clip.w, page.clip.h, null);
  doc.clip();
  doc.discardPath();
  if (raster && page.kind === 'tile') {
    // Only the tile's region, at full raster scale: the image covers exactly the clip.
    const region: PdfPageSource = {
      ...src.source,
      geometry: { ...src.source.geometry, bounds: page.visiblePx },
    };
    const bytes = await toBytes(await d.rasterize(region, { ...src.pngOptions, padding: 0 }));
    doc.addImage(bytes, 'PNG', page.clip.x, page.clip.y, page.clip.w, page.clip.h);
  } else if (raster) {
    src.png ??= d.rasterize(src.source, src.pngOptions).then(toBytes);
    const bytes = await src.png;
    doc.addImage(
      bytes,
      'PNG',
      page.draw.x,
      page.draw.y,
      page.draw.w,
      page.draw.h,
      `rv-diagram-${page.source}`,
    );
  } else {
    await d.drawSvg(svg, doc, {
      x: page.draw.x,
      y: page.draw.y,
      width: page.draw.w,
      height: page.draw.h,
    });
  }
  doc.restoreGraphicsState();

  drawHeader(doc, d, page, embedded);
  drawMarks(doc, page.marks, page.kind === 'overview');
  return raster;
}
