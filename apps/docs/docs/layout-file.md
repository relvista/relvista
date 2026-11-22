---
sidebar_position: 3
title: Layout file format
description: The schema.dbml.layout.json sidecar that stores table positions, views and display settings.
---

DBML describes tables, columns, references, notes and table groups. It has no syntax for where a
table sits on the canvas. **relvista** keeps the `.dbml` file exactly as dbdiagram.io writes it and
stores everything else in a sidecar JSON file named after it: `schema.dbml` →
`schema.dbml.layout.json`. Deleting the sidecar loses only the arrangement; the diagram is laid out
automatically again.

The format is defined by a JSON Schema published at
[`https://relvista.org/schemas/layout-1.json`](pathname:///schemas/layout-1.json)
(draft 2020-12). Point `$schema` at it and editors such as VS Code give you completion and
validation while you edit.

Files written before 1.0 may name an older `$schema` id. They still load, and **relvista** saves
them with `$schema` unchanged. New files get the current id.

## Example

```json title="schema.dbml.layout.json"
{
  "$schema": "https://relvista.org/schemas/layout-1.json",
  "version": 1,
  "views": {
    "*": {
      "nodes": {
        "public.users": { "x": 0, "y": 0, "w": 220 },
        "public.posts": { "x": 320, "y": 0, "collapsed": true },
        "billing.invoices": { "x": 0, "y": 400, "pinned": true },
        "note:overview": { "x": -300, "y": 0, "w": 260, "h": 120 },
        "group:auth": { "x": -20, "y": -40, "w": 600, "h": 360 },
        "group:billing": { "x": 0, "y": 640, "collapsed": true }
      },
      "viewport": { "x": -40, "y": -40, "zoom": 1 },
      "edges": {
        "ref:public.posts(user_id)>public.users(id)": {
          "waypoints": [{ "x": 260, "y": 40 }],
          "sourceSide": "right",
          "targetSide": "left"
        }
      }
    },
    "billing": {
      "nodes": { "public.users": { "x": 600, "y": 400 }, "public.posts": { "collapsed": false } }
    }
  },
  "settings": {
    "detailLevel": "keys",
    "theme": { "colorScheme": "auto", "showGrid": true },
    "x-relvista-view-settings": { "billing": { "detailLevel": "names" } }
  }
}
```

## Fields

| Field                               | Meaning                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                           | Always `1`. A breaking change gets a new schema URL (`layout-2.json`) and version.                                                                                                                         |
| `views`                             | Layouts by view name. `"*"` is the default view.                                                                                                                                                           |
| `views.*.nodes`                     | Placement by stable node id: `x`/`y` top-left corner in diagram units; optional `w`/`h` size overrides (omit to use the measured size); `collapsed` (header only); `pinned` (auto-layout leaves it alone). |
| `views.*.viewport`                  | Camera: `x`/`y` is the diagram point at the canvas top-left; `zoom` > 0.                                                                                                                                   |
| `views.*.edges`                     | Manual edge routing by ref id: `waypoints` (bend points, source to target) and the `sourceSide`/`targetSide` (`top`, `right`, `bottom`, `left`) to attach to.                                              |
| `settings.detailLevel`              | `all` columns, `keys` only (PK/FK), or table `names` only.                                                                                                                                                 |
| `settings.x-relvista-view-settings` | Per-view settings by view name (not `"*"`): `detailLevel` of that view. See [Detail level per view](#detail-level-per-view).                                                                               |
| `settings.theme`                    | Rendering hints (`colorScheme`, `showGrid`, `edgeStyle`). Viewers may ignore them.                                                                                                                         |
| `x-*`                               | Extension keys, allowed at the top level and in `settings`. Tools preserve them; **relvista** reads only its own `x-relvista-view-settings`.                                                               |

Everything else is rejected, so typos show up as errors.

## Notes and groups

- **Sticky notes** (`note:<name>`) take `w` and `h` as their size: the text wraps at the width,
  which is kept between 120 and 640, and `h` is the box height as is (at least 64). The editor
  writes both when you resize a note. Without them a note is 220 wide and as tall as its text.
- **Table groups** (`group:<name>`) with `"collapsed": true` are drawn as one card (the group's
  name and "3 tables") instead of the box with its tables; refs to its tables attach to the card,
  and `x`/`y` place the card. Collapsing is per view like everything else, so a named view can show
  a group collapsed that `"*"` shows open. On a table, `collapsed` keeps only its header.

## Views

A named view inherits from `"*"`: its effective layout is the default view with the named view's
entries merged over it, field by field. A named view therefore stores only what differs: its node
entries may omit `x`/`y` (for example only `collapsed`), and then a later move in `"*"` is inherited.
In `"*"` every node entry needs `x` and `y`. A node that only a named view mentions, without a
position, is placed by auto-layout. The viewport comes from the named view when it has one.

### Detail level per view

`settings.detailLevel` applies to every view. A named view can have its own level under
`settings["x-relvista-view-settings"]`:

```json
"settings": {
  "detailLevel": "keys",
  "x-relvista-view-settings": { "billing": { "detailLevel": "names" } }
}
```

Here `billing` shows table names only and every other view shows keys. In the editor, the detail
switch writes to the open view: in a named view it stores that view's level (picking the
diagram-wide level removes it again), in "All tables" it sets `settings.detailLevel`. Renaming or
deleting a view in the editor moves or drops its entry. Docs diagrams with `view=` start at the
view's level; `detail=` and the toolbar still override it.

It is an extension key, so **relvista** 1.0 loads these files and keeps the key as is; 1.0 just shows
every view at `settings.detailLevel`. An entry relvista cannot read (a misspelt level, a setting
from a later version) is ignored and kept, never an error.

## Stable ids

| Element                           | Id                                                                     | Example         |
| --------------------------------- | ---------------------------------------------------------------------- | --------------- |
| Table                             | `schema.table`, schema always written, `public` when the DBML omits it | `public.users`  |
| Table with a dotted quoted name   | Segments that need it are double-quoted (see below)                    | `x."y.z"`       |
| Sticky note (`Note name { ... }`) | `note:<name>`                                                          | `note:overview` |
| Table group                       | `group:<name>`                                                         | `group:auth`    |

A table-id segment (schema or table name) is written as is unless it is empty, contains one of
`.` `"` `\` `:` `,` `(` `)`, or starts with `<` `>` `-` `?`. Then it is wrapped in `"`, with `"` and `\`
escaped by a backslash: `Table x."y.z"` → `x."y.z"`, `Table "x.y".z` → `"x.y".z`. So two tables
never share an id, and a table id never looks like a `note:` or `group:` id.

Edge keys are ref ids, derived from both endpoints and the relationship operator (also for named
refs): `ref:<tableId>(<columns>)<op><tableId>(<columns>)`, for example
`ref:public.posts(user_id)>public.users(id)`. `#2`, `#3`, … is appended only when refs have exactly
the same endpoints and operator.

Ids come from names, so renaming a table in the DBML renames its entries, and entries for removed
elements can be dropped.

## Deterministic output

The file is meant to live in git next to the DBML, so tools write it the same way every time: keys
sorted, numbers rounded to 2 decimals (`zoom` keeps 4 significant digits), 2-space indent and a
trailing newline. Moving one table changes one or two lines.

## Using a layout file in the docs

Put the file in `static/` and pass its URL:

````md
```dbml layout="/layouts/schema.dbml.layout.json"
...
```
````

See [Usage → Layout files](./usage.mdx#layout-files).
