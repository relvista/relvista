import Ajv2020Module from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { parseRefId, refIdOf, tableIdOf } from '../ids.js';
import { layoutSchema } from './schema.generated.js';
import {
  DEFAULT_VIEW,
  LAYOUT_SCHEMA_ID,
  VIEW_SETTINGS_KEY,
  type DetailLevel,
  type EdgeLayout,
  type LayoutSettings,
  type Layout,
  type LayoutError,
  type NodeId,
  type NodeOverride,
  type ParseLayoutResult,
  type ViewLayout,
  type ViewLayoutOverride,
  type ViewSettings,
} from './types.js';

// ajv ships CommonJS; under NodeNext the default import is `module.exports`, whose `.default` is the class.
const Ajv2020 = (Ajv2020Module as unknown as { default: typeof Ajv2020Module.default }).default;

let validator: ValidateFunction<Layout> | undefined;
function getValidator(): ValidateFunction<Layout> {
  validator ??= new Ajv2020({ allErrors: true, strict: true }).compile<Layout>(layoutSchema);
  return validator;
}

type AjvError = ErrorObject & { propertyName?: string };

function toLayoutError(e: AjvError): LayoutError {
  const p = e.params as Record<string, unknown>;
  let message = e.message ?? 'is invalid';
  if (e.propertyName !== undefined) {
    message =
      e.schemaPath === '#/$defs/nodeId/pattern'
        ? `invalid node id "${e.propertyName}" (expected "schema.table", "note:<name>" or "group:<name>")`
        : `invalid key "${e.propertyName}": ${message}`;
  } else if (e.keyword === 'additionalProperties') {
    message = `unknown property "${String(p.additionalProperty)}"`;
  } else if (e.keyword === 'enum') {
    message = `${message}: ${(p.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`;
  } else if (e.keyword === 'const') {
    message = `${message} ${JSON.stringify(p.allowedValue)}`;
  }
  return { path: e.instancePath, message };
}

/**
 * Validate a layout file. Accepts the parsed JSON value or the raw file text.
 * The returned layout is a copy; the input is never mutated.
 */
export function parseLayout(json: unknown): ParseLayoutResult {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch (err) {
      return {
        ok: false,
        errors: [{ path: '', message: `invalid JSON: ${(err as Error).message}` }],
      };
    }
  }
  const validate = getValidator();
  if (!validate(value)) {
    const raw = (validate.errors ?? []) as AjvError[];
    // A bad key yields a specific error (with `propertyName`) plus a generic "propertyNames" wrapper.
    const errors = raw.filter(
      (e) =>
        e.keyword !== 'propertyNames' ||
        !raw.some((o) => o.propertyName !== undefined && o.instancePath === e.instancePath),
    );
    const seen = new Set<string>();
    const out: LayoutError[] = [];
    for (const e of errors.map(toLayoutError)) {
      const k = `${e.path}\u0000${e.message}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(e);
      }
    }
    return { ok: false, errors: out };
  }
  return { ok: true, layout: structuredClone(value) };
}

/**
 * Builds an object from entries as own data properties. Plain assignment (`out[key] = v`) would
 * turn a `__proto__` key into a prototype change and lose the entry.
 */
function fromEntries<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.fromEntries(entries) as Record<string, T>;
}

function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function finite(n: number): number {
  if (!Number.isFinite(n)) throw new RangeError(`layout contains a non-finite number: ${n}`);
  return n;
}

function noNegZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

/**
 * Rounds to 2 decimals via the exact decimal expansion (`toFixed`), so rounding is idempotent and a
 * huge value never overflows; values too large to have 2 decimals come back unchanged.
 */
function round2(n: number): number {
  return noNegZero(Number(finite(n).toFixed(2)));
}

/** Zoom keeps 4 significant digits, so a far zoomed-out viewport never rounds to 0. */
function roundZoom(n: number): number {
  return noNegZero(Number(finite(n).toPrecision(4)));
}

/** Sizes are rounded to 2 decimals but a positive size never becomes 0. */
function roundSize(n: number): number {
  const v = round2(n);
  return n > 0 && v <= 0 ? 0.01 : v;
}

function roundNumber(n: number, key: string | undefined): number {
  if (key === 'zoom') return roundZoom(n);
  if (key === 'w' || key === 'h') return roundSize(n);
  return round2(n);
}

const EXTENSION_KEY = /^x-/;

/**
 * Sorts keys recursively and rounds numbers. `x-*` extension values (at the top level and in
 * `settings`, where the schema allows them) are copied verbatim: only their key position is sorted. relvista's own
 * `settings[VIEW_SETTINGS_KEY]` is normalised like the rest.
 */
function normalize(value: unknown, path: readonly string[]): unknown {
  const key = path[path.length - 1];
  if (typeof value === 'number') return roundNumber(value, key);
  if (Array.isArray(value)) return value.map((v) => normalize(v, [...path, '[]']));
  if (value !== null && typeof value === 'object') {
    const extensionsHere = path.length === 0 || (path.length === 1 && path[0] === 'settings');
    const entries: [string, unknown][] = [];
    for (const k of Object.keys(value).sort(compareKeys)) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      // relvista's own extension key (`settings[VIEW_SETTINGS_KEY]`) is sorted like the rest.
      const verbatim = extensionsHere && EXTENSION_KEY.test(k) && !isViewSettingsPath(path, k);
      entries.push([k, verbatim ? v : normalize(v, [...path, k])]);
    }
    return fromEntries(entries);
  }
  return value;
}

function isViewSettingsPath(path: readonly string[], key: string): boolean {
  return path.length === 1 && path[0] === 'settings' && key === VIEW_SETTINGS_KEY;
}

/** Locale-independent ordering by UTF-16 code units. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic serialization for minimal git diffs: keys sorted recursively, numbers rounded to
 * 2 decimals (zoom to 4 significant digits; a positive `w`/`h` never below 0.01), 2-space indent,
 * trailing newline. Array order (waypoints) is preserved, `x-*` extension values are written as
 * given (except relvista's own `settings["x-relvista-view-settings"]`, sorted like the rest). The
 * output of a valid layout always parses back as valid.
 */
export function serializeLayout(layout: Layout): string {
  return `${JSON.stringify(normalize(layout, []), null, 2)}\n`;
}

/** A layout with an empty default view. */
export function emptyLayout(): Layout {
  return { $schema: LAYOUT_SCHEMA_ID, version: 1, views: { [DEFAULT_VIEW]: { nodes: {} } } };
}

/**
 * Stable id of a table: "schema.table", with the default schema "public" written out and segments
 * quoted when needed (`a."b.c"`). Same as `tableIdOf`.
 */
export function tableId(schema: string | null | undefined, name: string): NodeId {
  return tableIdOf(schema, name);
}

/** Stable id of a sticky note. */
export function noteId(name: string): NodeId {
  return `note:${name}`;
}

/** Stable id of a table group. */
export function groupId(name: string): NodeId {
  return `group:${name}`;
}

/** Sidecar file name for a DBML file: "schema.dbml" → "schema.dbml.layout.json". */
export function layoutFileName(dbmlFileName: string): string {
  return `${dbmlFileName}.layout.json`;
}

function mapViews(
  layout: Layout,
  fn: (view: ViewLayoutOverride, name: string) => ViewLayoutOverride,
): Layout {
  const views = fromEntries(Object.entries(layout.views).map(([name, v]) => [name, fn(v, name)]));
  return { ...layout, views };
}

/** Rewrites the table ids inside a ref id; returns the id unchanged when it does not parse. */
function renameInRefId(id: string, oldId: NodeId, newId: NodeId): string {
  const ref = parseRefId(id);
  if (!ref || (ref.from.tableId !== oldId && ref.to.tableId !== oldId)) return id;
  const swap = (t: string) => (t === oldId ? newId : t);
  return refIdOf(
    { ...ref.from, tableId: swap(ref.from.tableId) },
    ref.relation,
    { ...ref.to, tableId: swap(ref.to.tableId) },
    ref.n,
  );
}

/**
 * Rename a node in every view (e.g. after a table was renamed in the DBML). Returns a new layout.
 * Edge entries whose ref id has the renamed table as an endpoint are re-keyed too, so manual edge
 * routing survives the rename. If a view already has an entry under the new id, the renamed entry
 * replaces it.
 */
export function renameNode(layout: Layout, oldId: NodeId, newId: NodeId): Layout {
  if (oldId === newId) return layout;
  return mapViews(layout, (view) => {
    let changed = false;
    let nodes = view.nodes;
    if (Object.hasOwn(view.nodes, oldId)) {
      changed = true;
      const entries = Object.entries(view.nodes).filter(([id]) => id !== newId);
      nodes = fromEntries(entries.map(([id, n]) => [id === oldId ? newId : id, n]));
    }
    let edges = view.edges;
    if (edges) {
      const renamed = Object.entries(edges).map(
        ([id, e]) => [id, renameInRefId(id, oldId, newId), e] as const,
      );
      if (renamed.some(([id, next]) => id !== next)) {
        changed = true;
        const targets = new Set(renamed.filter(([id, next]) => id !== next).map(([, n]) => n));
        edges = fromEntries(
          renamed
            .filter(([id, next]) => id !== next || !targets.has(id))
            .map(([, next, e]) => [next, e] as const),
        );
      }
    }
    if (!changed) return view;
    const out: ViewLayoutOverride = { ...view, nodes };
    if (edges) out.edges = edges;
    return out;
  });
}

/** What `pruneLayout` returns: the pruned layout and what it removed. */
export interface PruneResult {
  layout: Layout;
  /** Node ids removed from at least one view, sorted. */
  removed: NodeId[];
  /** Edge ids removed from at least one view, sorted (only when `existingEdgeIds` was given). */
  removedEdges: string[];
}

/**
 * Drop node entries (and, if `existingEdgeIds` is given, edge entries) that no longer exist in the
 * diagram, in every view. Views themselves are kept even when they become empty.
 */
export function pruneLayout(
  layout: Layout,
  existingIds: Iterable<NodeId>,
  existingEdgeIds?: Iterable<string>,
): PruneResult {
  const keepNodes = new Set(existingIds);
  const keepEdges = existingEdgeIds ? new Set(existingEdgeIds) : undefined;
  const removed = new Set<NodeId>();
  const removedEdges = new Set<string>();
  const next = mapViews(layout, (view) => {
    const nodes = fromEntries(
      Object.entries(view.nodes).filter(([id]) => keepNodes.has(id) || (removed.add(id), false)),
    );
    const out: ViewLayoutOverride = { ...view, nodes };
    if (keepEdges && view.edges) {
      out.edges = fromEntries(
        Object.entries(view.edges).filter(
          ([id]) => keepEdges.has(id) || (removedEdges.add(id), false),
        ),
      );
    }
    return out;
  });
  return {
    layout: next,
    removed: Array.from(removed).sort(compareKeys),
    removedEdges: Array.from(removedEdges).sort(compareKeys),
  };
}

/**
 * The effective layout of a view: the default view ("*") overlaid with the named view.
 * Node and edge entries merge field by field (the named view wins); the viewport comes from the
 * named view if it has one. Unknown view names resolve to the default view. Returns a fresh object.
 * A node that only a named view mentions, without `x`/`y`, has no saved position: the renderer
 * places it (auto-layout) and applies the other fields.
 */
export function mergeViewDefaults(
  layout: Layout,
  viewName: string = DEFAULT_VIEW,
): ViewLayoutOverride {
  const base: ViewLayout | undefined = layout.views[DEFAULT_VIEW];
  const view = viewName === DEFAULT_VIEW ? undefined : layout.views[viewName];
  const out: ViewLayoutOverride = structuredClone(base ?? { nodes: {} });
  if (!view) return out;
  for (const [id, n] of Object.entries(view.nodes))
    setOwn<NodeOverride>(out.nodes, id, { ...out.nodes[id], ...structuredClone(n) });
  if (view.viewport) out.viewport = { ...view.viewport };
  if (view.edges) {
    const edges: Record<string, EdgeLayout> = (out.edges ??= {});
    for (const [id, e] of Object.entries(view.edges))
      setOwn(edges, id, { ...(Object.hasOwn(edges, id) ? edges[id] : {}), ...structuredClone(e) });
  }
  return out;
}

const DETAIL_LEVELS: readonly string[] = ['all', 'keys', 'names'] satisfies DetailLevel[];

function isDetailLevel(v: unknown): v is DetailLevel {
  return typeof v === 'string' && DETAIL_LEVELS.includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The view settings map of `settings`, when it is an object. */
function viewSettingsOf(settings: LayoutSettings | undefined): Record<string, unknown> | undefined {
  const all: unknown = settings?.[VIEW_SETTINGS_KEY];
  return isRecord(all) ? all : undefined;
}

/** `settings` with the view settings map replaced (an empty map removes the key). */
function withViewSettings(layout: Layout, map: Record<string, unknown>): Layout {
  const settings: LayoutSettings = { ...layout.settings };
  if (Object.keys(map).length) settings[VIEW_SETTINGS_KEY] = map as Record<string, ViewSettings>;
  else delete settings[VIEW_SETTINGS_KEY];
  const out: Layout = { ...layout, settings };
  if (Object.keys(settings).length === 0) delete out.settings;
  return out;
}

/**
 * Detail level saved for a view: a named view's own (`settings["x-relvista-view-settings"]`), else
 * the diagram-wide `settings.detailLevel`. Undefined when neither is set (tools then draw 'all').
 * A view without its own level, or an unknown view, gets `settings.detailLevel`.
 */
export function viewDetailLevel(
  layout: Layout | null | undefined,
  viewName: string = DEFAULT_VIEW,
): DetailLevel | undefined {
  const settings = layout?.settings;
  if (!settings) return undefined;
  if (viewName !== DEFAULT_VIEW) {
    const all = viewSettingsOf(settings);
    const entry = all && Object.hasOwn(all, viewName) ? all[viewName] : undefined;
    const own = isRecord(entry) ? entry.detailLevel : undefined;
    if (isDetailLevel(own)) return own;
  }
  return settings.detailLevel;
}

/**
 * The layout with view `viewName`'s own detail level set, or removed with `undefined` (the view
 * then uses `settings.detailLevel`). For the default view ("*") this sets `settings.detailLevel`.
 * Empty objects left behind are removed. Returns `layout` itself when nothing changes.
 */
export function withViewDetailLevel(
  layout: Layout,
  viewName: string,
  level: DetailLevel | undefined,
): Layout {
  if (viewName === DEFAULT_VIEW) {
    const has = !!layout.settings && Object.hasOwn(layout.settings, 'detailLevel');
    if (level === undefined ? !has : layout.settings?.detailLevel === level) return layout;
    const settings: LayoutSettings = { ...layout.settings };
    if (level === undefined) delete settings.detailLevel;
    else settings.detailLevel = level;
    const out: Layout = { ...layout, settings };
    if (Object.keys(settings).length === 0) delete out.settings;
    return out;
  }
  const all = viewSettingsOf(layout.settings) ?? {};
  const entry = Object.hasOwn(all, viewName) ? all[viewName] : undefined;
  const current: Record<string, unknown> = isRecord(entry) ? { ...entry } : {};
  const has = Object.hasOwn(current, 'detailLevel');
  if (isRecord(entry) && (level === undefined ? !has : current.detailLevel === level))
    return layout;
  if (entry === undefined && level === undefined) return layout;
  if (level === undefined) delete current.detailLevel;
  else current.detailLevel = level;
  const next = fromEntries(Object.entries(all).filter(([name]) => name !== viewName));
  if (Object.keys(current).length) setOwn(next, viewName, current);
  return withViewSettings(layout, next);
}

/**
 * The layout with view `oldName`'s own settings (`settings["x-relvista-view-settings"]`) moved to
 * `newName`, replacing what `newName` had, or dropped when `newName` is null (the view was
 * deleted). The `views` entries are not touched. Returns `layout` itself when nothing changes.
 */
export function renameViewSettings(
  layout: Layout,
  oldName: string,
  newName: string | null,
): Layout {
  const all = viewSettingsOf(layout.settings);
  if (!all || !Object.hasOwn(all, oldName) || oldName === newName) return layout;
  const entry = all[oldName];
  const next = fromEntries(
    Object.entries(all).filter(([name]) => name !== oldName && name !== newName),
  );
  if (newName !== null && newName !== DEFAULT_VIEW) setOwn(next, newName, entry);
  return withViewSettings(layout, next);
}
