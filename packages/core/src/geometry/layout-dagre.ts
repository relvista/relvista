/**
 * Synchronous engines: dagre (layered, no ports) and grid (no edges considered).
 *
 * dagre has no reliable padding control for compound nodes, so groups are laid out in two levels:
 * each group's members are laid out on their own, the group becomes one box in the outer layout, and
 * the inner placement is moved into that box. That guarantees group boxes never overlap.
 */
import dagre from '@dagrejs/dagre';
import { METRICS } from './metrics.js';
import {
  components,
  subgraph,
  translatePlacement,
  type LayoutGraph,
  type LayoutNode,
  type Placement,
} from './layout-graph.js';
import { gridPlacement, layoutComponents, singlePlacement, toBlock } from './layout-pack.js';
import { alignRows, type DagreChain } from './layout-rows.js';

export type Direction = 'RIGHT' | 'DOWN';

/** Gap between nodes of one layer / between members of a group without refs. */
export const NODE_GAP = 48;
/** Gap between two ref lines passing through one layer (dagre `edgesep`). */
export const EDGE_GAP = 20;
/** Gap between layers (room for the ref lines). */
export const LAYER_GAP = 110;
/** Gap between packed blocks inside a group. */
const INNER_BLOCK_GAP = NODE_GAP;

/** What one dagre run returns, before the row post-pass. */
export interface DagreRun {
  /** Top-left corners, rounded. */
  positions: Map<string, { x: number; y: number }>;
  /** Centre x of every node as dagre returned it (one value per rank in a left-to-right run). */
  centreX: Map<string, number>;
  /** The edges given to dagre, with their points (`DagreChain`). */
  chains: DagreChain[];
}

/**
 * Runs dagre on a flat graph with edges. Self refs and repeated refs between one pair are
 * dropped. With `mergeTwoWay`, refs both ways between two tables also become one dagre edge (the
 * first ref's direction) instead of two antiparallel ones, which dagre's ranking and ordering
 * count twice once cycle breaking has turned one around (the decision 0003 bench measured larger
 * pictures with them); the row post-pass still lines up both refs on that edge. Only the runs
 * that get the post-pass merge, so top-to-bottom output is the same as without it.
 */
export function runDagre(g: LayoutGraph, direction: Direction, mergeTwoWay: boolean): DagreRun {
  const dg = new dagre.graphlib.Graph();
  dg.setGraph({
    rankdir: direction === 'DOWN' ? 'TB' : 'LR',
    nodesep: NODE_GAP,
    ranksep: LAYER_GAP,
    edgesep: EDGE_GAP,
    marginx: 0,
    marginy: 0,
    ranker: 'network-simplex',
  });
  dg.setDefaultEdgeLabel(() => ({}));
  for (const n of g.nodes) dg.setNode(n.id, { width: n.width, height: n.height });
  const pairs = new Set<string>();
  const added: Array<[string, string]> = [];
  for (const e of g.edges) {
    if (e.source === e.target) continue;
    const key = JSON.stringify([e.source, e.target]);
    if (pairs.has(key)) continue;
    if (mergeTwoWay && pairs.has(JSON.stringify([e.target, e.source]))) continue;
    pairs.add(key);
    dg.setEdge(e.source, e.target);
    added.push([e.source, e.target]);
  }
  dagre.layout(dg);
  const positions = new Map<string, { x: number; y: number }>();
  const centreX = new Map<string, number>();
  for (const n of g.nodes) {
    const d = dg.node(n.id) as { x: number; y: number };
    positions.set(n.id, { x: Math.round(d.x - n.width / 2), y: Math.round(d.y - n.height / 2) });
    centreX.set(n.id, d.x);
  }
  const chains = added.map(([source, target]) => ({
    source,
    target,
    points: (dg.edge(source, target) as { points: Array<{ x: number; y: number }> }).points,
  }));
  return { positions, centreX, chains };
}

/**
 * dagre on a flat, connected graph (no groups). Left to right, a post-pass then moves tables
 * inside their rank so the column rows a ref joins face each other (`alignRows`). `align: false`
 * skips it for the outer level of a grouped layout, whose nodes are group boxes, not tables.
 * Top to bottom has no post-pass (the rows of a table are stacked across the flow there).
 */
function dagreFlat(g: LayoutGraph, direction: Direction, align = true): Placement {
  if (g.nodes.length === 1) return singlePlacement(g);
  if (!g.edges.length) return gridPlacement(g, NODE_GAP);
  const rows = align && direction === 'RIGHT';
  const run = runDagre(g, direction, rows);
  if (rows)
    alignRows(g, run.positions, run.centreX, run.chains, { nodeGap: NODE_GAP, edgeGap: EDGE_GAP });
  return { positions: run.positions, edges: new Map() };
}

/** Flat layout of possibly disconnected nodes: each component with dagre, then packed. */
function dagreLoose(g: LayoutGraph, direction: Direction, gap: number): Placement {
  return layoutComponents(components(g), (c) => dagreFlat(c, direction), gap);
}

/** dagre on one connected component, groups laid out in two levels. */
export function dagreComponent(g: LayoutGraph, direction: Direction): Placement {
  if (!g.groups.length) return dagreFlat(g, direction);
  const pad = METRICS.groupPadding;
  const head = METRICS.groupHeaderHeight;
  const groupOf = new Map<string, string>();
  const inner = new Map<string, Placement>();
  const superNodes: LayoutNode[] = [];
  const memberIds = new Set<string>();

  for (const grp of g.groups) {
    const members = new Set(grp.members);
    for (const m of grp.members) {
      groupOf.set(m, grp.id);
      memberIds.add(m);
    }
    const flat = { ...subgraph(g, (n) => members.has(n.id)), groups: [] };
    const block = toBlock(flat, dagreLoose(flat, direction, INNER_BLOCK_GAP));
    inner.set(grp.id, block.placement);
    const first = g.nodeById.get(grp.members[0]!)!;
    superNodes.push({
      id: grp.id,
      kind: 'table',
      index: first.index,
      width: block.width + pad * 2,
      height: block.height + pad * 2 + head,
      groupId: null,
    });
  }
  for (const n of g.nodes) if (!memberIds.has(n.id)) superNodes.push(n);
  superNodes.sort((a, b) => a.index - b.index);

  const outer: LayoutGraph = {
    nodes: superNodes,
    nodeById: new Map(superNodes.map((n) => [n.id, n])),
    edges: g.edges
      .map((e) => ({
        ...e,
        source: groupOf.get(e.source) ?? e.source,
        target: groupOf.get(e.target) ?? e.target,
      }))
      .filter((e) => e.source !== e.target),
    groups: [],
  };
  const placed = dagreFlat(outer, direction, false);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of superNodes) {
    const p = placed.positions.get(n.id)!;
    const sub = inner.get(n.id);
    if (!sub) {
      positions.set(n.id, p);
      continue;
    }
    translatePlacement(sub, p.x + pad, p.y + pad + head);
    for (const [id, q] of sub.positions) positions.set(id, q);
  }
  return { positions, edges: new Map() };
}

export function dagrePlacement(g: LayoutGraph, direction: Direction, aspect?: number): Placement {
  return layoutComponents(components(g), (c) => dagreComponent(c, direction), undefined, aspect);
}

/** Grid engine: refs are ignored; groups become grids of their members; everything is packed. */
export function gridEnginePlacement(g: LayoutGraph, aspect?: number): Placement {
  const loose: LayoutGraph = { ...g, edges: [] };
  return layoutComponents(components(loose), (c) => gridPlacement(c, NODE_GAP), undefined, aspect);
}
