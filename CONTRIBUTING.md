# Contributing to relvista

Thanks for helping. relvista uses two licences: `apps/editor` is AGPL-3.0-or-later
([apps/editor/LICENSE](apps/editor/LICENSE)), everything else is MIT ([LICENSE](LICENSE)). By
contributing you agree your work is released under the licence of the directory it changes. A change
to both gets each directory's licence for its part.

Logo, colours and fonts: [brand/README.md](brand/README.md).

## Setup

Requirements: Node 24 (see `.nvmrc`; 22.22.2+ or 24.15+ also work, as vitest 5 and jsdom 31 need
them) and pnpm 9.15 (pinned through `packageManager`, so `corepack enable` picks the right
version). The published packages themselves still support Node >= 20.

```sh
nvm use
corepack enable
pnpm install
```

Linux, macOS and Windows all work. On Windows, `corepack enable` writes next to `node.exe` and
needs an elevated shell; without one, put the shims in a folder on your `PATH` instead:
`corepack enable pnpm --install-directory <folder>`. `.gitattributes` checks every text file out
with LF whatever `core.autocrlf` says, as Prettier and the byte-exact tests expect.

## Scripts

Run from the repository root:

| Script                   | What it does                                          |
| ------------------------ | ----------------------------------------------------- |
| `pnpm build`             | Build every package that has a `build` script         |
| `pnpm typecheck`         | `tsc --noEmit` in every package                       |
| `pnpm test`              | Run the Vitest suites                                 |
| `pnpm lint`              | ESLint (flat config, `typescript-eslint` recommended) |
| `pnpm format`            | Format everything with Prettier                       |
| `pnpm format:check`      | Check formatting without writing                      |
| `pnpm validate:examples` | Parse every file in `examples/` and validate layouts  |
| `pnpm packages:check`    | Pack the published packages and lint the tarballs     |
| `pnpm license:sync`      | Copy `LICENSE` into every published package           |
| `pnpm changeset`         | Describe a change to a published package              |
| `pnpm version-packages`  | Apply changesets: versions and changelogs (CI only)   |
| `pnpm release:first`     | The one-time manual first publish (owner only)        |

CI runs `format:check`, `lint`, `build`, `packages:check`, `notices:check`, `typecheck`, `test`,
`validate:examples` and the e2e suites on every push and pull request to `main`, on Linux, and all
of them but `lint` and `typecheck` on Windows too. Run them locally before you open a pull request.

To work on one package: `pnpm --filter @relvista/core test`.

## Code style

- TypeScript strict, ESM only, `NodeNext` module resolution: relative imports end in `.js`.
- Prettier decides formatting (single quotes, 100 columns, trailing commas). Do not argue with it.
- Exact pins for `@dbml/*`: their output defines compatibility, so upgrades are deliberate and
  tested against `examples/`.

## DBML compatibility rule

relvista must never change a user's `.dbml` file beyond the edit they made. A file that is valid on
dbdiagram.io opens here unchanged and saves back byte-identical apart from the edited span:
comments, whitespace, ordering, quoting and unknown settings are preserved. Anything DBML cannot
express goes in the sidecar `schema.dbml.layout.json`, never in the `.dbml`. Changes that touch
saving must include a round-trip test.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(core): resolve composite foreign keys
fix(renderer): keep edge labels inside the viewport
docs: explain the layout sidecar
chore(deps): bump @dbml/parse to 12.2.0
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`. Scopes are
package or app names (`core`, `renderer`, `docusaurus-plugin`, `editor`, `docs`).

## Packaging

Three packages are published to npm: `@relvista/core`, `@relvista/renderer` and
`@relvista/docusaurus-plugin` (everything in `apps/` is private). `pnpm packages:check`
(`scripts/check-packages.mjs`, also a CI step) runs `pnpm pack` for each of them after
`pnpm build`, then on each tarball:

- [publint](https://publint.dev) in strict mode: errors, warnings and suggestions all fail;
- [arethetypeswrong](https://github.com/arethetypeswrong/arethetypeswrong.github.io) with
  `--profile esm-only`. The packages are **ESM only** by design: `exports` offers `types`,
  `import` and `default`, no `require`, so the CommonJS resolution modes are not checked. Every
  entry point is checked, the stylesheet exports (`./styles.css`, `./xyflow.css`) too: they carry
  empty `.d.ts` stubs under a `types` condition (written by the renderer's `copy-css.mjs`), so
  `import '@relvista/renderer/styles.css'` type-checks under `noUncheckedSideEffectImports`;
- relvista's own rules: `README.md` and a `LICENSE` identical to the root one; no tests; no
  `src/` except the plugin's `src/theme/` (Docusaurus' `getTypeScriptThemePath`, used by
  `swizzle --typescript`); no source maps or declaration maps; no build configs; no `workspace:`
  ranges left in the packed `package.json`; no open-ended peer range (`>=`, `*`); the metadata
  below;
- a tarball size ceiling per package (128 KB for core and the plugin, 2.5 MB for the renderer,
  which carries the PDF export's lazily loaded fonts).

`--list` prints every file of every tarball, `--keep` keeps them in the temporary directory.
Nothing is published by it: releases go through `.github/workflows/release.yml`
([Releasing](#releasing)).

Rules for the packages' `package.json`, kept by `packages:check`:

- `type: module`, `exports` with `types` first, then `import` and `default`; a `./package.json`
  export; `main` and `types` for old resolvers; `sideEffects` (`false` for core, `**/*.css` for
  the renderer and the plugin); `files` lists only build output plus `README.md` and `LICENSE`.
- `license`, `author`, `repository` (with `directory`), `homepage`, `bugs`, `keywords`,
  `engines.node >=20`, `publishConfig: { access: 'public', provenance: true }`. `version` is only
  ever changed by Changesets (the version pull request).
- **Exact pins** for every runtime dependency whose behaviour shapes output: `@dbml/parse`,
  `elkjs`, `@dagrejs/dagre`, `@xyflow/react`, `jspdf`, `svg2pdf.js` and `ajv` (layout file
  validation). Upgrade them deliberately, in their own pull request.
- **Peer ranges name what is tested**, never `>=`: `react`/`react-dom` `^18.0.0 || ^19.0.0`,
  Docusaurus `^3.6.0`, `prism-react-renderer` `^2.0.0`. React 18 matters in the code: it drops a
  `ref` prop on function components, so a component that exposes a handle uses `forwardRef`
  (React 19's ref-as-prop alone breaks under 18). Before widening a range, test it from the packed
  tarballs in a scratch consumer (see [docs/releasing.md](docs/releasing.md)).
- A new entry point is added to `exports` **and** checked: keep `pnpm packages:check` green.

**Source maps: off in published builds.** Each package's `tsconfig.build.json` sets
`sourceMap: false` and `declarationMap: false`, since maps would point at `src/`, which is not
published. (The plugin's `src/theme/` ships for swizzling only; its `lib/` has no maps either.)
Builds start by deleting `dist/` (`lib/` for the plugin), so files of deleted sources never reach
a tarball. In the workspace, editors resolve the packages through their `.d.ts` files.

**Internal exports stay out of the published types.** `@relvista/core` builds with
`stripInternal`: a module-level export tagged `@internal` (used across files inside the package,
not part of its API) is left out of the `.d.ts` files. Use it for anything typed with
`@dbml/parse`'s own types: their declarations import `monaco-editor-core`, which consumers do not
have, so a consumer with `skipLibCheck: false` would get errors from them.

**LICENSE: committed copies.** npm only packs files inside the package folder, so
`packages/{core,renderer,docusaurus-plugin}/LICENSE` are committed copies of the root `LICENSE`.
After changing the root file run `pnpm license:sync`; `packages:check` fails while a copy differs.
`apps/editor/LICENSE` is different on purpose: the editor is AGPL-3.0-or-later (decision 0006), and
`packages:check` fails if that file or the editor's `license` field stops saying so.

## Changesets

Published packages are versioned with [Changesets](https://github.com/changesets/changesets). If
your pull request changes the behaviour or API of a published `@relvista/*` package, run
`pnpm changeset`, choose the bump, write a one-line summary for users (it becomes the changelog
entry), and commit the generated file. Docs, tests, CI and the private apps do not need one.

The three packages form a `fixed` group: they always share one version, so a changeset for any of
them bumps all three. Follow [semver](https://semver.org/) as promised in the
[API reference](https://relvista.org/docs/reference): a removed or renamed
export, an incompatible signature or a `layout-1` change is a `major`; new exports, options and
props are `minor`; fixes are `patch`.

## Releasing

Maintainers do not publish by hand. `.github/workflows/release.yml` opens a **version packages**
pull request whenever changesets are merged to `main`; merging that pull request publishes the new
version to npm with trusted publishing and provenance, tags it and creates GitHub releases.
[docs/releasing.md](docs/releasing.md) explains the flow, the one-time setup the owner does on
GitHub and npmjs.com (the `relvista` npm organisation, the first publish by hand with
`pnpm release:first`, a trusted publisher per package) and what to do when a release fails.

## Pull requests

- Keep them focused; one concern per pull request.
- Fill in the template checklist.
- For a bug, include the DBML snippet that triggers it, ideally as a test fixture.

## Reporting bugs

Open an issue with the bug template and include the smallest DBML snippet that reproduces the
problem, plus whether it works on dbdiagram.io.
