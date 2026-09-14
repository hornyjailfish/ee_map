<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import AddRowModal from '$lib/components/table/AddRowModal.svelte';
	import ViewLoadingOverlay from '$lib/components/view/ViewLoadingOverlay.svelte';
	import {
		editorValueFromDb,
		ensureEditorsRegistered,
		NONE_OPTION_ID,
		resolveFieldEditor,
		type EditorOption
	} from '$lib/client/editors';

	// Client-only: wire SVAR inline + form editor components once.
	ensureEditorsRegistered();
	import { ApiError, postFormAction } from '$lib/client/http';
	import { tableOfRecordId } from '$lib/client/selection';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import { columnSortFn } from '$lib/transform/compare';
	import type { TableColumn, TableRow, TableViewModel } from '$lib/transform/to-table';
	import {
		Grid,
		Willow,
		type IApi,
		type IColumnConfig,
		type TMethodsConfig
	} from '@svar-ui/svelte-grid';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { canEdit } from '$lib/roles';

	let { data }: { data: PageData } = $props();

	const tables = $derived(data.tables);
	const activeTable = $derived(data.table);
	const view = $derived(data.view);
	const error = $derived(data.error);

	const userRoles = $derived((data.userRoles ?? []) as import('$lib/catalog-types').AppRole[]);
	/** Role gate: EDITOR/OWNER only. */
	const roleCanEdit = $derived(canEdit(userRoles));
	/** Table gate: live STRUCTURE permissions for the active table. */
	const canUpdate = $derived(roleCanEdit && (view?.permissions.update ?? false));
	const canCreate = $derived(roleCanEdit && (view?.permissions.create ?? false));
	const canDelete = $derived(roleCanEdit && (view?.permissions.delete ?? false));

	const svarColumns = $derived(view ? toSvarColumns(view.columns, canUpdate) : []);
	/** Normalize null optional combo cells → '' so optionsMap shows None. */
	const gridData = $derived.by(() => {
		const rows = (view?.data ?? []) as TableRow[];
		if (!view || rows.length === 0) return rows;
		const nullableChoiceCols = view.columns.filter(
			(c) => c.optional !== false && (c.valueType === 'record' || c.valueType === 'bool')
		);
		if (nullableChoiceCols.length === 0) return rows;
		return rows.map((row) => {
			let next: TableRow | null = null;
			for (const c of nullableChoiceCols) {
				const raw = row[c.id];
				if (raw != null) continue;
				if (!next) next = { ...row };
				next[c.id] = NONE_OPTION_ID;
			}
			return next ?? row;
		});
	});
	const hasRows = $derived(gridData.length > 0);

	let writeError = $state<string | null>(null);
	let writePending = $state(false);
	/** Selected row ids, tracked from SVAR selection for delete enablement. */
	let selectedRows = $state<string[]>([]);

	/** Add-row modal state. */
	let addOpen = $state(false);
	let addSubmitting = $state(false);
	let addError = $state<string | null>(null);

	const recordOptions = $derived(data.recordOptions ?? {});

	/** True while a same-route table switch is in flight. */
	const tableLoading = $derived.by(() => {
		const to = navigating.to;
		if (!to) return false;
		// Only query-param switches on this page (not leaving to graph/map)
		if (to.route.id !== page.route.id) return false;
		return to.url.search !== page.url.search;
	});

	const pendingTable = $derived(navigating.to?.url.searchParams.get('table') ?? null);

	/** Imperative SVAR handle for select/scroll from shared focus. */
	let gridApi = $state<IApi | null>(null);
	/** Suppress feedback when we programmatically select from appUi. */
	let applyingExternalSelection = false;
	/**
	 * Last focusedId we already considered for table-follow.
	 * Only navigate on *focus changes* (graph/map selection) — never snap back
	 * when the user picks another entity in the switcher while focus is stale.
	 */
	let lastFollowedFocusId: string | null | undefined = undefined;

	function toSvarColumns(cols: TableColumn[], editable: boolean): IColumnConfig[] {
		return cols.map((c) => {
			const col: IColumnConfig = {
				id: c.id,
				header: c.header,
				// Natural numeric-aware compare on every sortable column
				sort: c.sort === false ? false : columnSortFn(c.id)
			};
			if (c.width != null && c.width > 0) {
				col.width = c.width;
			} else {
				// Fill remaining space when entity has no explicit width
				col.flexgrow = 1;
			}

			// Record labels (+ None when optional) so null cells display correctly.
			const recordOpts = optionsForColumn(c);
			const editor = resolveFieldEditor(c, recordOpts);
			if (editor?.options) {
				col.options = editor.options;
			} else if (recordOpts) {
				col.options = recordOpts;
			}

			// Editor key from field config / type default (components via registerEditor).
			if (editable && editor) {
				col.editor = editor.type;
			}
			return col;
		});
	}

	/** Record-link options for a column (id + label + optional group). */
	function optionsForColumn(c: TableColumn): EditorOption[] | null {
		if (c.valueType !== 'record') return null;
		const opts = recordOptions[c.id];
		return opts && opts.length > 0 ? opts : null;
	}

	function switchTable(next: string, opts?: { clearForeignFocus?: boolean }) {
		if (!next || next === activeTable || tableLoading) return;
		// Manual switcher: drop focus that belongs to another entity so we don't
		// keep a stale cross-table selection (and so focus-follow won't fight later).
		if (opts?.clearForeignFocus) {
			const focusTable = tableOfRecordId(appUi.focusedId);
			if (focusTable != null && focusTable !== next) {
				appUi.focusRecord(null);
				lastFollowedFocusId = null;
			}
		}
		const href = resolve('/table');
		const params = new URLSearchParams(page.url.searchParams);
		params.set('table', next);
		void goto(`${href}?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	function onTableChange(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		switchTable(select.value, { clearForeignFocus: true });
	}

	function initGrid(api: IApi) {
		gridApi = api;
		applyDefaultSortMarks(api, view?.sort);
		applyFocusToGrid(api, appUi.focusedId);
	}

	/**
	 * Show SVAR header sort marks for config default sort.
	 * Data is already ordered in toTable — call after mount / when view identity changes.
	 */
	function applyDefaultSortMarks(api: IApi, sort: TableViewModel['sort'] | undefined) {
		if (!sort?.length) return;
		// Primary first as single-column reset, then secondary with add:true
		for (let i = 0; i < sort.length; i++) {
			const key = sort[i]!;
			api.exec('sort-rows', {
				key: key.field,
				order: key.dir,
				add: i === 0 ? false : true
			});
		}
	}

	function applyFocusToGrid(api: IApi, focusedId: string | null) {
		if (!focusedId) return;
		const row = api.getRow(focusedId);
		if (!row) return;

		const selected = api.getState().selectedRows ?? [];
		if (selected.length === 1 && selected[0] === focusedId) return;

		applyingExternalSelection = true;
		try {
			api.exec('select-row', { id: focusedId, show: true });
			api.exec('scroll', { row: focusedId });
		} finally {
			// SVAR may fire select-row sync; clear on next microtask if still set
			queueMicrotask(() => {
				applyingExternalSelection = false;
			});
		}
	}
	/** Grid maps `select-row` → `onselectrow`. */
	function onselectrow(ev: TMethodsConfig['select-row']) {
		if (applyingExternalSelection) return;
		const id = ev?.id != null ? String(ev.id) : null;
		if (!id) return;
		appUi.focusRecord(id);
		selectedRows = [id];
	}

	/** Inline editor committed a cell → persist via server action, reload on failure. */
	async function onupdatecell(ev: TMethodsConfig['update-cell']) {
		const id = ev?.id != null ? String(ev.id) : '';
		const column = ev?.column != null ? String(ev.column) : '';
		if (!id || !column || !view) return;

		// None / cleared combo → '' so FormData + coerceScalar store DB null.
		const value = editorValueFromDb(ev.value);

		try {
			writePending = true;
			writeError = null;
			await postFormAction('updateCell', {
				table: view.table,
				id,
				field: column,
				value
			});
			await invalidateAll();
		} catch (err) {
			writeError = formatWriteError(err, 'Failed to save cell');
			await invalidateAll();
		} finally {
			writePending = false;
		}
	}

	/** Human-readable write failure (includes logical ActionResult status). */
	function formatWriteError(err: unknown, fallback: string): string {
		if (err instanceof ApiError) {
			const code = err.code !== 'action_failed' ? ` [${err.code}]` : '';
			return `${err.message}${code} (${err.status})`;
		}
		return err instanceof Error ? err.message : fallback;
	}

	/** Open the shared add-row modal. */
	function openAddRow() {
		if (!view || !canCreate) return;
		addError = null;
		writeError = null;
		addOpen = true;
	}

	/** Submit create via table form action. */
	async function submitAddRow(values: Record<string, string>) {
		if (!view || addSubmitting) return;
		try {
			addSubmitting = true;
			addError = null;
			writeError = null;
			const result = await postFormAction<{ id?: string }>('addRow', {
				table: view.table,
				...values
			});
			await invalidateAll();
			addOpen = false;
			if (result.id) appUi.focusRecord(result.id);
		} catch (err) {
			addError = formatWriteError(err, 'Failed to add row');
		} finally {
			addSubmitting = false;
		}
	}

	/** Delete the currently selected row after confirmation. */
	async function deleteSelected() {
		if (!view || selectedRows.length === 0) return;
		const id = selectedRows[0]!;
		const ok = confirm(`Delete ${id}?`);
		if (!ok) return;
		try {
			writePending = true;
			writeError = null;
			await postFormAction('deleteRow', { table: view.table, id });
			await invalidateAll();
		} catch (err) {
			writeError = formatWriteError(err, 'Failed to delete row');
		} finally {
			writePending = false;
		}
	}

	// Follow shared focus into another entity table (graph/map click → table view).
	// Only react to focusedId changes. Reading activeTable/tables via untrack so a
	// manual entity-switcher change cannot re-fire this and goto back to the stale focus table.
	$effect(() => {
		const focusedId = appUi.focusedId;
		if (focusedId === lastFollowedFocusId) return;
		lastFollowedFocusId = focusedId;

		const table = tableOfRecordId(focusedId);
		if (!table) return;

		const { current, known } = untrack(() => ({
			current: activeTable,
			known: tables.some((t) => t.name === table)
		}));
		if (!known || !current || table === current) return;
		switchTable(table);
	});

	// After rows load / focus changes, select + scroll the matching row.
	$effect(() => {
		const api = gridApi;
		const focusedId = appUi.focusedId;
		// Depend on view identity so switch completes before select
		const _view = view;
		void _view;
		if (!api || tableLoading) return;
		applyFocusToGrid(api, focusedId);
	});

	function rowCountLabel(v: TableViewModel | null): string {
		if (!v) return '';
		const n = v.data.length;
		return n === 1 ? '1 row' : `${n} rows`;
	}

	function tableLabel(name: string | null | undefined): string {
		if (!name) return 'table';
		return tables.find((t) => t.name === name)?.label ?? name;
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background/80 px-4 py-2"
	>
		{#if tables.length > 0}
			<Field.Field orientation="horizontal" class="max-w-sm min-w-48 flex-1 items-center gap-2">
				<Field.Label for="table-entity" class="shrink-0 text-xs font-medium text-muted-foreground">
					Entity
				</Field.Label>
				<NativeSelect.Root
					id="table-entity"
					class="w-full min-w-0"
					size="sm"
					value={activeTable ?? ''}
					onchange={onTableChange}
					disabled={tableLoading}
					aria-busy={tableLoading}
					aria-label="Select table entity"
				>
					{#each tables as t (t.name)}
						<NativeSelect.Option value={t.name}>{t.label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</Field.Field>
			{#if tableLoading}
				<span class="text-xs text-muted-foreground">
					Loading {tableLabel(pendingTable)}…
				</span>
			{:else if view}
				<span class="text-xs text-muted-foreground tabular-nums">{rowCountLabel(view)}</span>
			{/if}
		{:else}
			<span class="text-sm font-medium tracking-tight">Table</span>
		{/if}

		{#if view && roleCanEdit}
			<div class="ml-auto flex items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!canCreate}
					onclick={openAddRow}
				>
					<PlusIcon class="size-3.5" data-icon="inline-start" />
					Add row
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={!canDelete || selectedRows.length === 0 || writePending}
					onclick={deleteSelected}
				>
					<TrashIcon class="size-3.5" data-icon="inline-start" />
					Delete
				</Button>
			</div>
		{/if}
	</div>

	{#if writeError}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Write failed</Alert.Title>
				<Alert.Description>{writeError}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if error && !tableLoading}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Could not load table</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	<div class="relative min-h-0 flex-1 overflow-hidden p-2">
		{#if tableLoading}
			{#if view && hasRows}
				<!-- Keep previous grid visible under veil so switch feels instant -->
				<div
					class="pointer-events-none h-full min-h-0 w-full overflow-hidden rounded-none border border-border opacity-40"
					aria-hidden="true"
				>
					<Willow fonts={false}>
						<Grid data={gridData} columns={svarColumns} select={false} />
					</Willow>
				</div>
			{/if}
			<ViewLoadingOverlay label={`Loading ${tableLabel(pendingTable)}…`} />
		{:else if !view}
			<div
				class="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground"
			>
				{#if error}
					<p>Fix the issue above, then retry.</p>
				{:else if tables.length === 0}
					<p>No entities available. Connect a database with tables.</p>
				{:else}
					<p>Select an entity to browse rows.</p>
				{/if}
			</div>
		{:else if !hasRows}
			<div
				class="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground"
			>
				<p>No rows in <span class="font-medium text-foreground">{view.label}</span>.</p>
			</div>
		{:else}
			<!-- SVAR Grid needs a sized parent; Willow injects theme CSS variables -->
			<!-- key forces remount so init re-applies default sort marks per entity -->
			{#key view.table}
				<div class="h-full min-h-0 w-full overflow-hidden rounded-none border border-border">
					<Willow fonts={false}>
						<Grid
							data={gridData}
							columns={svarColumns}
							select={true}
							init={initGrid}
							{onselectrow}
							{onupdatecell}
						/>
					</Willow>
				</div>
			{/key}
		{/if}
	</div>

	<AddRowModal
		bind:open={addOpen}
		title={`Add row to ${tableLabel(activeTable)}`}
		fields={view?.columns ?? []}
		{recordOptions}
		submitting={addSubmitting}
		error={addError}
		onSubmit={submitAddRow}
	/>
</div>

<style>
	/* Ensure SVAR fills the flex area and scrolls internally */
	div :global(.wx-grid),
	div :global(.wx-table),
	div :global(.wx-willow-theme) {
		height: 100%;
		min-height: 0;
	}
</style>
