---
sidebar_position: 1
title: Getting started
description: Add the relvista plugin to a Docusaurus site and draw your first DBML diagram.
---

**relvista** renders [DBML](https://dbml.dbdiagram.io/docs/), the open-source schema language by
Holistics that dbdiagram.io uses,
as interactive entity-relationship diagrams. The Docusaurus plugin turns every ` ```dbml ` code fence
into a diagram and adds a `<DbmlDiagram>` component for `.dbml` files.

It only adds diagrams. Your theme, colours, fonts, navbar and custom CSS stay exactly as they are:
the plugin does not replace the classic theme, and its styles apply only to the diagrams themselves.
Diagrams follow your site's light and dark mode.

Just want to draw or edit a schema? Use the [editor](./editor.md) in your browser: no install, and
your files stay on your disk. This page is about adding diagrams to a Docusaurus site.

## Requirements

- Docusaurus 3.6 or later with the classic theme or preset (tested with 3.6 and 3.10)
- React 18 or 19 (Docusaurus supports React 19 from 3.7)
- Node 20 or later

:::note A new site on Docusaurus 3.6 to 3.10.0

A fresh install of Docusaurus before 3.10.1 does not build, with or without relvista: today's
webpack rejects the options of its progress bar
(`ValidationError: Invalid options object. Progress Plugin has been initialized…`). Upgrade
Docusaurus to 3.10.1 or later, switch to its faster bundler (`@docusaurus/faster`), or pin webpack:

```json title="package.json"
{
  "overrides": { "webpack": "5.95.0" }
}
```

Yarn calls it `resolutions`, pnpm `pnpm.overrides`. Sites whose lockfile already holds an older
webpack are not affected.

:::

## Install

```bash npm2yarn
npm install @relvista/docusaurus-plugin
```

## Configure

Add the plugin to `docusaurus.config.ts`:

```ts title="docusaurus.config.ts"
import type { Config } from '@docusaurus/types';

const config: Config = {
  // ...
  plugins: ['@relvista/docusaurus-plugin'],
  themeConfig: {
    // Optional: defaults for every diagram on the site.
    dbml: {
      height: 480, // px, or any CSS length such as '60vh'
      detailLevel: 'all', // 'all' | 'keys' | 'names'
      toolbar: ['view', 'search', 'detail', 'zoom', 'fit', 'fullscreen', 'export', 'print', 'link'],
      palette: 'site', // 'site' | 'relvista'
    },
  },
};

export default config;
```

| `themeConfig.dbml` | Default       | Meaning                                                                                                                                                                                      |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `height`           | `480`         | Height of each diagram. A number is pixels; a string is any CSS length.                                                                                                                      |
| `detailLevel`      | `'all'`       | `all` columns, `keys` only (primary and foreign keys, unique columns), or table `names` only.                                                                                                |
| `toolbar`          | every button  | Toolbar buttons in order: `view`, `search`, `detail`, `zoom`, `fit`, `fullscreen`, `export`, `print`, `link`, `open-in-editor` ([toolbar](./usage.mdx#toolbar-fullscreen-export-and-print)). |
| `editorUrl`        | hosted editor | Base URL of the relvista [editor](./editor.md) for the "Open in editor" button; `false` hides it.                                                                                            |
| `palette`          | `'site'`      | `site`: diagrams take your site's Infima colours and fonts; `relvista`: relvista's own palette (see [Colours](./colours.md)).                                                                |
| `ssr`              | `true`        | Draw each diagram as a static SVG at build time, shown before (and without) JavaScript (see [Usage](./usage.mdx#build-time-pictures)).                                                       |

The one plugin option, `highlight` (default `true`), adds DBML syntax highlighting for
` ```dbml static ` blocks and the Source tab: `plugins: [['@relvista/docusaurus-plugin', { highlight: false }]]`.

### Without preset-classic

With `@docusaurus/preset-classic` (the default for new sites) the line above is all you need. If
your site lists `@docusaurus/theme-classic` in `themes` instead of using the preset, register
relvista in `themes` too, after the classic theme, so that its MDX code wrapper (`MDXComponents/Code`) loads last:

```ts title="docusaurus.config.ts"
themes: ['@docusaurus/theme-classic', '@relvista/docusaurus-plugin'],
```

Registered under `plugins` in that setup, ` ```dbml ` fences would stay code blocks; the build
prints a `[relvista]` warning when it detects this.

## Your first diagram

Write a fenced code block with the language `dbml` in any Markdown or MDX page:

````md title="docs/schema.md"
```dbml
Table users {
  id integer [pk]
  email varchar [unique]
}

Table posts {
  id integer [pk]
  author_id integer [ref: > users.id]
  title varchar
}
```
````

It renders as:

```dbml height=300
Table users {
  id integer [pk]
  email varchar [unique]
}

Table posts {
  id integer [pk]
  author_id integer [ref: > users.id]
  title varchar
}
```

Drag the tables, scroll to zoom, hover a table to trace its relationships and click it for details.
The toolbar [searches](./exploring.mdx) the diagram, changes the detail level, exports it
(SVG, PNG, PDF), copies a link to it, and **Open in editor** opens it in the
[editor](./editor.md).

## TypeScript

To import `.dbml` files, `@theme/DbmlDiagram` and `@theme/DbmlDiff` with types, add the plugin's client types to your
site's `tsconfig.json`:

```json title="tsconfig.json"
{
  "extends": "@docusaurus/tsconfig",
  "compilerOptions": {
    "types": ["@docusaurus/module-type-aliases", "@relvista/docusaurus-plugin/client"]
  }
}
```

Next: [all the ways to use it](./usage.mdx), [diagram views](./views.mdx) and
[schema diffs](./diff.mdx).
