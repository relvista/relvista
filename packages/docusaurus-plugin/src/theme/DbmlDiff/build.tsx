// The static picture of a schema diff (docs/design/phase3-v1.md §5.3): both versions merged
// (`mergeForDiff`), laid out, and drawn with the diff tones. Run at build time (through
// ./server.tsx, part of the server bundle only); in the browser only the change list is computed
// here (after a client-side navigation), loaded lazily with the viewer chunk.
import {
  DEFAULT_VIEW,
  compileDbml,
  diffModels,
  formatDiff,
  layoutDiagramSync,
  mergeForDiff,
  mergeViewDefaults,
  parseLayout,
  selectView,
  viewDetailLevel,
  type CompileInput,
  type DetailLevel,
  type DiagramGeometry,
  type DiagramModel,
  type Layout,
  type ModelDiff,
  type ViewLayout,
} from '@relvista/core';
import { DiagramSvg, diffDecorations, diffLegend, type Decorations } from '@relvista/renderer';
import type { ReactElement } from 'react';
import {
  FrameStyle,
  boxFrame,
  payloadOf,
  placedGeometry,
  positionsOf,
  type PreparedStatic,
} from '../../ssr/build.js';
import type { SsrBackend, SsrPayload } from '../../ssr/types.js';
import { missingMessage, type DiffChanges } from './changes.js';

/** What the server needs to draw one diff. */
export interface DiffRequest {
  key: string;
  old?: CompileInput;
  new?: CompileInput;
  oldSrc?: string;
  newSrc?: string;
  layout?: Layout | string | null;
  view?: string;
  detailLevel?: DetailLevel;
  defaultDetailLevel: DetailLevel;
  title?: string;
  height: number | string;
  palette: 'site' | 'relvista';
  minimap: 'auto' | false;
}

export interface DiffStatic {
  prepared: PreparedStatic;
  geometry: DiagramGeometry;
  decorations: Decorations;
  /** Whether the viewer shows its legend chip (something changed): it moves the first view. */
  chips: boolean;
  payload: SsrPayload;
  changes: DiffChanges;
}

export type DiffBuild =
  | { kind: 'ok'; value: DiffStatic }
  | { kind: 'error'; message: string }
  | { kind: 'skip'; reason: string | null };

/**
 * What a diff build needs from the server backend: its file reader, and the ELK layout it runs
 * outside the Docusaurus bundle when it offers one (without it the diff is laid out with dagre,
 * synchronously, in the bundle).
 */
export type DiffBackend = Pick<SsrBackend, 'readSiteFile'> & {
  layoutDiagram?: (
    model: DiagramModel,
    options: { engine: 'elk'; detailLevel: DetailLevel; saved: Partial<ViewLayout> | null },
  ) => Promise<DiagramGeometry>;
};

const isRemote = (path: string) => /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//');

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The compiled model, or the first error as "<label> has errors: 3:5 …". */
export function compileVersion(
  source: CompileInput,
  label: string,
): { ok: true; model: DiagramModel } | { ok: false; message: string } {
  const compiled = compileDbml(source);
  const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
  if (compiled.model && !errors.length) return { ok: true, model: compiled.model };
  const first = errors[0];
  const where = first
    ? `${typeof source === 'string' ? '' : `${first.file ?? ''}:`}${first.start.line}:${first.start.column} `
    : '';
  return {
    ok: false,
    message: `${label} has errors: ${where}${first?.message ?? 'no diagram to show'}`,
  };
}

/** `formatDiff` as a list of lines and counts. */
export function changesOf(diff: ModelDiff): DiffChanges {
  const lines = diff.empty ? [] : formatDiff(diff).split('\n').slice(1);
  return { summary: { ...diff.summary }, lines };
}

/** The change list of two versions (browser, after a client-side navigation); null on errors. */
export function changesOfSources(before: CompileInput, after: CompileInput): DiffChanges | null {
  const b = compileVersion(before, 'The old version');
  const a = compileVersion(after, 'The new version');
  if (!b.ok || !a.ok) return null;
  return changesOf(diffModels(b.model, a.model));
}

/** Builds the static diff. Never rejects: failures come back as `error` or `skip`. */
export async function buildDiff(backend: DiffBackend, request: DiffRequest): Promise<DiffBuild> {
  try {
    const read = (
      value: CompileInput | undefined,
      src: string | undefined,
      which: 'old' | 'new',
    ): { ok: true; source: CompileInput } | { ok: false; result: DiffBuild } => {
      if (value !== undefined) return { ok: true, source: value };
      if (!src) return { ok: false, result: { kind: 'error', message: missingMessage(which) } };
      if (isRemote(src)) return { ok: false, result: { kind: 'skip', reason: null } };
      const file = backend.readSiteFile(src);
      if (file.ok) return { ok: true, source: file.text };
      return {
        ok: false,
        result: { kind: 'error', message: `Could not load ${src}: ${file.message}` },
      };
    };
    const oldSource = read(request.old, request.oldSrc, 'old');
    if (!oldSource.ok) return oldSource.result;
    const newSource = read(request.new, request.newSrc, 'new');
    if (!newSource.ok) return newSource.result;

    let layout: Layout | null = null;
    if (request.layout !== undefined && request.layout !== null) {
      let input: unknown = request.layout;
      if (typeof request.layout === 'string') {
        if (isRemote(request.layout)) return { kind: 'skip', reason: null };
        const file = backend.readSiteFile(request.layout);
        if (!file.ok)
          return { kind: 'error', message: `Could not load ${request.layout}: ${file.message}` };
        try {
          input = JSON.parse(file.text);
        } catch (err) {
          return {
            kind: 'error',
            message: `Invalid layout file ${request.layout}: ${messageOf(err)}`,
          };
        }
      }
      const parsed = parseLayout(input);
      if (!parsed.ok)
        return {
          kind: 'error',
          message: `Invalid layout file: ${parsed.errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`,
        };
      layout = parsed.layout;
    }

    const before = compileVersion(oldSource.source, 'The old version');
    if (!before.ok) return { kind: 'error', message: before.message };
    const after = compileVersion(newSource.source, 'The new version');
    if (!after.ok) return { kind: 'error', message: after.message };
    const diff = diffModels(before.model, after.model);
    const merged = mergeForDiff(before.model, after.model, diff);

    // The view as the viewer picks it: a name the new version does not declare shows everything.
    const asked = request.view ?? DEFAULT_VIEW;
    const known = asked === DEFAULT_VIEW || merged.views.some((v) => v.name === asked);
    const view = known ? asked : DEFAULT_VIEW;
    const model = view === DEFAULT_VIEW ? merged : (selectView(merged, view) ?? merged);
    const prepared: PreparedStatic = {
      model,
      view,
      saved: layout ? mergeViewDefaults(layout, view) : null,
      detailLevel:
        request.detailLevel ?? viewDetailLevel(layout, view) ?? request.defaultDetailLevel,
      edgeStyle: layout?.settings?.theme?.edgeStyle ?? 'orthogonal',
    };
    const options = {
      detailLevel: prepared.detailLevel,
      saved: prepared.saved as Partial<ViewLayout> | null,
    };
    let positions: SsrPayload['positions'] = {};
    if (model.tables.length || model.stickyNotes.length) {
      const first = backend.layoutDiagram
        ? await backend.layoutDiagram(model, { engine: 'elk', ...options })
        : layoutDiagramSync(model, { engine: 'dagre', ...options });
      positions = positionsOf(first);
    }
    const geometry = placedGeometry(prepared, positions);
    return {
      kind: 'ok',
      value: {
        prepared,
        geometry,
        decorations: diffDecorations(diff),
        chips: diffLegend(diff).length > 0,
        payload: payloadOf(view, geometry),
        changes: changesOf(diff),
      },
    };
  } catch (err) {
    return { kind: 'error', message: `This diff could not be rendered: ${messageOf(err)}` };
  }
}

export interface DiffBoxProps {
  value: DiffStatic;
  title?: string | undefined;
  height: number | string;
  palette: 'site' | 'relvista';
  minimap: 'auto' | false;
  idPrefix: string;
}

/**
 * The static diff box: `StaticBox` of ssr/build.tsx (same frame, so `client/static.css` places it
 * like the viewer's first view) with the diff decorations.
 */
export function DiffBox(props: DiffBoxProps): ReactElement {
  const { value, title, height, palette } = props;
  const { prepared, geometry: g } = value;
  const b = g.bounds;
  const empty = !(b.width > 0 && b.height > 0);
  // The viewer shows its legend chip whenever something changed.
  const frame = boxFrame({ ...props, prepared, geometry: g, chips: value.chips });
  return (
    <div
      className={`relvista-static-box${palette === 'site' ? ' rv-palette-site' : ''}`}
      data-rv-color-mode="light"
      data-rv-diff="true"
      data-rv-fixed-height={typeof height === 'number' ? '' : undefined}
      data-rv-frame={frame.css ? props.idPrefix : undefined}
      style={frame.style}
    >
      <FrameStyle css={frame.css} />
      <div className="relvista-static-grid" aria-hidden="true" />
      {title ? (
        <div className="rv-title" title={title}>
          {title}
        </div>
      ) : null}
      {empty ? (
        <div className="relvista-static-empty">
          {prepared.view !== DEFAULT_VIEW
            ? `The view “${prepared.view}” has no tables.`
            : 'No tables yet.'}
        </div>
      ) : (
        <DiagramSvg
          model={prepared.model}
          geometry={g}
          detailLevel={prepared.detailLevel}
          edgeStyle={prepared.edgeStyle}
          padding={0}
          background={false}
          width="100%"
          height="100%"
          title={title ?? 'Schema diff'}
          idPrefix={props.idPrefix}
          decorations={value.decorations}
        />
      )}
    </div>
  );
}
