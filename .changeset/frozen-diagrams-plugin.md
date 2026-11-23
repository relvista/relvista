---
'@relvista/docusaurus-plugin': minor
---

Docs diagrams are now frozen by default: readers see the arrangement you gave them and can pan, zoom, search, highlight, focus and export, but cannot drag tables or collapse groups until they press the new lock button in the toolbar (**Unlock layout**); locking again puts everything back, and nothing is saved. New option `themeConfig.dbml.frozen` (default `true`), `frozen` prop on `@theme/DbmlDiagram` and `@theme/DbmlDiff`, and fence meta `frozen` / `frozen=false` for ` ```dbml ` and ` ```dbml-diff ` fences (per diagram wins). The toolbar item `lock` is in the default toolbar. **To keep the 1.0 behaviour** (tables drag right away, no lock button), set `themeConfig.dbml.frozen: false`, or `frozen=false` on one fence. A site with its own `toolbar` list must add `'lock'` to it for readers to unlock its diagrams. The build-time pictures do not change.
