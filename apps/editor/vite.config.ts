import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { writePackageList } from '../../scripts/third-party/collect.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const notices = fileURLToPath(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url));

// Every npm package in this build (main bundle and worker bundles alike), recorded for
// scripts/third-party-notices.mjs. The workers are separate Rollup builds in the same process.
const bundled = new Set<string>();
function thirdParty(options: { main: boolean }): Plugin {
  return {
    name: 'relvista:third-party',
    apply: 'build',
    generateBundle(_output, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const [id, info] of Object.entries(item.modules)) {
          // CSS leaves the JS chunk (renderedLength 0) but still ships, in the .css asset.
          if (info.renderedLength > 0 || /\.css($|\?)/.test(id)) bundled.add(id);
        }
      }
      writePackageList('editor', bundled);
      // The notices ship next to the app: /editor/THIRD_PARTY_NOTICES.txt.
      if (options.main && existsSync(notices)) {
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD_PARTY_NOTICES.txt',
          source: readFileSync(notices, 'utf8'),
        });
      }
    },
  };
}

// jsPDF's optional dependencies, loaded only by its `.html()` / `addSvgAsImage()`, which relvista
// never calls: an empty module stands in, so they are not bundled (design phase3 §2).
const emptyModule = fileURLToPath(new URL('./src/stubs/empty.ts', import.meta.url));
const JSPDF_OPTIONAL = ['html2canvas', 'canvg', 'dompurify'];

// Licence comments (`/*! … */`, `@license`, `@preserve`) survive minification, in place; full
// texts are in THIRD_PARTY_NOTICES.txt. Vite 8 drops them from minified output unless asked.
const LICENCE_COMMENTS = { legal: true } as const;

// Served at https://relvista.org/editor/ (copied into the docs build).
export default defineConfig({
  base: process.env.RELVISTA_EDITOR_BASE ?? '/editor/',
  plugins: [react(), thirdParty({ main: true })],
  resolve: {
    alias: JSPDF_OPTIONAL.map((name) => ({
      find: new RegExp(`^${name}$`),
      replacement: emptyModule,
    })),
  },
  worker: {
    format: 'es',
    rolldownOptions: { output: { comments: LICENCE_COMMENTS } },
    // No source maps for worker bundles: the SQL worker inlines @dbml/core (15 MB, every SQL
    // grammar) and its 45 MB map exhausts Node's default heap during the build. Vite copies
    // `build.sourcemap` over `worker.rolldownOptions.output`, so a plugin hook turns it off.
    plugins: () => [
      {
        name: 'relvista:no-worker-sourcemaps',
        outputOptions: (options) => ({ ...options, sourcemap: false }),
      },
      thirdParty({ main: false }),
    ],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 5000,
    rolldownOptions: {
      output: {
        comments: LICENCE_COMMENTS,
        // Monaco changes far less often than the app: its own chunk caches across deploys.
        codeSplitting: {
          groups: [{ name: 'monaco', test: /\/node_modules\/(?:.+\/)?monaco-editor\// }],
        },
      },
    },
  },
  server: { fs: { allow: [repoRoot] } },
});
