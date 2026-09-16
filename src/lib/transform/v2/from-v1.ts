/**
 * Pure lift: shipped v1 ResolvedConfig → v2 structural shape.
 *
 * Used so v2 transforms can be tested and kept ready before merge/overlay N13.
 * Does not mutate input. Does not touch overlay seed or soft-parse.
 *
 * Mapping (PLAN migration):
 * - entities[t].graph (role ≠ ignore) → graph.nodes[t]
 * - map.layers already authoritative for map membership
 * - entity.views derived (table default; graph/map from nodes/layers)
 */

import type { ResolvedConfig, ResolvedEntity, ResolvedEntityGraph } from '$lib/config/types';
import type {
	ProductView,
	ResolvedConfigV2,
	ResolvedEntityV2,
	ResolvedGraphNodeV2
} from './shapes';

/**
 * Build `graph.nodes` index from v1 per-entity `graph` bags.
 * Drops missing graph and `role: 'ignore'`.
 */
export function graphNodesFromV1(
	tables: ReadonlyArray<Pick<ResolvedEntity, 'name' | 'graph'>>
): Record<string, ResolvedGraphNodeV2> {
	const nodes: Record<string, ResolvedGraphNodeV2> = {};

	for (const entity of tables) {
		const lifted = liftGraphNode(entity.graph);
		if (lifted) nodes[entity.name] = lifted;
	}

	return nodes;
}

/** Single entity.graph → node entry, or null when not in graph. */
export function liftGraphNode(graph: ResolvedEntityGraph | undefined): ResolvedGraphNodeV2 | null {
	if (!graph || graph.role === 'ignore') return null;

	const node: ResolvedGraphNodeV2 = { role: graph.role };
	if (graph.parentField !== undefined) node.parentField = graph.parentField;
	if (graph.nodeType !== undefined) node.nodeType = graph.nodeType;
	if (graph.labelField !== undefined) node.labelField = graph.labelField;
	if (graph.subtitleField !== undefined) node.subtitleField = graph.subtitleField;
	return node;
}

/**
 * Derive product views for one table from v1 denorm + layer index.
 * - table: always (v1 has no `table: false` on resolved entities yet)
 * - graph: graph.nodes membership
 * - map: presence in map.layers (preferred) or entity.map.enabled
 */
export function deriveViewsFromV1(
	entity: Pick<ResolvedEntity, 'name' | 'graph' | 'map'>,
	layerTables: ReadonlySet<string>
): ProductView[] {
	const views: ProductView[] = ['table'];

	if (entity.graph != null && entity.graph.role !== 'ignore') {
		views.push('graph');
	}

	if (layerTables.has(entity.name) || entity.map?.enabled === true) {
		views.push('map');
	}

	return views;
}

/** Strip entity to slim v2 fields + derived views. */
export function slimEntityFromV1(
	entity: ResolvedEntity,
	layerTables: ReadonlySet<string>
): ResolvedEntityV2 {
	const slim: ResolvedEntityV2 = {
		name: entity.name,
		label: entity.label,
		fields: entity.fields,
		permissions: entity.permissions,
		views: deriveViewsFromV1(entity, layerTables)
	};
	if (entity.display !== undefined) slim.display = entity.display;
	if (entity.sort !== undefined) slim.sort = entity.sort;
	return slim;
}

/**
 * Full v1 ResolvedConfig → v2 shape for transform alternatives.
 * Map layers / relations / search / layout pass through.
 */
export function liftResolvedConfigV1(config: ResolvedConfig): ResolvedConfigV2 {
	const layerTables = new Set(config.map.layers.map((l) => l.table));
	const nodes = graphNodesFromV1(config.tables);

	const out: ResolvedConfigV2 = {
		version: 2,
		tables: config.tables.map((t) => slimEntityFromV1(t, layerTables)),
		relations: config.relations,
		graph: {
			hierarchy: config.graph.hierarchy,
			layout: {
				...config.graph.layout,
				spacing: { ...config.graph.layout.spacing },
				compoundPadding: { ...config.graph.layout.compoundPadding }
			},
			nodes
		},
		map: {
			...config.map,
			layers: config.map.layers.map((l) => ({ ...l }))
		},
		search: {
			fieldsByTable: { ...config.search.fieldsByTable }
		},
		diagnostics: config.diagnostics.map((d) => ({ ...d }))
	};

	if (config.engine !== undefined) out.engine = config.engine;
	return out;
}
