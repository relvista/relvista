import type { Ref } from '@relvista/core';
import type { Edge, EdgeProps } from '@xyflow/react';
import { memo, type ReactElement } from 'react';
import { refTone } from '../svg/decorations.js';
import { RefSvg, type RefMerge } from '../svg/RefSvg.js';
import type { RefRoute } from '../svg/routing.js';
import { useViewerState } from './context.js';

export type RefFlowEdge = Edge<
  {
    refModel: Ref;
    route: RefRoute;
    /** Several refs drawn as one line (ends in a collapsed group); null for a single ref. */
    merged?: RefMerge | null;
    /** Ids of every ref the line draws (`refModel` first). */
    refIds?: readonly string[];
  },
  'rvRef'
>;

/** Width of the invisible stroke that takes pointer events when the canvas has edge handlers. */
export const EDGE_HIT_WIDTH = 12;

/**
 * Draws the ref from the shared route (same as the static SVG), not from React Flow's handle
 * coordinates; the per-column handles only anchor the edge for React Flow.
 */
export const RefEdge = memo<EdgeProps<RefFlowEdge>>(function RefEdge({
  id,
  data,
}: EdgeProps<RefFlowEdge>): ReactElement | null {
  const v = useViewerState();
  if (!data) return null;
  const ids = data.refIds ?? [id];
  const state = v.lit
    ? ids.some((r) => v.lit!.refs.has(r))
      ? 'highlight'
      : v.dim
        ? 'dim'
        : 'normal'
    : 'normal';
  const tone = ids.map((r) => refTone(v.decorations, r)).find((t) => t !== undefined);
  return (
    <>
      <RefSvg
        refModel={data.refModel}
        route={data.route}
        state={state}
        tone={tone}
        dimmed={!!v.decorations?.dimOthers && tone === undefined}
        merged={data.merged ?? null}
      />
      {v.edgeEvents ? (
        // Hidden: `pointer-events: stroke` hit-tests the stroke whatever the visibility (SVG 2),
        // and a hidden path is not painted. Painted (even transparent), the hit paths added about
        // 17 ms to Chrome's compositing pass of every drag frame at 600 tables (~72 → ~55 ms).
        <path
          className="rv-edge-hit"
          d={data.route.path}
          fill="none"
          stroke="transparent"
          strokeWidth={EDGE_HIT_WIDTH}
          visibility="hidden"
          style={{ pointerEvents: 'stroke' }}
        />
      ) : null}
    </>
  );
});

export const edgeTypes = { rvRef: RefEdge };
