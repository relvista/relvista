// Measurement behind AUTO_DAGRE_MAX_NODES (docs/design/phase3-v1.md §3.3, decision 0003).
// Not part of `pnpm test` (vitest only collects *.test.ts there). Run it with
//   pnpm --filter @relvista/core exec vitest bench --run --reporter=verbose test/engine-auto.bench.ts
// It prints the quality table (dagre vs ELK per connected component) and benches both engines.
//
// Quality is compared on the placement each engine produces, with every ref drawn as a straight
// segment between its port points (left/right border facing the other table, at the column row),
// the stand-in for the renderer's router until it lands (§4.1):
//   (a) crossings between ref segments that share no table,
//   (b) total segment length,
//   (c) bounding-box area,
//   (d) segment / unrelated-table intersections.
// A case passes when dagre is within 5 % of ELK on (a)-(c) and not worse on (d).
// The §3.3 rule takes the largest component size n such that the components of every size up to
// n pass in >= 95 % of cases. (b) fails for most components of every size, two tables included
// (dagre has no ports and does not align column rows), so AUTO_DAGRE_MAX_NODES is taken from
// (a)+(c)+(d) instead; both values are printed. See docs/decisions/0003-viewer-bundle.md.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import {
  AUTO_DAGRE_MAX_NODES,
  compileDbml,
  estimateTextWidth,
  layoutDiagram,
  type CompileInput,
  type DiagramGeometry,
  type DiagramModel,
} from '../src/index.js';
import { portY, prepareGraph, type LayoutGraph } from '../src/geometry/layout-graph.js';

interface Pt {
  x: number;
  y: number;
}
interface Seg {
  a: Pt;
  b: Pt;
  from: string;
  to: string;
}
interface Metrics {
  crossings: number;
  length: number;
  area: number;
  underTables: number;
}

const examplesDir = fileURLToPath(new URL('../../../examples/', import.meta.url));

function collectDbml(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.dbml'))
        files[relative(dir, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

function loadExamples(): Array<[string, DiagramModel]> {
  const out: Array<[string, DiagramModel]> = [];
  for (const name of readdirSync(examplesDir).sort()) {
    const full = join(examplesDir, name);
    let input: CompileInput;
    if (statSync(full).isDirectory()) input = { files: collectDbml(full), entry: 'main.dbml' };
    else if (name.endsWith('.dbml')) input = readFileSync(full, 'utf8');
    else continue;
    const { model } = compileDbml(input);
    if (model) out.push([name, model]);
  }
  return out;
}

/** mulberry32: small seeded PRNG. */
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

const WORDS = ['name', 'status', 'created_at', 'amount', 'title', 'description', 'kind', 'code'];
const TYPES = ['varchar', 'int', 'timestamp', 'text', 'decimal(10,2)', 'boolean'];

/** A random schema: 2-20 tables, 0-2 refs per table, 1-4 plain columns per table. */
function randomSchema(seed: number): string {
  const r = rng(seed);
  const n = 2 + Math.floor(r() * 19);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(`Table t${i} {`, '  id int [pk]');
    const plain = 1 + Math.floor(r() * 4);
    for (let k = 0; k < plain; k++)
      lines.push(`  ${WORDS[Math.floor(r() * WORDS.length)]}_${k} ${TYPES[Math.floor(r() * 6)]}`);
    const refs = Math.floor(r() * 3);
    for (let k = 0; k < refs; k++) {
      let j = Math.floor(r() * (n - 1));
      if (j >= i) j++;
      lines.push(`  t${j}_id_${k} int [ref: > t${j}.id]`);
    }
    lines.push('}', '');
  }
  return lines.join('\n');
}

/** Connected components of a model by refs (tables only, groups dropped), as sub-models. */
function componentModels(model: DiagramModel): DiagramModel[] {
  const parent = new Map(model.tables.map((t) => [t.id, t.id]));
  const find = (id: string): string => {
    while (parent.get(id) !== id) id = parent.get(id)!;
    return id;
  };
  for (const ref of model.refs)
    if (parent.has(ref.from.tableId) && parent.has(ref.to.tableId)) {
      const a = find(ref.from.tableId);
      const b = find(ref.to.tableId);
      if (a !== b) parent.set(b, a);
    }
  const byRoot = new Map<string, Set<string>>();
  for (const t of model.tables) {
    const root = find(t.id);
    if (!byRoot.has(root)) byRoot.set(root, new Set());
    byRoot.get(root)!.add(t.id);
  }
  return Array.from(byRoot.values())
    .filter((ids) => ids.size > 1)
    .map((ids) => ({
      ...model,
      tables: model.tables.filter((t) => ids.has(t.id)),
      refs: model.refs.filter((r) => ids.has(r.from.tableId) && ids.has(r.to.tableId)),
      stickyNotes: [],
      groups: model.groups.filter((g) =>
        model.tables.some((t) => ids.has(t.id) && t.groupId === g.id),
      ),
    }));
}

function segments(graph: LayoutGraph, geo: DiagramGeometry): Seg[] {
  const out: Seg[] = [];
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    const s = geo.nodes[e.source]!;
    const t = geo.nodes[e.target]!;
    const right = t.x + t.width / 2 >= s.x + s.width / 2;
    out.push({
      a: { x: right ? s.x + s.width : s.x, y: s.y + portY(e.sourceRow, s.height) },
      b: { x: right ? t.x : t.x + t.width, y: t.y + portY(e.targetRow, t.height) },
      from: e.source,
      to: e.target,
    });
  }
  return out;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Proper intersection of two segments (touching endpoints do not count). */
function intersects(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const d1 = cross(r, s, p);
  const d2 = cross(r, s, q);
  const d3 = cross(p, q, r);
  const d4 = cross(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Whether a segment passes through the interior of a box (shrunk by 1 unit). */
function hitsBox(a: Pt, b: Pt, box: { x: number; y: number; width: number; height: number }) {
  const x0 = box.x + 1;
  const y0 = box.y + 1;
  const x1 = box.x + box.width - 1;
  const y1 = box.y + box.height - 1;
  // Liang-Barsky clipping.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - x0) &&
    clip(dx, x1 - a.x) &&
    clip(-dy, a.y - y0) &&
    clip(dy, y1 - a.y) &&
    t0 < t1
  );
}

function measureGeometry(model: DiagramModel, geo: DiagramGeometry): Metrics {
  const graph = prepareGraph(model, { detailLevel: 'all', measure: estimateTextWidth, saved: {} });
  const segs = segments(graph, geo);
  let crossings = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      if (s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue;
      if (intersects(s.a, s.b, t.a, t.b)) crossings++;
    }
  let length = 0;
  let underTables = 0;
  for (const s of segs) {
    length += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    for (const n of Object.values(geo.nodes))
      if (n.id !== s.from && n.id !== s.to && hitsBox(s.a, s.b, n)) underTables++;
  }
  // Bounds without ELK's route points, so both engines are measured on the same thing.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of [...Object.values(geo.nodes), ...Object.values(geo.groups)]) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { crossings, length, area: (maxX - minX) * (maxY - minY), underTables };
}

const within = (d: number, e: number) => d <= e * 1.05 + 1e-9;

/** (a), (c) and (d) only: dagre has no ports, so (b) fails structurally (decision 0003). */
const passWithoutLength = (c: Case) =>
  within(c.dagre.crossings, c.elk.crossings) &&
  within(c.dagre.area, c.elk.area) &&
  c.dagre.underTables <= c.elk.underTables;

interface Case {
  source: string;
  size: number;
  groups: boolean;
  dagre: Metrics;
  elk: Metrics;
  pass: boolean;
}

async function measureCases(): Promise<Case[]> {
  const inputs: Array<[string, DiagramModel]> = loadExamples();
  for (let seed = 1; seed <= 200; seed++) {
    const { model } = compileDbml(randomSchema(seed));
    if (!model) throw new Error(`random schema ${seed} does not compile`);
    inputs.push([`random-${seed}`, model]);
  }
  const cases: Case[] = [];
  for (const [source, model] of inputs)
    for (const comp of componentModels(model)) {
      const dagre = measureGeometry(comp, await layoutDiagram(comp, { engine: 'dagre' }));
      const elk = measureGeometry(comp, await layoutDiagram(comp, { engine: 'elk' }));
      const pass =
        within(dagre.crossings, elk.crossings) &&
        within(dagre.length, elk.length) &&
        within(dagre.area, elk.area) &&
        dagre.underTables <= elk.underTables;
      cases.push({
        source,
        size: comp.tables.length,
        groups: comp.groups.length > 0,
        dagre,
        elk,
        pass,
      });
    }
  return cases;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const ratio = (d: number, e: number) => (e === 0 ? (d === 0 ? 1 : Infinity) : d / e);

function report(cases: Case[]): void {
  const flat = cases.filter((c) => !c.groups);
  const sizes = Array.from(new Set(flat.map((c) => c.size))).sort((a, b) => a - b);
  const rows: string[] = [
    '| nodes | cases | pass | cum. pass | crossings d/e (med) | length d/e (med) | area d/e (med) | under tables d>e |',
    '| ----- | ----- | ---- | --------- | ------------------- | ---------------- | -------------- | ---------------- |',
  ];
  let chosen = 1;
  let ok = true;
  for (const n of sizes) {
    const at = flat.filter((c) => c.size === n);
    const upTo = flat.filter((c) => c.size <= n);
    const passAt = at.filter((c) => c.pass).length / at.length;
    const passUpTo = upTo.filter((c) => c.pass).length / upTo.length;
    if (ok && passUpTo >= 0.95) chosen = n;
    else ok = false;
    const crossMed = median(at.map((c) => c.dagre.crossings - c.elk.crossings));
    rows.push(
      `| ${n} | ${at.length} | ${(passAt * 100).toFixed(0)} % | ${(passUpTo * 100).toFixed(0)} % | ` +
        `${median(at.map((c) => ratio(c.dagre.crossings, c.elk.crossings))).toFixed(2)} (Δ ${crossMed}) | ` +
        `${median(at.map((c) => c.dagre.length / c.elk.length)).toFixed(2)} | ` +
        `${median(at.map((c) => c.dagre.area / c.elk.area)).toFixed(2)} | ` +
        `${at.filter((c) => c.dagre.underTables > c.elk.underTables).length} |`,
    );
  }
  const crit = (n: number) => {
    const upTo = flat.filter((c) => c.size <= n);
    const share = (f: (c: Case) => boolean) =>
      `${((upTo.filter(f).length / upTo.length) * 100).toFixed(0)} %`;
    return (
      `| ${n} | ${share((c) => within(c.dagre.crossings, c.elk.crossings))} | ` +
      `${share((c) => within(c.dagre.length, c.elk.length))} | ` +
      `${share((c) => within(c.dagre.area, c.elk.area))} | ` +
      `${share((c) => c.dagre.underTables <= c.elk.underTables)} | ` +
      `${share(passWithoutLength)} |`
    );
  };
  rows.push(
    '',
    'Per criterion, components of up to n nodes: share of cases where dagre is within 5 % / not worse',
    '| n | (a) crossings | (b) length | (c) area | (d) under tables | (a)+(c)+(d) |',
    '| - | ------------- | ---------- | -------- | ---------------- | ----------- |',
    ...sizes.filter((n) => n <= 10).map(crit),
  );
  let relaxed = 1;
  for (const n of sizes) {
    const upTo = flat.filter((c) => c.size <= n);
    if (upTo.filter(passWithoutLength).length / upTo.length < 0.95) break;
    relaxed = n;
  }
  const grouped = cases.filter((c) => c.groups);
  console.log(
    [
      `engine-auto: ${cases.length} components (${flat.length} without groups, ${grouped.length} with)`,
      ...rows,
      `largest n with cumulative pass >= 95 % on (a)-(d): ${chosen}`,
      `largest n with cumulative pass >= 95 % on (a)+(c)+(d): ${relaxed}`,
      `AUTO_DAGRE_MAX_NODES = ${AUTO_DAGRE_MAX_NODES}`,
      `components with groups (always ELK): pass ${grouped.filter((c) => c.pass).length}/${grouped.length}`,
    ].join('\n'),
  );
}

const cases = await measureCases();
report(cases);

const examples = loadExamples();
const ecommerce = examples.find(([n]) => n === '02-ecommerce.dbml')![1];
const small = compileDbml(randomSchema(7)).model!;

for (const [name, model] of [
  ['02-ecommerce', ecommerce],
  ['random-7', small],
] as const) {
  test(`layout time: ${name}`, async ({ bench }) => {
    await bench.compare(
      bench(`${name} dagre`, async () => {
        await layoutDiagram(model, { engine: 'dagre' });
      }),
      bench(`${name} elk`, async () => {
        await layoutDiagram(model, { engine: 'elk' });
      }),
    );
  });
}
