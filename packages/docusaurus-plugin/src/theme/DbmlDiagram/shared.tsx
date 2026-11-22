// Parts shared by `@theme/DbmlDiagram` and `@theme/DbmlDiff`: loading and error states, the
// interactive layer over the static picture, deep-link anchors and the client viewer. Browser-safe
// and light (part of every page's bundle): the viewer itself loads in its own chunk.
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation } from '@docusaurus/router';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import type { CompileInputFiles, DetailLevel, Layout } from '@relvista/core';
import type { ToolbarItem } from '@relvista/renderer';
import { DEFAULT_THEME_CONFIG, type DbmlThemeConfig } from '../../defaults.js';
import { siteAccents, type SiteAccents } from '../../sitePalette.js';
import { layoutWithPositions } from '../../ssr/merge.js';
import type { SsrPayload } from '../../ssr/types.js';
import { anchorOfHash, duplicateAnchorWarning } from './anchor.js';
import { liveViewer } from './LiveViewer.js';
import { ssrPayload } from './StaticDiagram.js';
// URL of ELK's Web Worker script (the plugin's webpack rule emits it as an asset): auto-layout runs
// in a worker instead of blocking the page.
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?relvista-worker';
import styles from './styles.module.css';

// The viewer (React Flow, the DBML parser) loads only on pages that show a diagram. Every import
// of the renderer and core destructures the exports it uses, so webpack leaves the rest of the
// package out of the chunk (export and share code the viewer loads on use, if ever).
const LiveViewer = lazy(() =>
  import(/* webpackChunkName: "relvista-viewer" */ '@relvista/renderer').then(
    ({ DbmlViewer, formatAnchoredTarget, parseAnchoredTarget }) => ({
      default: liveViewer({ DbmlViewer, formatAnchoredTarget, parseAnchoredTarget }),
    }),
  ),
);

/** `themeConfig.dbml` with its defaults. */
export function useDbmlConfig(): DbmlThemeConfig {
  const { siteConfig } = useDocusaurusContext();
  const themeConfig = siteConfig.themeConfig as { dbml?: Partial<DbmlThemeConfig> };
  return { ...DEFAULT_THEME_CONFIG.dbml, ...themeConfig.dbml };
}

/**
 * The site's colour mode, read from `<html data-theme>`. Reading the DOM instead of
 * `useColorMode()` keeps the plugin independent of which `@docusaurus/theme-common` copy a package
 * manager resolves for it (a second copy has its own, empty React context).
 */
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const readTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
const serverTheme = (): 'light' | 'dark' => 'light';

function useSiteColorMode(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
}

/**
 * The site palette's computed colours (header band, accent) for the current colour mode, read
 * from the site's CSS inside `host`; null until known, or with relvista's own palette.
 */
function useSiteAccents(
  host: RefObject<HTMLElement | null>,
  mode: 'light' | 'dark',
  enabled: boolean,
): SiteAccents | null {
  const [accents, setAccents] = useState<{ mode: string; value: SiteAccents | null } | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    let alive = true;
    // The colour helpers come with the viewer chunk, which is loading anyway.
    import(/* webpackChunkName: "relvista-viewer" */ '@relvista/renderer')
      .then(({ resolveColors, parseHex, contrastRatio, withContrast, toHex, mix }) => {
        const el = host.current;
        const helpers = { resolveColors, parseHex, contrastRatio, withContrast, toHex, mix };
        if (alive && el) setAccents({ mode, value: siteAccents(el, mode, helpers) });
      })
      // Without them the site palette keeps its CSS fallbacks (primary-darkest, primary).
      .catch((err: unknown) => console.error('relvista: could not read the site colours', err));
    return () => {
      alive = false;
    };
  }, [enabled, mode, host]);
  return enabled && accents?.mode === mode ? accents.value : null;
}

export type Loaded<T> =
  { state: 'idle' } | { state: 'ok'; value: T } | { state: 'error'; message: string };

export function useFetched<T>(url: string | null, parse: (text: string) => T): Loaded<T> {
  const [result, setResult] = useState<{ url: string; loaded: Loaded<T> } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'}`);
        return parse(await res.text());
      })
      .then(
        (value) => alive && setResult({ url, loaded: { state: 'ok', value } }),
        (err: unknown) =>
          alive &&
          setResult({
            url,
            loaded: { state: 'error', message: `Could not load ${url}: ${messageOf(err)}` },
          }),
      );
    return () => {
      alive = false;
    };
    // `parse` is a module-level function; only the URL matters.
  }, [url]);
  if (!url) return { state: 'idle' };
  return result?.url === url ? result.loaded : { state: 'idle' };
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const asText = (text: string) => text;
const asJson = (text: string): unknown => JSON.parse(text);

/**
 * The minimap would cover too much of a short diagram; otherwise the viewer decides ('auto':
 * larger diagrams in wide viewers, and any diagram with tables off-screen).
 */
export function minimapFor(height: number | string): 'auto' | false {
  return typeof height !== 'number' || height >= 360 ? 'auto' : false;
}

export function cssHeight(height: number | string): string {
  return typeof height === 'number' ? `${height}px` : height;
}

export function Placeholder({
  height,
  title,
  children,
}: {
  height: number | string;
  title?: string | undefined;
  children?: ReactNode;
}): ReactNode {
  return (
    <div
      className={`relvista-placeholder ${styles.placeholder}`}
      style={{ height: cssHeight(height) }}
      aria-busy={children ? undefined : true}
    >
      {title ? <div className={styles.placeholderTitle}>{title}</div> : null}
      {children ?? (
        <div className={styles.placeholderBody}>
          <span className={styles.spinner} aria-hidden="true" />
          Loading diagram…
        </div>
      )}
    </div>
  );
}

export function Problem({ height, children }: { height: number | string; children: ReactNode }) {
  return (
    <Placeholder height={height}>
      <div className={`relvista-error ${styles.problem}`} role="alert">
        {children}
      </div>
    </Placeholder>
  );
}

interface BoundaryProps {
  height: number | string;
  children: ReactNode;
}

/** Keeps a broken diagram from taking the whole page down. */
export class DiagramErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('relvista: diagram crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Problem height={this.props.height}>
        <strong>This diagram could not be rendered.</strong>
        <code>{error.message}</code>
        <button
          type="button"
          className="button button--sm button--secondary"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </Problem>
    );
  }
}

/**
 * Watches the interactive layer: `onDone` once its viewer has the final layout
 * (`data-rv-layout="done"`), when the static layer under it can go.
 */
export function LiveLayer({
  onDone,
  children,
}: {
  onDone: () => void;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (!el.querySelector('.rv-viewer[data-rv-layout="done"]')) return false;
      onDone();
      return true;
    };
    if (check()) return;
    const observer = new MutationObserver(() => {
      if (check()) observer.disconnect();
    });
    observer.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-rv-layout'],
    });
    return () => observer.disconnect();
  }, [onDone]);
  return (
    <div ref={ref} className="relvista-live">
      {children}
    </div>
  );
}

export interface AnchorHash {
  /** `location.hash` while it names this diagram, else null. */
  hash: string | null;
  /** Bumped on every navigation to this diagram. */
  tick: number;
}

/**
 * Per-diagram anchors (docs/design/phase3-v1.md §5.2): registers `anchor` for Docusaurus' broken
 * anchor check, and on load, on client-side navigations and on `hashchange` reads the location
 * hash; when it names this diagram (`#<anchor>` or `#<anchor>&<target keys>`), scrolls the diagram
 * into view and returns the hash for the viewer. Hashes naming anything else (headings, other
 * diagrams) are left alone.
 */
export function useAnchorHash(anchor: string, host: RefObject<HTMLElement | null>): AnchorHash {
  useBrokenLinks().collectAnchor(anchor);
  const location = useLocation() as { hash?: string; key?: string; pathname?: string };
  const instance = useId();
  // The build warns about two diagrams with one anchor on a page; the browser also catches a
  // clash with a heading or any other element (the build cannot see those).
  if (typeof document === 'undefined') {
    const warning = duplicateAnchorWarning(location.pathname ?? '', anchor, instance);
    if (warning) console.warn(warning);
  }
  useEffect(() => {
    let same = 0;
    for (const el of Array.from(document.querySelectorAll('[id]'))) if (el.id === anchor) same++;
    if (same > 1)
      console.warn(
        `relvista: more than one element on this page has the id "${anchor}" (a diagram's ` +
          'anchor); give the diagram its own `id`.',
      );
  }, [anchor]);
  const [state, setState] = useState<AnchorHash>({ hash: null, tick: 0 });
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash;
      if (anchorOfHash(hash) !== anchor) return;
      setState((s) => ({ hash, tick: s.tick + 1 }));
      host.current?.scrollIntoView({ block: 'start' });
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [anchor, host, location.hash, location.key]);
  return state;
}

const ssrLayouts = new WeakMap<SsrPayload, Layout>();

/** The build-time positions as a layout (`ssrLayout`), the same object for the same payload. */
export function ssrLayoutOf(payload: SsrPayload): Layout {
  let out = ssrLayouts.get(payload);
  if (!out) {
    out = layoutWithPositions(null, payload);
    ssrLayouts.set(payload, out);
  }
  return out;
}

type Source = string | CompileInputFiles;

export interface ClientDiagramProps {
  value?: Source | undefined;
  /** Resolved URL of the `.dbml` file, when `value` is absent. */
  srcUrl: string | null;
  /** Diff mode: the older version (inline, or the resolved URL of a file). */
  before?: { value?: Source | undefined; srcUrl: string | null } | undefined;
  layout?: Layout | string | null | undefined;
  /** Resolved URL of `layout` when it is a path. */
  layoutUrl: string | null;
  view?: string | undefined;
  title?: string | undefined;
  detailLevel?: DetailLevel | undefined;
  toolbar?: ToolbarItem[] | undefined;
  editorUrl?: string | false | undefined;
  palette?: 'site' | 'relvista' | undefined;
  height: number | string;
  config: DbmlThemeConfig;
  /** Element the site's colours are read in (the diagram's wrapper). */
  host: RefObject<HTMLElement | null>;
  /**
   * Key of the static layer under the viewer (SSR on), whose build-time positions the viewer
   * takes; while loading, the static picture shows instead of a placeholder.
   */
  ssrKey: string | null;
  anchor: string;
  anchorHash: AnchorHash;
  /** Message for a diagram with nothing to draw. */
  missing: string;
}

/** The interactive viewer of a diagram (or a diff), once its files are fetched and checked. */
export function ClientDiagram(props: ClientDiagramProps): ReactNode {
  const { value, srcUrl, before, layout, layoutUrl, view, title, detailLevel, toolbar } = props;
  const { editorUrl, height, config, host, ssrKey, anchor, anchorHash } = props;
  // Over the static layer, loading states draw nothing: the static picture is the placeholder.
  const loading = ssrKey ? null : <Placeholder height={height} title={title} />;
  const colorMode = useSiteColorMode();
  const sitePalette = (props.palette ?? config.palette) === 'site';
  const accents = useSiteAccents(host, colorMode, sitePalette);
  const fetchedSource = useFetched(value === undefined ? srcUrl : null, asText);
  const fetchedBefore = useFetched(
    before && before.value === undefined ? before.srcUrl : null,
    asText,
  );
  const fetchedLayout = useFetched(typeof layout === 'string' ? layoutUrl : null, asJson);
  const [layoutParsed, setLayoutParsed] = useState<{
    input: unknown;
    result: { ok: true; layout: Layout } | { ok: false; message: string };
  } | null>(null);

  const layoutInput: unknown =
    typeof layout === 'string'
      ? fetchedLayout.state === 'ok'
        ? fetchedLayout.value
        : undefined
      : layout;

  // Validate the layout file with core's schema (core is loaded with the viewer chunk).
  useEffect(() => {
    if (layoutInput === undefined || layoutInput === null) return;
    let alive = true;
    void import(/* webpackChunkName: "relvista-viewer" */ '@relvista/core').then(
      ({ parseLayout }) => {
        if (!alive) return;
        const r = parseLayout(layoutInput);
        setLayoutParsed({
          input: layoutInput,
          result: r.ok
            ? { ok: true, layout: r.layout }
            : {
                ok: false,
                message: r.errors.map((e) => `${e.path || '/'} ${e.message}`).join('; '),
              },
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [layoutInput]);

  if ((value === undefined && !srcUrl) || (before && before.value === undefined && !before.srcUrl))
    return <Problem height={height}>{props.missing}</Problem>;
  for (const f of [fetchedSource, fetchedBefore, fetchedLayout])
    if (f.state === 'error') return <Problem height={height}>{f.message}</Problem>;

  const source = value ?? (fetchedSource.state === 'ok' ? fetchedSource.value : undefined);
  const against = before
    ? (before.value ?? (fetchedBefore.state === 'ok' ? fetchedBefore.value : undefined))
    : null;
  const layoutReady =
    layoutInput === undefined || layoutInput === null
      ? typeof layout !== 'string'
      : layoutParsed?.input === layoutInput;
  if (source === undefined || against === undefined || !layoutReady) return loading;
  if (layoutParsed && layoutParsed.input === layoutInput && !layoutParsed.result.ok) {
    return <Problem height={height}>Invalid layout file: {layoutParsed.result.message}</Problem>;
  }
  const parsedLayout =
    layoutParsed && layoutParsed.input === layoutInput && layoutParsed.result.ok
      ? layoutParsed.result.layout
      : null;
  // Build-time positions (SSR): every node placed, so no ELK runs and the canvas draws what the
  // static SVG shows. They stay out of the layout, so "Open in editor" never carries them.
  const payload = ssrKey ? ssrPayload(ssrKey) : null;

  const editor = (editorUrl ?? config.editorUrl) || undefined;
  const items = (toolbar ?? config.toolbar).filter((i) => i !== 'open-in-editor' || !!editor);
  return (
    <Suspense fallback={loading}>
      <LiveViewer
        source={source}
        layout={parsedLayout}
        ssrLayout={payload ? ssrLayoutOf(payload) : null}
        {...(against !== null ? { diffAgainst: against } : {})}
        view={view}
        height={height}
        title={title}
        colorMode={colorMode}
        {...(detailLevel ? { detailLevel } : {})}
        defaultDetailLevel={config.detailLevel}
        toolbar={items}
        editorUrl={editor}
        minimap={minimapFor(height)}
        workerUrl={elkWorkerUrl}
        className={sitePalette ? 'relvista-viewer rv-palette-site' : 'relvista-viewer'}
        {...(accents ? { style: accents as CSSProperties } : {})}
        anchor={anchor}
        hash={anchorHash.hash}
        hashTick={anchorHash.tick}
      />
    </Suspense>
  );
}
