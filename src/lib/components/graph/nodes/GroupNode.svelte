<script lang="ts">
	import type { Node, NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from '$lib/transform/to-graph';

	type GroupNode = Node<GraphNodeData, 'group'>;
	let { data, selected }: NodeProps<GroupNode> = $props();
</script>

<!-- No handles: groups are containers, not edge endpoints. -->
<div class={['group-node', selected && 'is-selected']}>
	<div class="group-node__body">
		<span class="group-node__role">group</span>
		<span class="group-node__label">{data.label}</span>
		{#if data.subtitle}
			<span class="group-node__subtitle">{data.subtitle}</span>
		{/if}
	</div>
</div>

<style>
	.group-node {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: max-content;
		border-radius: 0.5rem;
		border: 1px dashed var(--border, #e5e5e5);
		background: color-mix(in oklab, var(--muted, #f5f5f5) 70%, transparent);
		color: var(--card-foreground, #171717);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.group-node.is-selected {
		border-color: var(--ring, #a3a3a3);
		box-shadow:
			0 0 0 1px var(--ring, #a3a3a3),
			0 1px 2px rgb(0 0 0 / 0.08);
	}

	.group-node__body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.75rem 0.25rem;
		flex-shrink: 0;
	}

	.group-node__role {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-foreground, #737373);
	}

	.group-node__label {
		font-weight: 600;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.group-node__subtitle {
		color: var(--muted-foreground, #737373);
		white-space: nowrap;
	}
</style>
