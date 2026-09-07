<script lang="ts">
	import type { Node, NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from '$lib/transform/to-graph';
	import GraphNodeToolbar from '../GraphNodeToolbar.svelte';

	type BoardNode = Node<GraphNodeData, 'board'>;
	let { id, data, selected }: NodeProps<BoardNode> = $props();
</script>

<!-- No handles: boards are containers, not edge endpoints. -->
<div class={['board-node', selected && 'is-selected']}>
	<GraphNodeToolbar {id} {data} />
	<div class="board-node__body">
		<span class="board-node__role">board</span>
		<span class="board-node__label">{data.label}</span>
		{#if data.subtitle}
			<span class="board-node__subtitle">{data.subtitle}</span>
		{/if}
	</div>
</div>

<style>
	.board-node {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: max-content;
		border-radius: 0.5rem;
		border: 1px dashed color-mix(in oklab, oklch(0.65 0.14 145) 50%, var(--border, #e5e5e5));
		background: color-mix(in oklab, oklch(0.65 0.14 145) 15%, var(--muted, #f5f5f5));
		color: var(--card-foreground, #171717);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.board-node.is-selected {
		border-color: color-mix(in oklab, oklch(0.65 0.14 145) 70%, var(--ring, #a3a3a3));
		box-shadow:
			0 0 0 1px color-mix(in oklab, oklch(0.65 0.14 145) 45%, transparent),
			0 1px 2px rgb(0 0 0 / 0.08);
	}

	.board-node__body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.75rem 0.25rem;
		flex-shrink: 0;
	}

	.board-node__role {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: color-mix(in oklab, oklch(0.55 0.12 145) 80%, var(--muted-foreground, #737373));
	}

	.board-node__label {
		font-weight: 600;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.board-node__subtitle {
		color: var(--muted-foreground, #737373);
		white-space: nowrap;
	}
</style>
