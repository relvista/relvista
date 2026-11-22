# @relvista/docusaurus-plugin

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
