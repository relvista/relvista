/**
 * Row alignment for the dagre engine (decision 0003, phase3-v1 §13, docs/design/autolayout.md).
 *
 * dagre has no ports: it centres tables on each other, so a ref leaves the parent at its key row
 * and reaches the child at its FK row with a vertical offset. This post-pass moves tables up or
 * down inside their rank so that the rows a ref joins face each other where the ranks allow it.
 * It runs on left-to-right layouts only.
 *
 * Only vertical positions change, only inside a rank (tables of one rank share a column and dagre
 * keeps ranks apart, so tables of different ranks never overlap), with at least the dagre spacing
 * between neighbours (`nodeGap` between tables, `edgeGap` between bend points). A ref that spans
 * several ranks keeps dagre's bend points there ("dummies", ordered with the tables of their
 * rank), and its port-to-port line is kept clear of the nearest table on each side of its bend
 * point in those ranks.
 *
 * The pass lowers the sum of vertical offsets along every ref (port, bend points, port) by
 * coordinate descent: one rank at a time with the others fixed, solved exactly as an ordered
 * (isotonic) weighted-median problem, sweeping the ranks left to right and back until nothing
 * moves (large graphs stop after `MAX_SWEEPS`). Medians make most refs exactly straight instead of
 * spreading every offset a little. Where a rank alone cannot move (a run of straight refs pulled
 * at both ends), the slots joined by straight refs move as one group. The first sweeps may also
 * reorder a rank by where its refs pull each table (dagre orders without knowing the rows). The
 * line clearance turns into bounds on a slot once the first sweeps are done.
 *
 * Limits: the result is a local optimum. A table pulled equally both ways (a parent between two
 * children that cannot both face it, two refs both ways between a pair) stays where it is inside
 * that tie, so neither ref may be straight; moving it to one end instead grew the pictures in the
 * decision 0003 bench. Self refs are ignored, several refs between one pair each count, and a
 * composite ref counts at the row of its first column (`prepareGraph`). Deterministic: ranks and
 * slots are visited in a fixed order, ties keep the dagre order.
 */
import { portY, type LayoutGraph } from './layout-graph.js';

/**
 * Sweeps over the ranks, alternately left to right and back. With 20 sweeps and 20 group rounds
 * the decision 0003 bench gave the same results for every component size below 20.
 */
const MAX_SWEEPS = 6;
/** First sweeps, which may also reorder a rank by where its refs pull it, before order freezes. */
const REORDER_SWEEPS = 2;
/** Rounds of straight-group moves, each followed by sweeps (see `MAX_SWEEPS`). */
const MAX_GROUP_ROUNDS = 4;
/** Space a ref that spans ranks keeps from the tables of the ranks in between. */
const CLEARANCE = 12;
/** Least share of a ref line's position an end must carry to be moved for its clearance. */
const MIN_LEVERAGE = 0.5;
/** Weight that keeps a slot without terms where dagre put it. */
const ANCHOR_WEIGHT = 1e-6;
/** Weight of a bound once a slot is pinned to it. */
const PIN_WEIGHT = 1e6;

/** One dagre edge: the table pair it joins and its bend points, from `source` to `target`. */
export interface DagreChain {
  source: string;
  target: string;
  points: Array<{ x: number; y: number }>;
}

export interface AlignSpacing {
  /** Minimum vertical gap between two tables of one rank (dagre `nodesep`). */
  nodeGap: number;
  /** Minimum vertical gap between two bend points of one rank (dagre `edgesep`). */
  edgeGap: number;
}

interface Slot {
  id: string;
  /** Table height, 0 for a bend point. */
  height: number;
  dummy: boolean;
}

/** A ref drawn port to port that must pass above (or below) a table of a rank in between. */
interface Clearance {
  s: string;
  sOff: number;
  t: string;
  tOff: number;
  table: string;
  /** Where the table's left and right edges lie along the line (0 at s, 1 at t). */
  lambdas: number[];
  /** The line passes above the table (else below). */
  above: boolean;
}

/** An offset term between two points (slot top + offset on each side); its size is minimised. */
interface Term {
  a: string;
  offA: number;
  b: string;
  offB: number;
}

const key = (x: number) => Math.round(x * 1000);

/**
 * Lines up the port rows of refs in a left-to-right dagre placement, in place. `positions` are
 * top-left corners; `centreX` is each table's centre x as dagre returned it (rankdir LR gives
 * every table of a rank the same one); `chains` are dagre's edges with their points. Tables
 * missing from `positions` or `centreX` are ignored.
 */
export function alignRows(
  g: LayoutGraph,
  positions: Map<string, { x: number; y: number }>,
  centreX: Map<string, number>,
  chains: DagreChain[],
  spacing: AlignSpacing,
): void {
  if (g.nodes.length < 2 || !g.edges.length) return;

  const slots = new Map<string, Slot>();
  const y = new Map<string, number>();
  const rankSlots = new Map<number, string[]>();
  const put = (rank: number, slot: Slot, top: number) => {
    slots.set(slot.id, slot);
    y.set(slot.id, top);
    let list = rankSlots.get(rank);
    if (!list) rankSlots.set(rank, (list = []));
    list.push(slot.id);
  };
  for (const n of g.nodes) {
    const cx = centreX.get(n.id);
    const p = positions.get(n.id);
    if (cx === undefined || !p) continue;
    put(key(cx), { id: n.id, height: n.height, dummy: false }, p.y);
  }
  if (rankSlots.size < 2) return;

  // Bend points of each dagre edge in the ranks that hold tables (the others hold no table to
  // pass beside), from source to target.
  const chainOf = new Map<string, { dummies: string[] }>();
  chains.forEach((c, i) => {
    const dummies: string[] = [];
    c.points.forEach((pt, k) => {
      const rank = key(pt.x);
      if (!rankSlots.has(rank) || k === 0 || k === c.points.length - 1) return;
      const id = `\u0000${i}:${k}`;
      put(rank, { id, height: 0, dummy: true }, pt.y);
      dummies.push(id);
    });
    // A ref may run against the dagre edge (antiparallel refs share one edge).
    chainOf.set(JSON.stringify([c.source, c.target]), { dummies });
    chainOf.set(JSON.stringify([c.target, c.source]), { dummies: [...dummies].reverse() });
  });

  const terms: Term[] = [];
  for (const e of g.edges) {
    if (e.source === e.target || !slots.has(e.source) || !slots.has(e.target)) continue;
    const chain = chainOf.get(JSON.stringify([e.source, e.target]));
    const path: Array<[string, number]> = [
      [e.source, portY(e.sourceRow, slots.get(e.source)!.height)],
      ...(chain?.dummies ?? []).map((d): [string, number] => [d, 0]),
      [e.target, portY(e.targetRow, slots.get(e.target)!.height)],
    ];
    for (let i = 1; i < path.length; i++) {
      const [a, offA] = path[i - 1]!;
      const [b, offB] = path[i]!;
      terms.push({ a, offA, b, offB });
    }
  }
  const termsOf = new Map<string, Array<{ off: number; other: string; otherOff: number }>>();
  const addTerm = (id: string, off: number, other: string, otherOff: number) => {
    let list = termsOf.get(id);
    if (!list) termsOf.set(id, (list = []));
    list.push({ off, other, otherOff });
  };
  for (const t of terms) {
    addTerm(t.a, t.offA, t.b, t.offB);
    addTerm(t.b, t.offB, t.a, t.offA);
  }

  const centre = (id: string) => y.get(id)! + slots.get(id)!.height / 2;
  const ranks = Array.from(rankSlots.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, ids]) => ids.sort((a, b) => centre(a) - centre(b) || (a < b ? -1 : 1)));
  const rankOf = new Map<string, number>();
  ranks.forEach((ids, r) => ids.forEach((id) => rankOf.set(id, r)));

  const gapBetween = (a: Slot, b: Slot) =>
    a.dummy && b.dummy
      ? spacing.edgeGap
      : a.dummy || b.dummy
        ? (spacing.nodeGap + spacing.edgeGap) / 2
        : spacing.nodeGap;

  /** Clearance constraints by the slots they involve (filled after the first sweeps). */
  const clearancesOf = new Map<string, Clearance[]>();
  /**
   * Bounds on a slot's top from its clearance constraints, the other slots where they are. A line
   * end is bounded only where it carries at least `MIN_LEVERAGE` of the line (else the bound is
   * the line's distance times up to 1 / leverage away, and pinning the end to it ran away to
   * thousands of units); a slot whose bounds contradict each other gets none.
   */
  const boundOf = (id: string): { min: number; max: number } | undefined => {
    const list = clearancesOf.get(id);
    if (!list) return undefined;
    let min = -Infinity;
    let max = Infinity;
    for (const c of list) {
      const ps = y.get(c.s)! + c.sOff;
      const pt = y.get(c.t)! + c.tOff;
      const top = y.get(c.table)!;
      const h = slots.get(c.table)!.height;
      for (const l of c.lambdas) {
        const line = ps * (1 - l) + pt * l;
        if (id === c.table) {
          if (c.above) min = Math.max(min, line + CLEARANCE);
          else max = Math.min(max, line - CLEARANCE - h);
          continue;
        }
        if ((id === c.s ? 1 - l : l) < MIN_LEVERAGE) continue;
        if (c.above) {
          if (id === c.s) max = Math.min(max, (top - CLEARANCE - pt * l) / (1 - l) - c.sOff);
          else max = Math.min(max, (top - CLEARANCE - ps * (1 - l)) / l - c.tOff);
        } else if (id === c.s)
          min = Math.max(min, (top + h + CLEARANCE - pt * l) / (1 - l) - c.sOff);
        else min = Math.max(min, (top + h + CLEARANCE - ps * (1 - l)) / l - c.tOff);
      }
    }
    return min > max ? undefined : { min, max };
  };
  /**
   * Weighted median of [value, weight] pairs sorted by value. On a tie (a median interval), the
   * point of the interval nearest `prefer` (the slot's current place), else its middle: a slot
   * between two pulls stays put instead of halving the gap each sweep, so chains settle exactly.
   */
  const median = (sorted: Array<[number, number]>, prefer?: number): number => {
    let total = 0;
    for (const [, k] of sorted) total += k;
    let acc = 0;
    for (let i = 0; i < sorted.length; i++) {
      const [v, k] = sorted[i]!;
      acc += k;
      if (Math.abs(acc - total / 2) < 1e-9 && i + 1 < sorted.length) {
        const next = sorted[i + 1]![0];
        return prefer === undefined ? (v + next) / 2 : Math.min(Math.max(prefer, v), next);
      }
      if (acc > total / 2) return v;
    }
    return sorted[sorted.length - 1]![0];
  };
  /** Merges two lists sorted by value. */
  const merge = (a: Array<[number, number]>, b: Array<[number, number]>) => {
    const out: Array<[number, number]> = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) out.push(a[i]![0] <= b[j]![0] ? a[i++]! : b[j++]!);
    while (i < a.length) out.push(a[i++]!);
    while (j < b.length) out.push(b[j++]!);
    return out;
  };

  let reordered = false;
  const solveRank = (ids: string[], r: number, reorder: boolean): boolean => {
    const wants = new Map<string, Array<[number, number]>>();
    for (const id of ids) {
      const list: Array<[number, number]> = [];
      for (const t of termsOf.get(id) ?? []) {
        if (rankOf.get(t.other) === r) continue;
        // Top of this slot that puts its point level with the other end.
        list.push([y.get(t.other)! + t.otherOff - t.off, 1]);
      }
      if (!list.length) list.push([y.get(id)!, ANCHOR_WEIGHT]);
      wants.set(
        id,
        list.sort((p, q) => p[0] - q[0]),
      );
    }
    if (reorder) {
      // Port barycentre order: each slot where its refs would put its centre.
      const at = (id: string) => median(wants.get(id)!) + slots.get(id)!.height / 2;
      const was = new Map(ids.map((id, i) => [id, i]));
      ids.sort((a, b) => at(a) - at(b) || was.get(a)! - was.get(b)!);
      if (ids.some((id, i) => was.get(id) !== i)) reordered = true;
    }
    // Offsets turn y[i+1] >= y[i] + h[i] + gap into z[i+1] >= z[i] (z = y - offset): isotonic
    // regression, solved by pooling adjacent violators.
    const offsets: number[] = [];
    let off = 0;
    ids.forEach((id, i) => {
      if (i > 0) {
        const prev = slots.get(ids[i - 1]!)!;
        off += prev.height + gapBetween(prev, slots.get(id)!);
      }
      offsets.push(off);
    });
    const pins = new Map<number, number>();
    const solve = (): number[] => {
      const blocks: Array<{
        start: number;
        end: number;
        vals: Array<[number, number]>;
        /** Current place of the block (mean of its slots, in z). */
        pref: number;
        at: number;
      }> = [];
      ids.forEach((id, i) => {
        let vals: Array<[number, number]> = wants
          .get(id)!
          .map(([v, k]): [number, number] => [v - offsets[i]!, k]);
        const pin = pins.get(i);
        if (pin !== undefined) vals = merge(vals, [[pin - offsets[i]!, PIN_WEIGHT]]);
        const pref = y.get(id)! - offsets[i]!;
        blocks.push({ start: i, end: i, vals, pref, at: median(vals, pref) });
        while (blocks.length > 1) {
          const b = blocks[blocks.length - 1]!;
          const a = blocks[blocks.length - 2]!;
          if (a.at <= b.at) break;
          const vals = merge(a.vals, b.vals);
          const na = a.end - a.start + 1;
          const nb = b.end - b.start + 1;
          const pref = (a.pref * na + b.pref * nb) / (na + nb);
          blocks.splice(blocks.length - 2, 2, {
            start: a.start,
            end: b.end,
            vals,
            pref,
            at: median(vals, pref),
          });
        }
      });
      const out: number[] = [];
      for (const b of blocks) for (let i = b.start; i <= b.end; i++) out.push(b.at + offsets[i]!);
      return out;
    };
    let next = solve();
    for (let round = 0; round < ids.length; round++) {
      let pinned = false;
      ids.forEach((id, i) => {
        const bound = boundOf(id);
        if (!bound || pins.has(i)) return;
        if (next[i]! < bound.min - 0.5) pins.set(i, bound.min);
        else if (next[i]! > bound.max + 0.5) pins.set(i, bound.max);
        else return;
        pinned = true;
      });
      if (!pinned) break;
      next = solve();
    }
    let moved = false;
    ids.forEach((id, i) => {
      if (Math.abs(next[i]! - y.get(id)!) > 0.5) moved = true;
      y.set(id, next[i]!);
    });
    return moved;
  };

  const sweeps = (count: number, reorderSweeps: number) => {
    for (let sweep = 0; sweep < count; sweep++) {
      let moved = false;
      const order = ranks.map((ids, r) => [ids, r] as const);
      if (sweep % 2) order.reverse();
      for (const [ids, r] of order) if (solveRank(ids, r, sweep < reorderSweeps)) moved = true;
      if (!moved && !reordered) break;
      reordered = false;
    }
  };
  /** How far a clearance constraint is violated, summed over its sample points. */
  const violation = (c: Clearance): number => {
    const ps = y.get(c.s)! + c.sOff;
    const pt = y.get(c.t)! + c.tOff;
    const top = y.get(c.table)!;
    const h = slots.get(c.table)!.height;
    let v = 0;
    for (const l of c.lambdas) {
      const line = ps * (1 - l) + pt * l;
      v += Math.max(0, c.above ? line + CLEARANCE - top : top + h + CLEARANCE - line);
    }
    return v;
  };
  /**
   * Rank solves move one rank at a time, so a run of refs that are already straight stalls: in a
   * chain a-b-c-d with a-b and c-d straight, b and c each sit between two equal pulls. This moves
   * every group of slots joined by straight refs (across ranks) as one, by the weighted median of
   * its other refs, as far as the neighbours in each member's rank allow, unless that breaks a
   * line clearance. Returns whether anything moved.
   */
  const moveStraightGroups = (): boolean => {
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      let r = id;
      while (parent.has(r)) r = parent.get(r)!;
      return r;
    };
    for (const t of terms) {
      if (Math.abs(y.get(t.a)! + t.offA - y.get(t.b)! - t.offB) >= 0.5) continue;
      const a = find(t.a);
      const b = find(t.b);
      if (a !== b) parent.set(b, a);
    }
    const groups = new Map<string, string[]>();
    for (const id of slots.keys()) {
      const r = find(id);
      let list = groups.get(r);
      if (!list) groups.set(r, (list = []));
      list.push(id);
    }
    const indexOf = new Map<string, number>();
    for (const ids of ranks) ids.forEach((id, i) => indexOf.set(id, i));
    let moved = false;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const inGroup = new Set(list);
      const wants: Array<[number, number]> = [];
      let lo = -Infinity;
      let hi = Infinity;
      for (const id of list) {
        for (const t of termsOf.get(id) ?? [])
          if (!inGroup.has(t.other))
            wants.push([y.get(t.other)! + t.otherOff - y.get(id)! - t.off, 1]);
        const ids = ranks[rankOf.get(id)!]!;
        const i = indexOf.get(id)!;
        const slot = slots.get(id)!;
        const above = ids[i - 1];
        if (above !== undefined && !inGroup.has(above)) {
          const a = slots.get(above)!;
          lo = Math.max(lo, y.get(above)! + a.height + gapBetween(a, slot) - y.get(id)!);
        }
        const below = ids[i + 1];
        if (below !== undefined && !inGroup.has(below)) {
          const b = slots.get(below)!;
          hi = Math.min(hi, y.get(below)! - y.get(id)! - slot.height - gapBetween(slot, b));
        }
      }
      if (!wants.length || lo > hi) continue;
      const d = Math.min(
        Math.max(
          median(
            wants.sort((p, q) => p[0] - q[0]),
            0,
          ),
          lo,
        ),
        hi,
      );
      if (Math.abs(d) <= 0.5) continue;
      const touched = new Set<Clearance>();
      for (const id of list) for (const c of clearancesOf.get(id) ?? []) touched.add(c);
      let before = 0;
      for (const c of touched) before += violation(c);
      for (const id of list) y.set(id, y.get(id)! + d);
      let after = 0;
      for (const c of touched) after += violation(c);
      if (after > before + 0.5) {
        for (const id of list) y.set(id, y.get(id)! - d);
        continue;
      }
      moved = true;
    }
    return moved;
  };
  /** Sweeps, then straight-group moves and sweeps again while those move anything. */
  const settle = (reorderSweeps: number) => {
    sweeps(MAX_SWEEPS, reorderSweeps);
    for (let round = 0; round < MAX_GROUP_ROUNDS && moveStraightGroups(); round++)
      sweeps(MAX_SWEEPS, 0);
  };
  settle(REORDER_SWEEPS);

  // Clearance: a ref that spans ranks is drawn port to port, so the straight line must clear
  // the tables of the ranks in between, on the side of its bend point there. Each such pair is
  // a linear constraint on three tops (the two ends and the table); every rank solve then turns
  // the constraints that involve its slots into bounds, the other ranks fixed.
  const xOf = new Map<string, number>();
  for (const n of g.nodes) {
    const p = positions.get(n.id);
    if (p) xOf.set(n.id, p.x);
  }
  for (const e of g.edges) {
    const chain = chainOf.get(JSON.stringify([e.source, e.target]));
    if (!chain?.dummies.length) continue;
    const s = g.nodeById.get(e.source)!;
    const t = g.nodeById.get(e.target)!;
    const right = xOf.get(t.id)! + t.width / 2 >= xOf.get(s.id)! + s.width / 2;
    const ax = right ? xOf.get(s.id)! + s.width : xOf.get(s.id)!;
    const bx = right ? xOf.get(t.id)! : xOf.get(t.id)! + t.width;
    if (ax === bx) continue;
    for (const d of chain.dummies) {
      const ids = ranks[rankOf.get(d)!]!;
      const di = ids.indexOf(d);
      // Only the nearest table on each side of the bend point: the tables beyond it are further
      // from the line, and checking every table of the rank costs refs x tables constraints.
      const near: number[] = [];
      for (const step of [-1, 1])
        for (let i = di + step; i >= 0 && i < ids.length; i += step) {
          const id = ids[i]!;
          if (slots.get(id)!.dummy || id === s.id || id === t.id) continue;
          near.push(i);
          break;
        }
      for (const i of near) {
        const id = ids[i]!;
        const x0 = xOf.get(id)!;
        const lambdas = [x0, x0 + g.nodeById.get(id)!.width]
          .map((x) => (x - ax) / (bx - ax))
          .filter((l) => l > 0 && l < 1);
        if (!lambdas.length) continue;
        const c: Clearance = {
          s: s.id,
          sOff: portY(e.sourceRow, s.height),
          t: t.id,
          tOff: portY(e.targetRow, t.height),
          table: id,
          lambdas,
          above: i > di,
        };
        for (const k of [c.s, c.t, c.table]) {
          let list = clearancesOf.get(k);
          if (!list) clearancesOf.set(k, (list = []));
          list.push(c);
        }
      }
    }
  }
  if (clearancesOf.size) {
    // Make the drawing feasible first (move the tables in between), then settle again.
    for (const [ids, r] of ranks.map((ids, r) => [ids, r] as const))
      if (ids.some((id) => clearancesOf.get(id)?.some((c) => c.table === id)))
        solveRank(ids, r, false);
    settle(0);
  }

  // Round, keeping the table gap inside each rank after rounding.
  for (const ids of ranks) {
    let floor = -Infinity;
    for (const id of ids) {
      const slot = slots.get(id)!;
      if (slot.dummy) continue;
      const top = Math.max(Math.round(y.get(id)!), floor);
      positions.get(id)!.y = top;
      floor = Math.ceil(top + slot.height + spacing.nodeGap);
    }
  }
}
