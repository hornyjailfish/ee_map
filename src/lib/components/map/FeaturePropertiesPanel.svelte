<script lang="ts">
	/**
	 * Side overlay for the focused map feature's DB record.
	 * VIEWER: read-only properties with resolved FK labels.
	 * EDITOR: Edit mode uses the same form controls as table/graph.
	 *
	 * Overlay (not modal) so the map stays selectable while inspecting.
	 */
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		ensureEditorsRegistered,
		editorValueFromDb,
		isFormEditorField,
		resolveFieldEditor,
		type EditorOption
	} from '$lib/client/editors';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import FormFieldControl from '$lib/components/table/FormFieldControl.svelte';
	import type { TableColumn } from '$lib/transform/to-table';
	import {
		getMapFeatureRecord,
		type MapFeatureRecordDetail
	} from '../../../routes/map/feature.remote';

	ensureEditorsRegistered();

	type Props = {
		/** Focused record id (`table:key`). Null hides the panel. */
		recordId?: string | null;
		/** EDITOR/OWNER — show Edit when the table allows update. */
		canEdit?: boolean;
		submitting?: boolean;
		error?: string | null;
		onClose?: () => void;
		onSave?: (payload: {
			table: string;
			id: string;
			values: Record<string, string>;
		}) => void | Promise<void>;
	};

	let {
		recordId = null,
		canEdit = false,
		submitting = false,
		error = null,
		onClose,
		onSave
	}: Props = $props();

	let editing = $state(false);
	let values = $state<Record<string, string>>({});
	let fieldErrors = $state<Record<string, string>>({});

	const detailQuery = $derived(recordId ? getMapFeatureRecord({ id: recordId }) : null);
	const detail = $derived(
		detailQuery ? ((await detailQuery) as MapFeatureRecordDetail | null) : null
	);

	const formFields = $derived((detail?.editFields ?? []).filter((c) => isFormEditorField(c)));
	const canUpdate = $derived(Boolean(canEdit && detail?.canUpdate && formFields.length > 0));
	// Skip id + geometry in the list — map already shows shape; id is in the header.
	const viewFields = $derived(
		(detail?.fields ?? []).filter((f) => f.name !== 'id' && f.valueType !== 'geometry')
	);

	function optionsForColumn(d: MapFeatureRecordDetail, c: TableColumn): EditorOption[] | null {
		if (c.valueType !== 'record') return null;
		const opts = d.recordOptions[c.id];
		return opts && opts.length > 0 ? opts : null;
	}

	function seedFromDetail(d: MapFeatureRecordDetail) {
		const next: Record<string, string> = {};
		for (const c of d.editFields) {
			if (!isFormEditorField(c)) continue;
			const field = d.fields.find((f) => f.name === c.id);
			const editor = resolveFieldEditor(c, optionsForColumn(d, c), { allowEmptyOptions: true });
			next[c.id] = editorValueFromDb(field?.value ?? '', editor?.type);
		}
		values = next;
		fieldErrors = {};
	}

	function formEditorFor(c: TableColumn) {
		if (!detail) return null;
		return resolveFieldEditor(c, optionsForColumn(detail, c), { allowEmptyOptions: true });
	}

	function startEdit() {
		if (!detail || !canUpdate) return;
		seedFromDetail(detail);
		editing = true;
	}

	function cancelEdit() {
		if (detail) seedFromDetail(detail);
		editing = false;
	}

	function validate(): boolean {
		const next: Record<string, string> = {};
		for (const c of formFields) {
			if (c.optional === false && !values[c.id]?.trim()) {
				next[c.id] = 'Required';
			}
		}
		fieldErrors = next;
		return Object.keys(next).length === 0;
	}

	async function handleSave() {
		if (!detail || submitting || !canUpdate) return;
		if (!validate()) return;
		const payload: Record<string, string> = {};
		for (const c of formFields) {
			payload[c.id] = values[c.id]?.trim() ?? '';
		}
		await onSave?.({ table: detail.table, id: detail.id, values: payload });
		editing = false;
		try {
			await detailQuery?.refresh();
		} catch {
			// page invalidate still refreshes map chrome
		}
	}

	function displayText(value: string): string {
		const t = value.trim();
		return t.length > 0 ? t : '—';
	}
</script>

{#if recordId}
	<aside
		class="pointer-events-auto absolute top-2 right-2 z-30 flex max-h-[min(50vh,22rem)] w-[min(calc(100%-1rem),16.5rem)] flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-md backdrop-blur-sm"
		aria-label="Feature properties"
	>
		<header class="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
			<div class="min-w-0 flex-1">
				{#if detail}
					<p class="truncate text-xs leading-tight font-medium">{detail.title}</p>
					<div class="mt-0.5 flex min-w-0 items-center gap-1">
						<Badge variant="secondary" class="h-4 px-1.5 text-[10px]">{detail.tableLabel}</Badge>
						<span class="truncate font-mono text-[10px] text-muted-foreground">{detail.id}</span>
					</div>
				{:else}
					<p class="truncate text-xs font-medium">Record</p>
					<p class="truncate font-mono text-[10px] text-muted-foreground">{recordId}</p>
				{/if}
			</div>
			<div class="flex shrink-0 items-center">
				{#if canUpdate && detail && !editing}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-6"
						title="Edit properties"
						aria-label="Edit properties"
						disabled={submitting}
						onclick={startEdit}
					>
						<PencilIcon class="size-3" />
					</Button>
				{/if}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-6"
					title="Close"
					aria-label="Close properties"
					disabled={submitting}
					onclick={() => onClose?.()}
				>
					<XIcon class="size-3" />
				</Button>
			</div>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
			{#if !detail}
				<p class="py-2 text-center text-[11px] text-muted-foreground">
					{recordId ? 'Record not found or inaccessible' : 'No selection'}
				</p>
			{:else if editing && canUpdate}
				{#if formFields.length === 0}
					<p class="text-[11px] text-muted-foreground">No editable fields on this table.</p>
				{:else}
					<Field.Group class="gap-2">
						{#each formFields as c (c.id)}
							{@const editor = formEditorFor(c)}
							{@const invalid = Boolean(fieldErrors[c.id])}
							{#if editor}
								<Field.Field class="gap-1" data-invalid={invalid ? 'true' : undefined}>
									<Field.Label for={`map-prop-${c.id}`} class="text-[11px]">
										{c.header}
										{c.optional === false ? ' *' : ''}
									</Field.Label>
									<FormFieldControl
										id={`map-prop-${c.id}`}
										type={editor.type}
										valueType={c.valueType}
										value={values[c.id] ?? ''}
										options={editor.options ?? []}
										{invalid}
										disabled={submitting}
										onValueChange={(next) => {
											values = { ...values, [c.id]: next };
											if (fieldErrors[c.id]) fieldErrors = { ...fieldErrors, [c.id]: '' };
										}}
									/>
									{#if invalid}
										<Field.Error>{fieldErrors[c.id]}</Field.Error>
									{/if}
								</Field.Field>
							{/if}
						{/each}
					</Field.Group>
				{/if}
			{:else}
				<dl class="flex flex-col gap-0.5">
					{#each viewFields as f (f.name)}
						<div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0 py-0.5">
							<dt class="truncate text-[10px] text-muted-foreground">{f.label}</dt>
							<dd class="truncate text-xs text-foreground" title={displayText(f.display)}>
								{displayText(f.display)}
							</dd>
						</div>
					{:else}
						<p class="text-[11px] text-muted-foreground">No properties on this record.</p>
					{/each}
				</dl>
			{/if}
		</div>

		{#if error}
			<div class="shrink-0 border-t border-border px-2 py-1.5">
				<p class="text-[11px] text-destructive">{error}</p>
			</div>
		{/if}

		{#if editing && canUpdate}
			<footer class="flex shrink-0 items-center justify-end gap-1.5 border-t border-border px-2 py-1.5">
				<Button type="button" variant="outline" size="sm" class="h-7 px-2 text-xs" disabled={submitting} onclick={cancelEdit}
					>Cancel</Button
				>
				<Button type="button" size="sm" class="h-7 px-2 text-xs" disabled={submitting} onclick={handleSave}>
					{#if submitting}
						<Spinner class="size-3" data-icon="inline-start" />
					{/if}
					Save
				</Button>
			</footer>
		{/if}
	</aside>
{/if}
