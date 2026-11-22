# Releasing

`@relvista/core`, `@relvista/renderer` and `@relvista/docusaurus-plugin` are released together:
one version number for all three (a Changesets [`fixed`](https://changesets.dev/guide/fixed-packages)
group in `.changeset/config.json`), published to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements) by
[`.github/workflows/release.yml`](../.github/workflows/release.yml). The apps are private and never
published.

- [How a release works](#how-a-release-works)
- [One-time setup (owner)](#one-time-setup-owner): GitHub setting, npm organisation, the first
  publish by hand, trusted publishers
- [Troubleshooting](#troubleshooting)

## How a release works

1. A pull request that changes a published package adds a changeset (`pnpm changeset`, see
   [CONTRIBUTING.md](../CONTRIBUTING.md#changesets)). Because the group is fixed, a bump of any one
   package bumps all three to the same version.
2. On every push to `main`, `release.yml` (job **Version or publish?**) finds the changesets and
   opens or updates the pull request **chore(release): version packages** from the branch
   `changeset-release/main`. It runs `pnpm version-packages`: `changeset version` (new versions,
   `packages/*/CHANGELOG.md`, deletes the changesets) and Prettier on those files.
3. Review that pull request. GitHub does not run workflows for pull requests opened by GitHub
   Actions, so run CI by hand: **Actions → CI → Run workflow**, branch `changeset-release/main`.
4. Merge it. `release.yml` now finds no changesets but a version that is not on npm. Its
   **Publish to npm** job builds the packages, runs `pnpm packages:check` (publint, arethetypeswrong,
   relvista's packaging rules) and `changeset publish`: `pnpm publish` of each package in dependency
   order, authenticated with npm trusted publishing (OIDC, no token) and with a provenance
   statement. It then pushes the git tags (`@relvista/core@1.2.0`, …) and creates a GitHub release
   per package from its changelog.

The workflow never runs on forks (`if: github.repository == 'relvista/relvista'`), asks for
`id-token: write` only in the publish job, and pins `changesets/action` to a commit.

## One-time setup (owner)

Do these once, in this order. Steps 1 and 2 can happen any time before the first release.

### 1. Let GitHub Actions open pull requests

GitHub → repository **Settings → Actions → General → Workflow permissions**: tick **Allow GitHub
Actions to create and approve pull requests** and save. Without it the version job fails with
"GitHub Actions is not permitted to create or approve pull requests".

### 2. Create the npm organisation `relvista`

1. Sign in on [npmjs.com](https://www.npmjs.com) with the account that will own the packages.
   Turn on two-factor authentication (**Account → Two-Factor Authentication**) if it is not on;
   npm requires it to publish.
2. Avatar menu → **Add Organization**. Name: `relvista`. Plan: **Unlimited public packages**
   (free). Skip inviting members.

The organisation owns the `@relvista` scope; nothing else needs configuring there.

### 3. Publish 1.0.0 by hand

npm configures a trusted publisher on a package's settings page, so a package has to exist before
the workflow can publish it. The first version is therefore published from your machine.

1. Merge the release preparation into `main`. `release.yml` opens **chore(release): version
   packages**, which bumps all three packages to `1.0.0` and writes their `CHANGELOG.md`. Run CI on
   its branch (see above), then merge it.
2. `release.yml` runs again and skips publishing with the warning **Not published**:
   `@relvista/core` is not on npm yet. That is expected.
3. On your machine:

   ```sh
   git checkout main && git pull
   nvm use && corepack enable
   pnpm install --frozen-lockfile
   npm login                      # the account that owns the relvista organisation
   pnpm release:first --dry-run   # every check, then `npm publish --dry-run`; uploads nothing
   pnpm release:first             # publishes 1.0.0; npm asks for your 2FA code or opens the browser
   git push origin --tags         # @relvista/core@1.0.0, @relvista/renderer@1.0.0, …
   ```

`pnpm release:first` ([`scripts/first-publish.mjs`](../scripts/first-publish.mjs)) refuses to run
unless the three versions are equal and not `0.0.0`, no changeset is pending, the checkout is a
clean `main`, you are logged in and the version is not on npm yet. It builds the packages, runs
`pnpm packages:check`, then packs and publishes core, renderer and the plugin in that order and
creates the git tags with `changeset git-tag`.

Why not `pnpm changeset publish`: every package has `publishConfig.provenance: true`, and npm
refuses provenance outside a CI provider ("Automatic provenance generation not supported for
provider: null"). Only a command-line flag overrides `publishConfig`, and `changeset publish`
passes none, so the script publishes each packed tarball with `npm publish --no-provenance`. The
consequence: **1.0.0 has no provenance statement**; every later version, published by the
workflow, has one. (To give 1.0.0 one too, see [the token alternative](#alternative-first-release-from-ci-with-a-token).)

### 4. Add the trusted publisher to each package

For **each** of `@relvista/core`, `@relvista/renderer` and `@relvista/docusaurus-plugin`:
[npmjs.com](https://www.npmjs.com) → the package → **Settings** → **Trusted Publisher** →
**GitHub Actions**, and enter

| Field                       | Value         |
| --------------------------- | ------------- |
| Organization or user        | `relvista`    |
| Repository                  | `relvista`    |
| Workflow filename           | `release.yml` |
| Environment name (optional) | leave empty   |

Then, still in **Settings → Publishing access**, choose **Require two-factor authentication and
disallow tokens**: from now on only the workflow (through OIDC) and you (with 2FA) can publish.

### 5. Announce

- Create a GitHub release for 1.0 (the workflow creates them from 1.0.1 on), for example
  `gh release create "@relvista/docusaurus-plugin@1.0.0" --verify-tag --title "relvista 1.0" --notes-file packages/docusaurus-plugin/CHANGELOG.md`.
- Publish the announcement post: in `apps/docs/blog/<date>-relvista-1-0.md` delete the
  `unlisted: true` line (and rename the file to the release date), delete `feedOptions: { type: null }`
  from the blog options in `apps/docs/docusaurus.config.ts` (it turns the RSS and Atom feeds back
  on), and add a **Blog** item to the
  navbar in `apps/docs/docusaurus.config.ts` if you want one. The npm version badges in `README.md`
  start working by themselves; replace the README status line.

### Alternative: first release from CI with a token

Instead of step 3 you can let the workflow publish 1.0.0, which then gets a provenance statement:
create a [granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens) with
read and write access to packages, the `relvista` organisation selected and **Bypass two-factor
authentication** ticked; save it as the repository secret `NPM_TOKEN` (**Settings → Secrets and
variables → Actions**) before merging the version pull request. The workflow sees the secret and
publishes. Then do step 4, delete the secret and revoke the token. npm is phasing out publishing
with 2FA-bypass tokens, so this path may no longer be available when you read this.

`release.yml` keeps `NPM_TOKEN` as a fallback after 1.0 as well: when the secret is set and OIDC
cannot be used, npm uses the token. With step 4's "disallow tokens" setting the token cannot
publish, which is the point.

## Troubleshooting

- **"Not published" warning on a push to `main`**: no `@relvista/core` on npm and no `NPM_TOKEN`.
  Do [step 3](#3-publish-100-by-hand).
- **Publish fails with `E404` / `ENEEDAUTH` / "Unable to authenticate"**: the trusted publisher of
  that package is missing or does not match exactly (owner `relvista`, repository
  `relvista`, workflow `release.yml`, no environment). Fix it on npmjs.com and re-run the failed
  job. Packages already published in that run are skipped on the re-run.
- **No version pull request appears**: check step 1, and that the changeset names a published
  package (`pnpm changeset status`).
- **npm version in the publish job**: it installs npm 11 on purpose. Trusted publishing needs
  npm 11.5.1 or later, and `changeset publish` calls `pnpm publish --no-git-checks`; pnpm 9 passes
  that flag on to `npm publish`, which npm 12 rejects as unknown. Move to npm 12 together with a
  pnpm upgrade.
- **A release went out with a mistake**: publish a fixed patch version (add a changeset, merge
  the version pull request). `npm deprecate @relvista/core@x.y.z "reason"` marks a bad version;
  `npm unpublish` is only allowed within 72 hours and should be the last resort.
