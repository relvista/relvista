# @relvista/renderer

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
