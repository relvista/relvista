#!/usr/bin/env node
// Writes THIRD_PARTY_NOTICES.md: every npm package bundled into the deployed editor
// (/editor/) and the docs site's client JavaScript (/), with version, licence,
// copyright notice, source location and licence text, plus the notices files packages ship
// (Monaco's ThirdPartyNotices.txt).
//
// The package lists come from the production builds themselves (apps/editor/vite.config.ts and
// apps/docs/plugins/third-party-modules.ts record every module of every emitted chunk), so build
// first: `pnpm build` (or `pnpm docs:build`), then `pnpm notices`.
// `--check` fails instead of writing when the committed file is out of date (CI).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VENDORED, readPackageList, repoRoot, resolvePackageFrom } from './third-party/collect.mjs';

const OUT = join(repoRoot, 'THIRD_PARTY_NOTICES.md');
const check = process.argv.includes('--check');
const REPO = 'https://github.com/relvista/relvista';

const BUNDLES = [
  { id: 'editor', label: 'editor', build: 'pnpm editor:build', out: 'apps/editor/dist/assets' },
  { id: 'docs', label: 'docs', build: 'pnpm docs:build', out: 'apps/docs/build/assets/js' },
];

/**
 * Code the bundlers write into the bundles themselves (virtual modules, so no node_modules path
 * the build could record): Vite's modulepreload polyfill and Rolldown's runtime (Vite 8 bundles
 * with Rolldown) in the editor, webpack's runtime in the docs site. `from` is the chain of
 * packages to resolve the bundler through.
 */
const BUNDLER_CODE = [
  { bundle: 'editor', from: ['apps/editor'], name: 'vite', what: 'its modulepreload polyfill' },
  {
    bundle: 'editor',
    from: ['apps/editor', 'vite'],
    name: 'rolldown',
    what: 'its module runtime',
  },
  {
    bundle: 'docs',
    from: ['apps/docs', '@docusaurus/core'],
    name: 'webpack',
    what: 'its module runtime',
  },
];

/**
 * What the packages themselves do not say. `copyright` is used when a package has no licence file
 * (or no copyright line in it); each value is quoted from the package's own source files.
 */
const OVERRIDES = {
  elkjs: {
    license: 'EPL-2.0',
    copyright: ['Copyright (c) 2017 Kiel University and others.'],
    source: [
      'https://github.com/kieler/elkjs (the JavaScript build of ELK)',
      'https://github.com/eclipse/elk (Eclipse Layout Kernel, the Java source elkjs is compiled from)',
    ],
  },
  antlr4: {
    copyright: ['Copyright (c) 2012-2022 The ANTLR Project. All rights reserved.'],
  },
  infima: { copyright: ['Copyright (c) Facebook, Inc. and its affiliates.'] },
  isarray: { copyright: ['Copyright (c) 2013 Julian Gruber <julian@juliangruber.com>'] },
  'react-compiler-runtime': { copyright: ['Copyright (c) Meta Platforms, Inc. and affiliates.'] },
  // Its LICENSE files have no copyright line; this one is the banner of the shipped file.
  dompurify: { copyright: ['(c) Cure53 and other contributors'] },
  // LICENSE.md also carries the licences of what Vite bundles into its own (Node) build, none of
  // which ships in the editor: Vite's own MIT licence only.
  vite: {
    standardText: 'the MIT licence at the top of its LICENSE.md, standard wording',
    copyright: ['Copyright (c) 2019-present, VoidZero Inc. and Vite contributors'],
  },
};

/** Standard texts for packages that ship no licence file (SPDX license list wording). */
const STANDARD_TEXT = {
  MIT: `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  'BSD-3-Clause': `Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions
   and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of
   conditions and the following disclaimer in the documentation and/or other materials provided
   with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific prior written
   permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
};

const LICENSE_FILE = /^(licen[cs]e|copying|unlicense)([.-].*)?$/i;
const NOTICE_FILE = /^notice([.-].*)?$/i;
const NOTICES_FILE = /^third[-_]?party[-_]?notices([.-].*)?$/i;
/** A copyright line: `Copyright (c) …`, `Copyright 2020 …`, `Copyright Joyent, …`, `© …`. */
const COPYRIGHT = /^\s*(?:Copyright|COPYRIGHT|copyright)\s*(?:\([cC]\)|©|\d{4}|[A-Z])|^\s*©/;

const lf = (text) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();

function fail(message) {
  console.error(`third-party-notices: ${message}`);
  process.exit(1);
}

function repositoryUrl(pkg) {
  let r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const dir = typeof pkg.repository === 'object' ? pkg.repository?.directory : undefined;
  if (!r) return pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`;
  r = r.replace(/^git\+/, '').replace(/\.git$/, '');
  if (/^github:/.test(r)) r = `https://github.com/${r.slice(7)}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(r)) r = `https://github.com/${r}`;
  r = r.replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://');
  r = r.replace(/^git@github\.com:/, 'https://github.com/');
  if (dir && /github\.com\/[^/]+\/[^/]+$/.test(r)) r = `${r}/tree/HEAD/${dir}`;
  return r;
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function readPackage(rel, bundles) {
  const dir = join(repoRoot, rel);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = readdirSync(dir).sort();
  const over = OVERRIDES[pkg.name] ?? {};
  const read = (re) =>
    files.filter((f) => re.test(f)).map((f) => lf(readFileSync(join(dir, f), 'utf8')));
  const licenseTexts = over.standardText ? [] : read(LICENSE_FILE);
  const declared = licenseOf(pkg);
  const license = over.license ?? declared;
  let text = licenseTexts.join('\n\n');
  let standard = false;
  if (!text) {
    text = STANDARD_TEXT[license];
    standard = true;
    if (!text)
      fail(`${pkg.name}@${pkg.version} has no licence file and no standard text for ${license}`);
  }
  const lines = text.split('\n');
  const found = lines.filter((l) => COPYRIGHT.test(l)).map((l) => l.trim());
  const body = lf(lines.filter((l) => !COPYRIGHT.test(l)).join('\n'));
  const copyright = found.length ? [...new Set(found)] : (over.copyright ?? []);
  if (!copyright.length) {
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
    copyright.push(author ? `Copyright (c) ${author}` : `Copyright (c) the ${pkg.name} authors`);
  }
  return {
    name: pkg.name,
    version: pkg.version,
    declared,
    license,
    copyright,
    body,
    standard:
      standard && (over.standardText || 'no licence file in the package; standard licence text'),
    source: over.source ?? [repositoryUrl(pkg)],
    notice: read(NOTICE_FILE).join('\n\n'),
    notices: read(NOTICES_FILE).join('\n\n'),
    bundles,
  };
}

const id = (p) => `${p.name}@${p.version}`;

// --- collect ---------------------------------------------------------------------------------
const byDir = new Map();
for (const b of BUNDLES) {
  const list = readPackageList(b.id);
  if (!list) fail(`no package list for the ${b.id} build. Build it first (${b.build}).`);
  for (const rel of list) {
    if (!existsSync(join(repoRoot, rel, 'package.json'))) {
      fail(`${rel} is gone; rebuild (${b.build}).`);
    }
    byDir.set(rel, [...(byDir.get(rel) ?? []), b.label]);
  }
}
const relPath = (dir) => dir.slice(repoRoot.length + 1);
const notes = new Map();
for (const extra of BUNDLER_CODE) {
  let dir = join(repoRoot, extra.from[0]);
  for (const name of [...extra.from.slice(1), extra.name]) {
    dir = resolvePackageFrom(dir, name);
    if (!dir) fail(`cannot resolve ${name} (for ${extra.name}, ${extra.what})`);
  }
  const label = BUNDLES.find((b) => b.id === extra.bundle).label;
  byDir.set(relPath(dir), [...new Set([...(byDir.get(relPath(dir)) ?? []), label])]);
  notes.set(extra.name, `generated by the bundler (${extra.what}).`);
}
for (const [outer, copies] of Object.entries(VENDORED)) {
  for (const [dir, dependency] of copies) {
    notes.set(dependency, `ships as the copy \`${outer}\` includes (\`${dir}\`).`);
  }
}
// pnpm installs one name@version in several directories when its peers differ: one entry each.
const byId = new Map();
for (const [rel, bundles] of byDir) {
  const p = readPackage(rel, bundles);
  const seen = byId.get(id(p));
  if (seen)
    seen.bundles = BUNDLES.map((b) => b.label).filter((l) =>
      [...seen.bundles, ...bundles].includes(l),
    );
  else byId.set(id(p), p);
}
const packages = [...byId.values()]
  .filter((p) => !p.name.startsWith('@relvista/'))
  .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));

// --- every `@license` banner in the shipped JavaScript names a listed package -----------------
// OFL: the fonts the PDF export embeds (listed under Fonts below).
const SPDX_ONLY = /^(MIT|ISC|BSD|Apache|MPL|0BSD|OFL)\b/;
// Banners whose first word is prose, not a package name: jsPDF bundles Adobe's font metrics
// ("@license Copyright (c) 2008, Adobe …") and an RGBColor parser ("@license Use it if you like
// it"); both are inside the jspdf package, which the notices list.
const NOT_A_NAME = new Set(['copyright', 'use']);
const missing = [];
for (const b of BUNDLES) {
  const dir = join(repoRoot, b.out);
  if (!existsSync(dir)) fail(`no ${b.out}: build the ${b.id} first (${b.build}).`);
  const listed = packages.filter((p) => p.bundles.includes(b.label));
  for (const file of readdirSync(dir).filter((f) => /\.(m?js|LICENSE\.txt)$/.test(f))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/@license\s+([A-Za-z][\w.-]*)(?:\s+v?(\d+\.\d+\.\d+))?/g)) {
      const [, name, version] = m;
      if (SPDX_ONLY.test(name)) continue;
      if (NOT_A_NAME.has(name.toLowerCase())) continue;
      const n = name.toLowerCase();
      const same = listed.filter((p) => {
        const bare = p.name.toLowerCase().replace(/^@[^/]+\//, '');
        return bare === n || bare.startsWith(`${n}-`);
      });
      if (!same.length || (version && !same.some((p) => p.version === version))) {
        missing.push(`${b.out}/${file}: @license ${name}${version ? ` ${version}` : ''}`);
      }
    }
  }
}
if (missing.length) {
  fail(
    `bundled code names packages the notices do not list:\n  ${[...new Set(missing)].join('\n  ')}\nAdd them (scripts/third-party/collect.mjs VENDORED, or BUNDLER_CODE here).`,
  );
}

// --- render ----------------------------------------------------------------------------------
const code = (s) => `\`${String(s).replaceAll('`', "'")}\``;
const cell = (s) => String(s).replaceAll('|', '\\|');
function fence(text) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}text\n${text}\n${f}`;
}
function link(url) {
  const m = /^(\S+)(.*)$/.exec(url);
  // Label: host + owner/repo (the full path stays in the link), so the table stays narrow.
  const label = m[1].replace(/^https?:\/\//, '').replace(/^(github\.com\/[^/]+\/[^/]+)\/.*$/, '$1');
  return `[${label}](${m[1]})${m[2]}`;
}

const out = [];
out.push(
  '# Third-party notices',
  '',
  `The **relvista** editor (\`https://relvista.org/editor/\`) is licensed under AGPL-3.0-or-later ([apps/editor/LICENSE](${REPO}/blob/main/apps/editor/LICENSE)). The documentation site (\`https://relvista.org/\`) and the relvista npm packages are MIT licensed ([LICENSE](${REPO}/blob/main/LICENSE)). The editor and docs site JavaScript bundles include the open-source packages listed here. For each package: the version that ships, its licence, its copyright notice, where its source code is, and the full licence text.`,
  '',
  'relvista is an independent open-source project, not affiliated with Holistics or dbdiagram.io. DBML is an open-source language by Holistics.',
  '',
  `Generated by ${code('scripts/third-party-notices.mjs')} from the production builds; do not edit by hand. Plain-text copy: ${code('/editor/THIRD_PARTY_NOTICES.txt')}.`,
  '',
  '## Packages',
  '',
  '| Package | Version | Licence | Ships in | Source |',
  '| --- | --- | --- | --- | --- |',
  ...packages.map(
    (p) =>
      `| ${code(p.name)} | ${cell(p.version)} | ${cell(p.license === p.declared ? p.license : `${p.license} (of ${p.declared})`)} | ${p.bundles.join(', ')} | ${link(p.source[0])} |`,
  ),
  '',
);

const noted = packages.filter((p) => notes.has(p.name));
if (noted.length) {
  out.push(
    'Not from a module of its own:',
    '',
    ...noted.map((p) => `- ${code(id(p))}: ${notes.get(p.name)}`),
    '',
  );
}

const elk = packages.filter((p) => p.name === 'elkjs');
if (elk.length) {
  out.push(
    '## elkjs: licence choice and source code',
    '',
    `elkjs is offered under ${code('EPL-2.0 OR GPL-3.0-or-later')}. relvista uses and redistributes it under the **Eclipse Public License 2.0** only. It ships unmodified, as published on npm (${elk.map((p) => code(id(p))).join(', ')}): ${code('elk-worker.min.js')} runs the layout in a Web Worker and ${code('elk.bundled.js')} is the in-page fallback. The source code is available at:`,
    '',
    ...elk[0].source.map((s) => `- ${link(s)}`),
    `- the npm package itself: ${elk.map((p) => `[${p.name}-${p.version}.tgz](https://registry.npmjs.org/${p.name}/-/${p.name}-${p.version}.tgz)`).join(', ')}`,
    '',
  );
}

// Fonts are not npm packages: Manrope ships as the outlined wordmark (the logo SVGs on both
// sites, drawn inline in the editor) and the docs site loads it from Google Fonts for headings.
const OFL = join(repoRoot, 'brand', 'source', 'MANROPE-OFL.txt');
if (!existsSync(OFL)) fail('brand/source/MANROPE-OFL.txt is missing.');
out.push(
  '## Fonts',
  '',
  `The **relvista** wordmark in the logo (on the docs site and in the editor) is drawn from the Manrope typeface, converted to outlines. The docs site also loads Manrope from Google Fonts for its headings. Manrope is ${code('Copyright 2018 The Manrope Project Authors')} ([github.com/googlefonts/manrope](https://github.com/googlefonts/manrope)) and licensed under the SIL Open Font License 1.1:`,
  '',
  fence(lf(readFileSync(OFL, 'utf8'))),
  '',
);

// The PDF export (@relvista/renderer) embeds font subsets for text outside WinAnsi; both sites
// ship them as lazily loaded chunks. Their licences are kept in the renderer's fonts directory.
const PDF_FONTS = join(repoRoot, 'packages/renderer/src/export/pdf/fonts/LICENSES.md');
if (!existsSync(PDF_FONTS)) fail('packages/renderer/src/export/pdf/fonts/LICENSES.md is missing.');
const apache = /## Apache License 2\.0[^\n]*\n+```text\n([\s\S]*?)\n```/.exec(
  readFileSync(PDF_FONTS, 'utf8'),
);
if (!apache)
  fail('no Apache License 2.0 text in packages/renderer/src/export/pdf/fonts/LICENSES.md');
out.push(
  `The PDF export (editor and docs site) draws text outside WinAnsi (Greek, Cyrillic, CJK) with font subsets it loads only when a PDF needs them: Noto Sans Regular and Bold, ${code('Copyright 2022 The Noto Project Authors')} ([github.com/notofonts/latin-greek-cyrillic](https://github.com/notofonts/latin-greek-cyrillic)), licensed under the SIL Open Font License 1.1 (the text above), and Droid Sans Fallback, ${code('Digitized data copyright Google Corporation (c) 2006')}; ${code('Copyright (C) 2008 The Android Open Source Project')} ([android.googlesource.com](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android10-release/data/fonts/)), licensed under the Apache License 2.0. relvista modified both (subset, unhinted, the CJK glyphs merged with Noto Sans into one font, which as a modified Noto Sans is distributed as a whole under the SIL Open Font License 1.1, the Droid Sans Fallback glyphs keeping their notices and the Apache License 2.0); details in [packages/renderer/src/export/pdf/fonts/LICENSES.md](${REPO}/blob/main/packages/renderer/src/export/pdf/fonts/LICENSES.md). Apache License 2.0:`,
  '',
  fence(lf(apache[1])),
  '',
);

// Licence texts, one per distinct text (copyright lines listed per package above each text).
const groups = new Map();
for (const p of packages) {
  // Same words = same text: titles ("The MIT License (MIT)"), quotes and wrapping differ.
  const words = p.body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the )?mit license( mit)? /, '');
  const key = `${p.license}\n${words}`;
  if (!groups.has(key)) groups.set(key, { license: p.license, body: p.body, packages: [] });
  groups.get(key).packages.push(p);
}
const permissive = /^(MIT|ISC|0BSD|BSD-\d-Clause)$/;
const ordered = [...groups.values()].sort(
  (a, b) =>
    Number(permissive.test(a.license)) - Number(permissive.test(b.license)) ||
    a.license.localeCompare(b.license, 'en') ||
    a.packages[0].name.localeCompare(b.packages[0].name, 'en'),
);
out.push('## Licence texts', '');
for (const g of ordered) {
  const more = g.packages.length > 1 ? ` and ${g.packages.length - 1} more` : '';
  out.push(`### ${g.license}: ${g.packages[0].name}${more}`, '');
  for (const p of g.packages) {
    out.push(
      `- ${code(id(p))}${p.standard ? ` (${p.standard})` : ''}: ${p.copyright.map(code).join('; ')}`,
    );
  }
  out.push('', fence(g.body), '');
}

const withNotice = packages.filter((p) => p.notice);
if (withNotice.length) {
  out.push('## NOTICE files', '');
  for (const p of withNotice) out.push(`### ${code(id(p))}`, '', fence(p.notice), '');
}
for (const p of packages.filter((x) => x.notices)) {
  out.push(
    `## ${code(p.name)}: its own third-party notices`,
    '',
    `${code(id(p))} includes code from other projects. Its notices file, verbatim:`,
    '',
    fence(p.notices),
    '',
  );
}

const content = `${out.join('\n').trimEnd()}\n`;
const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
if (check) {
  if (current !== content) {
    fail(
      'THIRD_PARTY_NOTICES.md is out of date with the bundled packages. Run `pnpm build && pnpm notices` and commit the result.',
    );
  }
  console.log(`THIRD_PARTY_NOTICES.md is up to date (${packages.length} packages)`);
} else {
  if (current !== content) writeFileSync(OUT, content);
  console.log(
    `${current === content ? 'unchanged' : 'wrote'} THIRD_PARTY_NOTICES.md (${packages.length} packages, ${ordered.length} licence texts)`,
  );
}
