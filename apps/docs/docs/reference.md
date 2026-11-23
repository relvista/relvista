---
sidebar_position: 5
sidebar_label: Reference
title: API reference
description: What the three relvista packages are for, what to import from each, and what stays stable in 1.x.
---

**relvista** is three npm packages. Most sites only need the Docusaurus plugin; the other two are
for building your own tools on the same parser, layout and renderer the editor uses.

| Package                       | Use it to                                                                   | Runs in                      |
| ----------------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| `@relvista/docusaurus-plugin` | draw DBML diagrams in a Docusaurus site                                     | Docusaurus 3.6+ (build, SSR) |
| `@relvista/core`              | parse DBML, read and write layout files, auto-layout, search, diff          | Node 20+ and browsers        |
| `@relvista/renderer`          | draw diagrams in React (static SVG, viewer, editable canvas), export, share | browsers (SVG also in Node)  |

All three are ES modules with TypeScript types; there is no CommonJS build.

## @relvista/docusaurus-plugin

Register it in `docusaurus.config` and set site-wide diagram defaults in `themeConfig.dbml`; pages
then use ` ```dbml ` code fences or `<DbmlDiagram>`. See [Getting started](./getting-started.md) and
[Usage](./usage.mdx) for the page-level syntax.

```ts
// docusaurus.config.ts
export default {
  plugins: ['@relvista/docusaurus-plugin'],
  themeConfig: { dbml: { height: 560, detailLevel: 'keys' } },
};
```

Reference: [plugin options](/docs/api/docusaurus-plugin/plugin/interfaces/PluginOptions),
[themeConfig.dbml](/docs/api/docusaurus-plugin/themeConfig/interfaces/DbmlThemeConfig) and its
[defaults](/docs/api/docusaurus-plugin/themeConfig/variables/DEFAULT_THEME_CONFIG), the
[fence meta](/docs/api/docusaurus-plugin/plugin/interfaces/DbmlFenceMeta) parser.

## @relvista/core

No DOM and no React: it runs in Node, in browsers and in Web Workers, and everything it returns is
plain JSON-serialisable data.

```ts
import { compileDbml, layoutDiagram, parseLayout } from '@relvista/core';

const { model, diagnostics } = compileDbml(dbmlText);
const geometry = model && (await layoutDiagram(model));
```

The main entry points:

- [compileDbml](/docs/api/core/functions/compileDbml): DBML (one file or a `use` project) to a
  [DiagramModel](/docs/api/core/interfaces/DiagramModel) and diagnostics; never throws.
- [parseLayout](/docs/api/core/functions/parseLayout) /
  [serializeLayout](/docs/api/core/functions/serializeLayout): the
  [layout file](./layout-file.md) (`schema.dbml.layout.json`), validated against its JSON Schema
  (also exported as `@relvista/core/layout.schema.json`).
- [layoutDiagram](/docs/api/core/functions/layoutDiagram) (ELK, async) and
  [layoutDiagramSync](/docs/api/core/functions/layoutDiagramSync) (dagre): auto-layout to a
  [DiagramGeometry](/docs/api/core/interfaces/DiagramGeometry), keeping saved positions.
- [selectView](/docs/api/core/functions/selectView): the part of a model one `DiagramView` shows.
- [searchModel](/docs/api/core/functions/searchModel) and
  [diffModels](/docs/api/core/functions/diffModels): search tables, columns and more; compare two
  schemas.

Everything else: [all of @relvista/core](/docs/api/core).

## @relvista/renderer

React components and browser helpers. Import its stylesheet once (it includes React Flow's).

```tsx
import { DbmlViewer } from '@relvista/renderer';
import '@relvista/renderer/styles.css';

<DbmlViewer source={dbmlText} title="Shop" height={520} />;
```

- [DbmlViewer](/docs/api/renderer/functions/DbmlViewer): the read-only viewer the docs use
  (toolbar, search, export, `frozen` layouts with a lock button);
  [props](/docs/api/renderer/interfaces/DbmlViewerProps).
- [DiagramCanvas](/docs/api/renderer/variables/DiagramCanvas): the interactive canvas the editor
  uses, read-only or editable with a controlled layout;
  [props](/docs/api/renderer/interfaces/DiagramCanvasProps) and
  [handle](/docs/api/renderer/interfaces/DiagramCanvasHandle).
- [DiagramSvg](/docs/api/renderer/functions/DiagramSvg): a static, SSR-safe SVG of a model and
  its geometry; [renderDiagramSvgString](/docs/api/renderer/functions/renderDiagramSvgString)
  gives the same picture as a standalone SVG file (Node too).
- [exportPng](/docs/api/renderer/functions/exportPng),
  [exportPdf](/docs/api/renderer/functions/exportPdf) (multi-page, tiled;
  [pdfCanDrawText](/docs/api/renderer/functions/pdfCanDrawText) says whether a string stays text
  or its page becomes an image) and [printDiagram](/docs/api/renderer/functions/printDiagram).
- [encodeShareHash](/docs/api/renderer/functions/encodeShareHash) /
  [decodeShareHash](/docs/api/renderer/functions/decodeShareHash) (share links) and
  [parseDiagramTarget](/docs/api/renderer/functions/parseDiagramTarget) /
  [formatDiagramTarget](/docs/api/renderer/functions/formatDiagramTarget) (deep links to a view,
  table or viewport).

Everything else: [all of @relvista/renderer](/docs/api/renderer).

## Stability in 1.x

From 1.0 the packages follow [semantic versioning](https://semver.org/):

- **Public API.** Everything listed in this reference keeps working within 1.x: no export is
  removed or renamed and no signature changes incompatibly before 2.0. New exports, options and
  props are added in minor releases. Anything not in the reference (deep imports into `dist/`,
  members marked internal, CSS class names other than the documented `--rv-*` variables) can
  change in any release.
- **Layout file.** The `layout-1` format ([layout file](./layout-file.md),
  [JSON Schema](pathname:///schemas/layout-1.json)) is stable: every 1.x version reads every
  layout-1 file and writes files that earlier 1.x versions read. A format that needs incompatible
  changes gets a new schema (`layout-2`) and a migration, not a silent change.
- **DBML.** relvista does not parse DBML itself: it delegates to
  [@dbml/parse](https://www.npmjs.com/package/@dbml/parse), Holistics' parser, pinned to an exact
  version. A file valid on dbdiagram.io opens unchanged and saves back byte for byte unless you
  edit it. Moving to a newer `@dbml/parse` is a deliberate release with its own changelog entry,
  never a silent range update.
- **Pictures.** Layout and drawing details (exact positions chosen by auto-layout, ref routes,
  spacing, colours) can improve in minor releases. Saved positions in a layout file always win.

## Generated reference

The [API reference](/docs/api) is generated from the TSDoc comments in the source on every
docs build, so it always matches the code on `main`.
