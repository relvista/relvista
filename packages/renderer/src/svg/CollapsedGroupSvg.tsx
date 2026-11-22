import {
  METRICS,
  collapsedGroupLabel,
  estimateTextWidth,
  type Box,
  type TableGroup,
  type TextMeasure,
} from '@relvista/core';
import { memo, type ReactElement } from 'react';
import { contrastText, parseHex, safeColor } from '../theme.js';
import { useColors } from './context.js';
import { REMOVED_OPACITY, TINT_OPACITY, TONE_COLOR, type DecorationTone } from './decorations.js';
import { HeaderBadge, ToneRing, headerBadgeWidth } from './TableSvg.js';
import { baseline, truncate } from './text.js';

/** Props of `CollapsedGroupSvg`. */
export interface CollapsedGroupSvgProps {
  /** The collapsed TableGroup to draw. */
  group: TableGroup;
  /** The collapsed box (`geometry.groups[id]`, `collapsed: true`). */
  box: Box;
  /** Titles of the member tables (view-filtered), listed in the tooltip and counted in the row. */
  memberNames: readonly string[];
  /** Draw at reduced opacity (not part of the current highlight). */
  dimmed?: boolean;
  /** Draw with the highlight border. */
  highlighted?: boolean;
  /** id of a `<filter>` in scope for the card shadow. */
  shadowFilter?: string | null;
  /** Text measurement used for truncation. Default: the built-in width estimate. */
  measure?: TextMeasure;
  /** Decoration tone (ring + tint; removed: dashed, 60% opacity). */
  tone?: DecorationTone;
  /** Text badge at the right end of the name band. */
  badge?: string;
}

function StackIcon({ cx, cy, color }: { cx: number; cy: number; color: string }): ReactElement {
  return (
    <g
      transform={`translate(${cx} ${cy})`}
      style={{ stroke: color, fill: 'none' }}
      strokeWidth={1.3}
      strokeLinejoin="round"
      data-rv-icon="stack"
    >
      <rect x={-5.5} y={-2} width={9} height={7} rx={1.5} />
      <path d="M-3.5 -4 H4 Q5.5 -4 5.5 -2.5 V3" />
      <path d="M-1.5 -6 H6 Q7.5 -6 7.5 -4.5 V1" opacity={0.7} />
    </g>
  );
}

/**
 * A collapsed TableGroup: a card like a table, with a header band in the group colour (or
 * `groupDefault`), the group name, and one row "N tables". Its refs attach to the header.
 */
export const CollapsedGroupSvg = memo<CollapsedGroupSvgProps>(function CollapsedGroupSvg({
  group,
  box,
  memberNames,
  dimmed = false,
  highlighted = false,
  shadowFilter,
  measure = estimateTextWidth,
  tone,
  badge,
}: CollapsedGroupSvgProps): ReactElement {
  const { c, value, font } = useColors();
  const w = box.width;
  const h = box.height;
  const r = METRICS.cornerRadius;
  const px = METRICS.paddingX;
  const fs = METRICS.fontSize;
  const hh = Math.min(METRICS.headerHeight, h);
  const user = safeColor(group.color);
  const headerFill = user ?? c('groupDefault');
  const headerRgb = parseHex(user ?? value('groupDefault'));
  const headerText = headerRgb ? contrastText(headerRgb) : c('headerText');
  const badgeRoom = badge ? headerBadgeWidth(badge) + 6 : 0;
  const name = truncate(group.name, 'tableName', w - px * 2 - badgeRoom, measure);
  const rowY = hh;
  const rowCy = rowY + Math.min(METRICS.rowHeight, Math.max(0, h - hh)) / 2;
  // "3 tables": the text `measureCollapsedGroup` sizes.
  const count = collapsedGroupLabel(memberNames.length);
  const tooltip = [`${group.name} (collapsed, ${count})`, ...memberNames].join('\n');
  return (
    <g
      className="rv-group rv-group-collapsed"
      data-rv-group={group.id}
      data-rv-collapsed="true"
      data-rv-tone={tone}
      transform={`translate(${box.x} ${box.y})`}
      opacity={dimmed ? 0.28 : tone === 'removed' ? REMOVED_OPACITY : undefined}
    >
      <title>{group.note ? `${tooltip}\n\n${group.note}` : tooltip}</title>
      <rect
        width={w}
        height={h}
        rx={r}
        ry={r}
        style={{ fill: c('tableBg') }}
        filter={shadowFilter ? `url(#${shadowFilter})` : undefined}
      />
      {tone && h > hh ? (
        <rect
          className="rv-tone-tint"
          y={hh}
          width={w}
          height={Math.max(0, h - hh - r)}
          style={{ fill: c(TONE_COLOR[tone]) }}
          fillOpacity={TINT_OPACITY}
        />
      ) : null}
      <path
        d={`M0 ${r} Q0 0 ${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${hh} H0 Z`}
        style={{ fill: headerFill }}
      />
      <text
        x={px}
        y={baseline(hh / 2, fs.tableName)}
        className="rv-table-name"
        style={{
          fill: headerText,
          fontFamily: font,
          fontSize: fs.tableName,
          fontWeight: METRICS.fontWeight.tableName,
        }}
      >
        {name}
      </text>
      {tone === 'removed' ? (
        <line
          className="rv-strike"
          data-rv-strike="name"
          x1={px}
          x2={px + measure(name, 'tableName')}
          y1={hh / 2}
          y2={hh / 2}
          style={{ stroke: headerText }}
          strokeWidth={1.3}
        />
      ) : null}
      {badge ? (
        <HeaderBadge
          text={badge}
          right={w - px}
          cy={hh / 2}
          color={tone ? c(TONE_COLOR[tone]) : c('rowText')}
        />
      ) : null}
      {h > hh ? (
        <g className="rv-group-count" data-rv-count={memberNames.length}>
          <StackIcon cx={px + 6} cy={rowCy} color={c('fkMarker')} />
          <text
            x={px + METRICS.keyMarkerWidth}
            y={baseline(rowCy, fs.columnName)}
            style={{
              fill: c('rowText'),
              fontFamily: font,
              fontSize: fs.columnName,
              fontWeight: METRICS.fontWeight.columnName,
            }}
          >
            {count}
          </text>
        </g>
      ) : null}
      <rect
        className="rv-table-border"
        x={0.5}
        y={0.5}
        width={Math.max(0, w - 1)}
        height={Math.max(0, h - 1)}
        rx={r - 0.5}
        ry={r - 0.5}
        style={{ fill: 'none', stroke: highlighted ? c('selection') : c('tableBorder') }}
        strokeWidth={1}
      />
      {tone ? <ToneRing tone={tone} width={w} height={h} radius={r} /> : null}
    </g>
  );
});
