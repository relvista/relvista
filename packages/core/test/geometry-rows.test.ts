// Row alignment post-pass of the dagre engine (src/geometry/layout-rows.ts, decision 0003): left
// to right, tables move inside their rank so the column rows a ref joins face each other where the
// ranks allow it; tables never overlap, nothing else changes and the result is deterministic.
import { describe, expect, it } from 'vitest';
import {
  compileDbml,
  estimateTextWidth,
  layoutDiagramSync,
  type Box,
  type DetailLevel,
  type DiagramGeometry,
  type DiagramModel,
  type LayoutOptions,
  type NodeLayout,
} from '../src/index.js';
import { collapsedGroupIds } from '../src/geometry/collapse.js';
import {
  components,
  portY,
  prepareGraph,
  type LayoutEdge,
  type LayoutGraph,
} from '../src/geometry/layout-graph.js';
import { EDGE_GAP, NODE_GAP, runDagre } from '../src/geometry/layout-dagre.js';
import { alignRows } from '../src/geometry/layout-rows.js';

const model = (src: string): DiagramModel => {
  const { model, diagnostics } = compileDbml(src);
  if (!model) throw new Error(JSON.stringify(diagnostics));
  return model;
};

function graphOf(m: DiagramModel, options: LayoutOptions = {}): LayoutGraph {
  return prepareGraph(m, {
    detailLevel: options.detailLevel ?? 'all',
    measure: estimateTextWidth,
    saved: options.saved?.nodes ?? {},
    collapsed: collapsedGroupIds(m, options.saved),
  });
}

/** The box of a layout node: a table or note, or a collapsed group card. */
function boxOf(geo: DiagramGeometry, id: string): Box {
  const box = geo.nodes[id] ?? geo.groups[id];
  if (!box) throw new Error(`no box for ${id}`);
  return box;
}

/** Vertical offset between the two port rows of a ref (target minus source). */
function offset(geo: DiagramGeometry, e: LayoutEdge): number {
  const s = boxOf(geo, e.source);
  const t = boxOf(geo, e.target);
  return t.y + portY(e.targetRow, t.height) - (s.y + portY(e.sourceRow, s.height));
}

/** Offsets of every ref that is not a self ref, in model order. */
function offsets(m: DiagramModel, options: LayoutOptions = {}): number[] {
  const geo = layoutDiagramSync(m, { engine: 'dagre', ...options });
  return graphOf(m, options)
    .edges.filter((e) => e.source !== e.target)
    .map((e) => offset(geo, e));
}

/** Tables, notes and collapsed group cards of a geometry. */
function boxes(geo: DiagramGeometry): Array<Box & { id: string }> {
  return [...Object.values(geo.nodes), ...Object.values(geo.groups).filter((g) => g.collapsed)];
}

/** Smallest vertical gap between two boxes that overlap horizontally (Infinity when none do). */
function minVerticalGap(geo: DiagramGeometry): number {
  const all = boxes(geo);
  let min = Infinity;
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (a.x >= b.x + b.width || b.x >= a.x + a.width) continue;
      min = Math.min(min, a.y < b.y ? b.y - (a.y + a.height) : a.y - (b.y + b.height));
    }
  return min;
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Positions relative to the first node, so placements that were packed elsewhere compare. */
function relative(positions: Map<string, { x: number; y: number }>) {
  const [first] = positions.values();
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, p] of positions) out[id] = { x: p.x - first!.x, y: p.y - first!.y };
  return out;
}

function relativeGeo(geo: DiagramGeometry, ids: string[]) {
  return relative(new Map(ids.map((id) => [id, boxOf(geo, id)])));
}

/** dagre's own left-to-right placement of a flat component, and the post-pass applied to it. */
function alignedComponent(comp: LayoutGraph) {
  const raw = runDagre(comp, 'RIGHT', true);
  const aligned = new Map(Array.from(raw.positions, ([id, p]) => [id, { ...p }]));
  alignRows(comp, aligned, raw.centreX, raw.chains, { nodeGap: NODE_GAP, edgeGap: EDGE_GAP });
  return { raw, aligned };
}

/** The one connected component of `m` with refs, laid out as `alignedComponent` does. */
function rawAndAligned(m: DiagramModel) {
  const [comp, ...rest] = components(graphOf(m)).filter((c) => c.edges.length);
  if (!comp || rest.length) throw new Error('expected one component with refs');
  return { comp, ...alignedComponent(comp) };
}

/** mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random schema with the awkward cases: self refs, refs both ways, several refs between one
 * pair, composite refs, TableGroups (some collapsed through `saved`), sticky notes, wide tables.
 */
function awkwardSchema(
  seed: number,
  withGroups = true,
): { src: string; saved: LayoutOptions['saved'] } {
  const r = rng(seed);
  const n = 2 + Math.floor(r() * 13);
  const pick = (i: number) => {
    let j = Math.floor(r() * (n - 1));
    if (j >= i) j++;
    return j;
  };
  const lines: string[] = [];
  const refs: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(`Table t${i} {`, '  id int [pk]', '  k int');
    const plain = Math.floor(r() * 5);
    for (let c = 0; c < plain; c++)
      lines.push(`  ${r() < 0.2 ? 'a_much_longer_column_name' : 'c'}_${c} varchar`);
    const fks = Math.floor(r() * 3);
    for (let f = 0; f < fks; f++) {
      const j = pick(i);
      lines.push(`  t${j}_id_${f} int [ref: > t${j}.id]`);
      // Several refs to one parent.
      if (r() < 0.2) lines.push(`  t${j}_again_${f} int [ref: > t${j}.id]`);
      // Refs both ways.
      if (r() < 0.2 && !refs.includes(`Ref: t${j}.k > t${i}.id`))
        refs.push(`Ref: t${j}.k > t${i}.id`);
    }
    if (r() < 0.15) lines.push(`  parent_id int [ref: > t${i}.id]`);
    if (r() < 0.15) {
      const j = pick(i);
      lines.push('  ca int', '  cb int');
      refs.push(`Ref: t${i}.(ca, cb) > t${j}.(id, k)`);
    }
    lines.push('}');
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n && withGroups; i++) {
    if (r() >= 0.3) continue;
    const g = Math.floor(r() * 2);
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  const nodes: Record<string, NodeLayout> = {};
  for (const [g, members] of groups) {
    lines.push(`TableGroup g${g} {`, ...members.map((i) => `  t${i}`), '}');
    if (r() < 0.4) nodes[`group:g${g}`] = { collapsed: true } as NodeLayout;
  }
  if (r() < 0.5) lines.push('Note sticky {', "  'A sticky note next to the tables'", '}');
  return { src: [...lines, ...refs].join('\n'), saved: { nodes } };
}

describe('dagre row alignment', () => {
  it('puts the FK row of a child level with the key row of its parent', () => {
    const m = model(`
      Table users {
        id int [pk]
        name varchar
      }
      Table posts {
        id int [pk]
        title varchar
        body text
        author_id int [ref: > users.id]
      }`);
    expect(offsets(m)).toEqual([0]);
  });

  it('straightens every ref of a chain with FK rows at different depths', () => {
    const m = model(`
      Table a {
        id int [pk]
      }
      Table b {
        id int [pk]
        x varchar
        a_id int [ref: > a.id]
      }
      Table c {
        id int [pk]
        x varchar
        y varchar
        z varchar
        b_id int [ref: > b.id]
      }
      Table d {
        code varchar [pk]
        c_id int [ref: > c.id]
      }`);
    expect(offsets(m)).toEqual([0, 0, 0]);
  });

  it('lines up refs whose referenced column is not the first row', () => {
    const m = model(`
      Table accounts {
        id int [pk]
        name varchar
        email varchar [unique]
      }
      Table logins {
        id int
        at timestamp
        email varchar [ref: > accounts.email]
      }`);
    expect(offsets(m)).toEqual([0]);
  });

  it('at every detail level, header rows included', () => {
    const m = model(`
      Table users {
        id int [pk]
        name varchar
        bio text
      }
      Table posts {
        id int [pk]
        title varchar
        body text
        author_id int [ref: > users.id]
      }
      Table comments {
        id int [pk]
        text varchar
        post_id int [ref: > posts.id]
      }`);
    for (const detailLevel of ['all', 'keys', 'names'] as DetailLevel[])
      expect(offsets(m, { detailLevel }), detailLevel).toEqual([0, 0]);
  });

  it('keeps the children of one parent packed, the parent row between theirs', () => {
    const m = model(`
      Table parent {
        id int [pk]
      }
      Table one {
        id int [pk]
        p_id int [ref: > parent.id]
      }
      Table two {
        id int [pk]
        p_id int [ref: > parent.id]
      }`);
    const geo = layoutDiagramSync(m, { engine: 'dagre' });
    const [a, b] = offsets(m);
    // Both children cannot face the parent: the least total offset is the one the gap between
    // them forces, reached with the parent row anywhere between theirs.
    expect(Math.abs(a!) + Math.abs(b!)).toBe(Math.abs(b! - a!));
    expect(minVerticalGap(geo)).toBe(NODE_GAP);
  });

  it('ignores self refs', () => {
    const m = model(`
      Table departments {
        id int [pk]
        name varchar
      }
      Table employees {
        id int [pk]
        name varchar
        manager_id int [ref: > employees.id]
        department_id int [ref: > departments.id]
      }`);
    expect(offsets(m)).toEqual([0]);
  });

  it('refs both ways: one rank apart, the table between the two pulls', () => {
    const m = model(`
      Table a {
        id int [pk]
        x varchar
        b_id int [ref: > b.id]
      }
      Table b {
        id int [pk]
        x varchar
        y varchar
        z varchar
        a_id int [ref: > a.id]
      }
      Table c {
        id int [pk]
        a_id int [ref: > a.id]
      }`);
    const { comp, raw, aligned } = rawAndAligned(m);
    const rank = (id: string) => raw.centreX.get(`public.${id}`)!;
    expect(rank('a')).not.toBe(rank('b'));
    const geo = layoutDiagramSync(m, { engine: 'dagre' });
    const [ab, ba, ac] = comp.edges.map((e) => offset(geo, e));
    // ab + ba is fixed by the rows (each ref runs from one table's key row to the other's FK row),
    // so the least total offset is reached when neither ref goes the other way.
    expect(Math.abs(ab!) + Math.abs(ba!)).toBe(Math.abs(ab! + ba!));
    expect(ac).toBe(0);
    expect(relativeGeo(geo, Array.from(aligned.keys()))).toEqual(relative(aligned));
  });

  it('several refs between one pair: the key row between the FK rows', () => {
    const m = model(`
      Table addresses {
        id int [pk]
        street varchar
      }
      Table orders {
        id int [pk]
        billing_id int [ref: > addresses.id]
        placed_at timestamp
        total decimal
        shipping_id int [ref: > addresses.id]
      }`);
    const [billing, shipping] = offsets(m);
    expect(Math.abs(billing!) + Math.abs(shipping!)).toBe(Math.abs(shipping! - billing!));
  });

  it('a composite ref lines up the row of its first column', () => {
    const m = model(`
      Table regions {
        country varchar
        code varchar
        name varchar
        indexes {
          (country, code) [pk]
        }
      }
      Table stores {
        id int [pk]
        name varchar
        opened date
        region_country varchar
        region_code varchar
      }
      Ref: stores.(region_country, region_code) > regions.(country, code)`);
    expect(offsets(m)).toEqual([0]);
  });

  it('a ref to a collapsed group attaches at its header and is lined up too', () => {
    const m = model(`
      Table users {
        id int [pk]
        name varchar
      }
      Table profiles {
        id int [pk]
        user_id int [ref: > users.id]
      }
      Table posts {
        id int [pk]
        title varchar
        body text
        published boolean
        author_id int [ref: > users.id]
      }
      TableGroup people {
        users
        profiles
      }`);
    const saved = { nodes: { 'group:people': { collapsed: true } as NodeLayout } };
    const geo = layoutDiagramSync(m, { engine: 'dagre', saved });
    expect(geo.groups['group:people']?.collapsed).toBe(true);
    expect(offsets(m, { saved })).toEqual([0]);
  });

  it('lines up the members of a group; group boxes stay clear of other tables', () => {
    const m = model(`
      Table users {
        id int [pk]
        name varchar
      }
      Table posts {
        id int [pk]
        title varchar
        body text
        author_id int [ref: > users.id]
      }
      Table tags {
        id int [pk]
        post_id int [ref: > posts.id]
      }
      TableGroup content {
        users
        posts
      }`);
    const geo = layoutDiagramSync(m, { engine: 'dagre' });
    const [inside] = offsets(m);
    expect(inside).toBe(0);
    const box = geo.groups['group:content']!;
    expect(intersects(box, geo.nodes['public.tags']!)).toBe(false);
  });

  it('sticky notes change nothing', () => {
    const tables = `
      Table a {
        id int [pk]
      }
      Table b {
        id int [pk]
        x varchar
        a_id int [ref: > a.id]
      }`;
    const withNote = model(`${tables}
      Note hello {
        'Placed apart from the tables'
      }`);
    const ids = ['public.a', 'public.b'];
    expect(offsets(withNote)).toEqual([0]);
    expect(relativeGeo(layoutDiagramSync(withNote, { engine: 'dagre' }), ids)).toEqual(
      relativeGeo(layoutDiagramSync(model(tables), { engine: 'dagre' }), ids),
    );
  });

  it('moves tables only vertically and keeps every table in its rank', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = model(awkwardSchema(seed).src);
      for (const comp of components(graphOf(m)).filter((c) => c.edges.length && !c.groups.length)) {
        const { raw, aligned } = alignedComponent(comp);
        for (const [id, p] of aligned)
          expect(p.x, `seed ${seed} ${id}`).toBe(raw.positions.get(id)!.x);
        // Inside a rank: same column, at least NODE_GAP apart.
        const ranks = new Map<number, string[]>();
        for (const n of comp.nodes) {
          const cx = raw.centreX.get(n.id)!;
          ranks.set(cx, [...(ranks.get(cx) ?? []), n.id]);
        }
        for (const ids of ranks.values()) {
          const sorted = ids.sort((a, b) => aligned.get(a)!.y - aligned.get(b)!.y);
          for (let i = 1; i < sorted.length; i++) {
            const prev = comp.nodeById.get(sorted[i - 1]!)!;
            const gap = aligned.get(sorted[i]!)!.y - (aligned.get(prev.id)!.y + prev.height);
            expect(gap, `seed ${seed}`).toBeGreaterThanOrEqual(NODE_GAP);
          }
        }
      }
    }
  });

  it('leaves top-to-bottom layouts to dagre', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = model(awkwardSchema(seed).src);
      for (const comp of components(graphOf(m)).filter((c) => c.edges.length && !c.groups.length)) {
        // A model of just this component, so the packer moves nothing relative to dagre.
        const ids = new Set(comp.nodes.map((n) => n.id));
        const sub: DiagramModel = {
          ...m,
          tables: m.tables.filter((t) => ids.has(t.id)),
          refs: m.refs.filter((r) => ids.has(r.from.tableId) && ids.has(r.to.tableId)),
          stickyNotes: [],
          groups: [],
        };
        const geo = layoutDiagramSync(sub, { engine: 'dagre', direction: 'DOWN' });
        const raw = runDagre(comp, 'DOWN', false);
        expect(relativeGeo(geo, Array.from(raw.positions.keys())), `seed ${seed}`).toEqual(
          relative(raw.positions),
        );
      }
    }
  });

  // Seeded schemas laid out twice: ~2 s locally, ~8 s on a GitHub-hosted Windows runner.
  it('never overlaps tables, notes or groups, and is deterministic', { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 80; seed++) {
      const { src, saved } = awkwardSchema(seed);
      const m = model(src);
      for (const direction of ['RIGHT', 'DOWN'] as const)
        for (const detailLevel of ['all', 'names'] as DetailLevel[]) {
          const options: LayoutOptions = { engine: 'dagre', direction, detailLevel, saved };
          const geo = layoutDiagramSync(m, options);
          const label = `seed ${seed} ${direction} ${detailLevel}`;
          expect(minVerticalGap(geo), label).toBeGreaterThanOrEqual(NODE_GAP);
          const all = boxes(geo);
          for (const g of Object.values(geo.groups)) {
            if (g.collapsed) continue;
            const members = new Set(m.tables.filter((t) => t.groupId === g.id).map((t) => t.id));
            for (const b of all)
              if (!members.has(b.id)) expect(intersects(g, b), label).toBe(false);
          }
          expect(layoutDiagramSync(m, options), label).toEqual(geo);
        }
    }
  });

  it('straightens refs of random schemas and never runs away', { timeout: 30_000 }, () => {
    let straight = 0;
    let straightBefore = 0;
    let sum = 0;
    let sumBefore = 0;
    let total = 0;
    const extent = (comp: LayoutGraph, pos: Map<string, { x: number; y: number }>) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of comp.nodes) {
        lo = Math.min(lo, pos.get(n.id)!.y);
        hi = Math.max(hi, pos.get(n.id)!.y + n.height);
      }
      return hi - lo;
    };
    for (let seed = 1; seed <= 100; seed++) {
      const m = model(awkwardSchema(seed, false).src);
      for (const comp of components(graphOf(m)).filter((c) => c.edges.length)) {
        const { raw, aligned } = alignedComponent(comp);
        // Line clearance once pinned line ends thousands of units away; lining up rows can grow
        // a component's height, but not without bound.
        expect(extent(comp, aligned), `seed ${seed}`).toBeLessThan(3 * extent(comp, raw.positions));
        for (const e of comp.edges) {
          if (e.source === e.target) continue;
          const s = comp.nodeById.get(e.source)!;
          const t = comp.nodeById.get(e.target)!;
          const dy = (pos: Map<string, { x: number; y: number }>) =>
            Math.abs(
              pos.get(t.id)!.y +
                portY(e.targetRow, t.height) -
                pos.get(s.id)!.y -
                portY(e.sourceRow, s.height),
            );
          total++;
          sum += dy(aligned);
          sumBefore += dy(raw.positions);
          if (dy(aligned) === 0) straight++;
          if (dy(raw.positions) === 0) straightBefore++;
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
    // dagre alone lines up almost no ref; dense schemas leave many refs that cannot all be
    // straight, so the total offset shrinks less than the count of straight refs grows.
    expect(straight).toBeGreaterThan(straightBefore * 10);
    expect(sum).toBeLessThan(sumBefore * 0.95);
  });
});
