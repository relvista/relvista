# @relvista/renderer

## 1.1.0

### Minor Changes

- 29d5866: Frozen diagrams: `DbmlViewer` takes a `frozen` prop (default `false`, so nothing changes unless you set it). A frozen viewer starts with its layout locked: tables, notes and groups cannot be dragged (pointer, touch or keyboard) and groups cannot be collapsed or expanded, while panning, zooming, search, paths, focus, detail levels, export and links work as usual. The new toolbar item `'lock'` (in `DEFAULT_TOOLBAR`, after `'fit'`; shown only when `frozen` is set and `draggable` is not `false`) unlocks the layout for the reader, and locking it again puts back the arrangement of `layout` without moving the view. Nothing is saved. `draggable={false}` still wins: no lock button, never movable.
- c76f7b1: PDF export: Greek, Cyrillic, Chinese and Japanese text, and Latin letters beyond Western European ones (Polish, Czech, Turkish, Vietnamese…), stays selectable, searchable text instead of turning the page into an image. The PDF embeds a subset of Noto Sans (SIL OFL 1.1) or of a CJK font built from Droid Sans Fallback (Apache 2.0); the fonts load only when a diagram needs them. Arabic, Hebrew, Hangul, Indic scripts and emoji still export as images. New: the `embedFonts` option of `exportPdf` (default true; `false` keeps the 1.0 behaviour) and `pdfCanDrawText(text)`. Its `license` field is now `MIT AND OFL-1.1 AND Apache-2.0`: relvista's code stays MIT, the bundled fonts keep their licences.
- 7be176e: Per-view detail level. A layout file can give a named view its own detail level under
  `settings["x-relvista-view-settings"]` (an extension key, so relvista 1.0 still loads these files).
  Core adds `viewDetailLevel`, `withViewDetailLevel`, `renameViewSettings`, `VIEW_SETTINGS_KEY` and the
  `ViewSettings` type. The layout schema describes the key but, like every `x-` key, accepts any
  value: entries relvista cannot read are ignored and kept. `DbmlViewer` and `DiagramCanvas` start
  each view at its saved level (the `detailLevel` prop and the toolbar still override it), and
  `DbmlViewer` takes a new `defaultDetailLevel` prop. Docs diagrams with `view=` draw the view's level,
  at build time too.

### Patch Changes

- 8c00a6a: `DbmlViewer` no longer ships `react-dom/server` (about 60 KB gzip): the canvas writes its SVG export with the browser's serialiser (the same drawing; attributes are spelled as the browser writes them). The PDF dialog loads when it first opens, the PDF writer on export.
- 4b38447: Faster interaction with very large diagrams in `DiagramCanvas` and `DbmlViewer`: when a new model arrives (an edit), only the tables and ref lines that changed are drawn and measured again, hovering a table no longer redraws every dimmed card, and dragging a table costs less per frame. In the relvista editor, a keystroke in a 600-table schema now reaches the diagram about a quarter sooner (≈ 1.0 → 0.76 s, most of the rest is parsing). Drawings and exports are unchanged.
- Updated dependencies [7e2c7ab]
- Updated dependencies [7be176e]
  - @relvista/core@1.1.0

## 1.0.0

### Major Changes

- 94b3465: First stable release. `@relvista/renderer` draws relvista diagrams in React 18 or 19
  (`react` / `react-dom` `^18.0.0 || ^19.0.0`, both tested). ESM only, TypeScript types included;
  one stylesheet, `@relvista/renderer/styles.css`.

  - **Static SVG**: `DiagramSvg` and its parts (`TableSvg`, `RefSvg`, `GroupSvg`, `NoteSvg`), pure
    and server-renderable, and `renderDiagramSvgString` for a standalone `.svg` file. Refs are routed
    orthogonally around tables.
  - **`DbmlViewer`**: the interactive viewer (React Flow): zoom, pan, fullscreen, DiagramViews,
    search (tables, columns, enums, views) and shortest relationship paths, Names · Keys · All detail
    levels, "Show related" focus, a side card per table, export to SVG, PNG and PDF (tiled or one page
    per view; jsPDF loads only on the first PDF export), print, copy link, deep links
    (`target` / `onTargetChange`), schema diffs (`diffAgainst`) and "Open in editor". Keyboard
    accessible, light and dark.
  - **`DiagramCanvas`**: the canvas inside the viewer, also editable (the relvista editor uses it):
    controlled `layout` + `onLayoutChange`, drag and multi-select, keyboard moves, resizable notes and
    tables, collapsible TableGroups, pinning, auto-layout, per-view layouts, decorations and focus,
    and an imperative handle (`fitView`, `focusNodes`, `exportSvg`, `exportPng`, `print`, …) passed
    with `ref` (`forwardRef`, so it works in React 18 too).
  - **Export and links**: `exportPng`, `exportPdf`, `printDiagram`, `downloadBlob`; compressed
    share links (`encodeShareHash`, `decodeShareHash`, `createEditorLink`) and deep-link targets
    (`parseDiagramTarget`, `formatDiagramTarget`).
  - **Building blocks** for hosts: `SearchPanel`, `DetailSwitch`, `FocusControl`, `PdfDialog`,
    diff decorations, pure layout-edit helpers (`setNodePositions`, `setNodeSettings`,
    `effectivePositions`), and `viewerFirstView`, the view a `DbmlViewer` of a given size opens on,
    for static pictures that match it.
  - **Theming**: every colour is a `--rv-*` CSS variable declared with zero specificity, so any rule
    of yours wins; `PALETTES` holds the light and dark defaults. The stylesheet exports carry type
    stubs, so `import '@relvista/renderer/styles.css'` type-checks under
    `noUncheckedSideEffectImports`.

### Patch Changes

- Updated dependencies [94b3465]
  - @relvista/core@1.0.0
