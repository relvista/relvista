---
sidebar_position: 1.9
title: Export and print
description: Download a diagram as SVG, PNG or a tiled or per-view PDF, print it, and rely on the static SVG every docs page carries without JavaScript.
---

Every diagram — in the [editor](./editor.md) and in your docs — exports what it shows: the current
view, the detail level, the colour mode and colours, tables you dragged where you left them, and
any search, path or [diff](./diff.mdx) tones that are on screen.

## SVG and PNG

The toolbar's **Export** menu (the download icon) has:

- **Download SVG** — a standalone vector file with its styles embedded, for slides, wikis and
  design tools. Text stays text: it is searchable and sharp at any size.
- **Download PNG** — a bitmap at twice the screen resolution, for chats and issue trackers.

The file is named after the diagram's title (`Shop` → `shop.svg`).

## PDF

**Export ▸ PDF…** opens the PDF dialog. The PDF is vector (text stays text) and is built in your
browser; the library loads only when you open the dialog.

**Pages**

- **Tiled** — the diagram at print scale, across as many pages as it needs. Each page overlaps
  its neighbours (10 mm by default, up to 30 mm) and carries cut marks, its tile name (`B2`, with
  the names of its neighbours at the edges) and its page number; an overview page comes first,
  with the grid's row letters and column numbers in its margins, so a large schema becomes a
  poster you can tape together. Pages that would hold nothing but stray relationship lines are
  left out (**Skip empty pages**, on by default): they keep their place in the grid, so `B2` is
  still row B, column 2, and the overview crosses them out. The dialog shows the page count as you
  change the options ("24 pages (6 × 5, 6 empty left out)").
- **One page per view** — every [view](./views.mdx) you tick, scaled to fit its own page: a
  handout with one page per area of the schema. A view with no tables or notes is left out, and
  the page count says so ("5 pages, one per view, 1 empty view left out").

**Options:** paper **A4** or **Letter**, orientation **Automatic**, **Portrait** or **Landscape**,
**Scale** from 50 to 200 % (tiled), overlap, cut marks and page labels, overview page, skip empty
pages.

Text in Latin letters beyond Western European ones (Polish, Czech, Turkish, Vietnamese…), Greek,
Cyrillic, Chinese or Japanese (ideographs and kana) stays text you can select and search: the PDF
embeds the glyphs it uses from Noto Sans or Droid Sans Fallback. The fonts load
only when a diagram needs them (about 0.2 MB, or 2 MB for CJK), and a page typically grows by
30–90 KB. CJK text is drawn in one weight, so CJK table names are not bold.

A page whose text uses characters these fonts lack (Arabic, Hebrew, Korean Hangul, Indic scripts,
emoji, rare CJK ideographs, accents that have no precomposed letter) is embedded as a
high-resolution image instead (each tile rendered on its own at three times the print size): it
prints correctly, but its text cannot be selected. The dialog warns before you export when table or
column names need it; other text (types, notes, group names) is checked as the PDF is written.
Arabic and Hebrew stay images because the PDF writer cannot lay out right-to-left text or join
Arabic letters.

## Print

The toolbar's **Print** button prints just the diagram, scaled to fit a landscape page, in light
colours. Printing the whole docs page (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>P</kbd>) prints every
diagram on it as the sharp, static SVG described below, one per box.

## Static SVG in your docs

The [Docusaurus plugin](./usage.mdx#build-time-pictures) draws every diagram into the page's HTML
when the site is built. That picture:

- shows **without JavaScript**, before the interactive viewer has loaded, and to search engines
  and link previews, which see every table and column name;
- is what **printing** a page uses;
- follows the site's **light and dark** theme without JavaScript (its colours are CSS variables);
- is replaced **in place** by the interactive viewer, with the same table positions, so nothing
  jumps.

To get the SVG file of a docs diagram, use **Export ▸ Download SVG**; the static picture in the
HTML is styled by the site's CSS and is not meant to be copied out on its own.

## In the editor

The editor's **Export** menu has the same SVG, PNG and PDF exports for the diagram (the PDF dialog
can export every view of the file at once), plus the DBML file, the layout JSON and SQL for
PostgreSQL, MySQL, SQL Server, Oracle and Snowflake. See [the editor](./editor.md#export).
