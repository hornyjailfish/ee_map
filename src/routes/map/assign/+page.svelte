<script lang="ts">
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import AssignMapView from '$lib/components/map/AssignMapView.svelte';
	import ViewLoadingOverlay from '$lib/components/view/ViewLoadingOverlay.svelte';
	import { ApiError, postFormAction } from '$lib/client/http';
	import { geometryToGeoJSON } from '$lib/transform/to-map';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sources = $derived(data.sources);
	const layer = $derived(data.layer);
	const tables = $derived(data.tables);
	const table = $derived(data.table);
	const records = $derived(data.records);
	const levels = $derived(data.levels);
	const error = $derived(data.error);

	const tableOpt = $derived(tables.find((t) => t.name === table) ?? null);

	const sourceKey = $derived(
		data.sourceFolder && data.sourceName ? `${data.sourceFolder}/${data.sourceName}` : ''
	);

	let selectedFeatureId = $state<string | null>(null);
	let selectedRecordId = $state<string | null>(null);
	let recordFilter = $state('');
	let assignLevelId = $state<string>('');
	let writePending = $state(false);
	let writeError = $state<string | null>(null);
	let writeOk = $state<string | null>(null);

	// Reset selections when source / table changes via URL
	$effect(() => {
		void sourceKey;
		void table;
		selectedFeatureId = null;
		selectedRecordId = null;
		writeError = null;
		writeOk = null;
	});

	// Pre-fill level from selected record or from folder key matching a level
	$effect(() => {
		const rec = records.find((r) => r.id === selectedRecordId);
		if (rec?.levelId) {
			assignLevelId = rec.levelId;
			return;
		}
		// Heuristic: folder "1" → levels:1 when present
		const folder = data.sourceFolder;
		if (folder) {
			const match = levels.find((l) => {
				const key = l.id.includes(':') ? l.id.slice(l.id.indexOf(':') + 1) : l.id;
				return key === folder || l.ord?.toString() === folder;
			});
			if (match) {
				assignLevelId = match.id;
				return;
			}
		}
		if (!selectedRecordId) assignLevelId = '';
	});

	const selectedFeature = $derived(layer?.features.find((f) => f.id === selectedFeatureId) ?? null);

	const selectedRecord = $derived(records.find((r) => r.id === selectedRecordId) ?? null);

	const filteredRecords = $derived.by(() => {
		const q = recordFilter.trim().toLowerCase();
		if (!q) return records;
		return records.filter((r) => {
			if (r.id.toLowerCase().includes(q)) return true;
			for (const v of Object.values(r.cells)) {
				if (v == null) continue;
				if (String(v).toLowerCase().includes(q)) return true;
			}
			return false;
		});
	});

	const canAssign = $derived(Boolean(selectedFeature && selectedRecord && table && !writePending));

	function levelLabel(id: string | null | undefined): string {
		if (!id) return '—';
		const match = levels.find((l) => l.id === id);
		if (match?.name) return match.name;
		return id;
	}

	function cellText(value: unknown): string {
		if (value == null || value === '') return '—';
		if (typeof value === 'string' && value.includes(':') && value.startsWith('levels:')) {
			return levelLabel(value);
		}
		return String(value);
	}

	function setQuery(next: { folder?: string | null; file?: string | null; table?: string | null }) {
		const href = resolve('/map/assign' as Pathname);
		const params = new URLSearchParams(page.url.searchParams);
		if ('folder' in next) {
			if (next.folder) params.set('folder', next.folder);
			else params.delete('folder');
		}
		if ('file' in next) {
			if (next.file) params.set('file', next.file);
			else params.delete('file');
		}
		if ('table' in next) {
			if (next.table) params.set('table', next.table);
			else params.delete('table');
		}
		const qs = params.toString();
		void goto(qs ? `${href}?${qs}` : href, { keepFocus: true, noScroll: true });
	}

	function onSourceChange(value: string) {
		const [folder, name] = value.split('/');
		if (!folder || !name) return;
		setQuery({ folder, file: name });
	}

	function onTableChange(value: string) {
		setQuery({ table: value || null });
	}

	async function assignGeometry() {
		if (!selectedFeature || !selectedRecord || !table) return;
		const geo = geometryToGeoJSON(selectedFeature.geometry);
		if (!geo) {
			writeError = 'Selected feature has no writable geometry';
			return;
		}

		writePending = true;
		writeError = null;
		writeOk = null;
		try {
			await postFormAction('assign', {
				table,
				id: selectedRecord.id,
				geometry: JSON.stringify(geo),
				level: tableOpt?.levelField && assignLevelId ? assignLevelId : null
			});
			writeOk = `Assigned geometry to ${selectedRecord.id}`;
			await invalidateAll();
		} catch (err) {
			writeError = err instanceof ApiError ? err.message : 'Assign failed';
		} finally {
			writePending = false;
		}
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background/80 px-4 py-2"
	>
		<span class="text-sm font-medium tracking-tight">Assign geometry</span>
		<span class="text-xs text-muted-foreground">
			Pick a polygon from a geo file, then a DB record
		</span>
	</div>

	{#if error}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Could not load assign data</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if writeError}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Assign failed</Alert.Title>
				<Alert.Description>{writeError}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if writeOk}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root>
				<Alert.Title>Saved</Alert.Title>
				<Alert.Description>{writeOk}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	<div class="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
		<!-- Map + source picker -->
		<div class="flex min-h-0 min-w-0 flex-col border-b border-border lg:border-r lg:border-b-0">
			<div class="flex shrink-0 flex-wrap items-end gap-3 border-b border-border px-4 py-2">
				<Field.Field class="min-w-48 flex-1">
					<Field.Label for="geo-source">Geo file</Field.Label>
					<NativeSelect.Root
						id="geo-source"
						class="w-full"
						value={sourceKey}
						disabled={sources.length === 0}
						onchange={(e) => onSourceChange(e.currentTarget.value)}
					>
						{#if sources.length === 0}
							<NativeSelect.Option value="">No geo files in static/geo</NativeSelect.Option>
						{:else}
							{#each sources as src (src.path)}
								<NativeSelect.Option value={`${src.folder}/${src.name}`}>
									{src.folder}/{src.name} ({src.featureCount})
								</NativeSelect.Option>
							{/each}
						{/if}
					</NativeSelect.Root>
				</Field.Field>

				{#if layer}
					<span class="pb-2 text-xs text-muted-foreground tabular-nums">
						{layer.features.length} feature{layer.features.length === 1 ? '' : 's'}
					</span>
				{/if}
			</div>

			<div class="relative min-h-0 flex-1 overflow-hidden">
				{#if !layer}
					<div
						class="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
					>
						<p>Select a geojson source to display geometries.</p>
					</div>
				{:else if browser}
					<AssignMapView
						{layer}
						selectedId={selectedFeatureId}
						onSelect={(id) => {
							selectedFeatureId = id;
							writeOk = null;
						}}
					/>
					{#if selectedFeature}
						<div
							class="pointer-events-none absolute right-3 bottom-3 z-10 max-w-xs rounded-md border border-border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur"
						>
							<p class="font-medium">Selected feature</p>
							<p class="text-muted-foreground">{selectedFeature.id}</p>
							<p class="text-muted-foreground">{selectedFeature.geometry.kind}</p>
						</div>
					{/if}
				{:else}
					<ViewLoadingOverlay label="Loading map…" veil={false} />
				{/if}
			</div>
		</div>

		<!-- Record picker -->
		<aside class="flex min-h-0 flex-col bg-muted/20">
			<div class="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
				<Field.Field>
					<Field.Label for="assign-table">Table</Field.Label>
					<NativeSelect.Root
						id="assign-table"
						class="w-full"
						value={table ?? ''}
						disabled={tables.length === 0}
						onchange={(e) => onTableChange(e.currentTarget.value)}
					>
						{#if tables.length === 0}
							<NativeSelect.Option value="">No geometry tables</NativeSelect.Option>
						{:else}
							{#each tables as t (t.name)}
								<NativeSelect.Option value={t.name}>{t.label}</NativeSelect.Option>
							{/each}
						{/if}
					</NativeSelect.Root>
				</Field.Field>

				<Field.Field>
					<Field.Label for="record-filter">Filter records</Field.Label>
					<Input
						id="record-filter"
						placeholder="Search name, id…"
						bind:value={recordFilter}
						autocomplete="off"
					/>
				</Field.Field>

				{#if tableOpt?.levelField}
					<Field.Field>
						<Field.Label for="assign-level">Level (written with geometry)</Field.Label>
						<NativeSelect.Root id="assign-level" class="w-full" bind:value={assignLevelId}>
							<NativeSelect.Option value="">Keep existing / none</NativeSelect.Option>
							{#each levels as lv (lv.id)}
								<NativeSelect.Option value={lv.id}>
									{lv.name ?? lv.id}
								</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</Field.Field>
				{/if}

				<Button type="button" class="w-full" disabled={!canAssign} onclick={assignGeometry}>
					{#if writePending}
						<Spinner data-icon="inline-start" />
					{/if}
					Assign to selected record
				</Button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto p-2">
				{#if filteredRecords.length === 0}
					<p class="px-2 py-4 text-center text-xs text-muted-foreground">No records</p>
				{:else}
					<ul class="flex flex-col gap-1.5" role="listbox" aria-label="Database records">
						{#each filteredRecords as rec (rec.id)}
							{@const active = rec.id === selectedRecordId}
							<li>
								<button
									type="button"
									role="option"
									aria-selected={active}
									class={[
										'w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
										active
											? 'border-primary bg-primary/10'
											: 'border-border bg-background hover:bg-muted/60'
									]}
									onclick={() => {
										selectedRecordId = rec.id;
										writeOk = null;
									}}
								>
									<div class="flex items-start justify-between gap-2">
										<span class="font-medium break-all">{rec.id}</span>
										{#if rec.hasGeometry}
											<Badge variant="secondary">has geom</Badge>
										{:else}
											<Badge variant="outline">empty</Badge>
										{/if}
									</div>
									{#if tableOpt}
										<dl class="mt-1.5 grid gap-0.5 text-muted-foreground">
											{#each tableOpt.fields as f (f.name)}
												<div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-1">
													<dt class="truncate">{f.label}</dt>
													<dd class="truncate text-foreground">{cellText(rec.cells[f.name])}</dd>
												</div>
											{/each}
										</dl>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if selectedRecord}
				<div class="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
					Target: <span class="font-medium text-foreground">{selectedRecord.id}</span>
					{#if selectedFeature}
						· feature selected
					{:else}
						· select a polygon on the map
					{/if}
				</div>
			{/if}
		</aside>
	</div>
</div>
