# 0007 — Frozen diagrams

- Status: accepted (owner, 2026-11-23)
- Date: 2026-11-23
- Source: owner request for 1.1: "When we show a diagram, we need the possibility of showing it
  frozen: we cannot move or re-arrange objects. When the documentation is ready, the diagrams are
  frozen because we already arranged them the best way, so we don't want the user to be able to
  move them. They can highlight, pan, zoom, etc., but not arrange elements. That should be an
  option in the Docusaurus plugin and set by default to frozen. Add a button in the toolbar for
  the user to unlock it, in case they want to play with it."

## Context

In relvista 1.0 every docs diagram is a `DbmlViewer` whose tables, notes and collapsed groups a
reader can drag (`draggable`, default true), and whose groups collapse and expand on a
double-click. Nothing of it is saved: the next page load shows the author's arrangement again.
But a docs author arranges a diagram on purpose (a layout file, or the build-time auto-layout
they checked), and a reader who drags a table by accident, or collapses a group with a stray
double-click, sees a worse picture than the one the author made. On touch screens a finger that
lands on a table to pan moves the table instead.

The existing `draggable={false}` stops drags for good, with no way back for a reader who wants to
rearrange the diagram, and it leaves collapsing on.

## Decision

1. **Renderer.** `DbmlViewer` takes `frozen?: boolean`, default `false`, so the renderer's
   behaviour is unchanged for its users. A frozen viewer starts **locked**: tables, notes and
   groups cannot be moved (pointer, touch or keyboard) and groups cannot be collapsed or expanded
   (double-click or any other path); dragging a table pans the canvas instead. Panning, zooming,
   fit, fullscreen, views, search and paths, focus mode, detail levels, the details card and
   tooltips, export, print, link, "Open in editor" and deep links work as before.
2. **Lock button.** A new toolbar item `'lock'`, in `DEFAULT_TOOLBAR` right after `'fit'`. It shows
   only in a `frozen` viewer whose nodes can be dragged (hidden when `draggable={false}`: there is
   nothing to unlock). It is a toggle button (`aria-pressed` true while locked) labelled
   **Unlock layout** / **Lock layout**, with a padlock / open padlock icon and a title that says
   what a press does. Unlocking is local to the reader and never saved, like drags.
3. **Locking again restores the author's arrangement** (coordinator's decision, kept): the positions
   and collapsed groups of the `layout` prop (plus the build-time positions) come back, local drags
   and local collapses are dropped, and the viewport stays where it is. A reader who wants to
   compare can lock and unlock freely; nothing they did survives a lock, so the locked picture is
   always the author's.
4. **`draggable` keeps working** and wins: `draggable={false}` never shows the lock button, and a
   frozen viewer with it stays locked (no drags, no collapsing). Without `frozen`, `draggable` means
   what it meant in 1.0.
5. **Docusaurus plugin.** `themeConfig.dbml.frozen: boolean`, **default `true`** (owner's choice):
   docs diagrams are frozen unless the site says otherwise. Per diagram, the `frozen` prop of
   `@theme/DbmlDiagram` and `@theme/DbmlDiff` and the fence meta `frozen` / `frozen=false`
   (` ```dbml ` and ` ```dbml-diff `) win over `themeConfig`. `'lock'` is in `TOOLBAR_ITEMS` and in
   the plugin's default toolbar. The build-time static SVG does not depend on `frozen`.
6. **Collapsing counts as rearranging** (owner's choice): a frozen diagram does not collapse or
   expand groups, by double-click or otherwise; the reader unlocks it first.
7. It ships in **relvista 1.1** (owner's choice), as a `minor` change of the renderer (new prop and
   toolbar item) and the plugin (new option, new default).

## Consequences

- **Behaviour change for docs sites.** After upgrading to 1.1, every docs diagram is frozen. Sites
  that want the 1.0 behaviour set `themeConfig.dbml.frozen: false` (or `frozen=false` /
  `frozen={false}` per diagram). The changeset and the plugin README say so.
- A site with its own `themeConfig.dbml.toolbar` list (or a `toolbar` prop) gets frozen diagrams
  without a lock button until it adds `'lock'` to the list: a toolbar list names exactly the
  buttons shown, and this keeps that rule. The docs mention it next to the option.
- React Flow moves nodes with the arrow keys only when they are selected and draggable; viewer
  nodes are never selectable, so the keyboard could not move them in 1.0 either, and locked nodes
  are not draggable at all. Touch drags go through the same drag handler as the mouse, so they
  are blocked by the same switch (checked in the docs e2e with Chromium touch events).
- The canvas carries the lock as an internal prop (`locked` on `DiagramCanvasInternal`, set by
  `DbmlViewer`); `DiagramCanvas`'s public props are unchanged. Locked canvases have
  `data-rv-locked="true"`, and group headers and collapsed cards lose their pointer cursor;
  tables lose the grab cursor because React Flow drops their `draggable` class.
- The toolbar is one button wider. In wide viewers the title chip stops 30 px earlier
  (`calc(100% - 530px)`). At 390 px the narrow toolbar still fits one row for a diagram without
  views; with a view menu it wraps to a second row, as the toolbar is designed to rather than
  overflow (docs/design/phase3-v1.md §13).
- `apps/editor` is unaffected: its canvas is the editable `DiagramCanvas`, which ignores the lock.
- Tests: renderer jsdom tests (`packages/renderer/test/frozen.test.tsx`), plugin tests (option,
  meta, prop and themeConfig precedence, DbmlDiff, static picture unchanged) and docs e2e
  (`apps/docs/e2e/frozen.spec.ts`: drag, double-click, keyboard, touch, pan, zoom, search, unlock,
  lock again, and the `frozen=false` demo on the Usage page).
