import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_VIEW, compileDbml, emptyLayout, type Layout } from '@relvista/core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DEFINITION,
  addToViewOp,
  contentChanged,
  createOp,
  definitionFromSelection,
  filterViews,
  layoutAfterViewOps,
  nextViewName,
  removeFromViewOp,
  updateOp,
  viewAfterOps,
  viewDefinition,
  viewNameProblem,
  type ViewDefinition,
} from '../src/diagram/views.js';
import { freeSpot, obstaclesOf } from '../src/diagram/placement.js';
import { applyToTexts, syncViews, type ViewOp } from '../src/edits/dbmlEdits.js';
import { EXAMPLES_DIR } from './helpers.js';

const text = readFileSync(join(EXAMPLES_DIR, '08-diagram-views.dbml'), 'utf8');
const files = { 'main.dbml': text };
const model = compileDbml({ files, entry: 'main.dbml' }).model!;

/** Applies ops through the real edit helpers and recompiles. */
function apply(ops: ViewOp[], f: Record<string, string> = files) {
  const edits = syncViews({ files: f, entry: 'main.dbml' }, ops);
  expect(edits.length).toBeGreaterThan(0);
  const next = applyToTexts(f, edits);
  const m = compileDbml({ files: next, entry: 'main.dbml' });
  expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return { files: next, model: m.model! };
}

function layoutWithViews(...names: string[]): Layout {
  const l = emptyLayout();
  l.views['*']!.nodes['public.users'] = { x: 1, y: 2 };
  for (const [i, n] of names.entries())
    l.views[n] = { nodes: { 'public.users': { x: 10 * (i + 1), y: 5 } } };
  return l;
}

describe('views manager: layout follows the views', () => {
  it('rename moves the layout view entry to the new name', () => {
    const l = layoutWithViews('sales_view', 'mixed_view');
    const ops: ViewOp[] = [{ op: 'update', name: 'sales_view', newName: 'sales' }];
    const next = layoutAfterViewOps(l, ops)!;
    expect(Object.keys(next.views).sort()).toEqual(['*', 'mixed_view', 'sales']);
    expect(next.views.sales).toBe(l.views.sales_view);
    expect(next.views['*']).toBe(l.views['*']);
    expect(l.views.sales_view).toBeDefined(); // input untouched
    expect(viewAfterOps('sales_view', ops)).toBe('sales');
    expect(viewAfterOps('mixed_view', ops)).toBe('mixed_view');
  });
  it('delete removes the layout view entry; the open view falls back to all tables', () => {
    const l = layoutWithViews('sales_view', 'mixed_view');
    const ops: ViewOp[] = [{ op: 'delete', name: 'mixed_view' }];
    const next = layoutAfterViewOps(l, ops)!;
    expect(Object.keys(next.views).sort()).toEqual(['*', 'sales_view']);
    expect(viewAfterOps('mixed_view', ops)).toBe(DEFAULT_VIEW);
    expect(viewAfterOps('sales_view', ops)).toBe('sales_view');
  });
  it('content updates, creates and views without a layout entry keep the same layout object', () => {
    const l = layoutWithViews('sales_view');
    expect(layoutAfterViewOps(l, [{ op: 'update', name: 'sales_view', tables: '*' }])).toBe(l);
    expect(layoutAfterViewOps(l, [{ op: 'create', name: 'x', tables: [] }])).toBe(l);
    expect(layoutAfterViewOps(l, [{ op: 'delete', name: 'empty_view' }])).toBe(l);
    expect(layoutAfterViewOps(null, [{ op: 'delete', name: 'sales_view' }])).toBeNull();
  });
  it("a view's own detail level follows a rename and goes with a delete", () => {
    // Only settings, no `views` entry: the level still follows.
    const l = {
      ...emptyLayout(),
      settings: {
        detailLevel: 'keys' as const,
        'x-relvista-view-settings': {
          sales_view: { detailLevel: 'names' as const },
          mixed_view: { detailLevel: 'all' as const },
        },
      },
    };
    const renamed = layoutAfterViewOps(l, [
      { op: 'update', name: 'sales_view', newName: 'sales' },
    ])!;
    expect(renamed.settings).toEqual({
      detailLevel: 'keys',
      'x-relvista-view-settings': {
        sales: { detailLevel: 'names' },
        mixed_view: { detailLevel: 'all' },
      },
    });
    expect(renamed.views).toBe(l.views);
    const deleted = layoutAfterViewOps(renamed, [
      { op: 'delete', name: 'sales' },
      { op: 'delete', name: 'mixed_view' },
    ])!;
    expect(deleted.settings).toEqual({ detailLevel: 'keys' });
  });
  it('rename then delete in one batch', () => {
    const l = layoutWithViews('a', 'b');
    const ops: ViewOp[] = [
      { op: 'update', name: 'a', newName: 'c' },
      { op: 'delete', name: 'b' },
    ];
    expect(Object.keys(layoutAfterViewOps(l, ops)!.views).sort()).toEqual(['*', 'c']);
  });
});

describe('views manager: names and filter', () => {
  it('next name, problems', () => {
    expect(nextViewName([])).toBe('view_1');
    expect(nextViewName([{ name: 'view_1' }, { name: 'VIEW_2' }])).toBe('view_3');
    expect(viewNameProblem('', model.views)).toMatch(/name/);
    expect(viewNameProblem('two words', model.views)).toMatch(/letters/);
    expect(viewNameProblem('1st', model.views)).toMatch(/letters/);
    expect(viewNameProblem('Sales_View', model.views)).toMatch(/exists/);
    expect(viewNameProblem('sales_view', model.views, 'sales_view')).toBeNull(); // unchanged
    expect(viewNameProblem('billing', model.views)).toBeNull();
  });
  it('filters by every word, any case', () => {
    const views = Array.from({ length: 10 }, (_, i) => ({ name: `team_${i}_view` }));
    expect(filterViews(views, '')).toHaveLength(10);
    expect(filterViews(views, 'TEAM_3').map((v) => v.name)).toEqual(['team_3_view']);
    expect(filterViews(views, 'view 7').map((v) => v.name)).toEqual(['team_7_view']);
    expect(filterViews(views, 'nope')).toEqual([]);
  });
});

describe('views manager: definitions as written', () => {
  it('reads each example view', () => {
    const full = viewDefinition(files, model, 'full_view');
    expect(full.allTables).toBe(true);
    expect(full.allNotes).toBe(true);
    expect(viewDefinition(files, model, 'empty_view')).toEqual(EMPTY_DEFINITION);
    const sales = viewDefinition(files, model, 'sales_view');
    expect(sales.allTables).toBe(false);
    expect(sales.tables).toEqual([
      'public.users',
      'public.orders',
      'public.products',
      'public.order_items',
    ]);
    const mixed = viewDefinition(files, model, 'mixed_view');
    expect(mixed.allTables).toBe(true);
    expect(mixed.notes).toEqual(['note:reminder_note']);
    const internal = viewDefinition(files, model, 'internal_view');
    expect(internal.allTables).toBe(false);
    expect(internal.schemas).toEqual(['core', 'analytics']);
    expect(internal.tables).toEqual([]);
    expect(internal.notes).toEqual(['note:core_note']);
    expect(viewDefinition(files, model, 'missing')).toEqual(EMPTY_DEFINITION);
  });
  it('reads TableGroups lists (14-large)', () => {
    const large = readFileSync(join(EXAMPLES_DIR, '14-large.dbml'), 'utf8');
    const f = { 'main.dbml': large };
    const m = compileDbml({ files: f, entry: 'main.dbml' }).model!;
    const d = viewDefinition(f, m, 'work_and_identity');
    expect(d.allTables).toBe(false);
    expect(d.groups).toEqual(['group:work', 'group:identity']);
    expect(d.tables).toEqual([]);
  });
});

describe('views manager: ops', () => {
  it('create from selection writes a view showing exactly the selection', () => {
    const d = definitionFromSelection(model, ['public.users', 'note:core_note', 'group:group_2']);
    expect(d).toEqual({
      ...EMPTY_DEFINITION,
      tables: ['public.users'],
      groups: ['group:group_2'],
      notes: ['note:core_note'],
    });
    const r = apply([createOp(' picked ', d)]);
    const v = r.model.views.find((x) => x.name === 'picked')!;
    expect(v.tableIds.sort()).toEqual(
      ['public.order_items', 'public.products', 'public.users'].sort(),
    );
    expect(v.noteIds).toEqual(['note:core_note']);
    expect(viewDefinition(r.files, r.model, 'picked')).toEqual(d);
  });
  it('a rename alone changes only the name; unchanged content is no op', () => {
    const before = viewDefinition(files, model, 'mixed_view');
    expect(updateOp('mixed_view', before, 'mixed_view', before)).toBeNull();
    const op = updateOp('mixed_view', before, 'mixed', before)!;
    expect(op).toEqual({ op: 'update', name: 'mixed_view', newName: 'mixed' });
    const r = apply([op]);
    const was = model.views.find((x) => x.name === 'mixed_view')!;
    const now = r.model.views.find((x) => x.name === 'mixed')!;
    expect(r.model.views.some((x) => x.name === 'mixed_view')).toBe(false);
    expect(now.tableIds).toEqual(was.tableIds);
    expect(now.noteIds).toEqual(was.noteIds);
    // Text outside the view block is untouched.
    const start = text.indexOf('DiagramView mixed_view');
    expect(r.files['main.dbml']!.startsWith(text.slice(0, start))).toBe(true);
  });
  it('an edit writes the whole definition', () => {
    const before = viewDefinition(files, model, 'sales_view');
    const after: ViewDefinition = {
      ...before,
      tables: ['public.users'],
      notes: ['note:reminder_note'],
    };
    expect(contentChanged(before, after)).toBe(true);
    const r = apply([updateOp('sales_view', before, 'sales_view', after)!]);
    const v = r.model.views.find((x) => x.name === 'sales_view')!;
    expect(v.tableIds).toEqual(['public.users']);
    expect(v.noteIds).toEqual(['note:reminder_note']);
    const all = apply([
      updateOp('sales_view', before, 'sales_view', { ...before, allTables: true })!,
    ]);
    expect(all.model.views.find((x) => x.name === 'sales_view')!.allTables).toBe(true);
  });
  it('add to view: tables, groups and notes not shown yet', () => {
    const d = viewDefinition(files, model, 'sales_view');
    expect(addToViewOp(model, d, 'sales_view', ['public.users'])).toBeNull(); // already there
    const op = addToViewOp(model, d, 'sales_view', ['core.feature_flags', 'note:core_note'])!;
    const r = apply([op]);
    const v = r.model.views.find((x) => x.name === 'sales_view')!;
    expect(v.tableIds).toContain('core.feature_flags');
    expect(v.tableIds).toContain('public.users');
    expect(v.noteIds).toEqual(['note:core_note']);
    // An all-tables view only takes the note.
    const full = viewDefinition(files, model, 'mixed_view');
    expect(addToViewOp(model, full, 'mixed_view', ['public.users'])).toBeNull();
    expect(addToViewOp(model, full, 'mixed_view', ['note:core_note'])).toEqual({
      op: 'update',
      name: 'mixed_view',
      notes: ['note:reminder_note', 'note:core_note'],
    });
  });
  it('remove from view: listed tables, tables through * / schemas, notes', () => {
    const sales = viewDefinition(files, model, 'sales_view');
    const r1 = apply([removeFromViewOp(model, sales, 'sales_view', ['public.orders'])!]);
    expect(r1.model.views.find((x) => x.name === 'sales_view')!.tableIds).toEqual([
      'public.users',
      'public.products',
      'public.order_items',
    ]);
    // Shown through `*`: the view becomes an explicit list without the table.
    const mixed = viewDefinition(files, model, 'mixed_view');
    const r2 = apply([removeFromViewOp(model, mixed, 'mixed_view', ['public.users'])!]);
    const v2 = r2.model.views.find((x) => x.name === 'mixed_view')!;
    expect(v2.allTables).toBe(false);
    expect(v2.tableIds).not.toContain('public.users');
    expect(v2.tableIds).toHaveLength(model.tables.length - 1);
    // Shown through a schema.
    const internal = viewDefinition(files, model, 'internal_view');
    const r3 = apply([
      removeFromViewOp(model, internal, 'internal_view', ['core.audit_events', 'note:core_note'])!,
    ]);
    const v3 = r3.model.views.find((x) => x.name === 'internal_view')!;
    expect(v3.tableIds.sort()).toEqual(['analytics.daily_sales', 'core.feature_flags']);
    expect(v3.noteIds).toEqual([]);
    // Not in the view: nothing to do.
    expect(removeFromViewOp(model, sales, 'sales_view', ['core.feature_flags'])).toBeNull();
    expect(removeFromViewOp(model, sales, 'nope', ['public.users'])).toBeNull();
  });
});

describe('new note placement', () => {
  const size = { width: 220, height: 64 };
  const table = { x: 0, y: 0, width: 200, height: 120 };
  it('keeps a free point, moves off a table to the nearest free spot', () => {
    expect(freeSpot({ x: 400, y: 400 }, size, [table])).toEqual({ x: 400, y: 400 });
    const p = freeSpot({ x: 10, y: 10 }, size, [table]);
    const clear =
      p.x >= table.x + table.width + 16 ||
      p.x + size.width + 16 <= table.x ||
      p.y >= table.y + table.height + 16 ||
      p.y + size.height + 16 <= table.y;
    expect(clear).toBe(true);
    expect(Math.hypot(p.x - 10, p.y - 10)).toBeLessThan(260);
  });
  it('prefers spots inside the visible box; collapsed group cards are obstacles', () => {
    const within = { x: -50, y: -50, width: 600, height: 400 };
    const p = freeSpot({ x: 10, y: 10 }, size, [table], within);
    expect(p.x >= within.x && p.y >= within.y).toBe(true);
    expect(p.x + size.width <= within.x + within.width).toBe(true);
    const geometry = {
      nodes: { 'public.a': { id: 'public.a', kind: 'table' as const, ...table } },
      groups: {
        'group:g': { id: 'group:g', x: 500, y: 0, width: 100, height: 50, collapsed: true },
        'group:h': { id: 'group:h', x: -500, y: -500, width: 2000, height: 2000 },
      },
      edges: {},
      bounds: { x: 0, y: 0, width: 600, height: 120 },
    };
    expect(obstaclesOf(geometry)).toHaveLength(2); // expanded group boxes are not obstacles
    expect(obstaclesOf(null)).toEqual([]);
  });
});
