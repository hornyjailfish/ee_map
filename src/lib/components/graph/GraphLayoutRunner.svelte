<script lang="ts">
	/**
	 * Inside `<SvelteFlow>`: wait for measured nodes, run ELK, push result up.
	 * - Auto: once when `nodesInitialized` becomes true (full graph + fit)
	 * - Manual: whenever `layoutRequest` increases
	 *   - full graph (+ fit) from the Layout button
	 *   - subtree from a compound root (+ no fit) from node toolbar
	 * Leaf sizes only — compounds never feed post-layout full-box height back into ELK.
	 * Layout options come from `graph.layout` (ResolvedConfig).
	 */
	import { onDestroy } from 'svelte';
	import { useNodesInitialized, useSvelteFlow } from '@xyflow/svelte';
	import ELK from 'elkjs/lib/elk.bundled.js';
	import {
		applyElkLayoutResult,
		subtreeNodeIds,
		toElkGraph,
		type ElkNodeLike
	} from '$lib/transform/to-elk';
	import type { GraphEdge, GraphNode, GraphViewModel } from '$lib/transform/to-graph';
	import {
		compoundIds,
		mergeLaidOutNodes,
		sizesFromFlow,
		toFlowEdges,
		toLaidOutNodes,
		type GraphNodeUiOpts
	} from './graph-flow';

	export type LayoutRequestOpts = {
		/** Compound node id to layout as root; null/omit = whole graph. */
		rootId?: string | null;
		/** Fit camera after layout. Defaults: true for full, false for subtree. */
		fit?: boolean;
	};

	type LayoutResult = {
		nodes: GraphNode[];
		/** Omitted on subtree layout so canvas keeps current edge objects. */
		edges?: GraphEdge[];
	};

	type Props = {
		graph: GraphViewModel;
		/** EDITOR toolbar flags applied after ELK. */
		nodeUi?: GraphNodeUiOpts;
		/** Bumped by parent to force a re-layout (button). 0 = no manual request yet. */
		layoutRequest?: number;
		/** Options for the latest manual `layoutRequest` (read when request bumps). */
		layoutRequestOpts?: LayoutRequestOpts | null;
		/**
		 * When true (default), fit camera after layout (initial mount + Layout button).
		 * Wire persist path should not remount; if it ever relayouts, pass false to keep camera.
		 */
		fitViewAfter?: boolean;
		onLayoutStart?: () => void;
		onLayoutDone: (result: LayoutResult) => void;
		onLayoutError: (message: string, fallback: LayoutResult) => void;
	};

	let {
		graph,
		nodeUi = {},
		layoutRequest = 0,
		layoutRequestOpts = null,
		fitViewAfter = true,
		onLayoutStart,
		onLayoutDone,
		onLayoutError
	}: Props = $props();

	const nodesInitialized = useNodesInitialized();
	const { fitView, getNodes } = useSvelteFlow();
	const elk = new ELK();

	// Plain (non-reactive) guards — must not be $state or this effect loops on itself
	let autoDone = false;
	let lastManualRequest = 0;
	let running = false;
	let disposed = false;

	onDestroy(() => {
		disposed = true;
	});

	async function runLayout(opts?: { fit?: boolean; rootId?: string | null }) {
		if (running || disposed) return;
		running = true;
		const rootId = opts?.rootId || null;
		const shouldFit = opts?.fit ?? (rootId ? false : fitViewAfter);
		onLayoutStart?.();

		try {
			const flowNodes = getNodes() as GraphNode[];
			const parents = compoundIds(graph);
			const sizes = sizesFromFlow(flowNodes, parents);
			const elkGraph = toElkGraph(graph, {
				sizes,
				layout: graph.layout,
				...(rootId ? { rootId } : {})
			});
			const layout = (await elk.layout(
				elkGraph as unknown as Parameters<typeof elk.layout>[0]
			)) as unknown as ElkNodeLike;

			if (disposed) return;

			// Subtree: start from live canvas so untouched nodes keep current placement/size.
			const baseModel: GraphViewModel = rootId
				? {
						nodes: flowNodes.map((n) => ({
							...n,
							position: { ...n.position },
							data: { ...n.data }
						})),
						edges: graph.edges,
						layout: graph.layout
					}
				: graph;

			const { model: positioned, sizes: elkSizes } = applyElkLayoutResult(baseModel, layout);
			const laidOut = toLaidOutNodes(positioned, elkSizes, nodeUi);

			if (rootId) {
				const scope = subtreeNodeIds(graph, rootId);
				onLayoutDone({
					nodes: mergeLaidOutNodes(flowNodes, laidOut, scope)
				});
			} else {
				onLayoutDone({
					nodes: laidOut,
					edges: toFlowEdges(positioned)
				});
			}

			if (shouldFit) {
				requestAnimationFrame(() => {
					if (!disposed) void fitView({ padding: 0.15, duration: 0 });
				});
			}
		} catch (err) {
			if (disposed) return;
			const message = err instanceof Error ? err.message : 'ELK layout failed';
			if (rootId) {
				onLayoutError(message, { nodes: getNodes() as GraphNode[] });
			} else {
				onLayoutError(message, {
					nodes: toLaidOutNodes(graph, undefined, nodeUi),
					edges: toFlowEdges(graph)
				});
			}
		} finally {
			running = false;
		}
	}

	// Auto once when SF finishes measuring for this mount — always full graph + fit
	$effect(() => {
		if (!nodesInitialized.current || autoDone) return;
		autoDone = true;
		void runLayout({ fit: true });
	});

	// Manual re-layout — full (fit) or subtree (no fit) from opts captured with the bump
	$effect(() => {
		const req = layoutRequest;
		if (req <= 0 || req === lastManualRequest) return;
		if (!nodesInitialized.current) return;
		lastManualRequest = req;
		const rootId = layoutRequestOpts?.rootId ?? null;
		const fit = layoutRequestOpts?.fit ?? (rootId ? false : true);
		void runLayout({ fit, rootId });
	});
</script>
