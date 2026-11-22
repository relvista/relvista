/**
 * Auto-layout: `layoutDiagram` (ELK, async) and `layoutDiagramSync` (dagre or grid).
 * Algorithm and options: docs/design/autolayout.md. Contract: docs/design/phase1-contracts.md.
 */
import type { NodeLayout } from '../layout/types.js';
import type { DiagramModel } from '../model/types.js';
import { METRICS, estimateTextWidth } from './metrics.js';
import type { Box, DiagramGeometry, GroupGeometry, LayoutOptions, NodeGeometry } from './types.js';
import {
  components,
  groupBox,
  placementBounds,
  prepareGraph,
  subgraph,
  translatePlacement,
  unionBoxes,
  type LayoutGraph,
  type Placement,
} from './layout-graph.js';
import { BLOCK_GAP, TARGET_ASPECT, packBlocks, orderBlocks, toBlock } from './layout-pack.js';
import {
  dagreComponent,
  dagrePlacement,
  gridEnginePlacement,
  type Direction,
} from './layout-dagre.js';
import { elkComponent } from './elk.js';
import { collapsedGroupIds } from './collapse.js';

/**
 * `engine: 'auto'` lays out a connected component of free nodes with dagre when it has at most
 * this many nodes and no TableGroup with members in it, else with ELK. Chosen from the
 * measurement in `test/engine-auto.bench.ts` (decision 0003, re-measured 2026-11-22 with the
 * dagre row post-pass): up to 4 nodes dagre matches ELK on crossings, area and refs under tables
 * in >= 95 % of components.
 */
export const AUTO_DAGRE_MAX_NODES = 4;

/** Options of `layoutDiagram`: the contract's `LayoutOptions` plus ELK worker support. */
export interface AutoLayoutOptions extends LayoutOptions {
  /**
   * URL of `elkjs/lib/elk-worker.min.js` as served by the app (browsers only). When set and `Worker`
   * exists, ELK runs in a Web Worker; otherwise it runs in-process. Ignored by `layoutDiagramSync`.
   */
  workerUrl?: string | URL;
}

interface Prepared {
  graph: LayoutGraph;
  /** Nodes with a saved position: they keep it. */
  fixed: Map<string, { x: number; y: number }>;
  /** Everything else, for the engine. */
  free: LayoutGraph;
  direction: Direction;
  /** Target width / height of the whole picture. */
  aspect: number;
  /** Group ids in model order (the order of `geometry.groups`). */
  groupOrder: string[];
}

function prepare(model: DiagramModel, options: LayoutOptions): Prepared {
  const saved: Record<string, Partial<NodeLayout>> = options.saved?.nodes ?? {};
  const graph = prepareGraph(model, {
    detailLevel: options.detailLevel ?? 'all',
    measure: options.measure ?? estimateTextWidth,
    saved,
    collapsed: collapsedGroupIds(model, options.saved),
  });
  const fixed = new Map<string, { x: number; y: number }>();
  for (const n of graph.nodes) {
    const s = Object.prototype.hasOwnProperty.call(saved, n.id) ? saved[n.id] : undefined;
    if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) fixed.set(n.id, { x: s.x!, y: s.y! });
  }
  return {
    graph,
    fixed,
    free: subgraph(graph, (n) => !fixed.has(n.id)),
    direction: options.direction === 'DOWN' ? 'DOWN' : 'RIGHT',
    aspect:
      typeof options.aspectRatio === 'number' &&
      Number.isFinite(options.aspectRatio) &&
      options.aspectRatio > 0
        ? Math.min(4, Math.max(0.25, options.aspectRatio))
        : TARGET_ASPECT,
    groupOrder: model.groups.map((g) => g.id),
  };
}

/**
 * Moves the engine's placement next to the fixed nodes (right of or below their bounding box,
 * whichever keeps the picture closer to a landscape screen), then builds the geometry.
 */
function finalize(p: Prepared, placement: Placement): DiagramGeometry {
  const { graph, fixed, free } = p;
  if (fixed.size && free.nodes.length) {
    const fixedBoxes: Box[] = [];
    for (const [id, pos] of fixed) {
      const n = graph.nodeById.get(id)!;
      fixedBoxes.push({ x: pos.x, y: pos.y, width: n.width, height: n.height });
    }
    for (const g of graph.groups) {
      const members = g.members.filter((m) => fixed.has(m));
      if (members.length)
        fixedBoxes.push(groupBox(members.map((m) => ({ ...fixed.get(m)!, ...size(graph, m) }))));
    }
    const f = unionBoxes(fixedBoxes);
    const b = placementBounds(free, placement);
    const score = (w: number, h: number) => Math.max(w / p.aspect, h);
    const right = score(f.width + BLOCK_GAP + b.width, Math.max(f.height, b.height));
    const below = score(Math.max(f.width, b.width), f.height + BLOCK_GAP + b.height);
    if (right <= below)
      translatePlacement(
        placement,
        Math.round(f.x + f.width + BLOCK_GAP - b.x),
        Math.round(f.y - b.y),
      );
    else
      translatePlacement(
        placement,
        Math.round(f.x - b.x),
        Math.round(f.y + f.height + BLOCK_GAP - b.y),
      );
  }

  const nodes: Record<string, NodeGeometry> = {};
  const collapsed = new Map<string, GroupGeometry>();
  const boxes: Box[] = [];
  for (const n of graph.nodes) {
    const pos = fixed.get(n.id) ?? placement.positions.get(n.id) ?? { x: 0, y: 0 };
    if (n.collapsedGroup) {
      // The box is the collapsed group itself: it goes into `groups`, never into `nodes`.
      const box = { x: pos.x, y: pos.y, width: n.width, height: n.height };
      collapsed.set(n.id, { id: n.id, ...box, collapsed: true });
      boxes.push(box);
      continue;
    }
    const node: NodeGeometry = {
      id: n.id,
      kind: n.kind,
      x: pos.x,
      y: pos.y,
      width: n.width,
      height: n.height,
      ...(n.detailLevel ? { detailLevel: n.detailLevel } : {}),
    };
    nodes[n.id] = node;
    boxes.push(node);
  }
  const groups: Record<string, GroupGeometry> = {};
  const expanded = new Map(graph.groups.map((g) => [g.id, g]));
  for (const id of p.groupOrder) {
    const c = collapsed.get(id);
    if (c) {
      groups[id] = c;
      continue;
    }
    const g = expanded.get(id);
    if (!g || groups[id]) continue;
    const box = groupBox(g.members.map((m) => nodes[m]!));
    groups[g.id] = { id: g.id, ...box };
    boxes.push(box);
  }
  const edges: DiagramGeometry['edges'] = {};
  for (const e of graph.edges) {
    if (e.source === e.target) {
      // Self refs loop out of the table's left edge (drawn by the renderer).
      const n = nodes[e.source]!;
      boxes.push({ x: n.x - METRICS.selfLoopReach, y: n.y, width: 0, height: n.height });
    }
    const pts = placement.edges.get(e.id);
    if (!pts || fixed.has(e.source) || fixed.has(e.target)) continue;
    // Engines route parent → child; the contract stores points in ref.from → ref.to order.
    const ordered = e.reversed ? [...pts].reverse() : pts;
    edges[e.id] = { id: e.id, points: ordered.map((q) => ({ x: q.x, y: q.y })) };
    for (const q of pts) boxes.push({ x: q.x, y: q.y, width: 0, height: 0 });
  }
  return { nodes, groups, edges, bounds: unionBoxes(boxes) };
}

function size(graph: LayoutGraph, id: string): { width: number; height: number } {
  const n = graph.nodeById.get(id)!;
  return { width: n.width, height: n.height };
}

function syncPlacement(p: Prepared, engine: LayoutOptions['engine']): Placement {
  return engine === 'grid'
    ? gridEnginePlacement(p.free, p.aspect)
    : dagrePlacement(p.free, p.direction, p.aspect);
}

/** Whether `engine: 'auto'` gives this connected component to ELK (else dagre). */
function autoPicksElk(comp: LayoutGraph): boolean {
  return comp.groups.length > 0 || comp.nodes.length > AUTO_DAGRE_MAX_NODES;
}

/** Whether laying out this component with ELK actually runs (and loads) ELK. */
function elkRuns(comp: LayoutGraph): boolean {
  return comp.edges.length > 0;
}

/**
 * Whether `layoutDiagram(model, { ...options, engine: 'auto' })` would load ELK at all: true when
 * some connected component of the free (unsaved) nodes has refs and either more than
 * `AUTO_DAGRE_MAX_NODES` nodes or a TableGroup with members in it. The canvas calls it to skip the
 * async ELK pass (and the worker download) entirely. `options.engine` is ignored.
 */
export function needsElk(model: DiagramModel, options: LayoutOptions = {}): boolean {
  const p = prepare(model, options);
  return components(p.free).some((c) => elkRuns(c) && autoPicksElk(c));
}

/**
 * Synchronous auto-layout with dagre (default) or the grid engine (`engine: 'grid'`). `engine:
 * 'elk'` and `'auto'` are treated as dagre here. No edge routes are produced; renderers route refs themselves.
 */
export function layoutDiagramSync(
  model: DiagramModel,
  options: LayoutOptions = {},
): DiagramGeometry {
  const p = prepare(model, options);
  return finalize(p, syncPlacement(p, options.engine));
}

/**
 * Auto-layout with ELK (default) — layered, ports on the referenced column rows, orthogonal ref
 * routes in `geometry.edges`, TableGroups as compound nodes. `engine: 'dagre' | 'grid'` runs the
 * synchronous engines. `engine: 'auto'` decides per connected component of free nodes: dagre (no
 * routes) for components of at most `AUTO_DAGRE_MAX_NODES` nodes without groups, ELK for the
 * others; elkjs is not loaded when no component needs it (`needsElk`). Deterministic: the same
 * input always gives the same geometry.
 *
 * @example
 * ```ts
 * import { compileDbml, layoutDiagram, layoutDiagramSync } from '@relvista/core';
 *
 * const { model } = compileDbml(source);
 * if (model) {
 *   const geometry = await layoutDiagram(model, { engine: 'auto', direction: 'RIGHT' });
 *   geometry.nodes['public.users']; // { x, y, width, height, ... }
 *   // Synchronous first picture (dagre), e.g. before the ELK result arrives:
 *   const quick = layoutDiagramSync(model);
 * }
 * ```
 */
export async function layoutDiagram(
  model: DiagramModel,
  options: AutoLayoutOptions = {},
): Promise<DiagramGeometry> {
  const p = prepare(model, options);
  if (options.engine === 'dagre' || options.engine === 'grid')
    return finalize(p, syncPlacement(p, options.engine));
  const workerUrl = options.workerUrl === undefined ? undefined : String(options.workerUrl);
  const auto = options.engine === 'auto';
  const blocks = [];
  // One engine run per connected component, sequentially (results are packed by our own packer).
  for (const comp of components(p.free)) {
    const placement =
      auto && !autoPicksElk(comp)
        ? dagreComponent(comp, p.direction)
        : await elkComponent(comp, p.direction, workerUrl);
    blocks.push(toBlock(comp, placement));
  }
  return finalize(p, packBlocks(orderBlocks(blocks), BLOCK_GAP, p.aspect));
}
