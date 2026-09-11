<script lang="ts">
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from '$lib/transform/to-graph';
	import GraphNodePropsToolbar from '../GraphNodePropsToolbar.svelte';
	import { getGraphNodeUi } from '../graph-node-ui';

	type DefaultNode = Node<GraphNodeData, 'default' | 'entity'>;
	let { id, data, selected, selectable, draggable }: NodeProps<DefaultNode> = $props();

	const nodeUi = getGraphNodeUi();

	function onDoubleClick(e: MouseEvent) {
		e.stopPropagation();
		if (!selectable) nodeUi.setSelectable(id, true);
	}

	const role = $derived(data.role && data.role !== 'default' ? data.role : null);
	const showTarget = $derived(data.isTarget === true);
	const showSource = $derived(data.isSource === true);
</script>

<!-- Content-sized. Handles only when this node is an edge endpoint. -->
<!-- svelte-ignore a11y_no_static_element_interactions (node double-click escape hatch for non-selectable nodes) -->
	<div class={['default-node', selected && 'is-selected']} ondblclick={onDoubleClick}>
		<GraphNodePropsToolbar {id} {selectable} {draggable} />
	<div class="default-node__body">
		{#if role}
			<span class="default-node__role">{role}</span>
		{/if}
		<span class="default-node__label">{data.label}</span>
		{#if data.subtitle}
			<span class="default-node__subtitle">{data.subtitle}</span>
		{/if}
	</div>

	{#if showTarget}
		<Handle type="target" position={Position.Top} class="graph-handle" />
	{/if}
	{#if showSource}
		<Handle type="source" position={Position.Bottom} class="graph-handle" />
	{/if}
</div>

<style>
	.default-node {
		box-sizing: border-box;
		display: inline-block;
		border-radius: 0.5rem;
		border: 1px solid var(--border, #e5e5e5);
		background: var(--card, #fff);
		color: var(--card-foreground, #171717);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.default-node.is-selected {
		border-color: var(--ring, #a3a3a3);
		box-shadow:
			0 0 0 1px var(--ring, #a3a3a3),
			0 1px 2px rgb(0 0 0 / 0.08);
	}

	.default-node__body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.5rem 0.625rem;
		white-space: nowrap;
	}

	.default-node__role {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-foreground, #737373);
	}

	.default-node__label {
		font-weight: 600;
		font-size: 0.8125rem;
	}

	.default-node__subtitle {
		color: var(--muted-foreground, #737373);
	}

	:global(.graph-handle) {
		width: 6px !important;
		height: 6px !important;
		background: var(--muted-foreground, #a3a3a3) !important;
		border: none !important;
	}
</style>
