// @vitest-environment jsdom
// Frozen diagrams (DbmlViewer `frozen`, docs/decisions/0007-frozen-diagrams.md): the layout starts
// locked (no drags, no collapsing or expanding groups), the toolbar's lock button unlocks it, and
// locking it again puts back the layout's arrangement without moving the viewport.
import { emptyLayout, type Layout, type NodeLayout } from '@relvista/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DbmlViewer, type DbmlViewerProps } from '../src/viewer/DbmlViewer.js';

beforeAll(() => {
  // React Flow measures nodes through a ResizeObserver and offsetWidth/Height (see canvas-v1).
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
  // The React Flow container has a size, so drags in its middle do not auto-pan.
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
  for (const [prop, value] of [
    ['clientWidth', 800],
    ['clientHeight', 600],
  ] as const) {
    Object.defineProperty(HTMLDivElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('rv-canvas') ? value : 0;
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

afterEach(() => cleanup());

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
`;

function layoutWith(nodes: Record<string, NodeLayout>): Layout {
  return { ...emptyLayout(), views: { '*': { nodes } } };
}
/** Build-time positions of every table (no ELK in the tests). */
const SSR = layoutWith({
  'public.users': { x: 40, y: 60 },
  'public.posts': { x: 420, y: 60 },
  'public.tags': { x: 800, y: 60 },
  'public.lonely': { x: 40, y: 400 },
});
/** The author's layout: the blog group collapsed into a card. */
const COLLAPSED = layoutWith({ 'group:blog': { x: 40, y: 60, collapsed: true } });

async function flush(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function viewer(props: Partial<DbmlViewerProps> = {}) {
  const r = render(<DbmlViewer source={SRC} ssrLayout={SSR} {...props} />);
  for (let i = 0; i < 100; i++) {
    if (r.container.querySelector('.rv-viewer[data-rv-layout="done"]')) {
      await flush(150);
      return r;
    }
    await flush(20);
  }
  throw new Error('layout never finished');
}

function nodeOrNull(root: ParentNode, id: string): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLElement>('.react-flow__node')).find(
      (n) => n.getAttribute('data-id') === id,
    ) ?? null
  );
}
function node(root: ParentNode, id: string): HTMLElement {
  const el = nodeOrNull(root, id);
  if (!el) throw new Error(`no node ${id}`);
  return el;
}
function canvas(root: ParentNode): HTMLElement {
  return root.querySelector<HTMLElement>('.rv-canvas')!;
}
/** The pan and zoom React Flow shows (its viewport element's transform). */
function viewport(root: ParentNode): string {
  return root.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
}
function translate(el: HTMLElement): { x: number; y: number } {
  // CSSOM serialises `translate(x, 0)` as `translate(x)` (jsdom 31 does too): ty defaults to 0.
  const m = /translate\(([-\d.]+)px(?:,\s*([-\d.]+)px)?\)/.exec(el.style.transform)!;
  return { x: Number(m[1]), y: Number(m[2] ?? 0) };
}
function collapsed(root: ParentNode, id: string): boolean {
  return node(root, id).getAttribute('data-rv-collapsed') === 'true';
}
function lockButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /^(Unlock|Lock) layout$/ });
}

/** A mouse event React Flow's d3-drag accepts in jsdom (see canvas-v1). */
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
/** Drags a node by (dx, dy), starting past React Flow's drag threshold (see canvas-v1). */
function dragNode(el: HTMLElement, x: number, y: number, dx: number, dy: number): void {
  const [sx, sy] = [x + 4, y + 4];
  mouse(el, 'mousedown', x, y);
  mouse(el, 'mousemove', sx, sy);
  mouse(el, 'mousemove', sx + dx / 2, sy + dy / 2);
  mouse(el, 'mousemove', sx + dx, sy + dy);
  mouse(el, 'mouseup', sx + dx, sy + dy);
}

describe('DbmlViewer frozen: the lock button', () => {
  it('shows only in a frozen viewer whose nodes can be dragged, right after Fit', async () => {
    const plain = await viewer();
    expect(lockButton()).toBeNull();
    expect(canvas(plain.container).hasAttribute('data-rv-locked')).toBe(false);
    cleanup();

    const frozen = await viewer({ frozen: true });
    const button = lockButton()!;
    expect(button.getAttribute('aria-label')).toBe('Unlock layout');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toMatch(/^Unlock layout \(.*move tables/);
    const items = Array.from(
      frozen.container.querySelectorAll('.rv-toolbar [data-rv-item]'),
      (el) => el.getAttribute('data-rv-item'),
    );
    expect(items.indexOf('lock')).toBe(items.lastIndexOf('fit') + 1);
    cleanup();

    // Never movable: nothing to unlock.
    await viewer({ frozen: true, draggable: false });
    expect(lockButton()).toBeNull();
    cleanup();
    // A toolbar without the item.
    await viewer({ frozen: true, toolbar: ['zoom', 'fit', 'fullscreen'] });
    expect(lockButton()).toBeNull();
  });

  it('is in the toolbar keyboard path', async () => {
    await viewer({ frozen: true });
    const fit = screen.getByRole('button', { name: 'Fit to view' });
    fit.focus();
    fireEvent.keyDown(fit, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(lockButton());
  });
});

describe('DbmlViewer frozen: locked', () => {
  it('tables cannot be dragged with the mouse or moved with the arrow keys', async () => {
    const { container } = await viewer({ frozen: true });
    expect(canvas(container).getAttribute('data-rv-locked')).toBe('true');
    const tags = node(container, 'public.tags');
    const at = translate(tags);
    // No `draggable` class: no grab cursor, no React Flow drag.
    expect(tags.classList.contains('draggable')).toBe(false);
    dragNode(tags, 300, 300, 120, 80);
    await flush();
    expect(translate(node(container, 'public.tags'))).toEqual(at);
    tags.focus();
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      fireEvent.keyDown(tags, { key });
      fireEvent.keyDown(tags, { key, shiftKey: true });
    }
    await flush();
    expect(translate(node(container, 'public.tags'))).toEqual(at);
  });

  it('double-clicking a group neither collapses nor expands it', async () => {
    const open = await viewer({ frozen: true });
    fireEvent.doubleClick(node(open.container, 'group:blog').querySelector('.rv-group-drag')!);
    await flush();
    expect(collapsed(open.container, 'group:blog')).toBe(false);
    expect(nodeOrNull(open.container, 'public.users')).not.toBeNull();
    cleanup();

    const shut = await viewer({ frozen: true, layout: COLLAPSED });
    const card = node(shut.container, 'group:blog');
    expect(collapsed(shut.container, 'group:blog')).toBe(true);
    // The card does not offer what it cannot do.
    expect(card.getAttribute('aria-label')).not.toMatch(/double-click/i);
    expect(card.classList.contains('draggable')).toBe(false);
    fireEvent.doubleClick(card);
    await flush();
    expect(collapsed(shut.container, 'group:blog')).toBe(true);
    expect(nodeOrNull(shut.container, 'public.users')).toBeNull();
  });

  it('the rest keeps working: details card, search highlight, zoom', async () => {
    const { container } = await viewer({ frozen: true });
    fireEvent.click(node(container, 'public.tags'));
    await flush();
    expect(container.querySelector('.rv-sidecard')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await flush();
    fireEvent.change(screen.getByRole('combobox', { name: 'Search' }), {
      target: { value: 'tags' },
    });
    await flush(60);
    expect(
      node(container, 'public.tags').querySelector('.rv-table')!.getAttribute('data-rv-tone'),
    ).toBe('match');
    const before = viewport(container);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await flush(250);
    expect(viewport(container)).not.toBe(before);
  });

  it('draggable={false} wins over unlocking; frozen still blocks collapsing', async () => {
    const both = await viewer({ frozen: true, draggable: false });
    fireEvent.doubleClick(node(both.container, 'group:blog').querySelector('.rv-group-drag')!);
    await flush();
    expect(collapsed(both.container, 'group:blog')).toBe(false);
    cleanup();
    // Without `frozen`, as before: no drags, but groups collapse.
    const fixed = await viewer({ draggable: false });
    expect(node(fixed.container, 'public.tags').classList.contains('draggable')).toBe(false);
    fireEvent.doubleClick(node(fixed.container, 'group:blog').querySelector('.rv-group-drag')!);
    await flush();
    expect(collapsed(fixed.container, 'group:blog')).toBe(true);
  });
});

describe('DbmlViewer frozen: unlocking and locking again', () => {
  it('unlocked, tables drag and groups collapse (locally); locked again, both are undone', async () => {
    const { container } = await viewer({ frozen: true });
    const tagsAt = translate(node(container, 'public.tags'));
    fireEvent.click(lockButton()!);
    await flush();
    const button = lockButton()!;
    expect(button.getAttribute('aria-label')).toBe('Lock layout');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(canvas(container).hasAttribute('data-rv-locked')).toBe(false);

    fireEvent.doubleClick(node(container, 'group:blog').querySelector('.rv-group-drag')!);
    await flush();
    expect(collapsed(container, 'group:blog')).toBe(true);
    expect(nodeOrNull(container, 'public.users')).toBeNull();
    const tags = node(container, 'public.tags');
    expect(tags.classList.contains('draggable')).toBe(true);
    dragNode(tags, 300, 300, 120, 80);
    await flush();
    expect(translate(node(container, 'public.tags'))).not.toEqual(tagsAt);

    const vp = viewport(container);
    fireEvent.click(lockButton()!);
    await flush();
    expect(lockButton()!.getAttribute('aria-pressed')).toBe('true');
    expect(canvas(container).getAttribute('data-rv-locked')).toBe('true');
    expect(translate(node(container, 'public.tags'))).toEqual(tagsAt);
    expect(collapsed(container, 'group:blog')).toBe(false);
    expect(nodeOrNull(container, 'public.users')).not.toBeNull();
    expect(viewport(container)).toBe(vp);
    // They are gone, not hidden: unlocking once more starts from the layout.
    fireEvent.click(lockButton()!);
    await flush();
    expect(collapsed(container, 'group:blog')).toBe(false);
    expect(translate(node(container, 'public.tags'))).toEqual(tagsAt);
  });

  it("locking again restores the layout's collapsed groups too", async () => {
    const { container } = await viewer({ frozen: true, layout: COLLAPSED });
    const tagsAt = translate(node(container, 'public.tags'));
    fireEvent.click(lockButton()!);
    await flush();
    // Expanded by the reader, then a table moved.
    fireEvent.doubleClick(node(container, 'group:blog'));
    await flush();
    expect(nodeOrNull(container, 'public.users')).not.toBeNull();
    dragNode(node(container, 'public.tags'), 300, 300, -90, 60);
    await flush();
    expect(translate(node(container, 'public.tags'))).not.toEqual(tagsAt);

    const vp = viewport(container);
    fireEvent.click(lockButton()!);
    await flush();
    expect(collapsed(container, 'group:blog')).toBe(true);
    expect(nodeOrNull(container, 'public.users')).toBeNull();
    expect(translate(node(container, 'public.tags'))).toEqual(tagsAt);
    expect(viewport(container)).toBe(vp);
  });

  it('follows the frozen prop: false unlocks for good, true locks again', async () => {
    const r = await viewer({ frozen: true });
    fireEvent.click(lockButton()!);
    await flush();
    r.rerender(<DbmlViewer source={SRC} ssrLayout={SSR} frozen={false} />);
    await flush();
    expect(lockButton()).toBeNull();
    expect(node(r.container, 'public.tags').classList.contains('draggable')).toBe(true);
    r.rerender(<DbmlViewer source={SRC} ssrLayout={SSR} frozen />);
    await flush();
    expect(lockButton()!.getAttribute('aria-pressed')).toBe('true');
    expect(node(r.container, 'public.tags').classList.contains('draggable')).toBe(false);
  });
});
