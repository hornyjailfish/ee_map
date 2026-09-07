<script lang="ts">
	/**
	 * Inside `<SvelteFlow>`: wait for measured nodes, run ELK, push result up.
	 * - Auto: once when `nodesInitialized` becomes true
	 * - Manual: whenever `layoutRequest` increases (Layout button)
	 * Leaf sizes only — compounds never feed post-layout full-box height back into ELK.
	 * Layout options come from `graph.layout` (ResolvedConfig).
	 */
	import { onDestroy } from 'svelte';
	import { useNodesInitialized, useSvelteFlow } from '@xyflow/svelte';
	import ELK from 'elkjs/lib/elk.bundled.js';
	import { applyElkLayoutResult, toElkGraph, type ElkNodeLike } from '$lib/transform/to-elk';
	import type { GraphEdge, GraphNode, GraphViewModel } from '$lib/transform/to-graph';
	import {
		compoundIds,
		sizesFromFlow,
		toFlowEdges,
		toLaidOutNodes,
		type GraphNodeUiOpts
	} from './graph-flow';

	type Props = {
		graph: GraphViewModel;
		/** EDITOR toolbar flags applied after ELK. */
		nodeUi?: GraphNodeUiOpts;
		/** Bumped by parent to force a re-layout (button). 0 = no manual request yet. */
		layoutRequest?: number;
		/**
		 * When true (default), fit camera after layout (initial mount + Layout button).
		 * Wire persist path should not remount; if it ever relayouts, pass false to keep camera.
		 */
		fitViewAfter?: boolean;
		onLayoutStart?: () => void;
		onLayoutDone: (result: { nodes: GraphNode[]; edges: GraphEdge[] }) => void;
		onLayoutError: (message: string, fallback: { nodes: GraphNode[]; edges: GraphEdge[] }) => void;
	};

	let {
		graph,
		nodeUi = {},
		layoutRequest = 0,
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

	async function runLayout(opts?: { fit?: boolean }) {
		if (running || disposed) return;
		running = true;
		const shouldFit = opts?.fit ?? fitViewAfter;
		onLayoutStart?.();

		try {
			const parents = compoundIds(graph);
			const sizes = sizesFromFlow(getNodes() as GraphNode[], parents);
			const elkGraph = toElkGraph(graph, { sizes, layout: graph.layout });
			const layout = (await elk.layout(
				elkGraph as unknown as Parameters<typeof elk.layout>[0]
			)) as unknown as ElkNodeLike;

			if (disposed) return;

			const { model: positioned, sizes: elkSizes } = applyElkLayoutResult(graph, layout);

			onLayoutDone({
				nodes: toLaidOutNodes(positioned, elkSizes, nodeUi),
				edges: toFlowEdges(positioned)
			});

			if (shouldFit) {
				requestAnimationFrame(() => {
					if (!disposed) void fitView({ padding: 0.15, duration: 0 });
				});
			}
		} catch (err) {
			if (disposed) return;
			const message = err instanceof Error ? err.message : 'ELK layout failed';
			onLayoutError(message, {
				nodes: toLaidOutNodes(graph, undefined, nodeUi),
				edges: toFlowEdges(graph)
			});
		} finally {
			running = false;
		}
	}

	// Auto once when SF finishes measuring for this mount — always fit on first paint
	$effect(() => {
		if (!nodesInitialized.current || autoDone) return;
		autoDone = true;
		void runLayout({ fit: true });
	});

	// Manual re-layout from the Layout button — fit so the full graph is visible
	$effect(() => {
		const req = layoutRequest;
		if (req <= 0 || req === lastManualRequest) return;
		if (!nodesInitialized.current) return;
		lastManualRequest = req;
		void runLayout({ fit: true });
	});
</script>
