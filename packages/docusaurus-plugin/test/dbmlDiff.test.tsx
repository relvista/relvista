// @vitest-environment jsdom
// `<DbmlDiff>` and the ```dbml-diff fence (docs/design/phase3-v1.md §5.3): the build-time HTML has
// the merged picture with the diff tones and the change list; hydration keeps both and gives the
// viewer the older version and the positions of every drawn node (removed tables too).
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeViewDefaults, type Layout } from '@relvista/core';
import type * as Renderer from '@relvista/renderer';
import { splitDiffFence } from '../src/meta.js';
import { resetServerAnchors } from '../src/theme/DbmlDiagram/anchor.js';
import { changeBadge } from '../src/theme/DbmlDiff/changes.js';
import { siteConfig } from './stubs/useDocusaurusContext.js';

const viewerProps: Array<Record<string, unknown>> = [];
vi.mock('@relvista/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof Renderer>()),
  DbmlViewer: (p: Record<string, unknown>) => {
    viewerProps.push(p);
    return <div className="rv-viewer" data-rv-layout="done" data-testid="viewer" />;
  },
}));

const { default: DbmlDiff } = await import('../src/theme/DbmlDiff/index.js');
const { default: MDXCode } = await import('../src/theme/MDXComponents/Code/index.js');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OLD = `Table users {
  id integer [pk]
  email varchar
  legacy_flag boolean
}

Table sessions {
  id integer [pk]
  user_id integer [ref: > users.id]
}`;

const NEW = `Table users {
  id integer [pk]
  email text
  name varchar
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal
}`;

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
  cleanup();
  viewerProps.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('DbmlDiff at build time', () => {
  it('draws both versions with the diff tones and lists the changes', async () => {
    const html = await serverHtml(<DbmlDiff old={OLD} new={NEW} title="Users v2" height={420} />);
    // The static picture: the merged model (the removed table is drawn too), toned.
    expect(html).toMatch(/<div class="relvista-static" data-rv-static="[0-9a-f]{16}"/);
    expect(html).toContain('class="rv-diagram"');
    expect(html).toContain('data-rv-diff="true"');
    for (const id of ['public.users', 'public.orders', 'public.sessions'])
      expect(html).toContain(`data-rv-table="${id}"`);
    expect(html).toMatch(
      /data-rv-table="public\.orders"[^>]*data-rv-tone="added"|data-rv-tone="added"[^>]*data-rv-table="public\.orders"/,
    );
    expect(html).toContain('data-rv-tone="removed"');
    expect(html).toContain('data-rv-tone="changed"');
    // Colours stay CSS variables (light / dark CSS applies).
    expect(html).toContain('var(--rv-');

    // The change list, in the HTML (no JavaScript needed).
    expect(html).toContain('<details');
    expect(html).toContain('Changes (+2 −2 ~1)');
    expect(html).toContain('data-rv-change="added"');
    expect(html).toContain('data-rv-change="removed"');
    expect(html).toContain('data-rv-change="changed"');
    expect(html).toContain('table orders');
    expect(html).toContain('column users.legacy_flag');
    expect(html).toMatch(/users\.email: varchar → text/);

    // Positions of every drawn node for the viewer, and the list for hydration.
    const json = /<script type="application\/json" data-rv-ssr="[0-9a-f]+">([^<]*)<\/script>/.exec(
      html,
    );
    expect(json).not.toBeNull();
    const payload = JSON.parse(json![1]!) as {
      positions: Record<string, unknown>;
      changes: { lines: string[] };
    };
    expect(Object.keys(payload.positions).sort()).toEqual([
      'public.orders',
      'public.sessions',
      'public.users',
    ]);
    expect(payload.changes.lines.length).toBeGreaterThan(3);
  });

  it('keeps hostile names inert in the picture, the change list and the JSON', async () => {
    const H = '</script><img src=x onerror=alert(1)><!--';
    const before = `Table "${H}" {\n  id int [pk]\n  "${H}" int\n}`;
    const after = `Table "${H}" {\n  id int [pk]\n  "${H}" text\n}\nTable "x${H}" { id int }`;
    const html = await serverHtml(<DbmlDiff old={before} new={after} title={H} />);
    expect(html).not.toMatch(/<img[\s>]/i);
    expect(html.replace(/<!-- -->/g, '')).not.toContain('<!--');
    expect(html.match(/<\/script>/g)?.length ?? 0).toBe(html.match(/<script\b/g)?.length ?? 0);
    const json = /<script type="application\/json" data-rv-ssr="[0-9a-f]+">([^<]*)<\/script>/.exec(
      html,
    );
    const payload = JSON.parse(json![1]!) as {
      positions: Record<string, unknown>;
      changes: { lines: string[] };
    };
    expect(Object.keys(payload.positions).some((id) => id.includes(`x${H}`))).toBe(true);
    expect(payload.changes.lines.join('\n')).toContain(H);
  });

  it('does not report its own anchor as a duplicate after suspending', async () => {
    resetServerAnchors();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Sources no other test uses, so the build suspends (nothing cached for this key).
    const html = await serverHtml(
      <>
        <DbmlDiff id="once-a" old={`${OLD}\n// a`} new={`${NEW}\n// a`} />
        <DbmlDiff id="once-b" old={`${OLD}\n// b`} new={`${NEW}\n// b`} />
      </>,
    );
    expect(html).toContain('id="once-a"');
    const anchorWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('two diagrams'));
    expect(anchorWarnings).toEqual([]);
    // A real duplicate on one page is still reported, once.
    resetServerAnchors();
    await serverHtml(
      <>
        <DbmlDiff id="twice" old={`${OLD}\n// c`} new={`${NEW}\n// c`} />
        <DbmlDiff id="twice" old={`${OLD}\n// d`} new={`${NEW}\n// d`} />
      </>,
    );
    const dup = warn.mock.calls.filter((c) => String(c[0]).includes('two diagrams'));
    expect(dup).toHaveLength(1);
    expect(String(dup[0]![0])).toContain('"#twice"');
  });

  it('summary={false} leaves the list out', async () => {
    const html = await serverHtml(<DbmlDiff old={OLD} new={NEW} summary={false} />);
    expect(html).toContain('class="rv-diagram"');
    expect(html).not.toContain('<details');
  });

  it('identical versions: no tones, "Changes (none)"', async () => {
    const html = await serverHtml(<DbmlDiff old={NEW} new={NEW} />);
    expect(html).not.toMatch(/data-rv-tone="(added|removed|changed)"/);
    expect(html).toContain('Changes (none)');
  });

  it('broken DBML and a missing version: the problem box, no throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = await serverHtml(<DbmlDiff old={'Table a {'} new={NEW} title="Broken" />);
    expect(broken).toContain('role="alert"');
    expect(broken).toMatch(/The old version has errors: \d+:\d+/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[relvista\] .*"Broken"/));
    const missing = await serverHtml(<DbmlDiff new={NEW} />);
    expect(missing).toContain('DbmlDiff needs the old version');
  });

  it('reads oldSrc / newSrc from the static directories', async () => {
    const html = await serverHtml(
      <DbmlDiff old={'Table customers {\n  id integer [pk]\n}'} newSrc="/dbml/shop.dbml" />,
    );
    expect(html).toContain('data-rv-table="public.orders"');
    expect(html).toContain('+ ');
    expect(html).toMatch(/Changes \(\+2 ~1\)/);
  });

  it('a named view draws the view of the merged model', async () => {
    const withView = `${NEW}\n\nDiagramView auth {\n  Tables { users }\n}`;
    const html = await serverHtml(<DbmlDiff old={OLD} new={withView} view="auth" />);
    expect(html).toContain('data-rv-table="public.users"');
    expect(html).not.toContain('data-rv-table="public.orders"');
  });
});

describe('DbmlDiff in the browser', () => {
  it('hydrates without errors and gives the viewer both versions and every position', async () => {
    const app = <DbmlDiff old={OLD} new={NEW} title="Users v2" />;
    const container = document.createElement('div');
    container.innerHTML = await serverHtml(app);
    document.body.appendChild(container);
    const staticHtml = container.querySelector('.relvista-static')!.innerHTML;
    const listHtml = container.querySelector('details')!.outerHTML;

    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    await act(async () => {
      hydrateRoot(container, app, { onRecoverableError: (e) => errors.push(e) });
    });
    await settle();
    expect(errors).toEqual([]);
    consoleError.mockRestore();

    expect(container.querySelector('.relvista-static')!.innerHTML).toBe(staticHtml);
    expect(container.querySelector('details')!.outerHTML).toBe(listHtml);
    const props = viewerProps.at(-1)!;
    expect(props['source']).toBe(NEW);
    expect(props['diffAgainst']).toBe(OLD);
    expect(props['layout']).toBeNull();
    // No "Open in editor" for a diff.
    expect(props['editorUrl']).toBeUndefined();
    const nodes = mergeViewDefaults(props['ssrLayout'] as Layout, '*').nodes;
    for (const id of ['public.users', 'public.orders', 'public.sessions'])
      expect(Number.isFinite(nodes[id]?.x)).toBe(true);
    // The viewer reported its final layout: the static layer is hidden (kept for print).
    expect(container.querySelector('.relvista-static')!.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.relvista-diff')!.id).toBe('diagram-users-v2');
  });

  it('without server markup, computes the change list in the browser', async () => {
    render(<DbmlDiff old={OLD} new={NEW} />);
    await settle();
    expect(screen.getByTestId('viewer')).toBeTruthy();
    const summary = await screen.findByText('Changes (+2 −2 ~1)', {}, { timeout: 5000 });
    expect(summary.closest('details')).not.toBeNull();
    expect(viewerProps.at(-1)!['ssrLayout']).toBeNull();
  });

  it('is frozen like any diagram: themeConfig.dbml.frozen, and the frozen prop over it', async () => {
    const frozenOf = async (app: ReactNode) => {
      render(app);
      await settle();
      const props = viewerProps.at(-1)!;
      cleanup();
      return props['frozen'];
    };
    try {
      expect(await frozenOf(<DbmlDiff old={OLD} new={NEW} />)).toBe(true);
      expect(await frozenOf(<DbmlDiff old={OLD} new={NEW} frozen={false} />)).toBe(false);
      siteConfig.themeConfig = { dbml: { frozen: false } };
      expect(await frozenOf(<DbmlDiff old={OLD} new={NEW} />)).toBe(false);
      expect(await frozenOf(<DbmlDiff old={OLD} new={NEW} frozen />)).toBe(true);
    } finally {
      siteConfig.themeConfig = {};
    }
  });

  it('a missing version shows what is missing', async () => {
    render(<DbmlDiff new={NEW} ssr={false} />);
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/needs the old version/);
  });
});

describe('the dbml-diff fence', () => {
  it('splits old and new at a line of exactly three dashes', () => {
    expect(splitDiffFence('Table a {}\n---\nTable b {}\n')).toEqual({
      old: 'Table a {}',
      new: 'Table b {}',
    });
    expect(splitDiffFence('Table a {}\r\n---\r\nTable b {}\r\n')).toEqual({
      old: 'Table a {}',
      new: 'Table b {}',
    });
    // Only the first separator splits; dashes with other text do not count.
    expect(splitDiffFence('a\n----\nb\n --- \nc\n---\nd\n---\ne')).toEqual({
      old: 'a\n----\nb\n --- \nc',
      new: 'd\n---\ne',
    });
    expect(splitDiffFence('---\nTable b {}')).toEqual({ old: '', new: 'Table b {}' });
    expect(splitDiffFence('Table a {}\nTable b {}')).toBeNull();
  });

  it('becomes a DbmlDiff with the fence meta', async () => {
    render(
      <MDXCode
        className="language-dbml-diff"
        metastring='title="Orders v2" height=360 id="orders-diff" summary=false frozen=false'
      >
        {'Table a {\n  id int\n}\n---\nTable a {\n  id bigint\n}\n'}
      </MDXCode>,
    );
    // `@theme/DbmlDiff` is a stand-in here: it shows the props it got.
    const d = await screen.findByTestId('diff');
    expect(d.dataset['old']).toBe('Table a {\n  id int\n}');
    expect(d.dataset['new']).toBe('Table a {\n  id bigint\n}');
    expect(d.dataset['title']).toBe('Orders v2');
    expect(d.dataset['height']).toBe('360');
    expect(d.dataset['id']).toBe('orders-diff');
    expect(d.dataset['summary']).toBe('false');
    expect(d.dataset['frozen']).toBe('false');
    expect(screen.queryByTestId('diagram')).toBeNull();
  });

  it('without a separator, the body is the new version and there is no old one', async () => {
    render(<MDXCode className="language-dbml-diff">{'Table a {}\n'}</MDXCode>);
    const d = await screen.findByTestId('diff');
    expect(d.dataset['old']).toBeUndefined();
    expect(d.dataset['new']).toBe('Table a {}');
  });

  it('static keeps it as code', () => {
    render(
      <MDXCode className="language-dbml-diff" metastring="static">
        {'a\n---\nb\n'}
      </MDXCode>,
    );
    expect(screen.queryByTestId('diff')).toBeNull();
    expect(screen.getByTestId('mdx-code')).toBeTruthy();
  });
});

describe('changeBadge', () => {
  it('leaves zero parts out and uses a real minus sign', () => {
    expect(changeBadge({ added: 3, removed: 1, changed: 4 })).toBe('+3 −1 ~4');
    expect(changeBadge({ added: 0, removed: 2, changed: 0 })).toBe('−2');
    expect(changeBadge({ added: 0, removed: 0, changed: 0 })).toBe('');
  });
});
