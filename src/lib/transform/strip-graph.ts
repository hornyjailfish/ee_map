import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedGraphLayout } from '$lib/config/types';
import type {
	GraphEdge,
	GraphEdgeData,
	GraphNode,
	GraphNodeData,
	GraphViewModel
} from './to-graph';

/**
 * Strip non-POJO fields from a GraphViewModel before SvelteKit page data.
 * Removes `data.raw` (Surreal rows / RecordIds) and keeps only serializable edge metadata.
 * Layout knobs travel with the model so the client ELK run matches resolved config.
 */
export function stripGraphForClient(model: GraphViewModel): GraphViewModel {
	return {
		nodes: model.nodes.map(stripNode),
		edges: model.edges.map(stripEdge),
		layout: cloneLayout(model.layout)
	};
}

function cloneLayout(layout: ResolvedGraphLayout | undefined): ResolvedGraphLayout {
	const src = layout ?? DEFAULT_GRAPH_LAYOUT;
	return {
		direction: src.direction,
		align: src.align,
		spacing: { ...src.spacing },
		compoundPadding: { ...src.compoundPadding }
	};
}

function stripNode(node: GraphNode): GraphNode {
	const { raw: _raw, ...safeData } = node.data;
	const data: GraphNodeData = {
		label: safeData.label,
		table: safeData.table,
		role: safeData.role
	};
	if (safeData.subtitle !== undefined) data.subtitle = safeData.subtitle;
	if (safeData.canConnect !== undefined) data.canConnect = safeData.canConnect;

	const out: GraphNode = {
		id: node.id,
		position: node.position ? { ...node.position } : { x: 0, y: 0 },
		data
	};
	if (node.type !== undefined) out.type = node.type;
	if (node.parentId !== undefined) out.parentId = node.parentId;
	if (node.extent !== undefined) out.extent = node.extent;
	if (node.connectable !== undefined) out.connectable = node.connectable;
	return out;
}

function stripEdge(edge: GraphEdge): GraphEdge {
	const out: GraphEdge = {
		id: edge.id,
		source: edge.source,
		target: edge.target
	};
	if (edge.type !== undefined) out.type = edge.type;
	if (edge.label !== undefined) out.label = edge.label;

	const table = edge.data?.table;
	const role = edge.data?.role;
	if (typeof table === 'string' || typeof role === 'string') {
		const data: GraphEdgeData = {
			...(typeof table === 'string' ? { table } : {}),
			...(typeof role === 'string' ? { role } : {})
		};
		out.data = data;
	}

	return out;
}
