/**
 * Webpack loader applied after the MDX loader (and the site's JS loader): a compiled MDX page with
 * a ```dbml or ```dbml-diff fence registers the fence component (client/DbmlFence) with the MDX
 * `code` hook (client/fence) before it renders. Pages without one are left untouched, so they
 * never load relvista's diagram code.
 *
 * - Browser bundle: a top-level `await import()` of the fence component (chunks `relvista-fence`
 *   and `relvista-theme`). The page module becomes an async module: Docusaurus loads route modules
 *   with `import()`, so it waits for the component before it renders or hydrates the page, and the
 *   page renders what the server rendered. The component is not part of the page's own chunks, so
 *   Docusaurus' prefetch of links to the page (it downloads the linked pages' chunks) never
 *   downloads it.
 * - Server bundle: static imports.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FenceImportOptions {
  /** Compiling the server bundle. */
  server?: boolean;
}

interface LoaderContext {
  getOptions?(): FenceImportOptions;
  callback(err: Error | null, content?: string, map?: unknown): void;
}

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');

/** A `code` element of class `language-dbml` or `language-dbml-diff`, as MDX compiles it. */
const DBML_FENCE = /["'](?:[^"'\\]*\s)?language-dbml(?:-diff)?(?:\s[^"'\\]*)?["']/;

/** The lines appended to compiled MDX `source` (null when it has no dbml fence). */
export function fenceImport(
  source: string,
  options: FenceImportOptions = {},
  dir: string = clientDir,
): string | null {
  // Only JavaScript the MDX compiler wrote (not a `.md` file read as text by another rule).
  if (!source.includes('_createMdxContent') || !DBML_FENCE.test(source)) return null;
  // JSON.stringify: a valid string literal for any absolute path, `C:\…` included.
  const slot = JSON.stringify(join(dir, 'fence.js'));
  const fence = JSON.stringify(join(dir, 'DbmlFence.js'));
  return [
    '',
    '// Added by @relvista/docusaurus-plugin: this page has a dbml fence.',
    `import { registerDbmlFence as __relvistaRegister } from ${slot};`,
    ...(options.server
      ? [`import __RelvistaFence from ${fence};`, '__relvistaRegister(__RelvistaFence);']
      : [
          '__relvistaRegister(',
          `  (await import(/* webpackChunkName: "relvista-fence" */ ${fence})).default,`,
          ');',
        ]),
    '',
  ].join('\n');
}

export default function fenceImportLoader(
  this: LoaderContext,
  source: string,
  map?: unknown,
): void {
  const added = fenceImport(source, this.getOptions?.() ?? {});
  // Appended at the end: the lines before keep their positions, so the source map stays valid.
  this.callback(null, added === null ? source : source + added, map);
}
