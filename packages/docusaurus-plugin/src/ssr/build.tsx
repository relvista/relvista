// Browser-safe: the static diagram (docs/design/phase3-v1.md §5.1), shared by the build-time render
// (ssr/server.tsx) and the client after a client-side navigation (theme/DbmlDiagram/ClientStatic).
import {
  DEFAULT_VIEW,
  compileDbml,
  layoutDiagramSync,
  mergeViewDefaults,
  selectView,
  viewDetailLevel,
  type CompileInput,
  type DetailLevel,
  type DiagramGeometry,
  type DiagramModel,
  type Layout,
  type NodeLayout,
  type ViewLayout,
  type ViewLayoutOverride,
} from '@relvista/core';
import { DiagramSvg, type EdgeStyle } from '@relvista/renderer';
import type { CSSProperties, ReactElement } from 'react';
import { frameStyle } from './frames.js';
import type { SsrPayload } from './types.js';

/**
 * Constants of the interactive viewer's first view (`@relvista/renderer` canvas: `PAD`,
 * `MAX_FIT_ZOOM`, `MINIMAP`, the fit floors). The static picture is framed with the same rule, so
 * the swap to the interactive canvas does not move. Keep in sync with
 * `packages/renderer/src/canvas/DiagramCanvas.tsx`; the CSS lives in `client/static.css`.
 */
export const VIEWER_FRAME = {
  pad: { top: 64, right: 28, bottom: 28, left: 28 },
  /** Room the narrow viewer keeps under the diagram for its title chip. */
  narrowTitle: 36,
  /** Top padding when the chips row (a diff's legend) sits under the toolbar. */
  chipsTop: 54 + 32 + 10,
  /** Height + margin of the wide minimap, kept free at the bottom when it is always shown. */
  minimap: 80 + 12,
  /** The 'auto' minimap is always shown from this many tables (wide viewers). */
  minimapTables: 8,
  smallTables: 12,
  fitFloor: 0.55,
  fitFloorSmall: 0.45,
} as const;

export interface StaticInputs {
  source: CompileInput;
  layout: Layout | null;
  view?: string;
  detailLevel?: DetailLevel;
  defaultDetailLevel: DetailLevel;
}

/** A compiled, view-filtered diagram with everything its layout depends on. */
export interface PreparedStatic {
  model: DiagramModel;
  /** The view drawn (an unknown name falls back to every table, as in the viewer). */
  view: string;
  saved: ViewLayoutOverride | null;
  detailLevel: DetailLevel;
  edgeStyle: EdgeStyle;
}

export type Prepared = { ok: true; value: PreparedStatic } | { ok: false; message: string };

/** Compiles and selects the view the way `DbmlViewer` does. */
export function prepareStatic(inputs: StaticInputs): Prepared {
  const compiled = compileDbml(inputs.source);
  const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
  if (!compiled.model || errors.length) {
    const first = errors[0];
    const where = first
      ? `${typeof inputs.source === 'string' ? '' : `${first.file ?? ''}:`}${first.start.line}:${first.start.column} `
      : '';
    return {
      ok: false,
      message: `The DBML has errors: ${where}${first?.message ?? 'no diagram to show'}`,
    };
  }
  const full = compiled.model;
  const asked = inputs.view ?? DEFAULT_VIEW;
  const known = asked === DEFAULT_VIEW || full.views.some((v) => v.name === asked);
  const view = known ? asked : DEFAULT_VIEW;
  const model = view === DEFAULT_VIEW ? full : (selectView(full, view) ?? full);
  const layout = inputs.layout;
  return {
    ok: true,
    value: {
      model,
      view,
      saved: layout ? mergeViewDefaults(layout, view) : null,
      detailLevel: inputs.detailLevel ?? viewDetailLevel(layout, view) ?? inputs.defaultDetailLevel,
      edgeStyle: layout?.settings?.theme?.edgeStyle ?? 'orthogonal',
    },
  };
}

/** Top-left corners of every placed node: tables, notes and collapsed groups. */
export function positionsOf(geometry: DiagramGeometry): SsrPayload['positions'] {
  const out: SsrPayload['positions'] = {};
  for (const id of Object.keys(geometry.nodes)) {
    const n = geometry.nodes[id]!;
    out[id] = { x: n.x, y: n.y };
  }
  for (const id of Object.keys(geometry.groups)) {
    const g = geometry.groups[id]!;
    if (g.collapsed) out[id] = { x: g.x, y: g.y };
  }
  return out;
}

/** `saved` with every position of `positions` applied (sizes and flags kept). */
export function withPositions(
  saved: ViewLayoutOverride | null,
  positions: SsrPayload['positions'],
): ViewLayoutOverride {
  const nodes: Record<string, Partial<NodeLayout>> = { ...(saved?.nodes ?? {}) };
  for (const id of Object.keys(positions)) nodes[id] = { ...nodes[id], ...positions[id] };
  return { ...(saved ?? {}), nodes };
}

/**
 * The geometry the interactive canvas computes from the payload: every node placed, laid out
 * synchronously (no engine runs), routed by the renderer. The static SVG draws this one, so both
 * pictures are the same.
 */
export function placedGeometry(p: PreparedStatic, positions: SsrPayload['positions']) {
  return layoutDiagramSync(p.model, {
    engine: 'dagre',
    detailLevel: p.detailLevel,
    saved: withPositions(p.saved, positions) as Partial<ViewLayout>,
  });
}

export function payloadOf(view: string, geometry: DiagramGeometry): SsrPayload {
  const groups: SsrPayload['groups'] = {};
  for (const id of Object.keys(geometry.groups)) {
    const g = geometry.groups[id]!;
    groups[id] = {
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      ...(g.collapsed ? { collapsed: true as const } : {}),
    };
  }
  return { v: 1, view, positions: positionsOf(geometry), groups };
}

export function cssLength(height: number | string): string {
  return typeof height === 'number' ? `${height}px` : height;
}

export const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Inline style variables and the width-dependent frame rules (`frames.ts`) of a static box: the
 * plain CSS fit of client/static.css for heights that are not pixel numbers and old browsers, the
 * viewer's exact first view otherwise.
 */
export function boxFrame(o: {
  prepared: PreparedStatic;
  geometry: DiagramGeometry;
  title?: string | undefined;
  height: number | string;
  minimap: 'auto' | false;
  chips: boolean;
  idPrefix: string;
}): { style: CSSProperties; css: string } {
  const b = o.geometry.bounds;
  const tables = o.prepared.model.tables.length;
  const f = VIEWER_FRAME;
  const minimapAlways = o.minimap === 'auto' && tables >= f.minimapTables;
  const style = {
    '--rv-box-h': cssLength(o.height),
    '--rv-w': round(b.width),
    '--rv-h': round(b.height),
    '--rv-bx': round(b.x),
    '--rv-by': round(b.y),
    '--rv-floor-wide': tables <= f.smallTables ? f.fitFloorSmall : f.fitFloor,
    '--rv-pt-wide': `${o.chips && o.title ? f.chipsTop : f.pad.top}px`,
    '--rv-pt-narrow': `${o.chips ? f.chipsTop : f.pad.top}px`,
    '--rv-pb-wide': `${f.pad.bottom + (minimapAlways ? f.minimap : 0)}px`,
    '--rv-pb-narrow': `${f.pad.bottom + (o.title ? f.narrowTitle : 0)}px`,
  } as CSSProperties;
  const empty = !(b.width > 0 && b.height > 0);
  const css =
    typeof o.height === 'number' && !empty
      ? frameStyle(o.idPrefix, {
          geometry: o.geometry,
          model: o.prepared.model,
          height: o.height,
          title: !!o.title,
          chips: o.chips,
          minimap: o.minimap,
        })
      : '';
  return { style, css };
}

/** The `<style>` of `boxFrame`, when there are rules. */
export function FrameStyle({ css }: { css: string }): ReactElement | null {
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}

export interface StaticBoxProps {
  prepared: PreparedStatic;
  geometry: DiagramGeometry;
  title?: string;
  height: number | string;
  palette: 'site' | 'relvista';
  minimap: 'auto' | false;
  /** Unique per diagram: ids inside the SVG. */
  idPrefix: string;
}

/**
 * The static diagram box (`client/static.css` frames it): the size, padding and zoom rule of the
 * viewer's first view, as CSS variables, the title chip and the SVG with `var(--rv-*)` colours.
 */
export function StaticBox(props: StaticBoxProps): ReactElement {
  const { prepared, geometry: g, title, height, palette } = props;
  const b = g.bounds;
  const empty = !(b.width > 0 && b.height > 0);
  const frame = boxFrame({ ...props, chips: false });
  return (
    <div
      className={`relvista-static-box${palette === 'site' ? ' rv-palette-site' : ''}`}
      data-rv-color-mode="light"
      data-rv-fixed-height={typeof height === 'number' ? '' : undefined}
      data-rv-frame={frame.css ? props.idPrefix : undefined}
      style={frame.style}
    >
      <FrameStyle css={frame.css} />
      <div className="relvista-static-grid" aria-hidden="true" />
      {title ? (
        <div className="rv-title" title={title}>
          {title}
        </div>
      ) : null}
      {empty ? (
        <div className="relvista-static-empty">
          {prepared.view !== DEFAULT_VIEW
            ? `The view “${prepared.view}” has no tables.`
            : 'No tables yet.'}
        </div>
      ) : (
        <DiagramSvg
          model={prepared.model}
          geometry={g}
          detailLevel={prepared.detailLevel}
          edgeStyle={prepared.edgeStyle}
          padding={0}
          background={false}
          width="100%"
          height="100%"
          title={title}
          idPrefix={props.idPrefix}
        />
      )}
    </div>
  );
}
