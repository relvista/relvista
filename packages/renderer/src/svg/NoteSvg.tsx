import {
  METRICS,
  estimateTextWidth,
  wrapNoteText,
  type Box,
  type StickyNote,
  type TextMeasure,
} from '@relvista/core';
import { memo, useId, type ReactElement } from 'react';
import { contrastText, mix, parseHex, safeColor, toHex } from '../theme.js';
import { useColors } from './context.js';
import { REMOVED_OPACITY, TINT_OPACITY, TONE_COLOR, type DecorationTone } from './decorations.js';
import { HeaderBadge, ToneRing } from './TableSvg.js';
import { baseline } from './text.js';

/** Height of the fade at the bottom of a note whose text does not fit. */
export const NOTE_FADE = 12;

/** Props of `NoteSvg`. */
export interface NoteSvgProps {
  /** The sticky note to draw. */
  note: StickyNote;
  /** Where to draw it (`geometry.nodes[note.id]`). */
  box: Box;
  /** Draw at reduced opacity (not part of the current highlight). */
  dimmed?: boolean;
  /** id of a `<filter>` in scope for the card shadow. */
  shadowFilter?: string | null;
  /** Text measurement used to wrap the text. Default: the built-in width estimate. */
  measure?: TextMeasure;
  /** Prefix of the ids of the clip path and fade (unique per diagram on a page). Default `rv`. */
  idPrefix?: string;
  /** Decoration tone (ring + tint; removed: dashed, 60% opacity). */
  tone?: DecorationTone;
  /** Text badge at the note's top right. */
  badge?: string;
}

/** Lines of `content` as drawn in a note box `width` wide (the same wrapping layout measures). */
export function noteLines(
  content: string,
  width: number,
  measure: TextMeasure = estimateTextWidth,
): string[] {
  return wrapNoteText(content, measure, Math.max(1, width - 2 * METRICS.notePadding));
}

/**
 * A sticky note: a rounded card (yellowish, or the note's colour) with its text wrapped to the
 * box width and clipped to the box, fading out at the bottom when it does not fit.
 */
export const NoteSvg = memo<NoteSvgProps>(function NoteSvg({
  note,
  box,
  dimmed,
  shadowFilter,
  measure = estimateTextWidth,
  idPrefix = 'rv',
  tone,
  badge,
}: NoteSvgProps): ReactElement {
  const { c, font } = useColors();
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const user = safeColor(note.color);
  const rgb = parseHex(user);
  const fill = user ?? c('noteBg');
  const stroke = rgb ? toHex(mix(rgb, { r: 0, g: 0, b: 0 }, 0.15)) : c('noteBorder');
  const text = rgb ? contrastText(rgb) : c('noteText');
  const lines = noteLines(note.content, box.width, measure);
  const fs = METRICS.fontSize.noteText;
  const p = METRICS.notePadding;
  const r = METRICS.cornerRadius;
  const clipped = p * 2 + lines.length * METRICS.noteLineHeight > box.height + 0.5;
  const clipId = `${idPrefix}-note-clip-${uid}`;
  const fadeId = `${idPrefix}-note-fade-${uid}`;
  // Lines entirely below the box are not written at all.
  const shown = clipped
    ? lines.slice(0, Math.max(0, Math.ceil((box.height - p) / METRICS.noteLineHeight)))
    : lines;
  return (
    <g
      className="rv-note"
      data-rv-note={note.id}
      data-rv-tone={tone}
      data-rv-clipped={clipped ? 'true' : undefined}
      transform={`translate(${box.x} ${box.y})`}
      opacity={dimmed ? 0.28 : tone === 'removed' ? REMOVED_OPACITY : undefined}
    >
      <title>{clipped ? `${note.name}\n${note.content}` : note.name}</title>
      {clipped ? (
        <defs>
          <clipPath id={clipId}>
            <rect
              x={1}
              y={1}
              width={Math.max(0, box.width - 2)}
              height={Math.max(0, box.height - 2)}
              rx={r}
            />
          </clipPath>
          <linearGradient id={fadeId} x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} style={{ stopColor: fill }} stopOpacity={0} />
            <stop offset={1} style={{ stopColor: fill }} stopOpacity={1} />
          </linearGradient>
        </defs>
      ) : null}
      <rect
        width={box.width}
        height={box.height}
        rx={r}
        ry={r}
        style={{ fill, stroke }}
        filter={shadowFilter ? `url(#${shadowFilter})` : undefined}
      />
      {tone ? (
        <rect
          className="rv-tone-tint"
          width={box.width}
          height={box.height}
          rx={r}
          ry={r}
          style={{ fill: c(TONE_COLOR[tone]) }}
          fillOpacity={TINT_OPACITY}
        />
      ) : null}
      <text
        clipPath={clipped ? `url(#${clipId})` : undefined}
        style={{
          fill: text,
          fontFamily: font,
          fontSize: fs,
          fontWeight: METRICS.fontWeight.noteText,
        }}
      >
        {shown.map((line, i) => (
          <tspan
            key={i}
            x={p}
            y={baseline(p + i * METRICS.noteLineHeight + METRICS.noteLineHeight / 2, fs)}
          >
            {line || ' '}
          </tspan>
        ))}
      </text>
      {clipped ? (
        <rect
          className="rv-note-fade"
          x={1}
          y={Math.max(1, box.height - 1 - NOTE_FADE)}
          width={Math.max(0, box.width - 2)}
          height={Math.min(NOTE_FADE, Math.max(0, box.height - 2))}
          style={{ fill: `url(#${fadeId})` }}
        />
      ) : null}
      {badge ? (
        <HeaderBadge
          text={badge}
          right={box.width - 6}
          cy={METRICS.badge.height / 2 + 6}
          color={tone ? c(TONE_COLOR[tone]) : text}
        />
      ) : null}
      {tone ? <ToneRing tone={tone} width={box.width} height={box.height} radius={r} /> : null}
    </g>
  );
});
