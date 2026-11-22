# Tooling

| Concern      | Tool                                                                           | Config                                  |
| ------------ | ------------------------------------------------------------------------------ | --------------------------------------- |
| Packages     | pnpm 9.15 workspace (`apps/*`, `packages/*`)                                   | `pnpm-workspace.yaml`, `packageManager` |
| Node         | Node 24 (dev tooling: 22.22.2+ or 24.15+; published packages: >= 20)           | `.nvmrc`, `engines`                     |
| Types        | TypeScript strict, ESM, `NodeNext`                                             | `tsconfig.base.json`                    |
| Formatting   | Prettier 3                                                                     | `.prettierrc.json`, `.prettierignore`   |
| Linting      | ESLint 9 flat config + `typescript-eslint` (non-type-checked recommended)      | `eslint.config.js`                      |
| Tests        | Vitest                                                                         | per package                             |
| Releases     | Changesets (`fixed` group), npm trusted publishing ([releasing](releasing.md)) | `.changeset/config.json`, `release.yml` |
| CI           | GitHub Actions on GitHub-hosted `ubuntu-latest`                                | `.github/workflows/ci.yml`              |
| Dependencies | Dependabot: npm weekly (`@dbml/*` grouped, exact pins kept), actions monthly   | `.github/dependabot.yml`                |

CI order: install (`--frozen-lockfile`) → `format:check` → schema sync check → `lint` → `build` → `packages:check` →
`notices:check` → `typecheck` → `test` → `validate:examples` → `test:e2e` (docs, editor, docs-compat). `deploy-docs.yml`
publishes `apps/docs` to GitHub Pages on every push to `main`; `release.yml` opens the version pull request or publishes
to npm ([releasing.md](releasing.md)). Contributor-facing details are in [CONTRIBUTING.md](../CONTRIBUTING.md).
