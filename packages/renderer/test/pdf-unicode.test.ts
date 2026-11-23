// @vitest-environment jsdom
// PDF text outside WinAnsi: embedded font subsets (docs/design/phase3-v1.md §4.4, §13).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDbml, type DiagramModel } from '@relvista/core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pdfCanDrawText } from '../src/index.js';
import { exportPdfWithReport, type PdfPageSource } from '../src/export/pdf/index.js';
import { renderPdf } from '../src/export/pdf/impl.js';
import { fontCovers, loadPdfFont, unicodeFontFor } from '../src/export/pdf/unicode.js';
import type * as PngModule from '../src/export/png.js';
import { layoutSync } from '../src/geometry.js';

// As in pdf.test.ts: svg2pdf.js's ES build, a mocked PNG raster (jsdom has no canvas) and a
// getBBox stand-in.
vi.mock('svg2pdf.js', async () => {
  // @ts-expect-error the ES build has no own type declarations
  return await import('svg2pdf.js/dist/svg2pdf.es.min.js');
});
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

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
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

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Text of each page as a PDF reader extracts it (pdf.js: fonts' ToUnicode maps). */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await task.destroy();
  return out;
}

const CYRILLIC_CJK = [
  'Table пользователи {\n  id int [pk]\n  имя varchar\n  "Ελληνικά" text\n}',
  'Table 用户 {\n  id int [pk]\n  名字 varchar\n  ユーザー名 text\n  user_id int [ref: > пользователи.id]\n}',
  'Table orders {\n  id int [pk]\n  "用户 ID" int [ref: > 用户.id]\n}',
].join('\n');

describe('bundled font coverage', () => {
  it('picks Noto Sans for Latin, Greek and Cyrillic, the CJK font for CJK', () => {
    expect(unicodeFontFor('пользователи', false)).toBe('sansRegular');
    expect(unicodeFontFor('пользователи', true)).toBe('sansBold');
    expect(unicodeFontFor('Ελληνικά', false)).toBe('sansRegular');
    expect(unicodeFontFor('Tiếng Việt', false)).toBe('sansRegular');
    // Decomposed é composes under NFC.
    expect(unicodeFontFor('cafe' + String.fromCodePoint(0x301), false)).toBe('sansRegular');
    // CJK, alone or mixed with Latin, Greek or Cyrillic (one weight only).
    expect(unicodeFontFor('用户', true)).toBe('cjk');
    expect(unicodeFontFor('用户 ID – café', false)).toBe('cjk');
    expect(unicodeFontFor('ユーザー名', false)).toBe('cjk');
    expect(unicodeFontFor('Пользователь 用户', false)).toBe('cjk');
    expect(fontCovers('cjk', String.fromCodePoint(0xff21, 0xff22))).toBe(true); // full-width forms
  });

  it('leaves combining marks NFC cannot compose and bidi controls to the raster fallback', () => {
    // The fonts have these glyphs, but the PDF writer would draw marks unpositioned and ignores
    // direction controls.
    const titlo = String.fromCodePoint(0x0483); // Cyrillic combining titlo
    const dotAbove = String.fromCodePoint(0x0307); // no precomposed ж + dot above
    const rlo = String.fromCodePoint(0x202e); // right-to-left override
    const lri = String.fromCodePoint(0x2066); // left-to-right isolate
    expect(unicodeFontFor(`бог${titlo}`, false)).toBeNull();
    expect(unicodeFontFor(`ж${dotAbove}`, true)).toBeNull();
    expect(unicodeFontFor(`имя ${rlo}abc`, false)).toBeNull();
    expect(unicodeFontFor(`${lri}用户`, false)).toBeNull();
    // A mark NFC composes is fine (é), and so are zero-width joiners and spaces.
    expect(unicodeFontFor(`имя e${String.fromCodePoint(0x301)}`, false)).toBe('sansRegular');
    expect(unicodeFontFor(`имя${String.fromCodePoint(0x200b)}x`, false)).toBe('sansRegular');
  });

  it('leaves scripts it cannot draw to the raster fallback', () => {
    expect(unicodeFontFor('مستخدم', false)).toBeNull(); // Arabic: right to left, shaped
    expect(unicodeFontFor('משתמש', false)).toBeNull(); // Hebrew: right to left
    expect(unicodeFontFor('사용자', false)).toBeNull(); // Hangul syllables
    expect(unicodeFontFor('उपयोगकर्ता', false)).toBeNull(); // Devanagari: shaped
    expect(unicodeFontFor('users 😀', false)).toBeNull(); // emoji (outside the BMP)
    expect(unicodeFontFor(String.fromCodePoint(0x4e00, 0x3400), false)).toBeNull(); // CJK Extension A
    expect(unicodeFontFor('a' + String.fromCodePoint(0x332), false)).toBeNull(); // combining mark NFC keeps
  });

  it('pdfCanDrawText: WinAnsi or a bundled font (public, for a note before exporting)', () => {
    expect(pdfCanDrawText('users · façade €')).toBe(true);
    expect(pdfCanDrawText('пользователи')).toBe(true);
    expect(pdfCanDrawText('用户 ID')).toBe(true);
    expect(pdfCanDrawText('مستخدم')).toBe(false);
    expect(pdfCanDrawText('😀')).toBe(false);
  });

  it('loads a real TrueType file per font', async () => {
    for (const id of ['sansRegular', 'sansBold', 'cjk'] as const) {
      const ttf = await loadPdfFont(id);
      expect([...ttf.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
    }
  });
});

describe('exportPdf with text outside WinAnsi', { timeout: 60_000 }, () => {
  it('Cyrillic, Greek and CJK stay vector text a PDF reader extracts', async () => {
    exportPngMock.mockReset();
    const src = source('Пользователи и 用户', model(CYRILLIC_CJK));
    const { blob, pageCount, rasterPages } = await exportPdfWithReport([src], {
      mode: 'pages',
      paper: 'a4',
      title: 'Схема',
    });
    expect(pageCount).toBe(1);
    expect(rasterPages).toBe(0);
    expect(exportPngMock).not.toHaveBeenCalled();
    const bytes = await bytesOf(blob);
    const pdf = latin1(bytes);
    expect(pdf).not.toContain('/Subtype /Image');
    // Noto Sans regular (columns, header) and bold (table name), and the CJK font, each a subset.
    expect(pdf.match(/\/FontFile2 /g)).toHaveLength(3);
    // Each subset under a name of its own (tools that match fonts by name must not mix them up).
    const names = [...pdf.matchAll(/\/FontName \/(\w+)/g)].map((m) => m[1]).sort();
    expect(names).toEqual(['rvpdfcjk', 'rvpdfsans', 'rvpdfsansbold']);
    expect(pdf).toContain('/BaseFont /rvpdfcjk');
    expect(pdf).toContain('/Encoding /Identity-H');
    const [text] = await pageTexts(bytes);
    for (const s of [
      'пользователи',
      'имя',
      'Ελληνικά',
      '用户',
      '名字',
      'ユーザー名',
      '用户 ID',
      'orders',
      'varchar',
      'Пользователи и 用户', // running header
    ]) {
      expect(text).toContain(s);
    }
    // Subsets, not whole fonts: the CJK font alone is 3 MB (this page: 87 KB).
    expect(bytes.length).toBeLessThan(120_000);
  });

  it('tiled: every tile page is vector, fonts embedded once for the document', async () => {
    exportPngMock.mockReset();
    const cols = Array.from({ length: 60 }, (_, i) => `  列${i} int`).join('\n');
    const src = source('cjk', model(`Table 用户 {\n${cols}\n}`));
    const { blob, pageCount, rasterPages } = await exportPdfWithReport([src], {
      mode: 'tiled',
      paper: 'a4',
      scale: 2,
    });
    expect(pageCount).toBeGreaterThan(2);
    expect(rasterPages).toBe(0);
    expect(exportPngMock).not.toHaveBeenCalled();
    const bytes = await bytesOf(blob);
    expect(latin1(bytes).match(/\/FontFile2 /g)).toHaveLength(1);
    const texts = await pageTexts(bytes);
    expect(texts.join(' ')).toContain('列59');
    expect(bytes.length).toBeLessThan(150_000);
  });

  it('a page with Arabic or Hebrew is still a raster; the other pages stay vector', async () => {
    exportPngMock.mockReset();
    exportPngMock.mockResolvedValue(new Blob([PNG_1X1], { type: 'image/png' }));
    const cyr = source('cyr', model('Table клиенты { id int }'));
    const ar = source('ar', model('Table "مستخدم" { id int }\nTable "משתמש" { id int }'));
    const { blob, rasterPages } = await exportPdfWithReport([cyr, ar], {
      mode: 'pages',
      paper: 'a4',
    });
    expect(rasterPages).toBe(1);
    expect(exportPngMock).toHaveBeenCalledTimes(1);
    expect(exportPngMock.mock.calls[0]![0]).toBe(ar.model);
    const texts = await pageTexts(await bytesOf(blob));
    expect(texts[0]).toContain('клиенты');
    expect(texts[1]).not.toContain('مستخدم');
  });

  it('loads no font for WinAnsi text, and only the fonts a document needs', async () => {
    const loadFont = vi.fn(loadPdfFont);
    await renderPdf(
      [source('latin', model('Table users { id int }'))],
      { mode: 'pages' },
      {
        loadFont,
      },
    );
    expect(loadFont).not.toHaveBeenCalled();
    await renderPdf(
      [source('cyr', model('Table клиенты { имя int }'))],
      { mode: 'pages' },
      {
        loadFont,
      },
    );
    // The table name is bold, the column regular. No CJK.
    expect(loadFont.mock.calls.map(([id]) => id).sort()).toEqual(['sansBold', 'sansRegular']);
  });

  it('a table note (only in the name tooltip, never drawn) chooses no font and no raster', async () => {
    exportPngMock.mockReset();
    const loadFont = vi.fn(loadPdfFont);
    // Latin names with a CJK note: no font at all, the table name stays bold Helvetica.
    const cjkNote = await renderPdf(
      [source('notes', model("Table users [note: '用户表'] {\n  id int\n}"))],
      { mode: 'pages' },
      { loadFont },
    );
    expect(cjkNote.rasterPages).toBe(0);
    expect(loadFont).not.toHaveBeenCalled();
    // Cyrillic name, a note with an arrow and an emoji no font has: still vector, Noto Sans bold.
    const emojiNote = await renderPdf(
      [source('notes', model("Table клиенты [note: 'see → orders 😀'] {\n  id int\n}"))],
      { mode: 'pages' },
      { loadFont },
    );
    expect(emojiNote.rasterPages).toBe(0);
    expect(exportPngMock).not.toHaveBeenCalled();
    expect(loadFont.mock.calls.map(([id]) => id)).toEqual(['sansBold']);
  });

  it('falls back to raster when a font cannot load, or with embedFonts: false', async () => {
    exportPngMock.mockReset();
    exportPngMock.mockResolvedValue(new Blob([PNG_1X1], { type: 'image/png' }));
    const src = source('用户', model('Table 用户 { id int }'));
    const failing = await renderPdf(
      [src],
      { mode: 'pages' },
      {
        loadFont: () => Promise.reject(new Error('offline')),
        textImage: () => null,
      },
    );
    expect(failing.rasterPages).toBe(1);
    const loadFont = vi.fn(loadPdfFont);
    const off = await renderPdf([src], { mode: 'pages', embedFonts: false }, { loadFont });
    expect(off.rasterPages).toBe(1);
    expect(loadFont).not.toHaveBeenCalled();
    expect(exportPngMock).toHaveBeenCalledTimes(2);
  });
});

describe('bundle: the fonts load lazily', () => {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
  const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;

  function staticFiles(entry: string): Set<string> {
    const files = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (files.has(file)) continue;
      files.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
        if (m[1]!.startsWith('.')) queue.push(resolve(dirname(file), m[1]!));
      }
    }
    return files;
  }

  it.each(['index.js', 'export/pdf/impl.js'])('%s has no static path to a font', (entry) => {
    const path = join(dist, entry);
    if (!existsSync(path)) throw new Error(`${path} missing: build the renderer first`);
    const fonts = [...staticFiles(path)].filter((f) => /[\\/]fonts[\\/](?!coverage)/.test(f));
    expect(fonts).toEqual([]);
  });

  it('each font is a dynamic import of its own module', () => {
    const unicode = readFileSync(join(dist, 'export/pdf/unicode.js'), 'utf8');
    for (const f of ['sansRegular', 'sansBold', 'cjk']) {
      expect(unicode).toContain(`import('./fonts/${f}.js')`);
      expect(existsSync(join(dist, `export/pdf/fonts/${f}.js`))).toBe(true);
    }
    // Declarations do not repeat the data.
    expect(readFileSync(join(dist, 'export/pdf/fonts/cjk.d.ts'), 'utf8').length).toBeLessThan(1000);
  });
});
