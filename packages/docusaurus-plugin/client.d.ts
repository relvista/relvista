// Ambient types for sites using @relvista/docusaurus-plugin. Add to a site's tsconfig:
//   "types": ["@relvista/docusaurus-plugin/client"]   or   /// <reference types="@relvista/docusaurus-plugin/client" />

/** `.dbml` files are imported as their source text (webpack `asset/source`). */
declare module '*.dbml' {
  const source: string;
  export default source;
}

/** A file imported with `?relvista-worker` is emitted as an asset; the import is its URL. */
declare module '*?relvista-worker' {
  const url: string;
  export default url;
}

declare module '@theme/DbmlDiagram' {
  import type { ReactNode } from 'react';
  import type { CompileInputFiles, DetailLevel, Layout } from '@relvista/core';
  import type { ToolbarItem } from '@relvista/renderer';

  export interface Props {
    /** DBML source, or `{ files, entry }` for a multi-file project. */
    readonly value?: string | CompileInputFiles;
    /** URL of a `.dbml` file served by the site (resolved with `useBaseUrl`). Used when `value` is absent. */
    readonly src?: string;
    /** Parsed layout file object, or the URL of a `*.layout.json` file served by the site. */
    readonly layout?: Layout | string | null;
    /** DiagramView name. Default: every table. */
    readonly view?: string;
    /** Viewer height (number = px). Default `themeConfig.dbml.height` (480). */
    readonly height?: number | string;
    readonly title?: string;
    /** Show "Diagram" / "Source" tabs. */
    readonly source?: boolean;
    readonly detailLevel?: DetailLevel;
    readonly toolbar?: ToolbarItem[];
    /** Overrides `themeConfig.dbml.editorUrl`; `false` hides "Open in editor". */
    readonly editorUrl?: string | false;
    /** Overrides `themeConfig.dbml.palette`: the site's colours (`site`) or relvista's own. */
    readonly palette?: 'site' | 'relvista';
    /**
     * Overrides `themeConfig.dbml.ssr`: draw the diagram into the page's HTML at build time (a
     * static SVG the interactive viewer replaces in place). `false` renders a placeholder there.
     */
    readonly ssr?: boolean;
    /**
     * Overrides `themeConfig.dbml.frozen` (default `true`): the diagram shows as arranged, and
     * readers unlock it with the toolbar's lock button to move tables or collapse groups.
     * `false` lets them drag tables right away, without a lock button.
     */
    readonly frozen?: boolean;
    /**
     * The diagram's anchor on the page: its wrapper's `id`. `#<id>` scrolls to the diagram and
     * `#<id>&table=orders&view=billing` also opens it there (any deep-link keys: `view`, `table`,
     * `hops`, `detail`, `vp`, `q`, `path`). Default: the title's slug, else
     * `diagram-<hash of the source and view>`.
     */
    readonly id?: string;
    readonly className?: string;
  }

  export default function DbmlDiagram(props: Props): ReactNode;
}

declare module '@theme/DbmlDiff' {
  import type { ReactNode } from 'react';
  import type { CompileInputFiles, DetailLevel, Layout } from '@relvista/core';
  import type { ToolbarItem } from '@relvista/renderer';

  /**
   * A schema diff: the new version drawn with what changed since the old one, and a
   * "Changes (+3 −1 ~4)" list. Give each version inline (`old` / `new`) or as a URL of a `.dbml`
   * file served by the site (`oldSrc` / `newSrc`).
   */
  export interface Props {
    /** The older version (before): DBML source, or `{ files, entry }`. */
    readonly old?: string | CompileInputFiles;
    /** The newer version (after), drawn with the changes. */
    readonly new?: string | CompileInputFiles;
    /** URL of the older `.dbml` file (resolved with `useBaseUrl`), when `old` is absent. */
    readonly oldSrc?: string;
    /** URL of the newer `.dbml` file, when `new` is absent. */
    readonly newSrc?: string;
    /** Positions for the new version: a parsed layout file, or the URL of one. */
    readonly layout?: Layout | string | null;
    /** DiagramView name (of the new version). Default: every table. */
    readonly view?: string;
    /** Viewer height (number = px). Default `themeConfig.dbml.height`. */
    readonly height?: number | string;
    readonly title?: string;
    /** Show the change list under the diagram. Default true. */
    readonly summary?: boolean;
    /** The diff's anchor on the page (see `@theme/DbmlDiagram`'s `id`). */
    readonly id?: string;
    readonly detailLevel?: DetailLevel;
    readonly toolbar?: ToolbarItem[];
    /** Overrides `themeConfig.dbml.palette`. */
    readonly palette?: 'site' | 'relvista';
    /** Overrides `themeConfig.dbml.ssr` (build-time picture and change list). */
    readonly ssr?: boolean;
    /** Overrides `themeConfig.dbml.frozen` (see `@theme/DbmlDiagram`'s `frozen`). */
    readonly frozen?: boolean;
    readonly className?: string;
  }

  export default function DbmlDiff(props: Props): ReactNode;
}

/**
 * Build-time rendering of static diagrams (used by `@theme/DbmlDiagram`). The plugin aliases this
 * module in its webpack config: the server bundle gets a renderer that reads the site's static
 * directories, the browser bundle a stub returning null.
 */
declare module 'relvista-ssr-files' {
  export interface RelvistaSsrBackend {
    readSiteFile(path: string): { ok: true; text: string } | { ok: false; message: string };
    renderStatic(request: unknown): Promise<unknown>;
    /** Build-time `@theme/DbmlDiff` pictures (src/theme/DbmlDiff/server.tsx). */
    renderDiff?(request: unknown): Promise<unknown>;
  }

  export default function relvistaSsr(): RelvistaSsrBackend | null;
}
