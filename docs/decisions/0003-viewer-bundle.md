# 0003 — Viewer bundle and ELK worker

- Status: accepted (2026-11-21, phase 3 wave 1; proposed 2026-11-20)
- Date: 2026-11-20
- Source: phase 1 review round 1 (decision 0001 asked to revisit the viewer engine after measuring
  the bundle in phase 1)

## Measurements

Production build of `apps/docs`, served locally; JavaScript a page with one diagram
(`/docs/gallery/02-ecommerce`) downloads on top of a page without one (`/docs/layout-file`),
captured with Playwright. Gzip sizes are `gzip -9` of the emitted files.

| Chunk                                                  | Before (raw / gz)   | After (raw / gz)                 |
| ------------------------------------------------------ | ------------------- | -------------------------------- |
| elkjs                                                  | 1,525,997 / 442,436 | — (no longer loaded)             |
| ELK Web Worker script (`elk-worker.min.*.js`)          | —                   | 1,548,701 / 450,019, in a worker |
| `@dbml/parse` + `@xyflow/react` + dagre + ajv + lodash | 907,324 / 257,711   | 907,324 / 258,324                |
| `relvista-viewer` (renderer + theme glue)              | 66,075 / 22,703     | 72,195 / 25,059                  |
| small shared chunk                                     | —                   | 4,228 / 1,662                    |
| **Total extra JS**                                     | ~2.5 MB / ~723 KB   | 2,532,448 / 735,064              |

- `react-dom/server` (202,559 / 60,736) loads only on the first export, as before.
- The renderer's `styles.css` (with React Flow's CSS) adds 30,205 / 5,995 to the global stylesheet.
- Main-thread long tasks while laying out `14-large` (74 tables): before 87 ms and 56 ms (ELK
  in-process); after one 58 ms task (parse and first render), ELK runs in the worker. None on
  `02-ecommerce`.

## Decision (accepted, phase 3)

- Docs sites render diagrams at build time in Node, ELK included (phase3-v1 §5.1); the browser
  receives the positions and never downloads ELK for a server-rendered diagram.
- Elsewhere `engine: 'auto'`: dagre for connected components of up to `AUTO_DAGRE_MAX_NODES`
  free nodes without groups (**3** when accepted, **4** since the
  [2026-11-22 re-measurement](#re-measurement-2026-11-22-dagre-row-post-pass)), ELK (in the
  worker) above. `needsElk(model, options)` tells whether
  any component would run ELK, so the canvas skips the ELK pass, and the worker download,
  entirely when it is false. Components without refs never run ELK (grid placement) whatever
  their size.
- Editor: ELK only when the canvas has unplaced nodes for which `needsElk` is true, or for an
  explicit Auto-layout.
- Compile in a worker when over budget: phase3-v1 §6.2.
- Kept from phase 1: React Flow for the viewer; ELK in a Web Worker on docs sites (the plugin emits
  `elkjs/lib/elk-worker.min.js` as an asset and passes its URL as `workerUrl`, the in-process
  `elk.bundled.js` chunk loads only as a fallback); the first picture never waits for ELK (dagre
  first, ELK swapped in).
- `layoutDiagram` keeps `'elk'` as its default engine when `options.engine` is undefined; `'auto'` is
  opt-in. The canvas switches to `'auto'` in phase 3 wave 2.

### Measurement for `AUTO_DAGRE_MAX_NODES`

Script: `packages/core/test/engine-auto.bench.ts`
(`pnpm --filter @relvista/core exec vitest bench --run test/engine-auto.bench.ts`). Inputs: every
connected component with at least two tables of every example, plus 200 seeded random schemas
(2-20 tables, 1-4 plain columns and 0-2 refs per table): 288 components, 281 of them without
groups. Each component is laid out alone with dagre and with ELK; both placements are measured with
every ref drawn as a straight segment between its port points (the left/right border facing the
other table, at the column row; the stand-in for the renderer's router until §4.1 lands):
(a) crossings between segments that share no table, (b) total segment length, (c) bounding-box area
(tables and group boxes), (d) segment / unrelated-table intersections. A case passes when dagre is
within 5 % of ELK on (a)-(c) and not worse on (d). Node 24, Apple M4, 2026-11-21.

Per component size (dagre / ELK, medians):

| Nodes | Cases | Pass (a)-(d) | Crossings | Length | Area | Cases with more refs under tables |
| ----- | ----- | ------------ | --------- | ------ | ---- | --------------------------------- |
| 2     | 60    | 17 %         | 1.00      | 1.22   | 0.73 | 0                                 |
| 3     | 49    | 24 %         | 1.00      | 1.15   | 0.75 | 4                                 |
| 4     | 16    | 13 %         | 1.00      | 1.11   | 0.86 | 3                                 |
| 5     | 18    | 17 %         | 1.00      | 1.15   | 0.85 | 6                                 |
| 6     | 14    | 29 %         | 1.00      | 1.08   | 0.94 | 4                                 |
| 7     | 13    | 15 %         | 1.00      | 1.14   | 1.00 | 2                                 |
| 8     | 13    | 0 %          | 1.33      | 1.24   | 1.09 | 5                                 |
| 10    | 16    | 25 %         | 1.00      | 1.07   | 0.94 | 2                                 |
| 12    | 10    | 0 %          | 1.88      | 1.20   | 1.05 | 3                                 |
| 14    | 10    | 0 %          | 1.83      | 1.10   | 1.21 | 5                                 |

Cumulative, components of up to n nodes, share of cases where dagre is within 5 % (not worse for
(d)):

| n   | (a) crossings | (b) length | (c) area | (d) under tables | (a)+(c)+(d) |
| --- | ------------- | ---------- | -------- | ---------------- | ----------- |
| 2   | 100 %         | 17 %       | 100 %    | 100 %            | **100 %**   |
| 3   | 100 %         | 24 %       | 99 %     | 96 %             | **95 %**    |
| 4   | 98 %          | 24 %       | 98 %     | 94 %             | 93 %        |
| 5   | 97 %          | 26 %       | 96 %     | 91 %             | 87 %        |
| 6   | 96 %          | 27 %       | 95 %     | 89 %             | 84 %        |
| 8   | 92 %          | 26 %       | 89 %     | 87 %             | 76 %        |
| 10  | 88 %          | 28 %       | 86 %     | 85 %             | 71 %        |

Layout time per component is ~20× lower with dagre (a random 7-table schema: 0.2 ms vs 3.8 ms;
`02-ecommerce`: 2.3 ms vs 9.3 ms), on top of the 450 KB gz worker download ELK needs.

**Threshold.** Taken literally, the phase3-v1 §3.3 rule (within 5 % on (a)-(c) and not worse on
(d) in ≥ 95 % of cases) admits no size at all: route length (b) fails for most components of
every size, two tables included. That is structural, not a tuning problem: dagre has no ports, so
it centres tables on each other instead of aligning the referenced column rows, and the straight
segment picks up the vertical offset (median +22 % for two tables, +8-15 % above). The orthogonal
router of §4.1 attaches at the same rows and pays the same offset, so the gap will stay. On the
three criteria a reader sees as clutter (crossings, area, refs under tables) dagre matches ELK in
≥ 95 % of components up to **3** nodes (93 % at 4, 84 % at 6), and it is smaller in area there.
`AUTO_DAGRE_MAX_NODES = 3` (rule applied to (a)+(c)+(d)); the start value 6 would accept dagre
being worse in 16 % of components. Of the examples, `01-minimal`, `04-indexes-and-checks`,
`07-sticky-notes` and `10-records` lay out without ELK under `'auto'`.

Open (phase3-v1 §13): a port-aligning post-pass for dagre (shift a child table so its FK row
lines up with the parent's key row when that does not overlap) would remove most of the length
gap and could raise the threshold (the failing small components are almost all length-only:
100 % vs 17 % pass at two nodes with and without (b)). Ref density as a second criterion was not
measured.

**Owner sign-off (2026-11-22).** The owner approved the rule, not a fixed number:
`AUTO_DAGRE_MAX_NODES` is the largest component size at which dagre is within 5 % of ELK on
(a), (c) and (d) in at least 95 % of components, measured with
`packages/core/test/engine-auto.bench.ts`. That is 3 with today's dagre. When dagre changes (for
example the post-pass above), re-run the bench, append the new table here with its date, and set
the constant from it; no new decision is needed as long as the rule is unchanged.

### Re-measurement 2026-11-22 (dagre row post-pass)

dagre now has the post-pass the "Open" paragraph above asks for (`layout-rows.ts`,
[autolayout.md](../design/autolayout.md#dagre-engine-layout-dagrets)): left to right, tables move
up or down inside their rank so the rows a ref joins face each other, never closer than the dagre
spacing; refs both ways between two tables are one dagre edge. Same script, same inputs (288
components, 281 without groups), same quantities (a)-(d) and pass criteria; run with
`pnpm --filter @relvista/core exec vitest bench --run --reporter=verbose test/engine-auto.bench.ts`
(the verbose reporter prints the tables). Node 24.20, Windows 10, 2026-11-22. The script on `main`
(no post-pass) reproduces the 2026-11-21 tables above exactly on this machine; the measures do not
depend on the machine.

Per component size (dagre / ELK, medians):

| Nodes | Cases | Pass (a)-(d) | Crossings | Length | Area | Cases with more refs under tables |
| ----- | ----- | ------------ | --------- | ------ | ---- | --------------------------------- |
| 2     | 60    | 100 %        | 1.00      | 1.00   | 1.00 | 0                                 |
| 3     | 49    | 92 %         | 1.00      | 1.00   | 1.00 | 0                                 |
| 4     | 16    | 44 %         | 1.00      | 1.03   | 1.01 | 0                                 |
| 5     | 18    | 50 %         | 1.00      | 1.04   | 0.98 | 0                                 |
| 6     | 14    | 43 %         | 1.00      | 1.01   | 1.00 | 0                                 |
| 7     | 13    | 54 %         | 1.00      | 1.01   | 1.00 | 0                                 |
| 8     | 13    | 15 %         | 1.00      | 1.16   | 1.04 | 0                                 |
| 10    | 16    | 25 %         | 1.00      | 1.04   | 0.97 | 1                                 |
| 12    | 10    | 10 %         | 1.25      | 1.06   | 1.09 | 0                                 |
| 14    | 10    | 10 %         | 1.08      | 1.01   | 1.23 | 1                                 |

Cumulative, components of up to n nodes, share of cases where dagre is within 5 % (not worse for
(d)):

| n   | (a) crossings | (b) length | (c) area | (d) under tables | (a)+(c)+(d) |
| --- | ------------- | ---------- | -------- | ---------------- | ----------- |
| 2   | 100 %         | 100 %      | 100 %    | 100 %            | **100 %**   |
| 3   | 100 %         | 97 %       | 99 %     | 100 %            | **99 %**    |
| 4   | 98 %          | 93 %       | 96 %     | 100 %            | **95 %**    |
| 5   | 98 %          | 89 %       | 94 %     | 100 %            | 92 %        |
| 6   | 97 %          | 87 %       | 92 %     | 100 %            | 90 %        |
| 8   | 96 %          | 83 %       | 87 %     | 100 %            | 84 %        |
| 10  | 94 %          | 77 %       | 81 %     | 100 %            | 78 %        |

**Result: `AUTO_DAGRE_MAX_NODES = 4`** (the signed-off rule, unchanged: (a)+(c)+(d) in ≥ 95 % of
components): 119 of 125 components of up to 4 nodes pass (95.2 %), 132 of 143 up to 5 (92.3 %).
The margin at 4 is one component. Length (b) is no longer structural: dagre's median is within
1-4 % of ELK up to 7 nodes, and the literal §3.3 rule with (b) now admits 3 (96 % at 3, 90 % at 4;
none before). Refs under tables (d) dropped to never worse than ELK up to 10 nodes. Area (c) is
now the criterion that limits the threshold: lining up rows makes some pictures taller (median
1.00 vs 0.73 of ELK at two nodes before, where dagre was smaller by not lining anything up).
Of the examples, `01-minimal`, `03-enums-and-notes`, `04-indexes-and-checks`, `06-header-colors`,
`07-sticky-notes`, `09-table-partials` and `10-records` lay out without ELK under `'auto'`.

The post-pass costs little next to dagre itself: about 9 ms on the editor's generated 300-table
schema, where dagre takes about 95 ms (vitest, this machine, under load). Layout time per
component in the script: random 7-table schema 0.33 ms dagre vs 4.2 ms ELK, `02-ecommerce`
6.0 ms vs 12.3 ms (the machine was shared, so only the ratio is meaningful).

## Not done (yet)

- Splitting `@dbml/parse` further is not possible without forking it.
