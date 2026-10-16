# App Config Overhaul — Refactoring Plan

> Status: **plan only** (not yet implemented). Companion to `src/lib/config/README.md`
> (current change routine) and `PLAN.md` (design history, N13).

## 1. Problem statement

The config layer (AutoProfile + `app_config:main` overlay → `merge()` →
`ResolvedConfig`) works, but the *routine for changing it* is complicated and not
standardized:

- **Version vocabulary collision** — overlay contract v1→v2→v3 (`OVERLAY_VERSION = 3`)
  means something different from PLAN's "config shape v2 (N13)" and
  `transform/v2`'s `ResolvedConfigV2.version: 2`, while `merge()` emits
  `ResolvedConfig.version: 3`. Nobody can say "which v" safely.
- **Migration god-function** — `liftOverlayToV3` mixes structural lift
  (v1 nested → v2 view-scoped), semantic migration (embeddings → markers /
  marker_views) and normalization in one ~200-line function. Adding the next
  revision means growing it again.
- **Painful table onboarding** — adding one table touches up to 4 overlay buckets
  (`entities`, `graph.nodes`, `map.layers`, `search.fieldsByTable`) plus a
  hand-mirrored test fixture and integration expectations.
- **Manual lockstep** — `database/seed/99-app_config.surql` and
  `seed-overlay.test.ts` must be kept in sync by hand; patch seeds (`99b`, `99e`)
  are an ad-hoc ritual.
- **Deprecated residue** — `ResolvedEntity.graph?/map?` denorm, optional
  `graph.nodes?`, `ResolvedEntityMap`, top-level `edges` — future code doesn't
  know what is safe to use.
- **Parallel transform fork** — `transform/v2/*` (with `from-v1` lift) waits for
  the N13 consumer switch; two worlds must be kept in lockstep.
- **Weak view-awareness** — cross-view features ("Show on map", select on view
  change) need table → views membership and per-view identity, but that is
  scattered and partly deprecated.

## 2. Goals

1. **Adding a table to config = one entry** (or zero — conventions cover the
   default), not edits in 4 buckets + 2 test mirrors.
2. **Views are first-class**: every view has (a) **global settings** independent
   of tables, (b) **per-table settings**, (c) **per-field-in-table settings**;
   every table knows which views it supports.
3. **Cross-view transfer**: config exposes membership + per-view identity
   (geometry field, node role, grid columns…) through one accessor API so
   "Show on map" / "open table on view change" is a lookup, not a scavenger hunt.
4. **Future changes are mechanical**: one migration registry, one seed source,
   one short checklist per change type (add table / add view / add knob / bump
   contract).

## 3. Non-goals

- **ConfigEditor UI rework** — its v1-shaped edits keep working via a frozen
  compat shim; migrations lift old shapes on read/save. (UI churns constantly;
  not worth stabilizing now.)
- Route/server plumbing (`Promise.all([resolveAppConfig, getUserRoles])`
  boilerplate per `+page.server.ts`) — separate cosmetic pass.
- Painter/stamp registries, header search (N9) — untouched.

## 4. Target model (core idea)

**Table-centric authoring → view-centric read model.** The OWNER edits config
per table ("everything about `boards` in one place"); `merge()` derives per-view
indexes that consumers read.

### 4.1 Overlay (what is edited / seeded) — canonical, layered

```ts
type AppConfigOverlay = {
	revision: number; // storage revision (renamed — kills the v1/v2/v3 collision)
	excludeTables?: string[]; // global only
	entities?: Record<string, EntityOverlay>; // key = table name
};

type EntityOverlay = {
	label?: string; // identity
	display?: EntityDisplayOverlay; // shared FK/label recipe (dotted accessors stay)
	fields?: Record<string, FieldOverlay>; // SHARED per-field knobs (label, display)
	views?: Partial<
		Record<
			ProductView,
			| {
					settings?: Record<string, unknown>; // per-table knobs for that view
					fields?: Record<string, FieldOverlay>; // per-table-per-FIELD knobs for that view
			  }
			| false // explicit removal (e.g. hide from table picker)
		>
	>;
};

// View-GLOBAL settings live once per view (not per table):
type ViewSettings = {
	table: { /* default sort, global readOnly, … */ };
	graph: { layout; hierarchy };
	map: { units; plane; extent; levelsTable; levelOrderField; floorPlan };
	search: { /* defaults */ };
};
```

Layers, top-down (every knob has exactly one home):

| Layer | Example knobs |
| --- | --- |
| app | `excludeTables` |
| entity | `label`, `display` |
| entity.field (shared) | field `label`, field `display` |
| view (global) | `map.plane`, `graph.layout`, `search` defaults |
| view.table | `map.layers`-style layer knobs, graph node knobs, grid presentation |
| view.table.field | grid `editor`/`width`/`hidden`, future per-view field knobs |

Membership rule everywhere: **presence = membership** (no `enabled` / `role: 'ignore'`
flags; omit the `views.<v>` entry instead).

### 4.2 Resolved (what consumers read)

```ts
type ResolvedConfig = {
	entities: ResolvedEntity[]; // identity + fields + `views: ProductView[]` (derived)
	views: Record<ProductView, ResolvedView>; // per view: `settings` + `tables` index (+ `edges` for graph)
	relations: ResolvedEdge[];
	diagnostics: Diagnostic[];
};
```

Accessor module (e.g. `src/lib/config/accessors.ts`) — the only API consumers use:

```ts
entityByName(c, t) · viewSettings(c, v) · tableView(c, v, t) · fieldSettings(c, v, t, f)
canShowOn(c, t, v) · viewTarget(c, t, v) // → node/layer/grid spec for cross-view buttons
```

### 4.3 Key tradeoff (explicit)

Current N13 direction stores view-scoped buckets (`graph.nodes`, `map.layers`,
`search.fieldsByTable`) — great for consumers, painful authoring (add table = 4
buckets). The hybrid keeps authoring table-centric but `merge()` derives the same
view indexes, so consumers stay view-first. Cost: one small fan-out step in merge
(merge already normalizes today).

**Edges:** relation tables get `views.graph` entries too; merge discriminates
node-vs-edge settings from AutoProfile `kind: 'relation'` and fills
`views.graph.edges` accordingly. One entry per relation, same rule.

## 5. Phases

### Phase 1 — Vocabulary + types

- `src/lib/config/types.ts`: new layered overlay types (§4.1); rename version
  vocabulary (`OVERLAY_REVISION` for storage; drop `ResolvedConfig.version` —
  internal detail). Kill deprecated residue (`EntityOverlay.graph/map`,
  top-level `edges`, `ResolvedEntityMap`, optional `graph.nodes?`).
- New `src/lib/config/defaults.ts` (map globals, graph layout, display sep) and
  `src/lib/config/accessors.ts`.
- **Deliverable:** types compile; nothing consumes them yet.

### Phase 2 — Migration registry (replaces the `liftOverlayToV3` god-function)

- `src/lib/config/migrations/`: ordered steps `{ from, to, id, up }`:
  `v1-nested → v2-scoped`, `v2 → v3-marker-split`, `v3 → v4-layered` (new
  canonical lift). Each step idempotent, one test file each
  (`migrations/*.test.ts`), including "run twice → unchanged".
- `overlay-io.ts` slimmed to soft-parse + registry invocation; unknown keys still
  pass through.
- Editor compat: ConfigEditor's v1 writes are just "old revision input" →
  migrated automatically. `overlayV3toV1` downcast stays as a **frozen legacy
  adapter** (no new knobs added there).

### Phase 3 — `merge()` rework

- `merge.ts` reads layered overlay → emits new `ResolvedConfig` with derived
  `views[]` and `views.<v>.tables` indexes; diagnostics for orphan keys at every
  layer.
- Per-view defaults resolved in one place (`defaults.ts`).
- `merge.test.ts` restructured: one suite per layer (entity / fields / per-view /
  view-global / membership derivation).

### Phase 4 — Consumers: finish N13 (kill the v1/v2 fork)

- Switch `to-table` / `to-graph` / `to-map` / `graph-crud` / `map-crud` /
  `query-graph-bundle` / table picker to the accessor API + `views` indexes (the
  `transform/v2` modules become the main modules; `from-v1.ts` lift and v1 modules
  deleted).
- Delete denorm `entity.graph` / `entity.map` reads from all call sites.
- Cross-view helpers land here: `canShowOn` / `viewTarget` ready for the
  "Show on map" button (the button itself is UI-later).

### Phase 5 — Seed single-source (kills the lockstep)

- EE default overlay as a TS module (e.g. `src/lib/config/seed/ee-overlay.ts`);
  `npm run config:seed` regenerates `database/seed/99-app_config.surql`.
- `seed-overlay.test.ts` imports the TS source — no more hand-mirrored fixture.
- Retire the `99b` / `99e` patch-seed pattern: shape evolution = read-time
  migrations (Phase 2); seeds only `INSERT IGNORE` the canonical doc (+ optional
  generated `UPDATE` patch from the same TS source when defaults must reach
  existing rows).

### Phase 6 — Change-routine docs + checklists

- Rewrite `src/lib/config/README.md` around the layered model with 4 checklists:
  - **Add a table** → 1 overlay entry (or nothing: auto entity + conventions) +
    regenerate seed + 1 test.
  - **Add a view** → `ProductView` union + `ViewSettings` type + defaults + merge
    section + transform + checklist item.
  - **Add a knob** → overlay type + defaults + merge reader + editor-shim (only if
    legacy UI needs it) + 1 test.
  - **Bump contract** → 1 migration step + 1 test + regenerate seed.
- Update `PLAN.md` N13 status block.

## 6. Validation

- `npx vitest run` after each phase (pure tests); `npm run check` for types.
- `resolve.integration.test.ts` updated in Phases 3–5 (live DB: real
  `app_config:main` resolves with the new shape).
- Final pass: a throwaway table fixture in tests proving "add table = one entry"
  works end-to-end through merge → all four views.

## 7. Assumptions

- Stored `app_config:main` rows (old shapes) keep loading via migrations — no
  manual DB rewrite needed.
- `ProductView` becomes `'table' | 'graph' | 'map' | 'search'` (search becomes a
  real view under the model; its `fieldsByTable` fits the per-table layer
  naturally).
- SurrealKit seed ordering stays (`99-*` last).

## 8. Open design point

**Hybrid authoring model** (table-centric `entity.views.*` in overlay, view-centric
indexes in `ResolvedConfig`) vs keeping N13's view-scoped storage as-is and only
adding sugar. Recommendation: **hybrid** — "add a table without repetition" is
the core ask; the cost is one merge fan-out step and one migration (v3 → v4).
Confirm before implementation starts.



