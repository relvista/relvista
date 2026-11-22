/**
 * The Docusaurus plugin (the default export, registered as `'@relvista/docusaurus-plugin'`) and
 * the functions behind its configuration. Diagram defaults are set in `themeConfig.dbml`
 * ({@link DbmlThemeConfig}); the theme components (`@theme/DbmlDiagram` and `dbml` code fences) are
 * described in the usage guide.
 *
 * @module plugin
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { DocusaurusConfig, LoadContext, Plugin } from '@docusaurus/types';

export {
  validateThemeConfig,
  DEFAULT_THEME_CONFIG,
  PALETTE_OPTIONS,
  TOOLBAR_ITEMS,
} from './options.js';
export type { DbmlPalette, DbmlThemeConfig, ThemeConfig } from './options.js';
export { parseDbmlMeta, type DbmlFenceMeta } from './meta.js';

/**
 * Plugin options (`plugins: [['@relvista/docusaurus-plugin', options]]`). Diagram defaults live
 * in `themeConfig.dbml`.
 *
 * @example
 * ```ts
 * // docusaurus.config.ts
 * export default {
 *   plugins: [['@relvista/docusaurus-plugin', { highlight: true }]],
 * };
 * ```
 */
export interface PluginOptions {
  /** Add a Prism grammar so ` ```dbml static ` and the Source tab are syntax-highlighted. Default true. */
  highlight?: boolean;
}

const libDir = dirname(fileURLToPath(import.meta.url));

/**
 * The webpack `splitChunks` cache group that puts the plugin's browser modules used by two or more
 * page chunks into one `relvista-theme` chunk (see `configureWebpack`).
 */
function themeChunkGroup(dir: string = libDir): Record<string, object> {
  const prefix = dir.endsWith(sep) ? dir : dir + sep;
  return {
    relvistaTheme: {
      name: 'relvista-theme',
      chunks: 'async',
      test: (module: { resource?: string }) => !!module.resource?.startsWith(prefix),
      minChunks: 2,
      minSize: 0,
      // Above Docusaurus' `common` (40), below its `styles` (50), so CSS stays in one file.
      priority: 45,
      reuseExistingChunk: true,
    },
  };
}
const require = createRequire(import.meta.url);

type PluginEntry = DocusaurusConfig['plugins'][number];

/** Modules jsPDF imports for features relvista never uses; aliased to nothing for jsPDF. */
const JSPDF_OPTIONAL_DEPS = { html2canvas: false, canvg: false, dompurify: false } as const;

function entryName(entry: PluginEntry): string | null {
  const head: unknown = Array.isArray(entry) ? entry[0] : entry;
  return typeof head === 'string' ? head : null;
}

const isClassicTheme = (name: string | null): boolean =>
  name !== null &&
  (name === 'classic' || /(?:^|[\\/])@docusaurus[\\/]theme-classic(?:[\\/]|$)/.test(name));

function isRelvista(entry: PluginEntry): boolean {
  const head: unknown = Array.isArray(entry) ? entry[0] : entry;
  if (head === pluginRelvista) return true;
  const name = entryName(entry);
  return name !== null && (name === '@relvista' || name.includes('@relvista/docusaurus-plugin'));
}

/**
 * Why ` ```dbml ` fences would silently stay code blocks, or null. The plugin's
 * `MDXComponents/Code` wraps `@theme-init/MDXComponents/Code`, so it must load after the theme that
 * provides it. Docusaurus loads preset plugins, preset themes, then `plugins`, then `themes`: with
 * preset-classic any position works, but `@docusaurus/theme-classic` listed in `themes` loads after
 * every entry in `plugins` and replaces relvista's component.
 *
 * @internal Exported for the plugin's tests.
 */
export function registrationProblem(
  siteConfig: Pick<DocusaurusConfig, 'plugins' | 'themes'> | undefined,
): string | null {
  const themes = siteConfig?.themes ?? [];
  const classic = themes.findIndex((t) => isClassicTheme(entryName(t)));
  if (classic === -1) return null;
  const inPlugins = (siteConfig?.plugins ?? []).some(isRelvista);
  const themeIndex = themes.findIndex(isRelvista);
  if (!inPlugins && (themeIndex === -1 || themeIndex > classic)) return null;
  return (
    '[relvista] @docusaurus/theme-classic is listed in `themes` and loads after ' +
    '@relvista/docusaurus-plugin, so ```dbml code fences render as code instead of diagrams. ' +
    "Register relvista in `themes` after the classic theme: themes: ['@docusaurus/theme-classic', " +
    "'@relvista/docusaurus-plugin']."
  );
}

/**
 * Writes the server side of `relvista-ssr-files` into the site's generated files: the build-time
 * renderer (lib/ssr/server.js) bound to this site's static directories, with the layout loaded by
 * Node outside the bundle (lib/ssr/layout-node.cjs). Returns its path.
 *
 * @internal Exported for the plugin's tests.
 */
export function writeSsrModule(context: LoadContext): string {
  const file = join(context.generatedFilesDir, 'relvista-docusaurus-plugin', 'ssr-files.js');
  const config = {
    siteDir: context.siteDir,
    staticDirectories: context.siteConfig?.staticDirectories ?? ['static'],
    baseUrl: context.baseUrl ?? context.siteConfig?.baseUrl ?? '/',
  };
  const code = [
    '// Generated by @relvista/docusaurus-plugin: build-time static diagrams (server bundle only).',
    '/* global __non_webpack_require__ */',
    `import { createSsrBackend } from ${JSON.stringify(join(libDir, 'ssr', 'server.js'))};`,
    // Layout runs in Node's own context, not the bundle's (see lib/ssr/layout-node.cjs). Loaded
    // on first use: a failure becomes that diagram's build warning, never a failed page.
    'let native = null;',
    'function layoutDiagram(model, options) {',
    `  native ??= __non_webpack_require__(${JSON.stringify(join(libDir, 'ssr', 'layout-node.cjs'))});`,
    '  return native.layoutDiagram(model, options);',
    '}',
    `const backend = createSsrBackend({ ...${JSON.stringify(config)}, layoutDiagram });`,
    'export default function relvistaSsr() {',
    '  return backend;',
    '}',
    '',
  ].join('\n');
  writeIfChanged(file, code);
  return file;
}

/** Rewriting an unchanged file would retrigger `docusaurus start`'s watcher. */
function writeIfChanged(file: string, code: string): void {
  mkdirSync(dirname(file), { recursive: true });
  let current: string | null = null;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    // first build
  }
  if (current !== code) writeFileSync(file, code);
}

/**
 * relvista Docusaurus plugin: ` ```dbml ` fences become interactive ER diagrams, and
 * `@theme/DbmlDiagram` renders `.dbml` files and inline sources. It only adds components; the
 * site's theme and styles are untouched (relvista's CSS only targets its own `.rv-*` and React Flow classes).
 */
export default function pluginRelvista(
  context: LoadContext,
  options: PluginOptions = {},
): Plugin<void> {
  const problem = registrationProblem(context.siteConfig);
  if (problem) console.warn(problem);
  const { siteDir } = context;
  const highlight = options.highlight ?? true;
  return {
    name: 'relvista-docusaurus-plugin',

    getThemePath() {
      return join(libDir, 'theme');
    },

    getTypeScriptThemePath() {
      return join(libDir, '..', 'src', 'theme');
    },

    getClientModules() {
      // The site palette maps relvista's variables to the site's; it must come after the renderer's
      // and after the static layer's (framing, print, no-JS dark mode).
      const modules = [
        require.resolve('@relvista/renderer/styles.css'),
        join(libDir, 'client', 'static.css'),
        join(libDir, 'client', 'site-palette.css'),
      ];
      if (highlight) modules.push(join(libDir, 'client', 'prism-dbml.js'));
      return modules;
    },

    getPathsToWatch() {
      // Globs take '/' on every OS: in a glob '\' escapes the next character.
      const site = siteDir.split(sep).join('/');
      return [`${site}/**/*.dbml`, `${site}/**/*.dbml.layout.json`];
    },

    configureWebpack(_config, isServer) {
      // Build-time static diagrams: the server bundle renders them; the browser gets a stub.
      const ssrFiles = isServer ? writeSsrModule(context) : join(libDir, 'ssr', 'client.js');
      return {
        module: {
          rules: [
            { test: /\.dbml$/i, type: 'asset/source' },
            {
              // `elkjs/lib/elk-worker.min.js?relvista-worker` → URL of the ELK Web Worker script,
              // emitted as-is (already minified), so auto-layout runs off the main thread.
              resourceQuery: /relvista-worker/,
              type: 'asset/resource',
              generator: { filename: 'assets/js/[name].[contenthash:8][ext]' },
            },
            {
              // jsPDF's optional dependencies (its `.html()` / `addSvgAsImage()`), which relvista
              // never calls, are never bundled (docs/design/phase3-v1.md §2). Only for jsPDF's own
              // imports: the site's other plugins (mermaid uses DOMPurify) keep theirs.
              test: /[\\/]jspdf[\\/]/,
              resolve: { alias: JSPDF_OPTIONAL_DEPS },
            },
            {
              // Works around a terser miscompilation in @dbml/parse (see loaders/catch-rename).
              test: /[\\/]@dbml[\\/]parse[\\/]dist[\\/][^\\/]+\.m?js$/,
              use: [{ loader: join(libDir, 'loaders', 'catch-rename.js') }],
            },
          ],
        },
        // One shared chunk for the theme code (DbmlDiagram, DbmlDiff, the static layer) whatever
        // the site's page count: Docusaurus' own `common` chunk needs half of all pages to use a
        // module, so on a site with many pages without diagrams (an API reference) every diagram
        // page's chunk would carry its own copy, and the prefetch of sidebar links downloads them.
        ...(isServer ? {} : { optimization: { splitChunks: { cacheGroups: themeChunkGroup() } } }),
        resolve: {
          alias: {
            'relvista-ssr-files$': ssrFiles,
          },
          // elkjs' bundled build has an optional `require('web-worker')` for Node; browsers use
          // the global Worker, so never bundle it.
          fallback: { 'web-worker': false },
        },
      };
    },
  };
}
