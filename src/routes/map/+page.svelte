<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import MapView from '$lib/components/map/MapView.svelte';
	import ViewLoadingOverlay from '$lib/components/view/ViewLoadingOverlay.svelte';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const view = $derived(data.view);
	const levelId = $derived(data.levelId);
	const error = $derived(data.error);
	const levels = $derived(view?.levels ?? []);

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
			{#if featureCount === 0}
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
					{/if}
				</div>
			{/if}
			<!-- OpenLayers is client-only (metric XY plane) -->
			<MapView {view} />
		{:else}
			<ViewLoadingOverlay label="Loading map…" veil={false} />
		{/if}
	</div>
</div>
