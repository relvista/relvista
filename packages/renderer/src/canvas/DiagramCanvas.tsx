import {
  DEFAULT_VIEW,
  measureCollapsedGroup,
  mergeViewDefaults,
  neighborhood,
  selectView,
  subsetModel,
  tableTitle,
  viewDetailLevel,
  type Box,
  type DetailLevel,
  type DiagramGeometry,
  type DiagramModel,
  type Layout,
  type LayoutOptions,
  type NodeOverride,
  type SourceSpan,
  type ViewLayout,
  type Viewport,
} from '@relvista/core';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewportStore,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnNodesChange,
} from '@xyflow/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { domMarkup } from '../export/domMarkup.js';
import { svgDocument } from '../export/svgDocument.js';
import {
  computeBounds,
  computeGroups,
  layoutAsync,
  layoutSync,
  moveNodes,
  pullTogether,
  type PullItem,
} from '../geometry.js';
import { displayNodeMap, mergeRefs, mergedMarkers, primaryRef } from '../svg/collapsed.js';
import { MAX_FOCUS_HOPS } from '../share/deepLink.js';
import { ColorContext } from '../svg/context.js';
import type { Decorations } from '../svg/decorations.js';
import {
  highlightSets,
  nodeDetail,
  routeAll,
  rowIndexOf,
  type EdgeStyle,
  type RouteCache,
} from '../svg/routing.js';
import { colorResolver, safeColor, type ColorMode, type PaletteOverrides } from '../theme.js';
import { resolvePalette } from '../themeDom.js';
import { ViewerContext, handleId, type ResizeBox, type ViewerState } from '../viewer/context.js';
import { fitViewport, type Padding } from '../viewer/initialView.js';
import {
  FIT_FLOOR,
  FIT_FLOOR_NARROW,
  FIT_FLOOR_SMALL,
  MAX_FIT_ZOOM,
  MINIMAP,
  MINIMAP_NARROW,
  MIN_INITIAL_ZOOM,
  MIN_INITIAL_ZOOM_NARROW,
  NARROW,
  PAD,
  SMALL_DIAGRAM_TABLES,
  canvasFirstView,
  minimapAlwaysShown,
} from './frame.js';
import { nodeTypes, type FlowNode, type GroupFlowNode } from '../viewer/nodes.js';
import { edgeTypes, type RefFlowEdge } from '../viewer/RefEdge.js';
import { SideCard } from '../viewer/SideCard.js';
import {
  NudgeBatch,
  groupDragPositions,
  movedPositions,
  nudgeDelta,
  startGroupDrag,
  visibleMembers,
  type GroupDrag,
  type Pos,
} from './drag.js';
import {
  setGroupsCollapsed,
  setNodePositions,
  setNodeSettings as setLayoutNodeSettings,
  setNodeSizes,
} from './layoutEdit.js';
import type {
  AutoLayoutScope,
  CanvasEdgeEvent,
  CanvasExportOptions,
  CanvasFocus,
  CanvasNodeEvent,
  CanvasNodeKind,
  CanvasPaneEvent,
  CanvasResizable,
  LayoutChange,
  NodeSettings,
} from './types.js';
import { placedBox, unplacedIds, useCanvasGeometry } from './useCanvasGeometry.js';

export type {
  AutoLayoutScope,
  CanvasEdgeEvent,
  CanvasExportOptions,
  CanvasFocus,
  CanvasNodeEvent,
  CanvasNodeKind,
  CanvasPaneEvent,
  CanvasResizable,
  LayoutChange,
  NodeSettings,
} from './types.js';

/** Props of `DiagramCanvas`. */
export interface DiagramCanvasProps {
  /** Full model (not view-filtered); `null` shows nothing (the app shows its own empty state). */
  model: DiagramModel | null;
  /** DiagramView name; default '*' (all). Unknown names render '*' and call `onUnknownView`. */
  view?: string;
  /** Called with the name when `view` names no DiagramView of the model. */
  onUnknownView?: (name: string) => void;
  /** Controlled layout. The canvas never keeps positions of its own once a change is reported. */
  layout: Layout | null;
  /** Called with the complete next layout (immutable update) and what changed. */
  onLayoutChange?: (next: Layout, change: LayoutChange) => void;
  /**
   * Editable mode: drags, auto-placement and settings are reported through `onLayoutChange`,
   * groups are draggable by their header, multi-select is on, the side card is off by default.
   * Default false (read-only viewer behaviour: drags are local and forgotten).
   */
  editable?: boolean;
  /** Read-only mode only: nodes can be dragged locally. Default true (as DbmlViewer today). */
  draggable?: boolean;
  /** Default 'light'. */
  colorMode?: ColorMode;
  /** Default: the view's saved level (`viewDetailLevel`), else layout.settings.detailLevel, else 'all'. */
  detailLevel?: DetailLevel;
  /** Default layout.settings.theme.edgeStyle ?? 'orthogonal'. */
  edgeStyle?: EdgeStyle;
  /** Default 'auto': shown for 8 or more tables in canvases at least 600px wide. */
  minimap?: boolean | 'auto';
  /** ELK worker script (`elkjs/lib/elk-worker.min.js`); without it ELK runs in-process. */
  workerUrl?: string | URL;
  /** Node drawn with the highlight ring and its refs lit (cursor-in-block in the editor). */
  highlightedNodeId?: string | null;
  /** Called when a table, note or group is clicked (or activated with the keyboard). */
  onNodeClick?: (e: CanvasNodeEvent) => void;
  /** Called when a table, note or group is double-clicked. */
  onNodeDoubleClick?: (e: CanvasNodeEvent) => void;
  /** When set, the canvas calls preventDefault on the native contextmenu event. */
  onNodeContextMenu?: (e: CanvasNodeEvent) => void;
  /** Called when the empty canvas is clicked. */
  onPaneClick?: () => void;
  /** Called when a pan or zoom ends (user or programmatic) with the viewport it ended at. */
  onViewportChange?: (viewport: Viewport) => void;
  /** Table details card on click. Default `!editable`. */
  sideCard?: boolean;
  /**
   * Identity of the document. The initial view (fit / saved viewport) is applied on mount, when
   * this changes, and when `view` changes — never because `model` or `layout` changed.
   */
  resetKey?: string;
  /**
   * Viewport for the first view of this `resetKey` instead of the computed one (a restored editor
   * session). Read when the document's first layout is drawn; later changes are ignored.
   */
  initialViewport?: Viewport | null;
  /**
   * 'pending' while the ELK result is outstanding, then 'done' (mirrors data-rv-layout). Reported
   * again whenever `resetKey` changes, even when the value stayed the same.
   */
  onLayoutStatus?: (status: 'pending' | 'done') => void;
  /** Padding the initial view and Fit keep free for overlays (px). Default DbmlViewer's PAD. */
  padding?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  /** Default 'Entity-relationship diagram'. */
  ariaLabel?: string;
  /** Class of the canvas root element. */
  className?: string;
  /** Inline style of the canvas root element. */
  style?: CSSProperties;
  /** Overlays (toolbars, chips) rendered inside the canvas root, after the React Flow pane. */
  children?: ReactNode;
  /** The imperative handle (`forwardRef`, so it works with React 18 and 19). */
  ref?: Ref<DiagramCanvasHandle>;
  /** Search hits, paths, diff tones (docs/design/phase3-v1.md §4.2). Never moves the viewport. */
  decorations?: Decorations | null;
  /** Several ids lit like `highlightedNodeId` (tables, notes, groups, refs). */
  highlightIds?: readonly string[] | null;
  /**
   * Focus mode: only the tables within `hops` refs of `ids` (+ the notes of the view) are shown,
   * at their usual positions; the viewport fits them when the focus changes. Not stored.
   */
  focus?: CanvasFocus | null;
  /**
   * Model drawn (and laid out) instead of the view-filtered `model`, such as a diff's merged
   * model. Positions still come from `layout`; nodes only in this model are placed by the sync
   * layout and never reported through `onLayoutChange`.
   */
  displayModel?: DiagramModel | null;
  /** Notes (and, with 'all', tables) get resize handles in editable mode. Default 'notes'. */
  resizable?: CanvasResizable;
  /** Called when a ref is clicked. */
  onEdgeClick?: (e: CanvasEdgeEvent) => void;
  /** When set, the canvas calls preventDefault on the native contextmenu event. */
  onEdgeContextMenu?: (e: CanvasEdgeEvent) => void;
  /** When set, the canvas calls preventDefault on the native contextmenu event. */
  onPaneContextMenu?: (e: CanvasPaneEvent) => void;
  /** Called when the empty canvas is double-clicked, with the diagram point. */
  onPaneDoubleClick?: (e: CanvasPaneEvent) => void;
}

/** Imperative methods of a `DiagramCanvas`, reached through its `ref`. */
export interface DiagramCanvasHandle {
  /** Fits the whole active view into the canvas. */
  fitView(options?: { duration?: number }): void;
  /** Zooms in one step around the centre. */
  zoomIn(): void;
  /** Zooms out one step around the centre. */
  zoomOut(): void;
  /** Pans (keeps zoom) so the node is centred. `onlyIfHidden`: no-op when ≥ 60% of it is visible. */
  focusNode(id: string, options?: { onlyIfHidden?: boolean; duration?: number }): void;
  /** Runs ELK for the active view and reports one 'auto-layout' change. Resolves to the new layout. */
  runAutoLayout(scope?: AutoLayoutScope): Promise<Layout | null>;
  /** Pin / collapse through the layout (reports a 'settings' change). */
  setNodeSettings(ids: string[], settings: NodeSettings): void;
  /** Ids of the nodes selected in the canvas (editable mode). */
  getSelection(): string[];
  /** Replaces the canvas selection (`[]` clears it), e.g. when the editor's cursor moves on. */
  setSelection(ids: string[]): void;
  /** Geometry as drawn now (after drags), active view. */
  getGeometry(): DiagramGeometry | null;
  /** The current pan and zoom. */
  getViewport(): Viewport;
  /** Pans and zooms to `viewport`, animated over `duration` ms when given. */
  setViewport(viewport: Viewport, options?: { duration?: number }): void;
  /** null without a model. */
  exportSvg(options?: CanvasExportOptions): string | null;
  /** scale default 2; null without a model. */
  exportPng(options?: CanvasExportOptions & { scale?: number }): Promise<Blob | null>;
  /** Prints the active view (a hidden iframe with the standalone SVG). */
  print(options?: CanvasExportOptions): void;
  /** Fits the given nodes (all when empty), optionally capping the zoom; `padding` in px. */
  focusNodes(
    ids: string[],
    options?: {
      duration?: number;
      maxZoom?: number;
      /**
       * Space to keep free around the nodes, screen px: one number for every side, or the sides
       * an overlay covers (each at least the canvas's own padding on that side).
       */
      padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
    },
  ): void;
  /** Screen rectangle (client px) of a node as drawn now, or null. For overlays (note editor). */
  getNodeClientRect(id: string): DOMRect | null;
  /** Client px → diagram coordinates. */
  clientToDiagram(clientX: number, clientY: number): { x: number; y: number };
  /**
   * Writes node positions (e.g. a new note placed where the user clicked) and reports one 'move'
   * (editable); read-only canvases move the nodes locally.
   */
  placeNodes(positions: Record<string, { x: number; y: number }>): void;
}

/** Props DbmlViewer uses on top of the public contract (not exported from the package). */
export interface CanvasInternalProps extends DiagramCanvasProps {
  /** Called with the laid-out geometry (before drags) whenever it changes. */
  onGeometry?: (geometry: DiagramGeometry | null) => void;
  /** The handle under another name: React 18 strips a `ref` prop from function components. */
  handleRef?: Ref<DiagramCanvasHandle>;
}

export {
  FIT_FLOOR,
  FIT_FLOOR_NARROW,
  FIT_FLOOR_SMALL,
  MAX_FIT_ZOOM,
  MINIMAP,
  MINIMAP_NARROW,
  MIN_INITIAL_ZOOM,
  MIN_INITIAL_ZOOM_NARROW,
  NARROW,
  PAD,
  SMALL_DIAGRAM_TABLES,
};
/** Screen px a diagram may stick out of the canvas before it counts as off-screen. */
const OFFSCREEN_SLACK = 4;
/** Part of a node that must be on screen for `focusNode(…, { onlyIfHidden })` to leave it. */
const FOCUS_VISIBLE = 0.6;

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Whether a restored viewport shows the whole diagram, and at clearly less than the fit's zoom:
 * nothing the user arranged is lost by framing the diagram for the current canvas instead.
 */
export function shrunkenRestore(
  vp: Viewport,
  b: Box,
  size: { width: number; height: number },
  padding: Padding,
): boolean {
  const fit = fitViewport({ bounds: b, ...size, padding, maxZoom: MAX_FIT_ZOOM });
  if (!fit || fit.zoom <= vp.zoom * 1.05) return false;
  const x0 = vp.x + b.x * vp.zoom;
  const y0 = vp.y + b.y * vp.zoom;
  return (
    x0 >= -1 &&
    y0 >= -1 &&
    x0 + b.width * vp.zoom <= size.width + 1 &&
    y0 + b.height * vp.zoom <= size.height + 1
  );
}

function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function buildNodes(
  model: DiagramModel,
  geometry: DiagramGeometry,
  draggable: boolean,
  editable: boolean,
): FlowNode[] {
  const out: FlowNode[] = [];
  for (const n of model.stickyNotes) {
    const g = geometry.nodes[n.id];
    if (!g) continue;
    out.push({
      id: n.id,
      type: 'rvNote',
      position: { x: g.x, y: g.y },
      width: g.width,
      height: g.height,
      data: { note: n, w: g.width, h: g.height },
      draggable,
      selectable: editable,
      connectable: false,
      deletable: false,
      focusable: editable,
      ...(editable ? { ariaLabel: `Sticky note ${n.name}` } : {}),
    });
  }
  for (const t of model.tables) {
    const g = geometry.nodes[t.id];
    if (!g) continue;
    out.push({
      id: t.id,
      type: 'rvTable',
      position: { x: g.x, y: g.y },
      width: g.width,
      height: g.height,
      data: {
        table: t,
        w: g.width,
        h: g.height,
        ...(g.detailLevel ? { detail: g.detailLevel } : {}),
      },
      draggable,
      selectable: editable,
      connectable: false,
      deletable: false,
      focusable: true,
      ariaLabel: editable ? `Table ${t.name}` : `Table ${t.name}. Press Enter for details.`,
    });
  }
  // Collapsed groups (core §3.1): one card in place of their tables, dragged by its own id.
  const titles = new Map(model.tables.map((t) => [t.id, tableTitle(t)]));
  for (const g of model.groups) {
    const box = geometry.groups[g.id];
    if (!box?.collapsed) continue;
    const memberNames = g.tableIds.flatMap((id) => {
      const name = titles.get(id);
      return name === undefined ? [] : [name];
    });
    out.push({
      id: g.id,
      type: 'rvCollapsedGroup',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: { group: g, w: box.width, h: box.height, memberNames },
      draggable,
      selectable: editable,
      connectable: false,
      deletable: false,
      focusable: true,
      ariaLabel: `Group ${g.name}, collapsed (${memberNames.length} ${
        memberNames.length === 1 ? 'table' : 'tables'
      }). Double-click to expand.`,
      domAttributes: { 'data-rv-collapsed': 'true' } as FlowNode['domAttributes'],
    });
  }
  return out;
}

const KIND: Record<FlowNode['type'] & string, CanvasNodeKind> = {
  rvTable: 'table',
  rvNote: 'note',
  rvGroup: 'group',
  rvCollapsedGroup: 'group',
};

/**
 * `model` reduced to a focus (core `neighborhood` + `subsetModel`), or null when no focus id is a
 * table of `model` (the focus is then ignored). Sticky notes are left out: the focus view is laid
 * out compactly (`compactFocus`), where a note would no longer sit next to what it is about.
 */
export function focusModel(model: DiagramModel, focus: CanvasFocus | null): DiagramModel | null {
  if (!focus) return null;
  const known = new Set(model.tables.map((t) => t.id));
  const ids = focus.ids.filter((id) => known.has(id));
  if (!ids.length) return null;
  const hops = Math.max(0, Math.min(MAX_FOCUS_HOPS, Math.floor(Number(focus.hops) || 0)));
  const { tableIds } = neighborhood(model, ids, hops);
  return subsetModel(model, { tableIds, noteIds: [] });
}

/** Space `compactFocus` keeps between the boxes it pulls together (room for the ref lines). */
export const FOCUS_GAP = 72;

/**
 * The focus view's geometry: `geometry` restricted to `model` (a `focusModel`), then pulled
 * together around the focused tables (`pullTogether`), so a table and its neighbours read at a
 * useful zoom even when the full layout has them far apart. Display only: nothing of it is saved.
 * The focused tables keep their place; the others keep their direction from them.
 */
export function compactFocus(
  model: DiagramModel,
  geometry: DiagramGeometry,
  focusIds: readonly string[],
): DiagramGeometry {
  const restricted = restrictGeometry(model, geometry);
  const shownAs = displayNodeMap(model, restricted);
  const roots = new Set(focusIds.map((id) => shownAs.get(id) ?? id));
  const items: PullItem[] = [];
  for (const [id, n] of Object.entries(restricted.nodes))
    items.push({ id, x: n.x, y: n.y, width: n.width, height: n.height, fixed: roots.has(id) });
  for (const [id, g] of Object.entries(restricted.groups))
    if (g.collapsed)
      items.push({ id, x: g.x, y: g.y, width: g.width, height: g.height, fixed: roots.has(id) });
  const fixed = items.filter((i) => i.fixed);
  if (!fixed.length || items.length > COMPACT_FOCUS_MAX) return restricted;
  const x0 = Math.min(...fixed.map((b) => b.x));
  const y0 = Math.min(...fixed.map((b) => b.y));
  const x1 = Math.max(...fixed.map((b) => b.x + b.width));
  const y1 = Math.max(...fixed.map((b) => b.y + b.height));
  const moved = pullTogether(items, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, FOCUS_GAP);
  return moved.size ? moveNodes(model, restricted, moved) : restricted;
}

/** Larger focus sets keep the positions of the whole view (pulling is quadratic). */
const COMPACT_FOCUS_MAX = 250;

/** Space between the cards `packCollapsedCards` places (room for the merged ref lines). */
export const CARD_GAP = 96;

/**
 * Where the cards of `groupIds` go when they collapse together (Collapse all groups): each starts
 * centred where its expanded group was, then the cards are pulled together around their common
 * centre (`pullTogether`), keeping clear of every other node drawn now (tables outside these
 * groups, notes, cards already collapsed, other expanded groups), which do not move. When nothing
 * else is drawn, the cards are laid out on their own (dagre) instead. Without this
 * a large diagram would turn into a few small cards spread over its old footprint. The members'
 * own positions are untouched, so expanding restores the diagram as it was.
 */
export function packCollapsedCards(
  model: DiagramModel,
  geometry: DiagramGeometry,
  groupIds: readonly string[],
): Record<string, Pos> {
  const collapsing = new Set(groupIds);
  const inGroups = new Set<string>();
  const items: PullItem[] = [];
  const shown = new Set(model.tables.map((t) => t.id));
  for (const g of model.groups) {
    if (!collapsing.has(g.id)) continue;
    const box = geometry.groups[g.id];
    if (!box || box.collapsed) continue;
    const members = g.tableIds.filter((id) => shown.has(id));
    for (const id of members) inGroups.add(id);
    const size = measureCollapsedGroup(g, members.length);
    items.push({
      id: g.id,
      x: box.x + box.width / 2 - size.width / 2,
      y: box.y + box.height / 2 - size.height / 2,
      ...size,
    });
  }
  const out: Record<string, Pos> = {};
  if (!items.length) return out;
  const cx = items.reduce((a, i) => a + i.x + i.width / 2, 0) / items.length;
  const cy = items.reduce((a, i) => a + i.y + i.height / 2, 0) / items.length;
  const fixed: PullItem[] = [];
  for (const [id, n] of Object.entries(geometry.nodes))
    if (!inGroups.has(id))
      fixed.push({ id, x: n.x, y: n.y, width: n.width, height: n.height, fixed: true });
  for (const [id, b] of Object.entries(geometry.groups))
    if (!collapsing.has(id))
      fixed.push({ id, x: b.x, y: b.y, width: b.width, height: b.height, fixed: true });
  if (!fixed.length) {
    // Nothing else is drawn (every table is in one of these groups): the cards get a layout of
    // their own (dagre over the cards and their merged refs), centred where the diagram was.
    const nodes: Record<string, { collapsed: true }> = {};
    for (const i of items) nodes[i.id] = { collapsed: true };
    try {
      const laid = layoutSync(model, { saved: { nodes } as LayoutOptions['saved'] });
      const cards = items.map((i) => laid.groups[i.id]).filter((b) => !!b?.collapsed);
      if (cards.length === items.length) {
        const lx = cards.reduce((a, b) => a + b!.x + b!.width / 2, 0) / cards.length;
        const ly = cards.reduce((a, b) => a + b!.y + b!.height / 2, 0) / cards.length;
        for (const i of items) {
          const b = laid.groups[i.id]!;
          setOwn(out, i.id, { x: Math.round(b.x + cx - lx), y: Math.round(b.y + cy - ly) });
        }
        return out;
      }
    } catch {
      // Fall back to pulling the cards together below.
    }
  }
  const moved = pullTogether([...fixed, ...items], { x: cx, y: cy }, CARD_GAP);
  for (const i of items)
    setOwn(out, i.id, moved.get(i.id) ?? { x: Math.round(i.x), y: Math.round(i.y) });
  return out;
}

/**
 * `geometry` (laid out for a bigger model) restricted to what `model` draws: positions unchanged,
 * group boxes and bounds recomputed, ELK routes of dropped refs removed.
 */
export function restrictGeometry(model: DiagramModel, geometry: DiagramGeometry): DiagramGeometry {
  const keep = new Set<string>();
  for (const t of model.tables) keep.add(t.id);
  for (const n of model.stickyNotes) keep.add(n.id);
  const nodes: DiagramGeometry['nodes'] = {};
  for (const [id, n] of Object.entries(geometry.nodes)) if (keep.has(id)) setOwn(nodes, id, n);
  const groups = computeGroups(model, nodes, geometry.groups);
  const edges: DiagramGeometry['edges'] = {};
  for (const r of model.refs) {
    const e = geometry.edges[r.id];
    if (e) setOwn(edges, r.id, e);
  }
  return { nodes, groups, edges, bounds: computeBounds({ nodes, groups, edges }) };
}

/** The ids `highlight` lights: groups stand for their member tables. */
function expandHighlight(model: DiagramModel, ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const g = model.groups.find((x) => x.id === id);
    if (g) out.push(id, ...g.tableIds);
    else out.push(id);
  }
  return out;
}

/** Whether `id` is a node `model` draws (table, note or group). */
function isNodeOf(model: DiagramModel, id: string): boolean {
  return (
    model.tables.some((t) => t.id === id) ||
    model.stickyNotes.some((n) => n.id === id) ||
    model.groups.some((g) => g.id === id)
  );
}

/** The model element behind a node id, for its kind and span. */
function nodeInfo(
  model: DiagramModel | null,
  id: string,
): { kind: CanvasNodeKind; span: SourceSpan | null } | null {
  if (!model) return null;
  const t = model.tables.find((x) => x.id === id);
  if (t) return { kind: 'table', span: t.span ?? null };
  const n = model.stickyNotes.find((x) => x.id === id);
  if (n) return { kind: 'note', span: n.span ?? null };
  const g = model.groups.find((x) => x.id === id);
  if (g) return { kind: 'group', span: g.span ?? null };
  return null;
}

/**
 * The diagram as an interactive React Flow canvas, read-only (the docs viewer) or editable (the
 * editor: drags, auto-layout and node settings are reported as layout changes). Browser only;
 * importing the module touches no browser API.
 *
 * @example
 * ```tsx
 * import { useState } from 'react';
 * import { compileDbml, emptyLayout, type Layout } from '@relvista/core';
 * import { DiagramCanvas } from '@relvista/renderer';
 * import '@relvista/renderer/styles.css';
 *
 * export function Editor({ dbml }: { dbml: string }) {
 *   const [layout, setLayout] = useState<Layout>(emptyLayout());
 *   const { model } = compileDbml(dbml);
 *   return (
 *     <div style={{ height: 600 }}>
 *       <DiagramCanvas
 *         model={model}
 *         layout={layout}
 *         editable
 *         onLayoutChange={(next) => setLayout(next)}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(
  function DiagramCanvas(props, ref): ReactElement {
    // React 18 strips `ref` from a function component's props (React 19 passes it): forwardRef
    // works in both, and the inner canvas takes the handle as `handleRef`.
    return (
      <ReactFlowProvider>
        <CanvasInner {...props} handleRef={ref} />
      </ReactFlowProvider>
    );
  },
);

/** DiagramCanvas with the internal extras (DbmlViewer). */
export function DiagramCanvasInternal(props: CanvasInternalProps): ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  model,
  view = DEFAULT_VIEW,
  onUnknownView,
  layout,
  onLayoutChange,
  editable = false,
  draggable = true,
  colorMode = 'light',
  detailLevel,
  edgeStyle,
  minimap = 'auto',
  workerUrl,
  highlightedNodeId = null,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  onPaneClick,
  onViewportChange,
  sideCard = !editable,
  resetKey,
  initialViewport: ownViewport,
  onLayoutStatus,
  padding: paddingProp,
  ariaLabel = 'Entity-relationship diagram',
  className,
  style,
  children,
  ref,
  onGeometry,
  handleRef,
  decorations = null,
  highlightIds: highlightIdsProp = null,
  focus = null,
  displayModel = null,
  resizable = 'notes',
  onEdgeClick,
  onEdgeContextMenu,
  onPaneContextMenu,
  onPaneDoubleClick,
}: CanvasInternalProps): ReactElement {
  const rf = useReactFlow<FlowNode, RefFlowEdge>();
  const rootRef = useRef<HTMLDivElement>(null);

  // --- size (minimap, initial zoom, packing) ------------------------------------------------
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        setSize((s) =>
          s && Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1
            ? s
            : { width: r.width, height: r.height },
        );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const basePadding = useMemo<Padding>(
    () => ({ ...PAD, ...paddingProp }),
    [paddingProp?.top, paddingProp?.right, paddingProp?.bottom, paddingProp?.left],
  );
  // The viewport shape the layout packs for: taken once (re-packing on every resize would move
  // the tables around under the user), at a coarse step so near-equal sizes share a layout.
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  if (aspect === undefined && size) {
    const avail = {
      w: size.width - basePadding.left - basePadding.right,
      h: Math.max(1, size.height - basePadding.top - basePadding.bottom),
    };
    setAspect(Math.round((avail.w / avail.h) * 4) / 4 || 0.25);
  }
  const narrow = !!size && size.width < NARROW;

  // --- view ----------------------------------------------------------------------------------
  const unknownView = !!model && view !== DEFAULT_VIEW && !model.views.some((v) => v.name === view);
  const viewName = unknownView ? DEFAULT_VIEW : view;
  const unknownRef = useRef(onUnknownView);
  unknownRef.current = onUnknownView;
  useEffect(() => {
    if (!unknownView) return;
    if (unknownRef.current) unknownRef.current(view);
    else console.warn(`relvista: unknown view "${view}"; showing all tables`);
  }, [unknownView, view]);
  const viewModel = useMemo(
    () => (model && viewName !== DEFAULT_VIEW ? (selectView(model, viewName) ?? model) : model),
    [model, viewName],
  );
  /** What is laid out: the diff's merged model (rule 7), else the view's. */
  const layoutModel = displayModel ?? viewModel;
  /** Ids the layout may be written for (nodes only in `displayModel` never are). */
  const realIds = useMemo(() => {
    const out = new Set<string>();
    if (!viewModel) return out;
    for (const t of viewModel.tables) out.add(t.id);
    for (const n of viewModel.stickyNotes) out.add(n.id);
    for (const g of viewModel.groups) out.add(g.id);
    return out;
  }, [viewModel]);
  const docKey = `${resetKey ?? ''}\u0000${viewName}`;

  // --- layout --------------------------------------------------------------------------------
  // Read-only canvases collapse groups locally (a double-click): an overlay on the layout prop,
  // dropped when the layout, document or view changes.
  const [localLayout, setLocalLayout] = useState<{
    for: Layout | null;
    key: string;
    value: Layout;
  } | null>(null);
  const shownLayout =
    !editable && localLayout && localLayout.for === layout && localLayout.key === docKey
      ? localLayout.value
      : layout;
  const detail: DetailLevel = detailLevel ?? viewDetailLevel(layout, viewName) ?? 'all';
  const edges_: EdgeStyle = edgeStyle ?? layout?.settings?.theme?.edgeStyle ?? 'orthogonal';
  const saved = useMemo(
    () => (shownLayout ? mergeViewDefaults(shownLayout, viewName) : null),
    [shownLayout, viewName],
  );
  const { geometry, final: layoutFinal } = useCanvasGeometry(
    layoutModel,
    saved,
    detail,
    aspect,
    workerUrl,
    !displayModel,
  );

  // --- focus (rule 3): fewer tables drawn, at the positions of the whole view ----------------
  const focusKey = focus ? JSON.stringify([focus.ids, focus.hops]) : '';
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focused = useMemo(
    () => (layoutModel && focusKey ? focusModel(layoutModel, focusRef.current) : null),
    [layoutModel, focusKey],
  );
  /** The model drawn. */
  const drawModel = focused ?? layoutModel;
  /** The geometry drawn (before drags): in focus mode, compacted around the focused tables. */
  const drawGeometry = useMemo(
    () =>
      focused && geometry
        ? compactFocus(
            focused,
            geometry,
            (focusRef.current?.ids ?? []).filter((id) => focused.tables.some((t) => t.id === id)),
          )
        : geometry,
    [focused, geometry],
  );

  // --- nodes (dragging moves them locally until the change is reported) ----------------------
  // The focus view is display only (its positions are not the saved ones): nothing moves there.
  const nodeDrag = (editable || draggable) && !focused;
  const baseNodes = useMemo(
    () =>
      drawModel && drawGeometry ? buildNodes(drawModel, drawGeometry, nodeDrag, editable) : [],
    [drawModel, drawGeometry, nodeDrag, editable],
  );
  const [nodes, setNodes] = useState<FlowNode[]>(baseNodes);
  const [nodesFor, setNodesFor] = useState(baseNodes);
  if (nodesFor !== baseNodes) {
    setNodesFor(baseNodes);
    setNodes(baseNodes);
  }
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Selection (editable): kept apart from the nodes so a new layout does not drop it.
  const [selection, setSelection] = useState<ReadonlySet<string>>(EMPTY_SET);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [selectionFor, setSelectionFor] = useState({ resetKey, viewName });
  if (selectionFor.resetKey !== resetKey || selectionFor.viewName !== viewName) {
    setSelectionFor({ resetKey, viewName });
    setSelection(EMPTY_SET);
  }

  const groupIdsRef = useRef<ReadonlySet<string>>(EMPTY_SET);
  const onNodesChange = useCallback<OnNodesChange<FlowNode>>((changes) => {
    // Group boxes are computed from their members, never moved themselves.
    for (const id of groupIdsRef.current) changes.removeForNode(id);
    // Nothing left (a group box measured): no new node array, so no re-render and no fresh group
    // node for React Flow to measure again.
    if (changes.isEmpty()) return;
    let sel: Set<string> | null = null;
    for (const c of changes.getByType('select')) {
      sel ??= new Set(selectionRef.current);
      if (c.selected) sel.add(c.id);
      else sel.delete(c.id);
    }
    if (sel) setSelection(sel);
    setNodes((ns) => changes.applyTo(ns));
  }, []);

  const current = useMemo(() => {
    if (!drawModel || !drawGeometry) return null;
    return moveNodes(
      drawModel,
      drawGeometry,
      new Map(
        nodes.map((n) => [
          n.id,
          {
            ...n.position,
            ...(n.width !== undefined ? { width: n.width } : {}),
            ...(n.height !== undefined ? { height: n.height } : {}),
          },
        ]),
      ),
    );
  }, [drawModel, drawGeometry, nodes]);

  // Routes go round the tables (§4.1). While a drag is in progress only the refs of the dragged
  // nodes are searched again (RouteCache); the drag's end routes everything afresh.
  const [dragging, setDragging] = useState<ReadonlySet<string> | null>(null);
  const routeCache = useRef<RouteCache | null>(null);
  const routes = useMemo(() => {
    if (!drawModel || !current) return new Map<string, never>();
    const ctx = { model: drawModel, geometry: current, detailLevel: detail, edgeStyle: edges_ };
    const prev = routeCache.current;
    const r = dragging && prev ? routeAll(ctx, { previous: prev, dirty: dragging }) : routeAll(ctx);
    routeCache.current = r.cache;
    return r;
  }, [drawModel, current, detail, edges_, dragging]);

  // Every row a ref attaches to gets handles on both sides and of both types. The set depends
  // only on the model, so it is stable while dragging flips sides (React Flow measures handles
  // when a node mounts).
  const handles = useMemo(() => {
    const out = new Map<string, Set<string>>();
    if (!drawModel || !drawGeometry) return out;
    const tables = new Map(drawModel.tables.map((t) => [t.id, t]));
    const shownAs = displayNodeMap(drawModel, drawGeometry);
    const add = (tableId: string, column: string | undefined) => {
      const t = tables.get(tableId);
      if (!t) return;
      // A member of a collapsed group attaches to the group card's header.
      const group = shownAs.get(tableId);
      const node = group ?? tableId;
      const row =
        group !== undefined ? -1 : rowIndexOf(t, column, nodeDetail(drawGeometry, tableId, detail));
      let s = out.get(node);
      if (!s) out.set(node, (s = new Set()));
      for (const side of ['left', 'right'] as const)
        for (const type of ['source', 'target'] as const) s.add(handleId(row, side, type));
    };
    for (const r of drawModel.refs) {
      add(r.from.tableId, r.from.columns[0]);
      add(r.to.tableId, r.to.columns[0]);
    }
    return out;
  }, [drawModel, drawGeometry, detail]);

  // One edge per drawn line (refs of a collapsed group to the same node merge, §4.2), inactive
  // lines first so that active refs draw over them.
  const edges = useMemo(() => {
    const edges: RefFlowEdge[] = [];
    if (!drawModel || !current) return edges;
    const lines = mergeRefs(drawModel, current).flatMap((line) => {
      const p = primaryRef(line, routes);
      return p ? [{ line, ...p, inactive: line.refs.every((r) => r.inactive) }] : [];
    });
    for (const { line, ref, route } of [
      ...lines.filter((l) => l.inactive),
      ...lines.filter((l) => !l.inactive),
    ]) {
      const merged = line.refs.length > 1 ? { refs: line.refs, ...mergedMarkers(line, ref) } : null;
      edges.push({
        id: line.id,
        type: 'rvRef',
        source: route.fromNode ?? ref.from.tableId,
        target: route.toNode ?? ref.to.tableId,
        sourceHandle: handleId(route.from.row, route.from.side, 'source'),
        targetHandle: handleId(route.to.row, route.to.side, 'target'),
        data: { refModel: ref, route, merged, refIds: line.refs.map((r) => r.id) },
        selectable: false,
        focusable: false,
        deletable: false,
        domAttributes: { 'data-id': ref.id } as RefFlowEdge['domAttributes'],
      });
    }
    return edges;
  }, [drawModel, current, routes]);

  const groupNodes = useMemo<GroupFlowNode[]>(() => {
    if (!drawModel || !current) return [];
    const out: GroupFlowNode[] = [];
    for (const g of drawModel.groups) {
      const box = current.groups[g.id];
      // Collapsed groups are nodes of their own (buildNodes).
      if (!box || box.collapsed) continue;
      out.push({
        id: g.id,
        type: 'rvGroup',
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        data: { group: g, w: box.width, h: box.height },
        draggable: editable,
        ...(editable ? { dragHandle: '.rv-group-drag' } : {}),
        selectable: false,
        connectable: false,
        focusable: false,
        deletable: false,
        zIndex: -1,
        className: 'rv-group-node',
      });
    }
    return out;
  }, [viewModel, current, editable]);
  groupIdsRef.current = useMemo(() => new Set(groupNodes.map((g) => g.id)), [groupNodes]);

  const allNodes = useMemo<FlowNode[]>(
    () => [
      ...groupNodes,
      ...nodes.map((n) => {
        const s = selection.has(n.id);
        return !!n.selected === s ? n : { ...n, selected: s };
      }),
    ],
    [groupNodes, nodes, selection],
  );

  // --- hover / highlight / details card -------------------------------------------------------
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Highlight: `highlightedNodeId` and `highlightIds` (tables, notes, groups, refs); unknown ids
  // are ignored. Nodes among them get the ring; groups light their member tables.
  const highlightKey = [highlightedNodeId ?? '', ...(highlightIdsProp ?? [])].join('\u0000');
  const highlightList = useRef<string[]>([]);
  highlightList.current = [
    ...(highlightedNodeId ? [highlightedNodeId] : []),
    ...(highlightIdsProp ?? []),
  ];
  const highlight = useMemo(() => {
    if (!drawModel) return null;
    const refIds = new Set(drawModel.refs.map((r) => r.id));
    const known = highlightList.current.filter((id) => isNodeOf(drawModel, id) || refIds.has(id));
    if (!known.length) return null;
    return {
      ring: new Set(known.filter((id) => !refIds.has(id))) as ReadonlySet<string>,
      lit: expandHighlight(drawModel, known),
    };
  }, [drawModel, highlightKey]);
  const lit = useMemo(
    () =>
      drawModel && hovered
        ? highlightSets(drawModel, expandHighlight(drawModel, [hovered]))
        : drawModel && highlight
          ? highlightSets(drawModel, highlight.lit)
          : null,
    [drawModel, hovered, highlight],
  );
  const onEnter = useCallback<NodeMouseHandler<FlowNode>>((_, n) => {
    if (n.type !== 'rvGroup') setHovered(n.id);
  }, []);
  const onLeave = useCallback<NodeMouseHandler<FlowNode>>(() => setHovered(null), []);
  const selectedTable =
    sideCard && selected ? drawModel?.tables.find((t) => t.id === selected) : undefined;

  // --- resize (rule 2): one 'resize' when the handles are let go --------------------------------
  const resizeStart = useRef(new Map<string, Pos>());
  const onResizeStart = useCallback((id: string) => {
    const n = nodesRef.current.find((x) => x.id === id);
    if (n) resizeStart.current.set(id, { x: n.position.x, y: n.position.y });
  }, []);
  const onResizeEnd = useCallback((id: string, box: ResizeBox) => {
    const start = resizeStart.current.get(id);
    resizeStart.current.delete(id);
    const L = live.current;
    if (!L.editable || L.focused || !L.realIds.has(id)) return;
    const moved = !!start && (Math.abs(start.x - box.x) >= 0.5 || Math.abs(start.y - box.y) >= 0.5);
    const sizes: Record<string, { w: number; h: number; x?: number; y?: number }> = {};
    setOwn(sizes, id, {
      w: box.width,
      h: box.height,
      ...(moved ? { x: box.x, y: box.y } : {}),
    });
    const fallback: Record<string, Pos> = {};
    if (start) setOwn(fallback, id, start);
    const next = setNodeSizes(L.layout, L.viewName, sizes, fallback);
    L.onLayoutChange?.(next, { kind: 'resize', view: L.viewName, ids: [id] });
  }, []);

  const edgeEvents = !!onEdgeClick || !!onEdgeContextMenu;
  const viewerState = useMemo<ViewerState>(
    () => ({
      detailLevel: detail,
      lit,
      dim: !!hovered,
      hoveredId: hovered,
      selectedId: selectedTable ? selected : null,
      highlighted: highlight?.ring ?? EMPTY_SET,
      decorations,
      selection,
      // Group header bands always take the pointer: a double-click there collapses the group.
      groupHandles: true,
      handles,
      resizable: editable && !focused ? resizable : false,
      onResizeStart,
      onResizeEnd,
      edgeEvents,
    }),
    [
      detail,
      lit,
      hovered,
      selected,
      selectedTable,
      highlight,
      decorations,
      selection,
      editable,
      focused,
      handles,
      resizable,
      onResizeStart,
      onResizeEnd,
      edgeEvents,
    ],
  );
  // The canvas colour the page actually shows (a host palette or custom CSS may replace relvista's):
  // group colours are adjusted for contrast against it.
  const [shownBg, setShownBg] = useState<{ mode: ColorMode; palette: PaletteOverrides } | null>(
    null,
  );
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const palette = resolvePalette(el, colorMode, ['canvasBg']);
    setShownBg((prev) =>
      prev && prev.mode === colorMode && prev.palette.canvasBg === palette.canvasBg
        ? prev
        : { mode: colorMode, palette },
    );
  }, [colorMode]);
  const colors = useMemo(
    () => colorResolver(colorMode, false, shownBg?.mode === colorMode ? shownBg.palette : null),
    [colorMode, shownBg],
  );
  /** What the page shows, for exports in the current mode (another mode uses its palette). */
  const shownPalette = useCallback((mode: ColorMode): PaletteOverrides | null => {
    const el = rootRef.current;
    return el && mode === live.current.colorMode ? resolvePalette(el, mode) : null;
  }, []);

  // --- node events ---------------------------------------------------------------------------
  const live = useRef({
    viewModel,
    drawModel,
    focused: !!focused,
    realIds,
    shownLayout,
    docKey,
    decorations,
    padding: PAD as Padding,
    onEdgeClick,
    onEdgeContextMenu,
    onPaneContextMenu,
    onPaneDoubleClick,
    current,
    geometry,
    layout,
    viewName,
    resetKey,
    editable,
    detail,
    edges_,
    colorMode,
    aspect,
    workerUrl,
    onLayoutChange,
    onNodeClick,
    onNodeDoubleClick,
    onNodeContextMenu,
    onPaneClick,
    fit: (_duration?: number, _g?: DiagramGeometry | null) => {},
  });
  live.current = {
    ...live.current,
    viewModel,
    drawModel,
    focused: !!focused,
    realIds,
    shownLayout,
    docKey,
    decorations,
    onEdgeClick,
    onEdgeContextMenu,
    onPaneContextMenu,
    onPaneDoubleClick,
    current,
    geometry,
    layout,
    viewName,
    resetKey,
    editable,
    detail,
    edges_,
    colorMode,
    aspect,
    workerUrl,
    onLayoutChange,
    onNodeClick,
    onNodeDoubleClick,
    onNodeContextMenu,
    onPaneClick,
  };

  const nodeEvent = useCallback(
    (
      id: string,
      type: string | undefined,
      at: {
        clientX: number;
        clientY: number;
        shiftKey: boolean;
        metaKey: boolean;
        ctrlKey: boolean;
      },
      source?: 'keyboard',
    ): CanvasNodeEvent => {
      const info = nodeInfo(live.current.drawModel, id);
      return {
        id,
        kind: info?.kind ?? KIND[(type ?? 'rvTable') as keyof typeof KIND] ?? 'table',
        span: info?.span ?? null,
        clientX: at.clientX,
        clientY: at.clientY,
        shiftKey: at.shiftKey,
        metaKey: at.metaKey,
        ctrlKey: at.ctrlKey,
        ...(source ? { source } : {}),
      };
    },
    [],
  );

  const onClick = useCallback<NodeMouseHandler<FlowNode>>(
    (e, n) => {
      const modified = e.shiftKey || e.metaKey || e.ctrlKey;
      if (sideCard && n.type === 'rvTable' && !(editable && modified))
        setSelected((s) => (s === n.id ? null : n.id));
      live.current.onNodeClick?.(nodeEvent(n.id, n.type, e));
    },
    [sideCard, editable, nodeEvent],
  );
  /**
   * Collapses or expands a group (rule 1). Editable: one 'settings' change; read-only: a local
   * overlay on the layout, never reported.
   */
  const toggleCollapse = useCallback((id: string) => {
    const L = live.current;
    const box = L.current?.groups[id];
    if (!box) return;
    const collapsed = !box.collapsed;
    const boxes: Record<string, Pos> = {};
    setOwn(boxes, id, { x: box.x, y: box.y });
    if (L.editable) {
      if (!L.realIds.has(id)) return;
      const next = setGroupsCollapsed(L.layout, L.viewName, [id], collapsed, boxes);
      L.onLayoutChange?.(next, {
        kind: 'settings',
        view: L.viewName,
        ids: [id],
        settings: { collapsed },
      });
    } else {
      setLocalLayout({
        for: L.layout,
        key: L.docKey,
        value: setGroupsCollapsed(L.shownLayout, L.viewName, [id], collapsed, boxes),
      });
    }
  }, []);
  const onDoubleClick = useCallback<NodeMouseHandler<FlowNode>>(
    (e, n) => {
      // Expanded groups take the pointer only on their header band.
      if (n.type === 'rvGroup' || n.type === 'rvCollapsedGroup') toggleCollapse(n.id);
      live.current.onNodeDoubleClick?.(nodeEvent(n.id, n.type, e));
    },
    [nodeEvent, toggleCollapse],
  );
  const onContextMenu = useCallback<NodeMouseHandler<FlowNode>>(
    (e, n) => {
      if (!live.current.onNodeContextMenu) return;
      e.preventDefault();
      live.current.onNodeContextMenu(nodeEvent(n.id, n.type, e));
    },
    [nodeEvent],
  );
  const viewportCb = useRef(onViewportChange);
  viewportCb.current = onViewportChange;
  /**
   * First view that leaves a table under the minimap: the minimap waits until the user pans or
   * zooms (a gesture, or a zoom / fit / focus command), never for the first view's own moves.
   */
  const [minimapHeld, setMinimapHeld] = useState(false);
  /**
   * The viewport was moved by the user (a gesture or a command) or restored from a saved one since
   * the first view: until then the first view follows the canvas size (see below).
   */
  const viewMoved = useRef(false);
  const onMoveStart = useCallback((event: unknown) => {
    if (event) viewMoved.current = true;
  }, []);
  const onMoveEnd = useCallback((event: unknown, vp: Viewport) => {
    if (event) setMinimapHeld(false);
    viewportCb.current?.(vp);
  }, []);
  const onPane = useCallback(() => {
    setSelected(null);
    live.current.onPaneClick?.();
  }, []);
  const paneEvent = useCallback(
    (e: { clientX: number; clientY: number }): CanvasPaneEvent => {
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
      return { clientX: e.clientX, clientY: e.clientY, x: p.x, y: p.y };
    },
    [rf],
  );
  const onPaneMenu = useCallback(
    (e: MouseEvent | ReactMouseEvent) => {
      const cb = live.current.onPaneContextMenu;
      if (!cb) return;
      e.preventDefault();
      cb(paneEvent(e));
    },
    [paneEvent],
  );
  const onRootDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const cb = live.current.onPaneDoubleClick;
      const el = e.target as Element;
      if (!cb || !el.classList?.contains('react-flow__pane')) return;
      cb(paneEvent(e));
    },
    [paneEvent],
  );
  const edgeEvent = useCallback((e: ReactMouseEvent, edge: RefFlowEdge): CanvasEdgeEvent | null => {
    const ref = edge.data?.refModel;
    if (!ref) return null;
    return { id: ref.id, span: ref.span ?? null, clientX: e.clientX, clientY: e.clientY };
  }, []);
  const onEdgeClickRf = useCallback<EdgeMouseHandler<RefFlowEdge>>(
    (e, edge) => {
      const ev = edgeEvent(e, edge);
      if (ev) live.current.onEdgeClick?.(ev);
    },
    [edgeEvent],
  );
  const onEdgeMenuRf = useCallback<EdgeMouseHandler<RefFlowEdge>>(
    (e, edge) => {
      const cb = live.current.onEdgeContextMenu;
      if (!cb) return;
      e.preventDefault();
      const ev = edgeEvent(e, edge);
      if (ev) cb(ev);
    },
    [edgeEvent],
  );

  // --- committing moves ---------------------------------------------------------------------
  const commitMove = useCallback((moved: ReadonlyMap<string, Pos>) => {
    const L = live.current;
    // Focus mode draws display-only positions (compactFocus): they are never written.
    if (!L.editable || L.focused) return;
    // Nodes only in `displayModel` (a diff's removed tables) are never written (rule 7).
    const positions: Record<string, Pos> = {};
    const ids: string[] = [];
    for (const [id, p] of moved) {
      if (!L.realIds.has(id)) continue;
      setOwn(positions, id, p);
      ids.push(id);
    }
    if (!ids.length) return;
    const next = setNodePositions(L.layout, L.viewName, positions);
    L.onLayoutChange?.(next, { kind: 'move', view: L.viewName, ids });
  }, []);

  const nudge = useMemo(
    () =>
      new NudgeBatch((ids) => {
        const byId = new Map(nodesRef.current.map((n) => [n.id, n.position]));
        const moved = new Map<string, Pos>();
        for (const id of ids) {
          const p = byId.get(id);
          if (p) moved.set(id, p);
        }
        commitMove(moved);
      }),
    [commitMove],
  );
  useEffect(() => () => nudge.flush(), [nudge]);

  const dragRef = useRef<{ start: Map<string, Pos>; group: GroupDrag | null } | null>(null);
  const onDragStart = useCallback<OnNodeDrag<FlowNode>>(
    (_, node, dragged) => {
      nudge.flush();
      const byId = new Map(nodesRef.current.map((n) => [n.id, n.position]));
      if (node.type === 'rvGroup') {
        const members = visibleMembers(node.data.group.tableIds, byId);
        const group = startGroupDrag(node.id, node.position, members, byId);
        dragRef.current = { start: new Map(group.members), group };
        setDragging(new Set(group.members.keys()));
        return;
      }
      const start = new Map<string, Pos>();
      for (const n of dragged) {
        if (n.type === 'rvGroup') continue;
        const p = byId.get(n.id) ?? n.position;
        start.set(n.id, { x: p.x, y: p.y });
      }
      dragRef.current = { start, group: null };
      setDragging(new Set(start.keys()));
    },
    [nudge],
  );
  const onDrag = useCallback<OnNodeDrag<FlowNode>>((_, node) => {
    const d = dragRef.current;
    if (!d?.group || node.id !== d.group.groupId) return;
    const pos = groupDragPositions(d.group, node.position);
    setNodes((ns) => ns.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)));
  }, []);
  const onDragStop = useCallback<OnNodeDrag<FlowNode>>(
    (_, node, dragged) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(null);
      if (!d) return;
      let end: Map<string, Pos>;
      if (d.group) {
        end = groupDragPositions(d.group, node.position);
        setNodes((ns) => ns.map((n) => (end.has(n.id) ? { ...n, position: end.get(n.id)! } : n)));
      } else end = new Map(dragged.map((n) => [n.id, n.position]));
      commitMove(movedPositions(d.start, end));
    },
    [commitMove],
  );

  // --- keyboard: Enter (details / reveal), arrows (nudge, editable) ---------------------------
  const nodeIdOf = (el: HTMLElement): string | null =>
    el.classList?.contains('react-flow__node') ? el.getAttribute('data-id') : null;

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target as HTMLElement;
      const id = nodeIdOf(el);
      if (!id || !drawModel) return;
      const isTable = drawModel.tables.some((t) => t.id === id);
      if (sideCard && isTable) {
        e.preventDefault();
        setSelected((s) => (s === id ? null : id));
      }
      if (e.key === 'Enter' && live.current.onNodeClick && nodeInfo(drawModel, id)) {
        const r = el.getBoundingClientRect();
        live.current.onNodeClick(
          nodeEvent(
            id,
            undefined,
            {
              clientX: r.left + r.width / 2,
              clientY: r.top + r.height / 2,
              shiftKey: false,
              metaKey: false,
              ctrlKey: false,
            },
            'keyboard',
          ),
        );
      }
    },
    [drawModel, sideCard, nodeEvent],
  );

  const onKeyDownCapture = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!editable || e.altKey || e.metaKey || e.ctrlKey) return;
      const delta = nudgeDelta(e.key, e.shiftKey);
      if (!delta) return;
      const el = e.target as HTMLElement;
      // Only on the diagram itself (not in the side card, toolbars or form fields).
      if (!el.closest?.('.react-flow') || el.closest('input, select, textarea, button')) return;
      const movable = new Set(nodesRef.current.map((n) => n.id));
      let ids = Array.from(selectionRef.current).filter((id) => movable.has(id));
      if (!ids.length) {
        const focused = nodeIdOf(el);
        if (focused && movable.has(focused)) ids = [focused];
      }
      if (!ids.length) return;
      // Ours, not React Flow's built-in arrow move (other step, one change per press).
      e.preventDefault();
      e.stopPropagation();
      const set = new Set(ids);
      setNodes((ns) =>
        ns.map((n) =>
          set.has(n.id)
            ? { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } }
            : n,
        ),
      );
      nudge.add(ids);
    },
    [editable, nudge],
  );

  // --- minimap / padding ---------------------------------------------------------------------
  const tableCount = drawModel?.tables.length ?? 0;
  const mini = narrow ? MINIMAP_NARROW : MINIMAP;
  /** Shown whatever the viewport (an explicit `minimap`, or a big diagram in a wide canvas). */
  const minimapAlways = !!size && minimapAlwaysShown(minimap, size.width, tableCount);
  // World box of everything drawn: the laid-out bounds plus dragged nodes.
  const contentBox = useMemo(() => {
    if (!drawGeometry) return null;
    const b = drawGeometry.bounds;
    let [x0, y0, x1, y1] = [b.x, b.y, b.x + b.width, b.y + b.height];
    for (const n of nodes) {
      const w = n.width ?? 0;
      const h = n.height ?? 0;
      x0 = Math.min(x0, n.position.x);
      y0 = Math.min(y0, n.position.y);
      x1 = Math.max(x1, n.position.x + w);
      y1 = Math.max(y1, n.position.y + h);
    }
    return { x0, y0, x1, y1 };
  }, [drawGeometry, nodes]);
  // Counted only once this document's first view is on screen (not React Flow's default one).
  const [viewShownFor, setViewShownFor] = useState<string | null>(null);
  const offscreen = useViewportStore((st) => {
    if (!contentBox || !size) return false;
    const [tx, ty, z] = st.transform;
    const e = OFFSCREEN_SLACK;
    return (
      contentBox.x0 * z + tx < -e ||
      contentBox.y0 * z + ty < -e ||
      contentBox.x1 * z + tx > size.width + e ||
      contentBox.y1 * z + ty > size.height + e
    );
  });
  const showMinimap =
    minimapAlways ||
    (minimap === 'auto' && !!size && tableCount > 0 && offscreen && viewShownFor !== null);
  const padding = useMemo<Padding>(
    () =>
      showMinimap
        ? { ...basePadding, bottom: basePadding.bottom + mini.height + mini.margin }
        : basePadding,
    [showMinimap, basePadding, mini],
  );
  live.current.padding = padding;

  // --- viewport ------------------------------------------------------------------------------
  const canvasSize = useCallback(() => {
    const el = rootRef.current;
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
  }, []);
  /** Shows the whole diagram (the Fit button), centred in the area the overlays leave free. */
  const fit = useCallback(
    (duration = 200, g: DiagramGeometry | null = live.current.current) => {
      const vp = g
        ? fitViewport({ bounds: g.bounds, ...canvasSize(), padding, maxZoom: MAX_FIT_ZOOM })
        : null;
      setMinimapHeld(false);
      if (vp) void rf.setViewport(vp, { duration });
      else void rf.fitView({ maxZoom: MAX_FIT_ZOOM, duration });
    },
    [rf, padding, canvasSize],
  );
  live.current.fit = fit;
  /**
   * Initial view: the fit, but never below the readable floor; a bigger diagram opens at that zoom
   * on the window showing the most whole tables (see `initialViewport`). Fit shows everything.
   */
  const initialView = useCallback(
    (g: DiagramGeometry, duration: number) => {
      const { detail, minimapHeld } = canvasFirstView({
        geometry: g,
        model: drawModel ?? null,
        ...canvasSize(),
        padding: basePadding,
        minimap,
      });
      setMinimapHeld(minimapHeld);
      if (detail) void rf.setViewport(detail.viewport, { duration });
      else fit(duration, g);
    },
    [rf, fit, basePadding, canvasSize, minimap, drawModel],
  );

  // The initial view is applied per document (`resetKey`) and view. Until the layout is final
  // (ELK still running) each new geometry re-applies it, so the first view frames the real
  // layout; afterwards layout and model changes never move the viewport.
  const viewStage = useRef<{ key: unknown; stage: 'pending' | 'provisional' | 'done' }>({
    key: undefined,
    stage: 'pending',
  });
  const everShown = useRef(false);
  const savedApplied = useRef(false);
  /** resetKey whose `initialViewport` was used (each document's is used once). */
  const initialVpFor = useRef<{ key: string | undefined } | null>(null);
  const stageKey = docKey;
  if (viewStage.current.key !== stageKey) viewStage.current = { key: stageKey, stage: 'pending' };
  useEffect(() => {
    const st = viewStage.current;
    const g = drawGeometry;
    if (st.stage === 'done' || !g) return;
    if (!Object.keys(g.nodes).length && !Object.values(g.groups).some((x) => x.collapsed)) return;
    const final = layoutFinal;
    let own = ownViewport && initialVpFor.current?.key !== resetKey ? ownViewport : undefined;
    // A restored session viewport that shows the whole diagram smaller than the fit would (saved in
    // a smaller window or pane) is not worth keeping: the first view frames it for this canvas.
    if (own && !saved?.viewport && shrunkenRestore(own, g.bounds, canvasSize(), basePadding)) {
      initialVpFor.current = { key: resetKey };
      own = undefined;
    }
    const savedViewport = own ?? saved?.viewport;
    // Deferred a tick so React Flow has the new nodes; the stage only advances once applied.
    const t = setTimeout(() => {
      if (viewStage.current !== st) return;
      if (st.stage === 'pending') {
        if (own) initialVpFor.current = { key: resetKey };
        savedApplied.current = !!savedViewport;
        viewMoved.current = !!savedViewport;
        if (savedViewport) {
          setMinimapHeld(false);
          void rf.setViewport(savedViewport);
        } else initialView(g, everShown.current ? 250 : 0);
      } else if (!savedApplied.current) {
        // A saved viewport is kept when the ELK result replaces the first (sync) layout.
        initialView(g, 250);
      }
      everShown.current = true;
      setViewShownFor(stageKey);
      st.stage = final ? 'done' : 'provisional';
    }, 0);
    return () => clearTimeout(t);
    // Only a new geometry or document/view drives this; see above.
  }, [drawGeometry, layoutFinal, stageKey]);

  // Focus (rule 3): the viewport fits the focused tables whenever the focus changes (not on the
  // first view, which already frames what is drawn).
  const focusFitted = useRef(focusKey);
  useEffect(() => {
    if (focusFitted.current === focusKey) return;
    focusFitted.current = focusKey;
    if (viewStage.current.stage === 'pending') return;
    viewMoved.current = true;
    const t = setTimeout(() => live.current.fit(250), 0);
    return () => clearTimeout(t);
  }, [focusKey]);

  // Collapse / expand all groups: the view fits the new picture once it is drawn.
  const fitOnNextGeometry = useRef(false);
  useEffect(() => {
    if (!fitOnNextGeometry.current || !drawGeometry) return;
    fitOnNextGeometry.current = false;
    viewMoved.current = true;
    const t = setTimeout(() => live.current.fit(250), 0);
    return () => clearTimeout(t);
  }, [drawGeometry]);

  // Until the user moves it, the first view follows the canvas size: a pane resized right after
  // opening (a restored splitter, a window snapped to half the screen, a viewer that shrinks to
  // its diagram on a phone) shows the diagram framed for its real size, not tiny and off-centre.
  const framedSize = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!size) return;
    const prev = framedSize.current;
    framedSize.current = size;
    const g = live.current.current;
    if (!prev || viewMoved.current || viewStage.current.stage === 'pending' || !g) return;
    if (Math.abs(prev.width - size.width) < 2 && Math.abs(prev.height - size.height) < 2) return;
    const raf = requestAnimationFrame(() => {
      if (!viewMoved.current) initialView(g, 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [size]);

  // --- status, geometry, placement ------------------------------------------------------------
  const statusRef = useRef(onLayoutStatus);
  statusRef.current = onLayoutStatus;
  useEffect(() => {
    statusRef.current?.(layoutFinal ? 'done' : 'pending');
  }, [layoutFinal, resetKey]);
  const geometryCb = useRef(onGeometry);
  geometryCb.current = onGeometry;
  useEffect(() => {
    geometryCb.current?.(drawGeometry);
  }, [drawGeometry]);

  // Editable: ELK's placement of nodes without a saved position becomes saved positions (one
  // 'place' change), so later edits never reshuffle them.
  const placedFor = useRef<DiagramGeometry | null>(null);
  useEffect(() => {
    if (!editable || !layoutFinal || !viewModel || !geometry) return;
    if (placedFor.current === geometry) return;
    placedFor.current = geometry;
    // Only the real model's nodes (a diff's removed tables stay unsaved, rule 7).
    const ids = unplacedIds(viewModel, saved).filter((id) => placedBox(geometry, id));
    if (!ids.length) return;
    const positions: Record<string, Pos> = {};
    for (const id of ids) {
      const n = placedBox(geometry, id)!;
      setOwn(positions, id, { x: n.x, y: n.y });
    }
    const L = live.current;
    const next = setNodePositions(L.layout, L.viewName, positions);
    L.onLayoutChange?.(next, { kind: 'place', view: L.viewName, ids });
  }, [editable, layoutFinal, viewModel, geometry, saved]);

  // --- imperative handle -------------------------------------------------------------------------
  useImperativeHandle(
    ref ?? handleRef,
    (): DiagramCanvasHandle => ({
      fitView: (o) => {
        viewMoved.current = true;
        live.current.fit(o?.duration ?? 250);
      },
      zoomIn() {
        viewMoved.current = true;
        setMinimapHeld(false);
        void rf.zoomIn({ duration: 150 });
      },
      zoomOut() {
        viewMoved.current = true;
        setMinimapHeld(false);
        void rf.zoomOut({ duration: 150 });
      },
      focusNode(id, o) {
        const g = live.current.current;
        const n = g ? (g.nodes[id] ?? g.groups[id]) : undefined;
        if (!n) return;
        const vp = rf.getViewport();
        if (o?.onlyIfHidden) {
          const s = canvasSize();
          const x0 = n.x * vp.zoom + vp.x;
          const y0 = n.y * vp.zoom + vp.y;
          const w = n.width * vp.zoom;
          const h = n.height * vp.zoom;
          const ix = Math.max(0, Math.min(s.width, x0 + w) - Math.max(0, x0));
          const iy = Math.max(0, Math.min(s.height, y0 + h) - Math.max(0, y0));
          if (w * h > 0 && (ix * iy) / (w * h) >= FOCUS_VISIBLE) return;
        }
        viewMoved.current = true;
        setMinimapHeld(false);
        void rf.setCenter(n.x + n.width / 2, n.y + n.height / 2, {
          zoom: vp.zoom,
          ...(o?.duration ? { duration: o.duration } : {}),
        });
      },
      async runAutoLayout(scope = 'unpinned') {
        const L = live.current;
        const vm = L.viewModel;
        if (!vm) return null;
        const merged = L.layout ? mergeViewDefaults(L.layout, L.viewName) : { nodes: {} };
        // 'unpinned': only pinned positions stay; sizes and collapse of the others are kept.
        const nodesIn: Record<string, NodeOverride> = {};
        for (const [id, n] of Object.entries(merged.nodes)) {
          if (scope === 'unplaced' || n.pinned) setOwn(nodesIn, id, n);
          else {
            const { x: _x, y: _y, ...rest } = n;
            setOwn(nodesIn, id, rest);
          }
        }
        const options: LayoutOptions = {
          detailLevel: L.detail,
          saved: { nodes: nodesIn } as Partial<ViewLayout>,
          ...(L.aspect ? { aspectRatio: L.aspect } : {}),
        };
        let g: DiagramGeometry;
        try {
          g = await layoutAsync(vm, {
            ...options,
            engine: 'elk',
            ...(L.workerUrl ? { workerUrl: L.workerUrl } : {}),
          });
        } catch {
          g = layoutSync(vm, options);
        }
        const after = live.current;
        // Another document, view or model while ELK ran: these positions belong to the old one.
        if (
          after.viewName !== L.viewName ||
          after.resetKey !== L.resetKey ||
          after.viewModel !== vm
        )
          return null;
        const positions: Record<string, Pos> = {};
        const ids: string[] = [];
        for (const id of unplacedIds(vm, { nodes: nodesIn })) {
          const n = placedBox(g, id);
          if (!n) continue;
          setOwn(positions, id, { x: n.x, y: n.y });
          ids.push(id);
        }
        const next = setNodePositions(after.layout, after.viewName, positions);
        if (after.editable) {
          after.onLayoutChange?.(next, { kind: 'auto-layout', view: after.viewName, scope, ids });
        } else {
          setNodes((ns) =>
            ns.map((n) =>
              Object.hasOwn(positions, n.id) ? { ...n, position: positions[n.id]! } : n,
            ),
          );
        }
        setTimeout(() => live.current.fit(250, g), 0);
        return next;
      },
      setNodeSettings(ids, settings) {
        const L = live.current;
        if (!L.editable || !ids.length) return;
        // Drawn positions: tables, notes and group boxes (fallbacks of the default view).
        const drawn: Record<string, Pos> = {};
        for (const [id, n] of Object.entries(L.current?.nodes ?? {}))
          setOwn(drawn, id, { x: n.x, y: n.y });
        for (const [id, b] of Object.entries(L.current?.groups ?? {}))
          setOwn(drawn, id, { x: b.x, y: b.y });
        const groupIds = new Set((L.viewModel?.groups ?? []).map((g) => g.id));
        const groups = ids.filter((id) => groupIds.has(id));
        let next: Layout;
        if (settings.collapsed !== undefined && groups.length) {
          // Collapsing a group also writes where its box is, so the card stays there (rule 1).
          // Several at once (Collapse all groups): the cards are packed together instead, and the
          // view fits the result once it is drawn (as it does when they expand again).
          const many = groups.length > 1;
          if (many && settings.collapsed && L.current && L.viewModel)
            Object.assign(drawn, packCollapsedCards(L.viewModel, L.current, groups));
          if (many) fitOnNextGeometry.current = true;
          next = setGroupsCollapsed(L.layout, L.viewName, groups, settings.collapsed, drawn);
          const others = ids.filter((id) => !groupIds.has(id));
          if (others.length)
            next = setLayoutNodeSettings(
              next,
              L.viewName,
              others,
              { collapsed: settings.collapsed },
              drawn,
            );
          if (settings.pinned !== undefined)
            next = setLayoutNodeSettings(next, L.viewName, ids, { pinned: settings.pinned }, drawn);
        } else next = setLayoutNodeSettings(L.layout, L.viewName, ids, settings, drawn);
        L.onLayoutChange?.(next, {
          kind: 'settings',
          view: L.viewName,
          ids: [...ids],
          settings: { ...settings },
        });
      },
      getSelection() {
        const visible = new Set(nodesRef.current.map((n) => n.id));
        return Array.from(selectionRef.current).filter((id) => visible.has(id));
      },
      // The state setter of the same name (a method does not shadow it).
      setSelection: (ids) => setSelection(ids.length ? new Set(ids) : EMPTY_SET),
      focusNodes(ids, o) {
        const g = live.current.current;
        const vm = live.current.drawModel;
        if (!g || !vm) return;
        let bounds: Box = g.bounds;
        if (ids.length) {
          const shownAs = displayNodeMap(vm, g);
          const boxes: Box[] = [];
          for (const id of ids) {
            const b =
              placedBox(g, id) ??
              (Object.hasOwn(g.groups, id) ? g.groups[id] : undefined) ??
              (shownAs.has(id) ? g.groups[shownAs.get(id)!] : undefined);
            if (b) boxes.push(b);
          }
          if (!boxes.length) return;
          const x0 = Math.min(...boxes.map((b) => b.x));
          const y0 = Math.min(...boxes.map((b) => b.y));
          const x1 = Math.max(...boxes.map((b) => b.x + b.width));
          const y1 = Math.max(...boxes.map((b) => b.y + b.height));
          bounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        }
        const p = o?.padding;
        const base = live.current.padding;
        const side = (k: keyof Padding) => {
          const v = typeof p === 'object' ? p[k] : undefined;
          return typeof v === 'number' && Number.isFinite(v) ? Math.max(base[k], v) : base[k];
        };
        const pad: Padding =
          typeof p === 'number' && Number.isFinite(p)
            ? { top: p, right: p, bottom: p, left: p }
            : typeof p === 'object' && p
              ? {
                  top: side('top'),
                  right: side('right'),
                  bottom: side('bottom'),
                  left: side('left'),
                }
              : base;
        const vp = fitViewport({
          bounds,
          ...canvasSize(),
          padding: pad,
          maxZoom: o?.maxZoom ?? MAX_FIT_ZOOM,
        });
        if (!vp) return;
        viewMoved.current = true;
        setMinimapHeld(false);
        void rf.setViewport(vp, { duration: o?.duration ?? 250 });
      },
      getNodeClientRect(id) {
        const root = rootRef.current;
        if (!root) return null;
        const el = Array.from(root.querySelectorAll<HTMLElement>('.react-flow__node')).find(
          (n) => n.getAttribute('data-id') === id,
        );
        return el ? el.getBoundingClientRect() : null;
      },
      clientToDiagram: (clientX, clientY) =>
        rf.screenToFlowPosition({ x: clientX, y: clientY }, { snapToGrid: false }),
      placeNodes(positions) {
        const moved = new Map<string, Pos>();
        for (const [id, p] of Object.entries(positions))
          if (Number.isFinite(p.x) && Number.isFinite(p.y)) moved.set(id, { x: p.x, y: p.y });
        if (!moved.size) return;
        if (live.current.editable) {
          commitMove(moved);
          return;
        }
        setNodes((ns) =>
          ns.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)),
        );
      },
      getGeometry: () => live.current.current,
      getViewport: () => rf.getViewport(),
      setViewport(vp, o) {
        viewMoved.current = true;
        setMinimapHeld(false);
        void rf.setViewport(vp, o?.duration ? { duration: o.duration } : undefined);
      },
      exportSvg(o) {
        const L = live.current;
        if (!L.drawModel || !L.current) return null;
        const colorMode = o?.colorMode ?? L.colorMode;
        // Serialised by the browser: the canvas bundle does without react-dom/server.
        return svgDocument(domMarkup, L.drawModel, L.current, {
          ...(L.decorations ? { decorations: L.decorations } : {}),
          detailLevel: L.detail,
          edgeStyle: L.edges_,
          colorMode,
          palette: shownPalette(colorMode),
          ...(o?.title ? { title: o.title } : {}),
        });
      },
      async exportPng(o) {
        const L = live.current;
        if (!L.drawModel || !L.current) return null;
        const colorMode = o?.colorMode ?? L.colorMode;
        const palette = shownPalette(colorMode);
        const { exportPng } = await import('../export/png.js');
        return exportPng(L.drawModel, L.current, {
          ...(L.decorations ? { decorations: L.decorations } : {}),
          detailLevel: L.detail,
          edgeStyle: L.edges_,
          colorMode,
          palette,
          scale: o?.scale ?? 2,
          ...(o?.title ? { title: o.title } : {}),
        });
      },
      print(o) {
        const L = live.current;
        const vm = L.drawModel;
        const g = L.current;
        if (!vm || !g) return;
        // Prints are light: the page's colours when it shows light mode.
        const palette = shownPalette('light');
        import('../export/print.js')
          .then(({ printDiagram }) =>
            printDiagram(vm, g, {
              detailLevel: L.detail,
              edgeStyle: L.edges_,
              palette,
              ...(o?.title ? { title: o.title } : {}),
            }),
          )
          .catch((err: unknown) => console.error('relvista: print failed', err));
      },
    }),
    [rf, canvasSize, shownPalette],
  );

  return (
    <div
      ref={rootRef}
      className={['rv-canvas', narrow ? 'rv-canvas--narrow' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      data-rv-color-mode={colorMode}
      data-rv-layout={layoutFinal ? 'done' : 'pending'}
      data-rv-editable={editable ? 'true' : 'false'}
      {...(focused ? { 'data-rv-focus': 'true' } : {})}
      style={style}
      onDoubleClick={onRootDoubleClick}
      onKeyDown={onKeyDown}
      onKeyDownCapture={onKeyDownCapture}
    >
      <ColorContext.Provider value={colors}>
        <ViewerContext.Provider value={viewerState}>
          <ReactFlow<FlowNode, RefFlowEdge>
            nodes={allNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeMouseEnter={onEnter}
            onNodeMouseLeave={onLeave}
            onNodeClick={onClick}
            onNodeDoubleClick={onDoubleClick}
            onNodeContextMenu={onContextMenu}
            onNodeDragStart={onDragStart}
            onNodeDrag={onDrag}
            onNodeDragStop={onDragStop}
            onPaneClick={onPane}
            {...(onPaneContextMenu ? { onPaneContextMenu: onPaneMenu } : {})}
            {...(onEdgeClick ? { onEdgeClick: onEdgeClickRf } : {})}
            {...(onEdgeContextMenu ? { onEdgeContextMenu: onEdgeMenuRf } : {})}
            onMoveStart={onMoveStart}
            onMoveEnd={onMoveEnd}
            nodesDraggable={nodeDrag}
            nodesConnectable={false}
            nodesFocusable
            edgesFocusable={false}
            edgesReconnectable={false}
            elementsSelectable={editable}
            deleteKeyCode={null}
            selectionKeyCode={editable ? 'Shift' : null}
            multiSelectionKeyCode={editable ? ['Shift', 'Meta', 'Control'] : null}
            zoomOnDoubleClick={false}
            minZoom={0.05}
            maxZoom={3}
            // No `fitView`: React Flow's own fit runs once its nodes are measured, which can be
            // after (and would replace) the initial view applied below or a restored viewport.
            forceColorMode={colorMode}
            // MIT-licensed React Flow allows hiding it; it is credited in the README instead.
            proOptions={{ hideAttribution: true }}
            aria-label={ariaLabel}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.2}
              color="var(--rv-grid-dot)"
              bgColor="var(--rv-canvas-bg)"
            />
            {showMinimap && !minimapHeld ? (
              <MiniMap<FlowNode>
                pannable
                zoomable
                className="rv-minimap"
                style={{ width: mini.width, height: mini.height }}
                offsetScale={2}
                ariaLabel="Diagram overview"
                nodeBorderRadius={3}
                nodeColor={(n) =>
                  n.type === 'rvTable'
                    ? (safeColor(n.data.table.headerColor) ?? 'var(--rv-header-bg)')
                    : n.type === 'rvNote'
                      ? 'var(--rv-note-border)'
                      : n.type === 'rvCollapsedGroup'
                        ? (safeColor(n.data.group.color) ?? 'var(--rv-group-default)')
                        : 'transparent'
                }
              />
            ) : null}
          </ReactFlow>
        </ViewerContext.Provider>
      </ColorContext.Provider>
      {selectedTable && viewModel ? (
        <SideCard table={selectedTable} model={viewModel} onClose={() => setSelected(null)} />
      ) : null}
      {children}
    </div>
  );
}
