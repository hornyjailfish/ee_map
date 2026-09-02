<script lang="ts">
	/**
	 * Graph canvas host.
	 * `{#key graphKey}` remounts when the server payload changes — no state-sync `$effect`.
	 */
	import type { GraphViewModel } from '$lib/transform/to-graph';
	import { graphSignature } from './graph-flow';
	import GraphCanvas from './GraphCanvas.svelte';

	type Props = {
		/** Stripped graph model without positions (from server). */
		graph: GraphViewModel;
		/** EDITOR / OWNER can draw wires between breakers/outputs. */
		canEdit?: boolean;
	};

	let { graph, canEdit = false }: Props = $props();

	/** Remount canvas when graph structure changes. */
	const graphKey = $derived(graphSignature(graph));
</script>

<div class="graph-view relative h-full min-h-0 w-full">
	{#key graphKey}
		<GraphCanvas {graph} {canEdit} />
	{/key}
</div>
