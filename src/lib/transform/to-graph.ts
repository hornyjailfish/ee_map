import type { Edge, Node } from '@xyflow/svelte';
import type {
	GraphRole,
	ResolvedConfig,
	ResolvedEdge,
	ResolvedEntity,
	ResolvedGraphLayout
} from '$lib/config/types';
import { normalizeRecordId } from './to-table';

/**
 * Node payload for custom SF nodes.
 * `raw` is server-only (stripped before page data).
 */
export type GraphNodeData = {
	label: string;
	subtitle?: string;
	table: string;
	role: string;
	/** Client: breaker/output endpoints expose handles. */
	canConnect?: boolean;
	/** @deprecated prefer canConnect */
	isSource?: boolean;
	/** @deprecated prefer canConnect */
	isTarget?: boolean;
	/** Client: EDITOR/OWNER — show node toolbar. */
	canEdit?: boolean;
	/** Client: can open add-child modal for this parent. */
	canAddChild?: boolean;
	/** Client: toolbar label for child entity (e.g. "board"). */
	addChildLabel?: string;
	/** Client: can delete this domain node. */
	canDelete?: boolean;
	raw?: Record<string, unknown>;
};

/** Edge payload (relation table + role; extra keys allowed for labels etc.). */
export type GraphEdgeData = {
	table?: string;
	role?: string;
	[key: string]: unknown;
};

/**
 * SF node for the app graph. Built on `@xyflow/svelte` Node — do not hand-roll fields.
 * `type` is registry key (role or overlay nodeType); optional until set by toGraph.
 * Default SF generics keep `type` optional (unlike `Node<Data, string>` which requires it).
 */
export type GraphNode = Node<GraphNodeData>;

/** SF edge for the app graph. */
export type GraphEdge = Edge<GraphEdgeData>;

/**
 * Typed unions for custom node components / canvas generics.
 * Prefer these over bare `Node` / `Edge` at the SF boundary.
 */
export type AppNode =
	| Node<GraphNodeData, 'room'>
	| Node<GraphNodeData, 'board'>
	| Node<GraphNodeData, 'breaker'>
	| Node<GraphNodeData, 'output'>
	| Node<GraphNodeData, 'group'>
	| Node<GraphNodeData, 'default'>
	| Node<GraphNodeData, 'entity'>;

export type AppEdge = Edge<GraphEdgeData>;

export type GraphViewModel = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	/** ELK layout knobs from ResolvedConfig (always set by toGraph). */
	layout: ResolvedGraphLayout;
};

/**
 * Build SF graph from config + rows by table name + relation rows.
 * - Include entities with graph.role not ignore (and not missing graph)
 * - Nest via parentField pointing at parent record id
 * - Relation tables from config.relations where role !== 'ignore' → edges
 * - Parents must appear before children in nodes array (SF subflow requirement)
 * - Edges whose source/target node is missing are dropped
 * - Positions start at origin; client ELK fills real coords
 */
export function toGraph(input: {
	config: ResolvedConfig;
	/** table name → row records (SurrealKit row shapes when known; open for dynamic tables) */
	entities: Record<string, Array<Record<string, unknown>>>;
	/** relation table name → edge records (with in/out or similar) */
	relations: Record<string, Array<Record<string, unknown>>>;
}): GraphViewModel {
	const { config, entities, relations } = input;
	const includedEntities = config.tables.filter(
		(t) => t.graph != null && t.graph.role !== 'ignore'
	);

	const nodeIds = new Set<string>();
	const nodes: GraphNode[] = [];

	for (const entity of includedEntities) {
		const rows = entities[entity.name] ?? [];
		for (const row of rows) {
			const node = rowToNode(entity, row);
			if (!node) continue;
			if (nodeIds.has(node.id)) continue;
			nodeIds.add(node.id);
			nodes.push(node);
		}
	}

	// Only keep parentId when the parent node is actually in the graph
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
			const edge = rowToEdge(rel, row);
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

function isConnectable(role: GraphRole): boolean {
	switch (role) {
		case 'output':
		case 'breaker':
			return true;
		default:
			return false;
	}
}

function rowToNode(entity: ResolvedEntity, row: Record<string, unknown>): GraphNode | null {
	const graph = entity.graph;
	if (!graph || graph.role === 'ignore') return null;

	const id = recordIdToString(row.id, entity.name);
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
			table: entity.name,
			role: graph.role,
			canConnect: connectable,
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

	return node;
}

function rowToEdge(rel: ResolvedEdge, row: Record<string, unknown>): GraphEdge | null {
	const source = recordIdToString(row.in);
	const target = recordIdToString(row.out);
	if (!source || !target) return null;

	const id = recordIdToString(row.id, rel.name) ?? `${rel.name}:${source}->${target}`;
	const label = resolveOptionalField(row, rel.labelField);

	const data: GraphEdgeData = { table: rel.name, role: rel.role };
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

/**
 * Normalize Surreal record references to `table:key` strings (same rules as to-table).
 * Returns null when the value cannot form a usable id.
 * When `fallbackTable` is set and the value is a bare key, prefixes `fallbackTable:`.
 */
export function recordIdToString(value: unknown, fallbackTable?: string): string | null {
	if (value == null) return null;

	// Plain `{ table: string, id }` (JSON-ish) — to-table primarily handles `{ tb, id }` + RecordId.
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		if (typeof obj.table === 'string' && 'id' in obj && typeof obj.tb !== 'string') {
			const proto = Object.getPrototypeOf(value);
			const hasCustomToString =
				proto &&
				proto !== Object.prototype &&
				typeof (value as { toString?: unknown }).toString === 'function' &&
				(value as { toString: () => string }).toString !== Object.prototype.toString;
			if (!hasCustomToString) {
				const key = obj.id;
				const keyStr =
					typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint'
						? String(key)
						: null;
				if (keyStr != null && keyStr !== '') {
					return keyStr.includes(':') ? keyStr : `${obj.table}:${keyStr}`;
				}
			}
		}
	}

	const s = normalizeRecordId(value).trim();
	if (!s) return null;
	if (!s.includes(':') && fallbackTable) return `${fallbackTable}:${s}`;
	return s;
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

/** Stable topological order: each parent appears before its children. */
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
