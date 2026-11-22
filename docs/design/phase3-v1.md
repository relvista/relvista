# Phase 3 — v1: design and contracts

Authoritative for phase 3 (decision 0001: "phase 3 v1 advanced", gate "1.0 published on npm").
The owner-approved feature list is the twelve items of the proposal plus performance, API docs
and npm packaging quality. Publishing itself (changesets release, npm provenance workflow) is
done after the waves, from the owner's account, and is **not** designed here beyond what the
packages must already satisfy (§10).

Builders work in **waves** of parallel **work packages** (§12). Within a wave every package owns
a disjoint set of paths; nobody edits a file another package of the same wave owns. Files that
everyone would need — `packages/*/src/index.ts` and other barrel `index.ts` files, every
`package.json`, `apps/docs/sidebars.ts`, `THIRD_PARTY_NOTICES.md` — are edited only by the
**integration agent** that runs after each wave, following the package's integration note
(§12). A package that needs something from such a file writes it into its integration note and
imports from the module path directly in its own code and tests meanwhile.

Global rules (every package):

- **Compatibility promise.** Any dbdiagram `.dbml` opens and saves byte-identical unless edited.
  Edits made from the canvas (notes, colours, views, inactive refs) change only the bytes of
  the construct they touch (§6.1). `apps/editor/e2e/roundtrip.spec.ts` stays green untouched.
- **Pipeline green at the end of every package:** `pnpm -r build`, `pnpm lint`,
  `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm validate:examples`,
  `pnpm notices:check` (the integration agent regenerates notices; a package that adds a bundled
  import says so in its note), `pnpm docs:build`, `pnpm test:e2e`. Prefix shell commands with
  `source ~/.nvm/nvm.sh >/dev/null;` (Node 24). No `git commit`, no `git push`, no `npm publish`.
- **Dependencies are installed** (§2). Nobody runs `pnpm add`. A missing dependency is a design
  bug: write the smallest fix into this file and stop.
- **No schema change.** `schemas/layout.schema.json` (layout-1) already has everything phase 3
  stores: `collapsed` on `group:<name>` entries, `w`/`h` on notes, per-view `viewport`,
  `settings.detailLevel`. A package that finds otherwise records it in §13 and does not edit the
  schema.
- **Styles.** Renderer CSS for a phase-3 feature goes into a new file
  `packages/renderer/src/styles/<feature>.css` (concatenated after `src/styles.css` by
  `scripts/copy-css.mjs`, in name order). Palette variables stay in `src/styles.css` + `PALETTES`
  (`test/theme.test.ts` keeps them in sync); only the package that owns `styles.css` in a wave
  edits it. Editor CSS goes into a new file imported by the component that needs it.
- **Quality bar: better than dbdiagram.io.** Every interaction has a keyboard path, a visible
  focus state, light and dark themes, works at 390 px wide, and is axe-clean (wcag2a, wcag2aa).
- Lowercase **relvista** everywhere in prose, UI strings and docs.

---

## 1. Audit (2026-11-21, state after phase 2)

| #   | Item                                                        | Exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Missing                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Group colours + collapse, header/ref colours, inactive refs | Drawing: group colour (`svg/GroupSvg.tsx`, `groupColors` in `theme.ts`), header colour (`svg/TableSvg.tsx`), ref colour + dashed inactive refs (`svg/RefSvg.tsx`), contrast handling (`theme.ts` `withContrast`). Model fields: `TableGroup.color`, `Table.headerColor`, `Ref.color`, `Ref.inactive` (`core/src/model/types.ts`). Table collapse (`collapsed` → measured at `names`, `core/src/geometry/layout.ts`; NodeMenu "Collapse"). Schema already documents `collapsed` for groups. | **Group collapse**: nothing in core layout, renderer, canvas or editor (group entries are never read). **Editing** colours / inactive from the canvas (only by typing DBML). Inactive refs have no legend/tooltip distinction beyond the dash; collapsed tables keep refs at the header (OK).                                |
| 2   | Sticky notes edited on canvas                               | Notes drawn (`svg/NoteSvg.tsx`), dragged and saved (`canvas/DiagramCanvas.tsx`, `layoutEdit.ts`). `@dbml/parse` 12.1.0 `Compiler` has `createStickyNoteEdit`, `setStickyNoteTextEdit`, `removeStickyNoteEdit` (verified in `dist/src/compiler/index.d.ts`), already bundled in the editor.                                                                                                                                                                                                 | Create / resize / edit text / delete on the canvas; text edits applied to Monaco; note text wraps at a fixed `METRICS.noteWidth` (`core/src/geometry/measure.ts` `wrapNoteText`, `measureNote` ignore a saved `w`).                                                                                                          |
| 3   | Unlimited DiagramViews, switcher                            | Views compiled (`core/src/model/views.ts`, `selectView`), per-view layouts (`layoutEdit.ts`), switcher in the viewer toolbar (`viewer/Toolbar.tsx` `view` item) and the editor (`components/ViewSelect.tsx`), `view=` prop/meta in docs (`theme/DbmlDiagram`, `meta.ts`), share links carry the view. `@dbml/parse` has `syncDiagramView` (create/update/delete).                                                                                                                          | Creating, renaming, deleting and editing views from the editor UI; a searchable switcher for many views; a docs page using `view="billing"`.                                                                                                                                                                                 |
| 4   | Detail levels, N-hop focus                                  | `DetailLevel` everywhere (`measure.ts` `visibleColumns`, canvas/viewer `detailLevel` prop, `layout.settings.detailLevel`, fence meta `detail=`).                                                                                                                                                                                                                                                                                                                                           | A UI control (viewer toolbar, editor); persisting the editor's choice; focus mode ("related tables within N hops") entirely.                                                                                                                                                                                                 |
| 5   | Search, neighbours, shortest FK path                        | Hover/highlight neighbours (`svg/routing.ts` `highlightSets`, canvas `highlightedNodeId`).                                                                                                                                                                                                                                                                                                                                                                                                 | Search (tables, columns, enums, groups, notes, views), result navigation, multi-id highlight, shortest path.                                                                                                                                                                                                                 |
| 6   | Deep links                                                  | Share hash `#dbml=…&layout=…&view=…` (`renderer/src/share/codec.ts`, editor `share/shareLink.ts`); `?url=` (`files/remote.ts`).                                                                                                                                                                                                                                                                                                                                                            | `#table=`, `#view=` without a share payload, viewport in the URL, docs per-diagram anchors.                                                                                                                                                                                                                                  |
| 7   | SQL import/export (5 dialects)                              | Lazy `@dbml/core` worker (`apps/editor/src/sql/sql.worker.ts`, `sql.ts`): import Postgres/MySQL/MSSQL/Snowflake/Oracle, export Postgres/MySQL/MSSQL/Oracle; `SqlImportDialog.tsx`, `ExportMenu.tsx`.                                                                                                                                                                                                                                                                                       | **Snowflake export** (`@dbml/core` 12.1.0 has no Snowflake exporter: `lib/export/` lists Postgres, MySQL, SqlServer, Oracle only); export of multi-file workspaces (disabled); opening a dropped/opened `.sql` file.                                                                                                         |
| 8   | Multi-page PDF                                              | Print through a hidden iframe (`export/print.ts`), single page.                                                                                                                                                                                                                                                                                                                                                                                                                            | Real PDF: tiled A4/Letter with overlap marks, one page per view; lazy loading. Libraries installed (§2).                                                                                                                                                                                                                     |
| 9   | Share by URL                                                | Done in phase 2: codec + tests (`renderer/test/share.test.ts`), dialog (`ShareDialog.tsx`), e2e (`apps/editor/e2e/share.spec.ts`), docs "Open in editor".                                                                                                                                                                                                                                                                                                                                  | Verification only: links keep working with the deep-link keys of §4.5 next to `dbml=`; the docs button carries table/viewport when set.                                                                                                                                                                                      |
| 10  | Column-level edge routing                                   | Ends attach to the exact column row on left/right sides (`svg/routing.ts` `rowCenterOffset`, ELK ports in `core/src/geometry/elk.ts`), port fan-out.                                                                                                                                                                                                                                                                                                                                       | Obstacle avoidance. ELK routes are only used while ELK placed every node of the ref; any saved position (the editor saves all positions after its first `'place'`, every docs diagram with a layout file) falls back to `routeBetween`, a three-segment route that runs straight under unrelated tables.                     |
| 11  | Schema diff                                                 | `apps/editor/src/files/lineDiff.ts` (Myers line diff, text only).                                                                                                                                                                                                                                                                                                                                                                                                                          | Model diff, diff drawing, editor compare (file / pasted text / URL / git ref through a hosted URL), docs `<DbmlDiff>`.                                                                                                                                                                                                       |
| 12  | Build-time static SVG in Docusaurus                         | `DiagramSvg` is SSR-safe (`svg/DiagramSvg.tsx`); Docusaurus 3.10.2 SSR uses `renderToPipeableStream` + `onAllReady` (`@docusaurus/core/lib/client/renderToHtml.js`), so Suspense resolves on the server.                                                                                                                                                                                                                                                                                   | `DbmlDiagram` renders a `BrowserOnly` placeholder on the server: no diagram without JS, in print-before-load or in search-engine HTML.                                                                                                                                                                                       |
| P   | Performance                                                 | ELK in a worker (decision 0003), dagre first picture, lazy `@dbml/core`. `compileDbml` of `14-large` (16 KB, 61 tables, 94 refs): 29.5 ms in Node 24 on an M4 (measured 2026-11-21); budget 40 ms on CI (phase2 §6.3).                                                                                                                                                                                                                                                                     | Decision 0003 still `proposed`; ELK (450 KB gz worker) loads for every docs diagram without a complete layout; compile has no worker path (CI Chromium is slower than the M4, larger schemas exceed the budget).                                                                                                             |
| A   | API docs                                                    | TSDoc comments on most exports; package READMEs for renderer and plugin.                                                                                                                                                                                                                                                                                                                                                                                                                   | Reference pages for `@relvista/core`, `@relvista/renderer`, `@relvista/docusaurus-plugin` on the docs site; `@relvista/core` has no README.                                                                                                                                                                                  |
| N   | npm packaging                                               | `exports` maps, `types`, `sideEffects`, `files` on all three; `@relvista/docusaurus-plugin` has `repository`/`homepage`.                                                                                                                                                                                                                                                                                                                                                                   | `@relvista/core` README; `repository`/`homepage`/`bugs`/`keywords`/`engines`/`publishConfig` on core and renderer; `./package.json` export on core/renderer; LICENSE file inside each package; publint + arethetypeswrong never run (both installed now); `ajv` range is `^` while the rest pin exact (decide and document). |

---

## 2. Dependencies (installed 2026-11-21, lockfile updated)

| Where                     | Package                   | Version (exact) | Licence    | Use                                                          |
| ------------------------- | ------------------------- | --------------- | ---------- | ------------------------------------------------------------ |
| `packages/renderer` dep   | `jspdf`                   | 4.2.1           | MIT        | PDF writer, **dynamic `import()` only** (§4.4)               |
| `packages/renderer` dep   | `svg2pdf.js`              | 2.9.0           | MIT        | vector SVG → jsPDF, dynamic `import()` only                  |
| root devDependency        | `publint`                 | 0.3.25          | MIT        | package lint (§10)                                           |
| root devDependency        | `@arethetypeswrong/cli`   | 0.18.5          | MIT        | type resolution check (§10)                                  |
| `apps/docs` devDependency | `typedoc`                 | 0.28.20         | Apache-2.0 | API reference generation at docs build (§9), build-time only |
| `apps/docs` devDependency | `typedoc-plugin-markdown` | 4.14.1          | MIT        | Markdown output for Docusaurus                               |

- jsPDF has optional dependencies `html2canvas`, `canvg`, `dompurify`, `core-js` that its
  `.html()` / `addSvgAsImage()` load with `import()`. relvista never calls those. Bundlers must
  not emit them: the editor's `vite.config.ts` aliases the three module names to an empty module
  (`apps/editor/src/stubs/empty.ts`, exporting `export default {}`), and the Docusaurus plugin's
  `configureWebpack` sets `resolve.alias: { html2canvas: false, canvg: false, dompurify: false }`
  **scoped to jsPDF's own imports** (a module rule `{ test: /[\\/]jspdf[\\/]/, resolve: { alias } }`;
  site-wide, the alias broke `@docusaurus/theme-mermaid`, which needs DOMPurify — wave 2).
  `THIRD_PARTY_NOTICES.md` must then list only `jspdf`, `svg2pdf.js` and their real dependencies
  (`fflate`, `fast-png`, `@babel/runtime`, `cssesc`, `font-family-papandreou`, … whatever the
  build records).
- Nothing else is added. Search, graph algorithms, model diff, the router, deep links, the
  compile worker and the Snowflake exporter are own code. Monaco's diff editor is part of
  `monaco-editor/editor/editor.api`, already bundled.

---

## 3. `@relvista/core`

### 3.1 Collapsed TableGroups (geometry)

Layout entry: `views[view].nodes['group:<name>'] = { x, y, collapsed: true }` (named views: an
override with `collapsed` and optionally `x`/`y`). `collapsed: false` or a missing field means
expanded. The member tables keep their own entries untouched, so expanding restores them.

```ts
// packages/core/src/geometry/collapse.ts (new) — exported from geometry/index via integration
/** Ids of the groups of `model` (view-filtered) that `saved` marks collapsed. */
export function collapsedGroupIds(
  model: DiagramModel,
  saved: Partial<ViewLayout> | null | undefined,
): Set<string>;

/** Size of a collapsed group box: header with the group name + one row "N tables". */
export function measureCollapsedGroup(
  group: TableGroup,
  tableCount: number,
  measure?: TextMeasure,
): { width: number; height: number };

/**
 * (Removed before 1.0: unused; the renderer maps display nodes internally.)
 * The node a table is drawn as: its own id, or `group:<name>` when its group is collapsed.
 * Refs use it to find their ends.
 */
export function displayNodeOf(tableId: string, model: DiagramModel, collapsed: Set<string>): string;
```

`layoutDiagram` / `layoutDiagramSync` (all engines):

1. Every collapsed group becomes **one node** of the layout graph with id `group:<name>`, size
   `measureCollapsedGroup` (`saved.w`/`h` of the group entry override it), fixed when its entry
   has finite `x`/`y`. Its member tables are not in `geometry.nodes`.
2. A ref with an end in a collapsed group attaches to the group node's **header port**
   (ELK: header port `n<i>hE|W`, as for hidden columns). A ref with both ends in the same
   collapsed group is dropped from the layout and from `geometry.edges`. Several refs between
   the same pair of display nodes stay separate edges (the renderer merges them, §4.2).
3. `geometry.groups['group:<name>'] = { id, x, y, width, height, collapsed: true }` — the box
   **is** the collapsed node; nothing is in `geometry.nodes` under that id. Expanded groups are
   unchanged (box around members, no `collapsed` field). `GroupGeometry.collapsed` is already in
   `geometry/types.ts` (added with this design).
4. Packing (`layout-pack.ts`): a collapsed group counts as one block node like a lone table.
5. Deterministic as everything else; JSON of repeated runs equal.

Tests (`packages/core/test/geometry-collapse.test.ts`): every example with groups, each group
collapsed in turn and all at once × engines `elk`, `dagre`, `grid` × detail levels: no member in
`nodes`; box present with `collapsed: true`; saved x/y honoured; ELK route ends lie on the box's
left/right border at `headerHeight / 2`; internal refs absent; expanding (entry removed) gives
exactly the geometry of the expanded layout run.

### 3.2 Note size

- `wrapNoteText(content, measure, innerWidth)` already takes the width; `measureNote(note,
measure?, size?: { w?: number; h?: number })` gains `size`: `w` sets the box width (clamped
  to `METRICS.noteMinWidth = 120 .. METRICS.noteMaxWidth = 640`, new constants) and the wrap
  width (`w - 2 × notePadding`); `h`, when present, is the box height as is (≥
  `METRICS.noteMinHeight`), else the height the wrapped text needs.
- The layout pipeline passes the saved entry's `w`/`h` for notes into `measureNote` (tables keep
  today's `w`/`h` override behaviour).
- Tests extend `geometry-layout.test.ts`: note with `w` 300 wraps to fewer lines than default,
  `h` honoured, clamps.

### 3.3 Cheaper layout for small diagrams (resolves decision 0003)

```ts
// AutoLayoutOptions.engine gains 'auto' (the new default of layoutDiagram):
//   'auto' = per connected component of free nodes: dagre when the component has
//   ≤ AUTO_DAGRE_MAX_NODES nodes and no TableGroup with members in it, else ELK.
export const AUTO_DAGRE_MAX_NODES: number; // set from the measurement below; start value 6

/**
 * Whether `layoutDiagram(model, { ...options, engine: 'auto' })` would load ELK at all.
 * The canvas calls it to skip the async ELK pass (and the worker download) entirely.
 */
export function needsElk(model: DiagramModel, options?: LayoutOptions): boolean;
```

Measurement (the builder runs it once, keeps the script as
`packages/core/test/engine-auto.bench.ts`, excluded from `pnpm test`, and records the table in
decision 0003): for every example and 200 seeded random schemas (2–20 tables, 0–2 refs per
table), compare dagre + the renderer's router (§4.1; until it lands, straight centre-to-centre
segments) against ELK on (a) edge crossings, (b) route length, (c) bounding-box area, (d) routes
crossing unrelated tables. `AUTO_DAGRE_MAX_NODES` is the largest component size for which dagre
is within 5 % of ELK on (a)–(c) and not worse on (d) in ≥ 95 % of cases.

Decision 0003 is updated to **accepted** with this text (builder fills in the numbers):

- Docs sites render diagrams at build time in Node, ELK included (§5.1); the browser receives
  the positions and never downloads ELK for a server-rendered diagram.
- Elsewhere `engine: 'auto'`: dagre for components up to `AUTO_DAGRE_MAX_NODES` free nodes
  without groups, ELK in the worker above. `needsElk` lets the canvas skip ELK completely.
- Editor: ELK only when the canvas has unplaced nodes for which `needsElk` is true, or for an
  explicit Auto-layout.
- Compile in a worker when over budget: §6.2.

### 3.4 Graph analysis (`packages/core/src/analysis/`, new)

All pure, deterministic (model order breaks ties), no `Map`/`Set` iteration over unordered input.

```ts
// analysis/search.ts
export type SearchKind = 'table' | 'column' | 'enum' | 'group' | 'note' | 'view';
export interface SearchHit {
  kind: SearchKind;
  /** Node id for tables/groups/notes, table id for columns, enum id, view name. */
  id: string;
  /** Column name for kind 'column'. */
  column?: string;
  /** Text shown in a result list, e.g. "orders.user_id", "billing (view)". */
  label: string;
  /** UTF-16 [start, end) ranges of `label` that matched, for highlighting. */
  ranges: Array<[number, number]>;
  score: number;
}
export interface SearchOptions {
  kinds?: SearchKind[]; // default all
  limit?: number; // default 50
}
/**
 * Case- and accent-insensitive. Score: exact name 100 > prefix 80 > word-start 60 > substring 40
 * > subsequence (fuzzy, all chars in order) 20; tables before columns on ties, then model order.
 * `schema.table`, `table.column` and aliases match too. Empty query → [].
 */
export function searchModel(
  model: DiagramModel,
  query: string,
  options?: SearchOptions,
): SearchHit[];

// analysis/graph.ts
export interface GraphOptions {
  /** Default true: inactive refs connect too. */
  includeInactive?: boolean;
}
export interface Subgraph {
  tableIds: string[]; // model order
  refIds: string[]; // model order
}
/** Tables within `hops` refs of any of `ids` (undirected), with the refs among them. hops ≥ 0. */
export function neighborhood(
  model: DiagramModel,
  ids: readonly string[],
  hops: number,
  options?: GraphOptions,
): Subgraph;
/**
 * Shortest path by number of refs (undirected BFS). Ties: the path whose sequence of table
 * indexes in model order is lexicographically smallest. `null` when unconnected or unknown ids.
 */
export function shortestPath(
  model: DiagramModel,
  fromTableId: string,
  toTableId: string,
  options?: GraphOptions,
): (Subgraph & { length: number }) | null;
/**
 * Resolves what a user or URL wrote to a table id: exact id, `public.<name>`, a unique bare
 * name, a unique alias, case-insensitive unique name. `null` when none or ambiguous.
 */
export function resolveTableRef(model: DiagramModel, text: string): string | null;

// analysis/subset.ts
/**
 * `model` reduced to the given tables (+ notes), like `selectView` does for a DiagramView:
 * refs between kept tables, groups with kept members (tableIds filtered), views untouched.
 */
export function subsetModel(
  model: DiagramModel,
  keep: { tableIds: readonly string[]; noteIds?: readonly string[] },
): DiagramModel;
```

`selectView` should reuse `subsetModel` internally if that is a pure refactor; the existing
`model-views.test.ts` must stay green unchanged.

### 3.5 Model diff (`packages/core/src/analysis/diff.ts`, new)

```ts
export type ChangeStatus = 'added' | 'removed' | 'changed';

export interface FieldChange {
  field: string; // 'type' | 'pk' | 'notNull' | 'unique' | 'increment' | 'default' | 'note' | 'headerColor' | 'alias' | 'color' | 'relation' | 'onDelete' | 'onUpdate' | 'inactive' | 'name' | ...
  before: unknown;
  after: unknown;
}

export interface ColumnDiff {
  name: string;
  status: ChangeStatus;
  changes: FieldChange[]; // empty unless 'changed'
}

export interface TableDiff {
  id: string; // id in `after` (in `before` for removed)
  status: ChangeStatus;
  /** Set when a removed+added pair was paired as a rename (same column names and types). */
  renamedFrom?: string;
  changes: FieldChange[]; // table-level fields (note, headerColor, alias, group)
  columns: ColumnDiff[]; // only columns that differ, in `after` order then removed ones
  indexes: { status: ChangeStatus; label: string }[];
  checks: { status: ChangeStatus; label: string }[];
}

export interface ModelDiff {
  tables: TableDiff[];
  refs: { id: string; status: ChangeStatus; changes: FieldChange[] }[];
  enums: { id: string; status: ChangeStatus; values: { name: string; status: ChangeStatus }[] }[];
  groups: { id: string; status: ChangeStatus; changes: FieldChange[] }[];
  notes: { id: string; status: ChangeStatus; changes: FieldChange[] }[];
  views: { name: string; status: ChangeStatus }[];
  project: FieldChange[];
  /** Counts for a summary line. */
  summary: Record<'added' | 'removed' | 'changed', number>;
  /** True when nothing differs. */
  empty: boolean;
}

export interface DiffOptions {
  /** Pair removed+added tables with identical column (name, type) lists as renames. Default true. */
  detectRenames?: boolean;
}

export function diffModels(
  before: DiagramModel,
  after: DiagramModel,
  options?: DiffOptions,
): ModelDiff;

/**
 * One model to draw: `after` plus everything `before` had that `after` lacks (removed tables at
 * the end of `tables`, removed columns re-inserted after their former predecessor, removed refs,
 * enums, groups, notes). Spans of re-inserted elements point into `before` (`span.file` is
 * prefixed with `before:` so nothing reveals them in the editor's files).
 */
export function mergeForDiff(
  before: DiagramModel,
  after: DiagramModel,
  diff: ModelDiff,
): DiagramModel;

/** Plain-text / Markdown summary ("+ table billing.invoices", "~ users.email: varchar → text"). */
export function formatDiff(diff: ModelDiff, options?: { markdown?: boolean }): string;
```

Rules: identity by id (tables, enums: `schema.name`; refs: `Ref.id`, which is endpoint-derived;
groups/notes: name). Ref "changed" = same id, different relation/settings. Column order changes
alone are not a change. `fromPartial` columns count like own columns. Tests
(`packages/core/test/analysis-diff.test.ts`): identity diff of every example is `empty`; scripted
edits (add/drop column, change type, rename table, add ref, toggle inactive, group colour) each
produce exactly the expected entries; `mergeForDiff` contains every table/column/ref of both
models; diff of two example files is stable (snapshot).

Tests for 3.4: `analysis-search.test.ts` (ranking table, accents, aliases, schema-qualified,
limit), `analysis-graph.test.ts` (hops 0/1/2 on `14-large`, inactive option, shortest path
against a brute-force BFS on 300 seeded random graphs, tie-break determinism,
`resolveTableRef` ambiguity), `analysis-subset.test.ts`.

---

## 4. `@relvista/renderer`

### 4.1 Obstacle-avoiding orthogonal router (`svg/routing.ts`, `svg/router/`)

Goal: a ref line enters and leaves the exact column row (as today) and does not run under
tables it does not connect, wherever a route exists. Used for every ref without a usable ELK
route — in practice every ref in the editor and in any diagram with saved positions.

```ts
// svg/routing.ts — RouteContext gains:
export interface RouteContext {
  model: DiagramModel;
  geometry: DiagramGeometry;
  detailLevel: DetailLevel;
  edgeStyle: EdgeStyle;
  usePoints?: boolean;
  /**
   * 'tables': route around table, note and collapsed-group boxes. 'none': phase-2 routes.
   * Default 'tables' since wave 2 (canvas v1); it was 'none' in wave 1.
   */
  avoid?: 'tables' | 'none';
}

/** Incremental re-routing (drag frames): only refs touching `dirty` node ids are recomputed. */
export interface RouteCache {
  routes: Map<string, RefRoute>;
  /** Internal: obstacle index keyed by geometry identity. */
  readonly key: unknown;
}
export function routeAll(
  ctx: RouteContext,
  cache?: { previous: RouteCache; dirty: ReadonlySet<string> },
): Map<string, RefRoute> & { cache: RouteCache };
```

(The return type stays assignable to `Map<string, RefRoute>`, so existing callers compile.)

Algorithm (`svg/router/`):

1. **Obstacles**: every node box (tables, notes, collapsed groups) inflated by `MARGIN = 12`,
   except the ref's own two end boxes. Expanded group boxes are **not** obstacles (lines may
   cross a group's tinted area, not its tables); routes avoid running along a group border by
   a cost penalty within 6 px of it.
2. **Ports**: unchanged — left/right side at `rowCenterOffset(row)`, side choice as
   `chooseSides`, then a straight stub of `STUB` (28) out of the table (room for markers).
3. **Search**: orthogonal visibility graph over the obstacle corners and the two stub ends
   (sparse, Wybrow–Marriott–Stuckey style), A* with cost `length + 40 × bends + 2000 × (segments
inside an obstacle)`; the last term keeps a route possible when no clean one exists (then it
   is the least-bad one).
4. **Nudging**: segments of different refs sharing a channel (collinear overlap > 8 px) are
   spread 6 px apart, ordered to avoid crossings (simple left-to-right sweep).
5. **Port fan** (`fanOffsets`) unchanged, applied before routing.
   5a. **Collapsed groups**: an end whose table belongs to a group with
   `geometry.groups[g].collapsed` attaches to that box (row −1, the header centre), in both
   `avoid` modes; refs with both ends in the same collapsed group get no route. `RefRoute`
   gains `fromNode` / `toNode` (the display node ids: table id or `group:<name>`).
6. **Styles**: `orthogonal` uses the route with rounded corners (`roundedPath`); `straight` and
   `curved` keep phase-2 behaviour (no avoidance).
7. **Budget**: `routeAll` on `14-large` (dagre geometry, all refs routed) ≤ 25 ms median in
   Node on the dev machine, asserted ≤ 150 ms in the test; a drag frame re-routing the refs of
   one table ≤ 4 ms. Above `ROUTER_MAX_NODES = 400` nodes, `avoid` falls back to `'none'`.
8. Deterministic: same input → same path strings.

Tests (`packages/renderer/test/router.test.ts`): for every example × {dagre, grid, ELK with all
positions saved} layouts: no segment of an `orthogonal` route intersects the interior of a
non-end table box (inflated by 2 px) when a clean route exists (verified by also asserting the
visibility graph had one); first/last points exactly at row centres on the side border;
determinism; incremental mode equals full re-route for the dirty refs; budget. Existing
`svg.test.tsx`/`review*.test.ts` route expectations may change only where they asserted the old
three-segment shape; update them with a comment.

### 4.2 Drawing: collapsed groups, notes, decorations (`svg/`)

```ts
// svg/decorations.ts (new) — the one seam for search hits, paths, focus and diff
export type DecorationTone = 'match' | 'path' | 'added' | 'removed' | 'changed';
export interface Decorations {
  /** Node (table / note / group) id → tone; drawn as a ring + tint (removed: dashed outline, 60% opacity, name struck through). */
  nodes?: Record<string, DecorationTone>;
  /** Table id → column name → tone (row tint; removed rows struck through). */
  columns?: Record<string, Record<string, DecorationTone>>;
  /** Ref id → tone (stroke colour + width 2; removed dashed). */
  refs?: Record<string, DecorationTone>;
  /** Dim (opacity 0.28) every node and ref without a decoration. Default false. */
  dimOthers?: boolean;
  /** Small text badges at a node's header right, e.g. "~3" (changed column count). */
  badges?: Record<string, string>;
}
```

- `DiagramSvgProps`, `TableSvgProps`, `NoteSvgProps`, `GroupSvgProps`, `RefSvgProps` and
  `SvgExportOptions` gain `decorations?: Decorations | null` (component-level props take the
  slice they need: `tone?`, `columnTones?`, `badge?`). Exports draw decorations too (a diff can be
  exported as SVG/PNG/PDF).
- Palette: new keys `match`, `path`, `diffAdded`, `diffRemoved`, `diffChanged` in `PALETTES`
  (light and dark, contrast ≥ 3:1 against `canvasBg` and the table background, unit-tested) and
  as `--rv-*` variables in `styles.css`; the Docusaurus `site-palette.css` maps `match`/`path`
  to the site primary (plugin package, §5).
- **Collapsed group** (`svg/CollapsedGroupSvg.tsx`, new): a card like a table — header band in
  the group colour (or `groupDefault`), group name, one row "N tables" with a stacked-cards
  icon; `data-rv-group={id}` `data-rv-collapsed="true"`; `<title>` lists the member table names.
  `DiagramSvg` draws it for `geometry.groups[id].collapsed`.
- **Merged refs**: refs whose display ends (table id, or `group:<name>` for a member of a
  collapsed group — computed locally in `svg/collapsed.ts` from `model.groups` and
  `geometry.groups[*].collapsed`, since the router's `fromNode`/`toNode` land in the same wave)
  are the same pair are drawn as one
  line with a count label `×N` at its midpoint when N > 1; markers drawn only when all merged refs
  have the same cardinalities at that end, else a plain end. The merged line's `<title>` lists all
  refs. Hover/highlight of the group lights all of them.
- **Notes**: `NoteSvg` wraps at `box.width - 2 × notePadding` (same function as core, so
  measurement and drawing agree) and clips text to the box (`clipPath`), with a 12 px fade at the
  bottom when clipped.
- **Inactive refs**: dash stays; `<title>` already says "(inactive)"; add `data-rv-inactive`,
  and draw inactive refs at 60 % opacity, under active ones (render order).
- Tests (`svg.test.tsx` additions, new `decorations.test.tsx`): every tone renders the expected
  `data-rv-tone` attributes and colours in both modes; removed column row struck through; collapsed
  group card; merged ref label; note clipping; export string contains decorations.

### 4.3 `DiagramCanvas` v1 additions (`canvas/`)

Additions only; every phase-2 prop and handle method keeps its meaning.

```ts
export type LayoutChange =
  | /* phase 2 kinds unchanged */ ...
  /** A note (or table) was resized with the handles (editable). One undo step. */
  | { kind: 'resize'; view: string; ids: string[] };

export interface NodeSettings {
  pinned?: boolean;
  /** Tables: header only. Groups ('group:<name>'): one box (§3.1). */
  collapsed?: boolean;
}

export interface CanvasFocus {
  /** Table ids at the centre of the focus. */
  ids: string[];
  /** 0..5; tables farther away are hidden (not dimmed). */
  hops: number;
}

export interface CanvasEdgeEvent {
  id: string; // ref id
  span: SourceSpan | null;
  clientX: number;
  clientY: number;
}

export interface CanvasPaneEvent {
  clientX: number;
  clientY: number;
  /** Diagram coordinates of the pointer. */
  x: number;
  y: number;
}

interface DiagramCanvasProps {
  // … phase 2 …
  /** Search hits, paths, diff: see Decorations (§4.2). */
  decorations?: Decorations | null;
  /** Several ids lit like `highlightedNodeId` (tables, notes, groups, refs). */
  highlightIds?: readonly string[] | null;
  /** Focus mode (§3.4 neighbourhood): only those tables (+ notes of the view) are shown. */
  focus?: CanvasFocus | null;
  /** Model to draw instead of the view-filtered `model` (diff mode: mergeForDiff result). */
  displayModel?: DiagramModel | null;
  /** Notes (and, when true, tables) get resize handles in editable mode. Default 'notes'. */
  resizable?: 'notes' | 'all' | false;
  onEdgeClick?: (e: CanvasEdgeEvent) => void;
  /** When set, the canvas calls preventDefault on the native contextmenu event. */
  onEdgeContextMenu?: (e: CanvasEdgeEvent) => void;
  /** When set, the canvas calls preventDefault on the native contextmenu event. */
  onPaneContextMenu?: (e: CanvasPaneEvent) => void;
  onPaneDoubleClick?: (e: CanvasPaneEvent) => void;
}

interface DiagramCanvasHandle {
  // … phase 2 …
  /** Fit the given nodes (or all when empty), optionally capping zoom. */
  focusNodes(ids: string[], options?: { duration?: number; maxZoom?: number; padding?: number }): void;
  /** Screen rectangle (client px) of a node as drawn now, or null. For overlays (note editor). */
  getNodeClientRect(id: string): DOMRect | null;
  /** Client px → diagram coordinates. */
  clientToDiagram(clientX: number, clientY: number): { x: number; y: number };
  /** Write one or more node positions (e.g. a new note placed where the user clicked); reports 'move'. */
  placeNodes(positions: Record<string, { x: number; y: number }>): void;
}
```

Rules:

1. **Collapse**: `setNodeSettings(['group:x'], { collapsed: true })` writes `collapsed: true`
   **and** the group's current box `x`/`y` (rounded) into the view's group entry, so the box stays
   where the group was; expanding removes `collapsed` and leaves `x`/`y` (ignored while expanded,
   pruned by the editor's save when not collapsed — `pruneLayout` keeps it; harmless). Review
   round 1: collapsing several groups in one call (Collapse all groups) packs their cards instead
   (`packCollapsedCards`: a dagre layout of the cards when nothing else is drawn, else the cards
   pulled together around their centre, clear of the other nodes), writes it as one change, and
   fits the view once drawn; members keep their positions, so Expand all restores the diagram. A collapsed
   group is a draggable node (`rvCollapsedGroup` node type, `data-id='group:x'`); its drag reports
   `'move'` for the group id. Double-click on a group header (expanded) or a collapsed group card
   toggles collapse (editable mode; read-only viewers: toggles locally, never reported).
2. **Resize**: React Flow `NodeResizer` on notes (min 120×64, max 640×1200); on resize end one
   `'resize'` change writing `w`/`h` (rounded) and `x`/`y` if the top-left moved. Keyboard:
   none (resize is also possible by editing w/h in the layout file; documented).
3. **Focus**: `neighborhood(viewModel, focus.ids, focus.hops)` → `subsetModel` (tables only;
   review round 1: notes are left out); positions start from the view's and are then pulled
   together around the focused tables (`compactFocus`: each table slides along its line to the
   root until it keeps 72 px from what is placed, so directions are kept and a sparse
   neighbourhood reads at a useful zoom). Display only: in focus mode nodes do not drag or resize
   and nothing is written; the viewport fits the focused set when `focus` changes (250 ms). Not
   stored in the layout.
4. **Decorations / highlightIds** flow to the svg components; `dimOthers` dims non-decorated nodes.
5. **Engine**: `useCanvasGeometry` calls `needsElk(model, options)` (§3.3); when false it never
   starts ELK and reports `'done'` right after the sync layout (editable: one `'place'` for the
   dagre positions, as it does today after ELK).
6. **Routing**: flip `RouteContext.avoid`'s default to `'tables'` (canvas, `DiagramSvg`,
   exports) and use the `RouteCache` incremental mode during drags (dirty = dragged ids), full
   re-route on drag stop. Update existing route expectations in `svg.test.tsx` /
   `review*.test.*` with a comment where they asserted the phase-2 three-segment shape.
7. **Displaying diff**: when `displayModel` is set it replaces the view-filtered model for drawing
   and layout (positions still from `layout` for the current view; removed tables without a
   position are placed by the sync layout); `onLayoutChange` is not called for nodes that exist
   only in `displayModel` (removed ones).
8. New hooks: `data-rv-focus="true"` on the root while focused; `data-rv-collapsed="true"` on
   collapsed group nodes; `.react-flow__edge` elements carry `data-id` = ref id for e2e.

Tests (`canvas.test.tsx` additions, new `canvas-v1.test.tsx`): collapse writes `collapsed` +
x/y and reports `'settings'`; collapsed node drag reports `'move'` for the group id; resize reports
`'resize'` with integer w/h; focus hides tables beyond N hops and keeps positions; `needsElk` false →
no `layoutAsync` call (spy) and `'done'`; decorations reach the DOM (`data-rv-tone`);
`placeNodes` reports one `'move'`; edge and pane events carry ids/diagram coordinates; viewport
unchanged by decoration changes.

### 4.4 PDF export (`export/pdf/`)

```ts
// export/pdf/index.ts — re-exported from the package root; imports nothing heavy
export type PaperSize = 'a4' | 'letter';
export interface PdfPageSource {
  /** Page heading, e.g. the view name. */
  title: string;
  model: DiagramModel; // view-filtered (or merged diff model)
  geometry: DiagramGeometry;
  decorations?: Decorations | null;
}
export interface PdfOptions {
  /** 'tiled': one diagram over as many pages as needed at `scale`; 'pages': one page per source, fit to page. */
  mode: 'tiled' | 'pages';
  paper?: PaperSize; // default from navigator.language: 'letter' for en-US/en-CA/es-MX, else 'a4'
  orientation?: 'auto' | 'portrait' | 'landscape'; // default 'auto' (fewest pages / best fit)
  /** Tiled: print scale, diagram px → pt. Default 0.75 (1 px = 1/96 in, i.e. 100 %). */
  scale?: number;
  /** Tiled: overlap between neighbouring pages, mm. Default 10. */
  overlapMm?: number;
  /** Tiled: cut/registration marks in the overlap and page labels "B2 (row B, column 2)". Default true. */
  marks?: boolean;
  /** Tiled: an overview page first (whole diagram fit to page with the tile grid). Default true when > 1 tile. */
  overview?: boolean;
  /** Document title (PDF metadata and running header). */
  title?: string;
  detailLevel?: DetailLevel;
  edgeStyle?: EdgeStyle;
  palette?: PaletteOverrides | null; // print is always light; palette fonts honoured
}
/** Lazy: `import('./impl.js')` loads jspdf + svg2pdf.js on first call. Browser only. */
export function exportPdf(pages: PdfPageSource[], options: PdfOptions): Promise<Blob>;
/** Pure, for tests and the dialog preview: tile grid in mm for a diagram of `bounds` px. */
export function planTiles(
  bounds: Box,
  options: Pick<PdfOptions, 'paper' | 'orientation' | 'scale' | 'overlapMm'>,
): {
  pageMm: { w: number; h: number };
  orientation: 'portrait' | 'landscape';
  rows: number;
  cols: number;
  tiles: Array<{ row: number; col: number; x: number; y: number; w: number; h: number }>;
};
```

- Implementation: `renderDiagramSvgString` (light, literal colours) → `DOMParser` → for each
  tile `svg2pdf(svgEl, doc, { x, y, width, height })` inside a clip rectangle with the tile's
  translation; margins 10 mm; header line (title, view, page label, "relvista") 7 pt grey.
- **Fonts**: jsPDF standard fonts (Helvetica for names, Courier for types). Text outside
  WinAnsi (CJK, emoji, most non-Latin scripts) cannot be drawn with them: when any drawn string
  has such characters, that page is rendered as a 3× PNG image (existing `exportPng` path)
  instead, and the dialog says "Some text uses characters the PDF fonts lack; pages are
  embedded as images". Recorded in §13 as a follow-up (embedding a Noto subset).
- Hard limits: ≤ 200 pages (error otherwise, with a hint to lower the scale).
- Tests (`test/pdf.test.ts`, jsdom): `planTiles` grids (exact counts for known sizes, overlap,
  orientation choice), `exportPdf` with `compress: false` → page count and `/MediaBox` sizes
  parsed from the bytes, table names present as text objects, overview page present, 'pages' mode
  one page per source, non-WinAnsi fallback path chosen. Bundle check: the renderer's main entry
  must not statically import `jspdf` or `svg2pdf.js` (test greps `dist/index.js` graph via
  `import.meta` resolution, or asserts with a regex on built files in `pdf.test.ts`).

### 4.5 Deep-link codec (`share/deepLink.ts`)

```ts
export interface DiagramTarget {
  view?: string; // DiagramView name; absent = default view
  table?: string; // table as written (id, name or alias; resolved with resolveTableRef)
  hops?: number; // with `table`: focus mode
  detail?: DetailLevel;
  viewport?: Viewport; // x,y,zoom
  search?: string;
  path?: [string, string]; // two tables
}
/**
 * Reads target keys from a hash or query body ('#…', '?…' or bare), ignoring every other key
 * (share keys dbml=/layout= coexist). Invalid values are dropped, never thrown.
 * Grammar (URLSearchParams): view=<enc>&table=<enc>&hops=<0..5>&detail=all|keys|names
 * &vp=<x>,<y>,<zoom> (numbers, at most 2 decimals, zoom 0.05..4)&q=<enc>&path=<enc>~<enc>
 */
export function parseDiagramTarget(hash: string): DiagramTarget;
/** Keys in the order above; '' for an empty target. */
export function formatDiagramTarget(target: DiagramTarget): string;
/**
 * Docs anchors: '#<anchor>&<target keys>' or '#<anchor>' — the first segment without '=' is the
 * anchor. Returns null when the hash names no anchor.
 */
export function parseAnchoredTarget(hash: string): { anchor: string; target: DiagramTarget } | null;
export function formatAnchoredTarget(anchor: string, target: DiagramTarget): string;
```

`encodeShareHash` / `decodeShareHash` are unchanged (unknown keys already ignored); a share link
may append `&` + `formatDiagramTarget(...)` and the editor reads both (§6.10). Tests
(`test/deepLink.test.ts`): round trip, key order, garbage values dropped, coexistence with share
keys, anchors with and without params, unicode view names.

### 4.6 Diff decorations (`diff/`)

```ts
// diff/decorations.ts
/** Decorations for a mergeForDiff model: added/removed/changed tones on tables, columns, refs, notes, groups; badges "+2 −1 ~3". */
export function diffDecorations(diff: ModelDiff): Decorations;
/** Legend items for a diff (label, tone, count) for overlays. */
export function diffLegend(
  diff: ModelDiff,
): Array<{ tone: DecorationTone; label: string; count: number }>;
```

Tests (`test/diff-decorations.test.ts`) on scripted diffs of the examples.

### 4.7 Viewer v1 (`viewer/`, `nav/`)

Reusable navigation components (`packages/renderer/src/nav/`, exported) used by `DbmlViewer`
and mounted by the editor's diagram pane:

```ts
export interface SearchPanelProps {
  model: DiagramModel; // view-filtered
  /** Called with the chosen hit (Enter / click); the host focuses and highlights it. */
  onSelect(hit: SearchHit): void;
  /** Called with the current hits while typing (host decorates them, 'match' tone). */
  onHits?(hits: SearchHit[]): void;
  /** Two-table path mode. */
  onPath?(path: (Subgraph & { length: number }) | null, ends: [string, string] | null): void;
  onClose(): void;
  initialQuery?: string;
}
export function SearchPanel(props: SearchPanelProps): ReactElement; // combobox + listbox, ARIA 1.2 pattern

export function DetailSwitch(props: {
  value: DetailLevel;
  onChange(v: DetailLevel): void;
}): ReactElement; // radiogroup "Names · Keys · All"
export function FocusControl(props: {
  tableLabel: string;
  hops: number;
  onChange(h: number): void;
  onExit(): void;
}): ReactElement; // chip "Related to orders · 2 hops [−][+] ✕"
export function PdfDialog(props: {
  views: { name: string; label: string }[];
  current: string;
  onExport(o: PdfOptions & { views: string[] }): void;
  onClose(): void;
  planFor(o: PdfOptions): ReturnType<typeof planTiles>;
}): ReactElement;
```

`DbmlViewer` / `Toolbar` changes:

- New toolbar items `'search'` (magnifier; `/` or Mod+K inside the viewer opens it), `'detail'`
  (menu Names / Keys / All), `'link'` (copies `location` with the anchored target, §5.2; hidden
  when the host passes no `anchor`), and `'export'` gains **PDF…** (opens `PdfDialog`). New
  `DEFAULT_TOOLBAR`: `view, search, detail, zoom, fit, fullscreen, export, print, link,
open-in-editor`.
- Search: hits decorated `'match'` with `dimOthers` while the panel has a query; selecting a
  table → `focusNodes([id], { maxZoom: 1 })` + highlight its neighbours; a column → same, row
  toned. Path mode ("Path from … to …", two comboboxes): tones `'path'` on the path tables and
  refs, `dimOthers`, fits the path, lists hops in the panel ("users → orders → order_items, 2
  refs"); no path → "No relationship path between A and B".
- Side card gains **Show related** (hops 1, `FocusControl` to change, Esc exits).
- Props added: `target?: DiagramTarget` (applied after the first `'done'`, and whenever it
  changes), `onTargetChange?(t: DiagramTarget)` (debounced 300 ms on view/detail/focus/search/path
  changes and viewport moves), `anchor?: string` (enables `'link'`), `decorations?`,
  `diffAgainst?: CompileInput` (compiles both, `diffModels(before = diffAgainst, after = source)`,
  draws `mergeForDiff` with `diffDecorations`, legend overlay "+3 −1 ~4"; editor link hidden),
  `ssrLayout?: Layout` (positions computed at build time, §5.1: used as the layout when `layout`
  has no position for a node; never put into "Open in editor" links). Until this prop exists
  (wave 3), the SSR package passes the build-time positions merged into `layout`.
- "Open in editor" link appends `&` + `formatDiagramTarget({ view, table })` of the current state.
- `handle.exportPdf(options)` on the canvas handle is **not** added; the viewer and the editor
  call `exportPdf` with `getGeometry()` themselves.
- The plugin's `TOOLBAR_ITEMS` / options validation gain the new items (owned with the viewer,
  §12 wave 3).
- Tests: jsdom (`viewer-v1.test.tsx`): search lists hits and decorates; path mode; detail switch
  changes the drawn rows; focus chip; target applied/emitted; diffAgainst draws tones and legend;
  toolbar keyboard path. Docs e2e (`apps/docs/e2e/viewer-v1.spec.ts`): on `14-large` search
  "invoice" → Enter → table centred and lit; path between two tables lit; detail Keys reduces
  rows; PDF tiled export downloads a PDF whose page count equals `planTiles` (read with a regex on
  `/Type /Page`); axe clean with the search panel open, both themes.

---

## 5. `@relvista/docusaurus-plugin`

### 5.1 Build-time static SVG (SSR) + hydration

What a reader gets: the diagram is in the HTML. Without JS (or before it loads, or in print,
or for a crawler) the static SVG shows at its final size; with JS the interactive canvas
replaces it in place without a visible jump.

Server render of `@theme/DbmlDiagram` (and fences):

1. `StaticDiagram` (new, `theme/DbmlDiagram/StaticDiagram.tsx`) suspends on
   `staticDiagramResource(key)` — a module-level promise cache keyed by
   `hash(source, layoutJson, view, detailLevel)` — that runs in Node: `compileDbml` →
   `selectView` → `layoutDiagram({ engine: 'elk' })` (ELK in-process; ELK quality at build time
   costs nothing) → `renderToStaticMarkup(<DiagramSvg … />)` with `var(--rv-*)` colours (not
   literal, so the site's light/dark CSS applies) and `idPrefix` unique per diagram.
   Docusaurus waits for `onAllReady`, so the HTML contains the SVG.
2. `layout="path"` (a static file) and `src="path"` are read at SSR from the site's static
   directories through `relvista-ssr-files` (named so in wave 2) — a module the plugin aliases in
   `configureWebpack(config, isServer)`: server → a generated module that reads
   `siteDir/<staticDir>/<path>` with `fs` (paths normalised, `..` refused, files cached);
   client → a stub that returns `null` (the client fetches, as today). Remote `http(s):` `src`
   values are not fetched at build time (placeholder as today).
3. Output markup (inside the existing wrapper, same height):

   ```html
   <div class="relvista-static" data-rv-static="<key>" aria-hidden="false">
     <svg class="rv-diagram" role="img" aria-label="<title or 'Entity-relationship diagram'>">
       …
     </svg>
   </div>
   <script type="application/json" data-rv-ssr="<key>">
     {"v":1,"positions":{…},"groups":{…}}
   </script>
   ```

   The SVG is scaled to fit the box (`width="100%" height="100%"`, `preserveAspectRatio="xMidYMid
meet"`); below 600 px it uses the readable-zoom rule of the initial view (horizontal scroll
   inside the box, never the page).

4. Errors at build time (parse errors, missing file) render today's Problem/placeholder markup
   and log one `[relvista]` warning with page and line; they never fail the build.

Client:

1. **Hydration**: the first client render of `StaticDiagram` must produce identical markup. It
   reads the server HTML of its container (`document.querySelector('[data-rv-static="<key>"]')`)
   and renders it back with `dangerouslySetInnerHTML` (+ `suppressHydrationWarning`); when absent
   (client-side navigation), it computes the static SVG with `layoutDiagramSync` only if no ELK
   would be needed (`needsElk` false), else shows the placeholder (as today).
2. The interactive `DbmlViewer` mounts in the same box (BrowserOnly + lazy chunk, as today),
   absolutely positioned above the static layer, with `ssrLayout` = positions from the JSON
   script → no ELK in the browser. When the viewer reports `data-rv-layout="done"`, the static
   layer gets `hidden` (kept in the DOM for print and for no-flash theme switches). The static
   picture is framed like the viewer's first view, so the swap does not move: the renderer's
   `viewerFirstView` (the canvas's `initialViewport` with `DbmlViewer`'s padding and phone height)
   is evaluated at build time for every box width, and `ssr/frames.ts` writes it as
   container-query rules per range of widths (`data-rv-frame`), with `cq` expressions wherever the
   rule depends on the width continuously (fit, one axis filled, centred axis, window anchored at
   its far edge). Readable-zoom windows of big diagrams and phone widths are included.
3. **Print**: `@media print` shows `.relvista-static` and hides the interactive canvas (sharp
   vector output on paper, one diagram per box).
4. **Dark mode**: static SVG colours are `var(--rv-*)`; the plugin's CSS sets the dark palette
   under `html[data-theme='dark'] .relvista-static` (and the site palette mapping for
   `palette: 'site'`), so it follows the theme without JS.
5. Options: `themeConfig.dbml.ssr: boolean` (default `true`), prop/meta `ssr={false}` /
   `ssr=false` per diagram. Multi-file `value` objects SSR too.
6. Size guard: a diagram whose SVG markup exceeds 1.5 MB is not inlined (placeholder + warning).

Tests:

- Unit (`packages/docusaurus-plugin/test/ssr.test.tsx`): `renderToPipeableStream` of
  `DbmlDiagram` for an example → HTML contains `<svg`, every table name, the JSON positions; bad
  DBML → problem markup, no throw; `ssr: false` → placeholder; file resolver refuses `..`.
- Docs e2e (`apps/docs/e2e/ssr.spec.ts`): with `javaScriptEnabled: false` every gallery page
  shows an `svg.rv-diagram` with its tables (count = model count); with JS: no hydration errors or
  warnings in the console, no request to `elk-worker` on any gallery page that SSR'd, the
  interactive canvas ends up visible with node positions equal to the static ones (±1 px for 3
  tables), `page.emulateMedia({ media: 'print' })` shows the static layer. Compat e2e keeps
  passing (`apps/docs-compat`).

### 5.2 Per-diagram anchors and deep links

- `id` prop / fence meta `id="billing"`. Default anchor: `diagram-<slug(title)>` when a title exists
  (review round 1: the prefix keeps it apart from heading slugs), else
  `diagram-<8 hex of FNV-1a(source + view)>` (deterministic on server and client). The build
  warns about two diagrams with one anchor on a page; the browser warns about any duplicate id. The wrapper
  gets `id={anchor}` (native `#anchor` scrolling), `data-rv-anchor`.
- On load and on `hashchange`, `parseAnchoredTarget(location.hash)`; when its anchor is this
  diagram: scroll into view, pass `target` to `DbmlViewer` (view, table → centre + highlight,
  hops → focus, detail, viewport, q, path).
- `onTargetChange` updates `location.hash` with `history.replaceState` (never `pushState`)
  only while the diagram is the one the hash already names or after the user pressed the toolbar
  `'link'` button ("Link copied", toast inside the viewer); other diagrams on the page never touch
  the URL.
- Heading anchors keep working (an anchor that is not a diagram is ignored).

### 5.3 `<DbmlDiff>` (`theme/DbmlDiff`, new theme component)

```ts
declare module '@theme/DbmlDiff' {
  export interface Props {
    readonly old?: string | CompileInputFiles; // before
    readonly new?: string | CompileInputFiles; // after
    readonly oldSrc?: string; // URLs (static files) instead
    readonly newSrc?: string;
    readonly layout?: Layout | string | null; // positions for the after model
    readonly view?: string;
    readonly height?: number | string;
    readonly title?: string;
    /** Show the change list under the diagram. Default true. */
    readonly summary?: boolean;
    readonly id?: string;
  }
  export default function DbmlDiff(props: Props): ReactNode;
}
```

Renders `DbmlViewer` with `source = new`, `diffAgainst = old`, plus (SSR too) a `<details>`
"Changes (+3 −1 ~4)" with `formatDiff` as a list. Static SVG SSR as §5.1 with decorations. A
fence form ` ```dbml-diff ` whose body is `old` and `new` separated by a line `---` (exactly three
dashes alone on a line) is supported by the MDX `Code` wrapper.

### 5.4 Plugin configuration additions

`themeConfig.dbml`: `ssr` (5.1), `toolbar` items (4.7), nothing else. `client.d.ts` gains
`@theme/DbmlDiff` and the new `Props` fields (`id`, `ssr`). `configureWebpack`: the jsPDF optional
dependency aliases (§2) and the `ssr-files` alias (§5.1).

---

## 6. Editor (`apps/editor`)

### 6.1 Text edits from the canvas (`src/edits/`)

```ts
// edits/dbmlEdits.ts — pure, over @dbml/parse Compiler + MemoryProjectLayout (already bundled)
export interface FileEdit {
  file: string; // EditorFile key
  start: number; // UTF-16 offset into the Monaco text (LF), as TextEdit
  end: number;
  newText: string;
}
export interface EditInput {
  files: Record<string, string>; // Monaco texts (LF, no BOM)
  entry: string;
}
export function createStickyNote(
  input: EditInput,
  file: string,
  name: string,
  text: string,
  color?: string,
): FileEdit[];
export function setStickyNoteText(input: EditInput, noteName: string, text: string): FileEdit[]; // file found from the model span
export function removeStickyNote(input: EditInput, noteName: string): FileEdit[];
export function setSetting(
  input: EditInput,
  target: ElementTarget,
  setting: 'headercolor' | 'color' | 'inactive',
  value: string | null,
): FileEdit[];
export function syncViews(input: EditInput, ops: ViewOp[]): FileEdit[]; // syncDiagramView in the file declaring each view (new views: entry file)
export function uniqueNoteName(model: DiagramModel, base?: string): string; // 'note_1', 'note_2', …
export type ElementTarget =
  | { kind: 'table'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'ref'; id: string };
export interface ViewOp {
  op: 'create' | 'update' | 'delete';
  name: string;
  newName?: string;
  tables?: string[] | '*';
  notes?: string[] | '*';
  groups?: string[];
  schemas?: string[];
}

// edits/applyEdits.ts — Monaco side
/** Applies edits as ONE undo stop per file (pushEditOperations), keeps EOL/BOM rules of §4.4 phase 2. */
export function applyFileEdits(
  monaco: typeof import('monaco-editor/editor/editor.api'),
  edits: FileEdit[],
): void;
```

Rules: edits come from `@dbml/parse` helpers (`createStickyNoteEdit`, `setStickyNoteTextEdit`,
`removeStickyNoteEdit`, `updateElementSettingEdit`, `syncDiagramView`) run against the file that
declares the element. `applyFileEdits` converts offsets to Monaco ranges and pushes one edit
operation per file (Mod+Z undoes it in the code pane; the canvas Mod+Z keeps undoing layout).
Every edit must leave the rest of the file byte-identical — the unit tests compare the text
outside the edited range. Colour values are written `#rrggbb` lowercase. If a helper cannot
target an element (e.g. an inline ref has no settings list for `color`/`inactive`), the UI item
is disabled with a tooltip "Edit this ref in code" — never a hand-rolled rewrite.

Tests (`apps/editor/test/edits.test.ts`): for every example: create a note at the end, set its
text (multi-line, quotes, `'''` inside), remove it → original text byte-identical; set/clear
header colour of each table, group colour, note colour, ref colour/inactive where supported;
view create/rename/update/delete; each result compiles without new diagnostics and differs from
the input only inside the reported ranges.

### 6.2 Compile in a worker (`src/state/compile.ts`, `compile.worker.ts`)

- `CompileScheduler` keeps its API (`schedule`, `flush`, `cancel`, `onResult`) and decides per
  run: **sync** (main thread, today) while the previous compile took ≤ `WORKER_THRESHOLD_MS = 25`
  and the total text ≤ 256 KB; otherwise **worker** (module worker,
  `new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' })`), which posts
  back `CompileResult` (plain JSON by design). Results of superseded runs are dropped (sequence
  numbers). Worker failure → back to sync, logged once.
- The language service (completion etc.) keeps its own `Compiler` on the main thread
  (`setSource` only, lazy).
- Budget assertions (e2e `perf.spec.ts`, §7): keystroke → markers + diagram ≤ 250 ms on
  `14-large`, and on a generated 300-table schema (≈ 80 KB) ≤ 600 ms with no main-thread task
  > 50 ms during typing.

### 6.3 SQL

- **Snowflake export** (`src/sql/snowflake.ts`, own generator from the `DiagramModel`, runs in
  the main thread — no `@dbml/core` needed): `CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE
"schema"."table"` (identifiers quoted only when needed, Snowflake rules), column types mapped
  (`serial`/`increment` → `NUMBER AUTOINCREMENT`/`IDENTITY`, `varchar(n)`, `text` → `VARCHAR`,
  `timestamp`/`timestamptz` → `TIMESTAMP_NTZ`/`TIMESTAMP_TZ`, `json[b]` → `VARIANT`, `uuid` →
  `VARCHAR(36)`, `boolean`, numeric types as is; unknown types passed through), `NOT NULL`,
  `DEFAULT`, `PRIMARY KEY`, `UNIQUE`, `ALTER TABLE … ADD FOREIGN KEY` (Snowflake records but
  does not enforce them: header comment says so), `COMMENT ON TABLE/COLUMN`, enums as a comment
  plus `VARCHAR` columns (Snowflake has no enum type). Indexes other than PK/unique are emitted as
  comments (Snowflake has no secondary indexes). Round-trip test: our Snowflake output re-imported
  with `@dbml/core`'s Snowflake importer (in the unit test, Node) reproduces tables, columns, PKs
  and FKs of every example.
- **Multi-file export**: all formats use the compiled model: `@dbml/core` exporters get a
  single-file DBML **generated** from the model (`src/sql/flatten.ts`: tables, enums, refs,
  groups; no notes/views needed for SQL), so multi-file workspaces export too. Single-file
  workspaces keep passing the entry text unchanged (identical output to phase 2).
- **Open `.sql`**: Open file / drop accepts `.sql`; it opens the SQL import dialog prefilled
  (dialect guessed from the text: `AUTO_INCREMENT`/backticks → MySQL, `IDENTITY`/`[` → SQL
  Server, `NUMBER(`/`VARCHAR2` → Oracle, `VARIANT`/`AUTOINCREMENT` → Snowflake, else
  PostgreSQL; the user can change it).
- `EXPORT_FORMATS` gains `{ id: 'snowflake', label: 'Snowflake' }`.

### 6.4 Sticky notes on the canvas

- Create: diagram pane toolbar button **Note** (and pane context menu "Add note here", and `N`
  with the diagram focused): `uniqueNoteName`, text "New note", inserted with `createStickyNote`
  at the end of the entry file; the new id is positioned with `handle.placeNodes` at the pointer (button: centre of the viewport);
  the note opens in edit mode.
- Edit text: double-click a note (or Enter / F2 with it selected) → an overlay `<textarea>`
  exactly over the note box (`getNodeClientRect`), same font/size, auto-height, Esc cancels,
  Mod+Enter or blur commits through `setStickyNoteText` (one Monaco undo stop); empty text keeps
  an empty note. While editing, canvas shortcuts are off.
- Resize: handles (canvas §4.3 rule 2); committed as a `'resize'` layout change (layout history,
  dirty layout).
- Delete: Delete/Backspace with notes selected, or menu "Delete note": confirm only when the
  note has more than 200 characters; `removeStickyNote` + the layout entries of that note in all
  views removed (one layout history step merged with the text edit's: Mod+Z on the canvas
  restores the layout, Mod+Z in code restores the text — documented in Help).
- Colour: node menu "Colour ▸" (§6.5).
- Rename: node menu "Rename…" → `renameElementEdit` with role `StickyNote` (if the helper
  supports it; else hidden) plus core `renameNode` for the layout.

### 6.5 Colours and inactive refs

- Node menu (tables, groups, notes) and a new edge menu (right-click a ref,
  `onEdgeContextMenu`): **Colour ▸** a 12-swatch palette (dbdiagram's colours plus relvista's),
  "Custom…" (native `<input type=color>`), "Default" (removes the setting). Tables: `headercolor`;
  groups/notes/refs: `color`. Refs: **Mark inactive / Mark active**. Multi-select applies to
  every selected element of the same kind (one undo stop per file).
- Colours are applied live (text edit → compile → diagram), so the change is in the DBML and
  survives everywhere (dbdiagram shows the same colours).

### 6.6 Collapse groups

- Node menu on a group: **Collapse group / Expand group**; double-click a group header; and
  **Collapse all groups / Expand all** in the Auto-layout menu. Layout `'settings'` change
  (history, dirty layout). Collapsed group in the menu: Expand, Reveal in code, Pin.
- Cursor in a collapsed group's member table highlights the collapsed card.

### 6.7 Views manager

- `ViewSelect` becomes a searchable menu (filter field when > 7 views), current view checked,
  then **New view from selection** (selected tables/groups/notes; name prompt, default
  `view_<n>`), **Edit view…** (dialog: name, and checkbox trees Tables (by schema) / Groups / Notes /
  Schemas, "All tables" toggle = `*`), **Delete view…** (confirm). Writes through `syncViews`; the
  layout's `views[name]` entry is renamed (`views[new] = views[old]`) or deleted with the view (one
  layout history step).
- Node menu: **Add to view ▸** (list of views) / **Remove from view** (current named view).
- Unlimited views; the top bar label truncates with a tooltip.

### 6.8 Detail level and focus

- Diagram pane overlay: `DetailSwitch` (renderer, §4.7) — writes `layout.settings.detailLevel`
  through a store action (layout history step, marks the layout dirty only when it differs from
  the saved file; 'all' removes the key). Keyboard: `1` / `2` / `3` with the diagram focused.
- Focus: node menu **Show related ▸ 1 / 2 / 3 hops**; `FocusControl` chip in the pane;
  Esc exits; focus is UI state (session + URL), not layout.

### 6.9 Search and path

- Mod+K (outside Monaco), `/` (diagram focused), or the pane's magnifier opens `SearchPanel` over
  the diagram (top-centre; full width below 768 px). Selecting a hit: `focusNodes`, highlight,
  and — table/column — reveal in code without stealing focus (phase-2 node-click rule).
  Path mode as in §4.7. Esc closes and clears decorations.

### 6.10 Deep links (and share verification)

- On load: share payload as today; then `parseDiagramTarget(location.hash)` (also after `?url=`
  loads and after session restore) is applied once the canvas reports `'done'`: view, table
  (focus + highlight), hops, detail (display only, not written to the layout), viewport, q, path.
  Unknown table → toast "No table “x” in this schema".
- While working, the URL hash mirrors the target (`replaceState`, debounced 300 ms): `view`,
  `table` (last selected/revealed table), `hops`, `vp` — never `dbml=` (the share hash is still
  removed after loading, phase 2 §4.5). A reload with such a hash restores the session and
  re-applies the target.
- Share dialog: new checkbox **Include position** (adds `table`/`vp` of the moment). Tests prove
  phase-1 and phase-2 links still open (existing `share.spec.ts`) and that a link with target keys
  opens at the same view/table/zoom (±0.01).

### 6.11 Compare (schema diff)

- Top bar / File menu **Compare…** (Mod+Alt+D): dialog with sources **File…** (picker or drop),
  **Paste**, **URL** (https; GitHub `blob`/`tree` URLs rewritten as `remote.ts` does), and
  **Git ref** when the document came from a GitHub URL (`?url=` or Open from URL): a ref field
  (branch, tag or commit) that rewrites the ref segment of the same path. Reading a local `.git`
  folder is out of scope (§13). "Compare current with: [other]" and a swap button (other =
  before, current = after by default).
- Compare mode: the canvas shows `mergeForDiff` with `diffDecorations` (`displayModel`,
  `decorations`), a right-side **Changes** panel (grouped list: tables, refs, enums, groups,
  notes, views; filter Added/Removed/Changed; click → focus node), legend chip "+3 −1 ~4", and
  the code pane switches to a read-only **Monaco diff editor** (other ↔ current entry text)
  with a toggle back to editing. Editing the current text live-updates the diff. Layout edits
  stay possible (they apply to the current document). **Exit compare** (Esc) restores.
- Export in compare mode exports the decorated picture (SVG/PNG/PDF) and **Copy summary**
  copies `formatDiff(diff, { markdown: true })`.

### 6.12 PDF in the editor

Export ▾ **PDF…** opens the renderer `PdfDialog`: mode Tiled / One page per view (checkbox
list of views, default all), paper A4 / Letter, orientation, scale (50–200 %, tiled), overlap,
marks, overview; live text "6 pages (2 × 3)" from `planTiles`; Export downloads
`<name>.pdf`. "One page per view" lays out each view with its saved layout (sync layout for
unplaced nodes, ELK not awaited).

### 6.13 Shortcuts added (Help dialog lists them)

| Keys               | Action                                   | Where           |
| ------------------ | ---------------------------------------- | --------------- |
| Mod+K, `/`         | Search                                   | outside Monaco¹ |
| N                  | New sticky note                          | diagram focus   |
| Enter / F2         | Edit selected note text                  | diagram focus   |
| Delete / Backspace | Delete selected notes                    | diagram focus   |
| 1 / 2 / 3          | Detail: names / keys / all               | diagram focus   |
| Mod+Alt+D          | Compare…                                 | everywhere      |
| Esc                | Close search / exit focus / exit compare | diagram focus   |

¹ `/` only with the diagram focused.

---

## 7. Performance budgets (asserted loosely in CI, logged precisely)

| Measure                                               | Budget                        | Where                             |
| ----------------------------------------------------- | ----------------------------- | --------------------------------- |
| Docs gallery page with SSR'd diagrams: ELK requests   | 0                             | `apps/docs/e2e/ssr.spec.ts`       |
| Docs diagram without layout, ≤ `AUTO_DAGRE_MAX_NODES` | no ELK request (non-SSR path) | `apps/docs/e2e/viewer-v1.spec.ts` |
| `routeAll` 14-large                                   | ≤ 25 ms median (assert 150)   | `renderer/test/router.test.ts`    |
| Drag frame in 14-large                                | no task > 50 ms               | `apps/editor/e2e/perf.spec.ts`    |
| Keystroke → diagram, 14-large                         | ≤ 250 ms                      | `apps/editor/e2e/perf.spec.ts`    |
| Keystroke → diagram, 300 tables                       | ≤ 600 ms, no task > 50 ms     | `apps/editor/e2e/perf.spec.ts`    |
| Editor first load (unchanged)                         | ≤ 3 s                         | existing                          |
| PDF, 14-large tiled A4 100 %                          | ≤ 3 s after libraries loaded  | `apps/editor/e2e/pdf.spec.ts`     |

The 300-table fixture is generated in the test (seeded), not committed.

---

## 8. Docs pages (apps/docs/docs)

New pages (sidebar order after "Editor"): **Diagram views** (`views.mdx`: DiagramView syntax,
`view="billing"` fence and component on an inline schema with a `billing` view, per-view layouts),
**Exploring diagrams** (`exploring.mdx`: search, path, detail levels, focus, deep links and
anchors, with live diagrams), **Schema diff** (`diff.mdx`: `<DbmlDiff>` and the ` ```dbml-diff `
fence, editor Compare), **Export and print** (`export.md`: SVG/PNG/PDF modes, static SVG in
docs), and updates to `editor.md` (notes, colours, collapse, views manager, compare, SQL
Snowflake, shortcuts), `usage.mdx` (new props/meta `id`, `ssr`, toolbar items), `layout-file.md`
(group `collapsed`, note `w`/`h`). Every page builds with no broken links (Docusaurus
`onBrokenLinks: 'throw'` stays).

---

## 9. API reference (typedoc)

- `apps/docs/typedoc.json` with three entry points (`packages/core/src/index.ts`,
  `packages/renderer/src/index.ts`, `packages/docusaurus-plugin/src/index.ts` + `defaults.ts`)
  using each package's `tsconfig.json`, plugin `typedoc-plugin-markdown`, output
  `apps/docs/api/` (git-ignored, generated), served by a second `plugin-content-docs` instance
  (id `api`, `routeBasePath: 'docs/api'`, its own sidebar) so its ~300 pages and sidebar links
  stay off the other docs pages' bundles (review round 2), options: `entryFileName: index`,
  `outputFileStrategy: modules` or `members` (whichever keeps pages < 200 KB), `hidePageHeader`,
  `useCodeBlocks: true`, `sanitizeComments: true` (MDX-safe), `excludePrivate`, `excludeInternal`,
  `readme: none`, sidebar via a generated `_category_.json`.
- `apps/docs/scripts/api-docs.mjs` runs typedoc programmatically before `docusaurus build`
  (and `start`); `--check` mode not needed (generated, ignored). Hand-written intro
  `apps/docs/docs/reference.md` ("API reference": what each package is for, stability promise for
  1.x, links into `api/`).
- `typedoc` warnings for undocumented exports are fixed by writing TSDoc on the export (no
  `@internal` hiding of public API). Internals currently exported only for tests are marked
  `@internal` and moved out of the public barrel where the integration agent agrees (§12).
- Every exported symbol has a one-sentence summary; components list their props.

## 10. npm packaging (1.0 readiness, no publishing)

For each of `@relvista/core`, `@relvista/renderer`, `@relvista/docusaurus-plugin`:

- `package.json`: `name`, `version` (left at `0.0.0`; changesets bumps it at release),
  `description`, `keywords`, `license: MIT`, `author`, `repository` (`git+https…`, `directory`),
  `homepage` (docs site page of the package), `bugs`, `engines.node >= 20`, `type: module`,
  `exports` (`types` first, `import`/`default`; `./package.json`; renderer `./styles.css`; core
  `./layout.schema.json`; plugin `./client` types), `types`, `main` (for old resolvers),
  `files` (only what is needed + `README.md` + `LICENSE`), `sideEffects` (`false` for core;
  CSS globs for renderer/plugin), `publishConfig: { access: 'public', provenance: true }`,
  peer dependency ranges reviewed (`react >= 18`, Docusaurus `^3.6`), `dependencies` pinned
  exactly where the code depends on exact behaviour (`@dbml/parse`, `elkjs`, `@xyflow/react`,
  `jspdf`, `svg2pdf.js`, `@dagrejs/dagre`) — `ajv` becomes exact too (`8.17.1`, or the installed
  version) for reproducible validation.
- `README.md` per package (core is new): install, minimal example, links to the reference.
  `LICENSE` copied into each package folder (a build step `scripts/copy-license.mjs` or a
  committed copy; pick one and document it in `CONTRIBUTING.md`).
- `scripts/check-packages.mjs` + root script `pnpm packages:check`: for each package `pnpm pack`
  into a temp dir, then `publint --strict <tarball>` and `attw --pack <dir> --profile esm-only`
  (ESM-only packages by design; the CJS "require" resolution is not offered); fails on any
  error or warning. The plugin's `lib/theme/**` types and the `@theme/*` ambient modules must
  resolve. Added to CI as a step after Build (quality check, not the release workflow).
- No separate type tests: `attw`, `publint` and the docs site build (a real consumer of all
  three packages) cover how the types resolve.
- The tarballs contain no tests, no `src` except the plugin's `src/theme` (needed by
  `getTypeScriptThemePath`), no source maps pointing outside the package (`sourceMap`/
  `declarationMap` either off or with `sources` included — decide, record in CONTRIBUTING).

---

## 11. Tests summary (new files; existing suites stay green)

| Area     | Unit (vitest)                                                                                                                          | E2E (Playwright)                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core     | `geometry-collapse`, `geometry-layout` (notes), `engine-auto`, `analysis-search`, `analysis-graph`, `analysis-subset`, `analysis-diff` | —                                                                                                                                                                                              |
| renderer | `router`, `decorations`, `svg` additions, `canvas-v1`, `pdf`, `deepLink`, `diff-decorations`, `viewer-v1`                              | via docs: `viewer-v1.spec.ts`                                                                                                                                                                  |
| plugin   | `ssr`, `anchors`, `dbmlDiff`, options/meta additions                                                                                   | docs: `ssr.spec.ts`, `anchors.spec.ts`, `diff.spec.ts`; compat unchanged                                                                                                                       |
| editor   | `edits`, `compileWorker`, `snowflake`, `flatten`, `sqlDialect`, `history` (resize), `views` store logic                                | `notes.spec.ts`, `colours.spec.ts`, `collapse.spec.ts`, `views.spec.ts`, `search.spec.ts`, `deeplink.spec.ts`, `compare.spec.ts`, `pdf.spec.ts`, `perf.spec.ts`, `sql.spec.ts`, a11y additions |
| packages | —                                                                                                                                      | `pnpm packages:check`                                                                                                                                                                          |

The phase-2 gate (`roundtrip.spec.ts`) gains one case per canvas edit kind: create note +
delete note → Save → bytes identical to the original.

---

## 12. Waves and integration

The build plan (returned to the orchestrator and summarised here) has four waves. Each wave
ends with an **integration agent** that: adds the barrel exports listed in the packages' notes
(`packages/core/src/index.ts`, `geometry/index.ts`, `packages/renderer/src/index.ts` and its
sub-barrels), applies `package.json` changes, regenerates `THIRD_PARTY_NOTICES.md`
(`pnpm build && pnpm notices`), adds docs sidebar entries if a page is not autogenerated, adds a
changeset per published package touched (`.changeset/phase3-<wave>.md`), runs the full pipeline
and fixes only wiring. Anything beyond wiring goes back into §13.

| Wave | Packages (parallel, disjoint paths)                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | core geometry (collapse, notes, engine auto, 0003) · core analysis (search, graph, subset, diff) · renderer router · renderer drawing (decorations, collapsed group, notes, inactive) |
| 2    | renderer canvas v1 · Docusaurus SSR · editor foundations (edits, compile worker, SQL) · renderer pure modules (PDF, deep-link codec, diff decorations)                                |
| 3    | renderer viewer v1 + nav components (+ plugin toolbar defaults) · editor canvas editing (notes, colours, collapse, views) · npm packaging                                             |
| 4    | editor navigation + compare + PDF + deep links · docs features (anchors, DbmlDiff, pages) · API reference                                                                             |

## 13. Open questions (decide during build, record here)

- Embedding a Unicode font subset in PDFs (instead of the raster fallback for non-WinAnsi text).
- Reading git refs from a local `.git` folder opened with the File System Access API (packfiles
  and deltas) — out of v1; hosted URLs only.
- Per-view detail level (layout-1 has one `settings.detailLevel`); would need `layout-2` or an
  `x-relvista-view-settings` extension key. **Decided after 1.0: the extension key**, in
  `settings` (1.0 rejects unknown keys inside `views[name]` but keeps `settings` `x-*` values
  unread): `settings["x-relvista-view-settings"][view].detailLevel`, no `layout-2`. Core
  `viewDetailLevel` / `withViewDetailLevel` / `renameViewSettings`; the editor's detail switch
  writes the open view (the diagram-wide level removes the view's own); the viewer and plugin
  start each view at its level (`detailLevel` prop, `detail=` and the toolbar still override; the
  toolbar choice is dropped on a view switch only when the two views save different levels). The
  editor PDF export still draws every page at the open view's level.
- Whether `AUTO_DAGRE_MAX_NODES` should also consider ref density (decided by the wave-1 bench).

Recorded by the wave-1 integration (2026-11-21):

- **`AUTO_DAGRE_MAX_NODES = 3`, not 6 — needs the owner's sign-off.** Taken literally, the §3.3
  rule (within 5 % on (a)–(c), not worse on (d), in ≥ 95 % of components) admits no size at all:
  route length (b) fails structurally because dagre has no ports and centres tables instead of
  lining up column rows. The threshold is set from (a)+(c)+(d) (crossings, area, refs under
  tables): dagre matches ELK in 95 % of components up to 3 nodes, 93 % at 4, 84 % at 6. Ref
  density was not needed as an extra criterion. A later dagre pass that lines up column rows would
  close most of the length gap and could raise the threshold. Tables and reasoning: decision 0003.
- `layoutDiagram` keeps `'elk'` as its default engine; `'auto'` is opt-in (the canvas switches to
  it in wave 2, using `needsElk` to skip the ELK worker).
- A saved note `w` is clamped to `METRICS.noteMinWidth`..`noteMaxWidth` (120..640) and `h` to at
  least `noteMinHeight`; the text wraps at the saved width (before: used unclamped, wrap at 220).
  The renderer's grid fallback measures notes the same way.
- `subsetModel` keeps sticky notes only when listed in `noteIds` (none when omitted) and drops
  groups left with no kept table (`selectView` keeps an explicitly listed empty group).
  `selectView` was not refactored onto `subsetModel`.
- `shortestPath` returns `tableIds` / `refIds` in model order (the `Subgraph` contract); callers
  that want path order walk `refIds` from `fromTableId` (one ref per hop, the first connecting
  ref in model order).
- Diff identity follows renames: refs and group members of a renamed table are compared after
  rewriting ids, so a rename is one `TableDiff` with `renamedFrom`. Removed refs keep their
  `before` id. Added / removed enums carry `values: []`. `summary` counts top-level entries.
- The router's `avoid` default stays `'none'` in wave 1; wave 2 (canvas v1) makes `'tables'` the
  default and updates the tests that rely on the three-segment shape.
- The drawing computes display nodes locally (`svg/collapsed.ts`) and the router has its own
  `fromNode`/`toNode`; both use `model.groups[g].tableIds` where `geometry.groups[g].collapsed`.
  Review round 1 (pre-1.0): core's unused `displayNodeOf` and the renderer's
  `displayNodeOf` / `collapsedGroupIdsOf` / `tableCountLabel` were removed from the public API
  (one name per concept: core's `collapsedGroupIds` and `collapsedGroupLabel`); the renderer's
  map-based helper is module-internal (`displayNodeFor`).
- `moveNodes` / `computeGroups` keep collapsed group boxes (their members are not in `nodes`); a
  collapsed group moves by its own id and drops the ELK routes of its member tables' refs.
- The site palette maps `--rv-match` and `--rv-path` to the site accent; the diff tones keep
  relvista's green / red / amber.

Recorded by the wave-2 integration (2026-11-21):

- **Router default flipped**: `RouteContext.avoid` defaults to `'tables'` (DiagramSvg, the canvas,
  SVG/PNG/PDF export). During a drag the canvas re-routes incrementally (`RouteCache`, dragged ids
  dirty) and does a full pass when the drag stops. `router.test.ts` asserts the new default.
- **SSR without a Suspense boundary.** React 19.2+ streams a completed boundary over 500 bytes
  hidden and reveals it with a script, so pages without JS would show only the placeholder. The
  static diagram suspends the shell instead and is written inline (Docusaurus has no Suspense
  boundary of its own).
- **Build-time ELK runs outside the Docusaurus server bundle.** Docusaurus evaluates that bundle in
  its own VM context and babel turns core's `import('elkjs/lib/elk.bundled.js')` into a plain
  require; ELK then receives graphs from another realm and returns them unlaid (every table at
  0,0). The layout runs in `lib/ssr/layout-node.cjs`, loaded with `__non_webpack_require__` from a
  generated module.
- **SSR framing** (review round 3): the static picture used `max(fit, floor)` from the top-left,
  so whenever the viewer opened on its readable-zoom window (`14-large`, the home hero, most
  diagrams under 600 px) the swap jumped by up to ~750 px. It now follows `viewerFirstView` per
  width range (above); `client/static.css`'s plain rule (with `VIEWER_FRAME`) remains only for
  heights given as CSS lengths and browsers without container queries. `e2e/ssr.spec.ts` compares
  every table of every gallery diagram, the home page, docs/diff and docs/views at 1360 and 390 px
  (within 2 px).
- **Bundle size** (review round 3, gzipped JS per page with prefetches, until network idle). Docs
  pages without diagrams: phase 2 221 KB → 301 KB → **282 KB** after the navbar and sidebar links
  to the API reference became plain links (Docusaurus prefetches every internal link in view, and
  the API instance's sidebar metadata is ~18 KB). Accepted: the rest is `main.js` (141 → 166 KB)
  and the route map (2.5 → 9.9 KB) carrying the ~320 generated API routes, and `relvista-theme`
  (8 KB), which arrives with the prefetch of linked diagram pages rather than for the page itself
  (loading it lazily from the MDX `code` wrapper did not remove it and grew the page chunks).
  Fewer API pages (`outputFileStrategy: 'modules'`) would cut the route map but make the reference
  pages very long. Pages with diagrams went from 1013 KB to ~670 KB (no ELK in the browser).
  Editor first load: 1549 → ~1600 KB; the Compare, PDF and view-editor dialogs load on first use.
- With `palette: 'site'` the static header band uses `--ifm-color-primary-darkest` (the
  contrast-computed `--rv-site-header-bg` needs JS), so its shade changes slightly at the swap.
- **jsPDF ships in the docs site as a lazy chunk** once `exportPdf` is in the renderer barrel
  (webpack emits the `import('./impl.js')` chunk; it is only downloaded on a PDF export). The
  notices list jsPDF, svg2pdf.js and their dependencies for the docs bundle; the notices check
  skips the prose words that start two of jsPDF's `@license` banners (`Copyright`, `Use`).
- Canvas v1 has no keyboard path for collapse/expand yet (Enter on a node is "reveal in code" in
  the editor); wave 3 offers it from the node menu or a shortcut calling
  `setNodeSettings(['group:x'], { collapsed })`. Resize has no keyboard path (§4.3 rule 2). A local
  collapse in a read-only canvas rebuilds the nodes and drops earlier local drags.

Recorded by the wave-3 integration (2026-11-21):

- **`target` is the whole state.** When `DbmlViewer` applies a `target`, a missing table, hops,
  detail, search or path is reset; a missing `view` keeps the current view. A target that echoes
  the last one reported through `onTargetChange` (debounced 300 ms, not called for the first view)
  is not re-applied.
- `SearchPanel` has optional props beyond §4.7: `initialPath`, `kinds`, `onQueryChange`,
  `onModeChange`, `autoFocus` (false when a target opens the panel, so page loads never steal
  focus) and `limit`. `PdfDialog`'s `planFor(o, view?)` takes an optional view name (pages per
  view) and an optional `note`.
- The viewer toolbar's `detail` item is a menu of `menuitemradio` items; `DetailSwitch` (a radio
  group with a roving tab stop) is meant for the editor pane.
- "Show related" reaches the canvas-rendered side card through `SideCardActionsContext`
  (`viewer/SideCard.tsx`). Esc closes one layer per press: menu or card, search panel, highlight,
  focus.
- `ssrLayout` exists on `DbmlViewer` (positions used only where `layout` has none, never in the
  editor link), but the plugin still merges SSR positions into `layout`; wave 4 (plugin
  `DbmlDiagram`) passes `ssrLayout`, `anchor`, `target` (`parseAnchoredTarget`),
  `onTargetChange` (`history.replaceState` under §5.2) and `onLinkCopy`. Until then the `link`
  toolbar item stays hidden. The `VIEWER_FRAME` constants are still duplicated (wave-2 note).
- Toolbar z-index is 9 in wide viewers so the export and detail menus open over the search panel;
  on phones the panel (z-index 10) covers the toolbar. At 390 px the toolbar fits one row with
  `link` visible (about 329 of 338 px) and wraps rather than overflows if items are added.
- Editor: `zoneOf()` returns `'input'` for form fields and contenteditable even inside
  `.rv-canvas`; diagram single-key shortcuts (N, Enter/F2, Delete/Backspace) require
  `zone === 'diagram'`. `ViewSelect` shows whenever a model exists (needed for "New view…").
  Wave 4 keeps the new Help rows in `shortcutRows()` when adding its own.
- Sticky-note rename is hidden: `@dbml/parse` 12.1.0 `renameElementEdit` returns no edits for
  sticky notes.
- Ref lines are not focusable (`edgesFocusable={false}`); the keyboard path to a ref's colour and
  inactive flag is the table node menu "Refs ▸", which opens the edge menu.
- `edits`: a rename-only `syncViews` update rewrites the whole `DiagramView` block from its parsed
  entities (same view, rest of the file byte-identical); a name-token-only edit would be nicer.
  `combineEdits` with several removals leaves blank lines at end of file (`trimEofRemoval` fixes
  only the last); `store.deleteNotes` chains edits from the last block to the first instead. A
  fix inside `combineEdits` would cover other multi-removal callers.
- a11y: axe runs on the note editor, colour palette and view dialog in the light theme only.
- Packaging: decisions in `CONTRIBUTING.md` "Packaging" (committed LICENSE copies, no source
  maps, clean builds, ESM only, `ajv` pinned at 8.20.0). `packages:check` checks the `pnpm pack`
  tarball (attw on it, not `attw --pack`, which would keep `workspace:` ranges). The docs app has
  its own `@axe-core/playwright` (4.14.0) for `viewer-v1.spec.ts`; the lockfile entry was added
  without re-resolving, because a plain `pnpm install` swaps Docusaurus' `postcss` peer variants
  between `apps/docs` and `apps/docs-compat` and breaks the compat build (a second
  `@docusaurus/theme-mermaid` instance).
- Visual fixes from the integration screenshots: toolbar menus (detail, export) are shifted to stay
  8 px inside the viewer when the button sits mid-toolbar on a phone (they hang from the button's
  right edge); the view dialog lists a single schema's tables one per row (they flowed inline).

Recorded by the 1.0 release preparation (2026-11-21):

- **Versioning.** The three packages are a Changesets `fixed` group; private apps are not versioned
  (`privatePackages: { version: false, tag: false }`). The pre-1.0 wave changesets were replaced
  by one user-facing `major` changeset per package (`.changeset/release-1-0-*.md`), so the first
  `CHANGELOG.md` describes 1.0, not its construction; their text is archived verbatim in
  [pre-1.0-changesets.md](pre-1.0-changesets.md).
- **Release workflow** (`.github/workflows/release.yml`, [docs/releasing.md](../releasing.md)):
  changesets/action v2 sub-actions select-mode → version | publish (not `pack`: `changeset pack`
  needs `pnpm pack --out`, which pnpm 9.15 lacks). The publish job pins npm 11 (trusted
  publishing needs ≥ 11.5.1; npm 12 rejects the `--no-git-checks` that pnpm 9 forwards) and is
  skipped with a warning until `@relvista/core` exists on npm or an `NPM_TOKEN` secret is set.
- **First publish** is manual (`pnpm release:first`): `publishConfig.provenance: true` makes a
  local `npm publish` fail outside CI and only a CLI flag overrides `publishConfig`, so the script
  publishes packed tarballs with `--no-provenance` instead of `changeset publish`. 1.0.0 has no
  provenance statement unless the owner takes the token route.
- **React 18 for real.** Peer ranges are `^18.0.0 || ^19.0.0` (were `>=18`); `DiagramCanvas` uses
  `forwardRef` (its `ref` prop was dropped by React 18, so the handle was `null`).
  `packages:check` refuses open-ended peer ranges. Consumer smoke tests from the packed 1.0.0
  tarballs passed: Docusaurus 3.10 (React 19 and 18, Rspack via `@docusaurus/faster`),
  Docusaurus 3.6.3 (React 18; needs `webpack` ≤ 5.96 because of 3.6's own webpackbar), Vite 8 +
  React 19 and 18 + TypeScript 7 (`DbmlViewer`, `DiagramCanvas` handle, core APIs).
- **Types.** Stylesheet exports have `.d.ts` stubs (attw checks every entry point now). Core
  builds with `stripInternal`; `resolveView`/`viewTableEntries` are `@internal`, so the published
  `.d.ts` no longer import `@dbml/parse` types, whose declarations need `monaco-editor-core` and
  failed consumers with `skipLibCheck: false`.
