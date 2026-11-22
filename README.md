<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-dark.svg">
    <img src="brand/logo-light.svg" alt="relvista" width="280">
  </picture>
</h1>

[![CI](https://github.com/relvista/relvista/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/relvista/relvista/actions/workflows/ci.yml)
[![@relvista/docusaurus-plugin on npm](https://img.shields.io/npm/v/%40relvista%2Fdocusaurus-plugin?label=%40relvista%2Fdocusaurus-plugin)](https://www.npmjs.com/package/@relvista/docusaurus-plugin)
[![@relvista/renderer on npm](https://img.shields.io/npm/v/%40relvista%2Frenderer?label=%40relvista%2Frenderer)](https://www.npmjs.com/package/@relvista/renderer)
[![@relvista/core on npm](https://img.shields.io/npm/v/%40relvista%2Fcore?label=%40relvista%2Fcore)](https://www.npmjs.com/package/@relvista/core)
[![Licence: MIT and AGPL-3.0](https://img.shields.io/badge/licence-MIT%20%2B%20AGPL--3.0-2f6fed)](#licence)

Open-source entity-relationship diagrams from [DBML](https://dbml.dbdiagram.io/) — the same language
dbdiagram.io uses.

- **[Editor](https://relvista.org/editor/)** — open a `.dbml` file or folder,
  edit it with a live diagram, arrange tables, save it back byte for byte. Static site, no account,
  no backend.
- **Docusaurus plugin** — `plugins: ['@relvista/docusaurus-plugin']` renders ` ```dbml ` code fences
  and `.dbml` files in your docs with zoom, pan, fullscreen, print and export. It only adds
  diagrams; your site keeps its own theme and styling.
- **Core libraries** — `@relvista/core` (parser wrapper, diagram model, layout file, auto-layout)
  and `@relvista/renderer` (SVG, viewer, editable canvas, export), usable in any React 18 or 19 app.

> Status: **1.0 is out** ([announcement](https://relvista.org/blog/relvista-1-0)); install with
> `npm install @relvista/docusaurus-plugin`.
> Editor: <https://relvista.org/editor/> ·
> Docs and live gallery: <https://relvista.org/>

## Editor

Monaco DBML editing (diagnostics, completion, hover, go to definition, quick fixes) next to a live,
editable diagram: drag tables, notes and groups, pin, collapse, auto-layout, per-view layouts, undo.
Files are yours: open a file or a whole folder (multi-file `use` projects), save straight back with
the File System Access API (Chromium) or as downloads elsewhere. An unedited file saves back
byte for byte, and an edited one keeps its BOM and line endings; table positions go to a
`schema.dbml.layout.json` sidecar only when you move something. Share links carry the schema, layout
and view in the URL hash; export to SVG, PNG, print/PDF, DBML, layout JSON or SQL; import from SQL.
Every diagram in the docs has an "Open in editor" button. See the
[editor docs](https://relvista.org/docs/editor) and
[`apps/editor`](apps/editor/README.md).

## Principles

- `.dbml` stays 100% compatible with dbdiagram.io: a file valid there opens here unchanged and saves
  back unchanged apart from what you edit. Parsing uses `@dbml/parse`, Holistics' open-source DBML
  parser.
- Anything DBML cannot express (table positions, per-view layout) lives in a sidecar
  `schema.dbml.layout.json`, versioned by a [JSON Schema](schemas/layout.schema.json).
- One renderer draws the same picture in the editor, in the docs, and in exports.

## Repository layout

```text
apps/
  editor/              Vite SPA: the editor, deployed at /editor/ (phase 2)
  docs/                Docusaurus site: project docs + live demo of the plugin; its build includes the editor
packages/
  core/                @relvista/core: parse, model, layout file, auto-layout
  renderer/            @relvista/renderer: SVG components, viewer, editable canvas, export, share links
  docusaurus-plugin/   @relvista/docusaurus-plugin: adds DBML diagrams to a Docusaurus site (phase 1)
examples/              sample .dbml files used by tests and docs
schemas/               layout.schema.json
brand/                 logo, icons and their generator
docs/decisions/        decision records
docs/releasing.md      how versions and npm releases work (Changesets, release.yml)
```

## Development

```sh
nvm use          # Node 24 (22.22.2+ / 24.15+ for the dev tooling)
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm validate:examples
pnpm editor:dev       # the editor, http://localhost:5173/editor/
pnpm docs:start       # docs site with the plugin, http://localhost:3000/
pnpm docs:build       # the whole Pages site: docs + editor in apps/docs/build/
pnpm test:e2e         # docs + editor + docs-compat e2e, after `pnpm build`;
                      # needs `pnpm --filter relvista-docs exec playwright install chromium`
```

## Credits

The interactive viewer is built on [React Flow](https://reactflow.dev) by xyflow (MIT); the editor
uses [Monaco](https://microsoft.github.io/monaco-editor/) (MIT). Auto-layout
uses [ELK](https://eclipse.dev/elk/) (elkjs, used under EPL-2.0) and [dagre](https://github.com/dagrejs/dagre);
DBML parsing uses [@dbml/parse](https://github.com/holistics/dbml) (Apache-2.0).
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists every package bundled into the editor and the
docs site, with its licence ([on the site](https://relvista.org/third-party-notices)).
Regenerate it after dependency changes with `pnpm build && pnpm notices`; CI fails when it is stale.

relvista is an independent open-source project, not affiliated with Holistics or dbdiagram.io.
DBML is an open-source language by Holistics.

Brand: logo, colours and fonts are in [brand/README.md](brand/README.md).

## Licence

**relvista** uses two licences, by directory:

| Directory                                                                         | Licence                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------- |
| `packages/core`, `packages/renderer`, `packages/docusaurus-plugin` (npm)          | [MIT](LICENSE)                           |
| `apps/docs`, `docs`, `examples`, `schemas`, `scripts` and everything else         | [MIT](LICENSE)                           |
| `apps/editor` (the editor at [relvista.org/editor](https://relvista.org/editor/)) | [AGPL-3.0-or-later](apps/editor/LICENSE) |

The libraries are MIT so you can use them in any docs site or product. The editor is AGPL: if you
run a changed copy of it for other people, you must offer them its source code. See
[decision 0006](docs/decisions/0006-licence-split.md).
