// @vitest-environment jsdom
// DiagramCanvas v1 additions (docs/design/phase3-v1.md §4.3): collapse, resize, focus, decorations,
// edge / pane events, the 'auto' engine, placeNodes, displayModel.
import {
  compileDbml,
  emptyLayout,
  parseLayout,
  type DiagramModel,
  type Layout,
  type NodeLayout,
} from '@relvista/core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DiagramCanvas,
  FOCUS_GAP,
  compactFocus,
  packCollapsedCards,
  focusModel,
  restrictGeometry,
  type DiagramCanvasHandle,
  type DiagramCanvasProps,
} from '../src/canvas/DiagramCanvas.js';
import type { CanvasEdgeEvent, CanvasPaneEvent, LayoutChange } from '../src/canvas/types.js';
import { placedBox, unplacedIds } from '../src/canvas/useCanvasGeometry.js';
import * as geometryModule from '../src/geometry.js';
import { routeAll } from '../src/svg/routing.js';

vi.mock('../src/geometry.js', async (importOriginal) => {
  const m = await importOriginal<typeof geometryModule>();
  return { ...m, layoutAsync: vi.fn(m.layoutAsync) };
});
const layoutAsyncSpy = vi.mocked(geometryModule.layoutAsync);

beforeAll(() => {
  // React Flow measures nodes through a ResizeObserver and offsetWidth/Height; jsdom has neither,
  // so nodes would stay unmeasured (no edges drawn, resizes from a 0×0 box). Nodes report the
  // size in their style, observed elements are reported once.
  class RO {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() =>
        this.cb([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver),
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO);
  // The React Flow container has a size, so drags near its "edges" do not auto-pan.
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('react-flow') ? new DOMRect(0, 0, 800, 600) : rect.call(this);
  });
  for (const [prop, key] of [
    ['offsetWidth', 'width'],
    ['offsetHeight', 'height'],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('react-flow__node') ? parseFloat(this.style[key]) || 0 : 0;
      },
    });
  }
  if (!('DOMMatrixReadOnly' in globalThis)) {
    class M {
      m22 = 1;
      constructor(_t?: string) {}
    }
    vi.stubGlobal('DOMMatrixReadOnly', M);
  }
});

beforeEach(() => {
  layoutAsyncSpy.mockClear();
});

afterEach(() => {
  cleanup();
  for (const prop of ['clientWidth', 'clientHeight'])
    delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[prop];
});

/** jsdom has no layout: give canvases a size so the viewport maths runs. */
function sizeCanvases(width = 800, height = 600): void {
  for (const [prop, value] of [
    ['clientWidth', width],
    ['clientHeight', height],
  ] as const) {
    Object.defineProperty(HTMLDivElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('rv-canvas') ? value : 0;
      },
    });
  }
}

const SRC = `
Table users {
  id integer [pk]
  email varchar
}
Table posts {
  id integer [pk]
  user_id integer [ref: > users.id]
}
Table tags {
  id integer [pk]
  post_id integer [ref: > posts.id]
}
Table lonely {
  id integer [pk]
}
TableGroup blog {
  users
  posts
}
Note intro {
  'hello'
}
DiagramView only_blog {
  Tables {
    users
    posts
    tags
  }
}
`;

function compile(src: string): DiagramModel {
  const { model, diagnostics } = compileDbml(src);
  if (!model) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return model;
}
const MODEL = compile(SRC);
function refBetween(a: string, b: string): string {
  const ref = MODEL.refs.find(
    (r) => [r.from.tableId, r.to.tableId].sort().join() === [a, b].sort().join(),
  );
  if (!ref) throw new Error(`no ref ${a} - ${b}`);
  return ref.id;
}
const REF_POSTS_USERS = refBetween('public.posts', 'public.users');
const REF_TAGS_POSTS = refBetween('public.tags', 'public.posts');

function layoutWith(nodes: Record<string, NodeLayout>): Layout {
  return { ...emptyLayout(), views: { '*': { nodes } } };
}
const ALL_PLACED = layoutWith({
  'public.users': { x: 40, y: 60 },
  'public.posts': { x: 420, y: 60 },
  'public.tags': { x: 800, y: 60 },
  'public.lonely': { x: 40, y: 400 },
  'note:intro': { x: 420, y: 400 },
});

async function flush(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Waits until the layout is done and React Flow measured the nodes (edges are drawn then). */
async function settled(root: ParentNode) {
  for (let i = 0; i < 100; i++) {
    if (root.querySelector('.rv-canvas[data-rv-layout="done"]')) {
      await flush(20);
      return;
    }
    await flush(20);
  }
  throw new Error('layout never finished');
}

function nodeOrNull(root: ParentNode, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${id.replace(/["\\]/g, '\\$&')}"]`,
  );
}
function node(root: ParentNode, id: string): HTMLElement {
  const el = nodeOrNull(root, id);
  if (!el) throw new Error(`no node ${id}`);
  return el;
}
function edge(root: ParentNode, id: string): Element {
  const el = Array.from(root.querySelectorAll('.react-flow__edge')).find(
    (e) => e.getAttribute('data-id') === id,
  );
  if (!el) throw new Error(`no edge ${id}`);
  return el;
}

function translate(el: HTMLElement): { x: number; y: number } {
  // CSSOM serialises `translate(x, 0)` as `translate(x)` (jsdom 31 does too): ty defaults to 0.
  const m = /translate\(([-\d.]+)px(?:,\s*([-\d.]+)px)?\)/.exec(el.style.transform)!;
  return { x: Number(m[1]), y: Number(m[2] ?? 0) };
}

/**
 * A mouse event React Flow's d3-drag accepts in jsdom (`view` must be the window, which jsdom's
 * MouseEvent constructor refuses from the test realm).
 */
function mouse(target: EventTarget, type: string, x: number, y: number): void {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(ev, 'view', { value: window });
  act(() => {
    target.dispatchEvent(ev);
  });
}

/** Presses on `el` at (x, y), moves by (dx, dy) in two steps and lets go (resize handles). */
function drag(el: HTMLElement, x: number, y: number, dx: number, dy: number): void {
  mouse(el, 'mousedown', x, y);
  mouse(el, 'mousemove', x + dx / 2, y + dy / 2);
  mouse(el, 'mousemove', x + dx, y + dy);
  mouse(el, 'mouseup', x + dx, y + dy);
}

/**
 * Drags a node by (dx, dy). React Flow starts a node drag on the first move past its threshold
 * and measures from there, so that first move is made before the measured one.
 */
function dragNode(el: HTMLElement, x: number, y: number, dx: number, dy: number): void {
  const [sx, sy] = [x + 4, y + 4];
  mouse(el, 'mousedown', x, y);
  mouse(el, 'mousemove', sx, sy);
  mouse(el, 'mousemove', sx + dx / 2, sy + dy / 2);
  mouse(el, 'mousemove', sx + dx, sy + dy);
  mouse(el, 'mouseup', sx + dx, sy + dy);
}

/**
 * Waits for the first view and then sets `vp`, so pointer gestures map to known diagram
 * coordinates. The canvas must be sized (`sizeCanvases`): an unsized one falls back to React
 * Flow's own fitView, which runs once the nodes are measured and would replace `vp`.
 */
async function viewAt(
  handle: DiagramCanvasHandle,
  vp: { x: number; y: number; zoom: number },
): Promise<void> {
  await flush(100);
  act(() => handle.setViewport(vp));
  await flush(50);
  expect(handle.getViewport()).toEqual(vp);
}

/** A controlled canvas: applies every change, records it. */
function Harness(
  props: Omit<DiagramCanvasProps, 'layout'> & {
    initial: Layout | null;
    onChange?: (next: Layout, change: LayoutChange) => void;
  },
) {
  const { initial, onChange, ...rest } = props;
  const [layout, setLayout] = useState<Layout | null>(initial);
  return (
    <div style={{ width: 800, height: 600 }}>
      <DiagramCanvas
        {...rest}
        layout={layout}
        onLayoutChange={(next, change) => {
          onChange?.(next, change);
          setLayout(next);
        }}
      />
    </div>
  );
}

function recorder() {
  const changes: [Layout, LayoutChange][] = [];
  return { changes, onChange: (n: Layout, c: LayoutChange) => changes.push([n, c]) };
}

describe('DiagramCanvas v1: collapsed groups', () => {
  it('setNodeSettings collapses a group: collapsed + the box position, one "settings"', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const { changes, onChange } = recorder();
    const { container } = render(
      <Harness ref={ref} model={MODEL} initial={ALL_PLACED} editable onChange={onChange} />,
    );
    await settled(container);
    const box = ref.current!.getGeometry()!.groups['group:blog']!;
    expect(box.collapsed).toBeUndefined();
    await act(async () => {
      ref.current!.setNodeSettings(['group:blog'], { collapsed: true });
    });
    expect(changes).toHaveLength(1);
    const [next, change] = changes[0]!;
    expect(change).toEqual({
      kind: 'settings',
      view: '*',
      ids: ['group:blog'],
      settings: { collapsed: true },
    });
    expect(next.views['*']!.nodes['group:blog']).toEqual({
      x: Math.round(box.x),
      y: Math.round(box.y),
      collapsed: true,
    });
    // Members keep their entries; expanding restores them.
    expect(next.views['*']!.nodes['public.users']).toEqual({ x: 40, y: 60 });
    expect(parseLayout(next).ok).toBe(true);
    await flush();

    // Drawn as one card where the group was; the members are gone.
    const card = node(container, 'group:blog');
    expect(card.classList.contains('react-flow__node-rvCollapsedGroup')).toBe(true);
    expect(card.getAttribute('data-rv-collapsed')).toBe('true');
    expect(card.querySelector('[data-rv-collapsed="true"]')).not.toBeNull();
    expect(translate(card)).toEqual({ x: Math.round(box.x), y: Math.round(box.y) });
    expect(nodeOrNull(container, 'public.users')).toBeNull();
    expect(nodeOrNull(container, 'public.posts')).toBeNull();
    // The tags → posts ref now attaches to the card.
    expect(edge(container, REF_TAGS_POSTS)).toBeTruthy();
    // posts → users is inside the card: no line.
    expect(
      Array.from(container.querySelectorAll('.react-flow__edge')).some(
        (e) => e.getAttribute('data-id') === REF_POSTS_USERS,
      ),
    ).toBe(false);

    // Expanding removes `collapsed`, keeps the position (ignored while expanded).
    await act(async () => {
      ref.current!.setNodeSettings(['group:blog'], { collapsed: false });
    });
    const [after, c2] = changes[1]!;
    expect(c2).toMatchObject({ kind: 'settings', settings: { collapsed: false } });
    expect(after.views['*']!.nodes['group:blog']).toEqual({
      x: Math.round(box.x),
      y: Math.round(box.y),
    });
    await flush();
    expect(node(container, 'group:blog').classList.contains('react-flow__node-rvGroup')).toBe(true);
    expect(translate(node(container, 'public.users'))).toEqual({ x: 40, y: 60 });
  });

  it('collapses in a named view as an override of that view', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const { changes, onChange } = recorder();
    const { container } = render(
      <Harness
        ref={ref}
        model={MODEL}
        initial={ALL_PLACED}
        view="only_blog"
        editable
        onChange={onChange}
      />,
    );
    await settled(container);
    await act(async () => {
      ref.current!.setNodeSettings(['group:blog'], { collapsed: true });
    });
    const [next] = changes[0]!;
    expect(next.views['only_blog']!.nodes['group:blog']).toMatchObject({ collapsed: true });
    expect(Number.isInteger(next.views['only_blog']!.nodes['group:blog']!.x)).toBe(true);
    expect(next.views['*']).toBe(ALL_PLACED.views['*']);
  });

  it('drags a collapsed group as one node and reports "move" with the group id', async () => {
    sizeCanvases();
    const { changes, onChange } = recorder();
    const ref = createRef<DiagramCanvasHandle>();
    const initial = layoutWith({
      ...ALL_PLACED.views['*']!.nodes,
      'group:blog': { x: 20, y: 20, collapsed: true },
    });
    const { container } = render(
      <Harness ref={ref} model={MODEL} initial={initial} editable onChange={onChange} />,
    );
    await settled(container);
    await viewAt(ref.current!, { x: 100, y: 100, zoom: 1 });
    expect(changes).toEqual([]);
    dragNode(node(container, 'group:blog'), 126, 126, 50.4, 29.6);
    await flush();
    expect(changes).toHaveLength(1);
    const [next, change] = changes[0]!;
    expect(change).toEqual({ kind: 'move', view: '*', ids: ['group:blog'] });
    expect(next.views['*']!.nodes['group:blog']).toEqual({ x: 70, y: 50, collapsed: true });
    expect(translate(node(container, 'group:blog'))).toEqual({ x: 70, y: 50 });
  });

  it('double-click toggles collapse: reported when editable, local when read-only', async () => {
    const { changes, onChange } = recorder();
    const { container } = render(
      <Harness model={MODEL} initial={ALL_PLACED} editable onChange={onChange} />,
    );
    await settled(container);
    fireEvent.doubleClick(node(container, 'group:blog').querySelector('.rv-group-drag')!);
    await flush();
    expect(changes[0]![1]).toMatchObject({
      kind: 'settings',
      ids: ['group:blog'],
      settings: { collapsed: true },
    });
    fireEvent.doubleClick(node(container, 'group:blog'));
    await flush();
    expect(changes[1]![1]).toMatchObject({ settings: { collapsed: false } });
    cleanup();

    const onLayoutChange = vi.fn();
    const ro = render(
      <DiagramCanvas model={MODEL} layout={ALL_PLACED} onLayoutChange={onLayoutChange} />,
    );
    await settled(ro.container);
    fireEvent.doubleClick(node(ro.container, 'group:blog').querySelector('.rv-group-drag')!);
    await flush();
    expect(node(ro.container, 'group:blog').getAttribute('data-rv-collapsed')).toBe('true');
    expect(nodeOrNull(ro.container, 'public.users')).toBeNull();
    fireEvent.doubleClick(node(ro.container, 'group:blog'));
    await flush();
    expect(nodeOrNull(ro.container, 'public.users')).not.toBeNull();
    expect(onLayoutChange).not.toHaveBeenCalled();
  });
});

describe('DiagramCanvas v1: resize', () => {
  it('reports one "resize" with integer w/h when the handles are let go', async () => {
    const { changes, onChange } = recorder();
    sizeCanvases();
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(
      <Harness ref={ref} model={MODEL} initial={ALL_PLACED} editable onChange={onChange} />,
    );
    await settled(container);
    await viewAt(ref.current!, { x: 0, y: 0, zoom: 1 });
    const note = node(container, 'note:intro');
    fireEvent.click(note);
    await flush();
    const handle = note.querySelector<HTMLElement>('.react-flow__resize-control.bottom.right')!;
    expect(handle).not.toBeNull();
    const w0 = note.querySelector<HTMLElement>('.rv-node')!.style.width;
    drag(handle, 100, 100, 80.4, 60.6);
    await flush();
    expect(changes).toHaveLength(1);
    const [next, change] = changes[0]!;
    expect(change).toEqual({ kind: 'resize', view: '*', ids: ['note:intro'] });
    const entry = next.views['*']!.nodes['note:intro']!;
    expect(entry.x).toBe(420);
    expect(entry.y).toBe(400);
    expect(Number.isInteger(entry.w)).toBe(true);
    expect(Number.isInteger(entry.h)).toBe(true);
    expect(entry.w).toBe(Math.round(parseFloat(w0) + 80.4));
    expect(entry.h).toBeGreaterThanOrEqual(64);
    expect(parseLayout(next).ok).toBe(true);
    await flush();
    expect(node(container, 'note:intro').querySelector<HTMLElement>('.rv-node')!.style.width).toBe(
      `${entry.w}px`,
    );
  });

  it('writes x/y too when the top-left corner moved', async () => {
    const { changes, onChange } = recorder();
    sizeCanvases();
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(
      <Harness ref={ref} model={MODEL} initial={ALL_PLACED} editable onChange={onChange} />,
    );
    await settled(container);
    await viewAt(ref.current!, { x: 0, y: 0, zoom: 1 });
    const note = node(container, 'note:intro');
    fireEvent.click(note);
    await flush();
    const handle = note.querySelector<HTMLElement>('.react-flow__resize-control.top.left')!;
    drag(handle, 100, 100, -30, -20);
    await flush();
    const [next, change] = changes[0]!;
    expect(change.kind).toBe('resize');
    expect(next.views['*']!.nodes['note:intro']).toMatchObject({ x: 390, y: 380 });
  });

  it('puts handles on notes only by default, on tables with "all", nowhere read-only', async () => {
    const handles = (root: ParentNode, id: string) =>
      node(root, id).querySelectorAll('.react-flow__resize-control').length;
    const a = render(<Harness model={MODEL} initial={ALL_PLACED} editable />);
    await settled(a.container);
    fireEvent.click(node(a.container, 'note:intro'));
    fireEvent.click(node(a.container, 'public.users'));
    await flush();
    expect(handles(a.container, 'public.users')).toBe(0);
    cleanup();
    const b = render(<Harness model={MODEL} initial={ALL_PLACED} editable resizable="all" />);
    await settled(b.container);
    fireEvent.click(node(b.container, 'public.users'));
    await flush();
    expect(handles(b.container, 'public.users')).toBeGreaterThan(0);
    cleanup();
    const c = render(<Harness model={MODEL} initial={ALL_PLACED} editable resizable={false} />);
    await settled(c.container);
    fireEvent.click(node(c.container, 'note:intro'));
    await flush();
    expect(handles(c.container, 'note:intro')).toBe(0);
    cleanup();
    const d = render(<DiagramCanvas model={MODEL} layout={ALL_PLACED} />);
    await settled(d.container);
    fireEvent.mouseEnter(node(d.container, 'note:intro'));
    await flush();
    expect(handles(d.container, 'note:intro')).toBe(0);
  });
});

describe('DiagramCanvas v1: focus', () => {
  it('hides tables beyond N hops and the notes, pulls the rest in around the root, marks it', async () => {
    const onLayoutChange = vi.fn();
    const { container, rerender } = render(
      <DiagramCanvas
        model={MODEL}
        layout={ALL_PLACED}
        editable
        onLayoutChange={onLayoutChange}
        focus={{ ids: ['public.users'], hops: 0 }}
      />,
    );
    await settled(container);
    expect(container.querySelector('.rv-canvas')!.getAttribute('data-rv-focus')).toBe('true');
    expect(translate(node(container, 'public.users'))).toEqual({ x: 40, y: 60 });
    expect(nodeOrNull(container, 'public.posts')).toBeNull();
    expect(nodeOrNull(container, 'public.tags')).toBeNull();
    expect(nodeOrNull(container, 'public.lonely')).toBeNull();
    expect(nodeOrNull(container, 'note:intro')).toBeNull();
    rerender(
      <DiagramCanvas
        model={MODEL}
        layout={ALL_PLACED}
        editable
        onLayoutChange={onLayoutChange}
        focus={{ ids: ['public.users'], hops: 1 }}
      />,
    );
    await flush();
    // The root stays; posts (right of it) keeps its direction and comes as close as FOCUS_GAP.
    expect(translate(node(container, 'public.users'))).toEqual({ x: 40, y: 60 });
    const posts = translate(node(container, 'public.posts'));
    expect(posts.y).toBe(60);
    expect(posts.x).toBeGreaterThan(40);
    expect(posts.x).toBeLessThanOrEqual(420);
    expect(nodeOrNull(container, 'public.tags')).toBeNull();
    expect(edge(container, REF_POSTS_USERS)).toBeTruthy();
    rerender(
      <DiagramCanvas
        model={MODEL}
        layout={ALL_PLACED}
        editable
        onLayoutChange={onLayoutChange}
        focus={null}
      />,
    );
    await flush();
    expect(container.querySelector('.rv-canvas')!.hasAttribute('data-rv-focus')).toBe(false);
    expect(nodeOrNull(container, 'public.tags')).not.toBeNull();
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it('fits the focused set when the focus changes', async () => {
    sizeCanvases();
    const ref = createRef<DiagramCanvasHandle>();
    const { container, rerender } = render(
      <DiagramCanvas ref={ref} model={MODEL} layout={ALL_PLACED} />,
    );
    await settled(container);
    await flush(50);
    act(() => ref.current!.setViewport({ x: 1, y: 2, zoom: 0.3 }));
    rerender(
      <DiagramCanvas
        ref={ref}
        model={MODEL}
        layout={ALL_PLACED}
        focus={{ ids: ['public.lonely'], hops: 0 }}
      />,
    );
    await flush(400);
    const vp = ref.current!.getViewport();
    expect(vp).not.toEqual({ x: 1, y: 2, zoom: 0.3 });
    // The lonely table is centred horizontally in the 800 px canvas.
    const g = ref.current!.getGeometry()!;
    const t = g.nodes['public.lonely']!;
    expect(Object.keys(g.nodes).sort()).toEqual(['public.lonely']);
    expect(Math.abs(vp.x + (t.x + t.width / 2) * vp.zoom - 400)).toBeLessThan(260);
  });

  it('compactFocus: a sparse neighbourhood of 14-large reads at a useful zoom', () => {
    const large = compile(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../examples/14-large.dbml'),
        'utf8',
      ),
    );
    const g = geometryModule.layoutSync(large);
    for (const root of ['public.invoices', 'public.users', 'public.organizations']) {
      for (const hops of [1, 2]) {
        const m = focusModel(large, { ids: [root], hops })!;
        const spread = restrictGeometry(m, g);
        const compact = compactFocus(m, g, [root]);
        // The root does not move; nothing overlaps; the picture is no bigger than before.
        expect(compact.nodes[root]).toEqual(spread.nodes[root]);
        const boxes = Object.values(compact.nodes);
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const apart =
              a.x + a.width + FOCUS_GAP <= b.x + 1 ||
              b.x + b.width + FOCUS_GAP <= a.x + 1 ||
              a.y + a.height + FOCUS_GAP <= b.y + 1 ||
              b.y + b.height + FOCUS_GAP <= a.y + 1;
            expect(apart, `${root} ${hops}: boxes ${i} and ${j}`).toBe(true);
          }
        const area = (b: { width: number; height: number }) => b.width * b.height;
        expect(area(compact.bounds)).toBeLessThanOrEqual(area(spread.bounds) + 1);
        // Directions from the root are kept.
        const c = (b: { x: number; y: number; width: number; height: number }) => ({
          x: b.x + b.width / 2,
          y: b.y + b.height / 2,
        });
        const r0 = c(spread.nodes[root]!);
        for (const id of Object.keys(compact.nodes)) {
          const before = c(spread.nodes[id]!);
          const after = c(compact.nodes[id]!);
          if (Math.abs(before.x - r0.x) > 1)
            expect(Math.sign(after.x - r0.x)).toBe(Math.sign(before.x - r0.x));
        }
      }
    }
    // invoices at 1 hop: the five tables span far less than in the full layout.
    const m = focusModel(large, { ids: ['public.invoices'], hops: 1 })!;
    const spread = restrictGeometry(m, g).bounds;
    const compact = compactFocus(m, g, ['public.invoices']).bounds;
    expect(compact.width * compact.height).toBeLessThan(spread.width * spread.height);
  });

  it('packCollapsedCards: Collapse all groups of 14-large gives a compact set of cards', () => {
    const large = compile(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../examples/14-large.dbml'),
        'utf8',
      ),
    );
    const g = geometryModule.layoutSync(large);
    const ids = large.groups.map((x) => x.id);
    expect(ids.length).toBeGreaterThan(3);
    const at = packCollapsedCards(large, g, ids);
    expect(Object.keys(at).sort()).toEqual([...ids].sort());
    // Lay the collapsed diagram out with those positions, as the canvas does after the change.
    const saved = { nodes: {} as Record<string, { x: number; y: number; collapsed?: boolean }> };
    for (const [id, n] of Object.entries(g.nodes)) saved.nodes[id] = { x: n.x, y: n.y };
    for (const id of ids) saved.nodes[id] = { ...at[id]!, collapsed: true };
    const collapsed = geometryModule.layoutSync(large, { saved } as never);
    const cards = ids.map((id) => collapsed.groups[id]!);
    for (const c of cards) expect(c.collapsed).toBe(true);
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]!;
        const b = cards[j]!;
        const apart =
          a.x + a.width + 16 <= b.x + 1 ||
          b.x + b.width + 16 <= a.x + 1 ||
          a.y + a.height + 16 <= b.y + 1 ||
          b.y + b.height + 16 <= a.y + 1;
        expect(apart).toBe(true);
      }
    // A fraction of the expanded footprint: Fit can show the cards at a readable zoom.
    const area = (b: { width: number; height: number }) => b.width * b.height;
    expect(area(collapsed.bounds)).toBeLessThan(area(g.bounds) / 4);
  });

  it('packCollapsedCards: with other tables drawn, the cards are pulled together around them', () => {
    const m = compile(`
Table a { id int }
Table b { id int }
Table loose { id int }
TableGroup left { a }
TableGroup right { b }
`);
    const base = geometryModule.layoutSync(m);
    const g = geometryModule.moveNodes(
      m,
      base,
      new Map([
        ['public.a', { x: 0, y: 0 }],
        ['public.b', { x: 3000, y: 0 }],
        ['public.loose', { x: 1500, y: 0 }],
      ]),
    );
    const at = packCollapsedCards(m, g, ['group:left', 'group:right']);
    const loose = g.nodes['public.loose']!;
    const left = at['group:left']!;
    const right = at['group:right']!;
    // Closer together than the groups were, on their own sides of the loose table, clear of it.
    expect(right.x - left.x).toBeLessThan(3000);
    expect(left.x).toBeLessThan(loose.x);
    expect(right.x).toBeGreaterThan(loose.x + loose.width);
  });

  it('focusModel / restrictGeometry are pure helpers', () => {
    expect(focusModel(MODEL, null)).toBeNull();
    expect(focusModel(MODEL, { ids: ['nope'], hops: 2 })).toBeNull();
    const m = focusModel(MODEL, { ids: ['public.tags'], hops: 9 })!;
    expect(m.tables.map((t) => t.id)).toEqual(['public.users', 'public.posts', 'public.tags']);
    const g = geometryModule.gridLayout(MODEL);
    const r = restrictGeometry(focusModel(MODEL, { ids: ['public.tags'], hops: 0 })!, g);
    expect(Object.keys(r.nodes).sort()).toEqual(['public.tags']);
    expect(r.nodes['public.tags']).toBe(g.nodes['public.tags']);
    expect(r.groups['group:blog']).toBeUndefined();
  });
});

describe('DiagramCanvas v1: engine "auto"', () => {
  const SMALL = compile(`
Table a {
  id int [pk]
}
Table b {
  id int [pk]
  a_id int [ref: > a.id]
}
`);

  it('never starts ELK when needsElk is false, and reports "done" plus one "place"', async () => {
    const status = vi.fn();
    const { changes, onChange } = recorder();
    const { container } = render(
      <Harness model={SMALL} initial={null} editable onChange={onChange} onLayoutStatus={status} />,
    );
    await settled(container);
    await flush(250);
    expect(layoutAsyncSpy).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith('done');
    expect(status).not.toHaveBeenCalledWith('pending');
    expect(changes).toHaveLength(1);
    expect(changes[0]![1]).toMatchObject({ kind: 'place', ids: ['public.a', 'public.b'] });
  });

  it('runs ELK (engine "auto") when a component needs it', async () => {
    const { container } = render(<DiagramCanvas model={MODEL} layout={null} />);
    await settled(container);
    expect(layoutAsyncSpy).toHaveBeenCalledTimes(1);
    expect(layoutAsyncSpy.mock.calls[0]![1]).toMatchObject({ engine: 'auto' });
  });
});

describe('DiagramCanvas v1: decorations and highlightIds', () => {
  it('draws decorations (data-rv-tone) and dims undecorated nodes with dimOthers', async () => {
    const { container } = render(
      <DiagramCanvas
        model={MODEL}
        layout={ALL_PLACED}
        decorations={{
          nodes: { 'public.users': 'match', 'note:intro': 'added', 'group:blog': 'changed' },
          columns: { 'public.posts': { user_id: 'path' } },
          refs: { [REF_POSTS_USERS]: 'path' },
          badges: { 'public.users': '~3' },
          dimOthers: true,
        }}
      />,
    );
    await settled(container);
    expect(
      node(container, 'public.users').querySelector('.rv-table')!.getAttribute('data-rv-tone'),
    ).toBe('match');
    expect(node(container, 'public.users').textContent).toContain('~3');
    expect(node(container, 'note:intro').querySelector('[data-rv-tone="added"]')).not.toBeNull();
    expect(node(container, 'group:blog').querySelector('[data-rv-tone="changed"]')).not.toBeNull();
    expect(
      node(container, 'public.posts')
        .querySelector('[data-rv-column="user_id"]')!
        .getAttribute('data-rv-tone'),
    ).toBe('path');
    expect(edge(container, REF_POSTS_USERS).querySelector('[data-rv-tone="path"]')).not.toBeNull();
    // Undecorated: dimmed.
    expect(
      node(container, 'public.lonely').querySelector('.rv-table')!.getAttribute('opacity'),
    ).toBe('0.28');
  });

  it('rings every node of highlightIds and lights their refs', async () => {
    const { container } = render(
      <DiagramCanvas
        model={MODEL}
        layout={ALL_PLACED}
        highlightIds={['public.users', 'note:intro', 'public.nope']}
      />,
    );
    await settled(container);
    const ringed = Array.from(container.querySelectorAll('.rv-node.rv-highlighted')).map((el) =>
      el.closest('.react-flow__node')!.getAttribute('data-id'),
    );
    expect(ringed.sort()).toEqual(['note:intro', 'public.users']);
    expect(
      edge(container, REF_POSTS_USERS).querySelector('.rv-ref')!.getAttribute('data-rv-state'),
    ).toBe('highlight');
  });

  it('never moves the viewport because decorations or highlights changed', async () => {
    sizeCanvases();
    const ref = createRef<DiagramCanvasHandle>();
    const { container, rerender } = render(
      <DiagramCanvas ref={ref} model={MODEL} layout={ALL_PLACED} resetKey="doc" />,
    );
    await settled(container);
    await flush(50);
    act(() => ref.current!.setViewport({ x: 33, y: 44, zoom: 0.5 }));
    await flush();
    rerender(
      <DiagramCanvas
        ref={ref}
        model={MODEL}
        layout={ALL_PLACED}
        resetKey="doc"
        decorations={{ nodes: { 'public.tags': 'match' }, dimOthers: true }}
        highlightIds={['public.tags']}
      />,
    );
    await flush(300);
    rerender(
      <DiagramCanvas
        ref={ref}
        model={MODEL}
        layout={ALL_PLACED}
        resetKey="doc"
        decorations={{ refs: { [REF_TAGS_POSTS]: 'path' } }}
        highlightIds={null}
      />,
    );
    await flush(300);
    expect(ref.current!.getViewport()).toEqual({ x: 33, y: 44, zoom: 0.5 });
  });
});

describe('DiagramCanvas v1: handle additions', () => {
  it('placeNodes reports one "move" with rounded positions', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const { changes, onChange } = recorder();
    const { container } = render(
      <Harness ref={ref} model={MODEL} initial={ALL_PLACED} editable onChange={onChange} />,
    );
    await settled(container);
    await act(async () => {
      ref.current!.placeNodes({
        'note:intro': { x: 12.4, y: 13.6 },
        'public.tags': { x: 900, y: 70 },
      });
    });
    expect(changes).toHaveLength(1);
    const [next, change] = changes[0]!;
    expect(change).toEqual({ kind: 'move', view: '*', ids: ['note:intro', 'public.tags'] });
    expect(next.views['*']!.nodes['note:intro']).toEqual({ x: 12, y: 14 });
    await flush();
    expect(translate(node(container, 'public.tags'))).toEqual({ x: 900, y: 70 });
  });

  it('clientToDiagram, getNodeClientRect and focusNodes', async () => {
    sizeCanvases();
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(<DiagramCanvas ref={ref} model={MODEL} layout={ALL_PLACED} />);
    await settled(container);
    await flush(50);
    act(() => ref.current!.setViewport({ x: 100, y: 50, zoom: 2 }));
    expect(ref.current!.clientToDiagram(300, 250)).toEqual({ x: 100, y: 100 });
    expect(ref.current!.getNodeClientRect('public.users')).toMatchObject({ width: 0, height: 0 });
    expect(ref.current!.getNodeClientRect('public.nope')).toBeNull();
    act(() => ref.current!.focusNodes(['public.tags'], { duration: 0, maxZoom: 1, padding: 10 }));
    await flush();
    const vp = ref.current!.getViewport();
    expect(vp.zoom).toBe(1);
    const t = ref.current!.getGeometry()!.nodes['public.tags']!;
    expect(vp.x + (t.x + t.width / 2) * vp.zoom).toBeCloseTo(400, 0);
  });
});

describe('DiagramCanvas v1: edge and pane events', () => {
  it('reports edge clicks and context menus with the ref id; edges carry data-id', async () => {
    const onEdgeClick = vi.fn<(e: CanvasEdgeEvent) => void>();
    const onEdgeContextMenu = vi.fn<(e: CanvasEdgeEvent) => void>();
    const { container } = render(
      <DiagramCanvas
        model={MODEL}
        layout={ALL_PLACED}
        onEdgeClick={onEdgeClick}
        onEdgeContextMenu={onEdgeContextMenu}
      />,
    );
    await settled(container);
    const hit = edge(container, REF_POSTS_USERS).querySelector('.rv-edge-hit')!;
    expect(hit).not.toBeNull();
    fireEvent.click(hit, { clientX: 7, clientY: 8 });
    const ref = MODEL.refs.find((r) => r.id === REF_POSTS_USERS)!;
    expect(onEdgeClick).toHaveBeenCalledWith({
      id: REF_POSTS_USERS,
      span: ref.span,
      clientX: 7,
      clientY: 8,
    });
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 3 });
    hit.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onEdgeContextMenu.mock.calls[0]![0]).toMatchObject({ id: REF_POSTS_USERS, clientX: 3 });
    cleanup();
    // Without handlers edges take no pointer events (no hit path).
    const plain = render(<DiagramCanvas model={MODEL} layout={ALL_PLACED} />);
    await settled(plain.container);
    expect(plain.container.querySelector('.rv-edge-hit')).toBeNull();
    expect(edge(plain.container, REF_TAGS_POSTS)).toBeTruthy();
  });

  it('reports pane context menus and double-clicks in diagram coordinates', async () => {
    sizeCanvases();
    const onPaneContextMenu = vi.fn<(e: CanvasPaneEvent) => void>();
    const onPaneDoubleClick = vi.fn<(e: CanvasPaneEvent) => void>();
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(
      <DiagramCanvas
        ref={ref}
        model={MODEL}
        layout={ALL_PLACED}
        onPaneContextMenu={onPaneContextMenu}
        onPaneDoubleClick={onPaneDoubleClick}
      />,
    );
    await settled(container);
    await flush(50);
    act(() => ref.current!.setViewport({ x: 10, y: 20, zoom: 0.5 }));
    const pane = container.querySelector('.react-flow__pane')!;
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 110,
      clientY: 70,
    });
    act(() => {
      pane.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(onPaneContextMenu).toHaveBeenCalledWith({ clientX: 110, clientY: 70, x: 200, y: 100 });
    fireEvent.doubleClick(pane, { clientX: 60, clientY: 45 });
    expect(onPaneDoubleClick).toHaveBeenCalledWith({ clientX: 60, clientY: 45, x: 100, y: 50 });
    // A double-click on a node is not a pane double-click.
    fireEvent.doubleClick(node(container, 'public.users'));
    expect(onPaneDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('leaves the native context menu alone without a pane handler', async () => {
    const { container } = render(<DiagramCanvas model={MODEL} layout={ALL_PLACED} />);
    await settled(container);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    container.querySelector('.react-flow__pane')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('DiagramCanvas v1: displayModel (diff)', () => {
  const MERGED = compile(SRC + '\nTable removed_one {\n  id int [pk]\n}\n');

  it('draws tables only in displayModel without reporting them', async () => {
    const { changes, onChange } = recorder();
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(
      <Harness
        ref={ref}
        model={MODEL}
        displayModel={MERGED}
        initial={ALL_PLACED}
        editable
        onChange={onChange}
      />,
    );
    await settled(container);
    await flush(250);
    // Placed by the sync layout, never reported ('place' or otherwise); ELK not loaded.
    const removed = node(container, 'public.removed_one');
    expect(changes).toEqual([]);
    expect(layoutAsyncSpy).not.toHaveBeenCalled();
    // Dragging it, or placing it through the handle, reports nothing either.
    dragNode(removed, 10, 10, 40, 40);
    await act(async () => {
      ref.current!.placeNodes({ 'public.removed_one': { x: 1, y: 2 } });
    });
    await flush();
    expect(changes).toEqual([]);
    // A real node in the same canvas still reports.
    dragNode(node(container, 'public.lonely'), 10, 10, 20, 0);
    await flush();
    expect(changes.map(([, c]) => c)).toEqual([
      { kind: 'move', view: '*', ids: ['public.lonely'] },
    ]);
  });
});

describe('DiagramCanvas v1: routing', () => {
  it('routes refs around unrelated tables, and fully again after a drag', async () => {
    // a → c with b in between on the same row: the phase-2 route ran straight under b.
    const m = compile(`
Table a {
  id int [pk]
}
Table b {
  id int [pk]
}
Table c {
  id int [pk]
  a_id int [ref: > a.id]
}
`);
    const placed = layoutWith({
      'public.a': { x: 0, y: 0 },
      'public.b': { x: 400, y: 0 },
      'public.c': { x: 800, y: 0 },
    });
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(<Harness ref={ref} model={m} initial={placed} editable />);
    await settled(container);
    const id = m.refs[0]!.id;
    const pathOf = () => edge(container, id).querySelector('.rv-ref path')!.getAttribute('d');
    const ctx = (avoid: 'tables' | 'none') => ({
      model: m,
      geometry: ref.current!.getGeometry()!,
      detailLevel: 'all' as const,
      edgeStyle: 'orthogonal' as const,
      avoid,
    });
    expect(pathOf()).toBe(routeAll(ctx('tables')).get(id)!.path);
    expect(pathOf()).not.toBe(routeAll(ctx('none')).get(id)!.path);
    dragNode(node(container, 'public.b'), 410, 10, 0, 37);
    await flush();
    expect(pathOf()).toBe(routeAll(ctx('tables')).get(id)!.path);
  });
});

describe('canvas v1 pure helpers', () => {
  it('unplacedIds: a collapsed group stands for its members', () => {
    const saved = {
      nodes: { 'group:blog': { collapsed: true }, 'public.tags': { x: 1, y: 2 } },
    };
    expect(unplacedIds(MODEL, saved)).toEqual(['note:intro', 'public.lonely', 'group:blog']);
    expect(
      unplacedIds(MODEL, {
        nodes: { ...saved.nodes, 'group:blog': { x: 3, y: 4, collapsed: true } },
      }),
    ).toEqual(['note:intro', 'public.lonely']);
    expect(unplacedIds(MODEL, null)).toEqual([
      'note:intro',
      'public.users',
      'public.posts',
      'public.tags',
      'public.lonely',
    ]);
  });

  it('placedBox finds tables, notes and collapsed groups only', () => {
    const g = geometryModule.gridLayout(MODEL);
    expect(placedBox(g, 'public.users')).toBe(g.nodes['public.users']);
    expect(placedBox(g, 'group:blog')).toBeUndefined();
    const collapsed = {
      ...g,
      groups: {
        'group:blog': { id: 'group:blog', x: 0, y: 0, width: 10, height: 10, collapsed: true },
      },
    };
    expect(placedBox(collapsed, 'group:blog')).toBe(collapsed.groups['group:blog']);
    expect(placedBox(g, 'toString')).toBeUndefined();
  });

  it('moveNodes takes sizes too (a resize in progress)', () => {
    const g = geometryModule.gridLayout(MODEL);
    const n = g.nodes['note:intro']!;
    const same = geometryModule.moveNodes(
      MODEL,
      g,
      new Map([['note:intro', { x: n.x, y: n.y, width: n.width, height: n.height }]]),
    );
    expect(same).toBe(g);
    const r = geometryModule.moveNodes(
      MODEL,
      g,
      new Map([['note:intro', { x: n.x, y: n.y, width: 300, height: 120 }]]),
    );
    expect(r.nodes['note:intro']).toMatchObject({ x: n.x, y: n.y, width: 300, height: 120 });
    expect(r.bounds.width).toBeGreaterThanOrEqual(g.bounds.width);
  });
});
