// @vitest-environment jsdom
// DbmlViewer v1 and the navigation components (docs/design/phase3-v1.md §4.7): search, path,
// detail level, focus, deep-link targets, diffAgainst, ssrLayout, link and PDF dialog, keyboard.
import {
  compileDbml,
  emptyLayout,
  shortestPath,
  type DiagramModel,
  type Layout,
  type NodeLayout,
} from '@relvista/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DetailSwitch } from '../src/nav/DetailSwitch.js';
import { FocusControl } from '../src/nav/FocusControl.js';
import { PdfDialog, tiledPageCount } from '../src/nav/PdfDialog.js';
import { pathOrder, pathText } from '../src/nav/path.js';
import { SearchPanel } from '../src/nav/SearchPanel.js';
import { planTiles } from '../src/export/pdf/plan.js';
import { decodeShareHash } from '../src/share/codec.js';
import type { DiagramTarget } from '../src/share/deepLink.js';
import {
  DbmlViewer,
  hitDecorations,
  panelClearance,
  withSsrPositions,
} from '../src/viewer/DbmlViewer.js';
import { DEFAULT_TOOLBAR } from '../src/viewer/Toolbar.js';

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
  // The canvas has a size, so the viewport maths (fit, focusNodes) runs.
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
  title varchar
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
DiagramView only_blog {
  Tables {
    users
    posts
  }
}
`;

function compile(src: string): DiagramModel {
  const { model, diagnostics } = compileDbml(src);
  if (!model) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return model;
}
const MODEL = compile(SRC);

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

async function flush(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function settled(root: ParentNode) {
  for (let i = 0; i < 100; i++) {
    if (root.querySelector('.rv-viewer[data-rv-layout="done"]')) {
      await flush(150);
      return;
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
function tone(root: ParentNode, id: string): string | null {
  return node(root, id).querySelector('.rv-table')!.getAttribute('data-rv-tone');
}
function edgeTone(root: ParentNode, a: string, b: string): string | null {
  const ref = MODEL.refs.find(
    (r) => [r.from.tableId, r.to.tableId].sort().join() === [a, b].sort().join(),
  )!;
  const el = Array.from(root.querySelectorAll('.react-flow__edge')).find(
    (e) => e.getAttribute('data-id') === ref.id,
  );
  return el?.querySelector('[data-rv-tone]')?.getAttribute('data-rv-tone') ?? null;
}
function translate(el: HTMLElement): { x: number; y: number } {
  // CSSOM serialises `translate(x, 0)` as `translate(x)` (jsdom 31 does too): ty defaults to 0.
  const m = /translate\(([-\d.]+)px(?:,\s*([-\d.]+)px)?\)/.exec(el.style.transform)!;
  return { x: Number(m[1]), y: Number(m[2] ?? 0) };
}

async function viewer(props: Partial<Parameters<typeof DbmlViewer>[0]> = {}) {
  const r = render(<DbmlViewer source={SRC} ssrLayout={SSR} {...props} />);
  await settled(r.container);
  return r;
}

async function openSearch() {
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await flush();
  return screen.getByRole('combobox', { name: 'Search' }) as HTMLInputElement;
}

async function type(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await flush(60);
}

describe('DbmlViewer v1: toolbar', () => {
  it('has the §4.7 default order and hides link without an anchor', async () => {
    expect(DEFAULT_TOOLBAR).toEqual([
      'view',
      'search',
      'detail',
      'zoom',
      'fit',
      'fullscreen',
      'export',
      'print',
      'link',
      'open-in-editor',
    ]);
    await viewer();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Detail level' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy link to this diagram' })).toBeNull();
  });

  it('moves between buttons with the arrow keys and opens search with / and Mod+K', async () => {
    const { container } = await viewer();
    const searchButton = screen.getByRole('button', { name: 'Search' });
    searchButton.focus();
    fireEvent.keyDown(searchButton, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Detail level' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(searchButton);
    fireEvent.keyDown(searchButton, { key: 'End' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Print');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByLabelText('Diagram view'));

    // '/' on a node (inside the viewer) opens the panel with the focus in its input.
    const users = node(container, 'public.users');
    users.focus();
    fireEvent.keyDown(users, { key: '/' });
    await flush();
    const input = screen.getByRole('combobox', { name: 'Search' });
    expect(document.activeElement).toBe(input);
    expect(searchButton.getAttribute('aria-expanded')).toBe('true');
    // Esc closes it and gives the focus back.
    fireEvent.keyDown(input, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('combobox', { name: 'Search' })).toBeNull();
    expect(document.activeElement).toBe(users);
    // Mod+K too.
    fireEvent.keyDown(users, { key: 'k', ctrlKey: true });
    await flush();
    expect(screen.getByRole('combobox', { name: 'Search' })).toBeTruthy();
  });

  it('the detail menu changes the drawn rows (radio items, keyboard)', async () => {
    const { container } = await viewer();
    expect(node(container, 'public.posts').querySelectorAll('.rv-column')).toHaveLength(3);
    const button = screen.getByRole('button', { name: 'Detail level' });
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Detail level' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => /^(Names|Keys|All)/.exec(i.textContent ?? '')?.[1])).toEqual([
      'Names',
      'Keys',
      'All',
    ]);
    // The checked item has the focus.
    expect(document.activeElement).toBe(items[2]);
    expect(items[2]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(items[2]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[1]!);
    await flush(100);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    // Keys: id (pk) and user_id (fk) only.
    const cols = Array.from(node(container, 'public.posts').querySelectorAll('.rv-column')).map(
      (c) => c.getAttribute('data-rv-column'),
    );
    expect(cols).toEqual(['id', 'user_id']);
  });
});

describe('DbmlViewer v1: search', () => {
  it('lists hits and decorates them (match, others dimmed)', async () => {
    const { container } = await viewer();
    const input = await openSearch();
    expect(document.activeElement).toBe(input);
    await type(input, 'post');
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options[0]!.textContent).toContain('posts');
    expect(options.some((o) => /tags\.post_id/.test(o.textContent ?? ''))).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(options[0]!.querySelector('mark')?.textContent).toBe('post');
    expect(tone(container, 'public.posts')).toBe('match');
    expect(
      node(container, 'public.tags')
        .querySelector('[data-rv-column="post_id"]')!
        .getAttribute('data-rv-tone'),
    ).toBe('match');
    expect(tone(container, 'public.lonely')).toBeNull();
    // ArrowDown moves the active option.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    // No hits: nothing dimmed, "No matches".
    await type(input, 'zzzz');
    expect(container.querySelector('.rv-nav-status')!.textContent).toBe('No matches');
    expect(tone(container, 'public.posts')).toBeNull();
  });

  it('Enter picks the first hit: panel closes, table lit and focused, decorations cleared', async () => {
    const { container } = await viewer({ editorUrl: 'https://example.org/editor/' });
    const input = await openSearch();
    await type(input, 'tags');
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush(400);
    expect(screen.queryByRole('combobox', { name: 'Search' })).toBeNull();
    const tags = node(container, 'public.tags');
    expect(tags.querySelector('.rv-node')!.classList.contains('rv-highlighted')).toBe(true);
    expect(document.activeElement).toBe(tags);
    expect(tone(container, 'public.posts')).toBeNull();
    // The editor link points at the picked table.
    const link = (await screen.findByLabelText('Open in editor')) as HTMLAnchorElement;
    expect(link.hash).toMatch(/&table=tags$/);
    // Esc drops the highlight.
    fireEvent.keyDown(tags, { key: 'Escape' });
    await flush();
    expect(tags.querySelector('.rv-node')!.classList.contains('rv-highlighted')).toBe(false);
  });

  it('a column hit tones its row', async () => {
    const { container } = await viewer();
    const input = await openSearch();
    await type(input, 'posts.title');
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush(200);
    expect(
      node(container, 'public.posts')
        .querySelector('[data-rv-column="title"]')!
        .getAttribute('data-rv-tone'),
    ).toBe('match');
  });

  it('path mode: tones the path, lists the hops, says when there is none', async () => {
    const { container } = await viewer();
    await openSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Path' }));
    await flush();
    const from = screen.getByRole('combobox', { name: 'From' });
    expect(document.activeElement).toBe(from);
    await type(from, 'users');
    fireEvent.keyDown(from, { key: 'Enter' });
    await flush();
    const to = screen.getByRole('combobox', { name: 'To' });
    expect(document.activeElement).toBe(to);
    await type(to, 'tags');
    fireEvent.keyDown(to, { key: 'Enter' });
    await flush(100);
    const status = container.querySelector('.rv-nav-status')!;
    expect(status.textContent).toBe('users → posts → tags, 2 refs');
    for (const id of ['public.users', 'public.posts', 'public.tags'])
      expect(tone(container, id)).toBe('path');
    expect(tone(container, 'public.lonely')).toBeNull();
    expect(edgeTone(container, 'public.users', 'public.posts')).toBe('path');
    expect(edgeTone(container, 'public.posts', 'public.tags')).toBe('path');

    // Swap reverses the walk.
    fireEvent.click(screen.getByRole('button', { name: 'Swap the two tables' }));
    await flush(60);
    expect(status.textContent).toBe('tags → posts → users, 2 refs');

    // No path to lonely.
    fireEvent.change(to, { target: { value: 'lonely' } });
    await flush();
    fireEvent.keyDown(to, { key: 'Enter' });
    await flush(60);
    expect(status.textContent).toBe('No relationship path between tags and lonely');
    expect(tone(container, 'public.tags')).toBeNull();

    // Esc closes the panel and clears the path.
    fireEvent.keyDown(to, { key: 'Escape' });
    await flush();
    expect(container.querySelector('.rv-nav-search')).toBeNull();
  });
});

describe('DbmlViewer v1: focus', () => {
  it('Show related → focus 1 hop, chip changes hops, Esc exits (one layer per press)', async () => {
    const { container } = await viewer();
    const users = node(container, 'public.users');
    users.focus();
    fireEvent.keyDown(users, { key: 'Enter' });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Show related' }));
    await flush(100);
    const chip = screen.getByRole('group', { name: 'Focus on users' });
    expect(chip.textContent).toContain('Related to users · 1 hop');
    expect(container.querySelector('.rv-canvas')!.getAttribute('data-rv-focus')).toBe('true');
    expect(nodeOrNull(container, 'public.tags')).toBeNull();
    expect(nodeOrNull(container, 'public.lonely')).toBeNull();
    fireEvent.click(within(chip).getByRole('button', { name: 'More hops' }));
    await flush(60);
    expect(chip.textContent).toContain('2 hops');
    expect(nodeOrNull(container, 'public.tags')).not.toBeNull();
    fireEvent.click(within(chip).getByRole('button', { name: 'Fewer hops' }));
    await flush(60);
    // First Esc: the side card; second: focus mode.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await flush();
    expect(container.querySelector('.rv-sidecard')).toBeNull();
    expect(screen.getByRole('group', { name: 'Focus on users' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await flush(60);
    expect(screen.queryByRole('group', { name: 'Focus on users' })).toBeNull();
    expect(nodeOrNull(container, 'public.lonely')).not.toBeNull();
  });
});

describe('DbmlViewer v1: target', () => {
  it('applies a target after the first layout and reports changes (debounced)', async () => {
    const onTargetChange = vi.fn();
    const { container } = await viewer({ target: { table: 'posts', hops: 1 }, onTargetChange });
    await flush(200);
    expect(screen.getByRole('group', { name: 'Focus on posts' }).textContent).toContain('1 hop');
    expect(nodeOrNull(container, 'public.lonely')).toBeNull();
    expect(nodeOrNull(container, 'public.tags')).not.toBeNull();
    await flush(700);
    expect(onTargetChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More hops' }));
    await flush(100);
    expect(onTargetChange).not.toHaveBeenCalled();
    await flush(350);
    expect(onTargetChange).toHaveBeenCalledTimes(1);
    expect(onTargetChange.mock.calls[0]![0]).toEqual({ table: 'posts', hops: 2 });
  });

  it('reports a change the user makes during the quiet time after a target', async () => {
    const onTargetChange = vi.fn();
    await viewer({ target: { table: 'posts', hops: 1 }, onTargetChange });
    // The target is applied 80 ms after the first layout; `viewer` waits 150 ms.
    // Still inside the quiet time (600 ms) of the applied target: the user's input ends it.
    const more = screen.getByRole('button', { name: 'More hops' });
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    await flush(400);
    expect(onTargetChange).toHaveBeenCalledTimes(1);
    expect(onTargetChange.mock.calls[0]![0]).toMatchObject({ table: 'posts', hops: 2 });
  });

  it('switches view, sets detail, opens search from a target (without stealing focus)', async () => {
    const { container } = await viewer({
      target: { view: 'only_blog', detail: 'names', search: 'user' },
    });
    await flush(400);
    expect((screen.getByLabelText('Diagram view') as HTMLSelectElement).value).toBe('only_blog');
    expect(nodeOrNull(container, 'public.tags')).toBeNull();
    expect(node(container, 'public.users').querySelectorAll('.rv-column')).toHaveLength(0);
    const input = screen.getByRole('combobox', { name: 'Search' }) as HTMLInputElement;
    expect(input.value).toBe('user');
    expect(document.activeElement).not.toBe(input);
    expect(tone(container, 'public.users')).toBe('match');
  });

  it('a path target opens path mode; a changed target is applied again', async () => {
    function Host() {
      const [t, setT] = useState<DiagramTarget>({ path: ['users', 'tags'] });
      return (
        <>
          <button onClick={() => setT({ table: 'lonely' })}>retarget</button>
          <DbmlViewer source={SRC} ssrLayout={SSR} target={t} />
        </>
      );
    }
    const { container } = render(<Host />);
    await settled(container);
    await flush(300);
    expect(container.querySelector('.rv-nav-status')!.textContent).toBe(
      'users → posts → tags, 2 refs',
    );
    fireEvent.click(screen.getByText('retarget'));
    await flush(400);
    expect(container.querySelector('.rv-nav-search')).toBeNull();
    expect(
      node(container, 'public.lonely')
        .querySelector('.rv-node')!
        .classList.contains('rv-highlighted'),
    ).toBe(true);
  });
});

describe('DbmlViewer v1: diffAgainst', () => {
  const BEFORE = `
Table users {
  id integer [pk]
  email text
}
Table posts {
  id integer [pk]
  user_id integer [ref: > users.id]
  title varchar
}
Table lonely {
  id integer [pk]
}
Table legacy {
  id integer [pk]
}
`;
  it('draws added / removed / changed tones and a legend, and hides the editor link', async () => {
    const { container } = await viewer({
      diffAgainst: BEFORE,
      editorUrl: 'https://example.org/editor/',
    });
    expect(container.querySelector('.rv-viewer')!.getAttribute('data-rv-diff')).toBe('true');
    expect(tone(container, 'public.tags')).toBe('added');
    expect(tone(container, 'public.legacy')).toBe('removed');
    expect(tone(container, 'public.users')).toBe('changed');
    expect(
      node(container, 'public.users')
        .querySelector('[data-rv-column="email"]')!
        .getAttribute('data-rv-tone'),
    ).toBe('changed');
    const legend = screen.getByRole('list', { name: 'Changes' });
    const text = legend.textContent ?? '';
    // Added: the table tags, its ref, the group and the view; removed: legacy.
    expect(text).toMatch(/4 added/i);
    expect(text).toMatch(/1 removed/i);
    expect(text).toMatch(/\d+ changed/i);
    await flush(200);
    expect(screen.queryByLabelText('Open in editor')).toBeNull();
  });
});

describe('DbmlViewer v1: ssrLayout', () => {
  it('uses build-time positions where the layout has none, and keeps them out of the editor link', async () => {
    const layout = layoutWith({ 'public.users': { x: 0, y: 0 } });
    const { container } = await viewer({ layout, editorUrl: 'https://example.org/editor/' });
    expect(translate(node(container, 'public.users'))).toEqual({ x: 0, y: 0 });
    expect(translate(node(container, 'public.tags'))).toEqual({ x: 800, y: 60 });
    expect(translate(node(container, 'public.lonely'))).toEqual({ x: 40, y: 400 });
    const link = (await screen.findByLabelText('Open in editor')) as HTMLAnchorElement;
    const payload = await decodeShareHash(link.hash);
    expect(payload?.dbml).toBe(SRC);
    expect(payload?.layout).toEqual(layout);
  });

  it('withSsrPositions fills only missing positions, per view', () => {
    expect(withSsrPositions(null, null)).toBeNull();
    const own = layoutWith({ 'public.users': { x: 1, y: 2, pinned: true } });
    const out = withSsrPositions(own, SSR)!;
    expect(out.views['*']!.nodes['public.users']).toEqual({ x: 1, y: 2, pinned: true });
    expect(out.views['*']!.nodes['public.tags']).toEqual({ x: 800, y: 60 });
    // The input is not modified.
    expect(own.views['*']!.nodes['public.tags']).toBeUndefined();
    // Nothing missing: the same object.
    expect(withSsrPositions(out, SSR)).toBe(out);
    // A named view inherits the default view's positions first.
    const named: Layout = {
      ...emptyLayout(),
      views: { '*': { nodes: {} }, v: { nodes: { 'public.users': { x: 5, y: 5 } } } },
    };
    const ssrNamed: Layout = {
      ...emptyLayout(),
      views: { v: { nodes: { 'public.users': { x: 9, y: 9 }, 'public.posts': { x: 7, y: 7 } } } },
    };
    const m = withSsrPositions(named, ssrNamed)!;
    expect(m.views.v!.nodes['public.users']).toEqual({ x: 5, y: 5 });
    expect(m.views.v!.nodes['public.posts']).toEqual({ x: 7, y: 7 });
  });
});

describe('DbmlViewer v1: link and PDF', () => {
  it('link copies the anchored target and says so', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onLinkCopy = vi.fn();
    const onTargetChange = vi.fn();
    await viewer({ anchor: 'billing', onLinkCopy, onTargetChange, view: 'only_blog' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to this diagram' }));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const href = writeText.mock.calls[0]![0];
    expect(href.endsWith('#billing&view=only_blog')).toBe(true);
    expect(onLinkCopy).toHaveBeenCalledWith(href, { view: 'only_blog' });
    expect(onTargetChange).toHaveBeenCalledWith({ view: 'only_blog' });
    expect(document.querySelector('.rv-v1-toast')!.textContent).toBe('Link copied');
  });

  it('Export → PDF… opens the dialog with a live page count from planTiles', async () => {
    const { container } = await viewer();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF…' }));
    await flush();
    const dialog = screen.getByRole('dialog', { name: 'Export PDF' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    const status = within(dialog).getByRole('status');
    expect(status.textContent).toMatch(/^\d+ pages? \(\d+ × \d+(, \d+ empty left out)?\)/);
    const pages = Number(status.getAttribute('data-rv-pages'));
    const rows = Number(status.getAttribute('data-rv-rows'));
    const cols = Number(status.getAttribute('data-rv-cols'));
    const printed = rows * cols - Number(status.getAttribute('data-rv-skipped'));
    expect(pages).toBe(printed + (printed > 1 ? 1 : 0));
    // Views: All tables (current, checked) and only_blog.
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes.map((b) => (b as HTMLInputElement).checked).slice(0, 2)).toEqual([true, false]);
    // One page per view starts with every view (§6.12), until the user picks views.
    fireEvent.click(within(dialog).getByRole('radio', { name: /One page per view/ }));
    await flush();
    const viewBoxes = within(within(dialog).getByRole('group', { name: 'Views' })).getAllByRole(
      'checkbox',
    );
    expect(viewBoxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(status.textContent).toBe(`${viewBoxes.length} pages, one per view`);
    fireEvent.click(viewBoxes[1]!);
    await flush();
    const left = viewBoxes.length - 1;
    expect(status.textContent).toBe(`${left} ${left === 1 ? 'page' : 'pages'}, one per view`);
    // Back to tiled: the picked views stay.
    fireEvent.click(within(dialog).getByRole('radio', { name: /Tiled/ }));
    await flush();
    expect((viewBoxes[1] as HTMLInputElement).checked).toBe(false);
    // Esc closes it (and the focus goes back).
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('navigation components', () => {
  it('SearchPanel reports hits and paths; Esc closes', async () => {
    const onHits = vi.fn();
    const onPath = vi.fn();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <SearchPanel
        model={MODEL}
        onSelect={onSelect}
        onHits={onHits}
        onPath={onPath}
        onClose={onClose}
        initialPath={['public.users', 'public.tags']}
      />,
    );
    await flush();
    const path = shortestPath(MODEL, 'public.users', 'public.tags')!;
    expect(onPath).toHaveBeenLastCalledWith(path, ['public.users', 'public.tags']);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await flush();
    expect(onPath).toHaveBeenLastCalledWith(null, null);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await type(input, 'lone');
    expect(onHits.mock.lastCall![0][0]).toMatchObject({ kind: 'table', id: 'public.lonely' });
    fireEvent.click(screen.getAllByRole('option', { name: /lonely/ })[0]!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'public.lonely' }));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('pathOrder walks from the start; pathText says the hops', () => {
    const p = shortestPath(MODEL, 'public.tags', 'public.users')!;
    expect(pathOrder(MODEL, p, 'public.tags')).toEqual([
      'public.tags',
      'public.posts',
      'public.users',
    ]);
    expect(pathText(MODEL, p, ['public.tags', 'public.users'])).toBe(
      'tags → posts → users, 2 refs',
    );
    expect(pathText(MODEL, null, ['public.tags', 'public.lonely'])).toBe(
      'No relationship path between tags and lonely',
    );
  });

  it('hitDecorations: tables, columns and enum columns toned, the rest dimmed', () => {
    const m = compile(`Enum status { a\n b }\nTable t {\n  id int\n  s status\n}`);
    const d = hitDecorations(m, [
      { kind: 'table', id: 'public.t', label: 't', ranges: [], score: 100 },
      { kind: 'enum', id: m.enums[0]!.id, label: 'status', ranges: [], score: 100 },
    ]);
    expect(d).toEqual({
      nodes: { 'public.t': 'match' },
      columns: { 'public.t': { s: 'match' } },
      dimOthers: true,
    });
  });

  it('DetailSwitch is a radio group with arrow keys', () => {
    function Host() {
      const [v, setV] = useState<'all' | 'keys' | 'names'>('all');
      return <DetailSwitch value={v} onChange={setV} />;
    }
    render(<Host />);
    const group = screen.getByRole('radiogroup', { name: 'Detail level' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    radios[2]!.focus();
    fireEvent.keyDown(radios[2]!, { key: 'ArrowRight' });
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios[0]);
    fireEvent.keyDown(radios[0]!, { key: 'End' });
    expect(radios[2]!.getAttribute('aria-checked')).toBe('true');
  });

  it('FocusControl keeps the focus at its limits', () => {
    const onChange = vi.fn();
    render(<FocusControl tableLabel="orders" hops={0} onChange={onChange} onExit={() => {}} />);
    const fewer = screen.getByRole('button', { name: 'Fewer hops' });
    expect(fewer.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(fewer);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More hops' }));
    expect(onChange).toHaveBeenCalledWith(1);
    expect(screen.getByRole('group').textContent).toContain('Related to orders · 0 hops');
  });

  it('PdfDialog: options reach onExport; too many pages blocks it', () => {
    const onExport = vi.fn();
    const bounds = { x: 0, y: 0, width: 3000, height: 2000 };
    render(
      <PdfDialog
        views={[{ name: '*', label: 'All tables' }]}
        current="*"
        onExport={onExport}
        onClose={() => {}}
        planFor={(o) => planTiles(bounds, o)}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Export PDF' });
    const plan = planTiles(bounds, { scale: 0.75, overlapMm: 10, paper: 'a4' });
    fireEvent.change(within(dialog).getByLabelText('Paper'), { target: { value: 'a4' } });
    const status = within(dialog).getByRole('status');
    expect(Number(status.getAttribute('data-rv-pages'))).toBe(tiledPageCount(plan, true));
    expect(status.textContent).toContain(`(${plan.rows} × ${plan.cols})`);
    fireEvent.change(within(dialog).getByLabelText('Scale (%)'), { target: { value: '200' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Overview page first' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export PDF' }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'tiled',
        paper: 'a4',
        scale: 1.5,
        overview: false,
        views: ['*'],
      }),
    );
    // A huge diagram at 200 %: over the page limit, Export does nothing.
    onExport.mockClear();
    cleanup();
    render(
      <PdfDialog
        views={[{ name: '*', label: 'All tables' }]}
        current="*"
        onExport={onExport}
        onClose={() => {}}
        planFor={(o) => planTiles({ x: 0, y: 0, width: 40000, height: 40000 }, o)}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/limit/);
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(onExport).not.toHaveBeenCalled();
  });

  it('PdfDialog: empty views are left out of the pages and the count says so', () => {
    const onExport = vi.fn();
    const bounds = { x: 0, y: 0, width: 800, height: 500 };
    render(
      <PdfDialog
        views={[
          { name: '*', label: 'All tables' },
          { name: 'empty_view', label: 'empty_view', empty: true },
          { name: 'sales', label: 'sales' },
        ]}
        current="*"
        onExport={onExport}
        onClose={() => {}}
        planFor={(o) => planTiles(bounds, o)}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Export PDF' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /One page per view/ }));
    const status = within(dialog).getByRole('status');
    expect(status.textContent).toBe('2 pages, one per view, 1 empty view left out');
    expect(status.getAttribute('data-rv-pages')).toBe('2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export PDF' }));
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'pages', views: ['*', 'sales'] }),
    );
    // Only the empty view chosen: nothing to print, Export does nothing.
    onExport.mockClear();
    const boxes = within(within(dialog).getByRole('group', { name: 'Views' })).getAllByRole(
      'checkbox',
    );
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[2]!);
    expect(status.textContent).toBe('Nothing to print: this view is empty');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export PDF' }));
    expect(onExport).not.toHaveBeenCalled();
    // Tiled leaves it out too.
    fireEvent.click(boxes[0]!);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Tiled/ }));
    expect(status.textContent).toMatch(/1 empty view left out$/);
  });

  it('isViewEmpty: a view without tables or notes', async () => {
    const { compileDbml } = await import('@relvista/core');
    const { isViewEmpty } = await import('../src/nav/PdfDialog.js');
    const r = compileDbml(
      'Table a { id int }\nDiagramView none {\n}\nDiagramView some {\n  Tables { a }\n}',
    );
    expect(isViewEmpty(r.model!, '*')).toBe(false);
    expect(isViewEmpty(r.model!, 'none')).toBe(true);
    expect(isViewEmpty(r.model!, 'some')).toBe(false);
    expect(isViewEmpty(r.model!, 'unknown')).toBe(false);
  });
});

describe('DbmlViewer v1: framing next to the search / path panel', () => {
  function fake(rect: Partial<DOMRect>): DOMRect {
    const r = { x: 0, y: 0, top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, ...rect };
    return { ...r, toJSON: () => r } as DOMRect;
  }
  function rootWith(panel: Partial<DOMRect> | null): HTMLElement {
    const root = document.createElement('div');
    const canvasEl = document.createElement('div');
    canvasEl.className = 'rv-canvas';
    canvasEl.getBoundingClientRect = () =>
      fake({ top: 100, left: 0, width: 1000, height: 600, right: 1000, bottom: 700 });
    root.append(canvasEl);
    if (panel) {
      const p = document.createElement('div');
      p.className = 'rv-nav-search';
      p.getBoundingClientRect = () => fake(panel);
      root.append(p);
    }
    return root;
  }

  it('reserves the panel at the top or at the right, whichever covers less', () => {
    expect(panelClearance(rootWith(null))).toBeUndefined();
    // A wide, short panel: clear its height at the top.
    expect(
      panelClearance(
        rootWith({ top: 110, bottom: 200, left: 600, right: 990, width: 390, height: 90 }),
      ),
    ).toEqual({ top: 116 });
    // A narrow, tall panel: clear its width at the right.
    expect(
      panelClearance(
        rootWith({ top: 110, bottom: 600, left: 760, right: 990, width: 230, height: 490 }),
      ),
    ).toEqual({ right: 256 });
  });
});
