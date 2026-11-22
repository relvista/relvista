// @vitest-environment jsdom
import {
  compileDbml,
  emptyLayout,
  parseLayout,
  type DiagramModel,
  type Layout,
} from '@relvista/core';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DiagramCanvas,
  type DiagramCanvasHandle,
  type DiagramCanvasProps,
} from '../src/canvas/DiagramCanvas.js';
import type { LayoutChange } from '../src/canvas/types.js';

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO);
  if (!('DOMMatrixReadOnly' in globalThis)) {
    class M {
      m22 = 1;
      constructor(_t?: string) {}
    }
    vi.stubGlobal('DOMMatrixReadOnly', M);
  }
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
}
TableGroup blog {
  users
  posts
}
Note intro {
  'hello'
}
DiagramView only_users { Tables { users } }
`;

function compile(src: string): DiagramModel {
  const { model, diagnostics } = compileDbml(src);
  if (!model) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return model;
}
const MODEL = compile(SRC);

function layoutWith(nodes: Record<string, { x: number; y: number; pinned?: boolean }>): Layout {
  return { ...emptyLayout(), views: { '*': { nodes } } };
}
const ALL_PLACED = layoutWith({
  'public.users': { x: 10, y: 20 },
  'public.posts': { x: 400, y: 20, pinned: true },
  'public.tags': { x: 10, y: 400 },
  'note:intro': { x: 700, y: 400 },
});

async function flush(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Waits until the canvas reports its layout as done. */
async function settled(root: ParentNode) {
  for (let i = 0; i < 100; i++) {
    if (root.querySelector('.rv-canvas[data-rv-layout="done"]')) return;
    await flush(20);
  }
  throw new Error('layout never finished');
}

function node(root: ParentNode, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${id.replace(/["\\]/g, '\\$&')}"]`,
  );
  if (!el) throw new Error(`no node ${id}`);
  return el;
}

function translate(el: HTMLElement): { x: number; y: number } {
  // CSSOM serialises `translate(x, 0)` as `translate(x)` (jsdom 31 does too): ty defaults to 0.
  const m = /translate\(([-\d.]+)px(?:,\s*([-\d.]+)px)?\)/.exec(el.style.transform)!;
  return { x: Number(m[1]), y: Number(m[2] ?? 0) };
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

describe('DiagramCanvas', () => {
  it('draws controlled positions, with the root test hooks', async () => {
    const { container } = render(<DiagramCanvas model={MODEL} layout={ALL_PLACED} />);
    await settled(container);
    const root = container.querySelector('.rv-canvas')!;
    expect(root.getAttribute('data-rv-color-mode')).toBe('light');
    expect(root.getAttribute('data-rv-editable')).toBe('false');
    expect(translate(node(container, 'public.users'))).toEqual({ x: 10, y: 20 });
    expect(translate(node(container, 'note:intro'))).toEqual({ x: 700, y: 400 });
    expect(node(container, 'public.users').classList.contains('react-flow__node-rvTable')).toBe(
      true,
    );
    expect(node(container, 'note:intro').classList.contains('react-flow__node-rvNote')).toBe(true);
    expect(node(container, 'group:blog').classList.contains('react-flow__node-rvGroup')).toBe(true);
  });

  it('shows nothing for a null model', async () => {
    const { container } = render(<DiagramCanvas model={null} layout={null} />);
    await flush();
    expect(container.querySelector('.react-flow__node')).toBeNull();
    expect(container.querySelector('.rv-canvas[data-rv-layout="done"]')).not.toBeNull();
  });

  it('read-only never calls onLayoutChange', async () => {
    const onLayoutChange = vi.fn();
    const status = vi.fn();
    const { container } = render(
      <DiagramCanvas
        model={MODEL}
        layout={null}
        onLayoutChange={onLayoutChange}
        onLayoutStatus={status}
      />,
    );
    await settled(container);
    await flush(200);
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith('done');
  });

  it('editable reports one "place" with integer positions for the unplaced nodes only', async () => {
    const changes: LayoutChange[] = [];
    const layouts: Layout[] = [];
    const initial = layoutWith({ 'public.users': { x: 10, y: 20 } });
    const { container } = render(
      <Harness
        model={MODEL}
        initial={initial}
        editable
        onChange={(next, c) => {
          layouts.push(next);
          changes.push(c);
        }}
      />,
    );
    await settled(container);
    await flush(250);
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.kind).toBe('place');
    expect(c.view).toBe('*');
    expect(c.ids.sort()).toEqual(['note:intro', 'public.posts', 'public.tags']);
    const nodes = layouts[0]!.views['*']!.nodes;
    expect(nodes['public.users']).toEqual({ x: 10, y: 20 });
    for (const id of c.ids) {
      expect(Number.isInteger(nodes[id]!.x)).toBe(true);
      expect(Number.isInteger(nodes[id]!.y)).toBe(true);
    }
    expect(parseLayout(layouts[0]).ok).toBe(true);
    expect(container.querySelector('.rv-canvas')!.getAttribute('data-rv-editable')).toBe('true');
    // Saved now: the drawn positions are the reported ones.
    expect(translate(node(container, 'public.posts'))).toEqual({
      x: nodes['public.posts']!.x,
      y: nodes['public.posts']!.y,
    });
  });

  it('writes placements of a named view as overrides of that view', async () => {
    const changes: [Layout, LayoutChange][] = [];
    const { container } = render(
      <Harness
        model={MODEL}
        initial={ALL_PLACED}
        view="only_users"
        editable
        onChange={(n, c) => changes.push([n, c])}
      />,
    );
    await settled(container);
    await flush(100);
    // Everything visible in the view already has a default-view position.
    expect(changes).toHaveLength(0);
    const ref = createRef<DiagramCanvasHandle>();
    cleanup();
    const r2 = render(
      <Harness
        ref={ref}
        model={MODEL}
        initial={ALL_PLACED}
        view="only_users"
        editable
        onChange={(n, c) => changes.push([n, c])}
      />,
    );
    await settled(r2.container);
    await act(async () => {
      ref.current!.setNodeSettings(['public.users'], { collapsed: true });
    });
    const [next, change] = changes[0]!;
    expect(change).toEqual({
      kind: 'settings',
      view: 'only_users',
      ids: ['public.users'],
      settings: { collapsed: true },
    });
    expect(next.views['only_users']!.nodes['public.users']).toEqual({ collapsed: true });
    expect(next.views['*']).toBe(ALL_PLACED.views['*']);
  });

  it('falls back to all tables for an unknown view', async () => {
    const onUnknownView = vi.fn();
    const { container } = render(
      <DiagramCanvas model={MODEL} layout={ALL_PLACED} view="typo" onUnknownView={onUnknownView} />,
    );
    await settled(container);
    expect(onUnknownView).toHaveBeenCalledWith('typo');
    expect(container.querySelectorAll('.react-flow__node-rvTable')).toHaveLength(3);
  });

  it('draws the highlight ring for highlightedNodeId and ignores unknown ids', async () => {
    const { container, rerender } = render(
      <DiagramCanvas model={MODEL} layout={ALL_PLACED} highlightedNodeId="public.posts" />,
    );
    await settled(container);
    const ring = () => Array.from(container.querySelectorAll('.rv-node.rv-highlighted'));
    expect(ring()).toHaveLength(1);
    expect(node(container, 'public.posts').querySelector('.rv-highlighted')).not.toBeNull();
    // Unlike hover, a highlight dims nothing.
    expect(node(container, 'public.tags').querySelector('.rv-table[opacity]')).toBeNull();
    fireEvent.mouseEnter(node(container, 'public.posts'));
    await flush();
    expect(node(container, 'public.tags').querySelector('.rv-table[opacity]')).not.toBeNull();
    fireEvent.mouseLeave(node(container, 'public.posts'));
    await flush();
    rerender(<DiagramCanvas model={MODEL} layout={ALL_PLACED} highlightedNodeId="public.nope" />);
    await flush();
    expect(ring()).toHaveLength(0);
    rerender(<DiagramCanvas model={MODEL} layout={ALL_PLACED} highlightedNodeId="group:blog" />);
    await flush();
    expect(node(container, 'group:blog').querySelector('.rv-highlighted')).not.toBeNull();
  });

  it('reports node clicks with id, kind and span', async () => {
    const onNodeClick = vi.fn();
    const { container } = render(
      <DiagramCanvas model={MODEL} layout={ALL_PLACED} onNodeClick={onNodeClick} editable />,
    );
    await settled(container);
    fireEvent.click(node(container, 'public.users'), { clientX: 5, clientY: 6, shiftKey: true });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    const e = onNodeClick.mock.calls[0]![0];
    expect(e).toMatchObject({
      id: 'public.users',
      kind: 'table',
      clientX: 5,
      clientY: 6,
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
    });
    const users = MODEL.tables.find((t) => t.id === 'public.users')!;
    expect(e.span).toEqual(users.span);
    fireEvent.click(node(container, 'note:intro'));
    expect(onNodeClick.mock.calls[1]![0]).toMatchObject({ id: 'note:intro', kind: 'note' });
    // Groups: their header band.
    fireEvent.click(node(container, 'group:blog').querySelector('.rv-group-drag')!);
    expect(onNodeClick.mock.calls[2]![0]).toMatchObject({ id: 'group:blog', kind: 'group' });
    // Enter on a focused node: a keyboard click.
    fireEvent.keyDown(node(container, 'public.tags'), { key: 'Enter' });
    expect(onNodeClick.mock.calls[3]![0]).toMatchObject({
      id: 'public.tags',
      kind: 'table',
      source: 'keyboard',
    });
  });

  it('prevents the native context menu only with a handler', async () => {
    const onNodeContextMenu = vi.fn();
    const { container } = render(
      <DiagramCanvas model={MODEL} layout={ALL_PLACED} onNodeContextMenu={onNodeContextMenu} />,
    );
    await settled(container);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    node(container, 'public.users').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onNodeContextMenu.mock.calls[0]![0]).toMatchObject({ id: 'public.users' });
  });

  it('read-only opens the details card on click; editable does not by default', async () => {
    const { container, rerender } = render(<DiagramCanvas model={MODEL} layout={ALL_PLACED} />);
    await settled(container);
    fireEvent.click(node(container, 'public.users'));
    expect(container.querySelector('.rv-sidecard')).not.toBeNull();
    rerender(<DiagramCanvas model={MODEL} layout={ALL_PLACED} editable />);
    await flush();
    fireEvent.click(node(container, 'public.posts'));
    expect(container.querySelector('.rv-sidecard')).toBeNull();
  });

  it('exports SVG through the handle', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(<DiagramCanvas ref={ref} model={MODEL} layout={ALL_PLACED} />);
    await settled(container);
    const svg = ref.current!.exportSvg({ title: 'Blog', colorMode: 'dark' })!;
    for (const name of ['users', 'posts', 'tags']) expect(svg).toContain(`>${name}<`);
    expect(svg).toContain('<title>Blog</title>');
    expect(ref.current!.getGeometry()!.nodes['public.users']).toMatchObject({ x: 10, y: 20 });
    const empty = createRef<DiagramCanvasHandle>();
    render(<DiagramCanvas ref={empty} model={null} layout={null} />);
    expect(empty.current!.exportSvg()).toBeNull();
  });

  it('runAutoLayout("unpinned") keeps pinned positions and reports "auto-layout"', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const changes: [Layout, LayoutChange][] = [];
    const { container } = render(
      <Harness
        ref={ref}
        model={MODEL}
        initial={ALL_PLACED}
        editable
        onChange={(n, c) => changes.push([n, c])}
      />,
    );
    await settled(container);
    let result: Layout | null = null;
    await act(async () => {
      result = await ref.current!.runAutoLayout('unpinned');
    });
    expect(changes).toHaveLength(1);
    const [next, change] = changes[0]!;
    expect(result).toBe(next);
    expect(change.kind).toBe('auto-layout');
    if (change.kind !== 'auto-layout') return;
    expect(change.scope).toBe('unpinned');
    expect(change.ids.sort()).toEqual(['note:intro', 'public.tags', 'public.users']);
    const nodes = next.views['*']!.nodes;
    expect(nodes['public.posts']).toEqual({ x: 400, y: 20, pinned: true });
    for (const id of change.ids) {
      expect(Number.isInteger(nodes[id]!.x)).toBe(true);
    }
    expect(parseLayout(next).ok).toBe(true);
    // 'unplaced' with everything placed: nothing to do, still one change.
    await act(async () => {
      await ref.current!.runAutoLayout('unplaced');
    });
    expect(changes[1]![1]).toMatchObject({ kind: 'auto-layout', scope: 'unplaced', ids: [] });
  });

  it('setNodeSettings reports "settings" in the default view', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const changes: [Layout, LayoutChange][] = [];
    const { container } = render(
      <Harness
        ref={ref}
        model={MODEL}
        initial={ALL_PLACED}
        editable
        onChange={(n, c) => changes.push([n, c])}
      />,
    );
    await settled(container);
    await act(async () => {
      ref.current!.setNodeSettings(['public.users', 'public.posts'], { pinned: true });
    });
    const [next, change] = changes[0]!;
    expect(change).toEqual({
      kind: 'settings',
      view: '*',
      ids: ['public.users', 'public.posts'],
      settings: { pinned: true },
    });
    expect(next.views['*']!.nodes['public.users']).toEqual({ x: 10, y: 20, pinned: true });
  });

  it('never moves the viewport because the layout or model changed', async () => {
    sizeCanvases();
    const ref = createRef<DiagramCanvasHandle>();
    const { container, rerender } = render(
      <DiagramCanvas ref={ref} model={MODEL} layout={ALL_PLACED} resetKey="doc" editable />,
    );
    await settled(container);
    await flush(50);
    act(() => ref.current!.setViewport({ x: 33, y: 44, zoom: 0.5 }));
    await flush();
    expect(ref.current!.getViewport()).toEqual({ x: 33, y: 44, zoom: 0.5 });
    const moved = layoutWith({
      ...ALL_PLACED.views['*']!.nodes,
      'public.users': { x: 900, y: 900 },
    });
    rerender(<DiagramCanvas ref={ref} model={MODEL} layout={moved} resetKey="doc" editable />);
    await flush(80);
    const model2 = compile(SRC + '\nTable extra {\n  id int\n}\n');
    rerender(<DiagramCanvas ref={ref} model={model2} layout={moved} resetKey="doc" editable />);
    await settled(container);
    await flush(250);
    expect(ref.current!.getViewport()).toEqual({ x: 33, y: 44, zoom: 0.5 });
    expect(ref.current!.getGeometry()!.nodes['public.users']).toMatchObject({ x: 900, y: 900 });
    // A new document (resetKey) gets its initial view again.
    rerender(<DiagramCanvas ref={ref} model={model2} layout={moved} resetKey="other" editable />);
    await flush(80);
    expect(ref.current!.getViewport()).not.toEqual({ x: 33, y: 44, zoom: 0.5 });
  });

  it('applies a saved viewport of the view on reset', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const withViewport: Layout = {
      ...ALL_PLACED,
      views: { '*': { ...ALL_PLACED.views['*']!, viewport: { x: 5, y: 6, zoom: 0.7 } } },
    };
    const { container } = render(<DiagramCanvas ref={ref} model={MODEL} layout={withViewport} />);
    await settled(container);
    await flush(50);
    expect(ref.current!.getViewport()).toEqual({ x: 5, y: 6, zoom: 0.7 });
  });

  it('initialViewport wins for the first view of its resetKey only', async () => {
    sizeCanvases();
    const ref = createRef<DiagramCanvasHandle>();
    const vp = { x: -63, y: 48, zoom: 0.726 };
    const { container, rerender } = render(
      <DiagramCanvas
        ref={ref}
        model={MODEL}
        layout={ALL_PLACED}
        resetKey="a"
        initialViewport={vp}
      />,
    );
    await settled(container);
    await flush(50);
    expect(ref.current!.getViewport()).toEqual(vp);
    rerender(
      <DiagramCanvas
        ref={ref}
        model={MODEL}
        layout={ALL_PLACED}
        resetKey="b"
        initialViewport={null}
      />,
    );
    await flush(80);
    expect(ref.current!.getViewport()).not.toEqual(vp);
  });

  it('reports the layout status again for a new resetKey even when it stays "done"', async () => {
    const status = vi.fn();
    const { container, rerender } = render(
      <DiagramCanvas model={MODEL} layout={ALL_PLACED} resetKey="a" onLayoutStatus={status} />,
    );
    await settled(container);
    await flush();
    expect(status).toHaveBeenLastCalledWith('done');
    const calls = status.mock.calls.length;
    rerender(
      <DiagramCanvas model={MODEL} layout={ALL_PLACED} resetKey="b" onLayoutStatus={status} />,
    );
    await flush();
    expect(status.mock.calls.length).toBeGreaterThan(calls);
    expect(status).toHaveBeenLastCalledWith('done');
  });

  it('runAutoLayout reports nothing when the document changed while ELK ran', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const changes: LayoutChange[] = [];
    const onChange = (_: Layout, c: LayoutChange) => changes.push(c);
    const { container, rerender } = render(
      <DiagramCanvas
        ref={ref}
        model={MODEL}
        layout={ALL_PLACED}
        resetKey="a"
        editable
        onLayoutChange={onChange}
      />,
    );
    await settled(container);
    // ELK always resolves after a macrotask at least; the document changes before that.
    const p = ref.current!.runAutoLayout('unpinned');
    rerender(
      <DiagramCanvas
        ref={ref}
        model={compile('Table other {\n  id int\n}\n')}
        layout={null}
        resetKey="b"
        editable
        onLayoutChange={onChange}
      />,
    );
    let result: Layout | null | undefined;
    await act(async () => {
      result = await p;
    });
    expect(result).toBeNull();
    expect(changes.filter((c) => c.kind === 'auto-layout')).toEqual([]);
  });

  it('selects nodes in editable mode (Shift adds) and reports them', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(<Harness ref={ref} model={MODEL} initial={ALL_PLACED} editable />);
    await settled(container);
    fireEvent.click(node(container, 'public.users'));
    await flush();
    fireEvent.keyDown(document, { key: 'Shift' });
    fireEvent.click(node(container, 'public.tags'), { shiftKey: true });
    fireEvent.keyUp(document, { key: 'Shift' });
    await flush();
    expect(ref.current!.getSelection().sort()).toEqual(['public.tags', 'public.users']);
    expect(node(container, 'public.users').querySelector('.rv-selected')).not.toBeNull();
  });

  it('commits arrow-key nudges of the selection as one "move"', async () => {
    const ref = createRef<DiagramCanvasHandle>();
    const changes: [Layout, LayoutChange][] = [];
    const { container } = render(
      <Harness
        ref={ref}
        model={MODEL}
        initial={ALL_PLACED}
        editable
        onChange={(n, c) => changes.push([n, c])}
      />,
    );
    await settled(container);
    fireEvent.click(node(container, 'public.users'));
    await flush();
    const target = node(container, 'public.users');
    fireEvent.keyDown(target, { key: 'ArrowRight' });
    fireEvent.keyDown(target, { key: 'ArrowRight' });
    fireEvent.keyDown(target, { key: 'ArrowDown', shiftKey: true });
    await flush(50);
    expect(changes).toHaveLength(0);
    expect(translate(node(container, 'public.users'))).toEqual({ x: 30, y: 21 });
    await flush(350);
    expect(changes).toHaveLength(1);
    const [next, change] = changes[0]!;
    expect(change).toEqual({ kind: 'move', view: '*', ids: ['public.users'] });
    expect(next.views['*']!.nodes['public.users']).toEqual({ x: 30, y: 21 });
  });
});
