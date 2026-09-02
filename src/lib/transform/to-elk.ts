import type { ResolvedGraphLayout } from '$lib/config/types';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { GraphEdge, GraphNode, GraphViewModel } from './to-graph';

/** Loose ELK graph JSON shape (avoids hard dependency on worker types in consumers). */
export type ElkNodeLike = {
	id: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	layoutOptions?: Record<string, string>;
	children?: ElkNodeLike[];
	edges?: ElkEdgeLike[];
};

export type ElkEdgeLike = {
	id: string;
	sources: string[];
	targets: string[];
	layoutOptions?: Record<string, string>;
};

export type ElkNodeSize = {
	width: number;
	height: number;
};

const FALLBACK_SIZE: ElkNodeSize = { width: 16, height: 16 };

/**
 * Fixed chrome padding for compound (parent) nodes.
 * Must NOT be derived from measured compound height after layout — that height already
 * includes children, so feeding it back as top padding makes parents grow on every re-layout.
 *
 */
export const COMPOUND_PADDING = DEFAULT_GRAPH_LAYOUT.compoundPadding;

type AlignElk = {
	fixedAlignment: string;
	contentAlignment: string;
};

function alignToElk(align: ResolvedGraphLayout['align']): AlignElk {
	switch (align) {
		case 'start':
			return {
				fixedAlignment: 'LEFTDOWN',
				contentAlignment: 'V_TOP H_LEFT'
			};
		case 'balance':
			return {
				fixedAlignment: 'BALANCED',
				contentAlignment: 'V_TOP H_LEFT'
			};
		case 'center':
		default:
			return {
				fixedAlignment: 'BALANCED',
				contentAlignment: 'V_CENTER H_CENTER'
			};
	}
}

/** Shared layered spacing (root + compounds). Keeps fan-out wires from blowing vertical gap. */
function spacingToElk(layout: ResolvedGraphLayout): Record<string, string> {
	const s = layout.spacing;
	return {
		'elk.spacing.nodeNode': String(s.node),
		'elk.layered.spacing.nodeNodeBetweenLayers': String(s.layer),
		'elk.layered.spacing.edgeNodeBetweenLayers': String(s.edgeLayer),
		'elk.layered.spacing.edgeEdgeBetweenLayers': String(s.edgeEdge),
		'elk.spacing.edgeNode': String(s.edgeNode),
		'elk.spacing.edgeEdge': String(s.edgeEdge)
	};
}

/**
 * Map ResolvedGraphLayout (product words) → ELK root option strings.
 * Callers can still merge extra `layoutOptions` overrides on top.
 */
export function layoutToElkOptions(
	layout: ResolvedGraphLayout = DEFAULT_GRAPH_LAYOUT
): Record<string, string> {
	const pad = layout.compoundPadding;
	const align = alignToElk(layout.align);

	return {
		'elk.algorithm': 'layered',
		'elk.direction': layout.direction,
		'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
		'elk.padding': `[top=${pad.top},left=${pad.left},bottom=${pad.bottom},right=${pad.right}]`,
		'elk.layered.nodePlacement.bk.fixedAlignment': align.fixedAlignment,
		'elk.contentAlignment': align.contentAlignment,
		...spacingToElk(layout)
	};
}

/**
 * Layout options on compound nodes (room / board / group).
 *
 * Critical: `fixedAlignment: BALANCED` must be set **on the compound**, not only the root.
 * Root-only BALANCED still left-packs children inside INCLUDE_CHILDREN compounds
 * (main feeder sits on the left instead of top-center of the board).
 */
export function compoundLayoutOptions(layout: ResolvedGraphLayout): Record<string, string> {
	const pad = layout.compoundPadding;
	const align = alignToElk(layout.align);

	return {
		'elk.padding': `[top=${pad.top},left=${pad.left},bottom=${pad.bottom},right=${pad.right}]`,
		// Direction helps nested layered runs keep the same flow as root
		'elk.direction': layout.direction,
		'elk.layered.nodePlacement.bk.fixedAlignment': align.fixedAlignment,
		'elk.contentAlignment': align.contentAlignment,
		...spacingToElk(layout)
	};
}

export type ToElkGraphOptions = {
	/** Override / extend resolved layout → ELK strings. */
	layoutOptions?: Record<string, string>;
	/**
	 * Measured sizes from Svelte Flow for **leaf** nodes only.
	 * Compound sizes are computed by ELK from children + fixed padding.
	 */
	sizes?: ReadonlyMap<string, ElkNodeSize> | Record<string, ElkNodeSize>;
	/** Used only when a leaf has no entry in `sizes`. Prefer measured sizes. */
	fallbackSize?: ElkNodeSize;
	/**
	 * Layout knobs. Defaults to `model.layout`, then DEFAULT_GRAPH_LAYOUT.
	 * Prefer putting layout on GraphViewModel via toGraph.
	 */
	layout?: ResolvedGraphLayout;
};

/**
 * Convert GraphViewModel to ELK graph JSON (nested children for parentId).
 * Edges sit on the root with sources/targets as node ids.
 * Leaf sizes come from Flow measurements — compounds never feed measured full-box height back.
 */
export function toElkGraph(model: GraphViewModel, options?: ToElkGraphOptions): ElkNodeLike {
	const byId = new Map(model.nodes.map((n) => [n.id, n]));
	const childrenOf = new Map<string, GraphNode[]>();
	const roots: GraphNode[] = [];
	const fallback = options?.fallbackSize ?? FALLBACK_SIZE;
	const sizes = normalizeSizes(options?.sizes);
	const layout = options?.layout ?? model.layout ?? DEFAULT_GRAPH_LAYOUT;

	for (const node of model.nodes) {
		if (node.parentId && byId.has(node.parentId)) {
			const list = childrenOf.get(node.parentId) ?? [];
			list.push(node);
			childrenOf.set(node.parentId, list);
		} else {
			roots.push(node);
		}
	}

	function sizeOf(id: string): ElkNodeSize {
		const s = sizes.get(id);
		if (s && s.width > 0 && s.height > 0) return s;
		return fallback;
	}

	function toElkNode(node: GraphNode): ElkNodeLike {
		const kids = childrenOf.get(node.id) ?? [];
		const elk: ElkNodeLike = { id: node.id };

		if (kids.length > 0) {
			// Compounds: size from children + fixed padding; BALANCED lives here (not only root)
			elk.children = kids.map(toElkNode);
			elk.layoutOptions = compoundLayoutOptions(layout);
		} else {
			// Leaves: use Flow-measured content box
			const measured = sizeOf(node.id);
			elk.width = measured.width;
			elk.height = measured.height;
		}
		return elk;
	}

	const edges: ElkEdgeLike[] = model.edges.map((e) => edgeToElk(e));

	return {
		id: 'root',
		layoutOptions: {
			...layoutToElkOptions(layout),
			...(options?.layoutOptions ?? {})
		},
		children: roots.map(toElkNode),
		edges
	};
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

/**
 * Apply ELK layout result positions back onto a new GraphViewModel (immutable).
 * Nested ELK coordinates are parent-relative, matching Svelte Flow nested node positions.
 */
export function applyElkLayout(model: GraphViewModel, layout: ElkNodeLike): GraphViewModel {
	const positions = new Map<string, { x: number; y: number }>();
	collectPositions(layout, positions);

	const nodes = model.nodes.map((node) => {
		const pos = positions.get(node.id);
		if (!pos) {
			return {
				...node,
				data: { ...node.data },
				position: { ...node.position }
			};
		}
		return {
			...node,
			data: { ...node.data },
			position: { x: pos.x, y: pos.y }
		};
	});

	const edges = model.edges.map((e) => ({
		...e,
		...(e.data ? { data: { ...e.data } } : {})
	}));

	return {
		nodes,
		edges,
		layout: {
			...model.layout,
			spacing: { ...model.layout.spacing },
			compoundPadding: { ...model.layout.compoundPadding }
		}
	};
}

/** Collect ELK-computed width/height for every non-root node. */
export function collectElkSizes(layout: ElkNodeLike): Map<string, ElkNodeSize> {
	const out = new Map<string, ElkNodeSize>();
	collectSizes(layout, out, true);
	return out;
}

function collectPositions(
	node: ElkNodeLike,
	out: Map<string, { x: number; y: number }>,
	/** Skip assigning the synthetic root id. */
	isRoot = true
): void {
	if (!isRoot && node.id && node.x != null && node.y != null) {
		out.set(node.id, { x: node.x, y: node.y });
	}
	if (node.children) {
		for (const child of node.children) {
			collectPositions(child, out, false);
		}
	}
}

function collectSizes(node: ElkNodeLike, out: Map<string, ElkNodeSize>, isRoot = true): void {
	if (!isRoot && node.id && node.width != null && node.height != null) {
		out.set(node.id, { width: node.width, height: node.height });
	}
	if (node.children) {
		for (const child of node.children) {
			collectSizes(child, out, false);
		}
	}
}
