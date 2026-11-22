# Auto-layout

- Phase: 1 (core); collapsed groups, note sizes and `engine: 'auto'` added in phase 3
  ([phase3-v1.md](phase3-v1.md) §3.1-§3.3)
- Code: `packages/core/src/geometry/layout*.ts`, `packages/core/src/geometry/elk.ts`,
  `packages/core/src/geometry/collapse.ts`
- Tests: `packages/core/test/geometry-layout.test.ts`, `geometry-collapse.test.ts`,
  `geometry-auto.test.ts`, `geometry-rows.test.ts`; measurement `engine-auto.bench.ts`
- Contract: [phase1-contracts.md](phase1-contracts.md) (`layout.ts`)

```ts
layoutDiagram(model, options?: AutoLayoutOptions): Promise<DiagramGeometry>  // ELK (default), auto, dagre, grid
layoutDiagramSync(model, options?: LayoutOptions): DiagramGeometry           // dagre (default) or grid
needsElk(model, options?: LayoutOptions): boolean   // would engine 'auto' run ELK at all?
AUTO_DAGRE_MAX_NODES = 3                            // 'auto': dagre up to this component size
collapsedGroupIds(model, saved): Set<string>        // groups the saved layout marks collapsed
measureCollapsedGroup(group, tableCount, measure?)  // size of a collapsed group card
displayNodeOf(tableId, model, collapsed): string    // table id, or group:<name> when collapsed
collapsedGroupLabel(tableCount): string             // "1 table" / "N tables"
```

`model` is already view-filtered (`selectView`). The output contains every table and sticky note of
the model (except members of collapsed groups), one box per TableGroup that has visible tables, ELK
ref routes, and `bounds` around all of that with no margin (the renderer adds padding).

## Options

| Option        | Default  | Meaning                                                                                                                                                                                                                                                                        |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `engine`      | `elk`    | `elk` (async, best), `auto` (dagre for small components, ELK for the rest, see below), `dagre` (sync), `grid` (sync, ignores refs). `layoutDiagramSync` treats `elk` and `auto` as `dagre`.                                                                                    |
| `direction`   | `RIGHT`  | Flow of refs from the referenced table to the referencing one. `DOWN` is also supported.                                                                                                                                                                                       |
| `detailLevel` | `all`    | Passed to `measureTable`: `all`, `keys` (pk/fk/unique rows), `names` (header only).                                                                                                                                                                                            |
| `measure`     | estimate | `TextMeasure` for widths; default `estimateTextWidth` (deterministic, Node/SSR safe).                                                                                                                                                                                          |
| `saved`       | none     | A `ViewLayout`. A node entry with finite `x`/`y` keeps that position (pinned or not). `w`/`h` override the measured size (notes: see below), `collapsed: true` measures a table at `names` and collapses a `group:<name>` entry. Entries for ids not in the model are ignored. |
| `aspectRatio` | 1.6      | Width / height of the viewport. Blocks (components, lone tables, notes) are packed to that shape (clamped to 0.25..4).                                                                                                                                                         |
| `workerUrl`   | none     | `layoutDiagram` only. URL of `elkjs/lib/elk-worker.min.js` served by the app; when set and `Worker` exists, ELK runs in a Web Worker.                                                                                                                                          |

## Pipeline

0. **Collapsed groups.** `collapsedGroupIds(model, saved)` lists the groups whose `group:<name>`
   entry has `collapsed: true` and that have a visible table.

1. **Graph** (`layout-graph.ts`). Tables then notes, in model order (the order drives every
   tie-break). Sizes come from `measureTable` / `measureNote` with `METRICS`, so they match what the
   renderer draws. Each ref becomes an edge from the referenced ("one") side to the FK side
   (`Ref.fkSide`; many-to-many keeps `from → to`), attached to the row of its first column among the
   visible columns, or to the header when that column is hidden at the current detail level. Refs
   whose tables are not both in the model are skipped; duplicate ref ids are dropped. A collapsed
   group is **one node** `group:<name>` in the place of its first member table (model order); its
   members are not nodes. Refs with an end in it attach to its header; refs with both ends in the
   same collapsed group are dropped; several refs between the same pair of nodes stay separate
   edges.
2. **Fixed vs free.** Nodes with a saved `x`/`y` are fixed. The engine only sees the free nodes and
   the refs between them.
3. **Components.** Free nodes are split into connected components; refs and shared TableGroup
   membership both connect. Each component is laid out on its own (one engine run each) and becomes a
   block whose bounding box includes its group boxes and routes.
4. **Packing** (`layout-pack.ts`). Blocks are ordered: components with several nodes (largest first),
   then lone tables, then sticky notes, model order on ties. They are shelf-packed into rows whose
   width is `max(widest block, sqrt(Σ (w+80)(h+80) × 1.6))`, 80 units apart. Disconnected schemas form
   a roughly 16:10 grid instead of one long line.
5. **Placing next to fixed nodes.** With fixed nodes present, the packed result is moved either to the
   right of or below the bounding box of the fixed nodes and their (partial) group boxes, 80 units
   away, whichever keeps the whole picture closer to a 1.6 aspect ratio (right wins ties). Free nodes
   therefore never overlap fixed ones. A group with both fixed and free members gets one box around
   all of them, which may then span the two areas; this is accepted to keep the rule simple.
6. **Geometry.** Group boxes are recomputed around the final member positions: `METRICS.groupPadding`
   on every side plus `METRICS.groupHeaderHeight` on top. A collapsed group's node becomes
   `geometry.groups['group:<name>'] = { id, x, y, width, height, collapsed: true }` and nothing
   is in `geometry.nodes` under that id; `geometry.groups` is in model order. Routes touching a fixed node are dropped
   (the renderer routes those itself). `bounds` is the union of nodes, groups and route points. With
   nothing saved, `bounds` starts at `0,0`.

Everything is deterministic: no randomness besides ELK's fixed seed, all orders derived from model
order, no `Map`/`Set` iteration over unordered input. The tests compare JSON of repeated runs.

## Collapsed groups (`collapse.ts`)

The layout entry is `views[view].nodes['group:<name>'] = { x, y, collapsed: true }` (named views:
an override with `collapsed` and optionally `x`/`y`); `collapsed: false` or no field is expanded.
Member tables keep their own entries untouched, so expanding restores them, and the expanded
geometry is exactly the one of a layout without the group entry.

The collapsed node is a card like a table (`measureCollapsedGroup`): header with the group name
(plus `headerNoteIconWidth` when the group has a note), one row `collapsedGroupLabel(n)`
("1 table", "N tables") with the stacked-cards icon in the key-marker slot; width clamped to
`minTableWidth..maxTableWidth`, height `headerHeight + rowHeight + tableBottomPadding`. The
entry's `w`/`h` override that size; finite `x`/`y` fix it like a saved table. In ELK it is an
ordinary top-level node with header ports `n<i>hE|W` (routes end on its left/right border at
`headerHeight / 2`); in dagre and grid it is a lone node; packing treats it like a lone table.

## Sticky note size

`measureNote(note, measure?, size?: { w?, h? })`: `w` sets the box width, clamped to
`METRICS.noteMinWidth = 120 .. METRICS.noteMaxWidth = 640`, and the wrap width
(`w - 2 × notePadding`); `h` is the box height as is (at least `noteMinHeight`), otherwise the
height the wrapped text needs. Without `size` a note is `METRICS.noteWidth` (220) wide. The
pipeline passes the saved entry's `w`/`h` for notes (invalid values are ignored); tables keep the
plain `w`/`h` override.

## Engine `auto`

Per connected component of free nodes: dagre (`dagreComponent`, no routes) when it has at most
`AUTO_DAGRE_MAX_NODES` (3) nodes and no TableGroup with members in it, else ELK. Components
without refs never run ELK in either case (grid placement), so `needsElk(model, options)` is true
only when some free component has refs and is above the threshold or holds a group. elkjs is not
imported when no component needs it. `layoutDiagram`'s default stays `elk`; the canvas opts into
`auto` (phase 3 wave 2). The threshold comes from `test/engine-auto.bench.ts`; the table and the
reasoning (dagre's longer port-to-port segments) are in decision 0003.

## ELK engine (`elk.ts`)

One ELK graph per component, with short internal ids (`n<i>`, `g<i>`, `e<i>`, ports
`n<i>r<row>E|W`, `n<i>hE|W`) so model ids never need escaping.

- `elk.algorithm: layered`, `elk.direction` from options, `elk.edgeRouting: ORTHOGONAL`.
- **Ports.** Every table has `portConstraints: FIXED_POS`. A ref creates a zero-size port on the
  EAST side of the source table and on the WEST side of the target table, at
  `y = headerHeight + row × rowHeight + rowHeight / 2` (header: `headerHeight / 2`). Self-refs use
  two EAST ports, so the loop sits beside the table. Routes therefore start and end exactly on a
  table's left/right border at the column row, which the tests assert.
- **Groups** are compound nodes with `elk.padding = [top=24+28, left=24, bottom=24, right=24]` and
  `elk.hierarchyHandling: INCLUDE_CHILDREN`, so refs across groups are laid out and routed together.
  ELK reports an edge's points relative to its `container`; they are converted to absolute
  coordinates.
- **Spacing.** 48 between nodes in a layer, 110 between layers (room for orthogonal bends), 24
  edge–node, 14 edge–edge.
- **Node placement.** `NETWORK_SIMPLEX` with `considerModelOrder: NONE`. On `14-large` this gave
  ~25% less area and ~11% shorter routes than Brandes–Köpf with model order
  (1330 vs 1780 × 10⁴ units², 149k vs 168k units of route), with similar results on the small examples.
- **Thoroughness** 30 (default 7): on `14-large` the picture shrinks from 4604×4227 to 4618×3784
  (aspect 1.09 → 1.22, ~10% less area) for ~50 ms more; every other example is identical. Other
  knobs tried there (layering `LONGEST_PATH` / `MIN_WIDTH` / `STRETCH_WIDTH`, layer wrapping,
  `DOWN`, post-compaction, depth-first cycle breaking) were all larger or longer;
  `SEPARATE_CHILDREN` packs tighter but drops the routes of refs across groups.
- Components without refs (a group of unrelated tables) skip ELK and use the grid placement; single
  nodes skip it too.

### Loading elkjs in Node and bundlers

elkjs is imported lazily (`import('elkjs/lib/elk.bundled.js')`) on the first ELK layout, so pages
that never lay out do not download it (~1.6 MB raw). `elk.bundled.js` is a self-contained UMD/CJS
file: it runs ELK in-process with a fake worker and needs no `Worker`, `require` or file URL, so it
works in Node (tests, SSR), Vite, webpack 5 (Docusaurus) and Rspack. The CJS/ESM default-export
interop is resolved at runtime (`default`, `default.default` or the module itself).

With `workerUrl` and a global `Worker`, `elkjs/lib/elk-api.js` is loaded instead and ELK runs in a
real Web Worker created from that URL. relvista does not create the worker URL itself (that would tie
core to one bundler's asset syntax); the app passes it, e.g. in Vite:

```ts
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
await layoutDiagram(model, { workerUrl: elkWorkerUrl });
```

If `Worker` is missing, the worker cannot be created or a worker layout fails, the layout runs
in-process instead (the failed worker is terminated). ELK instances are cached (one in-process, one
per worker URL); `disposeElkWorkers()` terminates the cached workers.

The Docusaurus plugin does this with a webpack rule: `elkjs/lib/elk-worker.min.js?relvista-worker`
is emitted as an asset and its URL passed as `workerUrl`.

Spacing options are set on every group (compound) node as well as on the root: ELK reads them from
the node whose children it places, and without them tables inside a group were placed 15-40px
apart. Inside groups the edge-to-table spacing is 12 (less than `groupPadding`), so refs leaving a
group do not run along its drawn border. Self refs use west ports (the renderer loops them on the
left by `METRICS.selfLoopReach`), away from the east ports other refs leave from.

Routes come back parent → child; `finalize` reverses those of refs whose FK is on the `from` side,
so `EdgeGeometry.points` always run `ref.from → ref.to`.

## dagre engine (`layout-dagre.ts`)

`@dagrejs/dagre` (synchronous), `rankdir LR` / `TB`, `nodesep 48`, `ranksep 110`, `edgesep 20`,
network-simplex ranker. dagre has no ports and no padding control for compound nodes, so groups are
laid out in two levels: each group's members are laid out alone (their own components, packed 48
apart), the group becomes one node of the outer layout sized to that block plus group padding and
header, and the inner placement is moved into it. Group boxes can therefore never overlap other
tables. dagre gets at most one edge per pair of tables and no self-refs. dagre produces no routes
(its points do not attach to column rows); `geometry.edges` is empty and the renderer routes refs
itself.

**Row post-pass** (`layout-rows.ts`, `RIGHT` only). dagre centres tables on each other, so a ref
would leave the parent's key row and reach the child's FK row with a vertical jog. After dagre,
`alignRows` moves tables up or down inside their rank (x and rank membership never change) so the
rows a ref joins face each other where the rank allows it:

- Objective: the sum of vertical offsets along every ref (port row, dagre's bend points in the
  ranks it crosses, port row), lowered by coordinate descent: each rank in turn is solved exactly
  as an ordered weighted-median (isotonic) problem with the other ranks fixed, sweeping left to
  right and back (at most 6 sweeps); the first 2 sweeps may reorder a rank by where its refs pull.
  Groups of tables joined by already-straight refs then move as one (a rank alone stalls on a
  chain whose middle tables are pulled both ways), followed by more sweeps (at most 4 rounds).
- Spacing: tables of one rank stay at least `nodesep` (48) apart, bend points `edgesep` (20),
  a bend point and a table 34, as dagre spaces them; tables of different ranks cannot overlap.
- Clearance: a ref that crosses ranks must clear, by 12 units, the nearest table on each side of
  its bend point in those ranks, on the bend point's side. These become bounds on the table and
  on a line end that carries at least half of the line there; contradictory bounds are dropped.
- Refs both ways between two tables are one dagre edge (the first ref's direction) for runs with
  the post-pass; the bench measured larger pictures with two antiparallel edges. Several refs
  between one pair each count; self refs are ignored; a composite ref counts at its first column.
- Not applied: top to bottom (`DOWN`, the output is dagre's, as in 1.0), and the outer level of a
  grouped component (its nodes are group boxes). Inside a group the members are aligned. A
  collapsed group is an ordinary node whose refs attach at its header. Sticky notes are never part
  of a component with refs.
- Limits: a local optimum. A table pulled equally both ways (a parent between two children that
  cannot both face it, refs both ways) stays where it is inside the tie, so neither ref need be
  straight; moving it to one end instead grew the pictures in the bench. Lining up rows can make a
  component taller (up to 2.3× in dense random test schemas). Deterministic like the rest.

## Grid engine

Refs are ignored. Each group becomes a grid of its members (shelf-packed, 48 apart), lone tables and
notes are blocks of their own, and everything is packed as above. Used as a trivial fallback.

## Measured performance

Node 24.16, Apple M4, in vitest, median of 7 runs after warm-up (estimate measure, `detailLevel: all`):

| Example               | Tables | ELK     | dagre  | grid   |
| --------------------- | ------ | ------- | ------ | ------ |
| `02-ecommerce`        | 12     | 13.6 ms | 2.0 ms | 0.1 ms |
| `05-table-groups`     | 7      | 9.4 ms  | 0.6 ms | 0.0 ms |
| `14-large` (6 groups) | 61     | 61 ms   | 11 ms  | 0.4 ms |

The first `layoutDiagram` call also loads and initialises elkjs: ~130 ms including a tiny layout.
The dagre row post-pass (measured later, Node 24.20, Windows 10) adds about 10 % to dagre: ~9 ms on
the editor's generated 300-table schema, where dagre itself takes ~95 ms.
The test suite asserts `14-large` with ELK stays under 3 s.

## Known limits

- Hub tables (e.g. `users` in `14-large`) referenced from many groups produce long routes across the
  diagram; this is inherent to a layered layout with groups kept compact.
- Multi-column refs attach at the row of their first column.
- Sticky notes are placed after the tables, never next to the tables they talk about (DBML does not
  link them).
- Saved edge waypoints (`saved.edges`) are not used by auto-layout; they belong to the renderer.
