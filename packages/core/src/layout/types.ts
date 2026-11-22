/** Types for the relvista layout sidecar file (schema.dbml.layout.json), matching schemas/layout.schema.json. */

/** The `$id` of the layout-1 JSON Schema, written as `$schema` into layout files. */
export const LAYOUT_SCHEMA_ID = 'https://relvista.org/schemas/layout-1.json';
/** The layout file format version this package reads and writes. */
export const LAYOUT_VERSION = 1;
/** View key for the default view. Named views inherit node placements from it. */
export const DEFAULT_VIEW = '*';
/** Schema name assumed for tables and enums written without one. */
export const DEFAULT_SCHEMA = 'public';

/**
 * Stable node id: "schema.table", "note:<name>" or "group:<name>". Table-id segments that need it are
 * double-quoted (`a."b.c"`), see `tableIdOf`.
 */
export type NodeId = string;
/** Edge id as produced by the diagram model. */
export type RefId = string;

/** A point in diagram units. */
export interface Point {
  x: number;
  y: number;
}

/** The saved position (and optional size, pin and collapse state) of one table, note or group. */
export interface NodeLayout {
  x: number;
  y: number;
  /** Width override; omitted means use the measured width. */
  w?: number;
  /** Height override; omitted means use the measured height. */
  h?: number;
  collapsed?: boolean;
  /** Auto-layout must not move this node. */
  pinned?: boolean;
}

/** Pan and zoom of a view: the diagram point at the top-left corner, and the zoom factor. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A side of a table box. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Saved routing hints of one ref: waypoints and the sides its ends attach to. */
export interface EdgeLayout {
  waypoints?: Point[];
  sourceSide?: Side;
  targetSide?: Side;
}

/** Node entry of a named view: only the fields that differ from the default view. */
export type NodeOverride = Partial<NodeLayout>;

/** A named view. Its entries merge field by field over the default view (`mergeViewDefaults`). */
export interface ViewLayoutOverride {
  nodes: Record<NodeId, NodeOverride>;
  viewport?: Viewport;
  edges?: Record<RefId, EdgeLayout>;
}

/** The default view ("*"): every node entry has a position. */
export interface ViewLayout extends ViewLayoutOverride {
  nodes: Record<NodeId, NodeLayout>;
}

/** Views by name: the default view ("*") holds full positions, named views hold overrides. */
export type LayoutViews = Record<string, ViewLayoutOverride> & { [DEFAULT_VIEW]?: ViewLayout };

/** How much of each table is drawn: every column, keys only, or the table name only. */
export type DetailLevel = 'all' | 'keys' | 'names';

/** Display preferences a layout file may carry for the tools that open it. */
export interface ThemeHints {
  colorScheme?: 'light' | 'dark' | 'auto';
  showGrid?: boolean;
  edgeStyle?: 'orthogonal' | 'curved' | 'straight';
}

/**
 * Extension key in `settings` that holds per-view display settings (`ViewSettings` by view name).
 * relvista 1.0 keeps `x-` keys unread, so files that use it still load there.
 */
export const VIEW_SETTINGS_KEY = 'x-relvista-view-settings';

/** Display settings of one named view; what it leaves out comes from the layout's `settings`. */
export interface ViewSettings {
  /** Detail level of this view. Overrides `settings.detailLevel`. */
  detailLevel?: DetailLevel;
}

/** Display settings shared by every view of a layout file. */
export interface LayoutSettings {
  /** Detail level of the default view, and of named views without their own. */
  detailLevel?: DetailLevel;
  theme?: ThemeHints;
  /**
   * Settings of named views by view name ("*" is not allowed: the default view uses these
   * settings). Read with `viewDetailLevel`, write with `withViewDetailLevel`.
   */
  [VIEW_SETTINGS_KEY]?: Record<string, ViewSettings>;
  /** Extension keys ("x-…") for third-party tools. */
  [extension: `x-${string}`]: unknown;
}

/** A layout file (`schema.dbml.layout.json`, format layout-1): everything DBML cannot store. */
export interface Layout {
  $schema?: string;
  version: 1;
  views: LayoutViews;
  settings?: LayoutSettings;
  /** Extension keys ("x-…") for third-party tools. */
  [extension: `x-${string}`]: unknown;
}

/** One problem found by `parseLayout`. */
export interface LayoutError {
  /** JSON Pointer to the offending value ("" for the root). */
  path: string;
  message: string;
}

/** What `parseLayout` returns: the validated layout, or the errors found. */
export type ParseLayoutResult = { ok: true; layout: Layout } | { ok: false; errors: LayoutError[] };
