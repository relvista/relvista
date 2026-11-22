// `pnpm release:first`: the one-time, manual first publish of the @relvista/* packages
// (docs/releasing.md). Later releases are published by .github/workflows/release.yml with npm
// trusted publishing; npm only lets you configure a trusted publisher on a package that exists.
//
// Why not `pnpm changeset publish`: every package has `publishConfig.provenance: true` (so CI
// releases always carry provenance), and npm refuses `provenance` outside a supported CI provider
// ("Automatic provenance generation not supported for provider: null"). Only a command-line flag
// overrides `publishConfig`, and `changeset publish` passes none. So this script packs each
// package with `pnpm pack` (which turns `workspace:*` into the real version) and publishes the
// tarball with `npm publish <tarball> --no-provenance`, in dependency order, then runs
// `changeset git-tag` for the git tags. (`pnpm publish` is not used: pnpm 9 forwards its own flags
// such as `--no-git-checks` to npm, which npm 12 rejects.)
//
//   node scripts/first-publish.mjs             check, then publish (asks for your npm 2FA)
//   node scripts/first-publish.mjs --dry-run   check and run `npm publish --dry-run` (no upload)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLISHED_PACKAGES } from './copy-license.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
// --otp=123456 passes an authenticator code to npm (for shells without a TTY, where npm cannot
// wait for browser 2FA). npm accepts the same code for each package while it is still valid.
const otp = process.argv.find((a) => a.startsWith('--otp='))?.slice('--otp='.length);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  return r;
}

function fail(message) {
  console.error(`\nrelease:first: ${message}`);
  process.exit(1);
}

const manifests = PUBLISHED_PACKAGES.map((dir) => ({
  dir,
  pkg: JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')),
}));

// 1. The versions come from the merged "Version Packages" pull request: equal, not 0.0.0, and no
//    changeset left to apply.
const versions = new Set(manifests.map((m) => m.pkg.version));
if (versions.size !== 1) fail(`the packages have different versions (${[...versions].join(', ')})`);
const [version] = versions;
if (version === '0.0.0')
  fail('the packages are still at 0.0.0: merge the "Version Packages" pull request first');
const pending = readdirSync(join(root, '.changeset')).filter(
  (f) => f.endsWith('.md') && f !== 'README.md',
);
if (pending.length) fail(`unreleased changesets in .changeset/: ${pending.join(', ')}`);

// 2. A clean checkout of main (skipped for --dry-run).
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
const dirty = run('git', ['status', '--porcelain']).stdout.trim();
if (!dryRun) {
  if (branch !== 'main') fail(`on branch ${branch}; check out main`);
  if (dirty) fail('the working tree has changes; commit or stash them');
} else if (branch !== 'main' || dirty) {
  console.warn(`(dry run: branch ${branch}${dirty ? ', uncommitted changes' : ''})`);
}

// 3. Logged in to npm, and this version not fully published yet.
if (!dryRun) {
  const who = run('npm', ['whoami']);
  if (who.status !== 0) fail('not logged in to npm: run `npm login` first');
  console.log(`npm user: ${who.stdout.trim()}`);
}
// Some already published means an interrupted run: the loop below skips those. All of them
// published means the first release is done.
const published = manifests.filter(({ pkg }) => {
  const view = run('npm', ['view', `${pkg.name}@${pkg.version}`, 'version']);
  return view.status === 0 && view.stdout.trim() === pkg.version;
});
if (published.length === manifests.length)
  fail(`${version} is already on npm; later releases go through release.yml`);

// 4. Fresh build output, checked the way npm will see it (publint, arethetypeswrong, own rules).
for (const [cmd, args] of [
  ['pnpm', ['--filter', './packages/*', 'build']],
  ['pnpm', ['packages:check']],
]) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = run(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed`);
}

// 5. Pack, then publish the tarballs in dependency order. stdio is inherited so npm can ask for
//    the one-time password or open the browser for 2FA.
const packDir = mkdtempSync(join(tmpdir(), 'relvista-release-'));
try {
  for (const { dir, pkg } of manifests) {
    // Re-running after a partial publish: skip what is already on the registry.
    const seen = run('npm', ['view', `${pkg.name}@${pkg.version}`, 'version']);
    if (!dryRun && seen.status === 0 && seen.stdout.trim() === pkg.version) {
      console.log(`\n${pkg.name}@${pkg.version} is already published; skipping.`);
      continue;
    }
    const dest = mkdtempSync(join(packDir, `${dir}-`));
    const packed = run('pnpm', ['pack', '--pack-destination', dest], {
      cwd: join(root, 'packages', dir),
    });
    const tarball = readdirSync(dest).find((f) => f.endsWith('.tgz'));
    if (packed.status !== 0 || !tarball) fail(`pnpm pack failed in packages/${dir}`);
    const args = ['publish', join(dest, tarball), '--access', 'public', '--no-provenance'];
    if (dryRun) args.push('--dry-run');
    if (otp) args.push(`--otp=${otp}`);
    console.log(`\n$ npm ${args.join(' ')}`);
    const r = run('npm', args, { stdio: 'inherit' });
    if (r.status !== 0) fail(`publishing ${pkg.name}@${pkg.version} failed`);
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

if (dryRun) {
  console.log(`\nrelease:first: dry run of ${version} done; nothing was published.`);
  process.exit(0);
}

// 6. Git tags (@relvista/core@1.0.0, …), as `changeset publish` would create them.
const tag = run('pnpm', ['changeset', 'git-tag'], { stdio: 'inherit' });
if (tag.status !== 0) fail('`pnpm changeset git-tag` failed (the packages are published)');

console.log(`
relvista ${version} is on npm. Next (docs/releasing.md):
  1. git push origin --tags
  2. on npmjs.com, add the trusted publisher (relvista/relvista, release.yml) to each of
     ${manifests.map((m) => m.pkg.name).join(', ')}
  3. create the GitHub release and publish the announcement post`);
