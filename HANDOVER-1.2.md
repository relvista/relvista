# relvista after 1.1: handover

_Not for merging: this branch only carries the handover note. Read it with
`git show origin/handover/1.2:HANDOVER-1.2.md`._

Written 2026-11-23, after the 1.1.0 release. `main` is the only branch besides this one; it is
green on Linux and Windows CI, and there are no open pull requests or issues.

## State

- **Released: 1.1.0** of `@relvista/core`, `@relvista/renderer` and `@relvista/docusaurus-plugin`
  (npm, published from `release.yml` with provenance; GitHub releases and tags
  `@relvista/*@1.1.0`). Docs at https://relvista.org (deployed from `main`). Install:
  `npm install @relvista/docusaurus-plugin@^1.1.0`. What is in it: the three `CHANGELOG.md` files.
- **1.1 in one line each:** per-view detail level (`settings["x-relvista-view-settings"]`, any
  value accepted like every `x-` key); PDF text in Greek, Cyrillic, extended Latin, Chinese and
  Japanese stays text (embedded font subsets, loaded on demand); dagre row post-pass and
  `AUTO_DAGRE_MAX_NODES = 4` (decision 0003, re-measurement 2026-11-22); pages without diagrams
  load no diagram code (size check in the docs e2e); faster canvas on very large schemas (600-table
  budgets in phase3-v1 §7); **frozen diagrams** (decision 0007); Windows support in CI.
- **Frozen diagrams:** in the Docusaurus plugin diagrams start frozen
  (`themeConfig.dbml.frozen: true`): readers pan, zoom, search, highlight, focus and export, but
  cannot drag tables or collapse groups until they press the toolbar's lock button ("Unlock
  layout"); locking again restores the authored arrangement. Opt out with
  `themeConfig.dbml.frozen: false` or `frozen=false` on one fence / `frozen={false}` on a
  component. A site with its own `toolbar` list must name `'lock'` for the button to show. In the
  renderer, `DbmlViewer` has a `frozen` prop (default `false`).
- **Licences:** the renderer's `license` is `MIT AND OFL-1.1 AND Apache-2.0` (it ships the PDF
  fonts; the merged CJK font is OFL-1.1 as a whole, Droid glyphs keep their Apache notices). The
  others are MIT; `apps/editor` is AGPL (decision 0006).

## Owner decisions to keep (2026-11-22/23)

- Docusaurus peer range stays `^3.6.0`. A **fresh** install of Docusaurus 3.0–3.10.0 does not
  build with today's webpack, relvista or not (webpackbar 6); getting-started and the plugin
  README document the way out (3.10.1+, `@docusaurus/faster`, or `"overrides": { "webpack":
"5.95.0" }`).
- Frozen by default; frozen also blocks collapse/expand of groups; re-lock restores the layout.
- Accepted as they are: the lock button makes the phone toolbar wrap to two rows on diagrams with
  a view menu; custom `toolbar` lists show only what they name.
- Left for later on purpose: the view re-frames when ELK's final layout arrives after the reader
  already navigated (search pick, pan); editing a `static/` `.dbml` in `docusaurus start`
  recompiles but does not refresh the page (imported `.dbml` files hot-reload).

## Backlog for 1.2

1. **Lazy layout validator** (owner: for 1.2). ajv + fast-uri are about 50 KB gz of every diagram
   page (a fifth of the vendor chunk). Needs a core change: move `parseLayout`'s validation behind
   a dynamic import, or precompile the validator. Measure with `apps/docs/e2e/bundle.spec.ts` and
   lower its ceiling afterwards.
2. **Large schemas, still open** (phase3-v1 §13, 600-table note): `@dbml/parse`'s completion
   provider re-parses on the main thread (~180 ms per keystroke at 600 tables; the 300-table test
   only caps long tasks at 200/250 ms though §7 says 50); the first compile on open runs on the
   main thread; Chrome layerization makes drag frames ~55 ms and hovers 50–110 ms at 600 tables;
   the first drag that selects a table costs ~190 + 120 ms; §7's 14-large drag-frame row has no
   test.
3. **PDF fonts, review leftovers:** the tests check extracted text and the three `/FontName`s,
   not rendered glyphs (checked by eye once in Chrome's PDF viewer); Hangul is not covered (stays
   an image); subset names have no `ABCDEF+` tag (some PDF/A checkers want one).
4. **dagre post-pass limits:** area (c) now decides the threshold; a table pulled equally two ways
   stays put; lining up rows can make a component taller (up to 2.3× in dense random schemas).
5. **Bundle:** the MDX `code` hook (~0.5 KB gz) is on every page by design; a site that never
   imports `@theme/DbmlDiagram` keeps the theme code in the `relvista-fence` chunk.
6. **Small quirk:** collapsing a group while unlocked drops the reader's other drags (as in 1.0).
7. Optional: a macOS CI job (Linux and Windows are covered); revisit the `^3.6.0` peer range when
   Docusaurus < 3.10.1 fades.

## How to continue on any computer

```sh
git clone https://github.com/relvista/relvista && cd relvista
nvm install 24 && corepack enable   # pnpm 9.15 from packageManager
pnpm install --frozen-lockfile
pnpm --filter relvista-docs exec playwright install chromium
git show origin/handover/1.2:HANDOVER-1.2.md
```

Windows: `corepack enable` needs an elevated shell, or use
`corepack enable pnpm --install-directory <folder on PATH>`; set
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0` for scripted runs; `.gitattributes` keeps LF checkouts. Git
worktrees with `node_modules` can exceed the path limit when removed: delete the folder with
PowerShell `Remove-Item -LiteralPath '\\?\<path>' -Recurse -Force`.

Full gate, each as `pnpm <step>`: `install --frozen-lockfile`, `build`, `lint`, `format:check`,
`typecheck`, `test`, `validate:examples`, `notices:check`, `packages:check`, then
`test:e2e:docs`, `test:e2e:editor` (its perf project runs last; run it on a quiet machine),
`test:e2e:compat`; plus `node schemas/sync-schema.mjs --check`. Everything passes on Windows and
Linux at `main`.

## Releasing 1.2 (what bit us in 1.1)

1. Every change to a published package carries a changeset; merging to `main` makes `release.yml`
   open the **chore(release): version packages** PR (`changeset-release/main`).
2. That PR is opened by GitHub Actions, so **CI does not run on it by itself**: start it with
   `gh workflow run CI --ref changeset-release/main` and check the run's commit is the PR head.
3. Merging it publishes from `release.yml` with npm trusted publishing (OIDC). Each package's
   trusted publisher on npmjs.com (`relvista` / `relvista` / `release.yml`, no environment) must
   have the **npm publish** permission: with only "npm stage publish" the job failed with
   `E403 … OIDC permission denied for this action`. Fixed and validated on 2026-11-23. If a
   publish "succeeds" but the version does not appear, look for a staged version awaiting
   approval on npmjs.com.
4. npmjs.com asks for the owner's 2FA (security key / passkey) to change package settings;
   Windows Hello may fail there, use the phone or another 2FA method.
5. After publishing: `npm view @relvista/<pkg> dist-tags` shows the new `latest`, and
   `npm view @relvista/<pkg>@<v> dist.attestations` shows the provenance.

## Notes

- Branch hygiene: after a release only `main` is kept. Don't force-push shared branches; rewrite
  only unpushed history.
- relvista.org was registered on 2026-11-21: some company firewalls and antivirus web filters block
  newly registered domains, which shows as "this site can't provide a secure connection" even
  though the site is fine (checked from outside on 2026-11-23).
- Background: `docs/design/phase3-v1.md` (§7 budgets, §13 notes), `docs/decisions/` (0001–0007),
  `docs/releasing.md`, `CONTRIBUTING.md`.

Prompt for Claude Code next time: "Continue relvista: read
`git show origin/handover/1.2:HANDOVER-1.2.md` and ask me which backlog item to take on."
