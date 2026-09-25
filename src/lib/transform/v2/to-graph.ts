/**
 * v2 graph transform: membership + knobs from `config.graph.nodes`, not entity.graph.
 * Output GraphViewModel is identical to v1 toGraph (SF-ready).
 */

import { withHandles } from '$lib/client/registries/nodes';
import type { GraphRole } from '$lib/config/types';
import {
	recordIdToString,
	type GraphEdge,
	type GraphEdgeData,
	type GraphNode,
	type GraphViewModel
} from '../to-graph';
import type { ResolvedConfigV2, ResolvedEntityV2, ResolvedGraphNodeV2 } from './shapes';

/**
 * Build SF graph from v2 resolved config + rows.
 * - Nodes from graph.nodes keys (joined with tables[] for fields/permissions only)
 * - Relations where role !== 'ignore'
 * - Parents before children; orphan parentId cleared; edges to missing nodes dropped
 */
export function toGraphV2(input: {
	config: ResolvedConfigV2;
	entities: Record<string, Array<Record<string, unknown>>>;
	relations: Record<string, Array<Record<string, unknown>>>;
}): GraphViewModel {
	const { config, entities, relations } = input;
	const entityByName = new Map(config.tables.map((t) => [t.name, t]));

	const nodeIds = new Set<string>();
	const nodes: GraphNode[] = [];

	// Stable iteration: hierarchy role order, then table name
	const nodeEntries = sortedNodeEntries(config);

	for (const [table, graph] of nodeEntries) {
		const entity = entityByName.get(table);
		const rows = entities[table] ?? [];
		for (const row of rows) {
			const node = rowToNodeV2(table, entity, graph, row);
			if (!node) continue;
			if (nodeIds.has(node.id)) continue;
			nodeIds.add(node.id);
			nodes.push(node);
		}
	}

	for (const node of nodes) {
		if (node.parentId && !nodeIds.has(node.parentId)) {
			delete node.parentId;
			delete node.extent;
		}
	}

	const ordered = orderParentsBeforeChildren(nodes);

	const edges: GraphEdge[] = [];
	const edgeIds = new Set<string>();
	const includedRelations = config.relations.filter((r) => r.role !== 'ignore');

	for (const rel of includedRelations) {
		const rows = relations[rel.name] ?? [];
		for (const row of rows) {
			const edge = rowToEdgeV2(rel.name, rel, row);
			if (!edge) continue;
			if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
			if (edgeIds.has(edge.id)) continue;
			edgeIds.add(edge.id);
			edges.push(edge);
		}
	}

	return {
		nodes: ordered,
		edges,
		layout: {
			...config.graph.layout,
			spacing: { ...config.graph.layout.spacing },
			compoundPadding: { ...config.graph.layout.compoundPadding }
		}
	};
}

/** hierarchy role order, then localeCompare table name. */
function sortedNodeEntries(config: ResolvedConfigV2): Array<[string, ResolvedGraphNodeV2]> {
	const rank = new Map(config.graph.hierarchy.map((role, i) => [role, i]));
	return Object.entries(config.graph.nodes).sort(([aName, a], [bName, b]) => {
		const ar = rank.get(a.role as (typeof config.graph.hierarchy)[number]);
		const br = rank.get(b.role as (typeof config.graph.hierarchy)[number]);
		const ai = ar === undefined ? Number.MAX_SAFE_INTEGER : ar;
		const bi = br === undefined ? Number.MAX_SAFE_INTEGER : br;
		if (ai !== bi) return ai - bi;
		return aName.localeCompare(bName);
	});
}

function isConnectable(role: GraphRole | string): boolean {
	return withHandles.includes(role ?? "");
}

function rowToNodeV2(
	table: string,
	entity: ResolvedEntityV2 | undefined,
	graph: ResolvedGraphNodeV2,
	row: Record<string, unknown>
): GraphNode | null {
	const id = recordIdToString(row.id, table);
	if (!id) return null;

	const label = resolveLabel(row, graph.labelField, id);
	const subtitle = resolveOptionalField(row, graph.subtitleField);
	const connectable = isConnectable(graph.role);
	const type = graph.nodeType ?? graph.role;

	const node: GraphNode = {
		id,
		type,
		position: { x: 0, y: 0 },
		connectable,
		data: {
			label,
			...(subtitle !== undefined ? { subtitle } : {}),
			table,
			role: graph.role,
			canConnect: connectable,
			values: serializeRowValues(row),
			raw: row
		}
	};

	if (graph.parentField) {
		const parentId = recordIdToString(row[graph.parentField]);
		if (parentId) {
			node.parentId = parentId;
			node.extent = 'parent';
		}
	}

	// entity reserved for future field-aware labels; membership is graph.nodes only
	void entity;
	return node;
}

function rowToEdgeV2(
	relName: string,
	rel: { role: string; edgeType?: string; labelField?: string },
	row: Record<string, unknown>
): GraphEdge | null {
	const source = recordIdToString(row.in);
	const target = recordIdToString(row.out);
	if (!source || !target) return null;

	const id = recordIdToString(row.id, relName) ?? `${relName}:${source}->${target}`;
	const label = resolveOptionalField(row, rel.labelField);

	const data: GraphEdgeData = { table: relName, role: rel.role };
	for (const [k, v] of Object.entries(row)) {
		if (k === 'id' || k === 'in' || k === 'out') continue;
		data[k] = v;
	}

	const edge: GraphEdge = {
		id,
		source,
		target,
		data
	};

	if (rel.edgeType) edge.type = rel.edgeType;
	if (label !== undefined) edge.label = label;

	return edge;
}

function resolveLabel(
	row: Record<string, unknown>,
	labelField: string | undefined,
	fallback: string
): string {
	if (labelField) {
		const v = row[labelField];
		if (v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
			return String(v);
		}
	}
	return fallback;
}

function resolveOptionalField(
	row: Record<string, unknown>,
	field: string | undefined
): string | undefined {
	if (!field) return undefined;
	const v = row[field];
	if (v == null) return undefined;
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
	return undefined;
}

function serializeRowValues(row: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(row)) {
		if (key === 'id' || value == null) continue;
		if (typeof value === 'object') {
			const id = recordIdToString(value);
			if (id != null) out[key] = id;
			continue;
		}
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			out[key] = String(value);
		}
	}
	return out;
}

function orderParentsBeforeChildren(nodes: GraphNode[]): GraphNode[] {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const ordered: GraphNode[] = [];

	function visit(id: string) {
		if (visited.has(id) || visiting.has(id)) return;
		const node = byId.get(id);
		if (!node) return;
		visiting.add(id);
		if (node.parentId && byId.has(node.parentId)) {
			visit(node.parentId);
		}
		visiting.delete(id);
		visited.add(id);
		ordered.push(node);
	}

	for (const node of nodes) {
		visit(node.id);
	}

	return ordered;
}
