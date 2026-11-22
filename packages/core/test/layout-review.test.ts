import { describe, expect, expectTypeOf, it } from 'vitest';
import type { layoutSchema } from '../src/layout/index.js';
import {
  LAYOUT_SCHEMA_ID,
  mergeViewDefaults,
  parseLayout,
  pruneLayout,
  renameNode,
  serializeLayout,
  type EdgeLayout,
  type Layout,
  type LayoutSettings,
  type NodeLayout,
  type Side,
  type ThemeHints,
  type ViewSettings,
  type Viewport,
} from '../src/layout/index.js';

function roundTrip(l: Layout): Layout {
  const text = serializeLayout(l);
  const r = parseLayout(text);
  if (!r.ok) throw new Error(`${text}\n${JSON.stringify(r.errors)}`);
  return r.layout;
}

describe('serializeLayout always writes a valid file', () => {
  it('keeps tiny positive sizes and zooms positive', () => {
    const l: Layout = {
      version: 1,
      views: {
        '*': {
          nodes: { 'public.a': { x: 0, y: 0, w: 0.004, h: 1e-9 } },
          viewport: { x: 0, y: 0, zoom: 0.001 },
        },
      },
    };
    const out = roundTrip(l);
    expect(out.views['*']?.nodes['public.a']).toEqual({ x: 0, y: 0, w: 0.01, h: 0.01 });
    expect(out.views['*']?.viewport?.zoom).toBe(0.001);
  });

  it('keeps huge magnitudes finite', () => {
    const l: Layout = {
      version: 1,
      views: { '*': { nodes: { 'public.a': { x: 1e307, y: -1.5e308, w: 1e300 } } } },
    };
    expect(roundTrip(l).views['*']?.nodes['public.a']).toEqual({ x: 1e307, y: -1.5e308, w: 1e300 });
  });

  it('holds for random layouts (serialize → parse is ok and serialize is idempotent)', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const num = () => {
      const m = rand();
      const mag = 10 ** (Math.floor(rand() * 628) - 320);
      return (rand() < 0.5 ? -1 : 1) * m * mag;
    };
    const pos = () => Math.abs(num()) || Number.MIN_VALUE;
    for (let i = 0; i < 500; i++) {
      const l: Layout = {
        version: 1,
        views: {
          '*': {
            nodes: { 'public.a': { x: num(), y: num(), w: pos(), h: pos() } },
            viewport: { x: num(), y: num(), zoom: pos() },
            edges: { 'ref:public.a(x)>public.a(id)': { waypoints: [{ x: num(), y: num() }] } },
          },
          v: { nodes: { 'public.a': { w: pos() } }, viewport: { x: num(), y: num(), zoom: pos() } },
        },
      };
      const text = serializeLayout(l);
      const r = parseLayout(text);
      expect(r.ok, text).toBe(true);
      if (r.ok) expect(serializeLayout(r.layout)).toBe(text);
    }
  });
});

describe('x-* extension values', () => {
  it('are written verbatim (not rounded or re-sorted)', () => {
    const l: Layout = {
      version: 1,
      views: { '*': { nodes: {} } },
      'x-tool': { z: 1, ts: 1.23456 },
      settings: { 'x-other': [3.14159, { b: 1, a: 2 }] },
    };
    const text = serializeLayout(l);
    expect(text).toContain('"ts": 1.23456');
    expect(text.indexOf('"z"')).toBeLessThan(text.indexOf('"ts"'));
    expect(text).toContain('3.14159');
    expect(text.indexOf('"b"')).toBeLessThan(text.indexOf('"a"'));
    // Extension keys themselves still sort with the other keys.
    expect(Object.keys(JSON.parse(text))).toEqual(['settings', 'version', 'views', 'x-tool']);
  });

  it('a node id that starts with x- is still normalised', () => {
    const l: Layout = { version: 1, views: { '*': { nodes: { 'x-s.t': { x: 1.23456, y: 0 } } } } };
    expect(serializeLayout(l)).toContain('"x": 1.23');
  });
});

describe('__proto__ keys', () => {
  const text =
    '{"version":1,"views":{"*":{"nodes":{"public.a":{"x":1,"y":2}},"edges":{}},' +
    '"__proto__":{"nodes":{"public.a":{"x":3,"y":4}}}}}';

  it('a view named __proto__ survives parse, serialize, rename, prune and merge', () => {
    const r = parseLayout(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.layout.views)).toEqual(['*', '__proto__']);
    const written = JSON.parse(serializeLayout(r.layout)) as Layout;
    expect(Object.hasOwn(written.views, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(written.views, '__proto__')?.value).toEqual({
      nodes: { 'public.a': { x: 3, y: 4 } },
    });
    expect(serializeLayout(r.layout)).toContain('"__proto__"');
    const renamed = renameNode(r.layout, 'public.a', 'public.b');
    expect(Object.keys(renamed.views)).toEqual(['*', '__proto__']);
    expect(Object.hasOwn(renamed.views, '__proto__')).toBe(true);
    const pruned = pruneLayout(r.layout, ['public.a']).layout;
    expect(Object.hasOwn(pruned.views, '__proto__')).toBe(true);
    expect(mergeViewDefaults(r.layout, '__proto__').nodes['public.a']).toEqual({ x: 3, y: 4 });
  });

  it('edge keys must be ref ids, so __proto__ is not a valid edge key', () => {
    const r = parseLayout(
      '{"version":1,"views":{"*":{"nodes":{},"edges":{"__proto__":{"sourceSide":"top"}}}}}',
    );
    expect(r.ok).toBe(false);
  });
});

describe('named views store only overrides', () => {
  const l: Layout = {
    version: 1,
    views: {
      '*': { nodes: { 'public.a': { x: 1, y: 1 } } },
      v: { nodes: { 'public.a': { collapsed: true }, 'public.b': { pinned: true } } },
    },
  };

  it('accepts a named-view node without x/y and inherits the default position', () => {
    expect(parseLayout(l).ok).toBe(true);
    const moved = structuredClone(l);
    moved.views['*']!.nodes['public.a'] = { x: 50, y: 60 };
    const v = mergeViewDefaults(moved, 'v');
    expect(v.nodes['public.a']).toEqual({ x: 50, y: 60, collapsed: true });
    expect(v.nodes['public.b']).toEqual({ pinned: true });
  });

  it('still requires x/y in the default view', () => {
    const r = parseLayout({ version: 1, views: { '*': { nodes: { 'public.a': { w: 10 } } } } });
    expect(r.ok).toBe(false);
  });
});

describe('renameNode and edges', () => {
  it('re-keys edges whose ref id has the renamed table as an endpoint', () => {
    const l: Layout = {
      version: 1,
      views: {
        '*': {
          nodes: { 'public.users': { x: 0, y: 0 }, 'public.posts': { x: 1, y: 1 } },
          edges: {
            'ref:public.posts(user_id)>public.users(id)': { sourceSide: 'left' },
            'ref:public.users(id)-public.users(id)#2': { sourceSide: 'top' },
            'ref:public.posts(a)>public.tags(id)': { targetSide: 'top' },
            'custom-edge': {},
          } as Record<string, EdgeLayout>,
        },
        v: { nodes: {}, edges: { 'ref:public.posts(user_id)>public.users(id)': {} } },
      },
    };
    const out = renameNode(l, 'public.users', 'public.members');
    expect(Object.keys(out.views['*']!.nodes)).toEqual(['public.members', 'public.posts']);
    expect(out.views['*']!.edges).toEqual({
      'ref:public.posts(user_id)>public.members(id)': { sourceSide: 'left' },
      'ref:public.members(id)-public.members(id)#2': { sourceSide: 'top' },
      'ref:public.posts(a)>public.tags(id)': { targetSide: 'top' },
      'custom-edge': {},
    });
    expect(Object.keys(out.views['v']!.edges!)).toEqual([
      'ref:public.posts(user_id)>public.members(id)',
    ]);
    const pruned = pruneLayout(
      out,
      ['public.members', 'public.posts'],
      ['ref:public.posts(user_id)>public.members(id)'],
    );
    expect(pruned.removed).toEqual([]);
    expect(pruned.removedEdges).not.toContain('ref:public.posts(user_id)>public.members(id)');
  });

  it('handles quoted table ids', () => {
    const l: Layout = {
      version: 1,
      views: { '*': { nodes: {}, edges: { 'ref:x."y.z"(id)<"x.y".z(r)': {} } } },
    };
    const out = renameNode(l, '"x.y".z', 'x.z');
    expect(Object.keys(out.views['*']!.edges!)).toEqual(['ref:x."y.z"(id)<x.z(r)']);
  });
});

describe('TS types match the schema', () => {
  type Props<T> = T extends { properties: infer P } ? keyof P : never;
  type Defs = (typeof layoutSchema)['$defs'];

  it('has the same property names (checked by pnpm typecheck)', () => {
    expectTypeOf<Props<typeof layoutSchema>>().toEqualTypeOf<
      '$schema' | 'version' | 'views' | 'settings'
    >();
    expectTypeOf<Props<Defs['nodeFields']>>().toEqualTypeOf<keyof NodeLayout>();
    expectTypeOf<Defs['node']['required'][number]>().toEqualTypeOf<'x' | 'y'>();
    expectTypeOf<Props<Defs['viewport']>>().toEqualTypeOf<keyof Viewport>();
    expectTypeOf<Props<Defs['edge']>>().toEqualTypeOf<keyof EdgeLayout>();
    expectTypeOf<Props<Defs['view']>>().toEqualTypeOf<'nodes' | 'viewport' | 'edges'>();
    expectTypeOf<Props<Defs['viewOverride']>>().toEqualTypeOf<'nodes' | 'viewport' | 'edges'>();
    expectTypeOf<Props<Defs['settings']>>().toEqualTypeOf<
      Exclude<keyof LayoutSettings, `x-${string}`>
    >();
    expectTypeOf<Props<Defs['settings']['properties']['theme']>>().toEqualTypeOf<
      keyof ThemeHints
    >();
    expectTypeOf<Defs['side']['enum'][number]>().toEqualTypeOf<Side>();
    expectTypeOf<Props<Defs['viewSettings']['additionalProperties']>>().toEqualTypeOf<
      keyof ViewSettings
    >();
    expectTypeOf<
      Defs['viewSettings']['additionalProperties']['properties']['detailLevel']['enum'][number]
    >().toEqualTypeOf<NonNullable<ViewSettings['detailLevel']>>();
    expectTypeOf<Defs['settings']['properties']['detailLevel']['enum'][number]>().toEqualTypeOf<
      NonNullable<LayoutSettings['detailLevel']>
    >();
    expectTypeOf<
      Defs['settings']['properties']['theme']['properties']['colorScheme']['enum'][number]
    >().toEqualTypeOf<NonNullable<ThemeHints['colorScheme']>>();
    expectTypeOf<
      Defs['settings']['properties']['theme']['properties']['edgeStyle']['enum'][number]
    >().toEqualTypeOf<NonNullable<ThemeHints['edgeStyle']>>();
  });

  it('accepts a typed layout that uses every field', () => {
    const full: Layout = {
      $schema: LAYOUT_SCHEMA_ID,
      version: 1,
      views: {
        '*': {
          nodes: {
            'public.a': { x: 1, y: 2, w: 3, h: 4, collapsed: true, pinned: false },
            'note:n': { x: 0, y: 0 },
            'group:g': { x: 0, y: 0 },
          },
          viewport: { x: 1, y: 2, zoom: 0.5 },
          edges: {
            'ref:public.a(x)>public.a(id)': {
              waypoints: [{ x: 1, y: 1 }],
              sourceSide: 'top',
              targetSide: 'bottom',
            },
          },
        },
        v: { nodes: { 'public.a': { collapsed: false } }, viewport: { x: 0, y: 0, zoom: 1 } },
      },
      settings: {
        detailLevel: 'names',
        theme: { colorScheme: 'auto', showGrid: false, edgeStyle: 'curved' },
        'x-s': 1,
      },
      'x-top': { any: 'thing' },
    };
    expect(parseLayout(full)).toEqual({ ok: true, layout: full });
  });
});
