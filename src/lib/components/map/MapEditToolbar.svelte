<script lang="ts">
	/**
	 * Map create/edit tool strip (C4.1 create-first).
	 * Modify / clear / point stay visible-disabled as placeholders for later slices.
	 */
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PointerIcon from '@lucide/svelte/icons/mouse-pointer-2';
	import LassoIcon from '@lucide/svelte/icons/lasso';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import {
		mapToolHint,
		type MapToolMode
	} from '$lib/client/map';
	import type { MapEntityCrudSpec } from '$lib/transform/map-crud';

	type Props = {
		/** EDITOR / OWNER. */
		canEdit?: boolean;
		tool?: MapToolMode;
		/** Draw target tables (create and/or assign to existing). */
		drawTargets?: MapEntityCrudSpec[];
		/** @deprecated Prefer drawTargets. */
		createTargets?: MapEntityCrudSpec[];
		/** Selected target table for drawn geometries. */
		targetTable?: string | null;
		/** When true, drawing needs an active level filter. */
		needsLevel?: boolean;
		/** Current level id from URL/appUi. */
		levelId?: string | null;
		disabled?: boolean;
		onToolChange?: (tool: MapToolMode) => void;
		onTargetChange?: (table: string | null) => void;
	};

	let {
		canEdit = false,
		tool = $bindable('navigate' as MapToolMode),
		drawTargets,
		createTargets = [],
		targetTable = $bindable(null as string | null),
		needsLevel = false,
		levelId = null,
		disabled = false,
		onToolChange,
		onTargetChange
	}: Props = $props();

	const targets = $derived(drawTargets ?? createTargets);
	const hasTargets = $derived(targets.length > 0);
	const drawReady = $derived(
		canEdit && hasTargets && (!needsLevel || Boolean(levelId)) && !disabled
	);

	function setTool(next: MapToolMode) {
		if (!canEdit || disabled) return;
		if (next === 'draw-polygon' && !drawReady) return;
		tool = next;
		onToolChange?.(next);
	}

	function onTableSelect(e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value;
		const next = value === '' ? null : value;
		targetTable = next;
		onTargetChange?.(next);
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	{#if canEdit}
		<ButtonGroup.Root aria-label="Map tools">
			<Button
				type="button"
				size="sm"
				variant={tool === 'navigate' ? 'default' : 'outline'}
				disabled={disabled}
				title="Select / pan"
				onclick={() => setTool('navigate')}
			>
				<PointerIcon class="size-3.5" data-icon="inline-start" />
				Select
			</Button>
			<Button
				type="button"
				size="sm"
				variant={tool === 'draw-polygon' ? 'default' : 'outline'}
				disabled={!drawReady}
				title={drawReady
					? 'Draw polygon'
					: needsLevel && !levelId
						? 'Pick a level before drawing'
						: hasTargets
							? 'Select a target table'
							: 'No drawable map layers'}
				onclick={() => setTool('draw-polygon')}
			>
				<LassoIcon class="size-3.5" data-icon="inline-start" />
				Draw
			</Button>
			<!-- Future: modify / clear — UI hooks only -->
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled
				title="Vertex edit — next slice"
			>
				<PencilIcon class="size-3.5" data-icon="inline-start" />
				Edit
			</Button>
		</ButtonGroup.Root>

		{#if hasTargets}
			<div class="flex items-center gap-1.5">
				<span class="text-xs text-muted-foreground">Layer</span>
				<NativeSelect.Root
					class="w-[10.5rem] text-xs"
					size="sm"
					value={targetTable ?? ''}
					disabled={disabled || !canEdit}
					onchange={onTableSelect}
					aria-label="Draw target table"
				>
					{#if targets.length > 1}
						<NativeSelect.Option value="">Choose table…</NativeSelect.Option>
					{/if}
					{#each targets as t (t.table)}
						<NativeSelect.Option value={t.table}>{t.label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
		{/if}

		{#if tool !== 'navigate'}
			<span class="text-xs text-muted-foreground">{mapToolHint(tool)}</span>
		{:else if needsLevel && !levelId && hasTargets}
			<span class="text-xs text-amber-600 dark:text-amber-400">Pick a floor level to draw</span>
		{/if}
	{/if}
</div>
