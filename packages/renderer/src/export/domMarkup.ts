// The markup of a React SVG element, written by the browser instead of `react-dom/server`: the
// interactive canvas exports SVG with it, so `react-dom/server` (about 100 KB gzip) only loads with
// the PNG, print and PDF exports, on use.
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/**
 * Renders `element` (an `<svg>`) into a detached element and serialises it as XML. Browser only
 * (needs `document` and `XMLSerializer`); call it outside React's render phase, as event handlers
 * and the canvas handle's callers do.
 */
export function domMarkup(element: ReactElement): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    const svg = host.firstElementChild;
    if (!svg) throw new Error('relvista: the SVG export rendered nothing');
    // The serialiser declares the element's namespace itself; the `xmlns` prop React set as a
    // plain attribute would be written a second time (jsdom does), which is not well-formed XML.
    // Array.from, not a spread: sites' Babel (loose mode) turns `[...nodeList]` into a concat.
    for (const el of [svg, ...Array.from(svg.querySelectorAll('[xmlns]'))])
      el.removeAttribute('xmlns');
    return new XMLSerializer().serializeToString(svg);
  } finally {
    root.unmount();
  }
}
