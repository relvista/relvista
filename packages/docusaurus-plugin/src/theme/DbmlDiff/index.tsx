import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import relvistaSsr from 'relvista-ssr-files';
import type { CompileInput } from '@relvista/core';
import type { Props } from '@theme/DbmlDiff';
import { staticKey } from '../../ssr/key.js';
import type { SsrBackend, SsrPayload } from '../../ssr/types.js';
import { diagramAnchor, sourceIdentity } from '../DbmlDiagram/anchor.js';
import {
  ClientDiagram,
  DiagramErrorBoundary,
  LiveLayer,
  Placeholder,
  Problem,
  asText,
  minimapFor,
  useAnchorHash,
  useDbmlConfig,
  useFetched,
} from '../DbmlDiagram/shared.js';
import { scriptJson, serverMarkup, warnOnce } from '../DbmlDiagram/StaticDiagram.js';
import wrapperStyles from '../DbmlDiagram/styles.module.css';
import type * as BuildModuleNs from './build.js';
import type { DiffRequest } from './build.js';
import type { DiffResult } from './server.js';
import { ChangeList, missingMessage, type DiffChanges } from './changes.js';

type BuildModule = typeof BuildModuleNs;
/** The change list in the browser (core loads with the viewer chunk). */
const loadBuild = () =>
  import(/* webpackChunkName: "relvista-viewer" */ './build.js') as Promise<BuildModule>;

/** The server backend with the diff renderer (src/ssr/server.tsx). */
type DiffSsrBackend = SsrBackend & { renderDiff?: (request: DiffRequest) => Promise<DiffResult> };

type Entry = { status: 'pending'; promise: Promise<void> } | { status: 'done'; result: DiffResult };

/** Build results by key, shared by every page of the build. */
const builds = new Map<string, Entry>();

/** The static diff for `request` at build time; suspends (throws) until it is ready. */
function buildResult(backend: DiffSsrBackend, request: DiffRequest): DiffResult {
  const render = backend.renderDiff;
  if (!render)
    return { kind: 'skip', reason: 'this version of the plugin cannot draw diffs at build time' };
  const hit = builds.get(request.key);
  if (hit?.status === 'done') return hit.result;
  if (hit) throw hit.promise;
  const promise = render(request).then(
    (result) => void builds.set(request.key, { status: 'done', result }),
    (err: unknown) =>
      void builds.set(request.key, {
        status: 'done',
        result: { kind: 'error', message: err instanceof Error ? err.message : String(err) },
      }),
  );
  builds.set(request.key, { status: 'pending', promise });
  throw promise;
}

type Payload = SsrPayload & { changes?: DiffChanges };

/** The change list of the server's JSON script (hydration), or null. */
function serverChanges(json: string | null): DiffChanges | null {
  if (!json) return null;
  try {
    const c = (JSON.parse(json) as Payload).changes;
    return c && Array.isArray(c.lines) && c.summary ? c : null;
  } catch {
    return null;
  }
}

/** The change list computed in the browser (no build-time list: SSR off, client navigation). */
function ClientChanges({
  old,
  oldUrl,
  next,
  nextUrl,
}: {
  old: CompileInput | undefined;
  oldUrl: string | null;
  next: CompileInput | undefined;
  nextUrl: string | null;
}): ReactNode {
  const a = useFetched(old === undefined ? oldUrl : null, asText);
  const b = useFetched(next === undefined ? nextUrl : null, asText);
  const before = old ?? (a.state === 'ok' ? a.value : undefined);
  const after = next ?? (b.state === 'ok' ? b.value : undefined);
  const [changes, setChanges] = useState<{ for: unknown[]; value: DiffChanges | null } | null>(
    null,
  );
  useEffect(() => {
    if (before === undefined || after === undefined) return;
    let alive = true;
    loadBuild().then(
      (mod) =>
        alive && setChanges({ for: [before, after], value: mod.changesOfSources(before, after) }),
      (err: unknown) => console.error('relvista: could not compare the versions', err),
    );
    return () => {
      alive = false;
    };
  }, [before, after]);
  const value =
    changes && changes.for[0] === before && changes.for[1] === after ? changes.value : null;
  return value ? <ChangeList changes={value} /> : null;
}

/**
 * A schema diff: the new version drawn with what changed since the old one (added, removed and
 * changed tables, columns, refs, notes and groups toned, removed ones kept in the picture), and a
 * "Changes (+3 −1 ~4)" list under it (docs/design/phase3-v1.md §5.3). Both are in the page's HTML
 * at build time; in the browser the interactive viewer (`diffAgainst`) replaces the static picture
 * in place, as for `@theme/DbmlDiagram`.
 */
export default function DbmlDiff(props: Props): ReactNode {
  const config = useDbmlConfig();
  const height = props.height ?? config.height;
  const host = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const oldUrl = useBaseUrl(props.oldSrc ?? '');
  const newUrl = useBaseUrl(props.newSrc ?? '');
  const layoutUrl = useBaseUrl(typeof props.layout === 'string' ? props.layout : '');
  const ssr = (props.ssr ?? config.ssr) !== false;
  const summary = props.summary !== false;
  const [liveDone, setLiveDone] = useState(false);
  const onLiveDone = useCallback(() => setLiveDone(true), []);
  const anchor = diagramAnchor({
    id: props.id,
    title: props.title,
    source: `${sourceIdentity(props.new, props.newSrc)}\u0000${sourceIdentity(props.old, props.oldSrc)}`,
    view: props.view,
  });

  const palette = props.palette ?? config.palette;
  const minimap = minimapFor(height);
  const key = staticKey([
    'diff',
    1,
    props.old ?? null,
    props.old === undefined ? (props.oldSrc ?? null) : null,
    props.new ?? null,
    props.new === undefined ? (props.newSrc ?? null) : null,
    props.layout ?? null,
    props.view ?? '*',
    props.detailLevel ?? null,
    config.detailLevel,
    props.title ?? null,
    height,
    palette,
    minimap,
  ]);
  const request = useMemo<DiffRequest>(
    () => ({
      key,
      ...(props.old !== undefined ? { old: props.old } : {}),
      ...(props.old === undefined && props.oldSrc ? { oldSrc: props.oldSrc } : {}),
      ...(props.new !== undefined ? { new: props.new } : {}),
      ...(props.new === undefined && props.newSrc ? { newSrc: props.newSrc } : {}),
      ...(props.layout !== undefined ? { layout: props.layout } : {}),
      ...(props.view !== undefined ? { view: props.view } : {}),
      ...(props.detailLevel ? { detailLevel: props.detailLevel } : {}),
      defaultDetailLevel: config.detailLevel,
      ...(props.title !== undefined ? { title: props.title } : {}),
      height,
      palette,
      minimap,
    }),
    // Everything the request holds is in the key.
    [key],
  );

  const backend =
    ssr && typeof document === 'undefined' ? (relvistaSsr() as DiffSsrBackend | null) : null;
  const server = useMemo(() => (ssr ? serverMarkup(key) : null), [ssr, key]);
  const built = backend ? buildResult(backend, request) : null;
  // After the build result: a render that suspends (above) records no anchor.
  const anchorHash = useAnchorHash(anchor, host);

  const hostProps = {
    className: 'relvista-static',
    'data-rv-static': key,
    'aria-hidden': liveDone ? ('true' as const) : ('false' as const),
    ...(liveDone ? { hidden: true } : {}),
  };
  const placeholder = <Placeholder height={height} title={props.title} />;
  let staticLayer: ReactNode = null;
  let changes: DiffChanges | null = null;
  if (built) {
    if (built.kind === 'ok') {
      changes = built.payload.changes;
      staticLayer = (
        <>
          <div {...hostProps} dangerouslySetInnerHTML={{ __html: built.html }} />
          <script
            type="application/json"
            data-rv-ssr={key}
            dangerouslySetInnerHTML={{ __html: scriptJson(built.payload) }}
          />
        </>
      );
    } else {
      if (built.kind === 'error') warnOnce(pathname, request, built.message);
      else if (built.reason)
        warnOnce(pathname, request, `not drawn at build time: ${built.reason}`);
      staticLayer = (
        <div {...hostProps}>
          {built.kind === 'error' ? (
            <Problem height={height}>{built.message}</Problem>
          ) : (
            placeholder
          )}
        </div>
      );
    }
  } else if (server) {
    // Hydration: exactly the server's markup, so nothing is re-rendered or moves.
    changes = serverChanges(server.json);
    staticLayer = (
      <>
        <div
          {...hostProps}
          dangerouslySetInnerHTML={{ __html: server.html }}
          suppressHydrationWarning
        />
        {server.json !== null ? (
          <script
            type="application/json"
            data-rv-ssr={key}
            dangerouslySetInnerHTML={{ __html: server.json }}
            suppressHydrationWarning
          />
        ) : null}
      </>
    );
  }

  // Over a static layer, the viewer takes its build-time positions (when there are any).
  const ssrKey = staticLayer ? key : null;
  const live = (
    <DiagramErrorBoundary height={height}>
      <ClientDiagram
        value={props.new}
        srcUrl={props.new === undefined && props.newSrc ? newUrl : null}
        before={{
          value: props.old,
          srcUrl: props.old === undefined && props.oldSrc ? oldUrl : null,
        }}
        layout={props.layout}
        layoutUrl={typeof props.layout === 'string' ? layoutUrl : null}
        view={props.view}
        title={props.title}
        detailLevel={props.detailLevel}
        toolbar={props.toolbar}
        editorUrl={false}
        palette={props.palette}
        frozen={props.frozen}
        height={height}
        config={config}
        host={host}
        ssrKey={ssrKey}
        anchor={anchor}
        anchorHash={anchorHash}
        missing={missingMessage(props.old === undefined && !props.oldSrc ? 'old' : 'new')}
      />
    </DiagramErrorBoundary>
  );

  const diagram = staticLayer ? (
    <div className="relvista-ssr" data-rv-live={liveDone ? 'done' : undefined}>
      {staticLayer}
      <BrowserOnly fallback={null}>
        {() => <LiveLayer onDone={onLiveDone}>{live}</LiveLayer>}
      </BrowserOnly>
    </div>
  ) : (
    <BrowserOnly fallback={placeholder}>{() => live}</BrowserOnly>
  );

  const wrapperClass = ['relvista-diagram', 'relvista-diff', wrapperStyles.wrapper, props.className]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={host}
      id={anchor}
      className={wrapperClass}
      data-rv-anchor={anchor}
      data-rv-view={props.view ?? '*'}
    >
      {diagram}
      {!summary ? null : changes ? (
        <ChangeList changes={changes} />
      ) : (
        <BrowserOnly fallback={null}>
          {() => (
            <ClientChanges
              old={props.old}
              oldUrl={props.old === undefined && props.oldSrc ? oldUrl : null}
              next={props.new}
              nextUrl={props.new === undefined && props.newSrc ? newUrl : null}
            />
          )}
        </BrowserOnly>
      )}
    </div>
  );
}
