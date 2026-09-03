# Map — Architecture Plan

Internal tool for an electrical engineering team. Three views over the same Surreal data and session, driven by a shared configuration layer.

**Status:** config spine + three read views + selection (N10) + table CRUD (C0–C2) + graph wire persist (C3) + overlay admin (N12). Search deferred. Map geom edit (C4) next.  
**Stack:** SvelteKit + Surreal session/auth + SurrealKit (schema/seed/typegen) + SVAR Grid + Svelte Flow/ELK + OpenLayers.

---

## Current state (repo)

| Area                                                               | Status                                        |
| ------------------------------------------------------------------ | --------------------------------------------- |
| SvelteKit app, Tailwind, Vitest                                    | Done                                          |
| Surreal session/auth, header Session dialog, NS catalog            | Done                                          |
| SurrealKit (`database/`, `surrealkit.toml`)                        | Done                                          |
| Barebone `DEFINE` schema + some seeds (`levels`, `electric_rooms`) | Done                                          |
| Typegen → `src/lib/types/` (SDK interfaces)                        | Done (regenerate after schema edits)          |
| `app_config` overlay / merge / resolve                             | **N1–N3 done** (merge + live resolve + seed)  |
| `AppUiState`, view nav, full-page chrome                           | **N4 done**                                   |
| `/table`, `/graph`, `/map`                                                 | **N5–N8 done** + table writes (C1–C2) + graph wires (C3) |
| Shared focus (`appUi.focusedId`) across views                              | **N10 done**                                  |
| `/config` overlay editor (OWNER)                                           | **N12 done**                                  |
| Header search                                                              | **Deferred** (embedding service; no data yet) |

---

## Product facts

| Area              | Decision                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Users             | Internal EE team (`OWNER` / `EDITOR` / `VIEWER`)                                          |
| Session           | Header Session dialog (ns / db / user) on `locals.session`                                |
| Header            | View nav + session; **search later** (embeddings); optional level chip                    |
| Layout            | **Full page** under header (`h-dvh`); table/graph/map containers fill + scroll internally |
| Shared UI state   | Selection, focused id, active **level**, search query                                     |
| Table             | Raw SVAR Grid show/edit; cosmetics later                                                  |
| Graph             | Nest `electric_rooms → boards → breakers`; wires via `connects` RELATE                    |
| Map               | Indoor, **raw XY ≈ meters**, no Web Mercator / geo “help”                                 |
| Floors            | `levels`; features link via `level`                                                       |
| Geometry          | Surreal `geometry<polygon>` / `point` in metric plane; map normalizes both                |
| Tables            | **One table per business noun** even if columns match (no polymorphic mega-table)         |
| Config            | Live schema introspect + sparse `app_config` overlay — not a TS field museum              |
| Structure tooling | **SurrealKit** owns `.surql` schema, seed, migrations, typegen                            |

---

## Ownership split

| Asset                                   | Owner                                   | Notes                                         |
| --------------------------------------- | --------------------------------------- | --------------------------------------------- |
| `DEFINE TABLE/FIELD/…`                  | SurrealKit `database/schema/`           | Sync local / rollouts shared                  |
| Sample rows                             | SurrealKit `database/seed/`             | levels, rooms, later boards…                  |
| Generated row interfaces                | `surrealkit typegen` → `src/lib/types/` | Compile-time; **not** view driver             |
| EE meaning (room/board/breaker, map on) | `app_config` overlay in DB              | Sparse; seed + later OWNER UI                 |
| Presentation rules at runtime           | `ResolvedConfig`                        | Only input views use for columns/layers/nodes |
| String → UI impl                        | Client registries                       | nodes, edges, OL styles                       |

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

| Schema change | Maintenance                                       |
| ------------- | ------------------------------------------------- |
| New field     | Auto column; overlay optional                     |
| New table     | Auto entity; set graph/map in overlay when needed |
| EE semantics  | Overlay only                                      |
| New RELATE    | Auto edge candidate; overlay visual role          |
| Rename table  | `.surql` + rename overlay key + typegen           |

**Rule:** hardcode behavior **keys** (`nodeType`, `styleKey`, graph roles), not per-table field inventories in app code.

**Overlay keys = table names** (simple). App logic resolves by **role** where possible (`graph.role === 'breaker'`). Soft diagnostics for orphan overlay keys / missing tables.

### Overlay storage

- Document: `app_config:main` in the active database
- Structure: `DEFINE TABLE app_config` via SurrealKit
- Seed: `database/seed/app_config.surql` (EE defaults)
- Later: OWNER UI edits overlay only

### Overlay shape (contract)

```ts
type AppConfigOverlay = {
	version: 1;
	excludeTables?: string[];
	entities?: Record<string, EntityOverlay>; // key = table name
	edges?: Record<string, EdgeOverlay>; // key = relation table
	map?: MapOverlay;
	search?: SearchOverlay;
};

type EntityOverlay = {
	label?: string;
	graph?: {
		role: 'room' | 'board' | 'breaker' | 'output' | 'group' | 'ignore';
		parentField?: string;
		nodeType?: string;
		labelField?: string;
		subtitleField?: string;
	};
	map?: {
		enabled?: boolean;
		levelField?: string;
		geometryField?: string;
		layerGroup?: string;
		styleKey?: string;
		zIndex?: number;
	};
	table?: {
		hide?: string[];
		readOnly?: string[];
		order?: string[];
		fields?: Record<string, FieldOverlay>;
	};
};

type FieldOverlay = {
	label?: string;
	hidden?: boolean;
	editor?: false | string;
	width?: number;
};

type EdgeOverlay = {
	role?: 'feeds' | 'to-output' | 'other' | 'ignore';
	edgeType?: string;
	labelField?: string;
};

type MapOverlay = {
	units: 'm';
	plane: 'xy-meters';
	extent?: [number, number, number, number];
	levelsTable?: string; // default 'levels'
	levelOrderField?: string; // default 'ord'
	floorPlan?: {
		byLevelField?: string;
		imageExtentField?: string;
	};
};

type SearchOverlay = {
	fieldsByTable?: Record<string, string[]>;
};
```

### First overlay seed (intent)

| Key              | Intent                                                         |
| ---------------- | -------------------------------------------------------------- |
| `excludeTables`  | `__entity`, `__rollout`, `app_config`, `embeddings` (v1)       |
| `electric_rooms` | graph `room`; map on; `level` + `geometry`                     |
| `boards`         | graph `board`; `parentField: room`                             |
| `breakers`       | graph `breaker`; `parentField: board`; label `name`            |
| `connects`       | edge `feeds` (out to rents may map as to-output later)         |
| `rents`          | map on; graph `ignore` or treat out-target as output           |
| `zones`          | map on; graph ignore                                           |
| `shops`          | table only                                                     |
| `levels`         | `map.levelsTable`; not a normal grid entity (or special-cased) |
| `map`            | `units: 'm'`, `plane: 'xy-meters'`, `levelOrderField: 'ord'`   |

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
- `geometry<…>` → geom candidate (**enabled only if overlay says so**)
- other fields → default table columns
- graph **roles** never inferred from schema alone

**Cache:** by `ns + db` (invalidate on selection change). Optional TTL/schema hash later.

### Resolved output (views consume only this)

```ts
type ResolvedConfig = {
	version: 1;
	tables: ResolvedEntity[];
	relations: ResolvedEdge[];
	map: ResolvedMap;
	search: { fieldsByTable: Record<string, string[]> };
	graph: {
		hierarchy: Array<'room' | 'board' | 'breaker' | 'output' | 'group'>;
	};
	diagnostics?: Array<{ level: 'info' | 'warn' | 'error'; code: string; message: string }>;
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
- Layers from `map.enabled` entities
- Geometry normalizer: polygon + point (Surreal geometry in **same** metric plane)
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

| #       | Slice                                       | Outcome                        |
| ------- | ------------------------------------------- | ------------------------------ |
| **C0**  | Server mutate module + role gate            | **Done**                       |
| **C1**  | Table inline edit (SVAR) + patch            | **Done** (scalars; links via add form) |
| **C2**  | Table add/delete row                        | **Done**                       |
| **C3**  | Graph: persist `connects` on draw/delete    | **Done** (EDITOR/OWNER only; VIEWER blocked) |
| **C4**  | Map: geometry edit (vertex drag / assign)   | Spatial ops (optional v1.1)    |
| **N12** | Light overlay admin UI (`/config`, OWNER)   | **Done** — soft overlay editor |

### Immediate coding focus

```text
C4 or C1.1 (inline record picker)
```

Table + graph writes are live. VIEWER is read-only on all write seams (`assertCanEdit`).

### CRUD design (toward C0–C4)

**Roles**

| Role   | Read | Table cell/row | Graph wires | Map geom | Overlay admin |
| ------ | ---- | -------------- | ----------- | -------- | ------------- |
| VIEWER | ✓    | —              | —           | —        | —             |
| EDITOR | ✓    | ✓              | ✓           | later    | —             |
| OWNER  | ✓    | ✓              | ✓           | later    | ✓ (N12)       |

Gate on server from session user + catalog roles (same source as `userRoles` today). Client only hides controls.

**Write seam (C0)**

```text
src/lib/server/data/mutate.ts
  assertCanEdit(roles) → EDITOR | OWNER   // VIEWER always rejected
  patchRecord / createRecord / deleteRecord
  relateConnect(session, relation, inId, outId, meta?)
  unrelateConnect(session, relation, edgeId)
/graph actions: connect + disconnect (same role gate)
```

- Allowlist **table** via `ResolvedConfig.tables` / `isValidTableName`
- Allowlist **fields** via entity field list; reject `id`, hidden, `readOnly`
- Coerce link fields with RecordId; geometry later (C4)
- Prefer **remote functions or form actions** on `/table` (and later `/graph`) over ad-hoc fetch routes — same session cookies
- After write: `invalidateAll` / targeted invalidate so graph+map reload; keep `appUi.focusedId`

**Table (C1–C2)** — primary EE ops surface

- Columns already carry `readOnly` / `editor` from overlay merge → enable SVAR editors only when `canEdit`
- Cell commit → `patchRecord`; show error toast, revert on failure
- Add row: empty defaults + required fields; Delete: confirm, then `deleteRecord`
- Do not invent business defaults in UI without schema/seed guidance

**Graph (C3)** — topology only

- Today: `onconnect` only mutates client edges
- Persist: `RELATE $in -> connects -> $out` (+ optional cable meta)
- Delete selected edge → delete `connects` row
- Non-goals still: freehand redraw of rooms/boards; full output taxonomy UI

**Map (C4)** — later than table/graph wires

- Metric XY vertex edit / move polygon; write geometry field
- Level stays filter only unless moving feature across levels explicitly

**Out of scope for first CRUD slice**

- Embeddings / search (N9)
- Multiplayer OT/CRDT
- Overlay admin (N12) before C1 works
- Map draw tools before table+graph writes exist

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

---

## Out of scope (for now)

- Full three UIs before config spine
- Hand-maintained per-field TS catalogs for every table
- Using typegen alone as the runtime view schema
- Geo-referenced / distorted map projections
- Real-time multiplayer editing
- Replacing Surreal session/auth
- Overlay admin before table CRUD (C1) works
- Header search until embeddings service + data exist (N9 deferred)
- Map geometry editors before table + graph wire persist

---

## Open / follow-ups (non-blocking)

1. Confirm `connects` OUT to `rents` as the “output” story vs separate outputs table
2. Sample polygon/point seed coords in metric plane for map fixtures
3. Whether `shops` ever appear on map (v1: table only)
4. Floor-plan image fields on `levels` when assets exist
5. Embeddings service contract for N9 (fields, index, latency, auth)
6. Surreal permissions: ensure EDITOR can MERGE/CREATE/DELETE / RELATE on domain tables
7. Composite FK sort keys (`sortKey` from display parts) when SVAR needs header multi-key
8. C1 record picker reuses `formatRecordLabel` / label index (write path stays RecordIds)
9. Record `sort` default (config string) is client-side only — confirm SVAR header marks match on table reopen
