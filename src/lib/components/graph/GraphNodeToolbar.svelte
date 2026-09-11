<script lang="ts">
	/**
	 * SF NodeToolbar for domain CRUD: add child (room→board, board→breaker) + delete.
	 * Visible only when the node is selected and the user can edit.
	 */
	import { NodeToolbar, Position } from '@xyflow/svelte';
	import Pen from '@lucide/svelte/icons/pen';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index';
	import type { GraphNodeData } from '$lib/transform/to-graph';
	import { getGraphNodeActions } from './graph-node-actions';

	type Props = {
		/** Node record id (table:key). */
		id: string;
		data: GraphNodeData;
	};

	let { id, data, ...rest}: Props = $props();
	$inspect(id,data,rest)
	const actions = getGraphNodeActions();

	const show = $derived(Boolean(data.canAddChild || data.canUpdate || data.canDelete));
	const addLabel = $derived(data.addChildLabel ? `Add ${data.addChildLabel}` : 'Add child');

	function onAdd(e: MouseEvent) {
		e.stopPropagation();
		if (!data.canAddChild) return;
		actions.requestAddChild({ id, table: data.table, label: data.label });
	}
	function onEdit(e: MouseEvent) {
		e.stopPropagation();
		if (!data.canUpdate) return;
		actions.requestEditNode({
			id,
			table: data.table,
			label: data.label,
			values: data.values
		});
	}

	function onDelete(e: MouseEvent) {
		e.stopPropagation();
		if (!data.canDelete) return;
		actions.requestDeleteNode({ id, table: data.table, label: data.label });
	}

	const availableActions = $derived([
		{ available: data.canAddChild, snippet: AddChild },
		{ available: data.canUpdate, snippet: EditNode },
		{ available: data.canDelete, snippet: DeleteNode }
	]);
</script>

{#snippet AddChild()}
    <Button
        type="button"
        size="sm"
        variant="outline"
        class="gap-1 px-2 text-xs"
        title={addLabel}
        onclick={onAdd}
    >
        <PlusIcon class="size-3.5" data-icon="inline-start" />
        Add
    </Button>
{/snippet}

{#snippet EditNode()}
    <Button
        type="button"
        size="sm"
        variant="outline"
        class="gap-1 px-2 text-xs"
        title="Edit Node"
        onclick={onEdit}
    >
        <Pen class="size-3.5" data-icon="inline-start" />
        Edit
    </Button>

{/snippet}

{#snippet DeleteNode()}
    <Button
					type="button"
					size="sm"
					variant="destructive"
					class="gap-1 px-2 text-xs text-destructive border-border hover:bg-destructive/30 hover:text-destructive"
					title={`Delete ${data.label}`}
					onclick={onDelete}
				>
					<TrashIcon class="size-3.5" data-icon="inline-start" />
					Delete
				</Button>
{/snippet}

{#if show}
	<NodeToolbar position={Position.Bottom} align="center" class="graph-node-toolbar nodrag nopan">
	    <ButtonGroup.Root class="rounded-full bg-background">
				{#each availableActions as action, i}
					{#if action.available}
						{@render action.snippet()}
					{/if}
				{/each}
		</ButtonGroup.Root>
	</NodeToolbar>
{/if}
