import { compileDbml, emptyLayout, type DiagramModel } from '@relvista/core';
import { formatDiagramTarget, parseDiagramTarget, type DiagramTarget } from '@relvista/renderer';
import { describe, expect, it } from 'vitest';
import {
  applyDiagramTarget,
  isEmptyTarget,
  mirrorTarget,
  mirroredUrl,
  pickOfHit,
  positionSuffix,
  shownDetail,
  targetView,
  unknownTableMessage,
  withDetailLevel,
  type TargetActions,
} from '../src/state/navigation.js';

const SCHEMA = `
Table users {
  id int [pk]
  status user_status
}
Table orders {
  id int [pk]
  user_id int [ref: > users.id]
}
Table billing.invoices as inv {
  id int [pk]
  order_id int [ref: > orders.id]
}
Table tags {
  id int
}
Enum user_status {
  active
  gone
}
DiagramView billing {
  Tables {
    billing.invoices
    orders
  }
}
`;

function model(): DiagramModel {
  const r = compileDbml(SCHEMA);
  if (!r.model) throw new Error(r.diagnostics.map((d) => d.message).join('; '));
  return r.model;
}

/** Records the store actions a target turns into, in order. */
function recorder(): { actions: TargetActions; calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  const rec =
    (name: string) =>
    (arg?: unknown): void => {
      calls.push([name, arg]);
    };
  return {
    calls,
    actions: {
      setDetailOverride: rec('detail'),
      setFocus: rec('focus'),
      setPick: rec('pick'),
      openSearch: rec('search'),
      closeSearch: rec('closeSearch'),
      frame: rec('frame'),
      setViewport: rec('viewport'),
      toast: rec('toast'),
    },
  };
}

const callsOf = (target: DiagramTarget, m = model()) => {
  const r = recorder();
  applyDiagramTarget(target, m, r.actions);
  return r.calls;
};

describe('applyDiagramTarget (deep link → store actions)', () => {
  it('a table is lit and framed; detail is display-only', () => {
    expect(callsOf({ table: 'orders', detail: 'keys' })).toEqual([
      ['detail', 'keys'],
      ['closeSearch', undefined],
      ['pick', { ids: ['public.orders'], table: 'public.orders' }],
      ['focus', null],
      ['frame', ['public.orders']],
    ]);
  });
  it('hops frame the focused table and its related tables', () => {
    const calls = callsOf({ table: 'inv', hops: 1 });
    const frame = calls.find((c) => c[0] === 'frame')![1] as string[];
    expect(frame).toContain('billing.invoices');
    expect(frame.length).toBeGreaterThan(1);
  });
  it('hops turn on focus mode; a viewport wins over framing', () => {
    const vp = { x: -120.5, y: 40, zoom: 0.75 };
    expect(callsOf({ table: 'inv', hops: 2, viewport: vp })).toEqual([
      ['detail', null],
      ['closeSearch', undefined],
      ['pick', { ids: ['billing.invoices'], table: 'billing.invoices' }],
      ['focus', { id: 'billing.invoices', hops: 2 }],
      ['viewport', vp],
    ]);
  });
  it('tables resolve by id, schema.name, alias and case-insensitive name', () => {
    for (const t of ['public.users', 'users', 'USERS']) {
      const pick = callsOf({ table: t }).find(([n]) => n === 'pick');
      expect(pick?.[1]).toEqual({ ids: ['public.users'], table: 'public.users' });
    }
  });
  it('an unknown table is reported and clears pick and focus', () => {
    expect(callsOf({ table: 'nope' })).toEqual([
      ['detail', null],
      ['toast', unknownTableMessage('nope')],
      ['closeSearch', undefined],
      ['focus', null],
      ['pick', null],
    ]);
    expect(unknownTableMessage('nope')).toBe('No table “nope” in this schema');
  });
  it('q opens the search panel without stealing focus; path opens path mode', () => {
    expect(callsOf({ search: 'invoice' })).toContainEqual([
      'search',
      { query: 'invoice', autoFocus: false },
    ]);
    expect(callsOf({ path: ['users', 'inv'] })).toContainEqual([
      'search',
      { path: ['public.users', 'billing.invoices'], autoFocus: false },
    ]);
    const bad = callsOf({ path: ['users', 'ghost'], search: 'x' });
    expect(bad).toContainEqual(['toast', unknownTableMessage('ghost')]);
    expect(bad).toContainEqual(['search', { query: 'x', autoFocus: false }]);
  });
  it('the table is resolved in the open view only', () => {
    const m = model();
    const billing = {
      ...m,
      tables: m.tables.filter((t) => t.id !== 'public.users'),
    };
    expect(callsOf({ table: 'users' }, billing)).toContainEqual([
      'toast',
      unknownTableMessage('users'),
    ]);
  });
  it('an empty target resets the state', () => {
    expect(callsOf({})).toEqual([
      ['detail', null],
      ['closeSearch', undefined],
      ['focus', null],
      ['pick', null],
    ]);
    expect(isEmptyTarget({})).toBe(true);
    expect(isEmptyTarget(parseDiagramTarget('#dbml=abc&layout=def'))).toBe(true);
    expect(isEmptyTarget(parseDiagramTarget('#dbml=abc&table=users'))).toBe(false);
  });
});

describe('targetView', () => {
  it('switches to an existing view, ignores the current one, reports unknown ones', () => {
    const m = model();
    expect(targetView({ view: 'billing' }, m, '*')).toBe('billing');
    expect(targetView({ view: 'billing' }, m, 'billing')).toBeNull();
    expect(targetView({}, m, 'billing')).toBeNull();
    const unknown: string[] = [];
    expect(targetView({ view: 'ghost' }, m, '*', (n) => unknown.push(n))).toBeNull();
    expect(unknown).toEqual(['ghost']);
  });
});

describe('mirror (state → URL hash)', () => {
  const m = model();
  it('view, table (focus wins), hops and a rounded viewport', () => {
    expect(
      formatDiagramTarget(
        mirrorTarget(
          {
            view: 'billing',
            table: 'public.users',
            focus: { id: 'billing.invoices', hops: 1 },
            viewport: { x: 10.123, y: -3.456, zoom: 0.8 },
          },
          m,
        ),
      ),
    ).toBe('view=billing&table=billing.invoices&hops=1&vp=10.12,-3.46,0.8');
    expect(
      formatDiagramTarget(
        mirrorTarget({ view: '*', table: 'public.users', focus: null, viewport: null }, m),
      ),
    ).toBe('table=users');
  });
  it('replaces the hash, removes it for an empty target, never touches a share hash', () => {
    const loc = (hash: string) => ({ pathname: '/editor/', search: '?x=1', hash });
    expect(mirroredUrl(loc(''), { table: 'users' })).toBe('/editor/?x=1#table=users');
    expect(mirroredUrl(loc('#table=users'), { table: 'users' })).toBeNull();
    expect(mirroredUrl(loc('#table=users'), {})).toBe('/editor/?x=1');
    expect(mirroredUrl(loc(''), {})).toBeNull();
    expect(mirroredUrl(loc('#dbml=abc'), { table: 'users' })).toBeNull();
    expect(mirroredUrl(loc('#view=v&dbml=abc'), { table: 'users' })).toBeNull();
  });
  it('a mirrored hash reads back as the same target', () => {
    const t = mirrorTarget(
      {
        view: 'billing',
        table: 'billing.invoices',
        focus: null,
        viewport: { x: 1, y: 2, zoom: 1.5 },
      },
      m,
    );
    expect(parseDiagramTarget(`#${formatDiagramTarget(t)}`)).toEqual(t);
  });
  it('share "Include position" adds table and viewport, not the view', () => {
    expect(
      positionSuffix({ table: 'public.orders', focus: null, viewport: { x: 5, y: 6, zoom: 1 } }, m),
    ).toBe('&table=orders&vp=5,6,1');
    expect(positionSuffix({ table: null, focus: null, viewport: null }, m)).toBe('');
  });
});

describe('detail level in the layout', () => {
  it("writes settings.detailLevel; 'all' removes the key and the empty settings", () => {
    const base = emptyLayout();
    const keys = withDetailLevel(base, 'keys')!;
    expect(keys.settings).toEqual({ detailLevel: 'keys' });
    expect(withDetailLevel(keys, 'keys')).toBe(keys);
    const all = withDetailLevel(keys, 'all')!;
    expect(all.settings).toBeUndefined();
    expect(withDetailLevel(base, 'all')).toBe(base);
    expect(withDetailLevel(null, 'all')).toBeNull();
    expect(withDetailLevel(null, 'names')!.settings).toEqual({ detailLevel: 'names' });
    // Other settings stay.
    const themed = {
      ...base,
      settings: { detailLevel: 'names' as const, theme: { edgeStyle: 'straight' as const } },
    };
    expect(withDetailLevel(themed, 'all')!.settings).toEqual({ theme: { edgeStyle: 'straight' } });
    // An explicit 'all' is normalised away.
    const explicit = { ...base, settings: { detailLevel: 'all' as const } };
    expect(withDetailLevel(explicit, 'all')!.settings).toBeUndefined();
  });
  it('a deep link override wins over the layout for drawing', () => {
    const keys = withDetailLevel(emptyLayout(), 'keys');
    expect(shownDetail(keys, null)).toBe('keys');
    expect(shownDetail(keys, 'names')).toBe('names');
    expect(shownDetail(null, null)).toBe('all');
  });
  it('a named view stores its own level; the default stays the diagram-wide setting', () => {
    const keys = withDetailLevel(emptyLayout(), 'keys')!;
    const names = withDetailLevel(keys, 'names', 'billing')!;
    expect(names.settings).toEqual({
      detailLevel: 'keys',
      'x-relvista-view-settings': { billing: { detailLevel: 'names' } },
    });
    expect(shownDetail(names, null, 'billing')).toBe('names');
    expect(shownDetail(names, null, 'other')).toBe('keys');
    expect(shownDetail(names, null)).toBe('keys');
    expect(shownDetail(names, 'all', 'billing')).toBe('all');
    // Changing the default leaves the view's own level alone.
    const allDefault = withDetailLevel(names, 'all')!;
    expect(shownDetail(allDefault, null, 'billing')).toBe('names');
    expect(shownDetail(allDefault, null, 'other')).toBe('all');
    // Picking the diagram-wide level in a view drops the view's own (it follows the default again).
    expect(withDetailLevel(names, 'keys', 'billing')!.settings).toEqual({ detailLevel: 'keys' });
    expect(withDetailLevel(keys, 'keys', 'billing')).toBe(keys);
    expect(withDetailLevel(null, 'all', 'billing')).toBeNull();
    expect(withDetailLevel(null, 'keys', 'billing')!.settings).toEqual({
      'x-relvista-view-settings': { billing: { detailLevel: 'keys' } },
    });
  });
});

describe('search hits → picks', () => {
  const m = model();
  it('tables, columns and enums', () => {
    expect(
      pickOfHit(m, { kind: 'table', id: 'public.users', label: 'users', ranges: [], score: 1 }),
    ).toEqual({
      ids: ['public.users'],
      table: 'public.users',
    });
    expect(
      pickOfHit(m, {
        kind: 'column',
        id: 'public.orders',
        column: 'user_id',
        label: 'orders.user_id',
        ranges: [],
        score: 1,
      }),
    ).toEqual({
      ids: ['public.orders'],
      columns: { 'public.orders': ['user_id'] },
      table: 'public.orders',
    });
    const enumId = m.enums[0]!.id;
    expect(
      pickOfHit(m, { kind: 'enum', id: enumId, label: 'user_status', ranges: [], score: 1 }),
    ).toEqual({
      ids: ['public.users'],
      columns: { 'public.users': ['status'] },
    });
    expect(
      pickOfHit(m, { kind: 'view', id: 'billing', label: 'billing', ranges: [], score: 1 }),
    ).toBeNull();
  });
});
