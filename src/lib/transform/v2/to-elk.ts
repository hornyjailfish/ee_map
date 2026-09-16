/**
 * v2 ELK transform: per-table layoutOptions from `graph.nodes[table].layoutOptions`.
 * Baseline still comes from graph.layout; table map wins on key clash (PLAN N13).
 */

import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import {
	compoundLayoutOptions,
	layoutToElkOptions,
	subtreeNodeIds,
	type ElkEdgeLike,
	type ElkNodeLike,
	type ElkNodeSize,
	type ToElkGraphOptions
} from '../to-elk';
import { naturalCompare } from '../compare';
import type { GraphEdge, GraphNode, GraphViewModel } from '../to-graph';
import type { ResolvedConfigV2, ResolvedGraphNodeV2 } from './shapes';

export type ToElkGraphV2Options = ToElkGraphOptions & {
	/**
	 * table name → ELK option strings (from resolved graph.nodes[table].layoutOptions).
	 * Merged onto compounds and leaves of that table after global layout options.
	 */
	layoutOptionsByTable?: Readonly<Record<string, Record<string, string>>>;
};

const FALLBACK_SIZE: ElkNodeSize = { width: 16, height: 16 };

/** Collect non-empty layoutOptions maps from graph.nodes. */
export function layoutOptionsByTableFromNodes(
	nodes: Readonly<Record<string, Pick<ResolvedGraphNodeV2, 'layoutOptions'>>>
): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	for (const [table, node] of Object.entries(nodes)) {
		if (node.layoutOptions && Object.keys(node.layoutOptions).length > 0) {
			out[table] = { ...node.layoutOptions };
		}
	}
	return out;
}

export function layoutOptionsByTableFromConfig(
	config: Pick<ResolvedConfigV2, 'graph'>
): Record<string, Record<string, string>> {
	return layoutOptionsByTableFromNodes(config.graph.nodes);
}

/**
 * Convert GraphViewModel → ELK JSON with optional per-table layoutOptions.
 * Same nesting / sizing rules as v1 toElkGraph; compounds get
 * compoundLayoutOptions(layout) then table overrides; leaves may carry table options too.
 */
export function toElkGraphV2(model: GraphViewModel, options?: ToElkGraphV2Options): ElkNodeLike {
	const byId = new Map(model.nodes.map((n) => [n.id, n]));
	const childrenOf = new Map<string, GraphNode[]>();
	const roots: GraphNode[] = [];
	const fallback = options?.fallbackSize ?? FALLBACK_SIZE;
	const sizes = normalizeSizes(options?.sizes);
	const layout = options?.layout ?? model.layout ?? DEFAULT_GRAPH_LAYOUT;
	const rootId = options?.rootId;
	const byTable = options?.layoutOptionsByTable ?? {};

	for (const node of model.nodes) {
		if (node.parentId && byId.has(node.parentId)) {
			const list = childrenOf.get(node.parentId) ?? [];
			list.push(node);
			childrenOf.set(node.parentId, list);
		} else {
			roots.push(node);
		}
	}

	for (const [, kids] of childrenOf) {
		kids.sort(compareGraphNodes);
	}
	roots.sort(compareGraphNodes);

	function sizeOf(id: string): ElkNodeSize {
		const s = sizes.get(id);
		if (s && s.width > 0 && s.height > 0) return s;
		return fallback;
	}

	function tableOptions(node: GraphNode): Record<string, string> | undefined {
		const table = node.data.table;
		if (!table) return undefined;
		const opts = byTable[table];
		return opts && Object.keys(opts).length > 0 ? opts : undefined;
	}

	function toElkNode(node: GraphNode): ElkNodeLike {
		const kids = childrenOf.get(node.id) ?? [];
		const elk: ElkNodeLike = { id: node.id };
		const extra = tableOptions(node);

		if (kids.length > 0) {
			elk.children = kids.map(toElkNode);
			elk.layoutOptions = {
				...compoundLayoutOptions(layout),
				...(extra ?? {})
			};
		} else {
			const measured = sizeOf(node.id);
			elk.width = measured.width;
			elk.height = measured.height;
			if (extra) {
				elk.layoutOptions = { ...extra };
			}
		}
		return elk;
	}

	const rootLayoutOptions = {
		...layoutToElkOptions(layout),
		...(options?.layoutOptions ?? {})
	};

	if (rootId && byId.has(rootId)) {
		const scope = subtreeNodeIds(model, rootId);
		const edges: ElkEdgeLike[] = [...model.edges]
			.filter((e) => scope.has(e.source) && scope.has(e.target))
			.sort((a, b) => compareEdges(a, b, byId))
			.map((e) => edgeToElk(e));
		const kids = childrenOf.get(rootId) ?? [];
		const rootNode = byId.get(rootId)!;
		const rootExtra = tableOptions(rootNode);

		return {
			id: rootId,
			layoutOptions: {
				...rootLayoutOptions,
				...(rootExtra ?? {})
			},
			children: kids.map(toElkNode),
			edges
		};
	}

	const edges: ElkEdgeLike[] = [...model.edges]
		.sort((a, b) => compareEdges(a, b, byId))
		.map((e) => edgeToElk(e));

	return {
		id: 'root',
		layoutOptions: rootLayoutOptions,
		children: roots.map(toElkNode),
		edges
	};
}

/** Convenience: model + v2 config → ELK (layoutOptionsByTable from graph.nodes). */
export function toElkGraphFromConfigV2(
	model: GraphViewModel,
	config: Pick<ResolvedConfigV2, 'graph'>,
	options?: Omit<ToElkGraphV2Options, 'layoutOptionsByTable' | 'layout'> & {
		layout?: ToElkGraphV2Options['layout'];
	}
): ElkNodeLike {
	return toElkGraphV2(model, {
		...options,
		layout: options?.layout ?? model.layout ?? config.graph.layout,
		layoutOptionsByTable: layoutOptionsByTableFromConfig(config)
	});
}

function compareGraphNodes(a: GraphNode, b: GraphNode): number {
	const byLabel = naturalCompare(a.data.label ?? '', b.data.label ?? '');
	if (byLabel !== 0) return byLabel;
	return naturalCompare(a.id, b.id);
}

function compareEdges(a: GraphEdge, b: GraphEdge, byId: ReadonlyMap<string, GraphNode>): number {
	const aSrc = byId.get(a.source);
	const bSrc = byId.get(b.source);
	const bySource = naturalCompare(aSrc?.data.label ?? a.source, bSrc?.data.label ?? b.source);
	if (bySource !== 0) return bySource;
	const aTgt = byId.get(a.target);
	const bTgt = byId.get(b.target);
	const byTarget = naturalCompare(aTgt?.data.label ?? a.target, bTgt?.data.label ?? b.target);
	if (byTarget !== 0) return byTarget;
	return naturalCompare(a.id, b.id);
}

function normalizeSizes(sizes: ToElkGraphOptions['sizes']): Map<string, ElkNodeSize> {
	if (!sizes) return new Map();
	if (sizes instanceof Map) return sizes;
	return new Map(Object.entries(sizes));
}

function edgeToElk(edge: GraphEdge): ElkEdgeLike {
	return {
		id: edge.id,
		sources: [edge.source],
		targets: [edge.target]
	};
}
