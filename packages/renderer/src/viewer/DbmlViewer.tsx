import {
  DEFAULT_VIEW,
  compileDbml,
  diffModels,
  emptyLayout,
  mergeForDiff,
  mergeViewDefaults,
  resolveTableRef,
  selectView,
  tableTitle,
  viewDetailLevel,
  type Box,
  type CompileInput,
  type DetailLevel,
  type DiagramGeometry,
  type DiagramModel,
  type Diagnostic,
  type Layout,
  type NodeLayout,
  type SearchHit,
  type ViewLayout,
  type ViewLayoutOverride,
  type Viewport,
} from '@relvista/core';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import {
  DiagramCanvasInternal,
  NARROW,
  PAD,
  focusModel,
  type DiagramCanvasHandle,
} from '../canvas/DiagramCanvas.js';
import { narrowViewerHeight, viewerPadding } from '../canvas/frame.js';
import type { CanvasNodeEvent } from '../canvas/types.js';
import { diffDecorations, diffLegend } from '../diff/decorations.js';
import type { PdfOptions, PdfPageSource } from '../export/pdf/index.js';
import { layoutSync } from '../geometry.js';
import { FocusControl } from '../nav/FocusControl.js';
import { isViewEmpty } from '../nav/viewEmpty.js';
import { SearchPanel, type SearchPanelMode } from '../nav/SearchPanel.js';
import type { TablePath } from '../nav/path.js';
import {
  formatAnchoredTarget,
  formatDiagramTarget,
  type DiagramTarget,
} from '../share/deepLink.js';
import { createEditorLink, entrySource } from '../share/editorLink.js';
import type { DecorationTone, Decorations } from '../svg/decorations.js';
import type { EdgeStyle } from '../svg/routing.js';
import type { ColorMode } from '../theme.js';
import { AlertIcon } from './icons.js';
import { SideCardActionsContext, type SideCardActions } from './SideCard.js';
import { DEFAULT_TOOLBAR, Toolbar, type ExportKind, type ToolbarItem } from './Toolbar.js';

// The PDF dialog and its tile planner load when the dialog first opens (jsPDF later, on export).
const PdfExport = lazy(() => import('./PdfExport.js'));

/** Props of `DbmlViewer`. */
export interface DbmlViewerProps {
  /** DBML source, or `{ files, entry }` for a multi-file project. */
  source: CompileInput;
  /** Parsed layout file; saved positions of the active view are honoured. */
  layout?: Layout | null;
  /** DiagramView name; default all tables. */
  view?: string;
  /** Height of the viewer (number = px). Default 480. */
  height?: number | string;
  /** Light or dark palette. Default `light`. */
  colorMode?: ColorMode;
  /** Title shown above the diagram, also used as the accessible name and export file name. */
  title?: string;
  /** Toolbar buttons, in order. Default: every button (`DEFAULT_TOOLBAR`). */
  toolbar?: ToolbarItem[];
  /** Base URL of the editor for "open in editor" (the DBML goes into `#dbml=`). */
  editorUrl?: string;
  /** Called with the compile diagnostics whenever the source is compiled. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /**
   * Nodes can be dragged (positions are not persisted). Default true. `false` wins over `frozen`:
   * nothing can ever be dragged and the toolbar has no lock button.
   */
  draggable?: boolean;
  /**
   * Start with the layout locked, as arranged in `layout` (a docs diagram its author laid out):
   * tables, notes and groups cannot be moved (pointer, touch or keyboard) and groups cannot be
   * collapsed or expanded. Panning, zooming, search, paths, focus, detail level, the details card,
   * export, print and links work as usual. The toolbar's `'lock'` button unlocks the layout for
   * this reader (nothing is saved); locking it again puts back the arrangement of `layout` (its
   * positions and collapsed groups) and leaves the viewport where it is. With
   * `draggable={false}` there is no lock button and the layout stays locked. Default false.
   */
  frozen?: boolean;
  /**
   * Overrides the layout's detail level, for every view (the toolbar's Detail menu can still
   * change it). Without it, each view shows its saved level (`viewDetailLevel`).
   */
  detailLevel?: DetailLevel;
  /**
   * Detail level of views the layout sets none for (no `detailLevel` prop either). Default 'all'.
   */
  defaultDetailLevel?: DetailLevel;
  /** Overrides `layout.settings.theme.edgeStyle`. Default orthogonal. */
  edgeStyle?: EdgeStyle;
  /**
   * Show the minimap. Default 'auto': shown whenever part of the diagram is off-screen, and
   * always for diagrams of 8 or more tables in viewers at least 600px wide (smaller below that).
   */
  minimap?: boolean | 'auto';
  /**
   * URL of `elkjs/lib/elk-worker.min.js`; when set (and `Worker` exists) auto-layout runs in a Web
   * Worker. Without it ELK runs in-process.
   */
  workerUrl?: string | URL;
  /** Class of the viewer root element. */
  className?: string;
  /** Inline style of the viewer root element. */
  style?: CSSProperties;
  /**
   * What to show (a deep link, docs/design/phase3-v1.md §4.5): view, table (centred and lit; with
   * `hops`, focus mode), detail level, viewport, search, path. Applied once the first layout is
   * done, and again whenever it changes (a target equal to the last one reported through
   * `onTargetChange` is not re-applied).
   */
  target?: DiagramTarget | null;
  /**
   * The state as a target, 300 ms after it settles: view, table, focus, detail, search, path,
   * viewport. Not called for the first view.
   */
  onTargetChange?: (target: DiagramTarget) => void;
  /**
   * The diagram's anchor on the page (docs). Enables the toolbar's 'link' button, which copies
   * `location` with `#<anchor>&<target>`.
   */
  anchor?: string;
  /** Called after the 'link' button copied a link. */
  onLinkCopy?: (href: string, target: DiagramTarget) => void;
  /** Host decorations (§4.2), drawn under search and path decorations. */
  decorations?: Decorations | null;
  /**
   * Schema diff mode: the source is compared against this older version. The diagram shows both
   * (removed tables, columns and refs too) with added / removed / changed tones and a legend; the
   * editor link is hidden.
   */
  diffAgainst?: CompileInput | null;
  /**
   * Positions computed at build time (docs SSR): used for nodes `layout` has no position for, so
   * no layout engine runs in the browser. Never put into "Open in editor" links.
   */
  ssrLayout?: Layout | null;
}

/** A title such as `schema.dbml` without its file extension, for export file names. */
export function exportBaseName(name: string): string {
  return name.replace(/\.dbml(\.layout\.json)?$/i, '') || name;
}

/** Errors in source order (file, line, column). */
export function sortDiagnostics(list: readonly Diagnostic[]): Diagnostic[] {
  return [...list].sort(
    (a, b) =>
      (a.file ?? '').localeCompare(b.file ?? '') ||
      a.start.line - b.start.line ||
      a.start.column - b.start.column,
  );
}

function sourceKey(source: CompileInput): string {
  return typeof source === 'string' ? source : JSON.stringify([source.entry, source.files]);
}

function diagnosticLabel(d: Diagnostic, multiFile: boolean): string {
  return `${multiFile ? `${d.file}:` : ''}${d.start.line}:${d.start.column}`;
}

function hasXY(n: Partial<NodeLayout> | undefined): boolean {
  return !!n && Number.isFinite(n.x) && Number.isFinite(n.y);
}

function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * `layout` plus the positions of `ssrLayout` for every node `layout` has no position for (in that
 * view, after the default view's positions are merged in). Other fields of `layout` win.
 */
export function withSsrPositions(layout: Layout | null, ssrLayout: Layout | null): Layout | null {
  if (!ssrLayout) return layout;
  const base = layout ?? emptyLayout();
  const views = { ...base.views } as Record<string, ViewLayoutOverride>;
  let changed = false;
  for (const name of Object.keys(ssrLayout.views)) {
    const ssr = ssrLayout.views[name];
    if (!ssr) continue;
    const resolved = mergeViewDefaults(base, name);
    const own = Object.hasOwn(views, name) ? views[name] : undefined;
    const nodes: Record<string, Partial<NodeLayout>> = { ...(own?.nodes ?? {}) };
    let touched = false;
    for (const id of Object.keys(ssr.nodes)) {
      const p = ssr.nodes[id];
      if (!hasXY(p) || hasXY(resolved.nodes[id])) continue;
      setOwn(nodes, id, { ...(Object.hasOwn(nodes, id) ? nodes[id] : {}), x: p!.x, y: p!.y });
      touched = true;
    }
    if (!touched) continue;
    changed = true;
    setOwn(views, name, { ...(own ?? {}), nodes } as ViewLayoutOverride);
  }
  if (!changed) return layout;
  if (!Object.hasOwn(views, DEFAULT_VIEW)) setOwn(views, DEFAULT_VIEW, { nodes: {} });
  return { ...base, views: views as Layout['views'] };
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

/** Columns whose type is enum `enumId`: table id → column names. */
function enumColumns(model: DiagramModel, enumId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of model.tables) {
    const cols = t.columns.filter((c) => c.enumId === enumId).map((c) => c.name);
    if (cols.length) out[t.id] = cols;
  }
  return out;
}

/** Search hits as 'match' decorations, the rest dimmed. */
export function hitDecorations(model: DiagramModel, hits: readonly SearchHit[]): Decorations {
  const nodes: Record<string, DecorationTone> = {};
  const columns: Record<string, Record<string, DecorationTone>> = {};
  const tone = (table: string, col: string) => ((columns[table] ??= {})[col] = 'match');
  for (const h of hits) {
    if (h.kind === 'table' || h.kind === 'group' || h.kind === 'note') nodes[h.id] = 'match';
    else if (h.kind === 'column' && h.column) tone(h.id, h.column);
    else if (h.kind === 'enum')
      for (const [t, cols] of Object.entries(enumColumns(model, h.id)))
        for (const c of cols) tone(t, c);
  }
  return { nodes, columns, dimOthers: true };
}

/** A path's tables and refs toned 'path', the rest dimmed. */
function pathDecorations(path: TablePath): Decorations {
  const nodes: Record<string, DecorationTone> = {};
  const refs: Record<string, DecorationTone> = {};
  for (const id of path.tableIds) nodes[id] = 'path';
  for (const id of path.refIds) refs[id] = 'path';
  return { nodes, refs, dimOthers: true };
}

/** What a chosen search hit lights: nodes with the ring, rows toned, nodes to frame. */
interface Picked {
  ids: string[];
  columns?: Record<string, string[]>;
  /** Table the pick is about (deep links, editor link). */
  table?: string;
}

/** The canvas node element of `id`, if drawn. */
function nodeElement(root: HTMLElement | null, id: string): HTMLElement | null {
  if (!root) return null;
  for (const n of Array.from(root.querySelectorAll<HTMLElement>('.react-flow__node')))
    if (n.getAttribute('data-id') === id) return n;
  return null;
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

/** Gap between an overlay and the nodes framed next to it, px. */
const OVERLAY_GAP = 16;

/**
 * Padding that keeps the open search / path panel (top-right overlay) off the framed nodes: its
 * bottom edge as top padding, or its left edge as right padding, whichever covers less of the
 * canvas. Undefined when no panel is open.
 */
export function panelClearance(
  root: HTMLElement | null,
): { top: number } | { right: number } | undefined {
  const panel = root?.querySelector<HTMLElement>('.rv-nav-search');
  const canvasEl = root?.querySelector<HTMLElement>('.rv-canvas') ?? root;
  if (!panel || !canvasEl) return undefined;
  const r = canvasEl.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if (!(p.width > 0 && p.height > 0 && r.width > 0 && r.height > 0)) return undefined;
  const top = p.bottom - r.top + OVERLAY_GAP;
  const right = r.right - p.left + OVERLAY_GAP;
  return top / r.height <= right / r.width ? { top } : { right };
}

/** Layers that take Esc before the viewer's own (focus, highlight) state does. */
const LAYERS = '.rv-nav-layer, [role="menu"], .rv-sidecard';

/** How long after the first view (or an applied target) the viewer's own moves are not reported. */
const QUIET_MS = 600;

/**
 * Interactive diagram viewer (browser only; React Flow inside): compiles the source and shows it
 * on a read-only `DiagramCanvas` with a toolbar (search and path, detail level, zoom, export to
 * SVG / PNG / PDF, deep links), title, error banner and empty states. Nothing here touches
 * `window` at import time, so the module can be imported during SSR; render it on the client only.
 *
 * @example
 * ```tsx
 * import { DbmlViewer } from '@relvista/renderer';
 * import '@relvista/renderer/styles.css';
 *
 * export function Schema({ dbml }: { dbml: string }) {
 *   return <DbmlViewer source={dbml} title="Shop" height={520} detailLevel="keys" />;
 * }
 * ```
 *
 * @param props - See {@link DbmlViewerProps}.
 */
export function DbmlViewer({
  source,
  layout = null,
  view,
  height = 480,
  colorMode = 'light',
  title,
  toolbar = DEFAULT_TOOLBAR,
  editorUrl,
  onDiagnostics,
  draggable = true,
  frozen = false,
  detailLevel,
  defaultDetailLevel,
  edgeStyle,
  minimap = 'auto',
  workerUrl,
  className,
  style,
  target = null,
  onTargetChange,
  anchor,
  onLinkCopy,
  decorations: hostDecorations = null,
  diffAgainst = null,
  ssrLayout = null,
}: DbmlViewerProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<DiagramCanvasHandle>(null);

  // --- compile, keeping the last good model -------------------------------------------------
  const key = sourceKey(source);
  const compiled = useMemo(() => compileDbml(source), [key]);
  const [good, setGood] = useState<DiagramModel | null>(compiled.model);
  if (compiled.model && compiled.model !== good) setGood(compiled.model);
  const model = compiled.model ?? good;
  const errors = useMemo(
    () => sortDiagnostics(compiled.diagnostics.filter((d) => d.severity === 'error')),
    [compiled],
  );

  const diagRef = useRef(onDiagnostics);
  diagRef.current = onDiagnostics;
  useEffect(() => {
    diagRef.current?.(compiled.diagnostics);
  }, [compiled]);

  // --- size (narrow chrome, height on phones) ------------------------------------------------
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
  const narrow = !!size && size.width < NARROW;

  // --- view ----------------------------------------------------------------------------------
  const [viewName, setViewName] = useState(view ?? DEFAULT_VIEW);
  useEffect(() => setViewName(view ?? DEFAULT_VIEW), [view]);
  const onUnknownView = useCallback((name: string) => {
    console.warn(`relvista: unknown view "${name}"; showing all tables`);
    setViewName(DEFAULT_VIEW);
  }, []);
  const known = !model || viewName === DEFAULT_VIEW || model.views.some((v) => v.name === viewName);
  const activeView = known ? viewName : DEFAULT_VIEW;
  const viewModel = useMemo(
    () => (model && activeView !== DEFAULT_VIEW ? (selectView(model, activeView) ?? model) : model),
    [model, activeView],
  );
  const viewNames = useMemo(() => model?.views.map((v) => v.name) ?? [], [model]);
  const emptyView =
    !!viewModel && viewModel.tables.length === 0 && viewModel.stickyNotes.length === 0;

  // --- diff (diffAgainst): both versions in one drawing ------------------------------------------
  const beforeKey = diffAgainst ? sourceKey(diffAgainst) : null;
  const before = useMemo(() => (diffAgainst ? compileDbml(diffAgainst).model : null), [beforeKey]);
  const diff = useMemo(() => (before && model ? diffModels(before, model) : null), [before, model]);
  const merged = useMemo(
    () => (diff && before && model ? mergeForDiff(before, model, diff) : null),
    [diff, before, model],
  );
  const displayModel = useMemo(
    () =>
      merged && activeView !== DEFAULT_VIEW ? (selectView(merged, activeView) ?? merged) : merged,
    [merged, activeView],
  );
  const diffDecos = useMemo(() => (diff ? diffDecorations(diff) : null), [diff]);
  const legend = useMemo(() => (diff ? diffLegend(diff) : []), [diff]);
  /** What is drawn (view-filtered; the merged model in diff mode). */
  const shown = displayModel ?? viewModel;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // --- canvas status and geometry ------------------------------------------------------------
  const [status, setStatus] = useState<'pending' | 'done'>('pending');
  const statusRef = useRef(status);
  statusRef.current = status;
  const [bounds, setBounds] = useState<Box | null>(null);
  const onGeometry = useCallback((g: DiagramGeometry | null) => setBounds(g ? g.bounds : null), []);
  /** Until then the viewer's own moves (first view, an applied target) are not reported. */
  const quietUntil = useRef(Number.POSITIVE_INFINITY);
  useEffect(() => {
    if (status === 'done' && quietUntil.current === Number.POSITIVE_INFINITY)
      quietUntil.current = Date.now() + QUIET_MS;
  }, [status]);
  /** The user's own input ends the quiet time: what they change right away is reported. */
  const endQuiet = useCallback(() => {
    if (Number.isFinite(quietUntil.current)) quietUntil.current = 0;
  }, []);

  // --- detail level --------------------------------------------------------------------------
  const [userDetail, setUserDetail] = useState<DetailLevel | null>(null);
  useEffect(() => setUserDetail(null), [detailLevel]);
  const detail: DetailLevel =
    userDetail ?? detailLevel ?? viewDetailLevel(layout, activeView) ?? defaultDetailLevel ?? 'all';
  /**
   * Switches the view from the toolbar or a search hit (a deep link sets its own detail). The
   * toolbar's detail choice is kept, unless the new view saves another level than the old one:
   * then the new view's level shows.
   */
  const switchView = useCallback(
    (name: string) => {
      if (viewDetailLevel(layout, name) !== viewDetailLevel(layout, activeView))
        setUserDetail(null);
      setViewName(name);
    },
    [layout, activeView],
  );

  // --- search, path, picked hit, focus --------------------------------------------------------
  const [search, setSearch] = useState<{
    query: string;
    path: [string, string] | null;
    autoFocus: boolean;
    n: number;
  } | null>(null);
  const [mode, setMode] = useState<SearchPanelMode>('search');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [path, setPath] = useState<{ path: TablePath | null; ends: [string, string] } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [clicked, setClicked] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; hops: number } | null>(null);
  // The title chip sits at the bottom on narrow screens. The diff legend and the focus chip sit
  // under the toolbar when there is a title or the viewer is narrow (CHIPS_TOP): the framing
  // keeps tables out from under them.
  const chipsShown = !!focus || legend.length > 0;
  const padding = useMemo(
    () => viewerPadding({ narrow, title: !!title, chips: chipsShown }),
    [narrow, title, chipsShown],
  );
  const [viewport, setViewport] = useState<Viewport | null>(null);

  const openSearch = useCallback(
    (init: { query?: string; path?: [string, string] | null; autoFocus?: boolean } = {}) => {
      setPicked(null);
      setHits([]);
      setPath(null);
      setQuery(init.query ?? '');
      setMode(init.path ? 'path' : 'search');
      setSearch((s) => ({
        query: init.query ?? '',
        path: init.path ?? null,
        autoFocus: init.autoFocus ?? true,
        n: (s?.n ?? 0) + 1,
      }));
    },
    [],
  );
  const closeSearch = useCallback(() => {
    setSearch(null);
    setHits([]);
    setPath(null);
    setQuery('');
    setMode('search');
  }, []);

  // A new document or view drops what pointed into the old one.
  useEffect(() => {
    setPicked(null);
    setClicked(null);
    setFocus(null);
    setViewport(null);
    closeSearch();
  }, [activeView, beforeKey]);
  // Picks and focus of tables that are gone (an edit) are dropped.
  useEffect(() => {
    if (!shown) return;
    const has = (id: string) =>
      shown.tables.some((t) => t.id === id) ||
      shown.groups.some((g) => g.id === id) ||
      shown.stickyNotes.some((n) => n.id === id);
    if (focus && !has(focus.id)) setFocus(null);
    if (picked && !picked.ids.every(has)) setPicked(null);
    if (clicked && !has(clicked)) setClicked(null);
  }, [shown]);

  const focusedIds = useMemo(() => {
    if (!focus || !shown) return null;
    const m = focusModel(shown, { ids: [focus.id], hops: focus.hops });
    return m ? new Set(m.tables.map((t) => t.id)) : null;
  }, [focus, shown]);

  /**
   * Frames `ids` (zoom capped at 1) and moves the keyboard focus to the first one. The search /
   * path panel, when open, is kept clear: its height at the top, or its width at the right,
   * whichever leaves more of the canvas.
   */
  const frame = useCallback((ids: string[], moveFocus: boolean) => {
    // After the canvas's own fit of a focus change (setTimeout 0 + 250 ms animation starts first).
    setTimeout(() => {
      const padding = panelClearance(rootRef.current);
      canvas.current?.focusNodes(ids, {
        maxZoom: 1,
        duration: 250,
        ...(padding ? { padding } : {}),
      });
      if (moveFocus && ids[0]) nodeElement(rootRef.current, ids[0])?.focus({ preventScroll: true });
    }, 50);
  }, []);

  const onSelect = useCallback(
    (hit: SearchHit) => {
      const m = shownRef.current;
      closeSearch();
      if (!m) return;
      if (hit.kind === 'view') {
        switchView(hit.id);
        return;
      }
      let p: Picked;
      if (hit.kind === 'enum') {
        const cols = enumColumns(m, hit.id);
        const ids = Object.keys(cols);
        if (!ids.length) return;
        p = { ids, columns: cols };
      } else if (hit.kind === 'column') {
        p = { ids: [hit.id], columns: hit.column ? { [hit.id]: [hit.column] } : {}, table: hit.id };
      } else p = { ids: [hit.id], ...(hit.kind === 'table' ? { table: hit.id } : {}) };
      // A pick outside the focused tables leaves focus mode.
      if (
        focusedIds &&
        p.ids.some((id) => m.tables.some((t) => t.id === id) && !focusedIds.has(id))
      )
        setFocus(null);
      setPicked(p);
      frame(p.ids, true);
    },
    [closeSearch, focusedIds, frame, switchView],
  );

  const onPathChange = useCallback(
    (p: TablePath | null, ends: [string, string] | null) => {
      if (!ends) {
        setPath(null);
        return;
      }
      setPath({ path: p, ends });
      if (p) {
        setFocus(null);
        frame(p.tableIds, false);
      }
    },
    [frame],
  );

  const showRelated = useCallback((id: string) => {
    setPicked(null);
    setFocus({ id, hops: 1 });
  }, []);
  const sideCardActions = useMemo<SideCardActions>(
    () => ({ onShowRelated: showRelated }),
    [showRelated],
  );

  // Esc: one layer per press. Menus, the side card, the search panel and dialogs handle their
  // own; then a picked hit's highlight goes, then focus mode.
  const escState = useRef({ picked, focus });
  escState.current = { picked, focus };
  useEffect(() => {
    if (!picked && !focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const root = rootRef.current;
      if (!root || root.querySelector(LAYERS)) return;
      const active = document.activeElement;
      if (active && active !== document.body && !root.contains(active)) return;
      e.preventDefault();
      if (escState.current.picked) setPicked(null);
      else setFocus(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [!!picked, !!focus]);

  // '/' or Mod+K inside the viewer opens the search panel.
  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!toolbar.includes('search') || !model) return;
    const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
    const modK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey;
    if (!slash && !modK) return;
    if (slash && isTyping(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (search) {
      rootRef.current?.querySelector<HTMLInputElement>('.rv-nav-search input')?.focus();
      return;
    }
    openSearch();
  };

  // --- decorations ---------------------------------------------------------------------------
  const baseDecorations = useMemo(
    () => mergeDecorations(diffDecos, hostDecorations),
    [diffDecos, hostDecorations],
  );
  const searchDecorations = useMemo(
    () => (shown && hits.length ? hitDecorations(shown, hits) : null),
    [shown, hits],
  );
  const pickedDecorations = useMemo<Decorations | null>(() => {
    if (!picked?.columns) return null;
    const columns: Record<string, Record<string, DecorationTone>> = {};
    for (const [t, cols] of Object.entries(picked.columns))
      columns[t] = Object.fromEntries(cols.map((c) => [c, 'match' as const]));
    return { columns };
  }, [picked]);
  const decorations =
    search && mode === 'path' && path?.path
      ? pathDecorations(path.path)
      : search && mode === 'search' && searchDecorations
        ? searchDecorations
        : mergeDecorations(baseDecorations, pickedDecorations);
  const highlightIds = picked?.ids ?? null;

  // --- fullscreen ----------------------------------------------------------------------------
  const [nativeFs, setNativeFs] = useState(false);
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    const on = () =>
      setNativeFs(!!rootRef.current && document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      // An open menu or card handles Esc first (it calls preventDefault): one layer per press.
      if (e.key === 'Escape' && !e.defaultPrevented) setOverlay(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [overlay]);
  const fullscreen = nativeFs || overlay;
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    if (overlay) {
      setOverlay(false);
      return;
    }
    const el = rootRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => setOverlay(true));
    } else setOverlay(true);
  }, [overlay]);
  const firstFs = useRef(true);
  useEffect(() => {
    if (firstFs.current) {
      firstFs.current = false;
      return;
    }
    const t = setTimeout(() => canvas.current?.fitView({ duration: 200 }), 60);
    return () => clearTimeout(t);
  }, [fullscreen]);

  // --- toast (link copied, PDF progress) -----------------------------------------------------
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const say = useCallback((text: string) => {
    setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((c) => (c === toast ? null : c)), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // --- layout given to the canvas: build-time positions where the layout has none -------------
  const canvasLayout = useMemo(() => withSsrPositions(layout, ssrLayout), [layout, ssrLayout]);

  // --- frozen: locked until the reader unlocks it (never saved; `frozen` changing resets it) ---
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => setUnlocked(false), [frozen]);
  const locked = frozen && !unlocked;
  const toggleLock = useCallback(() => setUnlocked((u) => !u), []);

  // --- export / print ------------------------------------------------------------------------
  const fileName = exportBaseName((title ?? model?.project?.name ?? 'diagram').trim()) || 'diagram';
  const [pdfOpen, setPdfOpen] = useState(false);
  const onExport = useCallback(
    async (kind: ExportKind) => {
      if (kind === 'pdf') {
        setPdfOpen(true);
        return;
      }
      const c = canvas.current;
      if (!c) return;
      try {
        const ex = await import('../export/download.js');
        const name = ex.fileSlug(fileName);
        const opts = title ? { title } : {};
        if (kind === 'svg') {
          const svg = c.exportSvg(opts);
          if (svg) ex.downloadSvg(svg, `${name}.svg`);
        } else {
          const blob = await c.exportPng({ ...opts, scale: 2 });
          if (blob) ex.downloadBlob(blob, `${name}.png`);
        }
      } catch (err) {
        console.error('relvista: export failed', err);
      }
    },
    [fileName, title],
  );
  const onPrint = useCallback(() => canvas.current?.print(title ? { title } : {}), [title]);

  // PDF: the current view as drawn (drags, focus, diff); other views laid out here (saved
  // positions, the sync layout for the rest).
  const pdfViews = useMemo(
    () =>
      [
        { name: DEFAULT_VIEW, label: 'All tables' },
        ...viewNames.map((v) => ({ name: v, label: v })),
      ].map((v) => (model && isViewEmpty(model, v.name) ? { ...v, empty: true } : v)),
    [viewNames, model],
  );
  const otherGeometry = useRef(
    new Map<string, { model: DiagramModel; geometry: DiagramGeometry }>(),
  );
  useEffect(() => otherGeometry.current.clear(), [model, layout, detail]);
  const pageSource = useCallback(
    (name: string): PdfPageSource | null => {
      if (!model) return null;
      const label = name === DEFAULT_VIEW ? 'All tables' : name;
      if (name === activeView) {
        const g = canvas.current?.getGeometry();
        const m = shownRef.current;
        if (!g || !m) return null;
        const drawn = focus ? (focusModel(m, { ids: [focus.id], hops: focus.hops }) ?? m) : m;
        return { title: label, model: drawn, geometry: g, decorations: baseDecorations };
      }
      let hit = otherGeometry.current.get(name);
      if (!hit) {
        const m = name === DEFAULT_VIEW ? model : (selectView(model, name) ?? model);
        // Nodes without x/y in the merged view are placed by the sync layout (core skips them).
        const saved = canvasLayout
          ? (mergeViewDefaults(canvasLayout, name) as Partial<ViewLayout>)
          : null;
        const geometry = layoutSync(m, { detailLevel: detail, ...(saved ? { saved } : {}) });
        hit = { model: m, geometry };
        otherGeometry.current.set(name, hit);
      }
      return { title: label, ...hit, decorations: hostDecorations };
    },
    [model, activeView, focus, baseDecorations, hostDecorations, canvasLayout, detail],
  );
  const docTitle = (title ?? model?.project?.name ?? '').trim();
  const onPdf = useCallback(
    async (o: PdfOptions & { views: string[] }) => {
      setPdfOpen(false);
      const { views: names, ...options } = o;
      const pages = names.map(pageSource).filter((p): p is PdfPageSource => !!p);
      if (!pages.length) return;
      say('Preparing the PDF…');
      try {
        const { exportPdfWithReport } = await import('../export/pdf/index.js');
        const report = await exportPdfWithReport(pages, {
          ...options,
          ...(docTitle ? { title: docTitle } : {}),
          detailLevel: detail,
          ...(edgeStyle ? { edgeStyle } : {}),
        });
        const ex = await import('../export/download.js');
        ex.downloadBlob(report.blob, `${ex.fileSlug(fileName)}.pdf`);
        say(
          report.rasterPages > 0
            ? 'PDF downloaded. Some text uses characters the PDF fonts lack; pages are embedded as images.'
            : `PDF downloaded (${report.pageCount} ${report.pageCount === 1 ? 'page' : 'pages'})`,
        );
      } catch (err) {
        console.error('relvista: PDF export failed', err);
        say(err instanceof Error ? err.message.replace(/^relvista: /, '') : 'PDF export failed');
      }
    },
    [pageSource, say, docTitle, detail, edgeStyle, fileName],
  );

  // --- target (deep links) -------------------------------------------------------------------
  const titleOf = useCallback(
    (id: string) => {
      const t = shown?.tables.find((x) => x.id === id) ?? model?.tables.find((x) => x.id === id);
      return t ? tableTitle(t) : id;
    },
    [shown, model],
  );
  const targetTable = focus?.id ?? picked?.table ?? clicked;
  const current = useMemo<DiagramTarget>(() => {
    const t: DiagramTarget = {};
    if (activeView !== DEFAULT_VIEW) t.view = activeView;
    if (targetTable) {
      t.table = titleOf(targetTable);
      if (focus) t.hops = focus.hops;
    }
    if (userDetail) t.detail = userDetail;
    if (viewport) t.viewport = viewport;
    if (search && mode === 'search' && query.trim()) t.search = query;
    if (search && mode === 'path' && path) t.path = [titleOf(path.ends[0]), titleOf(path.ends[1])];
    return t;
  }, [activeView, targetTable, focus, userDetail, viewport, search, mode, query, path, titleOf]);
  const currentKey = formatDiagramTarget(current);
  const currentRef = useRef(current);
  currentRef.current = current;

  const targetCb = useRef(onTargetChange);
  targetCb.current = onTargetChange;
  /** Key of the last target reported (or applied): never reported, nor re-applied, twice. */
  const lastKey = useRef('');
  useEffect(() => {
    if (currentKey === lastKey.current) return;
    const t = setTimeout(() => {
      lastKey.current = currentKey;
      if (Date.now() < quietUntil.current) return;
      targetCb.current?.(currentRef.current);
    }, 300);
    return () => clearTimeout(t);
  }, [currentKey]);

  const onViewportChange = useCallback((vp: Viewport) => {
    if (Date.now() < quietUntil.current) return;
    setViewport({
      x: Math.round(vp.x * 100) / 100,
      y: Math.round(vp.y * 100) / 100,
      zoom: Math.round(vp.zoom * 100) / 100,
    });
  }, []);

  const targetKey = target ? formatDiagramTarget(target) : '';
  const pending = useRef<DiagramTarget | null>(null);
  const [targetTick, setTargetTick] = useState(0);
  useEffect(() => {
    if (!target || !targetKey || targetKey === lastKey.current) return;
    pending.current = target;
    setTargetTick((n) => n + 1);
  }, [targetKey]);

  const applyTarget = useCallback(
    (t: DiagramTarget) => {
      const m = shownRef.current;
      if (!m) return;
      quietUntil.current = Date.now() + QUIET_MS;
      lastKey.current = formatDiagramTarget(t);
      setUserDetail(t.detail ?? null);
      const id = t.table ? resolveTableRef(m, t.table) : null;
      const vp = t.viewport;
      // Search / path first: opening the panel drops a picked table.
      const ends = t.path ? t.path.map((x) => resolveTableRef(m, x)) : null;
      if (ends && ends[0] && ends[1]) openSearch({ path: [ends[0], ends[1]], autoFocus: false });
      else if (t.search) openSearch({ query: t.search, autoFocus: false });
      else closeSearch();
      // A target is the whole state: what it leaves out is reset.
      if (id && t.hops !== undefined) {
        setPicked({ ids: [id], table: id });
        setFocus({ id, hops: t.hops });
      } else if (id) {
        setFocus(null);
        setPicked({ ids: [id], table: id });
        if (!vp) frame([id], false);
      } else {
        setFocus(null);
        setPicked(null);
      }
      setClicked(null);
      if (vp) setTimeout(() => canvas.current?.setViewport(vp), 360);
    },
    [frame, openSearch, closeSearch],
  );
  useEffect(() => {
    const t = pending.current;
    if (!t || status !== 'done' || !model) return;
    if (t.view && t.view !== activeView && model.views.some((v) => v.name === t.view)) {
      setViewName(t.view);
      return;
    }
    // A tick after the canvas's first view of this view (it is applied in a timeout too).
    const timer = setTimeout(() => {
      if (statusRef.current !== 'done' || pending.current !== t) return;
      pending.current = null;
      applyTarget(t);
    }, 80);
    return () => clearTimeout(timer);
  }, [targetTick, status, activeView, model, applyTarget]);

  // --- link button ---------------------------------------------------------------------------
  const linkCb = useRef(onLinkCopy);
  linkCb.current = onLinkCopy;
  const copyLink = useCallback(async () => {
    if (!anchor || typeof location === 'undefined') return;
    const t = currentRef.current;
    const href = `${location.href.replace(/#[\s\S]*$/, '')}#${formatAnchoredTarget(anchor, t)}`;
    lastKey.current = formatDiagramTarget(t);
    targetCb.current?.(t);
    try {
      await navigator.clipboard.writeText(href);
      say('Link copied');
    } catch {
      say('Could not copy the link');
    }
    linkCb.current?.(href, t);
  }, [anchor, say]);

  // --- editor link ---------------------------------------------------------------------------
  const multiFile = typeof source !== 'string';
  // The editor link carries one DBML text; a multi-file project (`use` imports) cannot travel in
  // it yet, so the button is hidden for those, and in diff mode. Encoding is async (compression).
  // It carries the layout as given, never `ssrLayout`.
  const [editorHref, setEditorHref] = useState<{ for: string; href: string } | null>(null);
  const linkTarget = formatDiagramTarget({
    ...(activeView !== DEFAULT_VIEW ? { view: activeView } : {}),
    ...(targetTable ? { table: titleOf(targetTable) } : {}),
  });
  const linkKey =
    editorUrl && !multiFile && !diffAgainst ? JSON.stringify([editorUrl, key, layout]) : null;
  useEffect(() => {
    if (!linkKey || !editorUrl) return;
    let alive = true;
    createEditorLink(editorUrl, { dbml: entrySource(source), layout }).then(
      (href) => alive && setEditorHref({ for: linkKey, href }),
      (err: unknown) => console.error('relvista: could not build the editor link', err),
    );
    return () => {
      alive = false;
    };
  }, [linkKey]);
  const href =
    linkKey && editorHref?.for === linkKey
      ? editorHref.href + (linkTarget ? `&${linkTarget}` : '')
      : null;

  // On narrow screens a wide diagram would sit in a tall, mostly empty box: shrink the viewer to
  // what the diagram needs at its initial zoom (never taller than asked).
  let cssHeight: string = typeof height === 'number' ? `${height}px` : height;
  if (narrow && typeof height === 'number' && size && bounds && !fullscreen) {
    const h = narrowViewerHeight({
      bounds,
      width: size.width,
      height,
      padding: { ...PAD, ...padding },
      minimap,
      // Room for the search panel and the PDF dialog while they are open.
      floor: search || pdfOpen ? 360 : 280,
    });
    cssHeight = `${h}px`;
  }
  const rootStyle: CSSProperties = { ...style, height: fullscreen ? '100%' : cssHeight };

  const onNodeClick = useCallback((e: CanvasNodeEvent) => {
    if (e.kind === 'table') setClicked(e.id);
  }, []);
  const onPaneClick = useCallback(() => {
    setPicked(null);
    setClicked(null);
  }, []);
  const canvasFocus = useMemo(
    () => (focus ? { ids: [focus.id], hops: focus.hops } : null),
    [focus],
  );

  const chips = focus || legend.length;
  return (
    <div
      ref={rootRef}
      className={[
        'rv-viewer',
        overlay ? 'rv-viewer--overlay' : '',
        nativeFs ? 'rv-viewer--fullscreen' : '',
        narrow ? 'rv-viewer--narrow' : '',
        title ? 'rv-viewer--titled' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-rv-color-mode={colorMode}
      data-rv-layout={status}
      {...(diff ? { 'data-rv-diff': 'true' } : {})}
      style={rootStyle}
      onKeyDown={onRootKeyDown}
      onPointerDownCapture={endQuiet}
      onKeyDownCapture={endQuiet}
      onWheelCapture={endQuiet}
    >
      <SideCardActionsContext.Provider value={sideCardActions}>
        <DiagramCanvasInternal
          handleRef={canvas}
          model={model}
          view={viewName}
          onUnknownView={onUnknownView}
          layout={canvasLayout}
          draggable={draggable}
          locked={locked}
          colorMode={colorMode}
          detailLevel={detail}
          {...(edgeStyle ? { edgeStyle } : {})}
          minimap={minimap}
          {...(workerUrl ? { workerUrl } : {})}
          resetKey={key}
          onLayoutStatus={setStatus}
          onGeometry={onGeometry}
          {...(padding ? { padding } : {})}
          ariaLabel={title ?? 'Entity-relationship diagram'}
          decorations={decorations}
          highlightIds={highlightIds}
          focus={canvasFocus}
          displayModel={displayModel}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onViewportChange={onViewportChange}
        />
      </SideCardActionsContext.Provider>

      {title ? (
        <div className="rv-title" title={title}>
          {title}
        </div>
      ) : null}

      {toolbar.length ? (
        <Toolbar
          items={toolbar}
          onZoomIn={() => canvas.current?.zoomIn()}
          onZoomOut={() => canvas.current?.zoomOut()}
          onFit={() => canvas.current?.fitView({ duration: 250 })}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          onExport={(k) => void onExport(k)}
          onPrint={onPrint}
          views={viewNames}
          view={activeView}
          onViewChange={switchView}
          editorHref={href}
          {...(model ? { onSearch: () => (search ? closeSearch() : openSearch()) } : {})}
          searchOpen={!!search}
          detail={detail}
          onDetailChange={setUserDetail}
          {...(anchor ? { onCopyLink: () => void copyLink() } : {})}
          // Nothing to unlock unless frozen, nor when nodes can never be dragged.
          {...(frozen && draggable ? { locked, onToggleLock: toggleLock } : {})}
          pdf={!!model}
        />
      ) : null}

      {search && shown ? (
        <SearchPanel
          key={search.n}
          model={shown}
          onSelect={onSelect}
          onHits={setHits}
          onPath={onPathChange}
          onClose={closeSearch}
          onQueryChange={setQuery}
          onModeChange={setMode}
          initialQuery={search.query}
          initialPath={search.path}
          autoFocus={search.autoFocus}
        />
      ) : null}

      {chips ? (
        <div className="rv-v1-chips">
          {focus ? (
            <FocusControl
              tableLabel={titleOf(focus.id)}
              hops={focus.hops}
              onChange={(h) => setFocus((f) => (f ? { ...f, hops: h } : f))}
              onExit={() => setFocus(null)}
            />
          ) : null}
          {legend.length ? (
            <ul className="rv-v1-legend" aria-label="Changes">
              {legend.map((l) => (
                <li key={l.tone} data-rv-tone={l.tone}>
                  <span className="rv-v1-swatch" aria-hidden="true" />
                  {l.count} {l.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {pdfOpen && model ? (
        <Suspense fallback={null}>
          <PdfExport
            views={pdfViews}
            current={activeView}
            pageSource={pageSource}
            onExport={(o) => void onPdf(o)}
            onClose={() => setPdfOpen(false)}
          />
        </Suspense>
      ) : null}

      <div
        className="rv-v1-toast"
        role="status"
        aria-live="polite"
        data-rv-empty={!toast || undefined}
      >
        {toast ? <span key={toast.n}>{toast.text}</span> : null}
      </div>

      {errors.length ? (
        <div className="rv-banner" role="alert">
          <AlertIcon />
          <div className="rv-banner-body">
            <strong>
              {model
                ? 'The DBML has errors. Showing the last valid diagram.'
                : 'The DBML has errors.'}
            </strong>
            <ul>
              {errors.slice(0, 5).map((d, i) => (
                <li key={i}>
                  <code>{diagnosticLabel(d, multiFile)}</code> {d.message}
                </li>
              ))}
              {errors.length > 5 ? <li>and {errors.length - 5} more</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      {!model ? (
        <div className="rv-empty">No diagram to show</div>
      ) : emptyView ? (
        <div className="rv-empty">
          {activeView !== DEFAULT_VIEW
            ? `The view “${activeView}” has no tables.`
            : 'No tables yet.'}
        </div>
      ) : null}
    </div>
  );
}
