/**
 * Structural contracts for config-shape v2 transforms (N13).
 *
 * Not a second copy of `$lib/config/types` — only the resolved surfaces
 * that differ from shipped v1 (`graph.nodes`, derived `views`, no entity.graph/map).
 * Reuses existing field/edge/map/layout types where the shape is unchanged.
 *
 * Callers stay on v1 ResolvedConfig until merge/overlay switch; use
 * `liftResolvedConfigV1` to exercise these transforms today.
 */

import type {
	Diagnostic,
	GraphHierarchyRole,
	GraphRole,
	ResolvedEdge,
	ResolvedEntityDisplay,
	ResolvedField,
	ResolvedGraphLayout,
	ResolvedMap,
	ResolvedSearch,
	ResolvedTableSortKey,
	SurrealEngineVersion,
	TablePermissions
} from '$lib/config/types';

/** Product views a table can participate in (derived at merge, not stored in overlay). */
export type ProductView = 'table' | 'graph' | 'map';

/**
 * Per-table graph node settings (overlay `graph.nodes` → resolved index).
 * Presence of a key is membership; no `role: 'ignore'` — omit the table instead.
 */
export type ResolvedGraphNodeV2 = {
	/** Real roles only — ignore is expressed by absence from `nodes`. */
	role: Exclude<GraphRole, 'ignore'>;
	parentField?: string;
	nodeType?: string;
	labelField?: string;
	subtitleField?: string;
	/**
	 * Final ELK string map for nodes of this table (structured layout already folded in at merge).
	 * Applied in to-elk on compounds/leaves of this table.
	 */
	layoutOptions?: Record<string, string>;
};

export type ResolvedGraphV2 = {
	hierarchy: GraphHierarchyRole[];
	layout: ResolvedGraphLayout;
	/** key = table name */
	nodes: Record<string, ResolvedGraphNodeV2>;
};

/**
 * Slim resolved entity: identity + grid + derived view membership.
 * Graph/map knobs live on `config.graph.nodes` / `config.map.layers`.
 */
export type ResolvedEntityV2 = {
	name: string;
	label: string;
	fields: ResolvedField[];
	permissions: TablePermissions;
	display?: ResolvedEntityDisplay;
	sort?: ResolvedTableSortKey[];
	/** Derived: which product views include this table. */
	views: ProductView[];
};

/** Resolved config surface consumed by v2 transforms. */
export type ResolvedConfigV2 = {
	version: 2;
	engine?: SurrealEngineVersion;
	tables: ResolvedEntityV2[];
	relations: ResolvedEdge[];
	graph: ResolvedGraphV2;
	map: ResolvedMap;
	search: ResolvedSearch;
	diagnostics: Diagnostic[];
};
