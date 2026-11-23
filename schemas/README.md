# relvista layout file

`layout.schema.json` defines the **relvista** layout sidecar: a JSON file stored next to a DBML file
and named after it (`schema.dbml` → `schema.dbml.layout.json`).

- `$id`: `https://relvista.org/schemas/layout-1.json` (see
  [decision 0002](../docs/decisions/0002-schema-url.md))
- JSON Schema draft 2020-12
- Current format version: `1`

## Why a sidecar

DBML describes tables, columns, references, notes and table groups. It has no syntax for where a
table sits on the canvas, how big it is, or how an edge is routed. Adding positions to the language
has been requested upstream ([holistics/dbml#53](https://github.com/holistics/dbml/issues/53)), and
the issue is still open. dbdiagram.io keeps positions on its servers, which a static site cannot do.

relvista keeps the `.dbml` file exactly as dbdiagram.io writes it, so the file stays portable, and puts
everything DBML cannot store in this sidecar. Deleting the sidecar loses only the arrangement;
the diagram is then auto-laid out again.

## Shape

```json
{
  "$schema": "https://relvista.org/schemas/layout-1.json",
  "version": 1,
  "views": {
    "*": {
      "nodes": {
        "public.users": { "x": 0, "y": 0, "w": 220 },
        "public.posts": { "x": 320, "y": 0, "collapsed": true },
        "billing.invoices": { "x": 0, "y": 400, "pinned": true },
        "note:overview": { "x": -300, "y": 0 },
        "group:auth": { "x": -20, "y": -40, "w": 600, "h": 360 }
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

| Field                               | Meaning                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                           | Always `1`. A breaking change gets a new `$id` (`layout-2.json`) and version.                                                                                                                              |
| `views`                             | Layouts by view name. `"*"` is the default view.                                                                                                                                                           |
| `views.*.nodes`                     | Placement by stable node id: `x`/`y` top-left corner in diagram units; optional `w`/`h` size overrides (omit to use the measured size); `collapsed` (header only); `pinned` (auto-layout leaves it alone). |
| `views.*.viewport`                  | Camera: `x`/`y` is the diagram point at the canvas top-left; `zoom` > 0.                                                                                                                                   |
| `views.*.edges`                     | Manual edge routing by ref id: `waypoints` (bend points, source to target) and the `sourceSide`/`targetSide` (`top`, `right`, `bottom`, `left`) to attach to.                                              |
| `settings.detailLevel`              | `all` columns, `keys` only (PK/FK), or table `names` only.                                                                                                                                                 |
| `settings.x-relvista-view-settings` | Per-view settings by view name: `detailLevel` of that view (see [Views](#views)).                                                                                                                          |
| `settings.theme`                    | Rendering hints (`colorScheme`, `showGrid`, `edgeStyle`). Viewers may ignore them.                                                                                                                         |
| `x-*`                               | Extension keys, allowed at the top level and in `settings`. Tools preserve them; **relvista** reads only its own `x-relvista-view-settings`.                                                               |

Everything else is rejected (`additionalProperties: false`), so typos show up as errors.

### Views

A named view inherits from `"*"`: its effective layout is the default view with the named view's
entries merged over it, field by field (`mergeViewDefaults` in `@relvista/core`). A named view
therefore stores only what differs: its node entries may omit `x`/`y` (e.g. only `collapsed`), and
then a later move in `"*"` is inherited. In `"*"` every node entry needs `x` and `y`. A node that only a
named view mentions, without a position, is placed by auto-layout. The viewport comes from the named
view when it has one.

`settings["x-relvista-view-settings"]` holds settings of named views by view name (`"*"` is not
allowed): today only `detailLevel`, which overrides `settings.detailLevel` for that view
(`viewDetailLevel` / `withViewDetailLevel` in `@relvista/core`). It lives in `settings` under an
extension key rather than in `views`, because 1.0 rejects unknown keys in a view but keeps `x-*`
keys of `settings` unread, so files that use it still load in 1.0. Like any `x-*` key it accepts any
value: readers ignore entries and values they do not understand (a misspelt level, a setting added
by a later version), so a file never fails to load because of it.

### Stable ids

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

Edge keys are ref ids from the diagram model, derived from both endpoints and the relationship
operator, also for named refs: `ref:<tableId>(<columns>)<op><tableId>(<columns>)`, e.g.
`ref:public.posts(user_id)>public.users(id)`; columns are encoded like segments, and `#2`, `#3`, ...
is appended only when refs have exactly the same endpoints and operator. Edge keys must start with
`ref:`.

Ids come from names, so renaming a table in the DBML must rename its entries (`renameNode`, which also
re-keys the edges of that table's refs), and entries for removed elements can be dropped
(`pruneLayout`).

## Deterministic output

The file is meant to live in git next to the DBML, so `serializeLayout` always writes it the same way:
keys sorted recursively (by code unit), numbers rounded to 2 decimals, 2-space indent, trailing
newline. `zoom` keeps 4 significant digits instead, and a positive `w`/`h` is never rounded below
`0.01`, so a valid layout always serializes to a valid file. `x-*` extension values are written exactly
as given (only their key's position is sorted), except **relvista**'s own `x-relvista-view-settings`,
whose keys are sorted at every depth (its values are still written as given, never rounded). Moving
one table changes one or two lines.

## Copies of the schema

This directory holds the canonical schema. `@relvista/core` ships a byte-identical copy
(`packages/core/layout.schema.json`, exported as `@relvista/core/layout.schema.json`) and embeds it as
a TS module (`src/layout/schema.generated.ts`) for validation. Both are written by
`sync-schema.mjs`, which runs as part of `pnpm -C packages/core build`; a test fails when they drift.
Use `node schemas/sync-schema.mjs --check` in CI to verify without writing.
