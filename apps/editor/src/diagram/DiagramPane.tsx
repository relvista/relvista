/**
 * The live diagram: `<DiagramCanvas editable>` plus overlays (search, Note, undo/redo, zoom, fit,
 * detail level, focus chip, compare legend and Changes panel, error chip), the node / edge / pane
 * context menus, the sticky-note editor and the views dialog.
 */
import {
  DiagramCanvas,
  DetailSwitch,
  FocusControl,
  SearchPanel,
  diffDecorations,
  diffLegend,
  hitDecorations,
  nodeEntry,
  type CanvasEdgeEvent,
  type CanvasNodeEvent,
  type CanvasPaneEvent,
  type DecorationTone,
  type Decorations,
  type DiagramCanvasHandle,
  type SearchPanelMode,
  type TablePath,
} from '@relvista/renderer';
import {
  DEFAULT_VIEW,
  METRICS,
  neighborhood,
  selectView,
  type DiagramModel,
  type SearchHit,
} from '@relvista/core';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { EdgeMenu, type EdgeMenuTarget } from '../components/EdgeMenu.js';
import {
  FitIcon,
  MinusIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
  WarningIcon,
} from '../components/icons.js';
import { ChangesPanel } from '../components/ChangesPanel.js';
import {
  ContextMenu,
  NodeMenu,
  type CtxItem,
  type NodeMenuTarget,
} from '../components/NodeMenu.js';
import { NoteEditor, NoteEditorHelp } from '../components/NoteEditor.js';
import { mod } from '../components/shortcutLabel.js';
import { matchDiagramKey, zoneOf } from '../keyboard.js';
import { mergedForView } from '../state/compare.js';
import {
  RELATED_HOPS,
  pickOfHit,
  shownDetail,
  tableLabel,
  type NavPick,
} from '../state/navigation.js';
import { store, useEditor, type EditorState } from '../state/store.js';
import { useTheme } from '../theme.js';
import { frameNodes, useDeepLinks } from './deepLink.js';
import { freeSpot, obstaclesOf } from './placement.js';
import { useLongPressMenu } from './longPress.js';
import { onNodeClick, revealSpan, spanOfNode } from './sync.js';
import '../components/editing.css';
import '../components/navigation.css';

// Loads on first use (code-split from the editor's first load).
const ViewEditorDialog = lazy(() =>
  import('../components/ViewEditorDialog.js').then((m) => ({ default: m.ViewEditorDialog })),
);

const PADDING = { top: 56, right: 24, bottom: 56, left: 24 };
/** In compare mode on wide panes, fits keep clear of the Changes panel (navigation.css). */
const COMPARE_PADDING = { ...PADDING, right: PADDING.right + 330 };
const WIDE_QUERY = '(min-width: 768px)';

/** Height of the diagram pane (the window's, before it is drawn). */
function paneHeight(): number {
  const el = typeof document === 'undefined' ? null : document.querySelector('.ed-diagram');
  return el?.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 0);
}

/** Whether the window is wide enough for the Changes panel to sit beside the diagram. */
function useWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof matchMedia === 'undefined' || matchMedia(WIDE_QUERY).matches,
  );
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const q = matchMedia(WIDE_QUERY);
    const on = () => setWide(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return wide;
}

function nextError(): void {
  const ed = store.editor;
  if (!ed) return;
  store.setTab('code');
  ed.focus();
  void ed.getAction('editor.action.marker.next')?.run();
}

/**
 * The node to light for the cursor's block: a table inside a collapsed group lights the group's
 * card (design phase3 §6.6), which is what the diagram draws for it.
 */
function shownHighlight(s: EditorState): string | null {
  const id = s.highlightedNodeId;
  const model = s.compile.model;
  if (!id || !model) return id;
  const group = model.tables.find((t) => t.id === id)?.groupId;
  return group && nodeEntry(s.ws.layout, s.ws.view, group)?.collapsed === true ? group : id;
}

const isNote = (id: string | null | undefined): id is string => !!id?.startsWith('note:');

function SearchIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13.5 13.5" />
    </svg>
  );
}

/** `b` over `a`, map by map; `dimOthers` when either dims. */
function mergeDecorations(
  a: Decorations | null | undefined,
  b: Decorations | null | undefined,
): Decorations | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const columns: Record<string, Record<string, DecorationTone>> = { ...a.columns };
  for (const [id, c] of Object.entries(b.columns ?? {})) columns[id] = { ...columns[id], ...c };
  return {
    nodes: { ...a.nodes, ...b.nodes },
    columns,
    refs: { ...a.refs, ...b.refs },
    badges: { ...a.badges, ...b.badges },
    dimOthers: !!a.dimOthers || !!b.dimOthers,
  };
}

/** A path's tables and refs toned 'path', the rest dimmed. */
function pathDecorations(path: TablePath): Decorations {
  const nodes: Record<string, DecorationTone> = {};
  const refs: Record<string, DecorationTone> = {};
  for (const id of path.tableIds) nodes[id] = 'path';
  for (const id of path.refIds) refs[id] = 'path';
  return { nodes, refs, dimOthers: true };
}

/** A pick's columns toned 'match' (the nodes are lit through `highlightIds`). */
function pickDecorations(pick: NavPick | null): Decorations | null {
  if (!pick?.columns) return null;
  const columns: Record<string, Record<string, DecorationTone>> = {};
  for (const [t, cols] of Object.entries(pick.columns))
    columns[t] = Object.fromEntries(cols.map((c) => [c, 'match' as const]));
  return { columns };
}

/** The span to reveal for a search hit (a column's own line), or null. */
function hitSpan(model: DiagramModel | null, hit: SearchHit) {
  if (hit.kind === 'column') {
    const t = model?.tables.find((x) => x.id === hit.id);
    return t?.columns.find((c) => c.name === hit.column)?.span ?? t?.span ?? null;
  }
  return hit.kind === 'table' ? spanOfNode(hit.id) : null;
}

/** Reveals code without moving the keyboard focus or (on phones) leaving the diagram tab. */
function revealQuietly(span: ReturnType<typeof spanOfNode>): void {
  if (!span || span.file.startsWith('before:')) return;
  const tab = store.getState().tab;
  revealSpan(span);
  if (tab === 'diagram') store.setTab('diagram');
}

function NoteIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 2.75h10v6.5L9.25 13.25H3z" />
      <path d="M9.25 13.25V9.25h3.75" />
    </svg>
  );
}

interface PaneMenu {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
}

export function DiagramPane(): ReactElement {
  const handle = useRef<DiagramCanvasHandle | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Last pointer position over the canvas (client px): where N puts a note. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const model = useEditor((s) => s.compile.model);
  const stale = useEditor((s) => s.compile.stale);
  const errors = useEditor(
    (s) => s.compile.diagnostics.filter((d) => d.severity === 'error').length,
  );
  const layout = useEditor((s) => s.ws.layout);
  const view = useEditor((s) => s.ws.view);
  const wsId = useEditor((s) => s.ws.id);
  const highlighted = useEditor(shownHighlight);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const layoutStatus = useEditor((s) => s.layoutStatus);
  const noteEditing = useEditor((s) => s.noteEditing);
  const viewEditor = useEditor((s) => s.viewEditor);
  // A restored session gets its viewport back; otherwise the canvas's first view (readable zoom,
  // see the renderer's initialViewport) is kept: the editor never fits on open.
  const initialViewport = useEditor((s) => s.initialViewport);
  const detailOverride = useEditor((s) => s.detailOverride);
  const focus = useEditor((s) => s.focus);
  const pick = useEditor((s) => s.pick);
  const search = useEditor((s) => s.search);
  const compare = useEditor((s) => s.compare);
  const { mode } = useTheme();
  const [menu, setMenu] = useState<NodeMenuTarget | null>(null);
  const [searchMode, setSearchMode] = useState<SearchPanelMode>('search');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [path, setPath] = useState<{ path: TablePath | null; ends: [string, string] } | null>(null);
  useDeepLinks(handle);
  // Touch screens: a held finger opens the node / edge / pane menu (iOS has no contextmenu).
  useLongPressMenu(root);

  // --- what is drawn -------------------------------------------------------------------------
  const detail = shownDetail(layout, detailOverride, view);
  const compareResult = compare?.result ?? null;
  const displayModel = useMemo(
    () => (compareResult ? mergedForView(compareResult.merged, view) : null),
    [compareResult, view],
  );
  const viewModel = useMemo(
    () => (model && view !== DEFAULT_VIEW ? (selectView(model, view) ?? model) : model),
    [model, view],
  );
  /** View-filtered; the merged model in compare mode. */
  const shown = displayModel ?? viewModel;
  const diffDecos = useMemo(
    () => (compareResult ? diffDecorations(compareResult.diff) : null),
    [compareResult],
  );
  const legend = useMemo(
    () => (compareResult ? diffLegend(compareResult.diff) : []),
    [compareResult],
  );
  const wide = useWide();
  // Narrow panes: the Changes panel takes up to 45 % of the pane's height at the bottom.
  const padding = !compareResult
    ? PADDING
    : wide
      ? COMPARE_PADDING
      : { ...PADDING, bottom: PADDING.bottom + Math.round(paneHeight() * 0.45) };
  // Entering compare frames what changed, clear of the toolbar, legend and Changes panel, once the
  // merged diagram is laid out and on screen (a phone may be on the Code tab: then when the Diagram
  // tab opens). Later live updates never move the viewport.
  const compareFramed = useRef(false);
  const tab = useEditor((s) => s.tab);
  useEffect(() => {
    if (!compareResult) {
      compareFramed.current = false;
      return;
    }
    if (compareFramed.current || layoutStatus !== 'done') return;
    if (!root.current || root.current.clientWidth === 0) return;
    compareFramed.current = true;
    const changed = Object.keys(diffDecos?.nodes ?? {});
    frameNodes(handle, changed);
  }, [compareResult, layoutStatus, diffDecos, tab]);
  const focusedIds = useMemo(() => {
    if (!focus || !shown?.tables.some((t) => t.id === focus.id)) return null;
    return new Set(neighborhood(shown, [focus.id], focus.hops).tableIds);
  }, [focus, shown]);
  const canvasFocus = useMemo(
    () => (focus && focusedIds ? { ids: [focus.id], hops: focus.hops } : null),
    [focus, focusedIds],
  );

  // A closed search panel takes its decorations with it.
  useEffect(() => {
    if (search) return;
    setHits([]);
    setPath(null);
    setSearchMode('search');
  }, [search]);
  useEffect(() => {
    if (search) setSearchMode(search.path ? 'path' : 'search');
  }, [search?.n]);
  // Picks of elements that are gone (an edit, another view) are dropped.
  useEffect(() => {
    if (!shown || !pick) return;
    const has = (id: string) =>
      shown.tables.some((t) => t.id === id) ||
      shown.groups.some((g) => g.id === id) ||
      shown.stickyNotes.some((n) => n.id === id);
    if (!pick.ids.every(has)) store.setPick(null);
  }, [shown, pick]);

  const decorations = useMemo(() => {
    if (search && searchMode === 'path' && path?.path) return pathDecorations(path.path);
    if (search && searchMode === 'search' && hits.length && shown)
      return hitDecorations(shown, hits);
    return mergeDecorations(diffDecos, pickDecorations(pick));
  }, [search, searchMode, path, hits, shown, diffDecos, pick]);

  const onSearchSelect = (hit: SearchHit) => {
    store.closeSearch();
    if (!shown) return;
    if (hit.kind === 'view') {
      store.setView(hit.id);
      return;
    }
    const p = pickOfHit(shown, hit);
    if (!p) return;
    // A pick outside the focused tables leaves focus mode.
    if (
      focusedIds &&
      p.ids.some((id) => shown.tables.some((t) => t.id === id) && !focusedIds.has(id))
    )
      store.setFocus(null);
    store.setPick(p);
    frameNodes(handle, p.ids, true);
    revealQuietly(hitSpan(model, hit));
  };

  const onPathChange = (p: TablePath | null, ends: [string, string] | null) => {
    if (!ends) {
      setPath(null);
      return;
    }
    setPath({ path: p, ends });
    if (p) {
      store.setFocus(null);
      frameNodes(handle, p.tableIds);
    }
  };

  const toggleSearch = () => {
    if (store.getState().search) {
      root.current?.querySelector<HTMLInputElement>('.rv-nav-search input')?.focus();
      return;
    }
    store.openSearch();
  };

  /** Node menu items of this pane: Show related ▸ 1 / 2 / 3 hops (tables). */
  const relatedItems = (target: NodeMenuTarget): CtxItem[] =>
    target.kind === 'table'
      ? [
          {
            id: 'related',
            label: 'Show related',
            separator: true,
            submenu: RELATED_HOPS.map((h) => ({
              id: `related-${h}`,
              label: `${h} ${h === 1 ? 'hop' : 'hops'}`,
              checked: focus?.id === target.id && focus.hops === h,
              run: () => {
                store.setPick(null);
                store.setFocus({ id: target.id, hops: h });
              },
            })),
          },
        ]
      : [];
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuTarget | null>(null);
  const [paneMenu, setPaneMenu] = useState<PaneMenu | null>(null);

  const setHandle = useCallback((h: DiagramCanvasHandle | null) => {
    handle.current = h;
    store.canvas = h;
  }, []);

  const canvasEl = () => root.current?.querySelector<HTMLElement>('.rv-canvas') ?? null;

  // The canvas itself takes focus when the empty pane is clicked, so N / Delete / + reach it
  // (React Flow's pane is not focusable; the nodes are).
  useEffect(() => {
    const el = canvasEl();
    if (el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  });

  const closeMenus = () => {
    setMenu(null);
    setEdgeMenu(null);
    setPaneMenu(null);
  };

  const openMenu = (
    e:
      | CanvasNodeEvent
      | { id: string; kind: CanvasNodeEvent['kind']; clientX: number; clientY: number },
  ) => {
    closeMenus();
    const selection = handle.current?.getSelection() ?? [];
    const ids = selection.includes(e.id)
      ? selection.filter((id) => !id.startsWith('group:'))
      : [e.id];
    setMenu({ id: e.id, kind: e.kind, x: e.clientX, y: e.clientY, ids: ids.length ? ids : [e.id] });
  };

  /**
   * A new note with its top-left at a client point, else centred in the visible canvas; moved to
   * the nearest free spot when that would put it under a table (tables are drawn above notes).
   */
  const addNote = (at?: { clientX: number; clientY: number }) => {
    const h = handle.current;
    const el = canvasEl();
    if (!h || !el || !model) return;
    const r = el.getBoundingClientRect();
    const size = { width: METRICS.noteWidth, height: METRICS.noteMinHeight };
    let p: { x: number; y: number };
    if (at) p = h.clientToDiagram(at.clientX, at.clientY);
    else {
      const c = h.clientToDiagram(r.left + r.width / 2, r.top + r.height / 2);
      p = { x: c.x - size.width / 2, y: c.y - size.height / 2 };
    }
    const tl = h.clientToDiagram(r.left + PADDING.left, r.top + PADDING.top);
    const br = h.clientToDiagram(r.right - PADDING.right, r.bottom - PADDING.bottom);
    const within = { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
    const spot = freeSpot(p, size, obstaclesOf(h.getGeometry()), within);
    store.addNote({ x: Math.round(spot.x), y: Math.round(spot.y) }, 'New note', { edit: true });
  };

  const pointerInside = (): { clientX: number; clientY: number } | undefined => {
    const p = pointer.current;
    const r = canvasEl()?.getBoundingClientRect();
    if (!p || !r) return undefined;
    const inside = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    return inside ? { clientX: p.x, clientY: p.y } : undefined;
  };

  /** N, Enter / F2 and Delete / Backspace on the diagram (keyboard.ts `matchDiagramKey`). */
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    const s = store.getState();
    if (s.dialog || s.noteEditing || s.viewEditor) return;
    const target = e.target as Element;
    const action = matchDiagramKey(e, zoneOf(target));
    if (!action) return;
    // Keys on a toolbar button or a menu are theirs (Esc and the detail keys work there too).
    const anywhere = action === 'newNote' || action === 'escape' || action.startsWith('detail');
    if (!anywhere && target.closest?.('button, [role="menu"]')) return;
    if (action === 'escape' && target.closest?.('[role="menu"]')) return;
    const focused = target.closest?.('.react-flow__node')?.getAttribute('data-id') ?? null;
    const selection = handle.current?.getSelection() ?? [];
    const act = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (action === 'detailNames' || action === 'detailKeys' || action === 'detailAll') {
      if (target.closest?.('.rv-nav-search')) return;
      act();
      store.setDetailLevel(
        action === 'detailNames' ? 'names' : action === 'detailKeys' ? 'keys' : 'all',
      );
    } else if (action === 'escape') {
      if (target.closest?.('.rv-nav-search, .ed-changes')) return;
      if (store.escapeLayer()) act();
    } else if (action === 'newNote') {
      if (!model) return;
      act();
      addNote(pointerInside());
    } else if (action === 'editNote') {
      // Enter on a table keeps revealing it in code (the canvas and onKeyDown below).
      const id = isNote(focused)
        ? focused
        : !focused && selection.length === 1 && isNote(selection[0])
          ? selection[0]
          : null;
      if (!id) return;
      act();
      store.startNoteEdit(id);
    } else {
      const ids = focused && !selection.includes(focused) ? [focused] : selection;
      const notes = ids.filter(isNote);
      if (!notes.length) return;
      act();
      void store.requestDeleteNotes(notes);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const node = (e.target as Element).closest?.('.react-flow__node');
    const id = node?.getAttribute('data-id');
    if (!id) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const span = spanOfNode(id);
      if (span) {
        e.preventDefault();
        revealSpan(span, { focus: true });
      }
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = node!.getBoundingClientRect();
      const kind = id.startsWith('note:') ? 'note' : id.startsWith('group:') ? 'group' : 'table';
      openMenu({ id, kind, clientX: r.left + 16, clientY: r.top + 24 });
    }
  };

  /**
   * A click on the empty pane focuses the canvas, a click on a node the node (the drag handling
   * can keep the browser from doing it), so the diagram keys act on what was clicked.
   */
  const onPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.target as Element;
    const canvas = canvasEl();
    if (!canvas?.contains(el)) return;
    const node = el.closest?.<HTMLElement>('.react-flow__node');
    const target = node ?? (el.classList?.contains('react-flow__pane') ? canvas : null);
    if (!target) return;
    setTimeout(() => {
      // Only when nothing else took focus meanwhile (a menu, the note editor).
      const active = document.activeElement;
      if (!active || active === document.body || (active === canvas && target !== canvas))
        target.focus({ preventScroll: true });
    }, 0);
  };

  const onNodeDoubleClick = (e: CanvasNodeEvent) => {
    if (e.kind === 'note') store.startNoteEdit(e.id);
  };

  const onEdgeContextMenu = (e: CanvasEdgeEvent) => {
    closeMenus();
    setEdgeMenu({ id: e.id, span: e.span, x: e.clientX, y: e.clientY });
  };

  const onPaneContextMenu = (e: CanvasPaneEvent) => {
    closeMenus();
    setPaneMenu(e);
  };

  const empty = !model || (model.tables.length === 0 && model.stickyNotes.length === 0);
  const groupIds = paneMenu ? store.viewGroupIds() : [];
  const collapsedGroups = groupIds.filter(
    (id) => nodeEntry(layout, view, id)?.collapsed === true,
  ).length;

  return (
    <div
      ref={root}
      className="ed-diagram"
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={onKeyDown}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerLeave={() => {
        pointer.current = null;
      }}
    >
      <DiagramCanvas
        ref={setHandle}
        model={model}
        view={view}
        layout={layout}
        onLayoutChange={store.onLayoutChange}
        editable
        colorMode={mode}
        workerUrl={elkWorkerUrl}
        highlightedNodeId={highlighted}
        highlightIds={pick?.ids ?? null}
        decorations={decorations}
        focus={canvasFocus}
        displayModel={displayModel}
        detailLevel={detail}
        onNodeClick={(e) => {
          if (e.kind === 'table' && !e.shiftKey && !e.metaKey && !e.ctrlKey)
            store.setNavTable(e.id);
          onNodeClick(e);
        }}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={openMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => {
          store.setHighlight(null);
          store.setNavTable(null);
          if (store.getState().pick) store.setPick(null);
        }}
        onViewportChange={store.onViewportChange}
        resetKey={wsId}
        initialViewport={initialViewport}
        onLayoutStatus={store.setLayoutStatus}
        padding={padding}
        ariaLabel="Entity-relationship diagram"
      >
        <div className="ed-overlay ed-overlay--tr" role="toolbar" aria-label="Diagram">
          <button
            type="button"
            className="ed-iconbtn"
            aria-label="Search"
            aria-pressed={!!search}
            title={`Search tables and columns (${mod('K')} or /)`}
            disabled={!model}
            onClick={toggleSearch}
          >
            <SearchIcon />
          </button>
          <span className="ed-overlay__sep" aria-hidden="true" />
          <button
            type="button"
            className="ed-iconbtn ed-notebtn"
            title="Add a sticky note (N)"
            disabled={!model}
            onClick={() => addNote()}
          >
            <NoteIcon />
            <span className="ed-notebtn__label">Note</span>
          </button>
          <span className="ed-overlay__sep" aria-hidden="true" />
          <button
            type="button"
            className="ed-iconbtn"
            aria-label="Undo layout change"
            title={`Undo layout change (${mod('Z')})`}
            disabled={!canUndo}
            onClick={() => store.undoLayout()}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="ed-iconbtn"
            aria-label="Redo layout change"
            title={`Redo layout change (${mod('Z', { shift: true })})`}
            disabled={!canRedo}
            onClick={() => store.redoLayout()}
          >
            <RedoIcon />
          </button>
          <span className="ed-overlay__sep" aria-hidden="true" />
          <button
            type="button"
            className="ed-iconbtn"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => handle.current?.zoomIn()}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="ed-iconbtn"
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => handle.current?.zoomOut()}
          >
            <MinusIcon />
          </button>
          <button
            type="button"
            className="ed-iconbtn"
            aria-label="Fit diagram"
            title="Fit diagram (Shift+1)"
            onClick={() => handle.current?.fitView({ duration: 250 })}
          >
            <FitIcon />
          </button>
        </div>
        {stale && model && errors > 0 && !empty && (
          <button type="button" className="ed-chip ed-chip--error" onClick={nextError}>
            <WarningIcon />
            Showing the last valid diagram · {errors} error{errors === 1 ? '' : 's'}
          </button>
        )}
        {layoutStatus === 'pending' && model && !empty && (
          <div className="ed-chip ed-chip--muted ed-chip--top">Arranging…</div>
        )}
        {model && !empty && (
          <div className="ed-overlay ed-overlay--bl ed-nav-detail">
            <DetailSwitch
              value={detail}
              onChange={(v) => store.setDetailLevel(v)}
              label="Detail level (1 / 2 / 3)"
            />
          </div>
        )}
        {(focus && focusedIds) || legend.length ? (
          <div className="ed-nav-chips">
            {focus && focusedIds && (
              <FocusControl
                tableLabel={tableLabel(shown, focus.id)}
                hops={focus.hops}
                onChange={(h) => store.setFocus({ id: focus.id, hops: h })}
                onExit={() => store.setFocus(null)}
              />
            )}
            {legend.length > 0 && (
              <ul className="rv-v1-legend ed-nav-legend" aria-label="Changes in this comparison">
                {legend.map((l) => (
                  <li key={l.tone} data-rv-tone={l.tone}>
                    <span className="rv-v1-swatch" aria-hidden="true" />
                    {l.count} {l.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {search && shown && (
          <SearchPanel
            key={search.n}
            className="ed-nav-search"
            model={shown}
            onSelect={onSearchSelect}
            onHits={setHits}
            onPath={onPathChange}
            onClose={() => {
              store.closeSearch();
              canvasEl()?.focus({ preventScroll: true });
            }}
            onModeChange={setSearchMode}
            initialQuery={search.query}
            initialPath={search.path}
            autoFocus={search.autoFocus}
          />
        )}
      </DiagramCanvas>
      {compare && compareResult && (
        <ChangesPanel
          compare={compare}
          result={compareResult}
          onSelect={(id) => {
            if (!shown) return;
            const known =
              shown.tables.some((t) => t.id === id) ||
              shown.groups.some((g) => g.id === id) ||
              shown.stickyNotes.some((n) => n.id === id);
            if (!known) return;
            if (focusedIds && !focusedIds.has(id) && shown.tables.some((t) => t.id === id))
              store.setFocus(null);
            store.setPick({
              ids: [id],
              ...(shown.tables.some((t) => t.id === id) ? { table: id } : {}),
            });
            frameNodes(handle, [id]);
          }}
          onToggle={() => frameNodes(handle, Object.keys(diffDecos?.nodes ?? {}))}
        />
      )}
      {empty && (
        <div className="ed-diagram__empty">
          <p>No tables yet</p>
          {errors > 0 && (
            <button type="button" className="ed-btn ed-btn--small" onClick={nextError}>
              Show {errors} error{errors === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
      {noteEditing && (
        <NoteEditor key={noteEditing.id} id={noteEditing.id} fresh={noteEditing.fresh} />
      )}
      <NoteEditorHelp />
      {menu && (
        <NodeMenu
          target={menu}
          extraItems={relatedItems(menu)}
          onClose={() => setMenu(null)}
          onReveal={(id) => {
            const span = spanOfNode(id);
            if (span) revealSpan(span, { focus: true });
          }}
          onRef={(refId) => {
            const ref = model?.refs.find((r) => r.id === refId);
            const at = menu;
            // After the node menu has closed (its outside-click handler would close this one).
            requestAnimationFrame(() =>
              setEdgeMenu({
                id: refId,
                span: ref?.span ?? null,
                x: at.x + 24,
                y: at.y + 12,
                returnTo: at.id,
              }),
            );
          }}
        />
      )}
      {edgeMenu && (
        <EdgeMenu
          target={edgeMenu}
          onClose={() => setEdgeMenu(null)}
          onReveal={(span) => revealSpan(span, { focus: true })}
        />
      )}
      {paneMenu && (
        <ContextMenu
          x={paneMenu.clientX}
          y={paneMenu.clientY}
          label="Diagram"
          onClose={(refocus) => {
            setPaneMenu(null);
            if (refocus) canvasEl()?.focus({ preventScroll: true });
          }}
          items={[
            {
              id: 'note',
              label: 'Add note here',
              shortcut: 'N',
              disabled: !model,
              run: () => addNote({ clientX: paneMenu.clientX, clientY: paneMenu.clientY }),
            },
            {
              id: 'fit',
              label: 'Fit diagram',
              shortcut: 'Shift+1',
              refocus: true,
              run: () => handle.current?.fitView({ duration: 250 }),
            },
            ...(groupIds.length
              ? [
                  {
                    id: 'collapse-all',
                    label: 'Collapse all groups',
                    separator: true,
                    disabled: collapsedGroups === groupIds.length,
                    refocus: true,
                    run: () => store.setAllGroupsCollapsed(true),
                  },
                  {
                    id: 'expand-all',
                    label: 'Expand all',
                    disabled: collapsedGroups === 0,
                    refocus: true,
                    run: () => store.setAllGroupsCollapsed(false),
                  },
                ]
              : []),
          ]}
        />
      )}
      {viewEditor &&
        createPortal(
          <Suspense fallback={null}>
            <ViewEditorDialog key={`${viewEditor.mode}:${viewEditor.name}`} state={viewEditor} />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}
