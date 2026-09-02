<script lang="ts">
	/**
	 * One mount per graph identity (parent uses `{#key}`).
	 * nodes/edges init at mount; LayoutRunner applies ELK positions.
	 * Layout button bumps `layoutRequest` so ELK can re-run anytime (leaf sizes only).
	 */
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		Panel,
		addEdge,
		type Connection
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import { applyNodeSelection } from '$lib/client/selection';
	import { nodeTypes } from '$lib/client/registries/nodes';
	import { edgeTypes } from '$lib/client/registries/edges';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import type { GraphEdge, GraphNode, GraphViewModel } from '$lib/transform/to-graph';
	import { toFlowEdges, toMeasureNodes } from './graph-flow';
	import GraphLayoutRunner from './GraphLayoutRunner.svelte';

	type Props = {
		graph: GraphViewModel;
		/** EDITOR / OWNER can drag new wires between breakers/outputs. */
		canEdit?: boolean;
	};

	let { graph, canEdit = false }: Props = $props();

	type Phase = 'measuring' | 'layouting' | 'ready';

	// Mount-time only — parent `{#key graphKey}` recreates this instance when graph changes.
	// svelte-ignore state_referenced_locally (intentional: capture initial measure snapshot)
	let nodes = $state.raw<GraphNode[]>(applyNodeSelection(toMeasureNodes(graph), appUi.focusedId));
	// svelte-ignore state_referenced_locally (intentional: capture initial measure snapshot)
	let edges = $state.raw<GraphEdge[]>(toFlowEdges(graph));
	let phase = $state<Phase>('measuring');
	let layoutError = $state<string | null>(null);
	/** Bumped by the Layout button to re-run ELK with current leaf measured sizes. */
	let layoutRequest = $state(0);

	function onLayoutStart() {
		phase = 'layouting';
	}

	function onLayoutDone(result: { nodes: GraphNode[]; edges: GraphEdge[] }) {
		// Preserve shared focus highlight across ELK rewrites
		nodes = applyNodeSelection(result.nodes, appUi.focusedId);
		// Keep client-drawn wires (not yet persisted) across re-layout
		const serverIds = new Set(result.edges.map((e) => e.id));
		const drawn = edges.filter((e) => !serverIds.has(e.id));
		edges = drawn.length ? [...result.edges, ...drawn] : result.edges;
		phase = 'ready';
		layoutError = null;
	}

	function onLayoutError(message: string, fallback: { nodes: GraphNode[]; edges: GraphEdge[] }) {
		layoutError = message;
		nodes = applyNodeSelection(fallback.nodes, appUi.focusedId);
		edges = fallback.edges;
		phase = 'ready';
	}

	function requestLayout() {
		if (phase === 'layouting' || phase === 'measuring') return;
		layoutRequest += 1;
	}

	function onnodeclick({ node }: { node: GraphNode }) {
		appUi.focusRecord(node.id);
	}

	/** Sync SF `selected` from shared focus (survives view navigation + local clicks). */
	$effect(() => {
		const focused = appUi.focusedId;
		nodes = applyNodeSelection(nodes, focused);
	});

	function onconnect(connection: Connection) {
		if (!canEdit) return;
		edges = addEdge(connection, edges);
	}

	const busy = $derived(phase !== 'ready');
	const busyLabel = $derived(phase === 'layouting' ? 'Laying out graph…' : 'Measuring nodes…');
	const layoutDisabled = $derived(busy);
</script>

<div class="graph-canvas relative h-full min-h-0 w-full">
	{#if busy}
		<div
			class="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]"
			role="status"
			aria-live="polite"
			aria-busy="true"
		>
			<Spinner class="size-4" />
			{busyLabel}
		</div>
	{/if}

	{#if layoutError}
		<div
			class="absolute top-2 right-2 left-2 z-20 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			Layout: {layoutError}
		</div>
	{/if}

	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{edgeTypes}
		minZoom={0.15}
		maxZoom={2}
		nodesDraggable={true}
		nodesConnectable={canEdit}
		elementsSelectable={true}
		proOptions={{ hideAttribution: true }}
		{onnodeclick}
		{onconnect}
		class="h-full w-full bg-background"
	>
		<GraphLayoutRunner {graph} {layoutRequest} {onLayoutStart} {onLayoutDone} {onLayoutError} />

		<Panel position="top-right" class="m-2!">
			<Button
				type="button"
				size="sm"
				variant="outline"
				class="bg-background/95 shadow-sm backdrop-blur-sm"
				disabled={layoutDisabled}
				aria-busy={phase === 'layouting'}
				onclick={requestLayout}
			>
				{#if phase === 'layouting'}
					<Spinner class="size-3.5" data-icon="inline-start" />
				{:else}
					<NetworkIcon class="size-3.5" data-icon="inline-start" />
				{/if}
				Layout
			</Button>
		</Panel>

		<Background gap={18} size={1} />
		<Controls showLock={false} />
		<MiniMap pannable zoomable class="bg-card!" />
	</SvelteFlow>
</div>

<style>
	.graph-canvas :global(.svelte-flow) {
		height: 100%;
		width: 100%;
	}

	.graph-canvas :global(.svelte-flow__node) {
		font-family: inherit;
		width: auto;
		height: auto;
		padding: 0;
		border: none;
		background: transparent;
		box-shadow: none;
		overflow: visible;
	}

	.graph-canvas :global(.svelte-flow__node-room),
	.graph-canvas :global(.svelte-flow__node-board),
	.graph-canvas :global(.svelte-flow__node-group) {
		overflow: visible;
	}
</style>
