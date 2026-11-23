/**
 * Views manager logic (design phase3 §6.7), pure: what a view lists as written, the `ViewOp`s the
 * manager sends to `syncViews`, and how the layout's `views[name]` entries follow a rename or a
 * delete. The store applies them; `test/views.test.ts` covers them without Monaco.
 */
import { Compiler, Filepath, MemoryProjectLayout } from '@dbml/parse';
import {
  DEFAULT_VIEW,
  renameViewSettings,
  type DiagramModel,
  type DiagramView,
  type Layout,
} from '@relvista/core';
import type { ViewOp } from '../edits/dbmlEdits.js';

/** What a DiagramView lists, as the editor dialog shows it. */
export interface ViewDefinition {
  /** `Tables { * }` (or `TableGroups { * }` / `Schemas { * }`): every table. */
  allTables: boolean;
  /** Table ids listed in `Tables { … }`. */
  tables: string[];
  /** Group ids (`group:<name>`) listed in `TableGroups { … }`. */
  groups: string[];
  /** Schema names listed in `Schemas { … }`. */
  schemas: string[];
  /** `Notes { * }`. */
  allNotes: boolean;
  /** Note ids (`note:<name>`) listed in `Notes { … }`. */
  notes: string[];
}

export const EMPTY_DEFINITION: ViewDefinition = {
  allTables: false,
  tables: [],
  groups: [],
  schemas: [],
  allNotes: false,
  notes: [],
};

/** Names DBML accepts for a view without quoting. */
export const VIEW_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why `name` cannot be used for a view (or null). `current`: the view being renamed. */
export function viewNameProblem(
  name: string,
  views: readonly Pick<DiagramView, 'name'>[],
  current?: string,
): string | null {
  const n = name.trim();
  if (!n) return 'Enter a name.';
  if (!VIEW_NAME_RE.test(n)) return 'Use letters, digits and _ (not starting with a digit).';
  if (n === DEFAULT_VIEW) return 'This name is reserved.';
  const clash = views.some((v) => v.name !== current && v.name.toLowerCase() === n.toLowerCase());
  return clash ? 'A view with this name already exists.' : null;
}

/** `view_1`, `view_2`, …: the first name no view has (any case). */
export function nextViewName(views: readonly Pick<DiagramView, 'name'>[], base = 'view'): string {
  const taken = new Set(views.map((v) => v.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const name = `${base}_${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Views whose name contains every word of `query` (any case), in model order. */
export function filterViews<T extends { name: string }>(views: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...views];
  return views.filter((v) => words.every((w) => v.name.toLowerCase().includes(w)));
}

/** Whether the switcher shows its filter field. */
export const VIEW_FILTER_MIN = 8;

type Named = { name: string };
interface ParsedEntities {
  tables: Array<{ name: string; schemaName: string }> | null;
  stickyNotes: Named[] | null;
  tableGroups: Named[] | null;
  schemas: Named[] | null;
}

/**
 * The view's lists as written in `file` (read through `@dbml/parse`, never rewritten here), or a
 * definition derived from the compiled view when the parser cannot tell.
 */
export function viewDefinition(
  files: Record<string, string>,
  model: DiagramModel,
  name: string,
): ViewDefinition {
  const view = model.views.find((v) => v.name === name);
  if (!view) return { ...EMPTY_DEFINITION };
  const parsed = parsedEntities(files, view.span.file, name);
  if (!parsed) return definitionFromView(view);
  // Tables, TableGroups and Schemas are one dimension: once one lists items, the parser reports
  // the others as `[]`, which then means "nothing", not "all" (as in edits/dbmlEdits.ts).
  const dim = [parsed.tables, parsed.tableGroups, parsed.schemas];
  const listing = dim.some((d) => d !== null && d.length > 0);
  const all = (d: unknown[] | null) => d !== null && d.length === 0 && !listing;
  const tableId = (t: { name: string; schemaName: string }) =>
    model.tables.find((x) => x.name === t.name && x.schema === (t.schemaName || 'public'))?.id ??
    null;
  return {
    allTables: all(parsed.tables) || all(parsed.tableGroups) || all(parsed.schemas),
    tables: (parsed.tables ?? []).map(tableId).filter((id): id is string => id !== null),
    groups: (parsed.tableGroups ?? []).map((g) => `group:${g.name}`),
    schemas: (parsed.schemas ?? []).map((s) => s.name),
    allNotes: parsed.stickyNotes !== null && parsed.stickyNotes.length === 0,
    notes: (parsed.stickyNotes ?? []).map((n) => `note:${n.name}`),
  };
}

function parsedEntities(
  files: Record<string, string>,
  file: string,
  name: string,
): ParsedEntities | null {
  try {
    const abs: Record<string, string> = {};
    for (const [k, t] of Object.entries(files)) abs[`/${k.replace(/^\/+/, '')}`] = t;
    const compiler = new Compiler(new MemoryProjectLayout(abs));
    const db = compiler.interpretFile(Filepath.from(`/${file.replace(/^\/+/, '')}`)).getValue();
    const view = db?.diagramViews.find((v) => v.name === name);
    if (!view) return null;
    const ve = view.visibleEntities;
    return {
      tables: ve.tables
        ? ve.tables.map((t) => ({ name: t.name, schemaName: t.schemaName ?? 'public' }))
        : null,
      stickyNotes: ve.stickyNotes ? ve.stickyNotes.map((n) => ({ name: n.name })) : null,
      tableGroups: ve.tableGroups ? ve.tableGroups.map((g) => ({ name: g.name })) : null,
      schemas: ve.schemas ? ve.schemas.map((s) => ({ name: s.name })) : null,
    };
  } catch {
    return null;
  }
}

/** Fallback: the resolved lists of the compiled view (exact tables, no groups or schemas). */
function definitionFromView(view: DiagramView): ViewDefinition {
  return {
    allTables: view.allTables,
    tables: view.allTables ? [] : [...view.tableIds],
    groups: [],
    schemas: [],
    allNotes: view.allNotes,
    notes: view.allNotes ? [] : [...view.noteIds],
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Whether the visible-entity part of two definitions differs. */
export function contentChanged(a: ViewDefinition, b: ViewDefinition): boolean {
  if (a.allTables !== b.allTables || a.allNotes !== b.allNotes) return true;
  if (!a.allNotes && !sameSet(a.notes, b.notes)) return true;
  if (a.allTables) return false;
  return (
    !sameSet(a.tables, b.tables) || !sameSet(a.groups, b.groups) || !sameSet(a.schemas, b.schemas)
  );
}

/** The ViewOp fields that write a whole definition. */
function definitionFields(
  d: ViewDefinition,
): Pick<ViewOp, 'tables' | 'notes' | 'groups' | 'schemas'> {
  return d.allTables
    ? { tables: '*', groups: [], schemas: [], notes: d.allNotes ? '*' : [...d.notes] }
    : {
        tables: [...d.tables],
        groups: [...d.groups],
        schemas: [...d.schemas],
        notes: d.allNotes ? '*' : [...d.notes],
      };
}

/** A new view `name` showing `d`. */
export function createOp(name: string, d: ViewDefinition): ViewOp {
  return { op: 'create', name: name.trim(), ...definitionFields(d) };
}

/**
 * The update for the Edit view… dialog: only what changed (a rename alone leaves the lists' text
 * untouched), or null when nothing did.
 */
export function updateOp(
  name: string,
  before: ViewDefinition,
  newName: string,
  after: ViewDefinition,
): ViewOp | null {
  const renamed = newName.trim() !== name;
  const changed = contentChanged(before, after);
  if (!renamed && !changed) return null;
  return {
    op: 'update',
    name,
    ...(renamed ? { newName: newName.trim() } : {}),
    ...(changed ? definitionFields(after) : {}),
  };
}

/** The definition of a new view made from selected node ids (tables, groups, notes). */
export function definitionFromSelection(
  model: DiagramModel,
  ids: readonly string[],
): ViewDefinition {
  const set = new Set(ids);
  return {
    ...EMPTY_DEFINITION,
    tables: model.tables.filter((t) => set.has(t.id)).map((t) => t.id),
    groups: model.groups.filter((g) => set.has(g.id)).map((g) => g.id),
    notes: model.stickyNotes.filter((n) => set.has(n.id)).map((n) => n.id),
  };
}

/** Node ids a view shows (resolved). */
function shown(model: DiagramModel, name: string): Set<string> {
  const v = model.views.find((x) => x.name === name);
  return new Set(v ? [...v.tableIds, ...v.noteIds, ...v.groupIds] : []);
}

/**
 * Adds tables, groups and notes to view `name` (Node menu ▸ Add to view). Tables a view already
 * shows (through `*`, a group or a schema) and notes of an all-notes view are skipped. Null when
 * nothing changes.
 */
export function addToViewOp(
  model: DiagramModel,
  d: ViewDefinition,
  name: string,
  ids: readonly string[],
): ViewOp | null {
  const visible = shown(model, name);
  const add = definitionFromSelection(model, ids);
  const tables = add.tables.filter((id) => !visible.has(id) && !d.tables.includes(id));
  const groups = add.groups.filter((id) => !d.groups.includes(id));
  const notes = d.allNotes ? [] : add.notes.filter((id) => !d.notes.includes(id));
  const op: ViewOp = { op: 'update', name };
  if (!d.allTables && tables.length) op.tables = [...d.tables, ...tables];
  if (!d.allTables && groups.length) op.groups = [...d.groups, ...groups];
  if (notes.length) op.notes = [...d.notes, ...notes];
  return op.tables || op.groups || op.notes ? op : null;
}

/**
 * Removes tables, groups and notes from view `name` (Node menu ▸ Remove from view). A table the
 * view shows through `*`, a group or a schema turns the view into an explicit table list (the
 * only way to hide one table); a removed group hides its tables too. Null when nothing changes.
 */
export function removeFromViewOp(
  model: DiagramModel,
  d: ViewDefinition,
  name: string,
  ids: readonly string[],
): ViewOp | null {
  const view = model.views.find((v) => v.name === name);
  if (!view) return null;
  const drop = definitionFromSelection(model, ids);
  const dropTables = new Set(drop.tables);
  for (const gid of drop.groups)
    for (const t of model.groups.find((g) => g.id === gid)?.tableIds ?? []) dropTables.add(t);
  const op: ViewOp = { op: 'update', name };
  const hidden = view.tableIds.filter((id) => dropTables.has(id));
  if (hidden.length) {
    const viaOther =
      d.allTables ||
      hidden.some((id) => !d.tables.includes(id)) ||
      drop.groups.some((g) => d.groups.includes(g));
    if (viaOther) {
      op.tables = view.tableIds.filter((id) => !dropTables.has(id));
      op.groups = [];
      op.schemas = [];
    } else op.tables = d.tables.filter((id) => !dropTables.has(id));
  }
  const dropNotes = drop.notes.filter((id) => view.noteIds.includes(id));
  if (dropNotes.length) {
    const base = d.allNotes ? view.noteIds : d.notes;
    op.notes = base.filter((id) => !dropNotes.includes(id));
  }
  return op.tables || op.notes ? op : null;
}

/**
 * The layout after view ops: a renamed view's `views[old]` entry moves to the new name (replacing
 * nothing that exists), a deleted view's entry goes; its own settings (detail level) follow the
 * same way. Same object when nothing changes.
 */
export function layoutAfterViewOps(layout: Layout | null, ops: readonly ViewOp[]): Layout | null {
  if (!layout) return layout;
  let views = layout.views;
  let out = layout;
  for (const op of ops) {
    const renamed = op.op === 'update' && !!op.newName && op.newName !== op.name;
    if (op.op !== 'delete' && !renamed) continue;
    out = renameViewSettings(out, op.name, renamed ? op.newName! : null);
    if (!Object.hasOwn(views, op.name)) continue;
    const next = { ...views };
    const entry = next[op.name]!;
    delete next[op.name];
    if (renamed) next[op.newName!] = entry;
    views = next;
  }
  if (views === layout.views) return out;
  return { ...out, views };
}

/** The open view after ops: follows a rename, falls back to all tables when deleted. */
export function viewAfterOps(view: string, ops: readonly ViewOp[]): string {
  let v = view;
  for (const op of ops) {
    if (op.name !== v) continue;
    if (op.op === 'delete') v = DEFAULT_VIEW;
    else if (op.op === 'update' && op.newName) v = op.newName;
  }
  return v;
}
