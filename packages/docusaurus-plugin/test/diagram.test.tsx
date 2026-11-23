// @vitest-environment jsdom
// DbmlDiagram in a browser-like environment: loading, fetch errors, invalid layout files, the
// error boundary, the Source tab and the build-time positions (`ssrLayout`). Docusaurus modules
// are replaced by minimal stand-ins.
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileDbml, mergeViewDefaults, type Layout } from '@relvista/core';
import { sourceText } from '../src/source.js';
import { siteConfig } from './stubs/useDocusaurusContext.js';

const viewerProps: Array<Record<string, unknown>> = [];
let viewerThrows = false;
vi.mock('@relvista/renderer', async () => ({
  // Deep links (the docs anchors).
  ...(await vi.importActual<Record<string, unknown>>('../../renderer/src/share/deepLink.ts')),
  // Colour helpers of the site palette: jsdom has no CSS colours, so nothing resolves.
  resolveColors: (_el: unknown, values: string[]) => values.map(() => null),
  parseHex: () => null,
  // The static layer after a client-side navigation (ssr/build.tsx) and its frame (ssr/frames.ts).
  DiagramSvg: () => <svg className="rv-diagram" />,
  viewerFirstView: (
    await vi.importActual<Record<string, unknown>>('../../renderer/src/canvas/frame.ts')
  )['viewerFirstView'],
  DbmlViewer: (p: Record<string, unknown>) => {
    viewerProps.push(p);
    if (viewerThrows) throw new Error('boom');
    return <div data-testid="viewer" />;
  },
}));

const { default: DbmlDiagram } = await import('../src/theme/DbmlDiagram/index.js');

beforeAll(() => {
  if (!('MutationObserver' in globalThis)) vi.stubGlobal('MutationObserver', class {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  viewerProps.length = 0;
  viewerThrows = false;
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  });
}

function stubFetch(map: Record<string, { status: number; body: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const r = map[url] ?? { status: 404, body: '' };
      return {
        ok: r.status < 400,
        status: r.status,
        statusText: r.status < 400 ? 'OK' : 'Not Found',
        text: async () => r.body,
      };
    }),
  );
}

describe('DbmlDiagram', () => {
  it('renders the viewer for an inline value, with the ELK worker URL', async () => {
    render(<DbmlDiagram value={'Table a {\n  id int\n}'} title="A" />);
    await settle();
    expect(screen.getByTestId('viewer')).toBeTruthy();
    expect(viewerProps.at(-1)!['workerUrl']).toBe('/elk-worker.js');
    expect(viewerProps.at(-1)!['minimap']).toBe('auto');
  });

  it('links "Open in editor" to the hosted editor by default; editorUrl={false} hides it', async () => {
    render(<DbmlDiagram value={'Table a {\n  id int\n}'} />);
    await settle();
    expect(viewerProps.at(-1)!['editorUrl']).toBe('https://relvista.org/editor/');
    expect(viewerProps.at(-1)!['toolbar']).toContain('open-in-editor');
    cleanup();
    render(<DbmlDiagram value={'Table a {\n  id int\n}'} editorUrl={false} />);
    await settle();
    expect(viewerProps.at(-1)!['editorUrl']).toBeUndefined();
    expect(viewerProps.at(-1)!['toolbar']).not.toContain('open-in-editor');
  });

  it('shows a loading placeholder, then the fetched source', async () => {
    stubFetch({ '/s.dbml': { status: 200, body: 'Table a {\n  id int\n}' } });
    render(<DbmlDiagram src="/s.dbml" title="Fetched" />);
    expect(screen.getByText('Loading diagram…')).toBeTruthy();
    await settle();
    expect(screen.getByTestId('viewer')).toBeTruthy();
    expect(viewerProps.at(-1)!['source']).toContain('Table a');
  });

  it('reports a source that cannot be fetched', async () => {
    stubFetch({});
    render(<DbmlDiagram src="/missing.dbml" />);
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Could not load \/missing\.dbml: 404/);
  });

  it('reports an invalid layout file', async () => {
    stubFetch({ '/bad.layout.json': { status: 200, body: '{"version": "nope"}' } });
    render(<DbmlDiagram value={'Table a {\n  id int\n}'} layout="/bad.layout.json" />);
    // Validation loads @relvista/core lazily.
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toMatch(/Invalid layout file/);
  });

  it('catches a crashing viewer in its error boundary', async () => {
    viewerThrows = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<DbmlDiagram value={'Table a {\n  id int\n}'} />);
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/could not be rendered.*boom/);
    err.mockRestore();
  });

  it('shows every file of a multi-file project in the Source tab', async () => {
    render(
      <DbmlDiagram
        source
        value={{
          files: { 'main.dbml': 'use * from ./b', 'b.dbml': 'Table b {}' },
          entry: 'main.dbml',
        }}
      />,
    );
    await settle();
    expect(screen.getByTestId('code').textContent).toBe(
      '// main.dbml\nuse * from ./b\n\n// b.dbml\nTable b {}\n',
    );
  });
});

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

describe('build-time positions (ssrLayout)', () => {
  const SOURCE =
    'Table users {\n  id int [pk]\n}\n\nTable posts {\n  user_id int [ref: > users.id]\n}';

  async function hydrated(app: ReactNode): Promise<Record<string, unknown>> {
    const container = document.createElement('div');
    container.innerHTML = await serverHtml(app);
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, app);
    });
    await settle();
    container.remove();
    return viewerProps.at(-1)!;
  }

  it('go to the viewer as ssrLayout, never into layout (so never into "Open in editor")', async () => {
    const props = await hydrated(<DbmlDiagram value={SOURCE} title="Blog" />);
    expect(props['layout']).toBeNull();
    const nodes = mergeViewDefaults(props['ssrLayout'] as Layout, '*').nodes;
    for (const t of compileDbml(SOURCE).model!.tables) {
      expect(Number.isFinite(nodes[t.id]?.x) && Number.isFinite(nodes[t.id]?.y)).toBe(true);
    }
  });

  it('a layout file object goes to the viewer unchanged, the rest in ssrLayout', async () => {
    const saved: Layout = {
      version: 1,
      views: { '*': { nodes: { 'public.users': { x: 600, y: 300, w: 260 } } } },
      settings: { detailLevel: 'keys' },
    };
    const props = await hydrated(<DbmlDiagram value={SOURCE} layout={saved} />);
    expect(props['layout']).toEqual(saved);
    const ssr = props['ssrLayout'] as Layout;
    expect(ssr.views['*']!.nodes['public.posts']).toBeDefined();
    // The saved position is the one drawn at build time, too.
    expect(ssr.views['*']!.nodes['public.users']).toMatchObject({ x: 600, y: 300 });
  });

  it('a client-side navigation (no server markup) gives no ssrLayout', async () => {
    render(<DbmlDiagram value={SOURCE} />);
    await settle();
    expect(viewerProps.at(-1)!['ssrLayout']).toBeNull();
    expect(viewerProps.at(-1)!['layout']).toBeNull();
  });
});

describe('frozen diagrams (themeConfig.dbml.frozen, the frozen prop)', () => {
  const SOURCE = 'Table a {\n  id int\n}';
  afterEach(() => {
    siteConfig.themeConfig = {};
  });

  async function frozenOf(app: ReactNode): Promise<unknown> {
    render(app);
    await settle();
    const props = viewerProps.at(-1)!;
    cleanup();
    return props['frozen'];
  }

  it('are frozen by default, with the lock button in the toolbar', async () => {
    render(<DbmlDiagram value={SOURCE} />);
    await settle();
    expect(viewerProps.at(-1)!['frozen']).toBe(true);
    expect(viewerProps.at(-1)!['toolbar']).toContain('lock');
  });

  it('the prop wins over themeConfig, both ways', async () => {
    expect(await frozenOf(<DbmlDiagram value={SOURCE} frozen={false} />)).toBe(false);
    siteConfig.themeConfig = { dbml: { frozen: false } };
    expect(await frozenOf(<DbmlDiagram value={SOURCE} />)).toBe(false);
    expect(await frozenOf(<DbmlDiagram value={SOURCE} frozen />)).toBe(true);
  });
});

describe('sourceText', () => {
  it('returns single sources unchanged', () => {
    expect(sourceText('Table a {}')).toBe('Table a {}');
    expect(sourceText({ files: { 'm.dbml': 'x' }, entry: 'm.dbml' })).toBe('x');
  });
});
