# @relvista/core

## 1.0.0

### Major Changes

- 94b3465: First stable release. `@relvista/core` is the framework-free part of relvista: no React, no DOM,
  it runs in Node, browsers and workers. ESM only, Node 20 or later, TypeScript types included.

  - **DBML**: `compileDbml` compiles a `.dbml` file, or a multi-file project (`use` / `reuse`), with
    the official `@dbml/parse` (pinned exactly) into a diagram model: tables, columns, enums, refs,
    TableGroups, sticky notes, table partials and DiagramViews (`selectView`), with diagnostics that
    carry source spans. Anything dbdiagram.io accepts compiles.
  - **Layout file**: the `*.dbml.layout.json` sidecar (format `layout-1`; JSON Schema exported as
    `@relvista/core/layout.schema.json`) with `parseLayout`, `serializeLayout`, `emptyLayout`,
    `pruneLayout`, `renameNode` and node ids (`tableId`, `noteId`, `groupId`): per-view positions,
    pinned and collapsed nodes, note sizes and viewports. relvista never writes to the `.dbml` file.
  - **Geometry and auto-layout**: `measureTable` and `METRICS` (the sizes the renderer draws),
    `layoutDiagramSync` (dagre or grid) and `layoutDiagram` (ELK in a worker, or `engine: 'auto'`:
    dagre for small parts of a schema, ELK for the rest, `needsElk`), collapsed TableGroups.
  - **Analysis**: `searchModel`, `neighborhood`, `shortestPath`, `subsetModel`, and schema diffs
    (`diffModels`, `mergeForDiff`, `formatDiff`).
