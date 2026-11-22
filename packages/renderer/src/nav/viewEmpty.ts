import { DEFAULT_VIEW, selectView, type DiagramModel } from '@relvista/core';

/**
 * True when `view` of `model` draws nothing (no tables and no sticky notes): a PDF page of it would
 * be blank. '*' is the whole model; an unknown view name is not empty (it shows all tables).
 */
export function isViewEmpty(model: DiagramModel, view: string): boolean {
  const m = view === DEFAULT_VIEW ? model : (selectView(model, view) ?? model);
  return m.tables.length === 0 && m.stickyNotes.length === 0;
}
