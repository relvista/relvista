/**
 * Navigation state of the diagram pane (design phase3 §6.8–§6.10): detail level, focus, the
 * search panel, the picked hit, and deep links (apply a `DiagramTarget`, mirror the state to the
 * URL hash). Pure: the store and the diagram pane call these with their own actions.
 */
import {
  DEFAULT_VIEW,
  emptyLayout,
  neighborhood,
  resolveTableRef,
  tableTitle,
  viewDetailLevel,
  withViewDetailLevel,
  type DetailLevel,
  type DiagramModel,
  type Layout,
  type SearchHit,
  type Viewport,
} from '@relvista/core';
import { formatDiagramTarget, type DiagramTarget } from '@relvista/renderer';

/** Focus mode: tables within `hops` refs of `id` (design phase3 §6.8). */
export interface NavFocus {
  id: string;
  hops: number;
}

/** What a search hit or a deep link lit: node ids, toned columns, the table it is about. */
export interface NavPick {
  ids: string[];
  columns?: Record<string, string[]>;
  /** Table the pick is about (mirrored to the URL as `table=`). */
  table?: string;
}

/** An open search panel; `n` remounts it (a new request with other initial values). */
export interface SearchRequest {
  n: number;
  query: string;
  path: [string, string] | null;
  /** False when a deep link opened it: page loads never steal the keyboard focus. */
  autoFocus: boolean;
}

/** Hops of "Show related ▸" (the focus chip goes up to 5). */
export const RELATED_HOPS = [1, 2, 3] as const;

/** How long the canvas's own moves after a first view or an applied target are not mirrored. */
export const QUIET_MS = 600;

/** Debounce of the URL hash mirror. */
export const MIRROR_MS = 300;

/**
 * `layout` with the detail level of `view` set to `level`. The default view writes
 * `settings.detailLevel` ('all' removes the key, and an empty `settings` object with it). A named
 * view writes its own level (`settings["x-relvista-view-settings"]`); a level equal to the
 * diagram-wide one removes the view's own, so the view follows the default again. Returns `layout`
 * itself when nothing changes, so the caller can skip the history step.
 */
export function withDetailLevel(
  layout: Layout | null,
  level: DetailLevel,
  view: string = DEFAULT_VIEW,
): Layout | null {
  if (view === DEFAULT_VIEW) {
    if (!layout && level === 'all') return layout;
    return withViewDetailLevel(
      layout ?? emptyLayout(),
      DEFAULT_VIEW,
      level === 'all' ? undefined : level,
    );
  }
  const shared = layout?.settings?.detailLevel ?? 'all';
  if (!layout && level === shared) return layout;
  return withViewDetailLevel(layout ?? emptyLayout(), view, level === shared ? undefined : level);
}

/**
 * Detail level drawn: a deep link's display-only override, else the level saved for `view` (its
 * own, else the diagram-wide one), else 'all'.
 */
export function shownDetail(
  layout: Layout | null,
  override: DetailLevel | null,
  view: string = DEFAULT_VIEW,
): DetailLevel {
  return override ?? viewDetailLevel(layout, view) ?? 'all';
}

/** Columns whose type is enum `enumId`: table id → column names. */
export function enumColumns(model: DiagramModel, enumId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of model.tables) {
    const cols = t.columns.filter((c) => c.enumId === enumId).map((c) => c.name);
    if (cols.length) out[t.id] = cols;
  }
  return out;
}

/**
 * What selecting a search hit lights: a table (or group, note) itself, a column's table with the
 * row toned, every column typed with an enum. `view` hits switch views instead (null here); an
 * enum nobody uses lights nothing (null).
 */
export function pickOfHit(model: DiagramModel, hit: SearchHit): NavPick | null {
  if (hit.kind === 'view') return null;
  if (hit.kind === 'enum') {
    const columns = enumColumns(model, hit.id);
    const ids = Object.keys(columns);
    return ids.length ? { ids, columns } : null;
  }
  if (hit.kind === 'column')
    return { ids: [hit.id], columns: hit.column ? { [hit.id]: [hit.column] } : {}, table: hit.id };
  return { ids: [hit.id], ...(hit.kind === 'table' ? { table: hit.id } : {}) };
}

/** Display name of a table id (what a link carries), or the id itself when it is not in `model`. */
export function tableLabel(model: DiagramModel | null, id: string): string {
  const t = model?.tables.find((x) => x.id === id);
  return t ? tableTitle(t) : id;
}

// --- applying a deep link --------------------------------------------------------------------

/**
 * The view a target asks for, when it is a different view that exists; else null. An unknown view
 * is reported through `onUnknown` and the current view stays.
 */
export function targetView(
  target: DiagramTarget,
  model: DiagramModel,
  currentView: string,
  onUnknown?: (name: string) => void,
): string | null {
  const want = target.view ?? DEFAULT_VIEW;
  if (want === currentView) return null;
  if (want === DEFAULT_VIEW) return target.view === undefined ? null : DEFAULT_VIEW;
  if (model.views.some((v) => v.name === want)) return want;
  onUnknown?.(want);
  return null;
}

/** What applying a target does, as calls on the store (and the canvas, through `frame` / `setViewport`). */
export interface TargetActions {
  setDetailOverride(detail: DetailLevel | null): void;
  setFocus(focus: NavFocus | null): void;
  setPick(pick: NavPick | null): void;
  openSearch(init: { query?: string; path?: [string, string] | null; autoFocus: boolean }): void;
  closeSearch(): void;
  /** Frames the ids (zoom capped at 1). */
  frame(ids: string[]): void;
  setViewport(viewport: Viewport): void;
  toast(message: string): void;
}

export function unknownTableMessage(text: string): string {
  return `No table “${text}” in this schema`;
}

/**
 * Applies a target to the open view (`viewModel`: what the canvas draws). Detail is display only
 * (the layout is not written); a table is highlighted and framed, with `hops` in focus mode; an
 * explicit viewport wins over the frame; `q` and `path` open the search panel without taking the
 * keyboard focus. Unknown tables are reported with a toast and otherwise ignored.
 */
export function applyDiagramTarget(
  target: DiagramTarget,
  viewModel: DiagramModel,
  actions: TargetActions,
): void {
  actions.setDetailOverride(target.detail ?? null);
  let id: string | null = null;
  if (target.table) {
    id = resolveTableRef(viewModel, target.table);
    if (!id) actions.toast(unknownTableMessage(target.table));
  }
  // Search / path first: opening the panel drops a picked table.
  const ends = target.path ? target.path.map((x) => resolveTableRef(viewModel, x)) : null;
  if (ends && ends[0] && ends[1])
    actions.openSearch({ path: [ends[0], ends[1]], autoFocus: false });
  else if (target.path) {
    const missing = target.path.find((x, i) => !ends?.[i]);
    if (missing) actions.toast(unknownTableMessage(missing));
    if (target.search) actions.openSearch({ query: target.search, autoFocus: false });
  } else if (target.search) actions.openSearch({ query: target.search, autoFocus: false });
  else actions.closeSearch();
  if (id) {
    actions.setPick({ ids: [id], table: id });
    actions.setFocus(target.hops !== undefined ? { id, hops: target.hops } : null);
    // Focus mode frames every related table, not just the focused one (it would leave them
    // half off screen).
    if (!target.viewport)
      actions.frame(
        target.hops !== undefined ? neighborhood(viewModel, [id], target.hops).tableIds : [id],
      );
  } else {
    actions.setFocus(null);
    actions.setPick(null);
  }
  if (target.viewport) actions.setViewport(target.viewport);
}

/** True when a target asks for nothing (no keys). */
export function isEmptyTarget(target: DiagramTarget | null | undefined): boolean {
  return !target || formatDiagramTarget(target) === '';
}

// --- mirroring the state to the URL ----------------------------------------------------------

export interface MirrorState {
  view: string;
  /** Table id last selected / revealed / focused, or null. */
  table: string | null;
  focus: NavFocus | null;
  viewport: Viewport | null;
}

/** The target the URL hash mirrors while working (design phase3 §6.10): view, table, hops, vp. */
export function mirrorTarget(s: MirrorState, model: DiagramModel | null): DiagramTarget {
  const t: DiagramTarget = {};
  if (s.view !== DEFAULT_VIEW) t.view = s.view;
  const table = s.focus?.id ?? s.table;
  if (table) {
    t.table = tableLabel(model, table);
    if (s.focus) t.hops = s.focus.hops;
  }
  if (s.viewport) t.viewport = roundViewport(s.viewport);
  return t;
}

export function roundViewport(vp: Viewport): Viewport {
  const r = (n: number) => {
    const v = Math.round(n * 100) / 100;
    return Object.is(v, -0) ? 0 : v;
  };
  return { x: r(vp.x), y: r(vp.y), zoom: r(vp.zoom) };
}

/**
 * The URL (path + query + hash) after mirroring `target` into `href`'s hash: the hash is replaced
 * by the target keys, or removed for an empty target. Returns null when the hash carries a share
 * link (`dbml=`: never touched, the loader removes it) or nothing would change.
 */
export function mirroredUrl(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'>,
  target: DiagramTarget,
): string | null {
  if (/(^#?|&)dbml=/.test(loc.hash)) return null;
  const body = formatDiagramTarget(target);
  const hash = body ? `#${body}` : '';
  const current = loc.hash === '#' ? '' : loc.hash;
  if (hash === current) return null;
  return `${loc.pathname}${loc.search}${hash}`;
}

/**
 * Share dialog "Include position": `&<target keys>` with the table (and focus hops) and the
 * viewport of the moment, or '' when there is nothing to add. The view travels in the share
 * payload's own `view=` key.
 */
export function positionSuffix(s: Omit<MirrorState, 'view'>, model: DiagramModel | null): string {
  const t = mirrorTarget({ ...s, view: DEFAULT_VIEW }, model);
  const keys = formatDiagramTarget(t);
  return keys ? `&${keys}` : '';
}
