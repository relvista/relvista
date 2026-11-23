---
'@relvista/renderer': minor
---

Frozen diagrams: `DbmlViewer` takes a `frozen` prop (default `false`, so nothing changes unless you set it). A frozen viewer starts with its layout locked: tables, notes and groups cannot be dragged (pointer, touch or keyboard) and groups cannot be collapsed or expanded, while panning, zooming, search, paths, focus, detail levels, export and links work as usual. The new toolbar item `'lock'` (in `DEFAULT_TOOLBAR`, after `'fit'`; shown only when `frozen` is set and `draggable` is not `false`) unlocks the layout for the reader, and locking it again puts back the arrangement of `layout` without moving the view. Nothing is saved. `draggable={false}` still wins: no lock button, never movable.
