<script lang="ts">
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from '$lib/transform/to-graph';

	type OutputNode = Node<GraphNodeData, 'output'>;
	let { data, selected, isConnectable }: NodeProps<OutputNode> = $props();

	/** Outputs are wiring endpoints (handles visible; drag requires nodesConnectable). */
	const showHandles = $derived(data.canConnect !== false);
</script>

<div class={['output-node', selected && 'is-selected']}>
	<div class="output-node__body">
		<span class="output-node__role">output</span>
		<span class="output-node__label">{data.label}</span>
		{#if data.subtitle}
			<span class="output-node__subtitle">{data.subtitle}</span>
		{/if}
	</div>

	{#if showHandles}
		<Handle type="target" position={Position.Top} class="graph-handle" {isConnectable} />
		<Handle type="source" position={Position.Bottom} class="graph-handle" {isConnectable} />
	{/if}
</div>

<style>
	.output-node {
		box-sizing: border-box;
		display: inline-block;
		border-radius: 0.5rem;
		border: 1px solid color-mix(in oklab, oklch(0.7 0.14 45) 40%, var(--border, #e5e5e5));
		background: color-mix(in oklab, oklch(0.7 0.14 45) 8%, var(--card, #fff));
		color: var(--card-foreground, #171717);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.output-node.is-selected {
		border-color: color-mix(in oklab, oklch(0.7 0.14 45) 60%, var(--ring, #a3a3a3));
		box-shadow:
			0 0 0 1px color-mix(in oklab, oklch(0.7 0.14 45) 40%, transparent),
			0 1px 2px rgb(0 0 0 / 0.08);
	}

	.output-node__body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.625rem;
		white-space: nowrap;
	}

	.output-node__role {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: color-mix(in oklab, oklch(0.6 0.12 45) 75%, var(--muted-foreground, #737373));
	}

	.output-node__label {
		font-weight: 600;
		font-size: 0.8125rem;
	}

	.output-node__subtitle {
		color: var(--muted-foreground, #737373);
	}

	:global(.graph-handle) {
		width: 6px !important;
		height: 6px !important;
		background: var(--muted-foreground, #a3a3a3) !important;
		border: none !important;
	}
</style>
