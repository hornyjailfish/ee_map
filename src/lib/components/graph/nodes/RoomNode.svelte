<script lang="ts">
	import type { Node, NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from '$lib/transform/to-graph';
	import GraphNodeToolbar from '../GraphNodeToolbar.svelte';

	type RoomNode = Node<GraphNodeData, 'room'>;
	let { id, data, selected }: NodeProps<RoomNode> = $props();
</script>

<!-- No handles: rooms are containers, not edge endpoints. -->
<div class={['room-node', selected && 'is-selected']}>
	<GraphNodeToolbar {id} {data} />
	<div class="room-node__body">
		<span class="room-node__role">room</span>
		<span class="room-node__label">{data.label}</span>
		{#if data.subtitle}
			<span class="room-node__subtitle">{data.subtitle}</span>
		{/if}
	</div>
</div>

<style>
	.room-node {
		/* Fill SF wrapper after ELK sets width/height; content-sized during measure */
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: max-content;
		border-radius: 0.5rem;
		border: 1px dashed color-mix(in oklab, oklch(0.6 0.12 250) 55%, var(--border, #e5e5e5));
		background: color-mix(in oklab, oklch(0.6 0.12 250) 20%, transparent);
		color: var(--card-foreground, #171717);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.room-node.is-selected {
		border-color: color-mix(in oklab, oklch(0.6 0.12 250) 70%, var(--ring, #a3a3a3));
		box-shadow:
			0 0 0 1px color-mix(in oklab, oklch(0.6 0.12 250) 50%, transparent),
			0 1px 2px rgb(0 0 0 / 0.08);
	}

	.room-node__body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.75rem 0.25rem;
		flex-shrink: 0;
	}

	.room-node__role {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: color-mix(in oklab, oklch(0.55 0.1 250) 80%, var(--muted-foreground, #737373));
	}

	.room-node__label {
		font-weight: 600;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.room-node__subtitle {
		color: var(--muted-foreground, #737373);
		white-space: nowrap;
	}
</style>
