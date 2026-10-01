# App Config Overlay — reference & change routine

The config layer is the product spine: live DB schema + a sparse JSON overlay →
one `ResolvedConfig` that drives the table, graph, and map views. This file is the
single place to understand how that works and the routine for changing it.

> Companion doc: `PLAN.md` (section **0. Configuration layer**) holds the original
> design intent. This file is the "how to actually touch it" version.

## 1. The two inputs

| Input | Source | Owner | Changes when |
| --- | --- | --- | --- |
| **AutoProfile** | `INFO FOR DB/TABLE STRUCTURE` on `locals.session` | ephemeral (`introspect.ts`) | schema add/remove field/table |
| **Overlay** | one `app_config:main` row in the active DB | SurrealKit seeds + OWNER `/config` UI | EE meaning, labels, graph roles, map layers, sort, display |

Schema owns **structure**; overlay owns **meaning**. Never hand-maintain a
per-field TS catalog — that reintroduces drift; `ResolvedConfig` is what views
consume.

```text
INFO STRUCTURE ─► AutoProfile ─┐
                               ├─ merge ─► ResolvedConfig ─► to-table / to-graph / to-map
SELECT app_config:main ─► overlay ─┘
```

## 2. Where everything lives

| Concern | File |
| --- | --- |
| Overlay & resolved **types** | `src/lib/config/types.ts` |
| Merge (overlay + auto → `ResolvedConfig`) | `src/lib/config/merge.ts` |
| Soft parse, version lift, editor bridge | `src/lib/config/overlay-io.ts` |
| Public exports | `src/lib/config/index.ts` |
| Introspect (live `INFO … STRUCTURE`) | `src/lib/server/config/introspect.ts` |
| Read overlay (`SELECT app_config:main`) | `src/lib/server/config/load-overlay.ts` |
| Write overlay (`UPSERT app_config:main`) | `src/lib/server/config/save-overlay.ts` |
| Cache + orchestration | `src/lib/server/config/resolve.ts` |
| Seeds (EE defaults / patches) | `database/seed/99*.surql` |
| OWNER editor | `src/lib/components/config/ConfigEditor.svelte` (+ `src/routes/config`) |
| Tests | `merge.test.ts`, `overlay-io.test.ts`, `seed-overlay.test.ts`, `load-overlay.test.ts`, `resolve.test.ts`, `resolve.integration.test.ts` |

## 3. Versions (v1 → v2 → v3)

- **v1** — nested `entities.<t>.{graph,map}` + top-level `edges`. Deprecated input.
- **v2** — slim `entities` (identity + grid only); participation moved to
  `graph.nodes`, `graph.edges`, `map.layers`.
- **v3** — the marker-split model (legacy `embeddings` → `markers` + `marker_views`),
  plus the **accessor** contract. Current written contract.

`OVERLAY_VERSION = 3`. Older docs are migrated on **read** by `liftOverlayToV3`
and never re-written until the next OWNER save. `ResolvedConfig.version` is always `3`.

## 4. The overlay shape (contract, shortened)

```ts
type AppConfigOverlay = {
  version: 1 | 2 | 3;
  excludeTables?: string[];            // dropped from the product entirely
  entities?: Record<string, {          // key = table name — identity + grid
    label?: string;
    display?: { field?: string; parts?: Array<{ path: string }>; sep?: string };
    table?: false | {                  // grid presentation only
      hide?: string[]; readOnly?: string[]; order?: string[];
      sort?: string | { field; dir? } | (string | { field; dir? })[];
      fields?: Record<string, {        // per-column overrides
        label?; hidden?; editor?: false | string; width?; display?;
      }>;
    };
  }>;
  graph?: { layout?: {...}; nodes?: Record<string, GraphNodeOverlay>; edges?: Record<string, EdgeOverlay> };
  map?: { units; plane; extent?; levelsTable?; levelOrderField?; floorPlan?; layers?: Record<string, MapLayerOverlay> };
  search?: { fieldsByTable?: Record<string, string[]> };
};
```

Full definitions live in `types.ts`. Unknown top-level **and** nested keys are
preserved by design (soft contract), so the shape can grow without migrations.

### Membership is derived, never stored

- `table` ∈ views unless `entities[t].table === false` or excluded.
- `graph` ∈ views iff `graph.nodes[t]` exists with a real role (no `role: "ignore"`).
- `map` ∈ views iff `map.layers[t]` exists and a geometry field resolves.

`ResolvedEntity.views[]` is computed in `merge` — do **not** dual-write membership into the overlay.

## 5. Dotted accessors

Any path that names a field may hop record links: `name`, `room.name`,
`marker.zone.name`. Applies to `display.field`, `display.parts[].path`,
`entities.<t>.table.fields.<col>.display`, and graph `labelField`/`subtitleField`.

- **Merge validates only the root segment** against the table's fields; later
  segments are resolved at runtime (`record-label.ts` / `loadRecordLabels` BFS).
- `parentField`, `map.layers.*.levelField/geometryField`, `sort.field`, and
  `search.fieldsByTable` stay single-segment (they are filter/link keys, not labels).

## 6. The routine (make a config change)

Use this as a checklist. Steps grouped by what's changing.

### A. Add / rename / remove a **field knob** (label, editor, width, hide, readOnly, sort)

1. Add the type to `types.ts` (overlay + resolved side, e.g. `FieldOverlay` → `ResolvedField`).
2. Consume it in `merge.ts` (`resolveFields`, `resolveEntitySort`, …). Keep booleans fallible default `false`.
3. If it surfaces in the editor, expose it in `ConfigEditor.svelte` (remember it edits the **v1** shape via `overlayV3toV1`; see §7).
4. Update the seed in `database/seed/99-app_config.surql` (canonical) **and** its mirror in `seed-overlay.test.ts`.
5. Add a focused test in `merge.test.ts`.

### B. Add a **graph node / map layer** for a table

1. Add the node/layer under `graph.nodes.<t>` / `map.layers.<t>` in the seed +
   `seed-overlay.test.ts` mirror.
2. If it's a brand-new concept, extend `GraphNodeOverlay` / `MapLayerOverlay` in
   `types.ts` and the corresponding `resolveGraph` / `resolveEntityMap` / `buildMapLayers` in `merge.ts`.
3. Map-layer tables must expose a real geometry field; `buildMapCrudMeta` + `to-map`
   consume `map.layers`. Style keys are strings resolved by the client registry
   (`src/lib/client/registries/styles.ts`) — never embed components in config.

### C. Add / rename a **table in the domain** (not just a knob)

1. Change the schema in `database/schema/*.surql` (SurrealKit owns structure).
2. Regenerate types (`surrealkit typegen` → `src/lib/types/`). Those are write hints only, not view drivers.
3. Update the overlay seed: entity entry + (if needed) graph/map/view-scoped keys.
4. If it *replaces* an existing table (rename/split), add an idempotent migration to `liftOverlayToV3` (§7) and an additive patch seed (`99e-*.surql` pattern).
5. Update `seed-overlay.test.ts` (fixture + assertions) and the live-DB `resolve.integration.test.ts` expectations.

### D. Bump the contract / new model shape

1. `OVERLAY_VERSION` in `overlay-io.ts`; widen the `version` unions in `types.ts`.
2. Add the migration to `liftOverlayToV3` — must be **idempotent** (no-op when already migrated).
3. Update the version-accepting `overlaySchema` + error message in `overlay-io.ts`.
4. Add a migration test in `overlay-io.test.ts` (old fixture in → new shape out; run twice → unchanged).
5. Update the seed + `seed-overlay.test.ts` + integration test.

## 7. Migration & the editor bridge (the tricky bits)

`overlay-io.ts` has two opposite transforms on top of the version lift:

- **`liftOverlayToV3(raw)`** — old → current, runs on every read (`softParseOverlay`,
  `normalizeOverlay`, `merge`). Does the structural v1→v2 lift **and** the
  v2→v3 `migrateMarkerModel` (`embeddings` → `markers`/`marker_views`). Idempotent.
- **`overlayV3toV1(overlay)`** — current → v1 **editor shape**. `ConfigEditor` only
  edits the nested v1 layout; its output is lifted back to v3 by `softParseOverlay`
  on save. Purely structural passthrough — must round-trip without data loss.

Rules that keep this safe:

- `softParseOverlay` strips Surreal `id`, accepts `version: 1|2|3`, and preserves
  unknown top-level **and** nested keys (future-proofing).
- Canonical document id is **`app_config:main`** for both read (`load-overlay.ts`) and
  write (`save-overlay.ts`). Never split these again — that's how `v1`/`v2` records diverged in the past.
- Seeds use `INSERT IGNORE` (canonical) so OWNER edits survive re-seed. Additive
  runtime patches use `UPDATE app_config:main SET … WHERE id = app_config:main`.

## 8. Pitfalls / gotchas

- **Read id ≠ write id** breaks everything silently. Both are `app_config:main`.
- **`merge` re-lifts** the overlay even after `softParseOverlay` already did;
  keep `liftOverlayToV3` idempotent.
- **Dotted paths**: only the root segment is validated at merge time; hops resolve at
  runtime. Don't warn on the full dotted path.
- **`graph`/`map` keys on `entities` are v1 leftover input**; after lift they live
  under `graph.nodes` / `map.layers`. Don't add new nested `entity.graph`/`entity.map`.
- **Membership is derived** — a table is "on the map" iff `map.layers.<t>` exists
  with resolvable geometry, not because of an `enabled` flag.
- **Orphan keys** (entity/graph/map/search naming a table that doesn't exist) produce
  `warn` diagnostics via `collectOrphanOverlays` — use them while editing.
- **The HTTP engine has no transactions** (`beginTransaction()` throws) — write
  seams that need atomicity use compensation (e.g. `createMarker` deletes the
  `markers` row if `marker_views` creation fails).

## 9. Testing

- `merge.test.ts`, `overlay-io.test.ts`, `seed-overlay.test.ts` — pure, no DB.
- `seed-overlay.test.ts` mirrors `database/seed/99-app_config.surql`; keep them in
  lockstep (the file says so).
- `resolve.integration.test.ts` hits the **live** DB and asserts the real
  `app_config:main` resolves to the expected tables/layers/version/diagnostics.

Run: `npx vitest run` (all) and `npm run check` (types).