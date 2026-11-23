/**
 * The `themeConfig.dbml` options: their types and default values.
 *
 * @module themeConfig
 */
import type { DetailLevel } from '@relvista/core';
import type { ToolbarItem } from '@relvista/renderer';

// Browser-safe: imported by theme components, so no Node-only dependencies here.

/**
 * `themeConfig.dbml` in docusaurus.config: site-wide defaults for every diagram.
 *
 * @example
 * ```ts
 * // docusaurus.config.ts
 * export default {
 *   plugins: ['@relvista/docusaurus-plugin'],
 *   themeConfig: {
 *     dbml: {
 *       height: 560,
 *       detailLevel: 'keys',
 *       toolbar: ['search', 'zoom', 'fit', 'fullscreen', 'export'],
 *       editorUrl: false,
 *     },
 *   },
 * };
 * ```
 */
export interface DbmlThemeConfig {
  /** Default viewer height (number = px, or any CSS length). Default 480. */
  height: number | string;
  /** Toolbar buttons, in order. Default: every button. */
  toolbar: ToolbarItem[];
  /**
   * Base URL of the relvista editor for the "Open in editor" button. Defaults to the hosted editor
   * ({@link DEFAULT_EDITOR_URL}); `false` hides the button.
   */
  editorUrl: string | false;
  /** Default detail level: every column, keys only, or table names only. Default `all`. */
  detailLevel: DetailLevel;
  /**
   * Diagram colours. `site` (default): the site's Infima colours and fonts (primary colour for
   * table headers and highlights, surfaces, text), in light and dark mode. `relvista`: relvista's
   * own palette, as in the editor. Colours set in the DBML (`headercolor`, group and note colours)
   * and `--rv-*` variables in the site's CSS win in both.
   */
  palette: DbmlPalette;
  /**
   * Draw every diagram into the page's HTML at build time (a static SVG, shown without JavaScript,
   * before it loads, in print and to search engines), which the interactive viewer then replaces in
   * place. Default `true`; `ssr={false}` / fence meta `ssr=false` turns it off for one diagram.
   */
  ssr: boolean;
}

/** Which colours diagrams use: the site's Infima colours, or relvista's own palette. */
export type DbmlPalette = 'site' | 'relvista';
/** Every accepted `themeConfig.dbml.palette` value. */
export const PALETTE_OPTIONS: readonly DbmlPalette[] = ['site', 'relvista'];

/** The part of a Docusaurus `themeConfig` this plugin reads. */
export interface ThemeConfig {
  dbml: DbmlThemeConfig;
}

/**
 * The hosted editor. Same value as `DEFAULT_EDITOR_URL` in `@relvista/renderer` (a test keeps them
 * equal); repeated here so config validation in Node never loads the renderer.
 */
export const DEFAULT_EDITOR_URL = 'https://relvista.org/editor/';

/**
 * Every toolbar item, in the renderer's default order (`DEFAULT_TOOLBAR`, docs/design/phase3-v1.md
 * §4.7; a test keeps them equal). `link` shows only for diagrams with an anchor, `lock` only for
 * frozen diagrams.
 */
export const TOOLBAR_ITEMS: readonly ToolbarItem[] = [
  'view',
  'search',
  'detail',
  'zoom',
  'fit',
  'lock',
  'fullscreen',
  'export',
  'print',
  'link',
  'open-in-editor',
];

/** The `themeConfig.dbml` values used for every option a site leaves out. */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  dbml: {
    height: 480,
    toolbar: [...TOOLBAR_ITEMS],
    editorUrl: DEFAULT_EDITOR_URL,
    detailLevel: 'all',
    palette: 'site',
    ssr: true,
  },
};
