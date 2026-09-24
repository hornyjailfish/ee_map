# Map — Architecture Plan

Internal tool for an electrical engineering team. Three views over the same Surreal data and session, driven by a shared configuration layer.

**Status:** config spine + three read views + selection (N10) + table/graph CRUD (C0–C3) + overlay admin (N12) + map spatial writes through **C4.1c** (assign, floor plan, draw/create, vertex edit, edge extrude). Header search deferred (N9). Optional leftover: clear-geometry tool. **Next: config entities slim-up (N13)**.  
**Stack:** SvelteKit + Surreal session/auth + SurrealKit (schema/seed/typegen) + SVAR Grid + Svelte Flow/ELK + OpenLayers.  
**Branch:** `main` (map draw/snap + edit tools merged).

---

## Current state (repo)

| Area                                                                   | Status                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| SvelteKit app, Tailwind, Vitest                                        | Done                                                                   |
| Surreal session/auth, header Session dialog, NS catalog                | Done                                                                   |
| SurrealKit (`database/`, `surrealkit.toml`)                            | Done                                                                   |
| Barebone `DEFINE` schema + some seeds (`levels`, `electric_rooms`)     | Done                                                                   |
| Typegen → `src/lib/types/` (SDK interfaces)                            | Done (regenerate after schema edits)                                   |
| `app_config` overlay / merge / resolve                                 | **N1–N3 done** (merge + live resolve + seed)                           |
| `AppUiState`, view nav, full-page chrome                               | **N4 done**                                                            |
| `/table`, `/graph`, `/map`                                             | **N5–N8 done** + table writes (C1–C2 + C1.1) + graph wires/nodes (C3+) |
| Shared focus (`appUi.focusedId`) across views                          | **N10 done**                                                           |
| `/config` overlay editor (OWNER)                                       | **N12 done**                                                           |
| `/map/assign` static GeoJSON → record geometry                         | **C4.0 done** (match assigned, search, hide)                           |
| Floor-plan layer (`levels.geometry` MultiLine + optional `levelField`) | **C4.0b done** (schema/seed/to-map/OL)                                 |
| In-map draw/create polygons on `/map`                                  | **C4.1a done** (tool modes + createFeature + assign-to-existing)       |
| In-map vertex modify + CAD snap                                        | **C4.1b done** (ModifyVertexSession + updateGeometry)                  |
| In-map edge extrude                                                    | **C4.1c done** (ModifyExtrudeSession; same save path as modify)        |
| Clear geometry tool / draw-point                                       | **Leftover** (`MAP_FUTURE_TOOLS`; not blocking N13)                    |
| Config: slim entities + view-scoped overlay (N13)                      | **In progress** — config layer (types/lift/merge/seed) done; see below |
| Header search                                                          | **Deferred** (embedding service; no data yet)                          |
| Map geometry painters / stamps (column, elevator, …)                   | **Deferred** (after N13; not in this pass)                             |

---

## Product facts

| Area              | Decision                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Users             | Internal EE team (`OWNER` / `EDITOR` / `VIEWER`)                                             |
| Session           | Header Session dialog (ns / db / user) on `locals.session`                                   |
| Header            | View nav + session; **search later** (embeddings); optional level chip                       |
| Layout            | **Full page** under header (`h-dvh`); table/graph/map containers fill + scroll internally    |
| Shared UI state   | Selection, focused id, active **level**, search query                                        |
| Table             | Raw SVAR Grid show/edit; cosmetics later                                                     |
| Graph             | Nest `electric_rooms → boards → breakers`; wires via `connects` RELATE                       |
| Map               | Indoor, **raw XY ≈ meters**, no Web Mercator / geo “help”                                    |
| Floors            | `levels`; features link via `level`                                                          |
| Geometry          | Surreal `geometry<polygon>` / `point` in metric plane; map normalizes both                   |
| Tables            | **One table per business noun** even if columns match (no polymorphic mega-table)            |
| Config            | Live schema introspect + sparse `app_config` overlay — slim entities; graph/map scoped (N13) |
| Structure tooling | **SurrealKit** owns `.surql` schema, seed, migrations, typegen                               |

---

## Ownership split

| Asset                                       | Owner                                   | Notes                                         |
| ------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| `DEFINE TABLE/FIELD/…`                      | SurrealKit `database/schema/`           | Sync local / rollouts shared                  |
| Sample rows                                 | SurrealKit `database/seed/`             | levels, rooms, later boards…                  |
| Generated row interfaces                    | `surrealkit typegen` → `src/lib/types/` | Compile-time; **not** view driver             |
| EE meaning (room/board/breaker, map layers) | `app_config` overlay in DB              | Sparse; seed + OWNER `/config`                |
| Presentation rules at runtime               | `ResolvedConfig`                        | Only input views use for columns/layers/nodes |
| View membership (`views[]`)                 | merge (server)                          | Derived — not stored in overlay               |
| String → UI impl                            | Client registries                       | nodes, edges, OL styles                       |

```text
database/schema/*.surql  ──SurrealKit──►  live DEFINE
        │
        └── typegen ──► src/lib/types (optional typed writes)

locals.session
  INFO FOR DB/TABLE STRUCTURE ──► AutoProfile ──┐
  SELECT app_config:main      ──► Overlay ──────┼─ merge ──► ResolvedConfig
                                                │                │
                                                │         to-table / to-graph / to-map
```

**Do not** drive table/graph/map only from generated TS catalogs — that reintroduces drift. Typegen helps writes/IDE; **resolve** drives UI.

---

## Domain schema (known)

Source: `database/schema/tables.surql` (keep SurrealKit + typegen in sync when editing).

| Table                   | Role                          | Key fields                                              |
| ----------------------- | ----------------------------- | ------------------------------------------------------- |
| `levels`                | floors                        | `name`, `ord`                                           |
| `electric_rooms`        | graph room + map polygon      | `name`, `level`, `geometry?`                            |
| `boards`                | graph board                   | `name`, `room → electric_rooms`                         |
| `breakers`              | graph breaker                 | `name` (Q#), `board → boards`, `description?`, `value?` |
| `connects`              | RELATE edges                  | `IN breakers`, `OUT breakers \| rents`, `cable?`        |
| `rents`                 | map polygon / connect target  | `name`, `level`, `geometry`                             |
| `shops`                 | table-first tenant brands     | `name`, `aliases?`, `area → rents`                      |
| `zones`                 | map polygon (annotation)      | `name`, `level`, `geometry`                             |
| `embeddings`            | exclude from main UI v1       | markers / vectors / images                              |
| `__entity`, `__rollout` | SurrealKit internal           | always exclude                                          |
| `app_config`            | overlay doc `app_config:main` | meaning only (schema + seed)                            |

**Containment (graph parent links):**

```text
electric_rooms
  └─ boards.room
       └─ breakers.board
```

**Topology (`connects`):**

```text
breakers ──connects──► breakers
breakers ──connects──► rents      // feed to rented area (“output”)
```

**Map polygons (v1):** `rents`, `zones`, `electric_rooms` (optional geom).  
**Map points (later/optional):** e.g. `embeddings.marker` — same XY plane.

---

## High-level architecture

```text
Surreal DEFINE (SurrealKit)     app_config overlay
         │                              │
         ▼                              │
 live INFO STRUCTURE ──► AutoProfile    │
         │                              │
         └────────── merge ─────────────┘
                        │
                        ▼
                 ResolvedConfig
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    to-table       to-graph        to-map
         │         + to-elk            │
         ▼              ▼              ▼
    /table (SVAR)  /graph (SF)     /map (OL)
         │              │              │
         └────── AppUiState (selection, level, search) ──┘
```

Views are thin adapters. Config + transforms are the product spine.

---

## 0. Configuration layer (build first)

### Goal

One resolved config drives:

| View   | Needs from config                                         |
| ------ | --------------------------------------------------------- |
| Table  | Field list → SVAR columns (defaults OK; overrides sparse) |
| Graph  | Entity roles, `parentField`, node types; relation → edges |
| Map    | Layers, geometry field, styles, level field, plane        |
| Search | Fields to query per table                                 |

Config is **presentation + query shaping**, not a second schema.

### Strategy: convention + overlay

```text
1. Live schema on locals.session
   INFO FOR DB STRUCTURE
   INFO FOR TABLE $t STRUCTURE   (each user table)
        ↓
2. AutoProfile (ephemeral — never hand-maintained field museums)
        ↓
3. Overlay document app_config:main (deltas only)
        ↓
4. ResolvedConfig (runtime, cacheable per ns/db)
```

| Schema change | Maintenance                                                                  |
| ------------- | ---------------------------------------------------------------------------- |
| New field     | Auto column; overlay optional                                                |
| New table     | Auto entity (table default-on); add `graph.nodes` / `map.layers` when needed |
| EE semantics  | Overlay only                                                                 |
| New RELATE    | Auto edge candidate; set `graph.edges` visual role                           |
| Rename table  | `.surql` + rename overlay keys (entity + graph/map) + typegen                |

**Rule:** hardcode behavior **keys** (`nodeType`, `styleKey`, graph roles), not per-table field inventories in app code.

**Overlay keys = table names** (under `entities`, `graph.nodes`, `map.layers`, `graph.edges`). App logic resolves graph by **role** where possible (`role === 'breaker'`). Soft diagnostics for orphan overlay keys / missing tables.

**Target (N13):** `entities` stay identity + table presentation only. Graph/map per-table deltas live under `graph` / `map`. See **Config shape v2 — slim entities** below. _Shipped code is still v1 nested `entities.*.graph|map` until N13 lands._

### Overlay storage

- Document: `app_config:main` in the active database
- Structure: `DEFINE TABLE app_config` via SurrealKit
- Seed: `database/seed/99-app_config.surql` (+ additive patches e.g. `99b-…`) — EE defaults
- OWNER UI (`/config`) edits overlay only
- N13 rewrites seed to v2 shape; soft-parse still reads legacy v1 rows

### Overlay shape (contract)

**Shipped today (v1):** nested `entities.<table>.{graph,map,table}` + top-level `edges` / `map` globals / `search`. Works; entity bag is overweight (`role: 'ignore'`, `map.enabled`, graph+map sitting on every noun).

**Target (v2 / N13):** slim entities + view-scoped maps. Geometry stamp/painter registry is **out of scope** for N13.

```ts
/** Overlay v2 — stored as app_config:main (soft-parse still keeps unknown keys). */
type AppConfigOverlay = {
	version: 2;
	/** Global only — tables dropped from the whole product (not per-view). */
	excludeTables?: string[];
	/** key = table name — identity + grid presentation only */
	entities?: Record<string, EntityOverlay>;
	graph?: GraphOverlay; // layout + nodes + edges
	map?: MapOverlay; // plane globals + layers
	search?: SearchOverlay;
};

type EntityOverlay = {
	label?: string;
	display?: EntityDisplayOverlay;
	/** Grid presentation. `false` = hide from table picker (still in catalog for FK/labels). */
	table?:
		| false
		| {
				hide?: string[];
				readOnly?: string[];
				order?: string[];
				sort?: string | TableSortKeyOverlay | TableSortKeyOverlay[];
				fields?: Record<string, FieldOverlay>;
		  };
	// no graph / map here
};

type FieldOverlay = {
	label?: string;
	hidden?: boolean;
	editor?: false | string;
	width?: number;
	display?: EntityDisplayOverlay;
};

type GraphOverlay = {
	/** Defaults for the whole graph (root + compounds that omit overrides). */
	layout?: {
		direction?: 'DOWN' | 'RIGHT';
		align?: 'start' | 'center' | 'balance';
		spacing?: {
			node?: number;
			layer?: number;
			edgeLayer?: number;
			edgeEdge?: number;
			edgeNode?: number;
		};
		compoundPadding?: { top?: number; left?: number; bottom?: number; right?: number };
	};
	/** key = table name; presence ⇒ participates in graph (no role: 'ignore') */
	nodes?: Record<
		string,
		{
			role: 'room' | 'board' | 'breaker' | 'output' | 'group';
			parentField?: string;
			nodeType?: string;
			labelField?: string;
			subtitleField?: string;
			/**
			 * Per-table ELK overrides for nodes of this table (especially compounds:
			 * room/board/group). Merged on top of options derived from `graph.layout`.
			 * Keys are ELK option strings, values stringified (`'elk.spacing.nodeNode'`, …).
			 * Product-level knobs may also be accepted and normalized in merge/to-elk
			 * (same vocabulary as `graph.layout`) — prefer those in seed/UI when enough.
			 */
			layoutOptions?: Record<string, string>;
			/** Optional structured subset (same shape as sparse `graph.layout`) → ELK via to-elk. */
			layout?: GraphOverlay['layout'];
		}
	>;
	/** key = relation table; was top-level `edges` in v1 */
	edges?: Record<
		string,
		{
			role?: 'feeds' | 'to-output' | 'other' | 'ignore';
			edgeType?: string;
			labelField?: string;
			/** Optional per-relation ELK edge options (sparse). */
			layoutOptions?: Record<string, string>;
		}
	>;
};

type MapOverlay = {
	units: 'm';
	plane: 'xy-meters';
	extent?: [number, number, number, number];
	levelsTable?: string; // default 'levels'
	levelOrderField?: string; // default 'ord'
	floorPlan?: { byLevelField?: string; imageExtentField?: string };
	/** key = table name; presence ⇒ map layer (replaces entities.*.map + enabled: true) */
	layers?: Record<
		string,
		{
			levelField?: string;
			geometryField?: string;
			layerGroup?: string;
			styleKey?: string;
			zIndex?: number;
		}
	>;
};

type SearchOverlay = {
	fieldsByTable?: Record<string, string[]>;
};
```

#### Config shape v2 — design rules (N13)

| Concern                           | Where                                           | Notes                                   |
| --------------------------------- | ----------------------------------------------- | --------------------------------------- |
| Drop from product                 | `excludeTables` (once)                          | Never copy into graph/map               |
| Label / FK display / grid         | `entities.<table>`                              | Shared across views                     |
| Graph participation + node knobs  | `graph.nodes.<table>`                           | Opt-in; omit = not in graph             |
| Per-table ELK options             | `graph.nodes.<table>.layout` / `.layoutOptions` | Override globals for that table’s nodes |
| Edge participation                | `graph.edges.<relation>`                        | Moved from top-level `edges`            |
| Graph layout defaults (ELK)       | `graph.layout`                                  | Shipped; baseline for root + compounds  |
| Map participation + layer knobs   | `map.layers.<table>`                            | Opt-in; no `enabled` flag               |
| Map plane / levels table          | `map.*` globals                                 | Unchanged role                          |
| Search fields                     | `search.fieldsByTable`                          | Unchanged                               |
| “Which views does table support?” | **`ResolvedEntity.views`**                      | **Derived in merge** — not stored in DB |

**Membership merge rules**

- `table` ∈ views unless `entities[t].table === false` (or excluded).
- `graph` ∈ views iff `graph.nodes[t]` present with a real role (no `ignore` key — just don’t list the table).
- `map` ∈ views iff `map.layers[t]` present and resolvable (`geometryField` after heuristics).
- Orphan `graph.nodes` / `map.layers` keys → diagnostics (same spirit as today’s orphan entity keys).
- Do **not** dual-write `views: ['map']` in overlay — presence of layer/node **is** the source of truth.

**Graph ELK layout layers (N13, aligns with current `to-elk`)**

```text
graph.layout                    → baseline root + default compound options
       ↓
graph.nodes[table].layout       → product knobs for that table (optional)
       ↓
graph.nodes[table].layoutOptions → raw ELK string map (wins on key clash)
       ↓
to-elk: each compound/leaf of that table gets merged layoutOptions
```

- Today compounds already get `compoundLayoutOptions(graph.layout)`; per-table map is the missing config hook (rooms vs boards may need different padding/spacing).
- Leaves may carry options too when useful; root still uses global `graph.layout` (+ call-site overrides).
- Prefer structured `layout` in seed/UI; allow `layoutOptions` escape hatch for ELK keys we have not promoted yet.
- Optional later: `graph.edges[rel].layoutOptions` for edge routing — not required for first N13 cut if unused.

**Resolved (read model) — still one object in layout**

```ts
type ResolvedEntity = {
	name: string;
	label: string;
	fields: ResolvedField[];
	permissions: TablePermissions;
	display?: ResolvedEntityDisplay;
	sort?: ResolvedTableSortKey[];
	/** Derived: which product views include this table. */
	views: Array<'table' | 'graph' | 'map'>;
	// optional denorm for convenience during transition — may drop later:
	// graph?: ResolvedEntityGraph;
	// map?: ResolvedEntityMap;
};

type ResolvedConfig = {
	version: 2;
	tables: ResolvedEntity[];
	relations: ResolvedEdge[];
	graph: {
		hierarchy: GraphHierarchyRole[];
		layout: ResolvedGraphLayout;
		/** node settings by table (from graph.nodes), including resolved per-table layoutOptions */
		nodes: Record<string, ResolvedEntityGraph & { layoutOptions?: Record<string, string> }>;
	};
	map: ResolvedMap; // globals + layers[] (from map.layers)
	search: ResolvedSearch;
	diagnostics: Diagnostic[];
	engine?: SurrealEngineVersion;
};
```

- **Full `ResolvedConfig` stays on layout load** (already shipped) — metadata is small; cross-view chrome needs membership + labels.
- Page loads still fetch **row data** only; they do not re-parse overlay for membership.
- Writes keep calling `resolveAppConfig` on the server for allowlists.

**Migration v1 → v2 (overlay-io / seed)**

1. Soft-parse accepts both shapes; bump written `version` to `2` on save.
2. Lift `entities[t].graph` → `graph.nodes[t]` (drop entries with `role: 'ignore'`).
3. Lift `entities[t].map` → `map.layers[t]` when `enabled !== false` and geometry resolvable; drop `enabled`.
4. Move top-level `edges` → `graph.edges`.
5. Keep `entities[t].{label,display,table}` in place; strip nested graph/map from entities when rewriting seed / export.
6. Tests: seed fixture, merge membership/`views`, ConfigEditor tabs (entity vs graph vs map).
7. Consumers: `to-graph` / graph CRUD read `config.graph.nodes`; map stays on `config.map.layers`; table picker filters `views.includes('table')` (default almost all).

**Deferred (not N13):** map geometry painters/stamps (column point → fancy symbol, elevator polygon → cabin art). May later add `anchor` / `variantField` on `map.layers` without fattening `entities`.

### First overlay seed (intent)

| Key / path                                        | Intent                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `excludeTables`                                   | `__entity`, `__rollout`, `app_config`, `embeddings` — **global once**       |
| `entities.*`                                      | labels, display, table order/sort only                                      |
| `graph.nodes.electric_rooms`                      | role `room`; optional per-table ELK `layout` / `layoutOptions`              |
| `graph.nodes.boards`                              | role `board`; `parentField: room`; compound ELK overrides as needed         |
| `graph.nodes.breakers`                            | role `breaker`; `parentField: board`                                        |
| `graph.edges.connects`                            | role `feeds`; `labelField: cable`                                           |
| `graph.layout`                                    | global ELK defaults (direction, align, spacing, compoundPadding)            |
| `map.layers.electric_rooms`                       | level + geometry; style/zIndex                                              |
| `map.layers.rents` / `zones` / `rooms` / `levels` | map only (no graph.nodes)                                                   |
| `entities.shops`                                  | table only (no graph.nodes, no map.layers)                                  |
| `map` globals                                     | `units: 'm'`, `plane: 'xy-meters'`, `levelsTable`, `levelOrderField: 'ord'` |

### Live INFO resolver (server)

**Session:** `locals.session` (user ns/db) — **not** the system catalog viewer.

| Step | Call                               | Purpose                                |
| ---- | ---------------------------------- | -------------------------------------- |
| 1    | `INFO FOR DB STRUCTURE`            | Table list; detect RELATION tables     |
| 2    | `INFO FOR TABLE $t STRUCTURE` each | Field names, kinds/types, link targets |
| 3    | `SELECT` `app_config:main`         | Overlay (empty if missing)             |
| 4    | `merge(auto, overlay)`             | `ResolvedConfig` + diagnostics         |

**Not used for config resolve:** `INFO FOR ROOT/NS` (that stays catalog-only).

**AutoProfile (structure only)** — parse `INFO … STRUCTURE` objects only (never plain INFO / DEFINE strings). Captures `session.version()` → `engine` on AutoProfile / ResolvedConfig for future STRUCTURE dialect branches.

```ts
type AutoProfile = {
	tables: Array<{
		name: string;
		kind: 'normal' | 'relation' | 'unknown';
		in?: string[];
		out?: string[];
		fields: Array<{
			name: string;
			type: string; // normalized: string|number|bool|record|geometry|array|…
			recordTargets?: string[];
			geometryKinds?: string[];
			optional?: boolean;
		}>;
	}>;
};
```

**Default excludes:** `/^__/`, plus overlay `excludeTables`.

**Heuristics:**

- RELATION → edge candidate
- `record<…>` → link / parent candidate
- name `level` + record→levels → level candidate
- `geometry<…>` → geom candidate (**layer only if listed under `map.layers` / v1 `entities.*.map.enabled`**)
- other fields → default table columns
- graph **roles** never inferred from schema alone; v2 roles only from `graph.nodes`

**Cache:** by `ns + db` (invalidate on selection change). Optional TTL/schema hash later.

### Resolved output (views consume only this)

**Shipped (v1):** `tables[]` with optional nested `graph` / `map` on each entity; `map.layers` derived from `map.enabled`; `graph` holds hierarchy + layout only; top-level `relations` from edges.

**Target (v2 / N13):** see contract above — slim `ResolvedEntity` + derived `views[]`; `graph.nodes` + `map.layers` as view indexes. Layout still serves the full `ResolvedConfig`.

```ts
// v2 sketch — concrete fields evolve with merge tests
type ResolvedConfig = {
	version: 2;
	tables: ResolvedEntity[]; // includes views: ('table'|'graph'|'map')[]
	relations: ResolvedEdge[];
	map: ResolvedMap; // globals + layers[]
	search: { fieldsByTable: Record<string, string[]> };
	graph: {
		hierarchy: Array<'room' | 'board' | 'breaker' | 'output' | 'group'>;
		layout: ResolvedGraphLayout;
		nodes: Record<string, ResolvedEntityGraph>;
	};
	diagnostics: Array<{ level: 'info' | 'warn' | 'error'; code: string; message: string }>;
	engine?: SurrealEngineVersion;
};
```

### Client registries

Config never embeds Svelte components or `ol/style` objects.

- `nodeTypes[type]` → Svelte Flow nodes
- `edgeTypes[type]` → edges
- `styles[styleKey]` → OL style factory

### Module layout

```text
database/                      # SurrealKit
  schema/
  seed/
  …

src/lib/types/                 # typegen output (do not hand-edit)

src/lib/config/
  types.ts
  merge.ts
  merge.test.ts

src/lib/server/config/
  parse-kind.ts                # field TYPE/kind → AutoProfileField (pure)
  parse-structure.ts           # INFO STRUCTURE → stubs (pure)
  introspect.ts                # INFO DB + TABLE STRUCTURE → AutoProfile
  load-overlay.ts              # SELECT app_config:main
  resolve.ts                   # resolveAppConfig(session) + ns/db cache

src/lib/server/data/
  query-entities.ts
  query-relations.ts
  query-search.ts
  query-levels.ts

src/lib/transform/
  to-table.ts
  to-graph.ts
  to-elk.ts
  to-map.ts                    # includes geometry normalizer (point + polygon)

src/lib/client/
  registries/nodes.ts
  registries/edges.ts
  registries/styles.ts
  state/app-ui.svelte.ts
```

| Concern                          | Where                 |
| -------------------------------- | --------------------- |
| Schema files, seed, typegen      | SurrealKit CLI        |
| Introspect, overlay, merge       | server                |
| Strip internals before page data | server                |
| Transforms                       | shared pure (+ tests) |
| ELK layout, SF/OL mount          | client                |
| Registries                       | client                |

---

## Shared chrome & state

### Routes

```text
/		  → light home or redirect
/table
/graph
/map
/config   → OWNER only (app_config overlay editor)
```

### Layout

- `min-h-dvh` / `h-dvh` + `overflow-hidden` on shell
- Header `shrink-0` full width
- `main` `flex-1 min-h-0` — **no `max-w-6xl` on view pages**
- Table: SVAR internal scroll
- Graph/Map: `h-full w-full` + resize observer (OL)

### Header

- Brand + Table | Graph | Map
- Session (existing)
- Search + scope (**deferred** — external embeddings service; seed data has no vectors yet)
- Optional level chip

### App UI state

```ts
type AppUiState = {
	selectedIds: string[];
	focusedId: string | null;
	levelId: string | null;
	search: { q: string; scope: 'view' | 'all' };
};
```

Same record id focuses table row, graph node, and map feature.

### Permissions

| Role   | v1 intent                        |
| ------ | -------------------------------- |
| VIEWER | read all views                   |
| EDITOR | table edit; later map/graph edit |
| OWNER  | overlay admin (`/config`)        |

---

## 1. Table view (SVAR Grid)

**Route:** `/table` · **Package:** `@svar-ui/svelte-grid`

```text
Resolved entity + rows → to-table → { data, columns } → <Grid />
```

**Slices:** `buildColumns` → one-entity read-only → entity switcher → selection → inline edit (EDITOR+) → filters later.

---

## 2. Graph view (Svelte Flow + elkjs)

**Route:** `/graph` · **Packages:** `@xyflow/svelte`, `elkjs`

- Nesting from `room` / `board` parent fields
- Edges from `connects`
- Client-only canvas + ELK
- Fixtures/tests before live polish

**Non-goals v1:** drawing topology in UI; full output taxonomy beyond `rents` as OUT target.

---

## 3. Map view (OpenLayers) — indoor XY

**Route:** `/map` · **Package:** `ol`

- Identity meter plane; extent from config or bbox
- Level switcher → `AppUiState.levelId`
- Layers from resolved `map.layers` (v1: entities with `map.enabled`; v2/N13: `map.layers.<table>` presence)
- Geometry normalizer: polygon + point + **line** (LineString / MultiLineString) in **same** metric plane
- Floor plans: `levels` as self-level background layer (`levelField` optional; row id = level)
- Assign path: `/map/assign` (static `static/geo/**` → `patchGeometry`)
- No outdoor tiles as primary UX

---

## Implementation order

### Done

| #    | Slice                                                        | Outcome                |
| ---- | ------------------------------------------------------------ | ---------------------- |
| D1   | SvelteKit + Surreal session/auth + catalog                   | Logged-in multi ns/db  |
| D2   | SurrealKit init + schema/seed/typegen                        | Structure pipeline     |
| D3   | Domain tables (rooms/boards/breakers/connects/…)             | Real names known       |
| N1   | `src/lib/config` types + `merge()` + Vitest + diagnostics    | Contract locked        |
| N2   | `introspect` + `load-overlay` + `resolveAppConfig` + cache   | Live config on session |
| N3   | SurrealKit: `app_config` table + EE seed overlay             | Graph/map semantics    |
| N4   | Layout `data.config` + full-page chrome + `AppUiState` + nav | Spine live             |
| N5   | `to-table` + `/table` SVAR read-only                         | First usable UI        |
| N5.1 | Entity `display` + record-label store + FK cells             | Readable record refs   |
| N5.2 | `table.sort` overlay + natural string compare                | Predictable grid order |
| N6   | `to-graph` + `to-elk` (room/board/breaker + connects)        | Correct nesting        |
| N7   | `/graph` SF + ELK + live data                                | Breaker view           |
| N8   | `to-map` + `/map` OL metric XY + level switcher              | Indoor map             |
| N10  | Selection sync (`focusRecord`, table/graph/map consumers)    | One app feel           |

### Deferred

| #   | Slice         | Why                                                                      |
| --- | ------------- | ------------------------------------------------------------------------ |
| N9  | Header search | Will call a separate embeddings service; domain rows have no vectors yet |

### CRUD progress

| #         | Slice                                     | Outcome                                                                |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| **C0**    | Server mutate module + role gate          | **Done**                                                               |
| **C1**    | Table inline edit (SVAR) + patch          | **Done** (scalars + record combobox)                                   |
| **C1.1**  | Inline record picker + grouped options    | **Done** (combobox; boards group by room)                              |
| **C2**    | Table add/delete row                      | **Done** (modal + validation)                                          |
| **C3**    | Graph: persist `connects` on draw/delete  | **Done** (EDITOR/OWNER; SF edge-id fix; topology-only delete)          |
| **C3.1**  | Graph: node create/delete + props toolbar | **Done / polishing** (nested add, ELK packing)                         |
| **C4.0**  | Map assign: static geo → `patchGeometry`  | **Done** — `/map/assign`, assigned match, record search                |
| **C4.0b** | Levels floor-plan MultiLine background    | **Done** — schema + seed + to-map line + OL                            |
| **C4.1a** | Map: draw polygon → create / assign geom  | **Done** — DrawSnapSession + `createFeature` + existing-record attach  |
| **C4.1b** | Map: vertex modify + CAD snap             | **Done** — ModifyVertexSession + `updateGeometry` + pending save/retry |
| **C4.1c** | Map: polygon edge extrude                 | **Done** — ModifyExtrudeSession (shared commit UX with modify)         |
| **C4.1d** | Map: clear geometry on focused feature    | **Optional leftover** — tool reserved in `MAP_FUTURE_TOOLS`            |
| **N12**   | Light overlay admin UI (`/config`, OWNER) | **Done** — soft overlay editor                                         |
| **N13**   | Slim entities overlay + derived `views[]` | **In progress** — config layer done (types / lift / merge / seed)      |

### Immediate coding focus

```text
N13 — config entities slim-up (no painter registry)
  DONE: types v2 (GraphNodeOverlay / MapLayerOverlay / ProductView / ResolvedGraphNode)
  DONE: overlay-io liftOverlayV1toV2 + overlayV2toV1 (editor bridge) + soft-parse both shapes
  DONE: merge() emits version 2 + ResolvedEntity.views + graph.nodes (+ denorm graph/map)
  DONE: seed 99-app_config v2 + save/load v2 + tests + NONE/undefined semantics fixed
  REMAINS: consumer call sites (to-graph / graph-crud / map-crud / query-graph-bundle /
           table picker) read graph.nodes / views; ConfigEditor v2 IA (node/layer tabs)
  NOTE: per-table structured layout still TODO — layoutOptions (raw) wired end-to-end

Optional (any time, not blocking N13):
C4.1d — clear geometry on focused feature
  reuse: patchGeometry + pending modify save/retry UX; keep focusedId + levelId
```

**Shipped write seams:** table + graph wires/nodes + map **assign / draw / vertex edit / extrude**.
VIEWER is read-only (`assertCanEdit` / `assertCanUpdate`). Add-row always uses a validation
modal. Record FKs use the registered `combobox` editor (inline + form) with Command groups
when the target display recipe is multi-part. Map geometry edits commit via `updateGeometry`
(`patchGeometry`); successful vertex/extrude saves keep the live OL feature (no full reload).

**C4 split**

| Slice            | UX                                                | Persist                                      |
| ---------------- | ------------------------------------------------- | -------------------------------------------- |
| C4.0 assign      | Pick static feature + DB row                      | `patchGeometry` (+ optional level)           |
| C4.0b floor plan | `levels.geometry` linework under features         | seed / sync from `static/geo/*/base.geojson` |
| C4.1a create     | Draw polygon → modal → new row or existing record | `createRecord` / assign geom + geometry      |
| C4.1b modify     | Vertex drag / insert / Alt-remove + CAD snap      | `patchGeometry` via `updateGeometry`         |
| C4.1c extrude    | Edge push/pull along normal + depth snap          | same as C4.1b                                |
| C4.1d clear      | Clear geom on focused feature (optional)          | `patchGeometry` null/empty                   |

### CRUD design (toward C0–C4)

**Roles**

Gate on server from session user + catalog roles (same source as `userRoles` today). Client only hides controls. Role matrix under **Map (C4)** above.

**Write seam (C0)**

```text
src/lib/server/data/mutate.ts
  assertCanEdit(roles) → EDITOR | OWNER   // VIEWER always rejected
  patchRecord / createRecord / deleteRecord
  patchGeometry(session, entity, id, geometry, extra?)
  relateConnect(session, relation, inId, outId, meta?)
  unrelateConnect(session, relation, edgeId)
/table · /graph · /map/assign actions (same role gate)
```

- Allowlist **table** via `ResolvedConfig.tables` / `isValidTableName`
- Allowlist **fields** via entity field list; reject `id`, hidden, `readOnly`
- Coerce link fields with RecordId; geometry via SDK Geometry (CBOR) — not plain JSON bags
- Prefer **remote functions or form actions** over ad-hoc fetch routes — same session cookies
- After write: `invalidateAll` / targeted invalidate so graph+map reload; keep `appUi.focusedId`

**Table (C1–C2)** — primary EE ops surface — **done**

- Columns already carry `readOnly` / `editor` from overlay merge → enable SVAR editors only when `canEdit`
- Cell commit → `patchRecord`; show error toast, revert on failure
- Add row: empty defaults + required fields; Delete: confirm, then `deleteRecord`
- Do not invent business defaults in UI without schema/seed guidance

**Graph (C3 / C3.1)** — topology + nested structure — **done** (polish OK)

- Persist wires: `RELATE $in -> connects -> $out` (+ optional cable meta)
- Delete selected edge → delete `connects` row only (not containment)
- Node add/delete via mutate + graph toolbar; layout via ELK
- Non-goals still: freehand redraw of rooms/boards as map shapes; full output taxonomy UI

**Map (C4)** — spatial writes

- **C4.0 done:** `/map/assign` loads `static/geo/{folder}/{name}.geojson`, EDITOR/OWNER picks
  feature + record, writes geometry (+ level when field exists). Assigned features matched by
  `geometryKey` fingerprint against DB rows; optional hide-assigned; record list via fuzzy search remote.
- **C4.0b:** `levels.geometry` as MultiLine floor plan; map layers may omit `levelField`
  (self-level = row id). Style registry + OL render line geometries.
- **C4.1a done:** draw polygon on `/map` (DrawSnapSession: feature snap, Shift ortho, alignment
  guides) → modal → `createFeature` **or** attach geom to an existing gap record; FeaturePropertiesPanel for scalars/FKs.
- **C4.1b done:** Edit tool — ModifyVertexSession (drag / edge-insert / Alt-remove corners),
  shared MapSnapAssist, `updateGeometry` + pending save/retry/revert; vertex handles on focus.
- **C4.1c done:** Extrude tool — ModifyExtrudeSession (edge normal push/pull + parallel depth snap),
  same ModifyCommit / pending UX as vertex edit.
- **C4.1d optional:** clear-geometry + draw-point still in `MAP_FUTURE_TOOLS` (UI placeholders only).
- Level stays filter only unless moving feature across levels explicitly

**Roles (current)**

| Role   | Read | Table | Graph | Map assign | Map draw | Map edit (modify/extrude) | Overlay |
| ------ | ---- | ----- | ----- | ---------- | -------- | ------------------------- | ------- |
| VIEWER | ✓    | —     | —     | —          | —        | —                         | —       |
| EDITOR | ✓    | ✓     | ✓     | ✓          | ✓        | ✓                         | —       |
| OWNER  | ✓    | ✓     | ✓     | ✓          | ✓        | ✓                         | ✓       |

**Out of scope for first CRUD slice** (historical — mostly cleared)

- Embeddings / header search (N9) — still deferred
- Multiplayer OT/CRDT
- Overlay admin before C1 — cleared (N12 after C1)
- Map draw before table+graph writes — cleared (C4 after C3)

---

## SurrealKit workflow (ongoing)

| Env              | Command                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| Local disposable | `surrealkit sync` / `sync --watch` (+ typegen when configured)         |
| Shared / prod    | Rollouts (`plan` → `start` → `complete`); baseline if adopting live DB |
| Types            | `surrealkit typegen` → `src/lib/types/`                                |
| Seeds            | seed files under `database/seed/`                                      |

**Caution:** `sync` can **prune** definitions missing from files — complete schema mirror before shared sync.

App env (`SURREAL_URL`, WS) and kit env (`SURREALDB_HOST`, HTTP) may differ by protocol; same host/ns/db intent.

---

## Design rules (short)

1. **Schema owns structure; overlay owns meaning; SurrealKit owns shipping structure.**
2. **ResolvedConfig is the only view input** for presentation rules.
3. **Live INFO on the user session** feeds AutoProfile — typegen does not replace it.
4. **Transforms are pure and tested.**
5. **Registries map strings → UI** — config stays serializable.
6. **Shared selection + level + search** glue the three pages.
7. **Map stays metric XY** — never project to web geo.
8. **Graph nesting = parent links; wires = RELATE (`connects`).**
9. **Separate tables per noun**; shared _field names_, not shared tables.
10. **Table stays boring until ops need polish.**
11. **Full-page** view containers.
12. **`excludeTables` is global once** — not per-view denylist.
13. **Entity overlay = identity + grid**; graph/map deltas live under `graph` / `map` (N13).
14. **View membership is derived in merge** (`views[]`) — never dual-stored in DB.
15. **Graph ELK:** global `graph.layout` defaults; each `graph.nodes[table]` may override via `layout` / `layoutOptions`.

---

## Out of scope (for now)

- Full three UIs before config spine
- Hand-maintained per-field TS catalogs for every table
- Using typegen alone as the runtime view schema
- Geo-referenced / distorted map projections
- Real-time multiplayer editing
- Replacing Surreal session/auth
- Overlay admin before table CRUD (C1) works — **cleared**
- Header search until embeddings service + data exist (N9 deferred)
- Map geometry editors before table + graph wire persist — **cleared** (C4.0 assign shipped; C4.1 editor next)
- Map geometry **painters / stamps** (fancy column/elevator draw from point|polygon anchors) — deferred after N13
- Storing FeatureCollection as Surreal `geometry` (not supported; use point/polygon anchors + optional later painters)

---

## Open / follow-ups (non-blocking)

1. Confirm `connects` OUT to `rents` as the “output” story vs separate outputs table
2. Whether `shops` ever appear on map (v1: table only — assign may still write rents)
3. Floor-plan **image** fields on `levels` when raster assets exist (linework is `geometry` now)
4. Embeddings service contract for N9 (fields, index, latency, auth)
5. Surreal permissions: ensure EDITOR can MERGE/CREATE/DELETE / RELATE on domain tables
6. Composite FK sort keys (`sortKey` from display parts) when SVAR needs header multi-key
7. Record `sort` default (config string) is client-side only — confirm SVAR header marks match on table reopen
8. C4.1d: clear-geometry tool (and optional draw-point); cross-level move policy if features should change `level` while editing
9. Seed or sync pipeline: collapse `static/geo/*/base.geojson` → `levels.geometry` (static bases removed from tree after C4.0b seed path — restore only if re-sync needed)
10. N13: keep optional denorm `entity.graph` / `entity.map` during consumer migration, or jump straight to `graph.nodes` + `map.layers` only
11. N13: ConfigEditor IA — entity tab vs graph tab vs map layers tab
12. N13: how much per-table ELK UI (structured layout only vs raw layoutOptions editor)
13. Later: map layer `anchor` / `variantField` + client painters (columns, elevators) — not part of N13
