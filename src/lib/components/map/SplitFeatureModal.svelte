<script lang="ts">
	/**
	 * After a polygon split: locked OL preview of the two parts.
	 * Step 1 — pick which part keeps the existing record (no empty orphan).
	 * Step 2 — create or assign a record for the other part (mirrors DrawFeatureModal).
	 */
	import type { Attachment } from 'svelte/attachments';
	import { untrack } from 'svelte';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import Map from 'ol/Map';
	import View from 'ol/View';
	import VectorLayer from 'ol/layer/Vector';
	import VectorSource from 'ol/source/Vector';
	import Feature from 'ol/Feature';
	import Polygon from 'ol/geom/Polygon';
	import Projection from 'ol/proj/Projection';
	import { getCenter, boundingExtent, buffer as bufferExtent } from 'ol/extent';
	import { defaults as defaultInteractions } from 'ol/interaction/defaults';
	import Fill from 'ol/style/Fill';
	import Stroke from 'ol/style/Stroke';
	import Style from 'ol/style/Style';
	import Text from 'ol/style/Text';
	import {
		ensureEditorsRegistered,
		isFormEditorField,
		resolveFieldEditor,
		type EditorOption
	} from '$lib/client/editors';
	import type { WritableGeoJSON } from '$lib/client/map';
	import { geoJsonToNormalized } from '$lib/client/map';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import FormFieldControl from '$lib/components/table/FormFieldControl.svelte';
	import type { TableColumn } from '$lib/transform/to-table';
	import {
		searchAssignRecords,
		type AssignRecordRow
	} from '../../../routes/map/assign/assign.remote';
	import 'ol/ol.css';

	ensureEditorsRegistered();

	export type SplitPartKey = 'a' | 'b';
	export type SplitSaveMode = 'create' | 'existing';

	export type SplitFeatureSubmit = {
		/** Geometry that stays on the original record. */
		keepGeometry: WritableGeoJSON;
		/** Geometry for the new/assigned record. */
		otherGeometry: WritableGeoJSON;
		mode: SplitSaveMode;
		/** Create field values when mode === create. */
		values?: Record<string, string>;
		/** Existing record id when mode === existing. */
		recordId?: string;
	};

	type Props = {
		open?: boolean;
		/** Original feature id (shown in copy). */
		featureId?: string;
		/** Human-readable name (area / record label). */
		featureLabel?: string | null;
		tableLabel?: string;
		table?: string | null;
		parts?: [WritableGeoJSON, WritableGeoJSON] | null;
		fields?: TableColumn[];
		recordOptions?: Record<string, EditorOption[]>;
		initialValues?: Record<string, string>;
		lockedFields?: string[];
		canCreate?: boolean;
		canUpdate?: boolean;
		submitting?: boolean;
		error?: string | null;
		onSubmit?: (payload: SplitFeatureSubmit) => void | Promise<void>;
		onCancel?: () => void;
	};

	let {
		open = $bindable(false),
		featureId = '',
		featureLabel = null,
		tableLabel = 'record',
		table = null,
		parts = null,
		fields = [],
		recordOptions = {},
		initialValues = {},
		lockedFields = [],
		canCreate = true,
		canUpdate = true,
		submitting = false,
		error = null,
		onSubmit,
		onCancel
	}: Props = $props();

	let step = $state(1 as 1 | 2);
	let keepPart = $state<SplitPartKey | null>(null);
	let mode = $state('create' as SplitSaveMode);
	let values = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});
	let recordFilter = $state('');
	let searchQ = $state('');
	let selectedRecordId = $state<string | null>(null);
	let wasOpen = false;

	const formFields = $derived(fields.filter((c) => isFormEditorField(c)));
	const locked = $derived(new Set(lockedFields));
	const showCreate = $derived(canCreate);
	const showExisting = $derived(canUpdate);
	const bothModes = $derived(showCreate && showExisting);
	const partA = $derived(parts?.[0] ?? null);
	const partB = $derived(parts?.[1] ?? null);
	const displayName = $derived.by(() => {
		const name = featureLabel?.trim();
		if (name) return name;
		return featureId || 'feature';
	});
	const displayIdHint = $derived.by(() => {
		const name = featureLabel?.trim();
		if (name && featureId && name !== featureId) return featureId;
		return null;
	});

	$effect(() => {
		const q = recordFilter;
		const handle = setTimeout(() => {
			searchQ = q;
		}, 200);
		return () => clearTimeout(handle);
	});

	const recordsQuery = $derived(
		open && step === 2 && mode === 'existing' && table
			? searchAssignRecords({ table, q: searchQ })
			: null
	);
	const searchResult = $derived(
		recordsQuery
			? await recordsQuery
			: { table: null as string | null, records: [] as AssignRecordRow[] }
	);
	const records = $derived(searchResult.records);
	const selectedRecord = $derived(records.find((r) => r.id === selectedRecordId) ?? null);

	$effect(() => {
		if (selectedRecordId && !records.some((r) => r.id === selectedRecordId)) {
			selectedRecordId = null;
		}
	});

	function defaultMode(): SplitSaveMode {
		if (canCreate) return 'create';
		if (canUpdate) return 'existing';
		return 'create';
	}

	function seedValues() {
		const next: Record<string, string> = {};
		for (const c of formFields) {
			next[c.id] = initialValues[c.id] ?? '';
		}
		values = next;
		errors = {};
	}

	function resetOnOpen() {
		step = 1;
		keepPart = null;
		mode = defaultMode();
		seedValues();
		recordFilter = '';
		searchQ = '';
		selectedRecordId = null;
	}

	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) resetOnOpen();
		wasOpen = isOpen;
	});

	$effect(() => {
		if (!open) return;
		if (mode === 'create' && !showCreate && showExisting) mode = 'existing';
		if (mode === 'existing' && !showExisting && showCreate) mode = 'create';
	});

	function optionsForColumn(c: TableColumn): EditorOption[] | null {
		if (c.valueType !== 'record') return null;
		const opts = recordOptions[c.id];
		return opts && opts.length > 0 ? opts : null;
	}

	function formEditorFor(c: TableColumn) {
		return resolveFieldEditor(c, optionsForColumn(c), { allowEmptyOptions: true });
	}

	function validateCreate(): boolean {
		const next: Record<string, string> = {};
		for (const c of formFields) {
			if (c.optional === false && !values[c.id]?.trim()) {
				next[c.id] = 'Required';
			}
		}
		errors = next;
		return Object.keys(next).length === 0;
	}

	function cellPreview(rec: AssignRecordRow): string {
		const name = rec.cells.name ?? rec.cells.label;
		if (name != null && String(name).trim() !== '') return String(name);
		return rec.id;
	}

	function goNext() {
		if (!keepPart) return;
		step = 2;
	}

	function goBack() {
		if (submitting) return;
		step = 1;
	}

	async function handleSubmit() {
		if (submitting || !parts || !keepPart) return;
		const keepGeometry = keepPart === 'a' ? parts[0] : parts[1];
		const otherGeometry = keepPart === 'a' ? parts[1] : parts[0];

		if (mode === 'existing') {
			if (!selectedRecordId) return;
			await onSubmit?.({
				keepGeometry,
				otherGeometry,
				mode: 'existing',
				recordId: selectedRecordId
			});
			return;
		}
		if (!validateCreate()) return;
		const payload: Record<string, string> = {};
		for (const c of formFields) {
			const value = values[c.id]?.trim();
			if (value) payload[c.id] = value;
		}
		await onSubmit?.({
			keepGeometry,
			otherGeometry,
			mode: 'create',
			values: payload
		});
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) onCancel?.();
	}

	const canSubmit = $derived.by(() => {
		if (submitting || !parts || !keepPart) return false;
		if (step !== 2) return false;
		if (mode === 'existing') return Boolean(selectedRecordId);
		return true;
	});

	const partStyle = (key: SplitPartKey, selected: boolean) =>
		new Style({
			fill: new Fill({
				color: selected
					? key === 'a'
						? 'rgba(37, 99, 235, 0.45)'
						: 'rgba(16, 185, 129, 0.45)'
					: key === 'a'
						? 'rgba(37, 99, 235, 0.22)'
						: 'rgba(16, 185, 129, 0.22)'
			}),
			stroke: new Stroke({
				color: selected ? (key === 'a' ? '#1d4ed8' : '#059669') : key === 'a' ? '#3b82f6' : '#10b981',
				width: selected ? 3 : 2
			}),
			text: new Text({
				text: key === 'a' ? 'A' : 'B',
				font: 'bold 16px sans-serif',
				fill: new Fill({ color: '#0f172a' }),
				stroke: new Stroke({ color: '#fff', width: 3 })
			})
		});

	const previewAttach: Attachment<HTMLDivElement> = (element) => {
		const initialParts = untrack(() => parts);
		const coords: number[][] = [];
		if (initialParts) {
			for (const p of initialParts) {
				const n = geoJsonToNormalized(p);
				if (n.kind === 'polygon') {
					for (const ring of n.rings) for (const c of ring) coords.push(c);
				}
			}
		}
		let extent =
			coords.length > 0
				? (boundingExtent(coords) as [number, number, number, number])
				: ([-10, -10, 10, 10] as [number, number, number, number]);
		if (extent[0] === extent[2] || extent[1] === extent[3]) {
			extent = bufferExtent(extent, 10) as [number, number, number, number];
		} else {
			extent = bufferExtent(extent, Math.max(extent[2] - extent[0], extent[3] - extent[1]) * 0.08) as [
				number,
				number,
				number,
				number
			];
		}

		const projection = new Projection({
			code: 'MAP:XY',
			units: 'm',
			extent
		});

		const source = new VectorSource({ wrapX: false });
		const layer = new VectorLayer({
			source,
			style: (f) => {
				const key = (f.get('part') as SplitPartKey) ?? 'a';
				const selected = f.get('selected') === true;
				return partStyle(key, selected);
			},
			updateWhileAnimating: true,
			updateWhileInteracting: true
		});

		const map = new Map({
			target: element,
			layers: [layer],
			controls: [],
			// Locked preview: select only — no pan / zoom.
			interactions: defaultInteractions({
				dragPan: false,
				mouseWheelZoom: false,
				doubleClickZoom: false,
				shiftDragZoom: false,
				pinchZoom: false,
				pinchRotate: false,
				keyboard: false
			}),
			view: new View({
				projection,
				center: getCenter(extent),
				zoom: 1,
				multiWorld: false
			})
		});
		map.getView().fit(extent, { padding: [16, 16, 16, 16], maxZoom: 8, duration: 0 });

		const resizeObserver = new ResizeObserver(() => map.updateSize());
		resizeObserver.observe(element);

		const keepBox: { part: SplitPartKey | null } = { part: untrack(() => keepPart) };

		function rebuild(nextParts: [WritableGeoJSON, WritableGeoJSON] | null, selected: SplitPartKey | null) {
			source.clear();
			if (!nextParts) return;
			const keys: SplitPartKey[] = ['a', 'b'];
			nextParts.forEach((geo, i) => {
				const n = geoJsonToNormalized(geo);
				if (n.kind !== 'polygon') return;
				const f = new Feature({ geometry: new Polygon(n.rings) });
				const key = keys[i]!;
				f.setId(key);
				f.set('part', key);
				f.set('selected', selected === key);
				source.addFeature(f);
			});
		}

		rebuild(initialParts, keepBox.part);

		map.on('singleclick', (evt) => {
			if (untrack(() => submitting) || untrack(() => step) !== 1) return;
			const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => f, { hitTolerance: 2 });
			if (!hit) return;
			const key = hit.get('part') as SplitPartKey | undefined;
			if (key === 'a' || key === 'b') {
				keepPart = key;
				keepBox.part = key;
				for (const f of source.getFeatures()) {
					f.set('selected', f.get('part') === key);
				}
				source.changed();
			}
		});

		return () => {
			resizeObserver.disconnect();
			map.setTarget(undefined);
			map.dispose();
		};
	};

	// Re-run attachment when parts identity changes while open by keying the host.
	const previewKey = $derived(
		parts
			? `${parts[0].type}:${JSON.stringify(parts[0].coordinates).length}:${JSON.stringify(parts[1].coordinates).length}`
			: 'none'
	);
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="flex max-h-[min(92vh,44rem)] flex-col gap-3 overflow-hidden sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				{#if step === 1}
					Split · {displayName}
				{:else}
					Second part · {displayName}
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if step === 1}
					Split of
					<span class="font-medium text-foreground">{displayName}</span>
					{#if displayIdHint}
						<span class="text-muted-foreground">({displayIdHint})</span>
					{/if}.
					Click polygon A or B — that part keeps the current record data. The other part gets a new or existing row.
				{:else if mode === 'existing'}
					Assign the remaining polygon to an existing {tableLabel}.
				{:else}
					Create a new {tableLabel} for the remaining polygon.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if parts && open}
			{#key previewKey}
				<div
					class={[
						'relative h-48 w-full shrink-0 overflow-hidden rounded-md border border-border bg-muted/30',
						step === 1 ? 'cursor-pointer' : 'cursor-default opacity-90'
					]}
					role="img"
					aria-label="Split preview map"
					{@attach previewAttach}
				></div>
			{/key}
			<div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span class="inline-flex items-center gap-1">
					<span class="size-2.5 rounded-sm bg-blue-500/70"></span> Part A
				</span>
				<span class="inline-flex items-center gap-1">
					<span class="size-2.5 rounded-sm bg-emerald-500/70"></span> Part B
				</span>
				{#if keepPart}
					<Badge variant="secondary" class="text-[10px]">
						Keep on {displayName}: {keepPart.toUpperCase()}
					</Badge>
				{/if}
			</div>
		{/if}

		{#if step === 2}
			{#if bothModes}
				<Tabs.Root
					value={mode}
					onValueChange={(next) => {
						if (next === 'create' || next === 'existing') mode = next;
					}}
					class="gap-2"
				>
					<Tabs.List class="w-full">
						<Tabs.Trigger value="create" class="flex-1" disabled={submitting}>New record</Tabs.Trigger>
						<Tabs.Trigger value="existing" class="flex-1" disabled={submitting}
							>Existing record</Tabs.Trigger
						>
					</Tabs.List>
				</Tabs.Root>
			{/if}

			<div class="min-h-0 flex-1 overflow-y-auto px-0.5">
				{#if mode === 'create' && showCreate}
					{#if formFields.length === 0}
						<p class="px-1 text-sm text-muted-foreground">No editable fields on this table.</p>
					{:else}
						<Field.Group class="gap-3">
							{#each formFields as c (c.id)}
								{@const editor = formEditorFor(c)}
								{@const invalid = Boolean(errors[c.id])}
								{@const isLocked = locked.has(c.id)}
								{#if editor}
									<Field.Field data-invalid={invalid ? 'true' : undefined}>
										<Field.Label for={`split-create-${c.id}`}>
											{c.header}
											{c.optional === false ? ' *' : ''}
										</Field.Label>
										<FormFieldControl
											id={`split-create-${c.id}`}
											type={editor.type}
											valueType={c.valueType}
											value={values[c.id] ?? ''}
											options={editor.options ?? []}
											{invalid}
											disabled={isLocked || submitting}
											onValueChange={(next) => {
												if (isLocked) return;
												values = { ...values, [c.id]: next };
												if (errors[c.id]) errors = { ...errors, [c.id]: '' };
											}}
										/>
										{#if invalid}
											<Field.Error>{errors[c.id]}</Field.Error>
										{/if}
									</Field.Field>
								{/if}
							{/each}
						</Field.Group>
					{/if}
				{:else if mode === 'existing' && showExisting}
					<div class="flex flex-col gap-3">
						<Field.Field>
							<Field.Label for="split-record-filter">Search records</Field.Label>
							<Input
								id="split-record-filter"
								placeholder="Name, id…"
								bind:value={recordFilter}
								autocomplete="off"
								disabled={submitting || !table}
							/>
						</Field.Field>
						{#if !table}
							<p class="py-4 text-center text-xs text-muted-foreground">No table selected</p>
						{:else if records.length === 0}
							<p class="py-4 text-center text-xs text-muted-foreground">
								{searchQ.trim() ? 'No matches' : 'No records'}
							</p>
						{:else}
							<ul
								class="flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-0.5"
								role="listbox"
								aria-label="Existing records"
							>
								{#each records as rec (rec.id)}
									{@const active = rec.id === selectedRecordId}
									<li>
										<button
											type="button"
											role="option"
											aria-selected={active}
											disabled={submitting || rec.id === featureId}
											class={[
												'w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
												active
													? 'border-primary bg-primary/10'
													: 'border-border bg-background hover:bg-muted/60'
											]}
											onclick={() => {
												selectedRecordId = rec.id;
											}}
										>
											<div class="flex items-start justify-between gap-2">
												<span class="font-medium break-all">{cellPreview(rec)}</span>
												{#if rec.hasGeometry}
													<Badge variant="secondary">has geom</Badge>
												{:else}
													<Badge variant="outline">empty</Badge>
												{/if}
											</div>
											{#if cellPreview(rec) !== rec.id}
												<p class="mt-0.5 truncate text-muted-foreground">{rec.id}</p>
											{/if}
										</button>
									</li>
								{/each}
							</ul>
						{/if}
						{#if selectedRecord}
							<p class="text-xs text-muted-foreground">
								Target: <span class="font-medium text-foreground">{selectedRecord.id}</span>
							</p>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">This table cannot receive the second part.</p>
				{/if}
			</div>
		{/if}

		{#if error}
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Split failed</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		<Dialog.Footer class="gap-2 sm:justify-between">
			<div class="flex gap-2">
				{#if step === 2}
					<Button type="button" variant="outline" disabled={submitting} onclick={goBack}>Back</Button>
				{/if}
			</div>
			<div class="flex gap-2">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button variant="outline" {...props} disabled={submitting}>Cancel</Button>
					{/snippet}
				</Dialog.Close>
				{#if step === 1}
					<Button type="button" disabled={!keepPart || submitting} onclick={goNext}>Next</Button>
				{:else}
					<Button type="button" disabled={!canSubmit} onclick={handleSubmit}>
						{#if submitting}
							<Spinner class="size-3.5" data-icon="inline-start" />
						{/if}
						Apply split
					</Button>
				{/if}
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
