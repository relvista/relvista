import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020Module from 'ajv/dist/2020.js';
import {
  DEFAULT_VIEW,
  VIEW_SETTINGS_KEY,
  emptyLayout,
  parseLayout,
  renameViewSettings,
  serializeLayout,
  viewDetailLevel,
  withViewDetailLevel,
  type Layout,
} from '../src/layout/index.js';

const Ajv2020 = (Ajv2020Module as unknown as { default: typeof Ajv2020Module.default }).default;

/** The layout-1 schema exactly as @relvista/core 1.0.0 shipped it (git tag @relvista/core@1.0.0). */
const schema10: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/layout-1.0.0.schema.json', import.meta.url), 'utf8'),
);
const validate10 = new Ajv2020({ allErrors: true, strict: true }).compile(schema10 as object);

function withViews(): Layout {
  return {
    version: 1,
    views: {
      '*': { nodes: { 'public.users': { x: 0, y: 0 } } },
      billing: { nodes: { 'public.users': { collapsed: true } } },
    },
    settings: { detailLevel: 'keys' },
  };
}

describe('viewDetailLevel', () => {
  it('falls back to settings.detailLevel, then undefined', () => {
    expect(viewDetailLevel(null)).toBeUndefined();
    expect(viewDetailLevel(emptyLayout(), 'billing')).toBeUndefined();
    expect(viewDetailLevel(withViews())).toBe('keys');
    expect(viewDetailLevel(withViews(), 'billing')).toBe('keys');
    expect(viewDetailLevel(withViews(), 'unknown')).toBe('keys');
  });

  it("returns a named view's own level", () => {
    const l = withViewDetailLevel(withViews(), 'billing', 'names');
    expect(viewDetailLevel(l, 'billing')).toBe('names');
    expect(viewDetailLevel(l, DEFAULT_VIEW)).toBe('keys');
    expect(viewDetailLevel(l, 'other')).toBe('keys');
  });

  it('ignores malformed extension values (layouts built in code)', () => {
    const l = { ...withViews() } as Layout;
    l.settings = { detailLevel: 'keys', [VIEW_SETTINGS_KEY]: { billing: 'names' } } as never;
    expect(viewDetailLevel(l, 'billing')).toBe('keys');
    l.settings = { [VIEW_SETTINGS_KEY]: { billing: { detailLevel: 'bogus' } } } as never;
    expect(viewDetailLevel(l, 'billing')).toBeUndefined();
    l.settings = { [VIEW_SETTINGS_KEY]: [] } as never;
    expect(viewDetailLevel(l, 'billing')).toBeUndefined();
  });

  it('does not read inherited keys for view names like __proto__ or toString', () => {
    expect(viewDetailLevel(withViews(), 'toString')).toBe('keys');
    const l = withViewDetailLevel(withViews(), '__proto__', 'names');
    expect(viewDetailLevel(l, '__proto__')).toBe('names');
    expect(Object.keys(l.settings![VIEW_SETTINGS_KEY]!)).toEqual(['__proto__']);
  });
});

describe('withViewDetailLevel', () => {
  it('stores a named view under settings["x-relvista-view-settings"]', () => {
    const l = withViewDetailLevel(withViews(), 'billing', 'names');
    expect(l.settings).toEqual({
      detailLevel: 'keys',
      'x-relvista-view-settings': { billing: { detailLevel: 'names' } },
    });
    expect(l.views).toEqual(withViews().views);
  });

  it('sets settings.detailLevel for the default view', () => {
    const l = withViewDetailLevel(emptyLayout(), DEFAULT_VIEW, 'names');
    expect(l.settings).toEqual({ detailLevel: 'names' });
    expect(withViewDetailLevel(l, DEFAULT_VIEW, undefined).settings).toBeUndefined();
  });

  it('removes the entry, the map and empty settings with undefined', () => {
    const base = emptyLayout();
    const set = withViewDetailLevel(base, 'billing', 'names');
    const cleared = withViewDetailLevel(set, 'billing', undefined);
    expect(cleared).toEqual(base);
    const two = withViewDetailLevel(set, 'other', 'all');
    expect(withViewDetailLevel(two, 'billing', undefined).settings).toEqual({
      'x-relvista-view-settings': { other: { detailLevel: 'all' } },
    });
  });

  it('returns the same object when nothing changes, and never mutates its input', () => {
    const base = withViews();
    const snapshot = structuredClone(base);
    expect(withViewDetailLevel(base, 'billing', undefined)).toBe(base);
    expect(withViewDetailLevel(base, DEFAULT_VIEW, 'keys')).toBe(base);
    const set = withViewDetailLevel(base, 'billing', 'all');
    expect(withViewDetailLevel(set, 'billing', 'all')).toBe(set);
    expect(base).toEqual(snapshot);
  });

  it('keeps other x- keys of settings', () => {
    const base: Layout = { ...withViews(), settings: { 'x-tool': { a: 1 } } };
    const l = withViewDetailLevel(base, 'billing', 'names');
    expect(l.settings!['x-tool']).toEqual({ a: 1 });
  });
});

describe('renameViewSettings', () => {
  it('moves, replaces and drops view entries', () => {
    let l = withViewDetailLevel(withViews(), 'billing', 'names');
    l = withViewDetailLevel(l, 'old', 'all');
    const moved = renameViewSettings(l, 'billing', 'invoices');
    expect(moved.settings![VIEW_SETTINGS_KEY]).toEqual({
      invoices: { detailLevel: 'names' },
      old: { detailLevel: 'all' },
    });
    const replaced = renameViewSettings(l, 'billing', 'old');
    expect(replaced.settings![VIEW_SETTINGS_KEY]).toEqual({ old: { detailLevel: 'names' } });
    const dropped = renameViewSettings(renameViewSettings(l, 'old', null), 'billing', null);
    expect(dropped.settings).toEqual({ detailLevel: 'keys' });
  });

  it('returns the same object when the view has no settings', () => {
    const l = withViews();
    expect(renameViewSettings(l, 'billing', 'x')).toBe(l);
    expect(renameViewSettings(emptyLayout(), 'billing', null).settings).toBeUndefined();
  });
});

describe('schema and serialization', () => {
  it('round-trips through serializeLayout and parseLayout', () => {
    let l = withViewDetailLevel(withViews(), 'zeta', 'names');
    l = withViewDetailLevel(l, 'billing', 'all');
    const text = serializeLayout(l);
    // relvista's own extension key is sorted like the rest of the file.
    expect(text.indexOf('"billing"')).toBeLessThan(text.indexOf('"zeta"'));
    const r = parseLayout(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layout).toEqual(l);
    expect(serializeLayout(r.layout)).toBe(text);
    expect(viewDetailLevel(r.layout, 'zeta')).toBe('names');
    expect(viewDetailLevel(r.layout, 'billing')).toBe('all');
  });

  it.each([
    [{ billing: { detailLevel: 'bogus' } }, 'must be equal to one of the allowed values'],
    [{ billing: { detail: 'keys' } }, 'unknown property "detail"'],
    [{ billing: 'keys' }, 'must be object'],
    [{ '*': { detailLevel: 'keys' } }, 'invalid key "*"'],
    [{ '': { detailLevel: 'keys' } }, 'invalid key ""'],
  ])('rejects a malformed view settings value %j', (value, message) => {
    const r = parseLayout({ ...withViews(), settings: { [VIEW_SETTINGS_KEY]: value } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.message).join('\n')).toContain(message);
  });

  it('still accepts other x- keys in settings with any value', () => {
    const r = parseLayout({
      ...withViews(),
      settings: { 'x-relvista-other': 'anything', 'x-tool': [1, 2] },
    });
    expect(r.ok).toBe(true);
  });
});

describe('relvista 1.0 compatibility', () => {
  it('files written with per-view detail levels validate against the 1.0 schema', () => {
    let l = withViewDetailLevel(withViews(), 'billing', 'names');
    l = withViewDetailLevel(l, 'other view', 'all');
    const json: unknown = JSON.parse(serializeLayout(l));
    expect(validate10(json), JSON.stringify(validate10.errors)).toBe(true);
  });

  it('a 1.0 file (no extension key) loads unchanged and uses settings.detailLevel for views', () => {
    const text = serializeLayout(withViews());
    const r = parseLayout(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validate10(JSON.parse(text))).toBe(true);
    expect(serializeLayout(r.layout)).toBe(text);
    expect(viewDetailLevel(r.layout, 'billing')).toBe('keys');
  });

  it('a file 1.0 saved after reading one with view settings still parses (1.0 keeps x- values as given)', () => {
    // 1.0's serializer copies x- values verbatim, so key order inside may be anything.
    const text = JSON.stringify({
      version: 1,
      views: { '*': { nodes: {} } },
      settings: {
        [VIEW_SETTINGS_KEY]: { zeta: { detailLevel: 'keys' }, alpha: { detailLevel: 'names' } },
      },
    });
    const r = parseLayout(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(viewDetailLevel(r.layout, 'alpha')).toBe('names');
  });
});
