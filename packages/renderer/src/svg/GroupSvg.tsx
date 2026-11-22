import { METRICS, estimateTextWidth, type Box, type TableGroup } from '@relvista/core';
import { memo, type ReactElement } from 'react';
import { groupColors, safeColor } from '../theme.js';
import { useColors } from './context.js';
import { REMOVED_DASH, REMOVED_OPACITY, TONE_COLOR, type DecorationTone } from './decorations.js';
import { HeaderBadge } from './TableSvg.js';
import { baseline, truncate } from './text.js';

/** Props of `GroupSvg`. */
export interface GroupSvgProps {
  /** The TableGroup to draw. */
  group: TableGroup;
  /** Where to draw it (`geometry.groups[group.id]`). */
  box: Box;
  /** Draw at reduced opacity (not part of the current highlight). */
  dimmed?: boolean;
  /** Decoration tone (border in the tone colour, width 2; removed: dashed, 60% opacity). */
  tone?: DecorationTone;
  /** Text badge at the right end of the name band. */
  badge?: string;
}

/** A TableGroup's tinted rectangle with its name in the top band. */
export const GroupSvg = memo<GroupSvgProps>(function GroupSvg({
  group,
  box,
  dimmed,
  tone,
  badge,
}: GroupSvgProps): ReactElement {
  const { c, value, font } = useColors();
  const user = safeColor(group.color);
  // The default colour stays a CSS variable (themable); a user colour is adjusted to the canvas.
  const def = c('groupDefault');
  const { fill, stroke, text } = user
    ? groupColors(user, value('canvasBg'))
    : { fill: def, stroke: def, text: def };
  const r = METRICS.cornerRadius + 4;
  const fs = METRICS.fontSize.tableName;
  const label = truncate(
    group.name,
    'tableName',
    box.width - METRICS.groupPadding,
    estimateTextWidth,
  );
  return (
    <g
      className="rv-group"
      data-rv-group={group.id}
      data-rv-tone={tone}
      transform={`translate(${box.x} ${box.y})`}
      opacity={dimmed ? 0.45 : tone === 'removed' ? REMOVED_OPACITY : undefined}
    >
      <title>{group.note ? `${group.name}\n${group.note}` : group.name}</title>
      <rect
        width={box.width}
        height={box.height}
        rx={r}
        ry={r}
        style={{ fill, stroke: tone ? c(TONE_COLOR[tone]) : stroke }}
        fillOpacity={0.07}
        strokeOpacity={tone ? 1 : 0.5}
        strokeWidth={tone ? 2 : 1.2}
        strokeDasharray={tone === 'removed' ? REMOVED_DASH : undefined}
      />
      <path
        d={`M0 ${r} Q0 0 ${r} 0 H${box.width - r} Q${box.width} 0 ${box.width} ${r} V${METRICS.groupHeaderHeight} H0 Z`}
        style={{ fill }}
        fillOpacity={0.14}
      />
      <text
        x={METRICS.groupPadding / 2 + 2}
        y={baseline(METRICS.groupHeaderHeight / 2, fs)}
        style={{
          fill: text,
          fontFamily: font,
          fontSize: fs,
          fontWeight: METRICS.fontWeight.tableName,
        }}
      >
        {label}
      </text>
      {badge ? (
        <HeaderBadge
          text={badge}
          right={box.width - METRICS.groupPadding / 2}
          cy={METRICS.groupHeaderHeight / 2}
          color={tone ? c(TONE_COLOR[tone]) : text}
        />
      ) : null}
    </g>
  );
});
