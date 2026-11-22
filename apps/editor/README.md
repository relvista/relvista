# relvista editor

The editor website: Monaco DBML editing with a live, editable ER diagram, file-based saving
(File System Access API with a download fallback), share links and exports. Static Vite SPA,
deployed at <https://relvista.org/editor/> inside the docs Pages artifact.

Design and contracts: [`docs/design/phase2-editor.md`](../../docs/design/phase2-editor.md),
decision [0004](../../docs/decisions/0004-editor.md).

## Commands

From the repository root:

```sh
pnpm editor:dev           # builds core + renderer, then http://localhost:5173/editor/
pnpm editor:build         # core + renderer + editor (typecheck + dist/)
pnpm docs:build           # the Pages site: docs, with the editor copied into apps/docs/build/editor/
pnpm test:e2e:editor      # Playwright against that site (run docs:build first)
```

Inside `apps/editor`: `pnpm test` (unit tests, vitest), `pnpm typecheck`, `pnpm build`.

`RELVISTA_EDITOR_BASE=/` serves the app at the root instead of `/editor/`.

## Deployment

The editor has no deployment of its own. `apps/docs` lists it as a dev dependency, so
`pnpm docs:build` builds it first; the docs build then runs `scripts/copy-editor.mjs`, which copies
`dist/` (without source maps) to `apps/docs/build/editor/`. `.github/workflows/deploy-docs.yml`
uploads that one folder to GitHub Pages: the docs at `/`, the editor at `/editor/`.
The docs navbar, the landing page and every docs diagram ("Open in editor") link to it.

## End-to-end tests

`pnpm test:e2e:editor` serves `apps/docs/build` the way GitHub Pages does
(`apps/docs/scripts/serve-site.mjs`) and runs `e2e/` in Chromium at 1360×900, plus `mobile.spec.ts`
at 390×844. Install the browser once with `pnpm --filter relvista-editor exec playwright install
chromium`.

| Spec                  | Covers                                                                                                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roundtrip.spec.ts`   | **Gate:** every example saves byte-identical: 7 BOM/line-ending variants via FSA, 5 via `<input type=file>` + download; the `12-modules` folder                                                                                                                         |
| `adversarial.spec.ts` | **Gate:** tabs, trailing whitespace, unicode, extra newlines, all-at-once with BOM + CRLF; a dbdiagram-style all-features file in 12 variants; edge files (empty, BOM only, lone CR, 20k-char line); 60-undo edit sequences; FSA, `<input>`, drop, `?url=` and a folder |
| `examples.spec.ts`    | every example from the examples picker draws all its tables, no errors                                                                                                                                                                                                  |
| `live-edit.spec.ts`   | typing draws tables; a syntax error keeps the last good diagram; fixing it updates                                                                                                                                                                                      |
| `drag.spec.ts`        | dragging writes integer positions to the sidecar and the exported layout JSON; undo                                                                                                                                                                                     |
| `share.spec.ts`       | share link → new page: same text (byte for byte), positions and view; old links                                                                                                                                                                                         |
| `site.spec.ts`        | docs navbar, landing CTA and gallery "Open in editor" land in the editor                                                                                                                                                                                                |
| `theme.spec.ts`       | theme button, OS theme, persistence shared with the docs                                                                                                                                                                                                                |
| `mobile.spec.ts`      | Code / Diagram tabs, overflow menu, no horizontal scroll                                                                                                                                                                                                                |
| `screenshots.spec.ts` | review screenshots (`RELVISTA_EDITOR_SHOTS=<dir>`, default `test-results/`)                                                                                                                                                                                             |
| `url.spec.ts`         | `?url=` asks only for the file; `&layout` / `&layout=<url>` / the dialog checkbox load a layout; GitHub blob → raw; 404 dialog                                                                                                                                          |
| others                | autolayout, sync, language features, session restore, export, axe                                                                                                                                                                                                       |

`RELVISTA_EDITOR_E2E_SERVER=preview` runs against `vite preview` of `dist/` instead (no docs
build needed); `site.spec.ts` then skips.

## Layout

```text
src/
  App.tsx, main.tsx     shell and bootstrap
  state/                store (useSyncExternalStore), compile, layout history, autosave, renames
  monaco/               setup, DBML language + themes, language services, hover, markers
  files/                byte-exact text handling, File System Access, fallbacks, folders, sidecar, ?url=
  share/                share links (codec lives in @relvista/renderer)
  sql/                  @dbml/core in a module worker (loaded on first SQL use)
  diagram/              DiagramCanvas pane, editor ↔ diagram sync
  components/           top bar, menus, dialogs, split, status bar, mobile tabs
test/                   unit tests (pure modules)
e2e/                    Playwright specs; roundtrip.spec.ts + adversarial.spec.ts are the byte-exact gate
```

## Saving guarantees

An unedited file is written back byte for byte; an edited file keeps its BOM and every unchanged
line's terminator (CRLF, LF, lone CR, mixed). The layout sidecar is written only after a user
layout change. `e2e/roundtrip.spec.ts` checks every example in seven variants through both the
File System Access path and the download fallback; `e2e/adversarial.spec.ts` adds five more
variants (tabs, trailing whitespace, unicode, …), edge files, long edit-and-undo sequences, drops,
`?url=` and folders.

## Remote files (`?url=`)

`?url=<file>` fetches only the `.dbml` file. A layout is fetched only when asked for: `&layout`
(or `&layout=auto`, or the "Also load its layout file" checkbox in Open from URL) tries
`<file>.layout.json` next to it and says nothing if it is missing; `&layout=<url>` (absolute, or
relative to the file) loads that file and warns if it cannot. Probing by default would make every
remote file without a sidecar log a 404 in the console, which no fetch option can hide.

## Licence

The editor is AGPL-3.0-or-later ([LICENSE](LICENSE)); the rest of the repository, including the
`@relvista/*` libraries it uses, is MIT ([decision 0006](../../docs/decisions/0006-licence-split.md)).
If you run a changed copy for other people, offer them its source code. Help links to the source
(`SOURCE` in `src/components/HelpDialog.tsx`); point it at your fork.

## Third-party licences

The build records every npm package it bundles (main bundle and workers) in
`node_modules/.cache/relvista-third-party/editor.json`; `pnpm notices` turns that and the docs
site's list into the root `THIRD_PARTY_NOTICES.md`, which the build ships as
`/editor/THIRD_PARTY_NOTICES.txt` (linked from Help). Licence comments (`/*!`, `@license`)
are kept where they appear in each chunk (`rolldownOptions.output.comments.legal`).
