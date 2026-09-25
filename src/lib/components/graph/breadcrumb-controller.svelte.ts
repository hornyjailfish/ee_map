import type { GraphNode, BreadcrumbLevel } from '$lib/transform/to-graph';

/**
 * Reactive crumb builder for the graph breadcrumb.
 *
 * Fed by the Breadcrumb component (all nodes + current flow selection); derives
 * the trail titles and the drill-down options per hierarchy level. Levels come
 * from ResolvedConfig.graph.hierarchy, so the trail is driven by app graph
 * config instead of hard-coded table names.
 */
export class CrumbBuilder {
	/** Ordered levels present in the graph config (role + fallback label). */
	levels: BreadcrumbLevel[];

	/** Every node in the flow — kept in sync by the component. */
	all: GraphNode[] = $state([]);

	/** Currently selected flow nodes — kept in sync by the component. */
	selection: GraphNode[] = $state([]);

	constructor(levels: BreadcrumbLevel[]) {
		this.levels = levels;
	}

	/** Selected nodes grouped by level order. */
	selection_grouped = $derived(this.grouped(this.selection));

	/** Nodes available for drilling: the full graph, or the selected subtrees. */
	filtered = $derived.by(() => {
		if (this.selection.length === 0) return this.all;
		const out = new Set<GraphNode>();
		for (const node of this.selection) {
			for (const n of this.subtree(node)) out.add(n);
		}
		return [...out];
	});

	filter_grouped = $derived(this.grouped(this.filtered));

	/** Per-level trail label: selected node, `N selected`, or the level label. */
	titles = $derived.by(() =>
		this.selection_grouped.map((items, index) => {
			if (items.length === 0) return this.levelLabel(index);
			if (items.length > 1) return `${items.length} selected`;
			return items[0].data.label;
		})
	);

	/** True where a level has multiple selected nodes (italicized `N selected`). */
	italics = $derived.by(() => this.selection_grouped.map((items) => items.length > 1));

	private grouped(nodes: GraphNode[]): GraphNode[][] {
		return this.levels.map((level) => nodes.filter((n) => n.data.role === level.role));
	}

	private levelLabel(index: number): string {
		return this.levels[index]?.label ?? this.levels[index]?.role ?? '';
	}

	/** A node plus all of its descendants (by parentId within the flow). */
	private subtree(root: GraphNode): Set<GraphNode> {
		const out = new Set<GraphNode>([root]);
		const walk = (parent: GraphNode) => {
			for (const node of this.all) {
				if (node.parentId === parent.id && !out.has(node)) {
					out.add(node);
					walk(node);
				}
			}
		};
		walk(root);
		return out;
	}
}
