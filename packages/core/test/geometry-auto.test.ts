// engine 'auto' (docs/design/phase3-v1.md §3.3): dagre for small components without groups, ELK
// for the rest, and elkjs is never loaded when no component needs it. Kept in its own file because
// it wraps the elkjs module to count imports and layouts (vitest isolates modules per file).
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_DAGRE_MAX_NODES,
  compileDbml,
  layoutDiagram,
  layoutDiagramSync,
  needsElk,
  type DiagramModel,
  type NodeLayout,
} from '../src/index.js';

const elk = vi.hoisted(() => ({ imports: 0, layouts: 0 }));

vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  elk.imports++;
  const mod = await importOriginal<Record<string, unknown>>();
  let Real: unknown = mod;
  while (typeof Real !== 'function') Real = (Real as { default: unknown }).default;
  const Base = Real as new () => { layout(g: unknown): Promise<unknown> };
  class Counting extends Base {
    override layout(g: unknown) {
      elk.layouts++;
      return super.layout(g);
    }
  }
  return { default: Counting };
});

const example = (name: string): DiagramModel => {
  const src = readFileSync(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');
  return compileDbml(src).model!;
};

/** `count` disconnected chains of `n` tables each (t0 <- t1 <- ...). */
function chains(n: number, count = 1, prefix = 'c'): DiagramModel {
  const lines: string[] = [];
  for (let c = 0; c < count; c++)
    for (let i = 0; i < n; i++) {
      lines.push(`Table ${prefix}${c}_t${i} {`, '  id int [pk]');
      if (i) lines.push(`  parent_id int [ref: > ${prefix}${c}_t${i - 1}.id]`);
      lines.push('}');
    }
  return compileDbml(lines.join('\n')).model!;
}

describe('engine auto', () => {
  beforeEach(() => {
    elk.layouts = 0;
  });

  // Must run first: nothing in this file has loaded elkjs yet.
  it('small components never import elkjs and equal the dagre layout', async () => {
    for (const model of [
      example('01-minimal.dbml'),
      example('03-enums-and-notes.dbml'),
      example('04-indexes-and-checks.dbml'),
      example('06-header-colors.dbml'),
      example('07-sticky-notes.dbml'),
      example('09-table-partials.dbml'),
      example('10-records.dbml'),
      chains(AUTO_DAGRE_MAX_NODES, 3),
    ]) {
      expect(needsElk(model)).toBe(false);
      const geo = await layoutDiagram(model, { engine: 'auto' });
      expect(geo).toEqual(layoutDiagramSync(model, { engine: 'dagre' }));
      expect(geo.edges).toEqual({});
    }
    expect(elk.imports).toBe(0);
    expect(elk.layouts).toBe(0);
  });

  it('AUTO_DAGRE_MAX_NODES is a small positive integer', () => {
    expect(Number.isInteger(AUTO_DAGRE_MAX_NODES)).toBe(true);
    expect(AUTO_DAGRE_MAX_NODES).toBeGreaterThanOrEqual(1);
  });

  it('needsElk: true for a component above the threshold or with a group', () => {
    expect(needsElk(chains(AUTO_DAGRE_MAX_NODES + 1))).toBe(true);
    expect(needsElk(chains(AUTO_DAGRE_MAX_NODES, 4))).toBe(false);
    expect(needsElk(example('14-large.dbml'))).toBe(true);
    // 05-table-groups: groups force ELK whatever the size.
    const grouped = compileDbml(`
Table a { id int [pk] }
Table b { id int [pk]
  a_id int [ref: > a.id] }
TableGroup g { a
  b }`).model!;
    expect(needsElk(grouped)).toBe(true);
    // A group without refs is placed on a grid: no ELK.
    const noRefs = compileDbml(`
Table a { id int [pk] }
Table b { id int [pk] }
TableGroup g { a
  b }`).model!;
    expect(needsElk(noRefs)).toBe(false);
    // options.engine is ignored: needsElk answers for 'auto'.
    expect(needsElk(chains(2), { engine: 'elk' })).toBe(false);
  });

  it('needsElk: saved positions and collapsed groups shrink the free components', () => {
    const big = chains(AUTO_DAGRE_MAX_NODES + 2);
    const saved: Record<string, NodeLayout> = {};
    // Fix every second table: the free tables have no refs between them.
    big.tables.forEach((t, i) => {
      if (i % 2) saved[t.id] = { x: i * 300, y: 0 };
    });
    expect(needsElk(big, { saved: { nodes: saved } })).toBe(false);

    const grouped = compileDbml(`
Table a { id int [pk] }
Table b { id int [pk]
  a_id int [ref: > a.id] }
Table c { id int [pk]
  b_id int [ref: > b.id] }
TableGroup g { a
  b }`).model!;
    expect(needsElk(grouped)).toBe(true);
    // Collapsed, the group is one node: component {group:g, c}, no group with members.
    const collapsed = { nodes: { 'group:g': { collapsed: true } as NodeLayout } };
    expect(needsElk(grouped, { saved: collapsed })).toBe(false);
  });

  it('mixes engines per component: ELK only where needed', async () => {
    const small = chains(2, 2, 's');
    const large = chains(AUTO_DAGRE_MAX_NODES + 1);
    const model: DiagramModel = {
      ...large,
      tables: [...large.tables, ...small.tables],
      refs: [...large.refs, ...small.refs],
    };
    expect(needsElk(model)).toBe(true);
    const geo = await layoutDiagram(model, { engine: 'auto' });
    expect(elk.imports).toBe(1);
    expect(elk.layouts).toBe(1); // one ELK run, for the large chain only
    const routed = new Set(Object.keys(geo.edges));
    for (const r of large.refs) expect(routed.has(r.id)).toBe(true);
    for (const r of small.refs) expect(routed.has(r.id)).toBe(false);
    expect(Object.keys(geo.nodes)).toHaveLength(model.tables.length);
    // Deterministic.
    expect(JSON.stringify(await layoutDiagram(structuredClone(model), { engine: 'auto' }))).toBe(
      JSON.stringify(geo),
    );
  });

  it('the default engine of layoutDiagram stays elk', async () => {
    const model = example('01-minimal.dbml');
    const geo = await layoutDiagram(model);
    expect(elk.layouts).toBe(1);
    expect(Object.keys(geo.edges)).toHaveLength(1);
    expect(geo).toEqual(await layoutDiagram(model, { engine: 'elk' }));
  });

  it('layoutDiagramSync treats auto as dagre', () => {
    const model = example('02-ecommerce.dbml');
    expect(layoutDiagramSync(model, { engine: 'auto' })).toEqual(layoutDiagramSync(model));
  });
});
