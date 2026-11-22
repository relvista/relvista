// The SVG export document, shared by renderDiagramSvgString and the canvas's exportSvg.
import { METRICS, type DetailLevel, type DiagramGeometry, type DiagramModel } from '@relvista/core';
import { createElement, type ReactElement } from 'react';
import { DiagramSvg } from '../svg/DiagramSvg.js';
import type { Decorations } from '../svg/decorations.js';
import type { EdgeStyle } from '../svg/routing.js';
import { paletteCss, type ColorMode, type PaletteOverrides } from '../theme.js';

/** Options of `renderDiagramSvgString`. */
export interface SvgExportOptions {
  colorMode?: ColorMode;
  /**
   * Colours and fonts replacing the `colorMode` palette's: what the page shows, so the file matches
   * it (`resolvePalette`). The interactive canvas passes them for its own exports.
   */
  palette?: PaletteOverrides | null;
  /** Space around the diagram, in px. Default 24. */
  padding?: number;
  /** true (default) fills with the palette's canvas colour, false is transparent, a string is a colour. */
  background?: boolean | string;
  /** Written as the SVG `<title>`. */
  title?: string;
  detailLevel?: DetailLevel;
  edgeStyle?: EdgeStyle;
  highlight?: readonly string[];
  /** Scale of the `width`/`height` attributes (the viewBox is unchanged). Default 1. */
  scale?: number;
  /** Search, path and diff tones, drawn into the file too (a diff can be exported). */
  decorations?: Decorations | null;
}

/** The `<style>` embedded in exported SVGs: palette variables for the mode and the font stacks. */
export function exportStyle(mode: ColorMode, palette?: PaletteOverrides | null): string {
  const font = palette?.font ?? METRICS.fontFamily;
  const mono = palette?.mono ?? METRICS.monoFontFamily;
  return (
    `svg.rv-diagram{${paletteCss(mode, palette ?? undefined)} --rv-font:${font}; --rv-mono:${mono};` +
    ` font-family:${font};}` +
    `svg.rv-diagram text{font-family:${font};}` +
    `svg.rv-diagram .rv-column text[text-anchor="end"]{font-family:${mono};}`
  );
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The standalone SVG document of `renderDiagramSvgString`, with the markup of the `<svg>` element
 * written by `markupOf`: `renderToStaticMarkup` (any environment), or the DOM serialiser the
 * interactive canvas uses so its bundle does without `react-dom/server` (export/domMarkup).
 */
export function svgDocument(
  markupOf: (element: ReactElement) => string,
  model: DiagramModel,
  geometry: DiagramGeometry,
  opts: SvgExportOptions = {},
): string {
  const mode = opts.colorMode ?? 'light';
  const padding = opts.padding ?? 24;
  const scale = opts.scale ?? 1;
  const b = geometry.bounds;
  const w = Math.max(1, (Number.isFinite(b.width) ? b.width : 0) + padding * 2);
  const h = Math.max(1, (Number.isFinite(b.height) ? b.height : 0) + padding * 2);
  const markup = markupOf(
    createElement(DiagramSvg, {
      model,
      geometry,
      colorMode: mode,
      padding,
      background: opts.background ?? true,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.detailLevel ? { detailLevel: opts.detailLevel } : {}),
      ...(opts.edgeStyle ? { edgeStyle: opts.edgeStyle } : {}),
      ...(opts.highlight ? { highlight: opts.highlight } : {}),
      ...(opts.decorations ? { decorations: opts.decorations } : {}),
      width: Math.round(w * scale * 100) / 100,
      height: Math.round(h * scale * 100) / 100,
      literalColors: true,
      ...(opts.palette ? { palette: opts.palette } : {}),
      idPrefix: 'rv-export',
    }),
  );
  const open = markup.indexOf('>') + 1;
  const style = `<style>${escapeXmlText(exportStyle(mode, opts.palette))}</style>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' + markup.slice(0, open) + style + markup.slice(open)
  );
}
