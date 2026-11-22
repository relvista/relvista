---
sidebar_position: 1.5
title: Editor
description: Edit DBML files in the browser with a live, editable ER diagram. Files stay on your disk.
---

The **relvista editor** is a DBML code editor with a live entity-relationship diagram next to it.
It runs entirely in your browser: there is no account and no server, and your files never leave
your machine.

**[Open the editor →](pathname:///editor/)**

## What it does

- **Code:** syntax highlighting, live errors and warnings, completion, hover, go to definition,
  find references and quick fixes for DBML, powered by the official `@dbml/parse`. Projects split
  over several files with `use` / `reuse` open as tabs.
- **Diagram:** updates as you type and keeps the last valid diagram while the code has an error.
  Drag tables, sticky notes and whole table groups; Shift+click or Shift+drag to select several;
  pin or collapse a table from its context menu; auto-layout everything that is not pinned.
  Click a table to jump to its code; put the cursor in a block to highlight its node. Refs are
  routed around the tables in their way.
- **Edit on the canvas:** add and write [sticky notes](#sticky-notes), set
  [colours](#colours-and-inactive-refs), mark refs inactive, collapse
  [table groups](#collapsing-groups) and manage [views](#views) without touching the code — each
  change is written into your DBML, and only the bytes of what you changed move.
- **Explore:** [search, relationship paths, detail levels and focus](#search-path-and-focus), and
  [deep links](#deep-links) to any of them.
- **Compare** the document with another version: a [schema diff](#compare) on the diagram and in
  the code.
- **Export:** SVG, PNG, a [tiled or per-view PDF](#export), print, the DBML file, the layout JSON,
  and SQL for PostgreSQL, MySQL, SQL Server, Oracle and Snowflake. **New ▸ From SQL** (or opening
  a `.sql` file) imports a SQL schema.
- **Light and dark themes**, shared with this site. Works on a phone: below 768 px the code and the
  diagram become two tabs. On a touch screen, press and hold a table, note, group, ref or the empty
  canvas to open the menu a right-click opens.

## Files and the layout sidecar

DBML cannot store table positions, so the editor keeps them in a small file next to your schema:
`schema.dbml` gets `schema.dbml.layout.json` (the [layout file](./layout-file.md) the Docusaurus
plugin reads too). It is written only after you change the layout: opening and saving a file never
creates one.

**Open folder** is the best way to work. The editor then reads and writes the sidecar silently, and
multi-file projects resolve their `use` imports. The entry file is `main.dbml` if there is one,
otherwise the only `.dbml` file at the top, otherwise you pick it. When you open a single file
instead, the first save that needs a sidecar asks you once where to put it.

You can also open a file from a URL, drop files on the window, or start from one of the
[gallery examples](./gallery/index.mdx).

### Opening a URL

**Open › Open from URL…** or a link to the editor with `?url=` downloads a `.dbml` file from any
server that allows cross-origin requests (CORS); GitHub `blob` links are rewritten to their raw
file. Only the `.dbml` file is requested unless you ask for its layout too, because probing for a
layout file that does not exist shows up as a 404 error in the browser console:

| Link                                       | Layout                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| `/editor/?url=<file>`                      | none: tables are placed automatically                     |
| `/editor/?url=<file>&layout`               | `<file>.layout.json` next to it, if there is one          |
| `/editor/?url=<file>&layout=<layout file>` | that file (a full URL, or a path relative to the `.dbml`) |

In the dialog, **Also load its layout file** does the same as `&layout`. Encode the file URL
(`encodeURIComponent`) when it has its own query string.

## Saving guarantees

relvista never reformats your file. A file you open and save unchanged is written back **byte for
byte**. When you edit it, only the lines you changed change: the byte order mark, CRLF, LF or mixed
line endings and the presence of a final newline are kept. Every example in the repository is
checked this way, in twelve variants (line endings, BOM, tabs, trailing whitespace, unicode), on
every commit, together with a hand-written file that uses every DBML feature and edge cases such as
empty files and a lone CR.

Your work is also autosaved in the browser (IndexedDB). Reloading the page brings back the text,
the layout and the view; **Open ▸ Restore previous session** goes one step further back. If you try
to leave with unsaved changes, the browser asks first.

## Share links

**Share** copies a link that contains the whole schema, compressed into the part of the URL after
`#`, plus the layout and the current view if you want. The link is never sent to a server: whoever
opens it gets the diagram straight from the URL. Very large schemas make long links; past a few
megabytes, save the file instead. A link carries one file, so for multi-file projects it shares the
entry file only.

Every diagram in these docs has an **Open in editor** button that does the same thing.

## Sticky notes

Press **Note** in the diagram toolbar, choose **Add note here** in the canvas's context menu, or
press <kbd>N</kbd> with the diagram focused: a new note appears and opens for writing. Double-click
a note (or select it and press <kbd>Enter</kbd> or <kbd>F2</kbd>) to edit its text in place;
<kbd>Mod</kbd>+<kbd>Enter</kbd> or clicking elsewhere keeps the text, <kbd>Esc</kbd> cancels.
Drag a note's edges to resize it (the size goes into the [layout file](./layout-file.md) as
`w`/`h`); <kbd>Delete</kbd> removes the selected notes. Notes are ordinary DBML `Note` blocks, so
dbdiagram.io shows the same notes. <kbd>Mod</kbd>+<kbd>Z</kbd> in the code undoes a text change,
on the diagram a layout change.

## Colours and inactive refs

Right-click a table, group or note (or open its menu with the keyboard) and choose **Colour ▸**: a
palette of twelve swatches, **Custom…**, or **Default** to remove the colour. Tables get a
`headercolor`, groups, notes and refs a `color` setting in the DBML, so the colours travel with the
file. Right-click a ref for its colour and **Mark inactive** / **Mark active** (an inactive ref is
drawn dashed). With several elements of one kind selected, the change applies to all of them. A
ref written inline on a column (`[ref: > users.id]`) has no settings list to write to: its menu
says **Edit this ref in code**.

## Collapsing groups

A collapsed `TableGroup` shows as one card with its name and table count, and refs to its tables
attach to the card. Collapse or expand a group from its menu, by double-clicking its header, or all
at once with **Collapse all groups** / **Expand all** in the **Auto-layout** menu. Collapsing them
all packs the cards together (one undo step) and fits the view, so a large schema becomes a
readable map of its areas; **Expand all** puts every table back where it was. The state is saved
in the [layout file](./layout-file.md) (`collapsed` and the card's position on the group's entry),
per view.

## Views

The view menu in the top bar lists the file's `DiagramView`s, with a filter field when there are
more than seven, and manages them:

- **New view from selection** — select tables, groups or notes, then name the view;
- **Edit view…** — its name, and which tables (grouped by schema), groups, notes and schemas it
  shows, or **All tables**;
- **Delete view…**;
- on a table: **Add to view ▸** and **Remove from view**.

Every view keeps its own layout; renaming or deleting a view renames or deletes its layout too. See
[Diagram views](./views.mdx).

## Search, path and focus

<kbd>Mod</kbd>+<kbd>K</kbd> (or <kbd>/</kbd> with the diagram focused, or the magnifier) opens the
search over the diagram: tables, columns, enums, groups, notes and views. Picking a result centres
and lights it and shows its code without moving your cursor. **Path** mode lights the shortest
chain of refs between two tables. The detail switch (or <kbd>1</kbd> / <kbd>2</kbd> /
<kbd>3</kbd>) shows table names only, keys, or every column, and is saved in the layout file for
the open view: a named view keeps its own level ([per-view detail](./layout-file.md#detail-level-per-view)).
**Show related ▸ 1 / 2 / 3 hops** in a table's menu focuses on its neighbourhood. They work as in
the docs: see [Exploring diagrams](./exploring.mdx).

## Deep links

The editor's address carries what you are looking at: `#view=billing&table=invoices&vp=…`. It is
kept up to date as you work (without history entries) and applied again on reload, so you can
bookmark a place in a schema. A link can combine it with `?url=` to open a file and go straight to
a table: `/editor/?url=<file>#table=orders&hops=1`. The keys are the ones of
[docs deep links](./exploring.mdx#deep-links). The **Share** dialog's **Include position** adds the
current table and position to a share link.

## Compare

**Compare…** in the top bar (<kbd>Mod</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>) compares the document
with another version of it, taken from a **file**, **pasted** text, a **URL**, or — for a file
opened from GitHub — another **Git ref** (branch, tag or commit). The diagram then shows the
[schema diff](./diff.mdx): added, removed and changed tables, columns and refs in green, red and
amber; a **Changes** panel lists them (filter, click to go to one); the code pane becomes a
side-by-side diff. Edit on: the diff follows. **Copy summary** copies the changes as Markdown;
export gives the toned picture; <kbd>Esc</kbd> or **Exit compare** goes back.

## Export

**Export ▾** downloads the diagram as **SVG** or **PNG**, opens the **PDF…** dialog (tiled at
print scale, or one page per view; A4 or Letter; see [Export and print](./export.md)), prints, and
saves the DBML file or the layout JSON. **SQL** exports go to PostgreSQL, MySQL, SQL Server,
Oracle and **Snowflake** — multi-file projects too. Snowflake records but does not enforce foreign
keys and has no enum type or secondary indexes: the export says so in comments and maps enums to
`VARCHAR`. `Records` blocks become `INSERT` statements in single-file exports to the first four
dialects; Snowflake exports and exports of multi-file projects leave them out (the editor tells
you when that happens).

## Keyboard shortcuts

Mod is <kbd>Cmd</kbd> on macOS and <kbd>Ctrl</kbd> elsewhere. Press <kbd>?</kbd> in the editor for
the full list.

| Keys                                                                       | Action                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| <kbd>Mod</kbd>+<kbd>S</kbd>                                                | Save                                                     |
| <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>                               | Save as (Save folder as… for a folder)                   |
| <kbd>Mod</kbd>+<kbd>O</kbd>                                                | Open file                                                |
| <kbd>Mod</kbd>+<kbd>Z</kbd> / <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo / redo (text in the code, else layout)              |
| <kbd>Mod</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd>                                 | Auto-layout (keeps pinned tables)                        |
| <kbd>Mod</kbd>+<kbd>K</kbd>, <kbd>/</kbd> (diagram focused)                | Search tables, columns, views; relationship paths        |
| <kbd>Mod</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>                                 | Compare with another version                             |
| <kbd>Alt</kbd>+<kbd>1</kbd> / <kbd>Alt</kbd>+<kbd>2</kbd>                  | Focus the code / the diagram                             |
| Arrows (<kbd>Shift</kbd>: 1 px)                                            | Move the selected tables (diagram focused)               |
| <kbd>Enter</kbd>                                                           | Show the focused table's code (diagram focused)          |
| <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd>                                 | Detail: names / keys / all columns (diagram focused)     |
| <kbd>N</kbd>                                                               | New sticky note (diagram focused)                        |
| <kbd>Enter</kbd> / <kbd>F2</kbd>                                           | Edit the selected sticky note                            |
| <kbd>Mod</kbd>+<kbd>Enter</kbd> / <kbd>Esc</kbd>                           | Finish / cancel editing a note                           |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd>                                   | Delete the selected sticky notes                         |
| <kbd>Shift</kbd>+<kbd>1</kbd>, <kbd>+</kbd>, <kbd>−</kbd>                  | Fit, zoom in, zoom out (diagram focused)                 |
| <kbd>Esc</kbd>                                                             | Close search, clear the highlight, exit focus or compare |

## Browser support

| Browser                    | Open and save                                                             |
| -------------------------- | ------------------------------------------------------------------------- |
| Chrome, Edge, Opera, Brave | Saves straight back to your files (File System Access API); recent files. |
| Firefox, Safari            | Opens through the file picker; **Save** downloads the file (same bytes).  |

Everything else (editing, diagram, share links, export) works the same in every current browser.
