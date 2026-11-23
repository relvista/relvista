import type { DiagramGeometry, DiagramModel } from '@relvista/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { svgDocument, type SvgExportOptions } from './svgDocument.js';

export { exportStyle, type SvgExportOptions } from './svgDocument.js';

/**
 * The diagram as a standalone SVG document: literal colours for the chosen mode (works in tools
 * without CSS variable support), plus an embedded `<style>` with the `--rv-*` variables and fonts.
 * Pure: works in Node and in browsers.
 *
 * @example
 * ```ts
 * import { writeFileSync } from 'node:fs';
 * import { compileDbml, layoutDiagram } from '@relvista/core';
 * import { renderDiagramSvgString } from '@relvista/renderer';
 *
 * const { model } = compileDbml(source);
 * const geometry = await layoutDiagram(model!);
 * writeFileSync('schema.svg', renderDiagramSvgString(model!, geometry, { colorMode: 'dark' }));
 * ```
 */
export function renderDiagramSvgString(
  model: DiagramModel,
  geometry: DiagramGeometry,
  opts: SvgExportOptions = {},
): string {
  return svgDocument(renderToStaticMarkup, model, geometry, opts);
}
