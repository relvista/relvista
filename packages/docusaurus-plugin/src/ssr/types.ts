// Browser-safe types of the build-time static diagrams (docs/design/phase3-v1.md §5.1).
import type { CompileInput, DetailLevel, Layout } from '@relvista/core';
import type { DiffRequest } from '../theme/DbmlDiff/build.js';
import type { DiffResult } from '../theme/DbmlDiff/server.js';

/** What the server needs to draw one diagram. */
export interface StaticRequest {
  /** `staticKey` of the props; also the id prefix inside the SVG. */
  key: string;
  /** Inline DBML (or a multi-file project). */
  value?: CompileInput;
  /** Path of a `.dbml` file in the site's static directories (used when `value` is absent). */
  src?: string;
  /** Parsed layout file, or the path of one in the site's static directories. */
  layout?: Layout | string | null;
  view?: string;
  /** The prop / fence meta; the view's saved level (`viewDetailLevel`) and then the default apply without it. */
  detailLevel?: DetailLevel;
  defaultDetailLevel: DetailLevel;
  title?: string;
  height: number | string;
  palette: 'site' | 'relvista';
  /** The viewer's `minimap` prop ('auto' or off). */
  minimap: 'auto' | false;
}

/** The JSON script next to the static SVG: the build-time layout, for the interactive viewer. */
export interface SsrPayload {
  v: 1;
  /** View the positions belong to (`*` = the default view). */
  view: string;
  /** Top-left corner of every table, sticky note and collapsed group. */
  positions: Record<string, { x: number; y: number }>;
  /** Group boxes (collapsed groups are cards). */
  groups: Record<string, { x: number; y: number; width: number; height: number; collapsed?: true }>;
}

export type StaticResult =
  | { kind: 'ok'; html: string; payload: SsrPayload }
  /** The DBML or a file is broken: the Problem markup, and one build warning. */
  | { kind: 'error'; message: string }
  /** Not drawn at build time (remote file, too large): the loading placeholder. */
  | { kind: 'skip'; reason: string | null };

export type SiteFile = { ok: true; text: string } | { ok: false; message: string };

/** The server side of `relvista-ssr-files`: null in the browser bundle. */
export interface SsrBackend {
  /** A file of the site's static directories by its URL path (`/layouts/x.json`). */
  readSiteFile(path: string): SiteFile;
  /** Never rejects: failures come back as `error` or `skip` results. */
  renderStatic(request: StaticRequest): Promise<StaticResult>;
  /** The static schema diff of `@theme/DbmlDiff` (§5.3). Never rejects. */
  renderDiff?(request: DiffRequest): Promise<DiffResult>;
}

/** Static SVG markup above this size is not inlined (placeholder + warning). */
export const MAX_STATIC_BYTES = 1.5 * 1024 * 1024;
