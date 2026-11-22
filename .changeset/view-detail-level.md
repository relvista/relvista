---
'@relvista/core': minor
'@relvista/renderer': minor
'@relvista/docusaurus-plugin': minor
---

Per-view detail level. A layout file can give a named view its own detail level under
`settings["x-relvista-view-settings"]` (an extension key, so relvista 1.0 still loads these files).
Core adds `viewDetailLevel`, `withViewDetailLevel`, `renameViewSettings`, `VIEW_SETTINGS_KEY` and the
`ViewSettings` type, and the layout schema validates the key. `DbmlViewer` and `DiagramCanvas` start
each view at its saved level (the `detailLevel` prop and the toolbar still override it), and
`DbmlViewer` takes a new `defaultDetailLevel` prop. Docs diagrams with `view=` draw the view's level,
at build time too.
