<script lang="ts">
	/**
	 * Map create/edit tool strip (C4.1).
	 * Edit = move / add / remove vertices (ModifyVertexSession).
	 * Extrude = polygon edge push/pull (ModifyExtrudeSession).
	 * Point / clear still placeholders.
	 */
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PointerIcon from '@lucide/svelte/icons/mouse-pointer-2';
	import LassoIcon from '@lucide/svelte/icons/lasso';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { mapToolHint, type MapToolMode } from '$lib/client/map';
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
		/** Focused feature can receive vertex edit (move/add/remove; update + drawable geom). */
		canModifyFocused?: boolean;
		/** Short reason when Edit is disabled. */
		modifyBlockedReason?: string | null;
		/** Focused feature can receive edge extrude (update + polygon). */
		canExtrudeFocused?: boolean;
		/** Short reason when Extrude is disabled. */
		extrudeBlockedReason?: string | null;
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
		canModifyFocused = false,
		modifyBlockedReason = null,
		canExtrudeFocused = false,
		extrudeBlockedReason = null,
		disabled = false,
		onToolChange,
		onTargetChange
	}: Props = $props();

	const targets = $derived(drawTargets ?? createTargets);
	const hasTargets = $derived(targets.length > 0);
	/** Multi-target draw needs an explicit layer selection before the Draw tool can start. */
	const needsTargetPick = $derived(targets.length > 1 && targetTable == null);
	const drawReady = $derived(
		canEdit && hasTargets && (!needsLevel || Boolean(levelId)) && !needsTargetPick && !disabled
	);
	const editReady = $derived(canEdit && canModifyFocused && !disabled);
	const extrudeReady = $derived(canEdit && canExtrudeFocused && !disabled);

	function setTool(next: MapToolMode) {
		if (!canEdit || disabled) return;
		if (next === 'draw-polygon' && !drawReady) return;
		if (next === 'modify' && !editReady && tool !== 'modify') return;
		if (next === 'extrude' && !extrudeReady && tool !== 'extrude') return;
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
				{disabled}
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
					: !hasTargets
						? 'No drawable map layers'
						: needsTargetPick
							? 'Select a target layer first'
							: needsLevel && !levelId
								? 'Pick a floor level before drawing'
								: 'Draw polygon'}
				onclick={() => setTool('draw-polygon')}
			>
				<LassoIcon class="size-3.5" data-icon="inline-start" />
				Draw
			</Button>
			<Button
				type="button"
				size="sm"
				variant={tool === 'modify' ? 'default' : 'outline'}
				disabled={!editReady && tool !== 'modify'}
				title={editReady
					? 'Move, add, or remove corners on the selected feature'
					: (modifyBlockedReason ?? 'Select an editable feature first')}
				onclick={() => setTool('modify')}
			>
				<PencilIcon class="size-3.5" data-icon="inline-start" />
				Edit
			</Button>
			<Button
				type="button"
				size="sm"
				variant={tool === 'extrude' ? 'default' : 'outline'}
				disabled={!extrudeReady && tool !== 'extrude'}
				title={extrudeReady
					? 'Push/pull polygon edges along their normal'
					: (extrudeBlockedReason ?? 'Select an editable polygon first')}
				onclick={() => setTool('extrude')}
			>
				<ExpandIcon class="size-3.5" data-icon="inline-start" />
				Extrude
			</Button>
		</ButtonGroup.Root>

		{#if hasTargets && (tool === 'navigate' || tool === 'draw-polygon')}
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
		{:else if !canModifyFocused && modifyBlockedReason}
			<span class="text-xs text-muted-foreground">{modifyBlockedReason}</span>
		{:else if !canExtrudeFocused && extrudeBlockedReason}
			<span class="text-xs text-muted-foreground">{extrudeBlockedReason}</span>
		{/if}
	{/if}
</div>
