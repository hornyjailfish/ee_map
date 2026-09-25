/**
 * Configuration layer contracts.
 *
 * Flow: AutoProfile (live INFO) + AppConfigOverlay (sparse deltas) → ResolvedConfig.
 * Views consume ResolvedConfig only. Pure types — no runtime logic.
 */

// ─── Shared unions ───────────────────────────────────────────────────────────

/** Graph node roles assigned via overlay (never inferred from schema alone). */
export type GraphRole = 'room' | 'board' | 'breaker' | 'input' | 'output' | 'group' | 'ignore';

/** Hierarchy order for graph layout; excludes `ignore`. */
export type GraphHierarchyRole = Exclude<GraphRole, 'ignore'>;

/** Visual / semantic role for relation (edge) tables. */
export type EdgeRole = 'feeds' | 'to-output' | 'other' | 'ignore';

export type MapUnits = 'm';
export type MapPlane = 'xy-meters';

/** Diagnostic severity for merge / resolve soft failures. */
export type DiagnosticLevel = 'info' | 'warn' | 'error';

/**
 * Normalized field type from introspect (string form, not TS literals).
 * Examples: string | number | bool | record | geometry | array | …
 */
export type FieldTypeName = string;

// ─── Overlay (sparse deltas stored as app_config:main) ───────────────────────
//
// Soft contract: TS documents known keys; runtime soft-parse (overlay-io) keeps
// unknown nested/top-level fields so the shape can evolve without migrations.
// DB table is SCHEMALESS (view_configs.surql); seed uses INSERT IGNORE.

export type AppConfigOverlay = {
	version: 1 | 2;
	/** Table names skipped entirely (in addition to /^__/ system tables). */
	excludeTables?: string[];
	/** key = table name — identity + grid presentation only (slim in v2). */
	entities?: Record<string, EntityOverlay>;
	/**
	 * @deprecated v1 location for relation settings. Migrated to `graph.edges` on read.
	 * key = relation table name
	 */
	edges?: Record<string, EdgeOverlay>;
	/** Hierarchy is fixed by merge defaults; nodes/edges/layout are v2 graph knobs. */
	graph?: GraphOverlay;
	/** Map globals + per-table layers (`map.layers`). */
	map?: MapOverlay;
	search?: SearchOverlay;
};

/**
 * How an entity presents when referenced (table FK cells, pickers, …).
 * Prefer `parts` for composites; `field` is sugar for a single path on this row.
 * Paths may hop record links: `room.name` → this.room → that.name.
 */
export type EntityDisplayOverlay = {
	/** Single field on this entity (normalized to one part at merge). */
	field?: string;
	/** Ordered path segments joined with `sep`. */
	parts?: Array<{ path: string }>;
	/** Join string between parts; default `' · '`. */
	sep?: string;
};

/**
 * Entity overlay — identity + grid presentation.
 * In v2, graph / map participation lives on `graph.nodes.<table>` and
 * `map.layers.<table>`; the nested `graph` / `map` keys below are deprecated
 * v1 input that `liftOverlayV1toV2` migrates on read.
 */
export type EntityOverlay = {
	/** Display label for the entity (defaults to table name). */
	label?: string;
	/** Canonical label recipe when this entity is referenced. */
	display?: EntityDisplayOverlay;
	/** @deprecated v1 graph knobs — migrated to `graph.nodes.<table>`. */
	graph?: {
		role: GraphRole;
		parentField?: string;
		/** Client registry key for Svelte Flow node type. */
		nodeType?: string;
		labelField?: string;
		subtitleField?: string;
	};
	/** @deprecated v1 map knobs — migrated to `map.layers.<table>`. */
	map?: {
		/** Geometry layers are only active when explicitly enabled. */
		enabled?: boolean;
		levelField?: string;
		geometryField?: string;
		layerGroup?: string;
		/** Client registry key for OpenLayers style factory. */
		styleKey?: string;
		zIndex?: number;
	};
	table?: {
		hide?: string[];
		readOnly?: string[];
		/** Preferred column order; unspecified fields follow schema order after these. */
		order?: string[];
		/**
		 * Default grid sort when the entity opens.
		 * - string → one field, ascending
		 * - `{ field, dir? }` → one key
		 * - array → multi-key (primary first)
		 */
		sort?: string | TableSortKeyOverlay | TableSortKeyOverlay[];
		fields?: Record<string, FieldOverlay>;
	};
};

/** One default-sort key in overlay (dir defaults to asc). */
export type TableSortKeyOverlay = {
	field: string;
	dir?: 'asc' | 'desc';
};

export type FieldOverlay = {
	label?: string;
	hidden?: boolean;
	/**
	 * Column editor key (grid inline + add-row form share resolveFieldEditor):
	 * - `undefined` / omitted → default for field type
	 *   (`string`/`number`/`datetime` → `text`, `bool`/`record` → `combo`)
	 * - `false` → non-editable
	 * - `string` → registry key (`text`, `combo`, `richselect`, `datepicker`, …)
	 *   Register components with `registerEditor(key, { inline?, form? })`.
	 */
	editor?: false | string;
	width?: number;
	/** Override target-entity display for this column only. */
	display?: EntityDisplayOverlay;
};

export type EdgeOverlay = {
	role?: EdgeRole;
	/** Client registry key for edge type. */
	edgeType?: string;
	labelField?: string;
};

export type MapOverlay = {
	units: MapUnits;
	plane: MapPlane;
	/** [minX, minY, maxX, maxY] in map units. */
	extent?: [number, number, number, number];
	/** Default when resolving: `'levels'`. */
	levelsTable?: string;
	/** Default when resolving: `'ord'`. */
	levelOrderField?: string;
	floorPlan?: {
		byLevelField?: string;
		imageExtentField?: string;
	};
	/** Per-table layer knobs (v2). Presence of a key is map membership. */
	layers?: Record<string, MapLayerOverlay>;
};

export type SearchOverlay = {
	fieldsByTable?: Record<string, string[]>;
};

/** Layered ELK direction (vertical = DOWN, horizontal = RIGHT). */
export type GraphLayoutDirection = 'DOWN' | 'RIGHT';

/**
 * High-level alignment → concrete ELK keys in to-elk.
 * - center: BALANCED + contentAlignment center (default)
 * - start: LEFT / layer-start pack
 * - balance: BALANCED placement only (content left-packed)
 */
export type GraphLayoutAlign = 'start' | 'center' | 'balance';

export type GraphLayoutSpacingOverlay = {
	/** Sibling gap (elk.spacing.nodeNode). */
	node?: number;
	/** Gap between layers (elk.layered.spacing.nodeNodeBetweenLayers). */
	layer?: number;
	/** Edge↔node gap between layers (elk.layered.spacing.edgeNodeBetweenLayers). */
	edgeLayer?: number;
	/** Parallel edge gap (elk.layered.spacing.edgeEdgeBetweenLayers / elk.spacing.edgeEdge). */
	edgeEdge?: number;
	/** Edge↔node gap (elk.spacing.edgeNode). */
	edgeNode?: number;
};

export type GraphCompoundPaddingOverlay = {
	top?: number;
	left?: number;
	bottom?: number;
	right?: number;
};

/** Per-table graph node knobs under `graph.nodes.<table>` (v2). Presence = membership. */
export type GraphNodeOverlay = {
	/** Real roles only — `ignore` is expressed by omitting the table. */
	role: Exclude<GraphRole, 'ignore'>;
	parentField?: string;
	/** Client registry key for Svelte Flow node type. */
	nodeType?: string;
	labelField?: string;
	subtitleField?: string;
	/** Raw ELK string overrides for nodes of this table (win over global + structured). */
	layoutOptions?: Record<string, string>;
};

/** Per-table map layer knobs under `map.layers.<table>` (v2). Presence = enabled. */
export type MapLayerOverlay = {
	levelField?: string;
	geometryField?: string;
	layerGroup?: string;
	/** Client registry key for OpenLayers style factory. */
	styleKey?: string;
	zIndex?: number;
};

/** Sparse graph presentation / layout deltas on app_config (v2). */
export type GraphOverlay = {
	layout?: {
		direction?: GraphLayoutDirection;
		align?: GraphLayoutAlign;
		spacing?: GraphLayoutSpacingOverlay;
		compoundPadding?: GraphCompoundPaddingOverlay;
	};
	/** key = table name. */
	nodes?: Record<string, GraphNodeOverlay>;
	/** key = relation table name. */
	edges?: Record<string, EdgeOverlay>;
};

// ─── Surreal engine (introspect dialect / future compat) ─────────────────────

/**
 * Parsed engine identity from `session.version()`.
 * Stored on AutoProfile + ResolvedConfig so kind/STRUCTURE parsers can branch later.
 */
export type SurrealEngineVersion = {
	/** Raw string, e.g. `surrealdb-3.2.4+20260803.93ab219`. */
	raw: string;
	/** null when raw did not contain a parseable x.y.z. */
	major: number | null;
	minor: number | null;
	patch: number | null;
};

// ─── AutoProfile (ephemeral input from INFO introspect) ──────────────────────

export type AutoProfileTableKind = 'normal' | 'relation' | 'unknown';

export type AutoProfileField = {
	name: string;
	/** Normalized: string | number | bool | record | geometry | array | … */
	type: FieldTypeName;
	recordTargets?: string[];
	geometryKinds?: string[];
	optional?: boolean;
};

/**
 * Table-level write capabilities from `INFO FOR DB STRUCTURE` (`permissions`).
 * `true` = the permission is FULL; `false`/absent = not writable.
 * Missing booleans are treated as `false` by merge (fail closed).
 */
export type TablePermissions = {
	create?: boolean;
	update?: boolean;
	delete?: boolean;
	select?: boolean;
};

export type AutoProfileTable = {
	name: string;
	kind: AutoProfileTableKind;
	/** Relation `IN` table names when kind is `'relation'`. */
	in?: string[];
	/** Relation `OUT` table names when kind is `'relation'`. */
	out?: string[];
	fields: AutoProfileField[];
	/** Live write capabilities from STRUCTURE (the per-table "drop modifications" flag). */
	permissions?: TablePermissions;
};

export type AutoProfile = {
	tables: AutoProfileTable[];
	/**
	 * Engine that produced this STRUCTURE snapshot.
	 * Optional only for hand-built fixtures; live introspect always sets it when available.
	 */
	engine?: SurrealEngineVersion;
};

// ─── Resolved output (views consume only this) ───────────────────────────────

export type Diagnostic = {
	level: DiagnosticLevel;
	/** Stable machine code, e.g. `orphan_overlay_key`, `missing_parent_field`. */
	code: string;
	message: string;
};

/** Normalized display recipe (always `parts`; never the overlay sugar form). */
export type ResolvedEntityDisplay = {
	parts: Array<{ path: string }>;
	sep: string;
};

/**
 * Per-field presentation for table (and shared type metadata for other views).
 * Booleans are always set by merge — not optional flags.
 */
export type ResolvedField = {
	name: string;
	label: string;
	type: FieldTypeName;
	optional: boolean;
	recordTargets?: string[];
	geometryKinds?: string[];
	hidden: boolean;
	readOnly: boolean;
	/**
	 * Editor policy after merge (see FieldOverlay.editor):
	 * - `undefined` → default for `type`
	 * - `false` → non-editable
	 * - `string` → built-in or custom editor key
	 */
	editor?: false | string;
	width?: number;
	/** Column-only display override when formatting record cells. */
	display?: ResolvedEntityDisplay;
};

export type ResolvedEntityGraph = {
	role: GraphRole;
	parentField?: string;
	nodeType?: string;
	labelField?: string;
	subtitleField?: string;
};

/** Product views a table can participate in (derived at merge, not stored in overlay). */
export type ProductView = 'table' | 'graph' | 'map';

/** Resolved per-table graph node (from `graph.nodes.<table>`). Real roles only. */
export type ResolvedGraphNode = {
	role: Exclude<GraphRole, 'ignore'>;
	parentField?: string;
	nodeType?: string;
	labelField?: string;
	subtitleField?: string;
	/** Raw ELK string overrides for nodes of this table. */
	layoutOptions?: Record<string, string>;
};

export type ResolvedEntityMap = {
	enabled: boolean;
	levelField?: string;
	geometryField?: string;
	layerGroup?: string;
	styleKey?: string;
	zIndex?: number;
};

/**
 * One normal (non-relation) table after merge.
 * `fields` is in display order (overlay `order` applied, then remaining schema order).
 */
export type ResolvedEntity = {
	name: string;
	label: string;
	fields: ResolvedField[];
	/**
	 * Normalized write capabilities (create/update/delete), all defaulting to `false`.
	 * Views gate edit controls on this; server re-checks on every write.
	 */
	permissions: TablePermissions;
	/**
	 * How this entity labels itself when referenced (FK cells, pickers).
	 * Omitted only when no field/parts/heuristic applies.
	 */
	display?: ResolvedEntityDisplay;
	/**
	 * Default table sort keys (field must exist on the entity).
	 * Omitted when no usable sort config / heuristic applies.
	 */
	sort?: ResolvedTableSortKey[];
	/**
	 * Derived: which product views include this table.
	 * `table` by default; `graph` / `map` from `graph.nodes` / `map.layers` membership.
	 * Optional only to keep pre-v2 fixtures compiling; **merge always sets it**.
	 * Consumers check `views ?? ['table']`.
	 */
	views?: ProductView[];
	/**
	 * @deprecated Denormalized graph role retained during the v1 → v2 transition so
	 * existing consumers keep working. Prefer `config.graph.nodes[this.name]`.
	 * Still present when the entity participates in the graph (never `ignore`).
	 */
	graph?: ResolvedEntityGraph;
	/**
	 * @deprecated Denormalized map metadata retained during the v1 → v2 transition.
	 * Prefer `config.map.layers` (presence = membership).
	 */
	map?: ResolvedEntityMap;
};

/** Normalized default-sort key after merge. */
export type ResolvedTableSortKey = {
	field: string;
	dir: 'asc' | 'desc';
};

/**
 * One relation table after merge (edge candidate for graph).
 */
export type ResolvedEdge = {
	name: string;
	role: EdgeRole;
	edgeType?: string;
	labelField?: string;
	/** Source table names (`IN`). */
	in: string[];
	/** Target table names (`OUT`). */
	out: string[];
	/** Relation payload fields (excludes structural in/out id handling as needed by transforms). */
	fields: ResolvedField[];
	/** Normalized write capabilities (create/delete govern graph wire edits). */
	permissions: TablePermissions;
};

/** Derived map layer from an entity with `map.enabled === true`. */
export type ResolvedMapLayer = {
	table: string;
	/**
	 * FK used to filter by active level. Omitted for self-level tables (e.g. `levels`
	 * floor plans): feature id is treated as the level id.
	 */
	levelField?: string;
	geometryField: string;
	layerGroup?: string;
	/** Defaults to table name when overlay omits styleKey. */
	styleKey: string;
	zIndex: number;
};

export type ResolvedFloorPlan = {
	byLevelField?: string;
	imageExtentField?: string;
};

export type ResolvedMap = {
	units: MapUnits;
	plane: MapPlane;
	extent?: [number, number, number, number];
	/** Default `'levels'` when overlay omits. */
	levelsTable: string;
	/** Default `'ord'` when overlay omits. */
	levelOrderField: string;
	floorPlan?: ResolvedFloorPlan;
	/** Entities with map.enabled; ordered by zIndex ascending then table name. */
	layers: ResolvedMapLayer[];
};

export type ResolvedSearch = {
	fieldsByTable: Record<string, string[]>;
};

/** Fully resolved ELK-facing layout knobs (no optionals — merge fills defaults). */
export type ResolvedGraphLayout = {
	direction: GraphLayoutDirection;
	align: GraphLayoutAlign;
	spacing: {
		node: number;
		layer: number;
		edgeLayer: number;
		edgeEdge: number;
		edgeNode: number;
	};
	compoundPadding: { top: number; left: number; bottom: number; right: number };
};

export type ResolvedGraph = {
	/**
	 * Canonical top-down hierarchy for layout.
	 * Default: `['room', 'board', 'breaker', 'output', 'group']`.
	 */
	hierarchy: GraphHierarchyRole[];
	/** ELK options derived from overlay.graph.layout + defaults. */
	layout: ResolvedGraphLayout;
	/**
	 * key = table name; presence = graph membership (no `ignore` entries).
	 * Optional only to keep pre-v2 fixtures compiling; **merge always sets it**.
	 */
	nodes?: Record<string, ResolvedGraphNode>;
};

export type ResolvedConfig = {
	/** `2` once merge emits v2; `1` allowed only for pre-v2 fixtures. */
	version: 1 | 2;
	/**
	 * Surreal engine used when this config was resolved (from introspect).
	 * Omitted only when merge input had no engine (unit fixtures).
	 */
	engine?: SurrealEngineVersion;
	tables: ResolvedEntity[];
	relations: ResolvedEdge[];
	map: ResolvedMap;
	search: ResolvedSearch;
	graph: ResolvedGraph;
	/** Always present (may be empty) so consumers need not optional-chain. */
	diagnostics: Diagnostic[];
};
