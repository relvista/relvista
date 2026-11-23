// Build-time static diagrams (docs/design/phase3-v1.md §5.1): DbmlDiagram rendered the way
// Docusaurus renders pages (renderToPipeableStream, waiting for onAllReady), with the server side
// of `relvista-ssr-files` reading the fixture site in test/fixtures/site.
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileDbml } from '@relvista/core';
import DbmlDiagram from '../src/theme/DbmlDiagram/index.js';
import MDXCode from '../src/theme/MDXComponents/Code/index.js';
import { normalizeSitePath, createSiteFileReader, isRemote } from '../src/ssr/files.js';
import { createSsrBackend } from '../src/ssr/server.js';
import { staticKey } from '../src/ssr/key.js';
import { layoutWithPositions } from '../src/ssr/merge.js';
import type { SsrPayload } from '../src/ssr/types.js';
import { parseDbmlMeta } from '../src/meta.js';
import { DEFAULT_THEME_CONFIG, validateThemeConfig } from '../src/options.js';
import { mergeViewDefaults } from '@relvista/core';

const example = (name: string) =>
  readFileSync(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');
const siteDir = fileURLToPath(new URL('./fixtures/site', import.meta.url));

/** Renders like Docusaurus' renderToHtml: the whole HTML once every Suspense boundary resolved. */
function renderToHtml(app: ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    const pass = new PassThrough();
    const { pipe } = renderToPipeableStream(app, {
      onError: reject,
      onAllReady() {
        pipe(pass);
        text(pass).then(resolve, reject);
      },
    });
  });
}

function payloadOf(html: string): SsrPayload {
  const m = /<script type="application\/json" data-rv-ssr="([0-9a-f]+)">([^<]*)<\/script>/.exec(
    html,
  );
  expect(m, 'the JSON script').not.toBeNull();
  return JSON.parse(m![2]!) as SsrPayload;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Text that would break out of a <script> or an element if it were not escaped. */
export const HOSTILE = '</script><img src=x onerror=alert(1)><!--';

/** Every check that hostile text stayed text: no element, one `</script>` per JSON script. */
function expectInert(html: string): void {
  expect(html).not.toMatch(/<img[\s>]/i);
  // React's own `<!-- -->` text separators are the only comments.
  expect(html.replace(/<!-- -->/g, '')).not.toContain('<!--');
  const scripts = html.match(/<script\b/g)?.length ?? 0;
  expect(html.match(/<\/script>/g)?.length ?? 0).toBe(scripts);
}

describe('DbmlDiagram at build time', () => {
  it('keeps hostile table, column, note and title text inert in the SVG and the JSON', async () => {
    const source = [
      `Table "${HOSTILE}" {`,
      `  "${HOSTILE}" int [pk, note: '${HOSTILE}']`,
      `  Note: '${HOSTILE}'`,
      '}',
      `Table t2 { a int [ref: > "${HOSTILE}"."${HOSTILE}"] }`,
      `Note sticky { '${HOSTILE}' }`,
    ].join('\n');
    expect(compileDbml(source).model, 'the hostile source compiles').toBeTruthy();
    const html = await renderToHtml(<DbmlDiagram value={source} title={HOSTILE} />);
    expectInert(html);
    // The names round-trip through the JSON script and are drawn as text.
    const payload = payloadOf(html);
    expect(Object.keys(payload.positions).some((id) => id.includes(HOSTILE))).toBe(true);
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('puts the SVG, every table and the build-time positions in the HTML', async () => {
    const source = example('02-ecommerce.dbml');
    const html = await renderToHtml(
      <DbmlDiagram value={source} title="02-ecommerce.dbml" height={720} />,
    );
    const model = compileDbml(source).model!;
    expect(html).toContain('<svg');
    expect(html).toMatch(/<div class="relvista-static" data-rv-static="[0-9a-f]{16}"/);
    expect(html).toContain('class="rv-diagram"');
    for (const t of model.tables) {
      expect(html).toContain(`data-rv-table="${t.id}"`);
      expect(html).toContain(`>${t.name}<`);
    }
    const payload = payloadOf(html);
    expect(payload.v).toBe(1);
    expect(payload.view).toBe('*');
    expect(Object.keys(payload.positions).sort()).toEqual(model.tables.map((t) => t.id).sort());
    for (const p of Object.values(payload.positions)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    // Colours stay CSS variables, so the site's light / dark CSS applies; ids are per diagram.
    expect(html).toContain('var(--rv-header-bg');
    expect(html).toMatch(/id="rvs-[0-9a-f]{16}-shadow"/);
    // Framing variables for client/static.css, and the title chip.
    expect(html).toMatch(/--rv-w:\s*[\d.]+/);
    expect(html).toContain('--rv-box-h:720px');
    expect(html).toContain('class="rv-title"');
    // No placeholder: the picture is there, inline (not streamed hidden for a script to reveal).
    expect(html).not.toContain('relvista-placeholder');
    expect(html).not.toContain('<template');
    expect(html).not.toMatch(/<div hidden id="S:/);
  });

  it('draws the same picture as the positions: tables sit where the JSON says', async () => {
    const html = await renderToHtml(<DbmlDiagram value={example('01-minimal.dbml')} />);
    const payload = payloadOf(html);
    for (const [id, p] of Object.entries(payload.positions))
      expect(html).toContain(`data-rv-table="${id}" transform="translate(${p.x} ${p.y})"`);
  });

  it('renders a multi-file project and a named view', async () => {
    const dir = '12-modules';
    const names = [
      'auth.dbml',
      'billing.dbml',
      'common/index.dbml',
      'common/orders.dbml',
      'common/users.dbml',
      'main.dbml',
    ];
    const files = Object.fromEntries(names.map((n) => [n, example(`${dir}/${n}`)]));
    const html = await renderToHtml(
      <DbmlDiagram value={{ entry: 'main.dbml', files }} view="customer_360" />,
    );
    const payload = payloadOf(html);
    expect(payload.view).toBe('customer_360');
    expect(Object.keys(payload.positions).length).toBeGreaterThan(0);
  });

  it('reads src and layout files from the static directories', async () => {
    const html = await renderToHtml(
      <DbmlDiagram src="/dbml/shop.dbml" layout="/layouts/shop.dbml.layout.json" />,
    );
    const payload = payloadOf(html);
    // The layout file's positions are kept.
    expect(payload.positions['public.orders']).toEqual({ x: 0, y: 0 });
    expect(payload.positions['public.customers']).toEqual({ x: 400, y: 40 });
    expect(html).toContain('data-rv-table="public.customers"');
  });

  it('renders the problem for broken DBML without throwing, and warns once with the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const html = await renderToHtml(
      <>
        <DbmlDiagram value={'Table a {\n  id int [pk\n}'} title="Broken" />
        <DbmlDiagram value={'Table a {\n  id int [pk\n}'} title="Broken" />
      </>,
    );
    expect(html).toContain('relvista-error');
    expect(html).toContain('The DBML has errors');
    expect(html).not.toContain('data-rv-ssr');
    const lines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith('[relvista]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[relvista\] \/test-page: "Broken": The DBML has errors: \d+:\d+ /);
  });

  it('renders the problem for a missing file or a path outside the site', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missing = await renderToHtml(<DbmlDiagram src="/dbml/nope.dbml" />);
    expect(missing).toContain('relvista-error');
    expect(missing).toContain('Could not load /dbml/nope.dbml');
    const outside = await renderToHtml(<DbmlDiagram src="/../secret/secret.dbml" />);
    expect(outside).toContain('relvista-error');
    expect(outside).not.toContain('data-rv-table="public.secret"');
    expect(warn).toHaveBeenCalled();
  });

  it('leaves remote files to the browser (placeholder, nothing fetched)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const html = await renderToHtml(<DbmlDiagram src="https://example.com/s.dbml" />);
    vi.unstubAllGlobals();
    expect(html).toContain('relvista-placeholder');
    expect(html).not.toContain('<svg');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ssr={false} keeps the placeholder of phase 2', async () => {
    const html = await renderToHtml(
      <DbmlDiagram value={example('01-minimal.dbml')} ssr={false} title="Off" />,
    );
    expect(html).toContain('relvista-placeholder');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('relvista-static');
  });

  it('frozen changes nothing in the build-time picture', async () => {
    const value = example('05-table-groups.dbml');
    const frozen = await renderToHtml(<DbmlDiagram value={value} title="Groups" />);
    expect(frozen).toContain('relvista-static');
    expect(await renderToHtml(<DbmlDiagram value={value} title="Groups" frozen={false} />)).toBe(
      frozen,
    );
  });

  it('fences: ssr=false in the meta string turns it off', async () => {
    const fence = (meta: string) => (
      <MDXCode className="language-dbml" metastring={meta}>
        {'Table a {\n  id int\n}\n'}
      </MDXCode>
    );
    // The test aliases @theme/DbmlDiagram to a stub that shows its props.
    expect(await renderToHtml(fence('ssr=false'))).toContain('data-ssr="false"');
    expect(await renderToHtml(fence('title="A"'))).not.toContain('data-ssr');
  });

  it('does not inline markup over 1.5 MB (placeholder and a warning)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cols = Array.from({ length: 6000 }, (_, i) => `  column_number_${i} varchar(255)`);
    const html = await renderToHtml(
      <DbmlDiagram value={`Table huge {\n${cols.join('\n')}\n}`} title="Huge" />,
    );
    expect(html).toContain('relvista-placeholder');
    expect(html).not.toContain('<svg');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /\[relvista\] \/test-page: "Huge": not drawn at build time: .*1\.5 MB/,
    );
  }, 30_000);
});

describe('site files', () => {
  const read = createSiteFileReader({ siteDir, staticDirectories: ['static'], baseUrl: '/base/' });

  it('reads files of the static directories, also under the baseUrl', () => {
    expect(read('/dbml/shop.dbml')).toMatchObject({ ok: true });
    expect(read('dbml/shop.dbml?x=1#y')).toMatchObject({ ok: true });
    expect(read('/base/dbml/shop.dbml')).toMatchObject({ ok: true });
    expect(read('/dbml/missing.dbml')).toMatchObject({ ok: false });
  });

  it("refuses '..', encoded '..', backslashes and remote URLs", () => {
    for (const p of [
      '/../secret/secret.dbml',
      '../secret/secret.dbml',
      '/dbml/../../secret/secret.dbml',
      '/%2e%2e/secret/secret.dbml',
      '/dbml/..%2F..%2Fsecret/secret.dbml',
      '/..\\secret\\secret.dbml',
      'https://example.com/a.dbml',
      '//example.com/a.dbml',
    ]) {
      expect(read(p).ok, p).toBe(false);
    }
    expect(normalizeSitePath('/a/./b//c.dbml')).toBe('a/b/c.dbml');
    expect(normalizeSitePath('/a/../b')).toBeNull();
    expect(isRemote('data:text/plain,x')).toBe(true);
    expect(isRemote('/x')).toBe(false);
  });

  it('caches what it read', () => {
    const backend = createSsrBackend({ siteDir });
    const a = backend.readSiteFile('/dbml/shop.dbml');
    expect(backend.readSiteFile('/dbml/shop.dbml')).toBe(a);
  });
});

describe('positions for the viewer', () => {
  it('merge into the layout so every node of the view has one', () => {
    const payload: SsrPayload = {
      v: 1,
      view: 'billing',
      positions: { 'public.a': { x: 1, y: 2 } },
      groups: {},
    };
    const out = layoutWithPositions(
      { version: 1, views: { '*': { nodes: { 'public.a': { x: 9, y: 9, w: 300 } } } } },
      payload,
    );
    expect(mergeViewDefaults(out, 'billing').nodes['public.a']).toEqual({ x: 1, y: 2, w: 300 });
    const fresh = layoutWithPositions(null, { ...payload, view: '*' });
    expect(fresh.views['*']!.nodes['public.a']).toEqual({ x: 1, y: 2 });
  });

  it('keys are the same for the same props, different otherwise', () => {
    expect(staticKey(['a', { b: 1 }])).toBe(staticKey(['a', { b: 1 }]));
    expect(staticKey(['a'])).not.toBe(staticKey(['b']));
    expect(staticKey(['a'])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('ssr options', () => {
  const validate = (
    schema: { validate: (v: unknown) => { error?: Error; value: unknown } },
    v: unknown,
  ) => {
    const { error, value } = schema.validate(v);
    if (error) throw error;
    return value as typeof DEFAULT_THEME_CONFIG;
  };

  it('themeConfig.dbml.ssr defaults to true and accepts false, nothing else', () => {
    expect(DEFAULT_THEME_CONFIG.dbml.ssr).toBe(true);
    expect(validateThemeConfig({ validate, themeConfig: {} as never }).dbml.ssr).toBe(true);
    expect(
      validateThemeConfig({ validate, themeConfig: { dbml: { ssr: false } } as never }).dbml.ssr,
    ).toBe(false);
    expect(() =>
      validateThemeConfig({ validate, themeConfig: { dbml: { ssr: 'no' } } as never }),
    ).toThrow();
  });

  it('fence meta: ssr, ssr=false', () => {
    expect(parseDbmlMeta('ssr=false')).toEqual({ ssr: false });
    expect(parseDbmlMeta('ssr')).toEqual({ ssr: true });
    expect(parseDbmlMeta('title="A"')).toEqual({ title: 'A' });
  });
});
