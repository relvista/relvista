// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDbml, selectView, type DiagramModel } from '@relvista/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OVERLAP_MM,
  MAX_PDF_PAGES,
  PdfPageLimitError,
  defaultPaper,
  exportPdf,
  exportPdfWithReport,
  isWinAnsi,
  planDocument,
  planTiles,
  tileLabel,
  type PdfPageSource,
} from '../src/export/pdf/index.js';
import { normalizeFontWeights, renderPdf } from '../src/export/pdf/impl.js';
import {
  contentBox,
  contentBoxes,
  mmPerPx,
  paddedBounds,
  pageSizeMm,
  pdfSafeText,
  standardFontFor,
  tileMarks,
} from '../src/export/pdf/plan.js';
import type * as PngModule from '../src/export/png.js';
import { layoutSync } from '../src/geometry.js';

// svg2pdf.js's `main` is a UMD build that expects a global jsPDF; bundlers (Vite, webpack) pick its
// ES `module` build, so the test does the same.
vi.mock('svg2pdf.js', async () => {
  // @ts-expect-error the ES build has no own type declarations
  return await import('svg2pdf.js/dist/svg2pdf.es.min.js');
});

// 1×1 PNG: jsdom has no canvas, so the raster path's exportPng is replaced.
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);
const exportPngMock = vi.hoisted(() => vi.fn());
vi.mock('../src/export/png.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PngModule>()),
  exportPng: exportPngMock,
}));

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../examples');

beforeAll(() => {
  // jsdom has no canvas; returning null (as browsers do when out of memory) keeps it quiet.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  // svg2pdf measures anchored text with getBBox, which jsdom lacks: 0.55 em per character.
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = function (
    this: SVGElement,
  ) {
    const size = parseFloat(this.getAttribute('font-size') ?? '16') || 16;
    const width = (this.textContent ?? '').length * size * 0.55;
    return { x: 0, y: 0, width, height: size } as DOMRect;
  };
});

function model(text: string): DiagramModel {
  const { model: m } = compileDbml(text);
  if (!m) throw new Error('does not compile');
  return m;
}

function source(title: string, m: DiagramModel): PdfPageSource {
  return { title, model: m, geometry: layoutSync(m) };
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      resolvePromise(s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function pdfPages(pdf: string): number {
  return (pdf.match(/\/Type \/Page(?![s\w])/g) ?? []).length;
}

function mediaBoxes(pdf: string): Array<[number, number]> {
  return [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [
    Math.round(Number(m[1])),
    Math.round(Number(m[2])),
  ]);
}

const A4_PT: [number, number] = [595, 842];
const A4_LANDSCAPE_PT: [number, number] = [842, 595];
const LETTER_PT: [number, number] = [612, 792];

// ---------------------------------------------------------------------------------------------

describe('planTiles', () => {
  const k = mmPerPx(0.75);
  const px = (mm: number) => mm / k;

  it('content boxes: 10 mm margins and a 5 mm header band', () => {
    expect(contentBox(pageSizeMm('a4', 'portrait'))).toEqual({
      x: 10,
      y: 15,
      width: 190,
      height: 272,
    });
    expect(contentBox(pageSizeMm('a4', 'landscape'))).toEqual({
      x: 10,
      y: 15,
      width: 277,
      height: 185,
    });
    const letter = contentBox(pageSizeMm('letter', 'portrait'));
    expect(letter.width).toBeCloseTo(195.9, 6);
    expect(letter.height).toBeCloseTo(254.4, 6);
  });

  it('a diagram that fits is one tile, in the orientation of its aspect', () => {
    const wide = planTiles({ x: 0, y: 0, width: 600, height: 400 }, { paper: 'a4' });
    expect(wide).toMatchObject({ orientation: 'landscape', rows: 1, cols: 1 });
    expect(wide.pageMm).toEqual({ w: 297, h: 210 });
    expect(wide.tiles).toEqual([{ row: 0, col: 0, x: 0, y: 0, w: 158.75, h: 105.833 }]);
    const tall = planTiles({ x: 0, y: 0, width: 400, height: 600 }, { paper: 'a4' });
    expect(tall).toMatchObject({ orientation: 'portrait', rows: 1, cols: 1 });
    // Exactly the content width still fits.
    expect(
      planTiles(
        { x: 0, y: 0, width: px(190), height: 100 },
        { paper: 'a4', orientation: 'portrait' },
      ).cols,
    ).toBe(1);
  });

  it('picks the orientation with fewer pages', () => {
    // 1500 × 400 px = 396.875 × 105.833 mm.
    const plan = planTiles({ x: 0, y: 0, width: 1500, height: 400 }, { paper: 'a4' });
    expect(plan).toMatchObject({ orientation: 'landscape', rows: 1, cols: 2 });
    expect(plan.tiles).toEqual([
      { row: 0, col: 0, x: 0, y: 0, w: 277, h: 105.833 },
      { row: 0, col: 1, x: 267, y: 0, w: 129.875, h: 105.833 },
    ]);
    const portrait = planTiles(
      { x: 0, y: 0, width: 1500, height: 400 },
      { paper: 'a4', orientation: 'portrait' },
    );
    expect(portrait).toMatchObject({ orientation: 'portrait', rows: 1, cols: 3 });
    expect(portrait.tiles.map((t) => t.x)).toEqual([0, 180, 360]);
    // 400 × 2000 px: portrait needs 2 rows, landscape 3.
    expect(planTiles({ x: 0, y: 0, width: 400, height: 2000 }, { paper: 'a4' })).toMatchObject({
      orientation: 'portrait',
      rows: 2,
      cols: 1,
    });
  });

  it('exact grids for known sizes, scales and overlaps', () => {
    // 1000 × 1000 mm at 100 %: landscape 4 cols (267 step) × 6 rows (175 step) = 24; portrait
    // 6 cols (180) × 4 rows (262) = 24 → tie, square → portrait.
    const square = planTiles({ x: 0, y: 0, width: px(1000), height: px(1000) }, { paper: 'a4' });
    expect(square).toMatchObject({ orientation: 'portrait', rows: 4, cols: 6 });
    expect(square.tiles).toHaveLength(24);
    // Row-major order and labels.
    expect(square.tiles[7]).toMatchObject({ row: 1, col: 1, x: 180, y: 262 });
    expect(tileLabel(1, 1)).toBe('B2');
    // Last column / row are cut to the diagram.
    expect(square.tiles[5]!.w).toBeCloseTo(1000 - 5 * 180, 3);
    expect(square.tiles[23]!.h).toBeCloseTo(1000 - 3 * 262, 3);
    // No overlap: 1000/190 → 6 cols, 1000/272 → 4 rows.
    const flush = planTiles(
      { x: 0, y: 0, width: px(1000), height: px(1000) },
      { paper: 'a4', orientation: 'portrait', overlapMm: 0 },
    );
    expect(flush).toMatchObject({ rows: 4, cols: 6 });
    expect(flush.tiles[1]!.x).toBe(190);
    // Overlap 30 mm: steps 160 / 242.
    const wide = planTiles(
      { x: 0, y: 0, width: px(1000), height: px(1000) },
      { paper: 'a4', orientation: 'portrait', overlapMm: 30 },
    );
    expect(wide).toMatchObject({ rows: 5, cols: 7 });
    expect(wide.tiles[1]!.x).toBe(160);
    expect(wide.tiles[7]!.y).toBe(242);
    // Scale 1.5 doubles the printed size to 317.5 × 211.667 mm: portrait 2 × 1, landscape 2 × 2.
    const big = planTiles({ x: 0, y: 0, width: 600, height: 400 }, { paper: 'a4', scale: 1.5 });
    expect(big).toMatchObject({ orientation: 'portrait', rows: 1, cols: 2 });
    // Letter paper.
    const letter = planTiles(
      { x: 0, y: 0, width: px(400), height: px(400) },
      { paper: 'letter', orientation: 'portrait' },
    );
    expect(letter).toMatchObject({ rows: 2, cols: 3 });
    expect(letter.pageMm).toEqual({ w: 215.9, h: 279.4 });
  });

  it('defaults: overlap 10 mm, scale 0.75, bad numbers fall back', () => {
    expect(DEFAULT_OVERLAP_MM).toBe(10);
    const a = planTiles({ x: 0, y: 0, width: 1500, height: 400 }, { paper: 'a4' });
    const b = planTiles(
      { x: 0, y: 0, width: 1500, height: 400 },
      { paper: 'a4', scale: NaN, overlapMm: Infinity },
    );
    expect(b).toEqual(a);
    expect(planTiles({ x: 0, y: 0, width: 0, height: 0 }, { paper: 'a4' }).tiles).toHaveLength(1);
  });
});

describe('defaultPaper', () => {
  it('letter for en-US, en-CA and es-MX, else A4', () => {
    for (const l of ['en-US', 'en-us', 'en_CA', 'es-MX', 'en-US-u-ca-gregory'])
      expect(defaultPaper(l)).toBe('letter');
    for (const l of ['en-GB', 'es-ES', 'fr-CA', 'de', 'en', '']) expect(defaultPaper(l)).toBe('a4');
    expect(defaultPaper()).toBe(/^(en-us|en-ca|es-mx)/i.test(navigator.language) ? 'letter' : 'a4');
  });
});

describe('labels, marks and headers', () => {
  it('labels rows A…Z, AA…', () => {
    expect(tileLabel(0, 0)).toBe('A1');
    expect(tileLabel(25, 9)).toBe('Z10');
    expect(tileLabel(26, 0)).toBe('AA1');
    expect(tileLabel(27, 1)).toBe('AB2');
  });

  it('marks every neighbour: ticks, registration marks and labels in the margins', () => {
    const k = mmPerPx(0.75);
    const plan = planTiles(
      { x: 0, y: 0, width: 600 / k, height: 700 / k },
      { paper: 'a4', orientation: 'portrait' },
    );
    expect(plan).toMatchObject({ rows: 3, cols: 4 });
    const centre = plan.tiles.find((t) => t.row === 1 && t.col === 1)!;
    const marks = tileMarks(plan, centre, 10);
    const labels = marks.filter((m) => m.kind === 'label').map((m) => (m as { text: string }).text);
    expect(labels.sort()).toEqual(['A2', 'B1', 'B3', 'C2']);
    // Two vertical bands × 1 registration mark + two horizontal bands × 2 (both side margins).
    expect(marks.filter((m) => m.kind === 'circle')).toHaveLength(6);
    // Ticks: 2 per vertical band, 4 per horizontal band.
    const circles = marks.filter((m) => m.kind === 'circle').length;
    expect(marks.filter((m) => m.kind === 'line')).toHaveLength(2 * 2 + 2 * 4 + circles * 2);
    // Every mark stays on the page and out of the content box.
    const c = contentBox(plan.pageMm);
    for (const m of marks) {
      if (m.kind === 'circle') {
        const inside = m.cx > c.x && m.cx < c.x + centre.w && m.cy > c.y && m.cy < c.y + centre.h;
        expect(inside).toBe(false);
        expect(m.cx - m.r).toBeGreaterThan(0);
        expect(m.cx + m.r).toBeLessThan(plan.pageMm.w);
        expect(m.cy + m.r).toBeLessThan(plan.pageMm.h);
      }
    }
    // The crop ticks of the band to the right sit at the right content edge, overlap apart.
    const right = marks.filter(
      (m) =>
        m.kind === 'line' &&
        m.x1 === m.x2 &&
        Math.abs(m.y2 - m.y1 - 4) < 1e-9 &&
        m.x1 > c.x + centre.w / 2,
    ) as Array<{ x1: number }>;
    expect(right.map((m) => m.x1).sort((a, b) => a - b)).toEqual([
      c.x + centre.w - 10,
      c.x + centre.w,
    ]);
    // A corner tile has two neighbours.
    const corner = tileMarks(plan, plan.tiles[0]!, 10).filter((m) => m.kind === 'label');
    expect(corner.map((m) => (m as { text: string }).text).sort()).toEqual(['A2', 'B1']);
  });

  it('plans an overview page first, tile pages with labels and headers', () => {
    const pages = planDocument(
      [{ title: 'billing', bounds: { x: 0, y: 0, width: 1500, height: 400 } }],
      {
        mode: 'tiled',
        paper: 'a4',
        title: 'Storefront',
      },
    );
    expect(pages.map((p) => p.kind)).toEqual(['overview', 'tile', 'tile']);
    expect(pages[0]!.header).toEqual({
      left: 'Storefront — billing',
      right: 'Overview · 1 × 2 pages · 1/3 · relvista',
    });
    expect(pages[1]!.header.right).toBe('A1 (row A, column 1) · 2/3 · relvista');
    expect(pages[2]!.label).toBe('A2');
    // The overview: a frame, one thin line per tile boundary, and the row letters and column
    // numbers in the margins outside the drawing (never over a table).
    const ov = pages[0]!;
    const grid = ov.marks;
    expect(grid.filter((m) => m.kind === 'rect')).toEqual([
      { kind: 'rect', x: ov.draw.x, y: ov.draw.y, w: ov.draw.w, h: ov.draw.h },
    ]);
    expect(grid.filter((m) => m.kind === 'line')).toHaveLength(1);
    const labels = grid.filter((m) => m.kind === 'label') as Array<{
      text: string;
      x: number;
      y: number;
    }>;
    expect(labels.map((m) => m.text)).toEqual(['1', '2', 'A']);
    for (const l of labels) expect(l.x < ov.draw.x || l.y < ov.draw.y).toBe(true);
    // Tile 2 draws the diagram shifted left by its x and clips to its own size.
    const t = pages[2]!;
    expect(t.clip).toEqual({ x: 10, y: 15, w: expect.any(Number), h: expect.any(Number) });
    expect(t.draw.x).toBeCloseTo(10 - 267, 6);
    expect(t.marks.some((m) => m.kind === 'circle')).toBe(true);
  });

  it('skips cells no table reaches; labels keep their grid position; the overview crosses them out', () => {
    // A 3 × 1 strip (A1 A2 A3) with tables only at its two ends: A2 holds just ref lines.
    const bounds = { x: 0, y: 0, width: 2500, height: 400 };
    const content = [
      { x: 20, y: 20, width: 200, height: 300 },
      { x: 2280, y: 20, width: 200, height: 300 },
    ];
    const options = {
      mode: 'tiled' as const,
      paper: 'a4' as const,
      orientation: 'landscape' as const,
    };
    const full = planTiles(paddedBounds(bounds), options);
    expect(full.cols).toBe(3);
    const plan = planTiles(paddedBounds(bounds), {
      ...options,
      content: content.map((b) => ({ ...b })),
    });
    expect(plan.tiles.map((t) => tileLabel(t.row, t.col))).toEqual(['A1', 'A3']);
    expect(plan.skipped.map((t) => tileLabel(t.row, t.col))).toEqual(['A2']);
    expect(
      planTiles(paddedBounds(bounds), { ...options, content, skipEmpty: false }).tiles,
    ).toHaveLength(3);
    const pages = planDocument([{ title: 'v', bounds, content }], options);
    expect(pages.map((p) => p.label ?? p.kind)).toEqual(['overview', 'A1', 'A3']);
    expect(pages[0]!.header.right).toBe(
      'Overview · 1 × 3 pages, 1 empty left out · 1/3 · relvista',
    );
    // No marks or neighbour label towards the skipped A2.
    const labelsOf = (p: (typeof pages)[number]) =>
      p.marks.filter((m) => m.kind === 'label').map((m) => (m as { text: string }).text);
    expect(labelsOf(pages[1]!)).toEqual([]);
    expect(labelsOf(pages[2]!)).toEqual([]);
    // The overview crosses A2 out: two diagonals besides the two boundary lines.
    expect(pages[0]!.marks.filter((m) => m.kind === 'line')).toHaveLength(4);
  });

  it('every content box lands on a printed tile (14-large, several scales)', () => {
    const large = model(readFileSync(join(examplesDir, '14-large.dbml'), 'utf8'));
    const geometry = layoutSync(large);
    const content = contentBoxes(geometry);
    const px = paddedBounds(geometry.bounds);
    for (const scale of [0.75, 1.5]) {
      const plan = planTiles(px, { paper: 'letter', scale, content });
      const k = (scale * 25.4) / 72;
      const shown = plan.tiles.map((t) => ({
        x0: px.x + t.x / k,
        y0: px.y + t.y / k,
        x1: px.x + (t.x + t.w) / k,
        y1: px.y + (t.y + t.h) / k,
      }));
      // Sample each box on a grid of points: each one is inside some printed tile.
      for (const b of content)
        for (let i = 0; i <= 4; i++)
          for (let j = 0; j <= 4; j++) {
            const x = b.x + (b.width * i) / 4;
            const y = b.y + (b.height * j) / 4;
            expect(
              shown.some(
                (r) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && y >= r.y0 - 1e-6 && y <= r.y1 + 1e-6,
              ),
            ).toBe(true);
          }
      expect(plan.tiles.length + plan.skipped.length).toBe(plan.rows * plan.cols);
    }
  });

  it('no overview for one tile or overview: false; marks: false drops marks and labels', () => {
    const one = planDocument([{ title: 'v', bounds: { x: 0, y: 0, width: 100, height: 100 } }], {
      mode: 'tiled',
      paper: 'a4',
    });
    expect(one.map((p) => p.kind)).toEqual(['tile']);
    expect(one[0]!.header).toEqual({ left: 'v', right: 'relvista' });
    expect(one[0]!.marks).toEqual([]);
    const bounds = { x: 0, y: 0, width: 1500, height: 400 };
    const noOverview = planDocument([{ title: 'v', bounds }], {
      mode: 'tiled',
      paper: 'a4',
      overview: false,
    });
    expect(noOverview.map((p) => p.kind)).toEqual(['tile', 'tile']);
    const noMarks = planDocument([{ title: 'v', bounds }], {
      mode: 'tiled',
      paper: 'a4',
      marks: false,
    });
    expect(noMarks.filter((p) => p.kind === 'tile').every((p) => p.marks.length === 0)).toBe(true);
    expect(noMarks[1]!.header.right).toBe('2/3 · relvista');
  });

  it("'pages' mode: one page per source, each in its best orientation", () => {
    const pages = planDocument(
      [
        { title: 'wide', bounds: { x: 0, y: 0, width: 3000, height: 1000 } },
        { title: 'tall', bounds: { x: 0, y: 0, width: 500, height: 2000 } },
        { title: 'tiny', bounds: { x: 0, y: 0, width: 50, height: 20 } },
      ],
      { mode: 'pages', paper: 'letter' },
    );
    expect(pages.map((p) => [p.kind, p.orientation])).toEqual([
      ['fit', 'landscape'],
      ['fit', 'portrait'],
      ['fit', 'landscape'],
    ]);
    const c = contentBox(pages[0]!.pageMm);
    expect(pages[0]!.draw.w).toBeCloseTo(c.width, 6);
    // A tiny diagram is not blown up past 200 %.
    expect(pages[2]!.draw.w).toBeCloseTo((50 + 24) * mmPerPx(1.5), 6);
  });

  it(`refuses more than ${MAX_PDF_PAGES} pages with a hint`, async () => {
    const huge = { x: 0, y: 0, width: 40000, height: 40000 };
    expect(() =>
      planDocument([{ title: 'v', bounds: huge }], { mode: 'tiled', paper: 'a4' }),
    ).toThrow(PdfPageLimitError);
    expect(() =>
      planDocument([{ title: 'v', bounds: huge }], { mode: 'tiled', paper: 'a4' }),
    ).toThrow(/lower the print scale/);
    const m = model('Table a { id int }');
    const src: PdfPageSource = {
      title: 'v',
      model: m,
      geometry: { ...layoutSync(m), bounds: huge },
    };
    // (skipEmpty: false: with it, the one small table would make this a one-page PDF.)
    await expect(
      exportPdf([src], { mode: 'tiled', paper: 'a4', skipEmpty: false }),
    ).rejects.toBeInstanceOf(PdfPageLimitError);
    // Small enough at a lower scale.
    expect(
      planDocument([{ title: 'v', bounds: huge }], { mode: 'tiled', paper: 'a4', scale: 0.05 })
        .length,
    ).toBeLessThanOrEqual(MAX_PDF_PAGES);
  });

  it('WinAnsi check, typographic substitutes and standard fonts', () => {
    expect(isWinAnsi('users · façade — “quoted” € …')).toBe(true);
    expect(isWinAnsi('用户')).toBe(false);
    expect(isWinAnsi('😀')).toBe(false);
    expect(isWinAnsi('Ω')).toBe(false);
    expect(isWinAnsi('+2 −1')).toBe(false);
    expect(isWinAnsi(pdfSafeText('+2 −1 ~3'))).toBe(true);
    expect(
      standardFontFor(
        "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        'times',
      ),
    ).toBe('helvetica');
    expect(
      standardFontFor("ui-monospace, 'SF Mono', Menlo, Consolas, monospace", 'helvetica'),
    ).toBe('courier');
    expect(standardFontFor('Georgia, serif', 'helvetica')).toBe('times');
    expect(standardFontFor('"IBM Plex Sans", sans-serif', 'courier')).toBe('helvetica');
    expect(standardFontFor('Fancy', 'courier')).toBe('courier');
    expect(standardFontFor(undefined, 'helvetica')).toBe('helvetica');
  });
});

// ---------------------------------------------------------------------------------------------

// svg2pdf is slow on a loaded CI machine: a generous per-test timeout.
describe('exportPdf (jsPDF + svg2pdf.js, uncompressed)', { timeout: 30_000 }, () => {
  const ecommerce = model(readFileSync(join(examplesDir, '02-ecommerce.dbml'), 'utf8'));

  it('one diagram that fits: one page, table names as text, standard fonts only', async () => {
    exportPngMock.mockReset();
    const src = source('storefront', ecommerce);
    const { blob, pageCount, rasterPages } = await exportPdfWithReport([src], {
      mode: 'pages',
      paper: 'a4',
      compress: false,
      title: 'Storefront',
    });
    expect(blob.type).toBe('application/pdf');
    const pdf = await readBlob(blob);
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pageCount).toBe(1);
    expect(rasterPages).toBe(0);
    expect(pdfPages(pdf)).toBe(1);
    for (const t of ecommerce.tables) expect(pdf).toContain(`(${t.name})`);
    expect(pdf).toContain('(relvista)');
    expect(pdf).toContain('(Storefront \x97 storefront)'); // em dash in WinAnsi
    const fonts = new Set([...pdf.matchAll(/\/BaseFont \/([\w-]+)/g)].map((m) => m[1]));
    expect([...fonts].every((f) => /^(Helvetica|Courier)/.test(f!))).toBe(true);
    expect(fonts.has('Courier')).toBe(true); // column types
    expect(pdf).not.toContain('/Subtype /Image');
    expect(exportPngMock).not.toHaveBeenCalled();
    expect(pdf).toContain('/Title (Storefront)');
    expect(pdf).toContain('/Creator (relvista)');
  });

  it('keeps user text that looks like a font weight (only markup weights are normalized)', async () => {
    expect(
      normalizeFontWeights(
        '<svg><style>.a{font-weight: 600}</style><text font-weight="700" style="font-weight:400">' +
          'font-weight: 700 and font-weight="600"</text></svg>',
      ),
    ).toBe(
      '<svg><style>.a{font-weight:bold}</style><text font-weight="bold" style="font-weight:normal">' +
        'font-weight: 700 and font-weight="600"</text></svg>',
    );
    const m = model(
      'Table t {\n  id int [note: "x"]\n  "font-weight: 700" int\n}\nNote n {\n  \'css: font-weight: 700\'\n}\n',
    );
    const { blob } = await exportPdfWithReport([source('t', m)], {
      mode: 'pages',
      compress: false,
    });
    const pdf = await readBlob(blob);
    expect(pdf).toContain('(font-weight: 700)');
    expect(pdf).not.toContain('font-weight:bold');
  });

  it('tiled: overview first, then every tile, all pages the planned size', async () => {
    const src = source('storefront', ecommerce);
    const options = { mode: 'tiled' as const, paper: 'a4' as const, scale: 2, compress: false };
    const plan = planDocument(
      [{ title: 'storefront', bounds: src.geometry.bounds, content: contentBoxes(src.geometry) }],
      options,
    );
    expect(plan.length).toBeGreaterThan(2);
    const { blob, pageCount } = await exportPdfWithReport([src], options);
    const pdf = await readBlob(blob);
    expect(pageCount).toBe(plan.length);
    expect(pdfPages(pdf)).toBe(plan.length);
    const expected = plan[0]!.orientation === 'landscape' ? A4_LANDSCAPE_PT : A4_PT;
    expect(mediaBoxes(pdf)).toEqual(plan.map(() => expected));
    expect(pdf.match(/\(Overview /g)).toHaveLength(1);
    expect(pdf.indexOf('(Overview ')).toBeLessThan(pdf.indexOf('(A1 \\(row A, column 1\\)'));
    for (const t of ecommerce.tables) expect(pdf).toContain(`(${t.name})`);
    // Tiles are clipped: a "re W n" clip precedes the drawing on every page.
    expect((pdf.match(/ re\nW\nn\n/g) ?? []).length).toBeGreaterThanOrEqual(plan.length);
    // Off-tile tables are culled, so the document is far smaller than N full drawings.
    const single = await readBlob(
      await exportPdf([src], { mode: 'pages', paper: 'a4', compress: false }),
    );
    expect(pdf.length).toBeLessThan(single.length * plan.length);
  });

  it("'pages' mode: one page per view, sized per orientation, letter paper", async () => {
    const views = model(readFileSync(join(examplesDir, '08-diagram-views.dbml'), 'utf8'));
    const names = ['full_view', 'sales_view', 'internal_view'];
    const sources = names.map((n) => source(n, selectView(views, n)!));
    const { blob, pageCount } = await exportPdfWithReport(sources, {
      mode: 'pages',
      paper: 'letter',
      orientation: 'portrait',
      compress: false,
    });
    const pdf = await readBlob(blob);
    expect(pageCount).toBe(3);
    expect(pdfPages(pdf)).toBe(3);
    expect(mediaBoxes(pdf)).toEqual([LETTER_PT, LETTER_PT, LETTER_PT]);
    for (const n of names) expect(pdf).toContain(`(${n})`);
    expect(pdf).toContain('(1/3 \xb7 relvista)');
  });

  // CJK has an embedded font (pdf-unicode.test.ts); `embedFonts: false` keeps 1.0's raster path.
  it('text outside WinAnsi: that page is embedded as a 3× PNG through exportPng', async () => {
    exportPngMock.mockReset();
    exportPngMock.mockResolvedValue(new Blob([PNG_1X1], { type: 'image/png' }));
    const latin = source('latin', ecommerce);
    const cjk = source(
      'cjk',
      model('Table 用户 { id int [pk] }\nTable ledger_lines { user_id int [ref: > 用户.id] }'),
    );
    const { blob, pageCount, rasterPages } = await exportPdfWithReport([latin, cjk], {
      mode: 'pages',
      paper: 'a4',
      compress: false,
      embedFonts: false,
    });
    expect(pageCount).toBe(2);
    expect(rasterPages).toBe(1);
    expect(exportPngMock).toHaveBeenCalledTimes(1);
    const [m, , opts] = exportPngMock.mock.calls[0]!;
    expect(m).toBe(cjk.model);
    expect(opts).toMatchObject({ scale: 3, colorMode: 'light' });
    const pdf = await readBlob(blob);
    // One image XObject (plus its alpha SMask), embedded once.
    expect(pdf.match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(1);
    expect(pdf.match(/\/SMask/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(pdf).toContain('(users)'); // the Latin page stays vector
    expect(pdf).not.toContain('(ledger_lines)'); // the CJK page is an image
  });

  it('tiled text outside WinAnsi: each tile is its own 3× raster of just its region', async () => {
    exportPngMock.mockReset();
    exportPngMock.mockResolvedValue(new Blob([PNG_1X1], { type: 'image/png' }));
    const cols = Array.from({ length: 60 }, (_, i) => `  列${i} int`).join('\n');
    const src = source('cjk', model(`Table 用户 {\n${cols}\n}`));
    const options = {
      mode: 'tiled' as const,
      paper: 'a4' as const,
      scale: 2,
      compress: false,
      embedFonts: false,
    };
    const plan = planDocument([{ title: 'cjk', bounds: src.geometry.bounds }], options);
    const tiles = plan.filter((p) => p.kind === 'tile');
    expect(tiles.length).toBeGreaterThan(1);
    const { rasterPages } = await exportPdfWithReport([src], options);
    expect(rasterPages).toBe(plan.length);
    const calls = exportPngMock.mock.calls as Array<
      [unknown, { bounds: unknown }, { scale: number; padding: number }]
    >;
    const tileCalls = calls.filter(([, , o]) => o.padding === 0);
    expect(tileCalls.map(([, g]) => g.bounds)).toEqual(tiles.map((t) => t.visiblePx));
    for (const [, , o] of tileCalls) expect(o.scale).toBe(3);
    // The overview still draws the whole diagram once.
    expect(calls.length - tileCalls.length).toBe(1);
  });

  it('header text outside WinAnsi is drawn as an image when possible, else with ?', async () => {
    const src = source('請求', model('Table a { id int }'));
    const textImage = vi.fn(() => ({
      data: `data:image/png;base64,${btoa(String.fromCharCode(...PNG_1X1))}`,
      wMm: 8,
      hMm: 3,
    }));
    const withImage = await readBlob(
      (
        await renderPdf(
          [src],
          { mode: 'pages', paper: 'a4', compress: false, embedFonts: false },
          { textImage },
        )
      ).blob,
    );
    expect(textImage).toHaveBeenCalledWith('請求', 7, expect.any(Number));
    expect(withImage).toContain('/Subtype /Image');
    const fallback = await readBlob(
      (
        await renderPdf(
          [src],
          { mode: 'pages', paper: 'a4', compress: false, embedFonts: false },
          { textImage: () => null },
        )
      ).blob,
    );
    expect(fallback).toContain('(??)');
  });

  it('draws diff decorations and the minus sign of badges in WinAnsi', async () => {
    const m = model('Table a { id int [pk]\n gone int }');
    const src: PdfPageSource = {
      ...source('diff', m),
      decorations: { nodes: { 'public.a': 'changed' }, badges: { 'public.a': '−1' } },
    };
    const { blob, rasterPages } = await exportPdfWithReport([src], {
      mode: 'pages',
      paper: 'a4',
      compress: false,
    });
    expect(rasterPages).toBe(0);
    expect(await readBlob(blob)).toContain('(\x961)'); // en dash
  });
});

describe('bundle: jsPDF and svg2pdf.js load lazily', () => {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
  const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;

  /** Every file reachable from `entry` through static imports, with the bare specifiers seen. */
  function staticGraph(entry: string): { files: Set<string>; bare: Set<string> } {
    const files = new Set<string>();
    const bare = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (files.has(file)) continue;
      files.add(file);
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(STATIC_IMPORT)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
        else bare.add(spec);
      }
    }
    return { files, bare };
  }

  it('is built (run `pnpm --filter @relvista/renderer build` first)', () => {
    expect(existsSync(join(dist, 'export/pdf/index.js'))).toBe(true);
    expect(existsSync(join(dist, 'export/pdf/impl.js'))).toBe(true);
  });

  it.each(['index.js', 'export/pdf/index.js'])(
    '%s has no static path to jspdf / svg2pdf.js',
    (entry) => {
      const path = join(dist, entry);
      if (!existsSync(path)) throw new Error(`${path} missing: build the renderer first`);
      const { files, bare } = staticGraph(path);
      expect([...bare].filter((s) => /^(jspdf|svg2pdf\.js)(\/|$)/.test(s))).toEqual([]);
      expect(files.has(join(dist, 'export/pdf/impl.js'))).toBe(false);
    },
  );

  it('the lazy chunk does import them, behind a dynamic import', () => {
    const impl = readFileSync(join(dist, 'export/pdf/impl.js'), 'utf8');
    expect(impl).toMatch(/from ['"]jspdf['"]/);
    expect(impl).toMatch(/from ['"]svg2pdf\.js['"]/);
    const index = readFileSync(join(dist, 'export/pdf/index.js'), 'utf8');
    expect(index).toMatch(/import\(['"]\.\/impl\.js['"]\)/);
  });
});
