import { METRICS, type Ref, type RefEndpoint } from '@relvista/core';
import { memo, type ReactElement } from 'react';
import { safeColor } from '../theme.js';
import { useColors } from './context.js';
import { DIM_OPACITY, REMOVED_DASH, TONE_COLOR, type DecorationTone } from './decorations.js';
import { round, type Point, type RefRoute, type RouteEnd } from './routing.js';
import { baseline } from './text.js';

/** How a ref is drawn relative to the current highlight. */
export type RefState = 'normal' | 'highlight' | 'dim';

/** Opacity of an inactive ref (drawn under the active ones). */
export const INACTIVE_OPACITY = 0.6;

/** Several refs drawn as one line (ends in a collapsed group, see `mergeRefs`). */
export interface RefMerge {
  /** Every ref of the line, `refModel` included. */
  refs: readonly Ref[];
  /** Marker at each end of `refModel`'s route, or null for a plain end (the refs disagree there). */
  from: RefEndpoint | null;
  to: RefEndpoint | null;
}

/** Props of `RefSvg`. */
export interface RefSvgProps {
  /** The ref to draw. */
  refModel: Ref;
  /** Its route, from `routeAll`. */
  route: RefRoute;
  /** Normal, lit by the highlight, or dimmed. Default `normal`. */
  state?: RefState;
  /** Decoration tone (stroke colour, width 2; removed dashed). */
  tone?: DecorationTone;
  /** Dimmed by `Decorations.dimOthers` (opacity 0.28). */
  dimmed?: boolean;
  /** Drawn for several refs: count label `×N`, merged markers, every ref in the tooltip. */
  merged?: RefMerge | null;
}

/** The point halfway along a polyline (by length). */
export function polylineMidpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= left && len > 0) {
      const t = left / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= len;
  }
  return points[points.length - 1]!;
}

/** Text describing a ref, used as its tooltip. */
export function refLabel(ref: Ref): string {
  const end = (e: RefEndpoint) =>
    `${e.tableId}.${e.columns.length > 1 ? `(${e.columns.join(', ')})` : (e.columns[0] ?? '')}`;
  const parts = [`${end(ref.from)} ${ref.relation} ${end(ref.to)}`];
  if (ref.name) parts.unshift(ref.name + ':');
  if (ref.onDelete) parts.push(`delete: ${ref.onDelete}`);
  if (ref.onUpdate) parts.push(`update: ${ref.onUpdate}`);
  if (ref.inactive) parts.push('(inactive)');
  let s = parts.join(' ');
  if (ref.note) s += `\n${ref.note}`;
  return s;
}

/**
 * Crow's-foot marker for one ref end, drawn in local coordinates where the origin is on the table
 * edge and +x points away from the table: one = bar, many = crow's foot, optional = circle.
 *
 * @param props - The cardinality, optionality and colour of the end.
 */
export function CardinalityMarker({
  end,
  endpoint,
  stroke,
  bg,
  width,
}: {
  end: RouteEnd;
  endpoint: RefEndpoint;
  stroke: string;
  bg: string;
  width: number;
}): ReactElement {
  const many = endpoint.cardinality === 'many';
  const d = many ? 'M13 0 L0 -6.5 M13 0 L0 6.5 M13 0 L0 0' : 'M8 -6 V6';
  const circleX = many ? 18 : 13.5;
  return (
    <g
      className="rv-marker"
      data-rv-marker={many ? 'many' : 'one'}
      data-rv-optional={endpoint.optional ? 'true' : undefined}
      transform={`translate(${round(end.x)} ${round(end.y)}) rotate(${round(end.angle)})`}
      style={{ stroke, fill: 'none' }}
      strokeWidth={width}
      strokeLinecap="round"
    >
      <path d={d} />
      {endpoint.optional ? <circle cx={circleX} cy={0} r={3.6} style={{ fill: bg }} /> : null}
    </g>
  );
}

/** A ref line with its cardinality markers at both ends. */
export const RefSvg = memo<RefSvgProps>(function RefSvg({
  refModel,
  route,
  state = 'normal',
  tone,
  dimmed = false,
  merged,
}: RefSvgProps): ReactElement {
  const { c, font } = useColors();
  const refs = merged && merged.refs.length > 0 ? merged.refs : [refModel];
  const count = refs.length;
  const inactive = refs.every((r) => r.inactive);
  const user = safeColor(refModel.color);
  const stroke = tone
    ? c(TONE_COLOR[tone])
    : state === 'highlight' && !user
      ? c('refHighlight')
      : (user ?? c('refStroke'));
  const width = tone || state === 'highlight' ? 2 : 1.4;
  const dash = tone === 'removed' ? REMOVED_DASH : inactive ? '5 4' : undefined;
  const opacity =
    state === 'dim' ? 0.18 : dimmed ? DIM_OPACITY : inactive ? INACTIVE_OPACITY : undefined;
  const fromEnd = merged ? merged.from : refModel.from;
  const toEnd = merged ? merged.to : refModel.to;
  const mid = count > 1 ? polylineMidpoint(route.points) : null;
  const fs = METRICS.badge.fontSize + 1;
  const label = `×${count}`;
  const labelW = Math.ceil(label.length * fs * 0.62) + 8;
  return (
    <g
      className="rv-ref"
      data-rv-ref={refModel.id}
      data-rv-state={state}
      data-rv-tone={tone}
      data-rv-inactive={inactive ? 'true' : undefined}
      data-rv-merged={count > 1 ? String(count) : undefined}
      data-rv-refs={count > 1 ? refs.map((r) => r.id).join(' ') : undefined}
      opacity={opacity}
    >
      <title>{refs.map(refLabel).join('\n')}</title>
      <path
        d={route.path}
        style={{ stroke, fill: 'none' }}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinejoin="round"
      />
      {fromEnd ? (
        <CardinalityMarker
          end={route.from}
          endpoint={fromEnd}
          stroke={stroke}
          bg={c('canvasBg')}
          width={width}
        />
      ) : null}
      {toEnd ? (
        <CardinalityMarker
          end={route.to}
          endpoint={toEnd}
          stroke={stroke}
          bg={c('canvasBg')}
          width={width}
        />
      ) : null}
      {mid ? (
        <g
          className="rv-ref-count"
          data-rv-ref-count={count}
          transform={`translate(${round(mid.x)} ${round(mid.y)})`}
        >
          <rect
            x={-labelW / 2}
            y={-8}
            width={labelW}
            height={16}
            rx={8}
            style={{ fill: c('canvasBg'), stroke }}
            strokeWidth={1}
          />
          <text
            y={baseline(0, fs)}
            textAnchor="middle"
            style={{ fill: c('rowText'), fontFamily: font, fontSize: fs, fontWeight: 600 }}
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
});
