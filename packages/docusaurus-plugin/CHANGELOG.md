# @relvista/docusaurus-plugin

## 1.1.0

### Minor Changes

- 60d0eb8: Docs diagrams are now frozen by default: readers see the arrangement you gave them and can pan, zoom, search, highlight, focus and export, but cannot drag tables or collapse groups until they press the new lock button in the toolbar (**Unlock layout**); locking again puts everything back, and nothing is saved. New option `themeConfig.dbml.frozen` (default `true`), `frozen` prop on `@theme/DbmlDiagram` and `@theme/DbmlDiff`, and fence meta `frozen` / `frozen=false` for ` ```dbml ` and ` ```dbml-diff ` fences (per diagram wins). The toolbar item `lock` is in the default toolbar. **To keep the 1.0 behaviour** (tables drag right away, no lock button), set `themeConfig.dbml.frozen: false`, or `frozen=false` on one fence. A site with its own `toolbar` list must add `'lock'` to it for readers to unlock its diagrams. The build-time pictures do not change.
- 7be176e: Per-view detail level. A layout file can give a named view its own detail level under
  `settings["x-relvista-view-settings"]` (an extension key, so relvista 1.0 still loads these files).
  Core adds `viewDetailLevel`, `withViewDetailLevel`, `renameViewSettings`, `VIEW_SETTINGS_KEY` and the
  `ViewSettings` type. The layout schema describes the key but, like every `x-` key, accepts any
  value: entries relvista cannot read are ignored and kept. `DbmlViewer` and `DiagramCanvas` start
  each view at its saved level (the `detailLevel` prop and the toolbar still override it), and
  `DbmlViewer` takes a new `defaultDetailLevel` prop. Docs diagrams with `view=` draw the view's level,
  at build time too.

### Patch Changes

- 823b82d: Pages without diagrams no longer load any diagram code, not even through Docusaurus' prefetch of links to diagram pages: a page with a ` ```dbml ` or ` ```dbml-diff ` fence loads the diagram component itself before it renders (a small webpack loader), and the theme code is never part of a page's own chunk.
- Updated dependencies [7e2c7ab]
- Updated dependencies [8c00a6a]
- Updated dependencies [29d5866]
- Updated dependencies [4b38447]
- Updated dependencies [c76f7b1]
- Updated dependencies [7be176e]
  - @relvista/core@1.1.0
  - @relvista/renderer@1.1.0

## 1.0.0

### Major Changes

- 94b3465: First stable release. `plugins: ['@relvista/docusaurus-plugin']` turns ` ```dbml ` code fences and
  imported `.dbml` files into interactive entity-relationship diagrams. It only adds diagrams: your
  theme, colours, fonts and custom CSS stay as they are. Docusaurus `^3.6.0` with the classic theme,
  React 18 or 19 (Docusaurus supports React 19 from 3.7), Node 20 or later.

  - **Fences and components**: ` ```dbml ` fences with `title`, `height`, `view`, `layout`, `source`,
    `detail`, `static` and `ssr` meta; `@theme/DbmlDiagram` (`value`, `src`, `layout`, multi-file
    projects); `@theme/DbmlDiff` and ` ```dbml-diff ` fences for schema changes, with a
    "Changes (+2 −2 ~2)" list.
  - **Build-time pictures**: every diagram is laid out at build time and written into the page HTML
    as a static SVG (visible without JavaScript, in print and to crawlers); the interactive viewer
    takes over with the same positions. `themeConfig.dbml.ssr`, the `ssr` prop or `ssr=false` turn
    it off.
  - **Links**: each diagram has an anchor known to Docusaurus' broken-anchor check;
    `#anchor&table=…` links open a diagram in a given state.
  - **Fits your site**: `palette: 'site'` (default) takes the site's Infima colours, fonts and dark
    mode; `palette: 'relvista'` keeps relvista's. Works next to `@docusaurus/theme-mermaid`,
    `@docusaurus/theme-live-codeblock` and swizzled `CodeBlock` components; ` ```dbml static `
    blocks get Prism highlighting.
  - `themeConfig.dbml`: `height`, `detailLevel`, `toolbar`, `editorUrl` (the hosted relvista editor
    by default; `false` hides "Open in editor"), `palette`, `ssr`. TypeScript types for `.dbml`
    imports and the theme components: `@relvista/docusaurus-plugin/client`.

### Patch Changes

- Updated dependencies [94b3465]
- Updated dependencies [94b3465]
  - @relvista/core@1.0.0
  - @relvista/renderer@1.0.0
