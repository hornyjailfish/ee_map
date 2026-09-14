<script lang="ts">
	/**
	 * Client-only node property toolbar (right side of a node).
	 * Toggles `selectable` / `draggable` and offers fit-view + ELK re-layout
	 * (layout only for compound nodes). No backend writes.
	 */
	import { NodeToolbar, Position, useSvelteFlow } from '@xyflow/svelte';
	import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
	import MoveIcon from '@lucide/svelte/icons/move';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index';
	import { getGraphNodeUi } from './graph-node-ui';

	type Props = {
		id: string;
		selectable: boolean;
		draggable: boolean;
	};

	let { id, selectable, draggable }: Props = $props();

	const { setSelectable, setDraggable, layoutNode } = getGraphNodeUi();
	const { fitView, getNodes } = useSvelteFlow();

	const hasChildren = $derived.by(() => getNodes().some((n) => n.parentId === id));

	function onToggleSelectable() {
		setSelectable(id, !selectable);
	}

	function onToggleDraggable() {
		setDraggable(id, !draggable);
	}

	function onFitView(e: MouseEvent) {
		e.stopPropagation();
		void fitView({ nodes: [{ id }], padding: 0.3, duration: 200 });
	}

	function onLayout(e: MouseEvent) {
		e.stopPropagation();
		if (!hasChildren) return;
		layoutNode(id);
	}
</script>

<NodeToolbar position={Position.Right} align="center" class="graph-node-props-toolbar nodrag nopan">
	<ButtonGroup.Root orientation="vertical" class="rounded-full bg-background shadow-sm">
		<Button
			type="button"
			size="icon"
			variant={selectable ? 'default' : 'outline'}
			class=""
			title={selectable ? 'Node is selectable' : 'Node is not selectable (double-click to re-enable)'}
			aria-pressed={selectable}
			onclick={onToggleSelectable}
		>
			<MousePointer2 class="size-3.5" data-icon="inline-start" />
		</Button>

		<Button
			type="button"
			size="icon"
			variant={draggable ? 'default' : 'outline'}
			class=""
			title={draggable ? 'Node is draggable' : 'Node is not draggable'}
			aria-pressed={draggable}
			onclick={onToggleDraggable}
		>
			<MoveIcon class="size-3.5" data-icon="inline-start" />
		</Button>
		<ButtonGroup.Separator />
		<Button
			type="button"
			size="icon"
			variant="outline"
			class=""
			title="Fit view to node"
			onclick={onFitView}
		>
			<Maximize2Icon class="size-3.5" data-icon="inline-start" />
		</Button>

		{#if hasChildren}
			<Button
				type="button"
				size="icon-xs"
				variant="outline"
				class="rounded-full"
				title="Layout children with ELK"
				onclick={onLayout}
			>
				<NetworkIcon class="size-3.5" data-icon="inline-start" />
			</Button>
		{/if}
	</ButtonGroup.Root>
</NodeToolbar>
