// @vitest-environment jsdom
// The canvas exports SVG through the DOM serialiser (export/domMarkup) instead of react-dom/server:
// the document must be the one renderDiagramSvgString writes, up to XML spelling and the browser's
// spelling of style declarations (it writes `fill: rgb(…)` where the server writes `fill:#…`).
import { compileDbml } from '@relvista/core';
import { describe, expect, it } from 'vitest';
import { domMarkup } from '../src/export/domMarkup.js';
import { svgDocument } from '../src/export/svgDocument.js';
import { renderDiagramSvgString } from '../src/export/svgString.js';
import { layoutSync } from '../src/geometry.js';
import { loadExamples } from './examples.js';

/** `style` as the DOM spells it. */
function cssText(style: string): string {
  const probe = document.createElement('span');
  probe.style.cssText = style;
  return probe.style.cssText;
}

/** A canonical form of an XML element: names, attributes (sorted), text. */
function canonical(el: Element): unknown {
  const attrs = [...el.attributes]
    .map((a) => `${a.name}=${a.name === 'style' ? cssText(a.value) : a.value}`)
    .sort();
  const children = [...el.childNodes].flatMap((n) =>
    n.nodeType === 1 ? [canonical(n as Element)] : n.nodeType === 3 ? [n.textContent] : [],
  );
  return { name: el.tagName, attrs, children };
}

function parse(svg: string): Element {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc.documentElement;
}

describe.each(loadExamples())('domMarkup: %s', (_name, input) => {
  const { model } = compileDbml(input);
  if (!model) throw new Error('example does not compile');
  const geometry = layoutSync(model);

  it.each(['light', 'dark'] as const)('writes the server-rendered document (%s)', (colorMode) => {
    const opts = { colorMode, title: 'A & B <test> "q"', detailLevel: 'all' as const };
    const fromDom = svgDocument(domMarkup, model, geometry, opts);
    const fromServer = renderDiagramSvgString(model, geometry, opts);
    expect(fromDom.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true);
    expect(canonical(parse(fromDom))).toEqual(canonical(parse(fromServer)));
  });
});

describe('domMarkup', () => {
  it('leaves nothing mounted behind', () => {
    const before = document.body.innerHTML;
    const svg = domMarkup(
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
        <text>a &amp; b</text>
      </svg>,
    );
    expect(svg).toContain('<text>a &amp; b</text>');
    expect(document.body.innerHTML).toBe(before);
  });
});
