<script lang="ts">
	/**
	 * SF NodeToolbar for domain CRUD: add child (room→board, board→breaker) + delete.
	 * Visible only when the node is selected and the user can edit.
	 */
	import { NodeToolbar, Position } from '@xyflow/svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { GraphNodeData } from '$lib/transform/to-graph';
	import { getGraphNodeActions } from './graph-node-actions';

	type Props = {
		/** Node record id (table:key). */
		id: string;
		data: GraphNodeData;
	};

	let { id, data }: Props = $props();

	const actions = getGraphNodeActions();

	const show = $derived(Boolean(data.canEdit && (data.canAddChild || data.canDelete)));
	const addLabel = $derived(data.addChildLabel ? `Add ${data.addChildLabel}` : 'Add child');

	function onAdd(e: MouseEvent) {
		e.stopPropagation();
		if (!data.canAddChild) return;
		actions.requestAddChild({ id, table: data.table, label: data.label });
	}

	function onDelete(e: MouseEvent) {
		e.stopPropagation();
		if (!data.canDelete) return;
		actions.requestDeleteNode({ id, table: data.table, label: data.label });
	}
</script>

{#if show}
	<NodeToolbar position={Position.Top} align="center" class="graph-node-toolbar nodrag nopan">
		<div class="flex items-center gap-1 rounded-md border border-border bg-background/95 p-0.5 shadow-sm backdrop-blur-sm">
			{#if data.canAddChild}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="h-7 gap-1 px-2 text-xs"
					title={addLabel}
					onclick={onAdd}
				>
					<PlusIcon class="size-3.5" data-icon="inline-start" />
					Add
				</Button>
			{/if}
			{#if data.canDelete}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
					title={`Delete ${data.label}`}
					onclick={onDelete}
				>
					<TrashIcon class="size-3.5" data-icon="inline-start" />
					Delete
				</Button>
			{/if}
		</div>
	</NodeToolbar>
{/if}
