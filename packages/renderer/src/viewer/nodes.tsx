import {
  METRICS,
  type DetailLevel,
  type StickyNote,
  type Table,
  type TableGroup,
} from '@relvista/core';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useState, type ReactElement } from 'react';
import { CollapsedGroupSvg } from '../svg/CollapsedGroupSvg.js';
import { badgeOf, columnTonesOf, dimmedByDecorations, nodeTone } from '../svg/decorations.js';
import { GroupSvg } from '../svg/GroupSvg.js';
import { NoteSvg } from '../svg/NoteSvg.js';
import { rowCenterOffset } from '../svg/routing.js';
import { TableSvg } from '../svg/TableSvg.js';
import { parseHandleId, useViewerState, type ViewerState } from './context.js';

export type TableFlowNode = Node<
  {
    table: Table;
    w: number;
    h: number;
    /** The node's own detail level (a saved collapsed table), else the viewer's. */
    detail?: DetailLevel;
  },
  'rvTable'
>;
export type NoteFlowNode = Node<{ note: StickyNote; w: number; h: number }, 'rvNote'>;
export type GroupFlowNode = Node<{ group: TableGroup; w: number; h: number }, 'rvGroup'>;
/** A collapsed TableGroup (docs/design/phase3-v1.md §3.1): one draggable card for its tables. */
export type CollapsedGroupFlowNode = Node<
  {
    group: TableGroup;
    w: number;
    h: number;
    /** Titles of the visible member tables (tooltip and "N tables"). */
    memberNames: readonly string[];
  },
  'rvCollapsedGroup'
>;
export type FlowNode = TableFlowNode | NoteFlowNode | GroupFlowNode | CollapsedGroupFlowNode;

/** Resize limits of notes and tables (§4.3 rule 2). */
export const RESIZE_LIMITS = { minWidth: 120, minHeight: 64, maxWidth: 640, maxHeight: 1200 };

const HIDDEN_HANDLE = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  background: 'transparent',
  pointerEvents: 'none',
} as const;

function RowHandles({ ids }: { ids: ReadonlySet<string> | undefined }): ReactElement | null {
  if (!ids || ids.size === 0) return null;
  return (
    <>
      {Array.from(ids).map((id) => {
        const h = parseHandleId(id);
        if (!h) return null;
        return (
          <Handle
            key={id}
            id={id}
            type={h.type}
            position={h.side === 'left' ? Position.Left : Position.Right}
            isConnectable={false}
            style={{ ...HIDDEN_HANDLE, top: rowCenterOffset(h.row) }}
          />
        );
      })}
    </>
  );
}

/** `rv-node` classes shared by every node: kind, details card, selection, highlight ring. */
function nodeClass(kind: string, id: string, v: ViewerState): string {
  let c = `rv-node rv-node-${kind}`;
  if (v.selectedId === id || v.selection.has(id)) c += ' rv-selected';
  if (v.highlighted.has(id)) c += ' rv-highlighted';
  return c;
}

/** Dimmed by hover (not lit) or by `Decorations.dimOthers` (not decorated). */
function isDimmed(id: string, v: ViewerState, memberIds?: readonly string[]): boolean {
  const byHover =
    v.lit && v.dim
      ? memberIds
        ? !memberIds.some((t) => v.lit!.tables.has(t))
        : !v.lit.tables.has(id)
      : false;
  return byHover || dimmedByDecorations(v.decorations, id);
}

/**
 * Resize handles (React Flow `NodeResizer`) of a node, shown while it is selected, hovered or being
 * resized; the canvas commits one 'resize' when the gesture ends.
 */
function Resizer({ id, v }: { id: string; v: ViewerState }): ReactElement | null {
  const [active, setActive] = useState(false);
  const { onResizeStart, onResizeEnd } = v;
  const start = useCallback(() => {
    setActive(true);
    onResizeStart?.(id);
  }, [id, onResizeStart]);
  const end = useCallback(
    (_: unknown, p: { x: number; y: number; width: number; height: number }) => {
      setActive(false);
      onResizeEnd?.(id, { x: p.x, y: p.y, width: p.width, height: p.height });
    },
    [id, onResizeEnd],
  );
  return (
    <NodeResizer
      isVisible={active || v.selection.has(id) || v.hoveredId === id}
      {...RESIZE_LIMITS}
      color="var(--rv-selection)"
      handleClassName="rv-resize-handle"
      lineClassName="rv-resize-line"
      onResizeStart={start}
      onResizeEnd={end}
    />
  );
}

export const TableNode = memo<NodeProps<TableFlowNode>>(function TableNode({
  id,
  data,
  width,
  height,
}: NodeProps<TableFlowNode>): ReactElement {
  const v = useViewerState();
  const { table } = data;
  // React Flow's size while a resize is in progress, else the laid-out one.
  const w = width ?? data.w;
  const h = height ?? data.h;
  return (
    <div className={nodeClass('table', id, v)} style={{ width: w, height: h }}>
      {v.resizable === 'all' ? <Resizer id={id} v={v} /> : null}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rv-node-svg">
        <TableSvg
          table={table}
          box={{ x: 0, y: 0, width: w, height: h }}
          detailLevel={data.detail ?? v.detailLevel}
          dimmed={isDimmed(id, v)}
          highlighted={v.hoveredId === id || v.highlighted.has(id)}
          selected={v.selectedId === id || v.selection.has(id)}
          highlightColumns={v.lit?.columns.get(id) ?? null}
          tone={nodeTone(v.decorations, id)}
          columnTones={columnTonesOf(v.decorations, id) ?? null}
          badge={badgeOf(v.decorations, id)}
        />
      </svg>
      <RowHandles ids={v.handles.get(id)} />
    </div>
  );
});

export const NoteNode = memo<NodeProps<NoteFlowNode>>(function NoteNode({
  id,
  data,
  width,
  height,
}: NodeProps<NoteFlowNode>): ReactElement {
  const v = useViewerState();
  const { note } = data;
  const w = width ?? data.w;
  const h = height ?? data.h;
  return (
    <div className={nodeClass('note', id, v)} style={{ width: w, height: h }}>
      {v.resizable ? <Resizer id={id} v={v} /> : null}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rv-node-svg">
        <NoteSvg
          note={note}
          box={{ x: 0, y: 0, width: w, height: h }}
          dimmed={isDimmed(id, v)}
          tone={nodeTone(v.decorations, id)}
          badge={badgeOf(v.decorations, id)}
        />
      </svg>
    </div>
  );
});

export const GroupNode = memo<NodeProps<GroupFlowNode>>(function GroupNode({
  id,
  data,
}: NodeProps<GroupFlowNode>): ReactElement {
  const v = useViewerState();
  const { w, h, group } = data;
  return (
    <div className={nodeClass('group', id, v)} style={{ width: w, height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rv-node-svg">
        <GroupSvg
          group={group}
          box={{ x: 0, y: 0, width: w, height: h }}
          dimmed={isDimmed(id, v, group.tableIds)}
          tone={nodeTone(v.decorations, id)}
          badge={badgeOf(v.decorations, id)}
        />
      </svg>
      {v.groupHandles ? (
        <div
          className="rv-group-drag"
          style={{ height: METRICS.groupHeaderHeight }}
          title={group.name}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
});

export const CollapsedGroupNode = memo<NodeProps<CollapsedGroupFlowNode>>(
  function CollapsedGroupNode({ id, data }: NodeProps<CollapsedGroupFlowNode>): ReactElement {
    const v = useViewerState();
    const { w, h, group, memberNames } = data;
    return (
      <div
        className={nodeClass('collapsed-group', id, v)}
        style={{ width: w, height: h }}
        data-rv-collapsed="true"
      >
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rv-node-svg">
          <CollapsedGroupSvg
            group={group}
            box={{ x: 0, y: 0, width: w, height: h }}
            memberNames={memberNames}
            dimmed={isDimmed(id, v, group.tableIds)}
            highlighted={v.hoveredId === id || v.highlighted.has(id)}
            tone={nodeTone(v.decorations, id)}
            badge={badgeOf(v.decorations, id)}
          />
        </svg>
        <RowHandles ids={v.handles.get(id)} />
      </div>
    );
  },
);

export const nodeTypes = {
  rvTable: TableNode,
  rvNote: NoteNode,
  rvGroup: GroupNode,
  rvCollapsedGroup: CollapsedGroupNode,
};
