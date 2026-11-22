import type { DetailLevel } from '@relvista/core';
import { createContext, useContext } from 'react';
import type { Decorations } from '../svg/decorations.js';
import type { HighlightSets, HSide } from '../svg/routing.js';

/** A node's box at the end of a resize with the handles (diagram units). */
export interface ResizeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resize handles: which node kinds get them (editable canvas only; read-only: none). */
export type ResizeKinds = 'notes' | 'all' | false;

export interface ViewerState {
  detailLevel: DetailLevel;
  lit: HighlightSets | null;
  /** Whether what `lit` leaves out is dimmed (hover), or only `lit` is emphasised (highlight). */
  dim: boolean;
  hoveredId: string | null;
  /** Table whose details card is open. */
  selectedId: string | null;
  /** Nodes with the highlight ring: `highlightedNodeId` and `highlightIds` of the canvas. */
  highlighted: ReadonlySet<string>;
  /** Search hits, paths, diff tones (docs/design/phase3-v1.md §4.2). */
  decorations: Decorations | null;
  /** Nodes selected in the editable canvas. */
  selection: ReadonlySet<string>;
  /** Groups get a header band that can be clicked (and, editable, dragged). */
  groupHandles: boolean;
  /** Node kinds drawn with resize handles. */
  resizable: ResizeKinds;
  /** Resize gestures of a node (the canvas commits one 'resize' at the end). */
  onResizeStart?: (id: string) => void;
  onResizeEnd?: (id: string, box: ResizeBox) => void;
  /** Ref lines take pointer events (the canvas has edge click / context-menu handlers). */
  edgeEvents: boolean;
}

export const ViewerContext = createContext<ViewerState>({
  detailLevel: 'all',
  lit: null,
  dim: true,
  hoveredId: null,
  selectedId: null,
  highlighted: new Set(),
  decorations: null,
  selection: new Set(),
  groupHandles: false,
  resizable: false,
  edgeEvents: false,
});

export function useViewerState(): ViewerState {
  return useContext(ViewerContext);
}

/** Handle id for a row (-1 = header) on a side, as source or target. */
export function handleId(row: number, side: HSide, type: 'source' | 'target'): string {
  return `${row < 0 ? 'h' : `c${row}`}-${side[0]}-${type[0]}`;
}

export function parseHandleId(
  id: string,
): { row: number; side: HSide; type: 'source' | 'target' } | null {
  const m = /^(h|c(\d+))-([lr])-([st])$/.exec(id);
  if (!m) return null;
  return {
    row: m[1] === 'h' ? -1 : Number(m[2]),
    side: m[3] === 'l' ? 'left' : 'right',
    type: m[4] === 's' ? 'source' : 'target',
  };
}
