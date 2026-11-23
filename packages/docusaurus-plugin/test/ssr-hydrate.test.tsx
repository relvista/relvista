// @vitest-environment jsdom
// Hydration of a build-time static diagram (docs/design/phase3-v1.md §5.1, client): the first
// client render reproduces the server's markup exactly (no hydration error), the viewer gets every
// build-time position (so it runs no ELK), and the static layer is hidden once the viewer is done.
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { act, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileDbml, mergeViewDefaults, type Layout } from '@relvista/core';
import type * as Renderer from '@relvista/renderer';

const viewerProps: Array<Record<string, unknown>> = [];
vi.mock('@relvista/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof Renderer>()),
  // React Flow does not run in jsdom: a stand-in that reports its layout as final.
  DbmlViewer: (p: Record<string, unknown>) => {
    viewerProps.push(p);
    return <div className="rv-viewer" data-rv-layout="done" data-testid="viewer" />;
  },
}));

const { default: DbmlDiagram } = await import('../src/theme/DbmlDiagram/index.js');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = `Table users {
  id integer [pk]
  name varchar
}

Table posts {
  id integer [pk]
  user_id integer [ref: > users.id]
}

Table comments {
  id integer [pk]
  post_id integer [ref: > posts.id]
}`;

/** The server render, as Docusaurus does it (no `document` on the server). */
async function serverHtml(app: ReactNode): Promise<string> {
  vi.stubGlobal('document', undefined);
  try {
    return await new Promise<string>((resolve, reject) => {
      const pass = new PassThrough();
      const { pipe } = renderToPipeableStream(app, {
        onError: reject,
        onAllReady() {
          pipe(pass);
          text(pass).then(resolve, reject);
        },
      });
    });
  } finally {
    vi.unstubAllGlobals();
  }
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  });
}

afterEach(() => {
  viewerProps.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('hydrating a static diagram', () => {
  it('keeps the server markup, passes the positions, then hides the static layer', async () => {
    const app = <DbmlDiagram value={SOURCE} title="Blog" height={400} />;
    const html = await serverHtml(app);
    expect(html).toContain('<svg');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const staticHtml = container.querySelector('.relvista-static')!.innerHTML;

    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    await act(async () => {
      hydrateRoot(container, app, {
        onRecoverableError: (e) => errors.push(e),
      });
    });
    await settle();
    expect(errors).toEqual([]);
    consoleError.mockRestore();

    // The static markup is untouched by hydration.
    const host = container.querySelector('.relvista-static')!;
    expect(host.innerHTML).toBe(staticHtml);

    // The viewer has a position for every table of the view, in `ssrLayout` (never in `layout`,
    // which "Open in editor" links carry).
    expect(viewerProps.at(-1)!['layout']).toBeNull();
    const layout = viewerProps.at(-1)!['ssrLayout'] as Layout;
    const nodes = mergeViewDefaults(layout, '*').nodes;
    for (const t of compileDbml(SOURCE).model!.tables) {
      expect(Number.isFinite(nodes[t.id]?.x)).toBe(true);
      expect(Number.isFinite(nodes[t.id]?.y)).toBe(true);
    }
    // The positions are the ones drawn in the static SVG.
    const users = host.querySelector('[data-rv-table="public.users"]')!;
    expect(users.getAttribute('transform')).toBe(
      `translate(${nodes['public.users']!.x} ${nodes['public.users']!.y})`,
    );

    // The viewer reported data-rv-layout="done": the static layer is hidden (kept for print).
    expect(host.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.relvista-ssr')!.getAttribute('data-rv-live')).toBe('done');
    expect(container.querySelector('script[data-rv-ssr]')).not.toBeNull();
  });

  it('keeps a layout file object: its saved positions win and its settings stay', async () => {
    const saved: Layout = {
      version: 1,
      views: { '*': { nodes: { 'public.users': { x: 600, y: 300, w: 260 } } } },
      settings: { detailLevel: 'keys' },
    };
    const app = <DbmlDiagram value={SOURCE} layout={saved} />;
    const container = document.createElement('div');
    container.innerHTML = await serverHtml(app);
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, app);
    });
    await settle();
    const layout = viewerProps.at(-1)!['layout'] as Layout;
    expect(layout.settings).toEqual({ detailLevel: 'keys' });
    expect(layout.views['*']!.nodes['public.users']).toEqual({ x: 600, y: 300, w: 260 });
    expect(layout).toEqual(saved);
    const ssr = viewerProps.at(-1)!['ssrLayout'] as Layout;
    expect(Object.keys(ssr.views['*']!.nodes).sort()).toEqual([
      'public.comments',
      'public.posts',
      'public.users',
    ]);
  });

  it("view=: draws the view's saved detail level and leaves it to the viewer", async () => {
    const source = `${SOURCE}\nDiagramView blog {\n  Tables {\n    users\n    posts\n  }\n}`;
    const saved: Layout = {
      version: 1,
      views: { '*': { nodes: {} } },
      settings: {
        detailLevel: 'keys',
        'x-relvista-view-settings': { blog: { detailLevel: 'names' } },
      },
    };
    const columnsIn = (html: string) => (html.match(/data-rv-column="/g) ?? []).length;
    // The static picture: no column rows for "blog" (names), key rows for the default view.
    expect(columnsIn(await serverHtml(<DbmlDiagram value={source} layout={saved} />))).toBe(5);
    const app = <DbmlDiagram value={source} layout={saved} view="blog" />;
    const html = await serverHtml(app);
    expect(columnsIn(html)).toBe(0);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, app);
    });
    await settle();
    const props = viewerProps.at(-1)!;
    // No detailLevel override: the viewer picks the level of each view it shows.
    expect(props['detailLevel']).toBeUndefined();
    expect(props['defaultDetailLevel']).toBe('all');
    expect(props['view']).toBe('blog');
    expect(props['layout']).toEqual(saved);
  });

  it('a detail= override still wins over the view level, at build time and in the viewer', async () => {
    const source = `${SOURCE}\nDiagramView blog {\n  Tables {\n    users\n  }\n}`;
    const saved: Layout = {
      version: 1,
      views: { '*': { nodes: {} } },
      settings: { 'x-relvista-view-settings': { blog: { detailLevel: 'names' } } },
    };
    const app = <DbmlDiagram value={source} layout={saved} view="blog" detailLevel="all" />;
    const html = await serverHtml(app);
    expect((html.match(/data-rv-column="/g) ?? []).length).toBe(2);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, app);
    });
    await settle();
    expect(viewerProps.at(-1)!['detailLevel']).toBe('all');
  });

  it('without server markup (client-side navigation) the viewer lays out itself', async () => {
    const { render } = await import('@testing-library/react');
    const { container } = render(<DbmlDiagram value={SOURCE} />);
    await settle();
    expect(viewerProps.at(-1)!['layout']).toBeNull();
    // The static layer drew the sync layout (no ELK needed for this small diagram), then hid.
    const host = container.querySelector('.relvista-static')!;
    expect(host.querySelector('svg.rv-diagram')).not.toBeNull();
    expect(host.hasAttribute('hidden')).toBe(true);
  });
});
