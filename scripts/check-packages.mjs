// `pnpm packages:check`: checks the three published packages the way npm will see them.
//
// For each package (after `pnpm build`): `pnpm pack` into a temporary directory, then on the
// tarball
//   - publint, strict (warnings count as errors; suggestions are reported and fail too),
//   - arethetypeswrong with `--profile esm-only` (the packages are ESM only by design: no
//     `require` condition, so the CommonJS resolution modes are not checked),
//   - relvista's own rules (CONTRIBUTING.md, "Packaging"): README.md, LICENSE identical to the
//     root one, no tests, no `src/` except the plugin's `src/theme/` (getTypeScriptThemePath), no
//     source maps or declaration maps, no build configs, no `workspace:` ranges left in the
//     packed package.json, the metadata every package must carry,
//   - a tarball size ceiling per package (`maxKB`), so nothing large slips in unnoticed.
// Prints a summary table and exits 1 on any problem.
//
//   node scripts/check-packages.mjs [--list] [--keep]
//     --list   print every file of every tarball
//     --keep   keep the temporary directory (its path is printed)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publint } from 'publint';
import { formatMessage } from 'publint/utils';
import { editorLicenseProblems, staleLicenses } from './copy-license.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** A dev dependency's CLI as `[command, argv]`, run with this Node (`.bin` shims need a shell on Windows). */
function cli(pkgName, binName) {
  const dir = join(root, 'node_modules', ...pkgName.split('/'));
  const { bin } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const entry = typeof bin === 'string' ? bin : bin[binName];
  return (argv) => [process.execPath, [join(dir, entry), ...argv]];
}
const attw = cli('@arethetypeswrong/cli', 'attw');

/**
 * pnpm as `[command, argv]`: the pnpm that runs this script (`pnpm packages:check` sets
 * npm_execpath), else `pnpm` from PATH. On Windows PATH only has a `.cmd` shim, which needs a shell.
 */
function pnpm(argv) {
  const exec = process.env.npm_execpath;
  if (exec && /^pnpm/i.test(basename(exec))) {
    return /\.[cm]?js$/i.test(exec) ? [process.execPath, [exec, ...argv]] : [exec, argv];
  }
  if (process.platform === 'win32')
    throw new Error('run this script through pnpm on Windows: pnpm packages:check');
  return ['pnpm', argv];
}
const args = new Set(process.argv.slice(2));

/**
 * Published packages, with the files a build must have produced before packing and the tarball
 * ceiling in KB. The renderer's includes the PDF export's fonts (about 1.8 MB packed, loaded only
 * for text outside WinAnsi; docs/design/phase3-v1.md §4.4).
 */
const PACKAGES = [
  { dir: 'core', maxKB: 128, built: ['dist/index.js', 'dist/index.d.ts'] },
  {
    dir: 'renderer',
    maxKB: 2560,
    // The stylesheet exports carry empty `.d.ts` stubs (`types` condition), so attw checks them too.
    built: [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/styles.css',
      'dist/styles.css.d.ts',
      'dist/xyflow.css',
      'dist/xyflow.css.d.ts',
    ],
  },
  {
    dir: 'docusaurus-plugin',
    maxKB: 128,
    built: ['lib/index.js', 'lib/index.d.ts', 'lib/client/static.css'],
  },
];

/** package.json fields every published package must carry (docs/design/phase3-v1.md §10). */
const REQUIRED_FIELDS = [
  'name',
  'version',
  'description',
  'keywords',
  'license',
  'author',
  'repository',
  'homepage',
  'bugs',
  'engines',
  'type',
  'exports',
  'types',
  'main',
  'files',
  'sideEffects',
  'publishConfig',
];

const REPO_URL = 'git+https://github.com/relvista/relvista.git';

/** Problems in the packed file list. `files` are tarball paths without the `package/` prefix. */
export function fileProblems(dir, files) {
  const problems = [];
  for (const required of ['package.json', 'README.md', 'LICENSE']) {
    if (!files.includes(required)) problems.push(`${required} is missing`);
  }
  for (const f of files) {
    if (/(^|\/)(test|tests|__tests__|e2e)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))
      problems.push(`test file ${f}`);
    else if (f.startsWith('src/') && !(dir === 'docusaurus-plugin' && f.startsWith('src/theme/')))
      problems.push(`source file ${f} (only the plugin's src/theme/ ships)`);
    else if (f.endsWith('.map')) problems.push(`source map ${f}`);
    else if (/(^|\/)(tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s|\.DS_Store)$/.test(f))
      problems.push(`stray file ${f}`);
    else if (f.startsWith('scripts/') || f.startsWith('node_modules/'))
      problems.push(`stray file ${f}`);
  }
  return problems;
}

/**
 * The SPDX licence each package declares: MIT, except the renderer, whose tarball also ships the
 * PDF export's fonts (SIL OFL 1.1, with Droid Sans Fallback glyphs under Apache 2.0).
 */
const LICENSES = { renderer: 'MIT AND OFL-1.1 AND Apache-2.0' };

/** Problems in the packed package.json. */
export function manifestProblems(dir, pkg) {
  const problems = REQUIRED_FIELDS.filter((k) => pkg[k] === undefined).map((k) => `no "${k}"`);
  const license = LICENSES[dir] ?? 'MIT';
  if (pkg.license !== license) problems.push(`license is not ${license}`);
  if (pkg.type !== 'module') problems.push('type is not module');
  if (pkg.repository?.url !== REPO_URL) problems.push(`repository.url is not ${REPO_URL}`);
  if (pkg.repository?.directory !== `packages/${dir}`)
    problems.push(`repository.directory is not packages/${dir}`);
  if (pkg.engines?.node !== '>=20') problems.push('engines.node is not >=20');
  if (pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.provenance !== true)
    problems.push('publishConfig is not { access: public, provenance: true }');
  if (!pkg.exports?.['./package.json']) problems.push('no "./package.json" export');
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (String(range).startsWith('workspace:')) problems.push(`${field}.${name} is ${range}`);
    }
  }
  // Peer ranges name the majors that are tested (React 18 and 19, Docusaurus 3), never `>=` or `*`.
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (/>=|\*|\bx\b|^latest$/.test(String(range)))
      problems.push(`peerDependencies.${name} is open-ended (${range})`);
  }
  return problems;
}

function run([cmd, argv], cwd) {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

function pack(dir, dest) {
  const r = run(pnpm(['pack', '--pack-destination', dest]), join(root, 'packages', dir));
  if (r.status !== 0) throw new Error(`pnpm pack failed in packages/${dir}:\n${r.stderr}`);
  const tgz = readdirSync(dest).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error(`pnpm pack wrote no tarball for packages/${dir}`);
  return join(dest, tgz);
}

/**
 * `tar` on the tarball, run in its directory with a bare file name: GNU tar (first on PATH in Git
 * for Windows) reads `C:\…` as a remote `host:path`, bsdtar (Windows' own) and macOS tar do not care.
 */
const tar = (flags, tarball, ...rest) =>
  run(['tar', [flags, basename(tarball), ...rest]], dirname(tarball));

function tarballFiles(tarball) {
  const r = tar('-tzf', tarball);
  if (r.status !== 0) throw new Error(`tar -tzf ${tarball} failed:\n${r.stderr}`);
  // Windows' tar.exe ends its lines with CRLF.
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l && !l.endsWith('/'))
    .map((l) => l.replace(/^package\//, ''))
    .sort();
}

function packedManifest(tarball) {
  const r = tar('-xzOf', tarball, 'package/package.json');
  if (r.status !== 0) throw new Error(`could not read package.json from ${tarball}`);
  return JSON.parse(r.stdout);
}

async function runPublint(tarball) {
  const buf = readFileSync(tarball);
  const tarballBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { messages, pkg } = await publint({
    pack: { tarball: tarballBuffer },
    level: 'suggestion',
    strict: true,
  });
  return messages.map((m) => ({
    type: m.type,
    text: `${m.code}: ${formatMessage(m, pkg, { color: false }) ?? ''}`,
  }));
}

function runAttw(tarball, exclude = []) {
  const argv = [tarball, '--profile', 'esm-only', '--format', 'json', '--no-color'];
  if (exclude.length) argv.push('--exclude-entrypoints', ...exclude);
  const r = run(attw(argv));
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    throw new Error(`attw printed no JSON (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  // `problems` is keyed by kind and also lists what the profile ignores: esm-only skips the
  // node10 and node16-cjs resolutions (the exit code already follows the profile).
  const ignored = new Set(['node10', 'node16-cjs']);
  const all = Object.values(report.problems ?? {}).flat();
  const problems = all
    .filter((p) => !ignored.has(p.resolutionKind))
    .map((p) => {
      const where = [p.entrypoint, p.resolutionKind].filter(Boolean).join(' ');
      return `${p.kind}${where ? ` (${where})` : ''}${p.fileName ? ` ${p.fileName}` : ''}`;
    });
  const entrypoints = Object.keys(report.analysis?.entrypoints ?? {});
  if (r.status !== 0 && problems.length === 0) problems.push(`attw exited with ${r.status}`);
  return { problems, entrypoints };
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'relvista-pack-'));
  const rows = [];
  let failed = false;
  const fail = (lines, heading) => {
    if (!lines.length) return;
    failed = true;
    console.error(`\n${heading}`);
    for (const l of lines) console.error(`  - ${l}`);
  };

  fail(
    staleLicenses().map((f) => `${f} differs from LICENSE (run node scripts/copy-license.mjs)`),
    'LICENSE copies',
  );
  fail(editorLicenseProblems(), 'Editor licence (AGPL-3.0-or-later, decision 0006)');

  try {
    for (const { dir, built, attwExclude, maxKB } of PACKAGES) {
      const missing = built.filter((f) => !existsSync(join(root, 'packages', dir, f)));
      if (missing.length) {
        fail([`not built (${missing.join(', ')}); run pnpm build first`], `packages/${dir}`);
        rows.push({ dir, name: dir, files: 0, size: 0, publint: '-', attw: '-', own: '-' });
        continue;
      }
      const dest = mkdtempSync(join(tmp, `${dir}-`));
      const tarball = pack(dir, dest);
      const files = tarballFiles(tarball);
      const pkg = packedManifest(tarball);
      const size = readFileSync(tarball).byteLength;
      const own = [...fileProblems(dir, files), ...manifestProblems(dir, pkg)];
      if (size > maxKB * 1024) {
        own.push(`tarball is ${(size / 1024).toFixed(1)} KB, over the ${maxKB} KB ceiling`);
      }
      const lint = await runPublint(tarball);
      const attw = runAttw(tarball, attwExclude);

      if (args.has('--list')) {
        console.log(`\n${pkg.name} (${files.length} files)`);
        for (const f of files) console.log(`  ${f}`);
      }
      fail(
        lint.map((m) => `${m.type}: ${m.text}`),
        `${pkg.name}: publint --strict`,
      );
      fail(attw.problems, `${pkg.name}: attw --profile esm-only`);
      fail(own, `${pkg.name}: relvista packaging rules`);

      const count = (type) => lint.filter((m) => m.type === type).length;
      rows.push({
        dir,
        name: pkg.name,
        files: files.length,
        size,
        publint: `${count('error')}/${count('warning')}/${count('suggestion')}`,
        attw: `${attw.problems.length} (${attw.entrypoints.join(' ')})`,
        own: String(own.length),
      });
    }
  } finally {
    if (args.has('--keep')) console.log(`\ntarballs kept in ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }

  const table = [
    ['package', 'files', 'tarball', 'publint e/w/s', 'attw problems (entrypoints)', 'rules'],
    ...rows.map((r) => [
      r.name,
      String(r.files),
      `${(r.size / 1024).toFixed(1)} KB`,
      r.publint,
      r.attw,
      r.own,
    ]),
  ];
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  const line = (row) => `| ${row.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  console.log('');
  console.log(line(table[0]));
  console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  for (const row of table.slice(1)) console.log(line(row));
  console.log(failed ? '\npackages:check FAILED' : '\npackages:check passed');
  if (failed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
