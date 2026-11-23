/**
 * Records what each emitted JavaScript file of the production client bundle holds of relvista, for
 * e2e/bundle.spec.ts: modules of the three relvista packages, and modules of npm packages that
 * only those import (reachable from the bundle's entries only through a relvista module: the DBML
 * parser, React Flow, ELK, jsPDF, …). CSS modules are left out (their rules go into the site's one
 * stylesheet; the JavaScript left of them is an empty stub). The ELK worker script, an asset of a
 * relvista module, is listed too. Written to node_modules/.cache/relvista-bundle/docs.json (never
 * committed, never deployed); server bundles and `docusaurus start` are skipped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { LoadContext, Plugin } from '@docusaurus/types';
import { repoRoot, resolvePackageFrom } from '../../../scripts/third-party/collect.mjs';

type WebpackConfig = Parameters<NonNullable<Plugin['configureWebpack']>>[0];
type WebpackPlugin = NonNullable<WebpackConfig['plugins']>[number];

/** The parts of webpack's module, module graph and chunk objects read here. */
interface Mod {
  resource?: string;
  type?: string;
  /** A concatenated module's inner modules. */
  modules?: Iterable<Mod>;
  buildInfo?: { filename?: string };
}
interface Graph {
  getModule(dependency: unknown): Mod | null;
  getOutgoingConnections(module: Mod): Iterable<{ module: Mod | null }>;
}
interface Entry {
  dependencies: unknown[];
  includeDependencies: unknown[];
}
interface Chunk {
  files: Iterable<string>;
}
interface Compilation {
  moduleGraph: Graph;
  chunkGraph: { getChunkModulesIterable(chunk: Chunk): Iterable<Mod> };
  entries: Map<string, Entry>;
  globalEntry: Entry;
  chunks: Iterable<Chunk>;
  hooks: { finishModules: { tap(name: string, fn: (modules: Iterable<Mod>) => void): void } };
}

/** One emitted file (path relative to the output directory, '/' separators). */
export interface BundleFile {
  /** Modules of the relvista packages, relative to the repository root. */
  relvista: string[];
  /** npm packages only relvista brings, by name. */
  relvistaDeps: string[];
}

export const MANIFEST = join(repoRoot, 'node_modules', '.cache', 'relvista-bundle', 'docs.json');

const NAME = 'relvista-bundle-manifest';
const slash = (p: string) => p.split(sep).join('/');
const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
const resourceOf = (m: Mod): string | null =>
  m.resource ? slash(m.resource.split('?')[0]!) : null;

/** `…/node_modules/@scope/name/x.js` → `@scope/name`. */
function packageName(path: string): string | null {
  const at = path.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const parts = path.slice(at + '/node_modules/'.length).split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] ?? null);
}

export default function bundleManifest(context: LoadContext): Plugin {
  const plugin = resolvePackageFrom(context.siteDir, '@relvista/docusaurus-plugin');
  const renderer = plugin && resolvePackageFrom(plugin, '@relvista/renderer');
  const core = renderer && resolvePackageFrom(renderer, '@relvista/core');
  if (!plugin || !renderer || !core)
    throw new Error(`${NAME}: the relvista packages do not resolve`);
  const roots = [plugin, renderer, core].map((r) => fold(`${r}/`));
  const isRelvista = (m: Mod) => {
    const r = resourceOf(m);
    return !!r && roots.some((root) => fold(r).startsWith(root));
  };

  return {
    name: NAME,
    configureWebpack(config, isServer) {
      if (isServer || config.mode !== 'production') return {};
      const apply: WebpackPlugin = {
        apply(compiler) {
          // Resources of modules reachable only through relvista, from the graph as built (before
          // concatenation merges modules and their connections).
          const onlyRelvista = new Set<string>();
          compiler.hooks.thisCompilation.tap(NAME, (c) => {
            const compilation = c as unknown as Compilation;
            compilation.hooks.finishModules.tap(NAME, (modules) => {
              const graph = compilation.moduleGraph;
              const free = new Set<Mod>();
              const stack: Mod[] = [];
              for (const entry of [...compilation.entries.values(), compilation.globalEntry])
                for (const d of [...entry.dependencies, ...entry.includeDependencies]) {
                  const m = graph.getModule(d);
                  if (m && !isRelvista(m)) stack.push(m);
                }
              for (let m = stack.pop(); m; m = stack.pop()) {
                if (free.has(m)) continue;
                free.add(m);
                for (const { module: to } of graph.getOutgoingConnections(m))
                  if (to && !free.has(to) && !isRelvista(to)) stack.push(to);
              }
              onlyRelvista.clear();
              for (const m of modules) {
                const r = resourceOf(m);
                if (r && !free.has(m) && !isRelvista(m)) onlyRelvista.add(r);
              }
            });
          });
          compiler.hooks.afterEmit.tap(NAME, (c) => {
            const compilation = c as unknown as Compilation;
            const files: Record<string, BundleFile> = {};
            const add = (file: string, kind: keyof BundleFile, value: string) => {
              const f = (files[slash(file)] ??= { relvista: [], relvistaDeps: [] });
              if (!f[kind].includes(value)) f[kind].push(value);
            };
            for (const chunk of compilation.chunks) {
              const js = [...chunk.files].filter((f) => f.endsWith('.js'));
              const visit = (m: Mod) => {
                for (const inner of m.modules ?? []) visit(inner);
                const r = resourceOf(m);
                if (!r || r.endsWith('.css')) return;
                const relvista = isRelvista(m);
                const name = packageName(r);
                // Docusaurus' own modules (the theme components relvista wraps or reuses) are the
                // site's code even where only relvista imports them.
                if (!relvista && (!onlyRelvista.has(r) || name?.startsWith('@docusaurus/'))) return;
                const kind = relvista ? 'relvista' : 'relvistaDeps';
                const value = relvista ? slash(relative(repoRoot, r)) : (name ?? r);
                // An asset module leaves only its URL in the chunk; its file (the ELK worker
                // script) is the code.
                if (m.type === 'asset/resource') {
                  const asset = m.buildInfo?.filename;
                  if (asset?.endsWith('.js')) add(asset, kind, value);
                  return;
                }
                for (const f of js) add(f, kind, value);
              };
              for (const m of compilation.chunkGraph.getChunkModulesIterable(chunk)) visit(m);
            }
            for (const f of Object.values(files)) {
              f.relvista.sort();
              f.relvistaDeps.sort();
            }
            mkdirSync(join(MANIFEST, '..'), { recursive: true });
            writeFileSync(MANIFEST, `${JSON.stringify({ files }, null, 1)}\n`);
          });
        },
      };
      return { plugins: [apply] };
    },
  };
}
