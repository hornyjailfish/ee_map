<script lang="ts">
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from '$lib/transform/to-graph';

	type BreakerNode = Node<GraphNodeData, 'breaker'>;
	let { data, selected, isConnectable }: NodeProps<BreakerNode> = $props();

	/** Breakers are always wiring endpoints (handles visible; drag requires nodesConnectable). */
	const showHandles = $derived(data.canConnect !== false);
</script>

<!-- Content-sized. Handles on breaker role; isConnectable follows canvas nodesConnectable. -->
<div class={['breaker-node', selected && 'is-selected']}>
	<div class="breaker-node__body">
		<span class="breaker-node__label">{data.label}</span>
		{#if data.subtitle}
			<span class="breaker-node__subtitle">{data.subtitle}</span>
		{/if}
	</div>

	{#if showHandles}
		<Handle type="target" position={Position.Top} class="graph-handle" {isConnectable} />
		<Handle type="source" position={Position.Bottom} class="graph-handle" {isConnectable} />
	{/if}
</div>

<style>
	.breaker-node {
		box-sizing: border-box;
		display: inline-block;
		border-radius: 0.5rem;
		border: 1px solid var(--border, #e5e5e5);
		background: var(--background, #fff);
		color: var(--card-foreground, #171717);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.breaker-node.is-selected {
		border-color: var(--ring, #a3a3a3);
		box-shadow:
			0 0 0 1px var(--ring, #a3a3a3),
			0 1px 2px rgb(0 0 0 / 0.08);
	}

	.breaker-node__body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.625rem;
		white-space: nowrap;
	}

	.breaker-node__label {
		font-weight: 600;
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.breaker-node__subtitle {
		color: var(--muted-foreground, #737373);
	}

	:global(.graph-handle) {
		width: 6px !important;
		height: 6px !important;
		background: var(--muted-foreground, #a3a3a3) !important;
		border: none !important;
	}
</style>
