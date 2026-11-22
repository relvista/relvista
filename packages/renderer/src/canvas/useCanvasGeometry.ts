/**
 * Geometry of the canvas: the synchronous (dagre) layout at once, then the ELK result when some
 * visible node has no saved position and core's `needsElk` says the 'auto' engine would load ELK
 * for them (docs/design/phase3-v1.md §3.3). Saved positions always win. Stability in the editable
 * canvas comes from the caller reporting the placements as saved positions ('place' changes),
 * after which this hook has nothing left to lay out.
 */
import {
  collapsedGroupIds,
  needsElk,
  type DetailLevel,
  type DiagramGeometry,
  type DiagramModel,
  type LayoutOptions,
  type ViewLayout,
  type ViewLayoutOverride,
} from '@relvista/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutAsync, layoutSync } from '../geometry.js';

/** ELK runs after the first one wait this long, so superseded runs never start (ms). */
export const RELAYOUT_DEBOUNCE_MS = 150;

function hasSavedPosition(saved: ViewLayoutOverride | null, id: string): boolean {
  if (!saved || !Object.hasOwn(saved.nodes, id)) return false;
  const n = saved.nodes[id]!;
  return Number.isFinite(n.x) && Number.isFinite(n.y);
}

/**
 * Visible nodes without a saved position (model order: notes, then tables). A collapsed group
 * (core §3.1) stands for its members: they are skipped and the group id is listed (after the
 * tables) when the group has no position itself.
 */
export function unplacedIds(model: DiagramModel, saved: ViewLayoutOverride | null): string[] {
  const collapsed = collapsedGroupIds(model, saved as Partial<ViewLayout> | null);
  const out: string[] = [];
  for (const n of model.stickyNotes) if (!hasSavedPosition(saved, n.id)) out.push(n.id);
  for (const t of model.tables) {
    if (t.groupId && collapsed.has(t.groupId)) continue;
    if (!hasSavedPosition(saved, t.id)) out.push(t.id);
  }
  for (const g of model.groups)
    if (collapsed.has(g.id) && !hasSavedPosition(saved, g.id)) out.push(g.id);
  return out;
}

export function hasAllPositions(model: DiagramModel, saved: ViewLayoutOverride | null): boolean {
  if (!saved) return false;
  return unplacedIds(model, saved).length === 0;
}

/** The laid-out box of a node id: a table or note, or a collapsed group's box. */
export function placedBox(
  geometry: DiagramGeometry,
  id: string,
): { x: number; y: number; width: number; height: number } | undefined {
  if (Object.hasOwn(geometry.nodes, id)) return geometry.nodes[id];
  const g = Object.hasOwn(geometry.groups, id) ? geometry.groups[id] : undefined;
  return g?.collapsed ? g : undefined;
}

/**
 * Sync (dagre) geometry first, then the async (ELK, engine 'auto') result when it arrives. With
 * `allowElk: false` (diff mode, §4.3 rule 7) the sync layout is final.
 */
export function useCanvasGeometry(
  model: DiagramModel | null,
  saved: ViewLayoutOverride | null,
  detailLevel: DetailLevel,
  aspectRatio: number | undefined,
  workerUrl?: string | URL,
  allowElk = true,
): { geometry: DiagramGeometry | null; final: boolean } {
  const options = useMemo<LayoutOptions>(
    () => ({
      detailLevel,
      saved: saved as Partial<ViewLayout> | null,
      ...(aspectRatio ? { aspectRatio } : {}),
    }),
    [detailLevel, saved, aspectRatio],
  );
  const runs = useRef(0);
  const sync = useMemo(() => (model ? layoutSync(model, options) : null), [model, options]);
  const [late, setLate] = useState<{
    for: DiagramGeometry;
    geometry: DiagramGeometry | null;
  } | null>(null);
  // Nothing for ELK to do: every node is placed, or the 'auto' engine would place the rest with
  // dagre anyway (the sync layout then is the final one, and ELK is never loaded).
  const complete = useMemo(() => {
    if (!model) return false;
    if (!allowElk || hasAllPositions(model, saved)) return true;
    try {
      return !needsElk(model, options);
    } catch {
      return false;
    }
  }, [model, saved, options, allowElk]);
  useEffect(() => {
    if (!model || !sync || complete) return;
    let alive = true;
    const run = () => {
      let p: Promise<DiagramGeometry> | null;
      try {
        p = layoutAsync(model, { ...options, engine: 'auto', ...(workerUrl ? { workerUrl } : {}) });
      } catch {
        p = null;
      }
      p?.then(
        (geometry) => {
          if (alive) setLate({ for: sync, geometry });
        },
        () => {
          // keep the sync layout
          if (alive) setLate({ for: sync, geometry: null });
        },
      );
      if (!p) setLate({ for: sync, geometry: null });
    };
    // The first layout starts at once; later ones (typing in an editor, switching views quickly)
    // wait a moment so superseded ELK runs are never started.
    const t = runs.current++ === 0 ? null : setTimeout(run, RELAYOUT_DEBOUNCE_MS);
    if (!t) run();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [model, sync, complete, options, workerUrl]);
  const done = !!late && late.for === sync;
  const final = !sync || !model || complete || done;
  return { geometry: (done ? late.geometry : null) ?? sync, final };
}
