import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import useBaseUrl from '@docusaurus/useBaseUrl';
import CodeBlock from '@theme/CodeBlock';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import type { Props } from '@theme/DbmlDiagram';
import { sourceText } from '../../source.js';
import { staticKey } from '../../ssr/key.js';
import type { StaticRequest } from '../../ssr/types.js';
import { diagramAnchor, sourceIdentity } from './anchor.js';
import {
  ClientDiagram,
  DiagramErrorBoundary,
  LiveLayer,
  Placeholder,
  Problem,
  minimapFor,
  useAnchorHash,
  useDbmlConfig,
} from './shared.js';
import StaticDiagram from './StaticDiagram.js';
import styles from './styles.module.css';

/**
 * An interactive DBML diagram. With SSR on (default), the page's HTML has the diagram as a static
 * SVG drawn at build time (`StaticDiagram`); in the browser the interactive viewer mounts over it
 * with the build-time positions (`ssrLayout`) and replaces it in place once its layout is final.
 * With SSR off, server rendering emits a placeholder of the final size and the viewer loads in the
 * browser.
 *
 * The wrapper's `id` is the diagram's anchor (the `id` prop, else the title's slug, else a hash of
 * the source): `#<anchor>` scrolls to it and `#<anchor>&table=…&view=…` also opens it there
 * (docs/design/phase3-v1.md §5.2).
 */
export default function DbmlDiagram(props: Props): ReactNode {
  const config = useDbmlConfig();
  const height = props.height ?? config.height;
  const host = useRef<HTMLDivElement>(null);
  const srcUrl = useBaseUrl(props.src ?? '');
  const layoutUrl = useBaseUrl(typeof props.layout === 'string' ? props.layout : '');
  const ssr = (props.ssr ?? config.ssr) !== false;
  const [liveDone, setLiveDone] = useState(false);
  const onLiveDone = useCallback(() => setLiveDone(true), []);
  const anchor = diagramAnchor({
    id: props.id,
    title: props.title,
    source: sourceIdentity(props.value, props.src),
    view: props.view,
  });
  const anchorHash = useAnchorHash(anchor, host);

  const palette = props.palette ?? config.palette;
  const minimap = minimapFor(height);
  const key = staticKey([
    1,
    props.value ?? null,
    props.value === undefined ? (props.src ?? null) : null,
    props.layout ?? null,
    props.view ?? '*',
    props.detailLevel ?? null,
    config.detailLevel,
    props.title ?? null,
    height,
    palette,
    minimap,
  ]);
  const request = useMemo<StaticRequest>(
    () => ({
      key,
      ...(props.value !== undefined ? { value: props.value } : {}),
      ...(props.value === undefined && props.src ? { src: props.src } : {}),
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

  const live = (ssrKey: string | null) => (
    <DiagramErrorBoundary height={height}>
      <ClientDiagram
        value={props.value}
        srcUrl={props.src ? srcUrl : null}
        layout={props.layout}
        layoutUrl={typeof props.layout === 'string' ? layoutUrl : null}
        view={props.view}
        title={props.title}
        detailLevel={props.detailLevel}
        toolbar={props.toolbar}
        editorUrl={props.editorUrl}
        palette={props.palette}
        frozen={props.frozen}
        height={height}
        config={config}
        host={host}
        ssrKey={ssrKey}
        anchor={anchor}
        anchorHash={anchorHash}
        missing="DbmlDiagram needs a `value` or a `src`."
      />
    </DiagramErrorBoundary>
  );

  const placeholder = <Placeholder height={height} title={props.title} />;
  const diagram = ssr ? (
    <div className="relvista-ssr" data-rv-live={liveDone ? 'done' : undefined}>
      {/* No Suspense boundary here on purpose: the static diagram suspends the server render's
          shell, which React then writes inline. A boundary's content over 500 bytes would be
          streamed hidden and revealed by a script (React 19.2+), so pages without JS would only
          show the placeholder. */}
      <StaticDiagram
        request={request}
        hidden={liveDone}
        placeholder={placeholder}
        problem={(message) => <Problem height={height}>{message}</Problem>}
      />
      <BrowserOnly fallback={null}>
        {() => <LiveLayer onDone={onLiveDone}>{live(key)}</LiveLayer>}
      </BrowserOnly>
    </div>
  ) : (
    <BrowserOnly fallback={placeholder}>{() => live(null)}</BrowserOnly>
  );

  const code = props.value !== undefined ? sourceText(props.value) : null;
  const wrapperClass = ['relvista-diagram', styles.wrapper, props.className]
    .filter(Boolean)
    .join(' ');
  const view = props.view ?? '*';
  const wrapper = { ref: host, id: anchor, className: wrapperClass, 'data-rv-anchor': anchor };
  if (!props.source || code === null)
    return (
      <div {...wrapper} data-rv-view={view}>
        {diagram}
      </div>
    );

  return (
    <div {...wrapper} data-rv-view={view}>
      <Tabs className={styles.tabs}>
        <TabItem value="diagram" label="Diagram" default>
          {diagram}
        </TabItem>
        <TabItem value="source" label="Source">
          <CodeBlock language="dbml" title={props.title}>
            {code}
          </CodeBlock>
        </TabItem>
      </Tabs>
    </div>
  );
}
