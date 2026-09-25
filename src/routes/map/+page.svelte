<script lang="ts">
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import MapView from '$lib/components/map/MapView.svelte';
	import MapEditToolbar from '$lib/components/map/MapEditToolbar.svelte';
	import DrawFeatureModal from '$lib/components/map/DrawFeatureModal.svelte';
	import MarkerModal from '$lib/components/map/MarkerModal.svelte';
	import FeaturePropertiesPanel from '$lib/components/map/FeaturePropertiesPanel.svelte';
	import ViewLoadingOverlay from '$lib/components/view/ViewLoadingOverlay.svelte';
	import { ApiError, postFormAction } from '$lib/client/http';
	import {
		geoJsonToNormalized,
		type MapToolMode,
		type ModifyCommit,
		type WritableGeoJSON
	} from '$lib/client/map';
	import type { EditorOption } from '$lib/client/editors';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import type { AppRole } from '$lib/catalog-types';
	import { canEdit } from '$lib/roles';
	import type { MapFeature, NormalizedGeometry } from '$lib/transform/to-map';
	import type { MarkerContextData } from '$lib/transform/marker';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import InfoIcon from '@lucide/svelte/icons/info';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const view = $derived(data.view);
	const levelId = $derived(data.levelId);
	const error = $derived(data.error);
	const levels = $derived(view?.levels ?? []);
	const crud = $derived(data.crud);
	const recordOptionsByTable = $derived(data.recordOptionsByTable ?? {});
	const userRoles = $derived((data.userRoles ?? []) as AppRole[]);
	const roleCanEdit = $derived(canEdit(userRoles));

	const drawTargets = $derived(crud?.drawTargets ?? crud?.createTargets ?? []);
	const pointTargets = $derived(crud?.pointTargets ?? []);
	/** Single marker layer for the embedding dataset (defaults to first). */
	const markerTarget = $derived(pointTargets.length > 0 ? pointTargets[0]! : null);

	const featureCount = $derived(
		view ? view.layers.reduce((sum, layer) => sum + layer.features.length, 0) : 0
	);

	/** True while a same-route level switch is in flight. */
	const levelLoading = $derived.by(() => {
		const to = navigating.to;
		if (!to) return false;
		// Only query-param switches on this page (not leaving to table/graph)
		if (to.route.id !== page.route.id) return false;
		return to.url.search !== page.url.search;
	});

	const pendingLevel = $derived.by(() => {
		const raw = navigating.to?.url.searchParams.get('level');
		return raw && raw.length > 0 ? raw : null;
	});

	// Keep shared UI level in sync with URL-driven server filter
	$effect(() => {
		appUi.setLevel(levelId);
	});

	// Drop stale property save errors when selection changes
	$effect(() => {
		void appUi.focusedId;
		propsError = null;
	});

	/** Feature id → levelId from current payload (may be incomplete while loading). */
	const featureLevelById = $derived.by(() => {
		const map = new Map<string, string | null>();
		if (!view) return map;
		for (const layer of view.layers) {
			for (const f of layer.features) {
				map.set(f.id, f.levelId);
			}
		}
		return map;
	});

	// ── Create / edit tool state ─────────────────────────────────────
	let tool = $state<MapToolMode>('navigate');
	let targetTable = $state<string | null>(null);
	let draftGeo = $state<WritableGeoJSON | null>(null);
	let createOpen = $state(false);
	let createSubmitting = $state(false);
	let createError = $state<string | null>(null);
	let writeError = $state<string | null>(null);
	let propsSubmitting = $state(false);
	let propsError = $state<string | null>(null);

	// ── Marker (embedding search dataset) state ────────────────────────
	let markerOpen = $state(false);
	let markerResolving = $state(false);
	let markerSubmitting = $state(false);
	let markerError = $state<string | null>(null);
	let markerNotice = $state<string | null>(null);
	let markerContext = $state<MarkerContextData | null>(null);

	/** Pending geometry save after a vertex/edge drag (retry / cancel). */
	type PendingModify = {
		id: string;
		table: string;
		geometry: WritableGeoJSON;
		revert: () => void;
		error: string | null;
	};
	let pendingModify = $state<PendingModify | null>(null);
	let modifySubmitting = $state(false);

	const targetSpec = $derived(
		targetTable && crud?.byTable[targetTable] ? crud.byTable[targetTable]! : null
	);

	const focusedFeature = $derived.by((): MapFeature | null => {
		const id = appUi.focusedId;
		if (!id || !view) return null;
		for (const layer of view.layers) {
			for (const f of layer.features) {
				if (f.id === id) return f;
			}
		}
		return null;
	});

	/** Focused feature is editable (update perm + point/polygon geom). */
	const canModifyFocused = $derived.by(() => {
		if (!roleCanEdit || !focusedFeature || !crud) return false;
		const spec = crud.byTable[focusedFeature.table];
		if (!spec?.canUpdate) return false;
		const kind = focusedFeature.geometry.kind;
		if (kind === 'polygon') return spec.drawKinds.includes('polygon');
		if (kind === 'point') return spec.drawKinds.includes('point');
		return false;
	});

	/** Edge extrude is polygon-only. */
	const canExtrudeFocused = $derived.by(() => {
		if (!roleCanEdit || !focusedFeature || !crud) return false;
		const spec = crud.byTable[focusedFeature.table];
		if (!spec?.canUpdate) return false;
		return focusedFeature.geometry.kind === 'polygon' && spec.drawKinds.includes('polygon');
	});

	const modifyBlockedReason = $derived.by((): string | null => {
		if (!roleCanEdit) return null;
		if (!appUi.focusedId) return 'Select a feature, then Edit';
		if (!focusedFeature) return 'Selected record is not on this map';
		const spec = crud?.byTable[focusedFeature.table];
		if (!spec?.canUpdate) return 'Selected layer is read-only';
		const kind = focusedFeature.geometry.kind;
		if (kind !== 'polygon' && kind !== 'point') return 'Only point/polygon geometry can be edited';
		return null;
	});

	const extrudeBlockedReason = $derived.by((): string | null => {
		if (!roleCanEdit) return null;
		if (!appUi.focusedId) return 'Select a polygon, then Extrude';
		if (!focusedFeature) return 'Selected record is not on this map';
		const spec = crud?.byTable[focusedFeature.table];
		if (!spec?.canUpdate) return 'Selected layer is read-only';
		if (focusedFeature.geometry.kind !== 'polygon') return 'Extrude works on polygons only';
		if (!spec.drawKinds.includes('polygon')) return 'Selected layer does not allow polygon edits';
		return null;
	});

	const modifyLocked = $derived(Boolean(pendingModify) || modifySubmitting);

	/** Prefer a single draw target; auto-select when only one exists. */
	$effect(() => {
		const targets = drawTargets;
		if (targets.length === 1) {
			targetTable = targets[0]!.table;
		} else if (targetTable && !targets.some((t) => t.table === targetTable)) {
			targetTable = null;
		}
	});

	/** Level-linked layers need an active floor when drawing (data gaps are per-level). */
	const needsLevel = $derived(Boolean(targetSpec?.levelField));

	const draftGeometry = $derived.by((): NormalizedGeometry | null => {
		if (!draftGeo) return null;
		const n = geoJsonToNormalized(draftGeo);
		return n.kind === 'empty' ? null : n;
	});

	const createFields = $derived(targetSpec?.fields ?? []);
	const createRecordOptions = $derived.by((): Record<string, EditorOption[]> => {
		if (!targetTable) return {};
		const raw = recordOptionsByTable[targetTable] ?? {};
		const out: Record<string, EditorOption[]> = {};
		for (const [field, opts] of Object.entries(raw)) {
			out[field] = opts.map((o) => ({
				id: String(o.id),
				label: o.label,
				...(o.group !== undefined ? { group: o.group } : {}),
				...('itemLabel' in o && o.itemLabel !== undefined ? { itemLabel: o.itemLabel } : {})
			}));
		}
		return out;
	});

	const createInitialValues = $derived.by((): Record<string, string> => {
		const values: Record<string, string> = {};
		if (targetSpec?.levelField && levelId) {
			values[targetSpec.levelField] = levelId;
		}
		return values;
	});

	const lockedCreateFields = $derived.by((): string[] => {
		if (targetSpec?.levelField && levelId) return [targetSpec.levelField];
		return [];
	});

	function selectLevel(next: string | null) {
		if (next === levelId || levelLoading) return;

		appUi.setLevel(next);

		const href = resolve('/map');
		const params = new URLSearchParams(page.url.searchParams);
		if (next) {
			params.set('level', next);
		} else {
			params.delete('level');
		}
		const qs = params.toString();
		void goto(qs ? `${href}?${qs}` : href, { keepFocus: true, noScroll: true });
	}

	// If focus lands on a feature present in the payload but on another level, switch to it.
	// Do not clear the level filter for unknown ids (e.g. breakers from graph are not map layers).
	$effect(() => {
		const focusedId = appUi.focusedId;
		if (!focusedId || levelLoading || !view) return;

		const featureLevel = featureLevelById.get(focusedId);
		if (featureLevel === undefined) return;
		if (levelId != null && featureLevel != null && featureLevel !== levelId) {
			selectLevel(featureLevel);
		}
	});

	// Drop draw mode when level becomes "All" for level-scoped targets
	$effect(() => {
		if (tool === 'draw-polygon' && needsLevel && !levelId) {
			tool = 'navigate';
		}
	});

	// Leave geometry-edit tools if focus is cleared / no longer editable (unless a save needs resolve)
	$effect(() => {
		if (tool === 'modify') {
			if (pendingModify || modifySubmitting) return;
			if (!canModifyFocused) tool = 'navigate';
			return;
		}
		if (tool === 'extrude') {
			if (pendingModify || modifySubmitting) return;
			if (!canExtrudeFocused) tool = 'navigate';
		}
	});

	// Esc exits Edit/Extrude (draw cancel is handled inside MapView)
	$effect(() => {
		if (tool !== 'modify' && tool !== 'extrude') return;
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key !== 'Escape') return;
			if (pendingModify) {
				cancelPendingModify();
				return;
			}
			if (!modifySubmitting) tool = 'navigate';
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function levelLabel(level: { id: string; name?: string; ord?: number }): string {
		if (level.name && level.name.length > 0) return level.name;
		return level.id;
	}

	function featureCountLabel(n: number): string {
		return n === 1 ? '1 feature' : `${n} features`;
	}

	function loadingLabel(): string {
		if (!pendingLevel) return 'Loading all levels…';
		const match = levels.find((l) => l.id === pendingLevel);
		return match ? `Loading ${levelLabel(match)}…` : 'Loading level…';
	}

	function clearDraft() {
		draftGeo = null;
		createOpen = false;
		createError = null;
	}

	function onDrawEnd(geometry: WritableGeoJSON) {
		if (!roleCanEdit) {
			writeError = 'You do not have permission to edit';
			tool = 'navigate';
			return;
		}

		// Marker (point) → embedding dataset flow.
		if (tool === 'draw-point') {
			if (!levelId) {
				writeError = 'Pick a floor level before placing markers';
				tool = 'navigate';
				return;
			}
			if (!markerTarget) {
				writeError = 'No marker layer configured';
				tool = 'navigate';
				return;
			}
			writeError = null;
			draftGeo = geometry;
			void openMarker(geometry);
			return;
		}

		if (!targetSpec) {
			writeError = 'Select a target layer before drawing';
			tool = 'navigate';
			return;
		}
		if (needsLevel && !levelId) {
			writeError = 'Pick a floor level before drawing';
			tool = 'navigate';
			return;
		}
		writeError = null;
		draftGeo = geometry;
		createError = null;
		createOpen = true;
	}

	/** Resolve auto-generated context for the drawn point, then open the dialog. */
	async function openMarker(geometry: WritableGeoJSON) {
		markerOpen = true;
		markerResolving = true;
		markerError = null;
		markerContext = null;
		try {
			const result = await postFormAction<{ context: MarkerContextData }>('resolveMarkerContext', {
				point: JSON.stringify(geometry),
				level: levelId ?? ''
			});
			markerContext = result.context;
		} catch (err) {
			markerError = formatWriteError(err, 'Failed to resolve marker context');
		} finally {
			markerResolving = false;
		}
	}

	/** Persist the marker (description is editor-owned; context ids come from resolve). */
	async function submitMarker(description: string, image: string | null = null) {
		if (!markerTarget || !draftGeo || markerSubmitting) return;
		try {
			markerSubmitting = true;
			markerError = null;
			markerNotice = null;

			const result = await postFormAction<{
				id?: string;
				embedding: 'pending' | 'done' | 'failed';
			}>('createMarker', {
				point: JSON.stringify(draftGeo),
				level: levelId ?? '',
				description,
				zone: markerContext?.zoneId ?? '',
				shop: markerContext?.shopId ?? '',
				image
			});

			markerOpen = false;
			draftGeo = null;
			markerContext = null;
			await invalidateAll();
			if (result.id) appUi.focusRecord(result.id);
			if (result.embedding === 'failed') {
				markerNotice = 'Marker saved, but embedding failed — retry from the marker later.';
			}
			// Stay in marker mode to place more markers.
		} catch (err) {
			markerError = formatWriteError(err, 'Failed to save marker');
		} finally {
			markerSubmitting = false;
		}
	}

	async function submitCreate(values: Record<string, string>) {
		if (!targetSpec || !draftGeo || createSubmitting) return;
		try {
			createSubmitting = true;
			createError = null;
			writeError = null;

			const result = await postFormAction<{ id?: string }>('createFeature', {
				table: targetSpec.table,
				geometry: JSON.stringify(draftGeo),
				...values
			});

			clearDraft();
			await invalidateAll();
			if (result.id) appUi.focusRecord(result.id);
			// Stay in draw mode to fill more gaps quickly
		} catch (err) {
			createError =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: 'Failed to create feature';
		} finally {
			createSubmitting = false;
		}
	}

	async function submitAssign(recordId: string) {
		if (!targetSpec || !draftGeo || createSubmitting) return;
		try {
			createSubmitting = true;
			createError = null;
			writeError = null;

			const payload: Record<string, unknown> = {
				table: targetSpec.table,
				id: recordId,
				geometry: JSON.stringify(draftGeo)
			};
			if (targetSpec.levelField && levelId) {
				payload.level = levelId;
			}

			const result = await postFormAction<{ id?: string }>('assignFeature', payload);

			clearDraft();
			await invalidateAll();
			const focusId = result.id ?? recordId;
			if (focusId) appUi.focusRecord(focusId);
		} catch (err) {
			createError =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: 'Failed to assign geometry';
		} finally {
			createSubmitting = false;
		}
	}

	function formatWriteError(err: unknown, fallback: string): string {
		if (err instanceof ApiError) {
			const code = err.code !== 'action_failed' ? ` [${err.code}]` : '';
			return `${err.message}${code} (${err.status})`;
		}
		return err instanceof Error ? err.message : fallback;
	}

	function onModifyEnd(commit: ModifyCommit) {
		if (!roleCanEdit || modifySubmitting) return;
		// Drop any previous failed save for a different drag
		if (pendingModify && pendingModify.id !== commit.id) {
			pendingModify.revert();
		}
		pendingModify = {
			id: commit.id,
			table: commit.table,
			geometry: commit.geometry,
			revert: commit.revert,
			error: null
		};
		writeError = null;
		void savePendingModify();
	}

	async function savePendingModify() {
		const pending = pendingModify;
		if (!pending || modifySubmitting) return;
		try {
			modifySubmitting = true;
			pendingModify = { ...pending, error: null };
			await postFormAction('updateGeometry', {
				table: pending.table,
				id: pending.id,
				geometry: JSON.stringify(pending.geometry)
			});
			// Success: geometry already on the OL feature — no full map reload
			pendingModify = null;
			writeError = null;
		} catch (err) {
			const message = formatWriteError(err, 'Failed to save geometry');
			if (pendingModify) {
				pendingModify = { ...pendingModify, error: message };
			}
		} finally {
			modifySubmitting = false;
		}
	}

	function cancelPendingModify() {
		const pending = pendingModify;
		if (!pending || modifySubmitting) return;
		pending.revert();
		pendingModify = null;
		writeError = null;
	}

	function retryPendingModify() {
		if (!pendingModify?.error || modifySubmitting) return;
		void savePendingModify();
	}

	async function saveFeatureProperties(payload: {
		table: string;
		id: string;
		values: Record<string, string>;
	}) {
		if (!roleCanEdit || propsSubmitting) return;
		try {
			propsSubmitting = true;
			propsError = null;
			writeError = null;
			await postFormAction('updateFeature', {
				table: payload.table,
				id: payload.id,
				...payload.values
			});
			await invalidateAll();
		} catch (err) {
			propsError = formatWriteError(err, 'Failed to update feature');
		} finally {
			propsSubmitting = false;
		}
	}

	// Dialog cancel / dismiss discards the pending sketch
	$effect(() => {
		if (!createOpen && !markerOpen && draftGeo && !createSubmitting && !markerSubmitting) {
			draftGeo = null;
			createError = null;
		}
	});
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background/80 px-4 py-2"
	>
		<span class="text-sm font-medium tracking-tight">Map</span>

		{#if levels.length > 0}
			<div
				class="flex flex-wrap items-center gap-1"
				role="radiogroup"
				aria-label="Map level"
				aria-busy={levelLoading}
			>
				<Button
					type="button"
					size="sm"
					variant={levelId === null ? 'default' : 'outline'}
					aria-checked={levelId === null}
					role="radio"
					disabled={levelLoading}
					onclick={() => selectLevel(null)}
				>
					All
				</Button>
				{#each levels as level (level.id)}
					<Button
						type="button"
						size="sm"
						variant={levelId === level.id ? 'default' : 'outline'}
						aria-checked={levelId === level.id}
						role="radio"
						disabled={levelLoading}
						onclick={() => selectLevel(level.id)}
					>
						{levelLabel(level)}
					</Button>
				{/each}
			</div>
		{/if}

		{#if levelLoading}
			<span class="text-xs text-muted-foreground">{loadingLabel()}</span>
		{:else if view}
			<span class="text-xs text-muted-foreground tabular-nums"
				>{featureCountLabel(featureCount)}</span
			>
			{#if view.layers.length > 0}
				<span class="text-xs text-muted-foreground">
					· {view.layers.length} layer{view.layers.length === 1 ? '' : 's'}
				</span>
			{/if}
		{/if}

		{#if roleCanEdit && (drawTargets.length > 0 || Boolean(crud && Object.keys(crud.byTable).length > 0))}
			<div class="ml-auto">
				<MapEditToolbar
					canEdit={roleCanEdit}
					bind:tool
					bind:targetTable
					{drawTargets}
					{pointTargets}
					{needsLevel}
					{levelId}
					{canModifyFocused}
					{modifyBlockedReason}
					{canExtrudeFocused}
					{extrudeBlockedReason}
					disabled={levelLoading || createOpen || markerOpen || modifyLocked}
				/>
			</div>
		{/if}
	</div>

	{#if error && !levelLoading}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Could not load map</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if pendingModify?.error}
		<div class="shrink-0 px-4 pt-2">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Could not save geometry</Alert.Title>
				<Alert.Description class="flex flex-wrap items-start justify-between gap-2">
					<span class="min-w-0 flex-1 wrap-break-word">{pendingModify.error}</span>
					<span class="flex shrink-0 gap-1">
						<Button
							type="button"
							size="sm"
							variant="outline"
							class="h-auto px-2 py-0.5 text-xs"
							disabled={modifySubmitting}
							onclick={retryPendingModify}
						>
							Retry
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							class="h-auto px-2 py-0.5 text-xs"
							disabled={modifySubmitting}
							onclick={cancelPendingModify}
						>
							Cancel
						</Button>
					</span>
				</Alert.Description>
			</Alert.Root>
		</div>
	{:else if writeError}
		<div class="shrink-0 px-4 pt-2">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Map edit</Alert.Title>
				<Alert.Description>{writeError}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if markerNotice}
		<div class="shrink-0 px-4 pt-2">
			<Alert.Root>
				<InfoIcon />
				<Alert.Title>Marker embedding</Alert.Title>
				<Alert.Description>{markerNotice}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	<div class="relative min-h-0 w-full flex-1 overflow-hidden">
		{#if levelLoading}
			{#if browser && view}
				<div class="pointer-events-none h-full w-full opacity-40" aria-hidden="true">
					<MapView {view} />
				</div>
			{/if}
			<ViewLoadingOverlay label={loadingLabel()} />
		{:else if !view}
			<div
				class="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground"
			>
				{#if error}
					<p>Fix the issue above, then retry.</p>
				{:else}
					<p>No map data available. Connect a database with spatial entities.</p>
				{/if}
			</div>
		{:else if browser}
			{#if featureCount === 0 && tool === 'navigate'}
				<div
					class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground"
				>
					<p>
						No geometries
						{#if levelId}
							on this level
						{:else}
							in map layers
						{/if}.
					</p>
					{#if view.layers.length === 0}
						<p class="text-xs">Enable map layers on entities in app_config.</p>
					{:else if roleCanEdit && drawTargets.length > 0}
						<p class="text-xs">Use Draw to create or assign polygons and fill data gaps.</p>
					{/if}
				</div>
			{/if}
			<!-- OpenLayers is client-only (metric XY plane) -->
			<MapView
				{view}
				canEdit={roleCanEdit && !createOpen && !createSubmitting}
				tool={createOpen ? 'navigate' : tool}
				{draftGeometry}
				{modifyLocked}
				{onDrawEnd}
				{onModifyEnd}
			/>
			{#if appUi.focusedId && !createOpen}
				<svelte:boundary>
					{#snippet failed(error, reset)}
						<aside
							class="absolute top-2 right-2 z-30 w-[min(calc(100%-1rem),16.5rem)] rounded-md border border-border bg-background/95 p-2 shadow-md"
						>
							<p class="text-xs font-medium text-destructive">Properties failed to load</p>
							<p class="mt-1 text-[11px] text-muted-foreground">
								{error instanceof Error ? error.message : 'Unknown error'}
							</p>
							<div class="mt-1.5 flex gap-1.5">
								<Button
									type="button"
									size="sm"
									class="h-7 px-2 text-xs"
									variant="outline"
									onclick={reset}>Retry</Button
								>
								<Button
									type="button"
									size="sm"
									class="h-7 px-2 text-xs"
									variant="ghost"
									onclick={() => appUi.focusRecord(null)}>Close</Button
								>
							</div>
						</aside>
					{/snippet}
					{#snippet pending()}
						<aside
							class="absolute top-2 right-2 z-30 flex w-[min(calc(100%-1rem),16.5rem)] items-center gap-2 rounded-md border border-border bg-background/95 px-2 py-1.5 text-[11px] text-muted-foreground shadow-md"
							aria-label="Loading feature properties"
						>
							<span
								class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
								aria-hidden="true"
							></span>
							Loading…
						</aside>
					{/snippet}
					{#key appUi.focusedId}
						<FeaturePropertiesPanel
							recordId={appUi.focusedId}
							canEdit={roleCanEdit}
							submitting={propsSubmitting}
							error={propsError}
							onClose={() => {
								propsError = null;
								appUi.focusRecord(null);
							}}
							onSave={saveFeatureProperties}
						/>
					{/key}
				</svelte:boundary>
			{/if}
		{:else}
			<ViewLoadingOverlay label="Loading map…" veil={false} />
		{/if}
	</div>
</div>

{#if roleCanEdit && targetSpec}
	<DrawFeatureModal
		bind:open={createOpen}
		tableLabel={targetSpec.label}
		table={targetSpec.table}
		fields={createFields}
		recordOptions={createRecordOptions}
		initialValues={createInitialValues}
		lockedFields={lockedCreateFields}
		canCreate={targetSpec.canCreate}
		canUpdate={targetSpec.canUpdate}
		submitting={createSubmitting}
		error={createError}
		onCreate={submitCreate}
		onAssign={submitAssign}
	/>
{/if}

{#if roleCanEdit && markerTarget}
	<MarkerModal
		bind:open={markerOpen}
		context={markerContext}
		resolving={markerResolving}
		submitting={markerSubmitting}
		error={markerError}
		onCreate={submitMarker}
	/>
{/if}
