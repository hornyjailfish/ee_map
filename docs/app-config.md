# App config — how it works

A short guide to what `app_config` is, how labels/overlays work, and what each
view reads. For “how do I change a knob?”, use `src/lib/config/README.md`.

## Big picture

```text
DB schema (tables + fields)     app_config:<id> (sparse overlay)
        │                                    │
        ▼                                    ▼
  AutoProfile (introspect)  +  soft-parsed overlay
                    │
                    ▼
              merge() → ResolvedConfig
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     table view  graph view  map view
```

- **Schema** owns structure (what tables/fields exist, types, permissions).
- **Overlay** owns meaning (labels, which tables are graph nodes / map layers,
  column order, sort, display recipes).
- **Views never read the raw overlay** — they only consume `ResolvedConfig`.

The overlay is *sparse*: omit a key and merge falls back to heuristics
(e.g. a field named `name`, a `geometry` field for map layers).

### Which `app_config` row is active?

You can keep several overlay records in one database (e.g. `main`, `map-related`)
to try config changes without wiping the seeded baseline.

| Priority | Source |
| --- | --- |
| 1 | Cookie `sdb_app_config` (set from **/config** → Active overlay record) |
| 2 | Env `APP_CONFIG_ID` (default `main`) |
| 3 | Hard default `main` |

- **Seed** still UPSERTs / INSERT IGNORE only `app_config:main` — it will not
  overwrite your other test ids.
- **Save** on `/config` writes the *active* id.
- **Switching** id only changes the cookie; draft is not auto-saved. Create a new
  id by typing it and clicking Use, then Save to UPSERT that row.

---

## Overlay buckets (v3)

Stored as one row: `app_config:<id>` (usually `main`).

| Bucket | Purpose |
| --- | --- |
| `excludeTables` | Hide tables from the product entirely (plus anything matching `/^__/`). |
| `entities.<table>` | Identity + **table/grid** presentation only. |
| `graph.nodes.<table>` | Graph membership + role / parent / label fields. |
| `graph.edges.<rel>` | Relation-table roles for wires. |
| `graph.layout` | ELK layout globals. |
| `map.*` | Map globals (`units`, `plane`, `levelsTable`, …). |
| `map.layers.<table>` | Map membership + geometry / level / style. |
| `search.fieldsByTable` | Which text fields header/search may query. |

**Membership is derived, never stored as `views: []`:**

- On **table** unless `entities.t.table === false` or excluded.
- On **graph** iff `graph.nodes.t` exists with a real role.
- On **map** iff `map.layers.t` exists and a geometry field resolves.

Older seeds/editors may still nest `entities.t.graph|map` (v1). That shape is
lifted to v3 on every read (`overlay-io.ts`) and is not what you should write
in new seeds.

---

## Entity identity & labels

```js
entities: {
  boards: {
    label: 'Boards',           // human name for the table
    display: { field: 'name' } // how a board looks when referenced
  }
}
```

### Single field vs combined (“parts”)

`display` is the recipe used when **another table points at this one**
(FK cells, pickers, map inspector record links):

```js
// Sugar — one path
display: { field: 'name' }

// Same thing after merge
display: { parts: [{ path: 'name' }], sep: ' · ' }

// Combined label from several paths
display: {
  parts: [
    { path: 'room.name' },
    { path: 'name' }
  ],
  sep: ' · '           // default if omitted
}
// → "Room A · Board 3"
```

### Nested / dotted paths (accessors)

Any display path may hop record links:

| Path | Meaning |
| --- | --- |
| `name` | Field on **this** row |
| `room.name` | Follow `this.room` → that row’s `name` |
| `marker.zone.name` | Two hops |

Rules:

1. **Merge** only checks that the **first** segment exists on the table.
2. Later segments resolve at **runtime** while loading related rows
   (`record-label.ts` BFS).
3. Link/filter keys stay single-segment: `parentField`, `levelField`,
   `geometryField`, `sort.field`, `search.fieldsByTable[]`.

Column-only override (grid cell for one FK column):

```js
entities.markers.table.fields.closest_shop.display = { field: 'name' }
```

---

## Table (grid) knobs

Under `entities.<table>.table`:

| Key | Effect |
| --- | --- |
| `hide` | Columns omitted from the grid |
| `readOnly` | Visible but not editable |
| `order` | Preferred column order |
| `sort` | Default sort (`'name'`, `{ field, dir }`, or multi-key array) |
| `fields.<col>` | Per-column `label`, `hidden`, `editor`, `width`, `display` |

`editor`: omit → type default; `false` → locked; string → registry key
(`text`, `combo`, `image`, …).

---

## Graph

```js
graph: {
  layout: { direction: 'DOWN', align: 'center', spacing: { … } },
  nodes: {
    boards: { role: 'board', parentField: 'room', labelField: 'name' }
  },
  edges: {
    connects: { role: 'feeds', labelField: 'cable' }
  }
}
```

- **role** drives hierarchy packing (`room → board → breaker → …`).
- **parentField** is the FK on the child pointing at the parent table.
- **labelField** / **subtitleField** may be dotted accessors.
- Omit a table from `nodes` → not on the graph (no `role: 'ignore'` needed).

---

## Map

```js
map: {
  units: 'm',
  plane: 'xy-meters',
  levelsTable: 'levels',
  levelOrderField: 'ord',
  layers: {
    rents: {
      levelField: 'level',
      geometryField: 'geometry',
      layerGroup: 'tenancy',
      styleKey: 'rents',
      zIndex: 20,
      // Optional: label/inspector enrichment from another table
      related: {
        table: 'shops',  // related rows
        via: 'area',     // shops.area → this rents row
        labelField: 'name'
      }
    }
  }
}
```

| Key | Effect |
| --- | --- |
| `geometryField` | Which field holds GeoJSON / Surreal geometry |
| `levelField` | Floor filter FK; omit for self-level layers (e.g. `levels`) |
| `styleKey` | Client style registry key |
| `zIndex` / `layerGroup` | Draw order / grouping |
| **`related`** | Inverse link used for **map labels** and the feature panel |

### `related` (map labels without moving geometry)

Geometry stays on the layer table (`rents`). Another table (`shops`) points
**at** it (`shops.area → rents`). Config declares that inverse once:

1. Map load fetches related rows (`WHERE via IS NOT NONE`).
2. Feature **label** prefers `related.labelField` when present, else the layer
   row’s own name (vacant unit → rent code).
3. Feature panel can show/assign that related row (combo / create) — still no
   schema change; writes go to the related table’s FK field.

This is **not** the same as `marker_views` (1→N child cards). `related` is
meant for **1→1 display identity** on a geometry feature (shop brand on a rent
polygon). Future extras (electrical path, etc.) can add more related entries
later without changing the geometry table.

---

## Transform pipeline (overlay → pixels)

| Step | Where | What |
| --- | --- | --- |
| Introspect | `server/config/introspect.ts` | Live `INFO … STRUCTURE` → AutoProfile |
| Load overlay | `server/config/load-overlay.ts` | `SELECT app_config:main` |
| Soft parse + lift | `config/overlay-io.ts` | v1/v2 → v3, preserve unknown keys |
| Merge | `config/merge.ts` | AutoProfile + overlay → `ResolvedConfig` + diagnostics |
| Resolve (cached) | `server/config/resolve.ts` | Per session/ns |
| Table rows | `transform/to-table.ts` | Columns, sort, cell display |
| Graph | `transform/to-graph.ts` + `to-elk.ts` | Nodes/edges + layout |
| Map | `transform/to-map.ts` | Layers → features (metric XY only) |
| FK labels | `transform/record-label.ts` | Dotted `display` paths against a row store |

Client registries (`styles`, `nodes`, `edges`, editors) map **string keys** from
config to UI — components never live inside the overlay JSON.

---

## Mental model cheatsheet

| Question | Answer |
| --- | --- |
| Where do I rename a table in the UI? | `entities.t.label` |
| How does a FK cell show text? | Target `entities.x.display` (or column override) |
| How do I put a table on the map? | Add `map.layers.t` with resolvable geometry |
| How do I put it on the graph? | Add `graph.nodes.t` with a real `role` |
| Why is my layer missing? | Check merge diagnostics (`map_layer_incomplete`, orphans) |
| Can I store `views: ['map']`? | No — derived from layer/node presence |
| Schema vs overlay? | Schema = columns exist; overlay = how product uses them |

---

## Files to open next

| Concern | File |
| --- | --- |
| Types | `src/lib/config/types.ts` |
| Merge rules | `src/lib/config/merge.ts` |
| Change routine / pitfalls | `src/lib/config/README.md` |
| EE seed | `database/seed/99-app_config.surql` |
| Design history | `PLAN.md` (config section) |
| Larger overhaul ideas | `APPCONFIG.md` (plan only) |
