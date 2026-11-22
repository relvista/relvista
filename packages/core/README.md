<img src="https://raw.githubusercontent.com/relvista/relvista/main/brand/icons/icon-192.png" width="48" height="48" alt="">

# @relvista/core

The framework-free core of **relvista**: it compiles [DBML](https://dbml.dbdiagram.io/docs/) into a
diagram model, reads and writes the `*.dbml.layout.json` layout file, and lays diagrams out
automatically. No React, no DOM: it runs in Node, in a browser and in a worker.

DBML is parsed by the official [`@dbml/parse`](https://github.com/holistics/dbml) (pinned to an
exact version), so any file dbdiagram.io accepts compiles here. relvista never rewrites a `.dbml`
file: positions and other diagram state go in the layout file next to it.

Documentation: <https://relvista.org/> · API reference:
<https://relvista.org/docs/api/>

## Install

```sh
npm install @relvista/core
```

ESM only, Node 20 or later (or any bundler). TypeScript types are included.

## Example

```ts
import { readFile } from 'node:fs/promises';
import { compileDbml, layoutDiagram, parseLayout, DEFAULT_VIEW } from '@relvista/core';

const { model, diagnostics } = compileDbml(`
Table users {
  id integer [pk]
  name varchar
}
Table posts {
  id integer [pk]
  user_id integer [ref: > users.id]
}
`);
if (!model) throw new Error(diagnostics.map((d) => d.message).join('\n'));

// Optional: saved positions from a layout file (validated against layout.schema.json).
const saved = parseLayout(await readFile('schema.dbml.layout.json', 'utf8'));
const layout = saved.ok ? saved.layout : null;

const geometry = await layoutDiagram(model, {
  engine: 'auto', // dagre for small parts of the schema, ELK for the rest
  saved: layout?.views[DEFAULT_VIEW] ?? null,
});
console.log(geometry.nodes['public.users']); // { id: 'public.users', kind: 'table', x, y, width, height }
```

Multi-file projects (`use` / `reuse`) compile from `{ files: { 'main.dbml': …, 'billing.dbml': … },
entry: 'main.dbml' }`.

## What is in it

- **Model**: `compileDbml`, `selectView` (DiagramViews), diagnostics with source spans.
- **Layout file**: `parseLayout`, `serializeLayout`, `emptyLayout`, `pruneLayout`, `renameNode`,
  node ids (`tableId`, `noteId`, `groupId`); per-view settings with `viewDetailLevel`,
  `withViewDetailLevel` and `renameViewSettings`. The JSON Schema ships as
  `@relvista/core/layout.schema.json`.
- **Geometry and auto-layout**: `measureTable` and the drawing `METRICS`, `layoutDiagramSync`
  (dagre or grid, synchronous) and `layoutDiagram` (ELK in a worker, or `engine: 'auto'`).
- **Analysis**: `searchModel`, `neighborhood`, `shortestPath`, `subsetModel`, `diffModels`.

To draw the model, use [`@relvista/renderer`](https://www.npmjs.com/package/@relvista/renderer);
for a Docusaurus site, [`@relvista/docusaurus-plugin`](https://www.npmjs.com/package/@relvista/docusaurus-plugin).

## Licence

MIT. Auto-layout uses [elkjs](https://github.com/kieler/elkjs) (EPL-2.0) and
[dagre](https://github.com/dagrejs/dagre) (MIT); parsing uses `@dbml/parse` (Apache-2.0).
