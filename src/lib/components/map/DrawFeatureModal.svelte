<script lang="ts">
	/**
	 * Post-draw save dialog: create a new row or assign geometry to an existing record.
	 * Assign path is for rows with empty (or replaceable) geometry — avoids unique-index
	 * collisions from trying to CREATE a duplicate name/key.
	 */
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import {
		ensureEditorsRegistered,
		isFormEditorField,
		resolveFieldEditor,
		type EditorOption
	} from '$lib/client/editors';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import * as Switch from '$lib/components/ui/switch/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import FormFieldControl from '$lib/components/table/FormFieldControl.svelte';
	import type { TableColumn } from '$lib/transform/to-table';
	import {
		searchAssignRecords,
		type AssignRecordRow
	} from '../../../routes/map/assign/assign.remote';

	ensureEditorsRegistered();

	export type DrawSaveMode = 'create' | 'existing';

	type Props = {
		open?: boolean;
		/** Entity label used in titles. */
		tableLabel?: string;
		fields?: TableColumn[];
		recordOptions?: Record<string, EditorOption[]>;
		initialValues?: Record<string, string>;
		lockedFields?: string[];
		/** Target table for existing-record search. */
		table?: string | null;
		canCreate?: boolean;
		canUpdate?: boolean;
		submitting?: boolean;
		error?: string | null;
		onCreate?: (values: Record<string, string>) => void | Promise<void>;
		onAssign?: (recordId: string) => void | Promise<void>;
	};

	let {
		open = $bindable(false),
		tableLabel = 'record',
		fields = [],
		recordOptions = {},
		initialValues = {},
		lockedFields = [],
		table = null,
		canCreate = true,
		canUpdate = true,
		submitting = false,
		error = null,
		onCreate,
		onAssign
	}: Props = $props();

	/** Tabs bind to string; keep union via guarded assignment. */
		let mode = $state('create' as DrawSaveMode);
	let values = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});
	let recordFilter = $state('');
	let searchQ = $state('');
	let selectedRecordId = $state<string | null>(null);
	let emptyOnly = $state(true);
	let wasOpen = false;

	const formFields = $derived(fields.filter((c) => isFormEditorField(c)));
	const locked = $derived(new Set(lockedFields));
	const showCreate = $derived(canCreate);
	const showExisting = $derived(canUpdate);
	const bothModes = $derived(showCreate && showExisting);

	const title = $derived(
		mode === 'existing' ? `Assign to existing ${tableLabel}` : `Create ${tableLabel}`
	);
	const description = $derived(
		mode === 'existing'
			? 'Pick a row without geometry (or replace an existing one). Drawn shape is written onto that record.'
			: 'Drawn geometry will be saved with a new record.'
	);
	const submitLabel = $derived(mode === 'existing' ? 'Assign geometry' : 'Create on map');
	const errorTitle = $derived(mode === 'existing' ? 'Assign failed' : 'Create failed');

	$effect(() => {
		const q = recordFilter;
		const handle = setTimeout(() => {
			searchQ = q;
		}, 200);
		return () => clearTimeout(handle);
	});

	const recordsQuery = $derived(
		open && mode === 'existing' && table ? searchAssignRecords({ table, q: searchQ }) : null
	);
	const searchResult = $derived(
		recordsQuery ? await recordsQuery : { table: null as string | null, records: [] as AssignRecordRow[] }
	);
	const allRecords = $derived(searchResult.records);
	const records = $derived(emptyOnly ? allRecords.filter((r) => !r.hasGeometry) : allRecords);
	const selectedRecord = $derived(records.find((r) => r.id === selectedRecordId) ?? null);

	// Drop selection when filter / search removes the active row from the list.
	$effect(() => {
		if (selectedRecordId && !records.some((r) => r.id === selectedRecordId)) {
			selectedRecordId = null;
		}
	});

	function defaultMode(): DrawSaveMode {
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
		mode = defaultMode();
		seedValues();
		recordFilter = '';
		searchQ = '';
		selectedRecordId = null;
		emptyOnly = true;
	}

	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) resetOnOpen();
		wasOpen = isOpen;
	});

	// Keep mode valid if permissions are one-sided
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

	async function handleSubmit() {
		if (submitting) return;
		if (mode === 'existing') {
			if (!selectedRecordId) return;
			await onAssign?.(selectedRecordId);
			return;
		}
		if (!validateCreate()) return;
		const payload: Record<string, string> = {};
		for (const c of formFields) {
			const value = values[c.id]?.trim();
			if (value) payload[c.id] = value;
		}
		await onCreate?.(payload);
	}

	const canSubmit = $derived.by(() => {
		if (submitting) return false;
		if (mode === 'existing') return Boolean(selectedRecordId);
		return true;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[min(90vh,40rem)] flex-col gap-4 overflow-hidden sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		{#if bothModes}
			<Tabs.Root
				value={mode}
				onValueChange={(next) => {
					if (next === 'create' || next === 'existing') mode = next;
				}}
				class="gap-3"
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
									<Field.Label for={`draw-create-${c.id}`}>
										{c.header}
										{c.optional === false ? ' *' : ''}
									</Field.Label>
									<FormFieldControl
										id={`draw-create-${c.id}`}
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
						<Field.Label for="draw-record-filter">Search records</Field.Label>
						<Input
							id="draw-record-filter"
							placeholder="Name, id…"
							bind:value={recordFilter}
							autocomplete="off"
							disabled={submitting || !table}
						/>
					</Field.Field>

					<label class="flex items-center gap-2 text-xs text-muted-foreground" for="draw-empty-only">
						<Switch.Root id="draw-empty-only" size="sm" bind:checked={emptyOnly} disabled={submitting} />
						Only without geometry
					</label>

					{#if !table}
						<p class="py-4 text-center text-xs text-muted-foreground">No table selected</p>
					{:else if records.length === 0}
						<p class="py-4 text-center text-xs text-muted-foreground">
							{searchQ.trim()
								? 'No matches'
								: emptyOnly
									? 'No records without geometry'
									: 'No records'}
						</p>
					{:else}
						<ul
							class="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5"
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
										disabled={submitting}
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
							{#if selectedRecord.hasGeometry}
								· will replace existing geometry
							{/if}
						</p>
					{/if}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">This table cannot receive drawn geometry.</p>
			{/if}
		</div>

		{#if error}
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>{errorTitle}</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props} disabled={submitting}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button type="button" disabled={!canSubmit} onclick={handleSubmit}>
				{#if submitting}
					<Spinner class="size-3.5" data-icon="inline-start" />
				{/if}
				{submitLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
