<script lang="ts">
	/**
	 * Side overlay for the focused map feature's DB record.
	 * VIEWER: read-only properties with resolved FK labels.
	 * EDITOR: Edit mode uses the same form controls as table/graph.
	 *
	 * Overlay (not modal) so the map stays selectable while inspecting.
	 */
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
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
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
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
		onAddView?: () => void | Promise<void>;
		onDelete?: () => void | Promise<void>;
		onSaveView?: (payload: { id: string; values: Record<string, string> }) => void | Promise<void>;
		/** Assign / clear / create inverse-related row (e.g. shop on rent). */
		onLinkRelated?: (payload: {
			featureId: string;
			relatedId?: string;
			createName?: string;
		}) => void | Promise<void>;
	};

	let {
		recordId = null,
		canEdit = false,
		submitting = false,
		error = null,
		onClose,
		onSave,
		onAddView,
		onDelete,
		onSaveView,
		onLinkRelated
	}: Props = $props();

	let editing = $state(false);
	let values = $state<Record<string, string>>({});
	let fieldErrors = $state<Record<string, string>>({});
	let editingViewId = $state<string | null>(null);
	let editingViewDescription = $state('');
	let imagePreviewOpen = $state(false);
	let imagePreviewSrc = $state<string | null>(null);
	let imagePreviewTitle = $state<string | null>(null);

	/** related link editor (shop ↔ rent): pick existing vs create new */
	let relatedEditing = $state(false);
	let relatedMode = $state<'existing' | 'create'>('existing');
	let relatedPickId = $state('');
	let relatedCreateName = $state('');
	let relatedError = $state<string | null>(null);

	// Close the preview whenever the panel itself is dismissed.
	$effect(() => {
		if (!recordId) {
			imagePreviewOpen = false;
			imagePreviewSrc = null;
			imagePreviewTitle = null;
		}
	});

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

	/** Markers can grow their linked `marker_views` list from the properties panel. */
	const canAddView = $derived(Boolean(canEdit && detail?.table === 'markers'));
	/** Marker removal (does not cascade to marker_views). */
	const canDelete = $derived(Boolean(canEdit && detail?.table === 'markers'));

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

	function viewUserDescription(view: MapFeatureRecordDetail): string {
		return view.fields.find((f) => f.name === 'user_description')?.value ?? '';
	}

	/**
	 * Marker views store a SurrealDB file reference (`images:<key>`) in
	 * `image_url`. Only render a preview for well-formed refs — the row is
	 * re-resolved server-side before anything is streamed back.
	 */
	function imageUrlFor(view: MapFeatureRecordDetail): string | null {
		const raw = view.fields.find((f) => f.name === 'image_url')?.value?.trim() ?? '';
		if (!raw) return null;
		if (raw.includes('..') || !/^images:[A-Za-z0-9_.\-/]+$/.test(raw)) return null;
		return `/map/marker-image?id=${encodeURIComponent(view.id)}`;
	}

	function openImagePreview(view: MapFeatureRecordDetail, src: string) {
		imagePreviewSrc = src;
		imagePreviewTitle = view.title;
		imagePreviewOpen = true;
	}

	function startViewEdit(view: MapFeatureRecordDetail) {
		editingViewId = view.id;
		editingViewDescription = viewUserDescription(view);
	}

	function cancelViewEdit() {
		editingViewId = null;
		editingViewDescription = '';
	}

	async function saveViewEdit(view: MapFeatureRecordDetail) {
		if (submitting) return;
		await onSaveView?.({
			id: view.id,
			values: { user_description: editingViewDescription.trim() }
		});
		editingViewId = null;
		editingViewDescription = '';
		try {
			await detailQuery?.refresh();
		} catch {
			// page invalidate still refreshes map chrome
		}
	}

	const related = $derived(detail?.related ?? null);
	const canEditRelated = $derived(Boolean(canEdit && related?.canLink && onLinkRelated));

	function startRelatedEdit() {
		if (!related || !canEditRelated) return;
		relatedEditing = true;
		relatedError = null;
		relatedPickId = related.id ?? '';
		relatedCreateName = '';
		relatedMode = related.canCreate && related.options.length === 0 ? 'create' : 'existing';
	}

	function cancelRelatedEdit() {
		relatedEditing = false;
		relatedError = null;
		relatedPickId = related?.id ?? '';
		relatedCreateName = '';
	}

	async function saveRelatedLink() {
		if (!detail || !related || !canEditRelated || submitting) return;
		relatedError = null;

		if (relatedMode === 'create') {
			if (!related.canCreate) {
				relatedError = 'Cannot create on this table';
				return;
			}
			const name = relatedCreateName.trim();
			if (!name) {
				relatedError = 'Name is required';
				return;
			}
			await onLinkRelated?.({ featureId: detail.id, createName: name });
		} else {
			await onLinkRelated?.({
				featureId: detail.id,
				relatedId: relatedPickId.trim()
			});
		}

		relatedEditing = false;
		try {
			await detailQuery?.refresh();
		} catch {
			// page invalidate still refreshes map chrome
		}
	}

	async function clearRelatedLink() {
		if (!detail || !related || !canEditRelated || submitting) return;
		relatedError = null;
		await onLinkRelated?.({ featureId: detail.id, relatedId: '' });
		relatedEditing = false;
		try {
			await detailQuery?.refresh();
		} catch {
			// ignore
		}
	}
</script>

{#if recordId}
	<div
		class="pointer-events-auto absolute top-2 right-2 z-30 flex max-h-[calc(100%-1rem)] w-[min(calc(100%-1rem),16.5rem)] flex-col gap-2 overflow-y-auto"
	>
		<aside
			class="flex max-h-[min(50vh,22rem)] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-md backdrop-blur-sm"
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
				<div class="flex shrink-0 items-center gap-0.5">
					{#if canUpdate && detail && !editing}
						<Button
							type="button"
							variant="outline"
							size="icon"
							class="size-6 rounded-full"
							title="Edit properties"
							aria-label="Edit properties"
							disabled={submitting}
							onclick={startEdit}
						>
							<PencilIcon class="size-3" />
						</Button>
					{/if}
					{#if canAddView && detail && !editing}
						<Button
							type="button"
							variant="outline"
							size="icon"
							class="size-6 rounded-full hover:bg-emerald-200/50 hover:text-emerald-500"
							title="Add marker view"
							aria-label="Add marker view"
							disabled={submitting}
							onclick={() => onAddView?.()}
						>
							<PlusIcon class="size-3" />
						</Button>
					{/if}
					{#if canDelete && detail && !editing}
						<Button
							type="button"
							variant="outline"
							size="icon"
							class="size-6 hover:bg-rose-200/50 hover:text-rose-500"
							title="Remove marker"
							aria-label="Remove marker"
							disabled={submitting}
							onclick={() => onDelete?.()}
						>
							<Trash2Icon class="size-3" />
						</Button>
					{/if}
					<Button
						type="button"
						variant="default"
						size="icon"
						class="size-6 rounded-full"
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
							<div
								class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0 py-0.5"
							>
								<dt class="truncate text-[10px] text-muted-foreground">{f.label}</dt>
								<dd class="truncate text-xs text-foreground" title={displayText(f.display)}>
									{displayText(f.display)}
								</dd>
							</div>
						{:else}
							{#if !related}
								<p class="text-[11px] text-muted-foreground">No properties on this record.</p>
							{/if}
						{/each}
					</dl>

					{#if related}
						<div class="mt-2 border-t border-border pt-1.5">
							<div class="mb-1 flex items-center justify-between gap-1">
								<p class="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
									{related.tableLabel}
								</p>
								{#if canEditRelated && !relatedEditing && !editing}
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class="size-5"
										title={`Edit ${related.tableLabel}`}
										aria-label={`Edit ${related.tableLabel}`}
										disabled={submitting}
										onclick={startRelatedEdit}
									>
										<PencilIcon class="size-3" />
									</Button>
								{/if}
							</div>

							{#if relatedEditing && canEditRelated}
								<div class="flex flex-col gap-1.5">
									{#if related.canCreate}
										<div class="flex gap-1">
											<Button
												type="button"
												variant={relatedMode === 'existing' ? 'default' : 'outline'}
												size="sm"
												class="h-6 flex-1 px-1 text-[10px]"
												disabled={submitting}
												onclick={() => (relatedMode = 'existing')}>Existing</Button
											>
											<Button
												type="button"
												variant={relatedMode === 'create' ? 'default' : 'outline'}
												size="sm"
												class="h-6 flex-1 px-1 text-[10px]"
												disabled={submitting}
												onclick={() => (relatedMode = 'create')}>New</Button
											>
										</div>
									{/if}

									{#if relatedMode === 'create' && related.canCreate}
										<Field.Field class="gap-1">
											<Field.Label for="map-related-name" class="text-[11px]">Name</Field.Label>
											<FormFieldControl
												id="map-related-name"
												type="text"
												valueType="string"
												value={relatedCreateName}
												disabled={submitting}
												onValueChange={(next) => {
													relatedCreateName = next;
													relatedError = null;
												}}
											/>
										</Field.Field>
									{:else}
										<Field.Field class="gap-1">
											<Field.Label for="map-related-pick" class="text-[11px]"
												>Select {related.tableLabel}</Field.Label
											>
											<FormFieldControl
												id="map-related-pick"
												type="combo"
												valueType="record"
												value={relatedPickId}
												options={related.options}
												disabled={submitting}
												onValueChange={(next) => {
													relatedPickId = next;
													relatedError = null;
												}}
											/>
										</Field.Field>
									{/if}

									{#if relatedError}
										<p class="text-[11px] text-destructive">{relatedError}</p>
									{/if}

									<div class="flex flex-wrap items-center justify-end gap-1">
										{#if related.id}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class="mr-auto h-7 px-2 text-xs text-muted-foreground"
												disabled={submitting}
												onclick={clearRelatedLink}>Clear</Button
											>
										{/if}
										<Button
											type="button"
											variant="outline"
											size="sm"
											class="h-7 px-2 text-xs"
											disabled={submitting}
											onclick={cancelRelatedEdit}>Cancel</Button
										>
										<Button
											type="button"
											size="sm"
											class="h-7 px-2 text-xs"
											disabled={submitting}
											onclick={saveRelatedLink}
										>
											{#if submitting}
												<Spinner class="size-3" data-icon="inline-start" />
											{/if}
											Save
										</Button>
									</div>
								</div>
							{:else}
								<dl class="flex flex-col gap-0.5">
									<div
										class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0 py-0.5"
									>
										<dt class="truncate text-[10px] text-muted-foreground">{related.labelFieldLabel}</dt>
										<dd
											class="truncate text-xs text-foreground"
											title={related.title ?? undefined}
										>
											{related.title?.trim() ? related.title : 'Vacant'}
										</dd>
									</div>
									{#if related.id}
										<div
											class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0 py-0.5"
										>
											<dt class="truncate text-[10px] text-muted-foreground">{related.idLabel}</dt>
											<dd class="truncate font-mono text-[10px] text-muted-foreground">
												{related.id}
											</dd>
										</div>
									{/if}
								</dl>
							{/if}
						</div>
					{/if}
				{/if}
			</div>

			{#if error}
				<div class="shrink-0 border-t border-border px-2 py-1.5">
					<p class="text-[11px] text-destructive">{error}</p>
				</div>
			{/if}

			{#if editing && canUpdate}
				<footer
					class="flex shrink-0 items-center justify-end gap-1.5 border-t border-border px-2 py-1.5"
				>
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="h-7 px-2 text-xs"
						disabled={submitting}
						onclick={cancelEdit}>Cancel</Button
					>
					<Button
						type="button"
						size="sm"
						class="h-7 px-2 text-xs"
						disabled={submitting}
						onclick={handleSave}
					>
						{#if submitting}
							<Spinner class="size-3" data-icon="inline-start" />
						{/if}
						Save
					</Button>
				</footer>
			{/if}
		</aside>

		{#each detail?.markerViews ?? [] as view (view.id)}
			{@const isEditing = editingViewId === view.id}
			{@const imageUrl = imageUrlFor(view)}
			<aside
				class="flex max-h-[min(40vh,16rem)] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-md backdrop-blur-sm"
				aria-label="Associated marker view"
			>
				<header class="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
					<div class="min-w-0 flex-1">
						<p class="truncate text-xs leading-tight font-medium">{view.title}</p>
						<div class="mt-0.5 flex min-w-0 items-center gap-1">
							<Badge variant="secondary" class="h-4 px-1.5 text-[10px]">{view.tableLabel}</Badge>
							<span class="truncate font-mono text-[10px] text-muted-foreground">{view.id}</span>
						</div>
					</div>
					{#if canEdit && !isEditing}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="size-6"
							title="Edit view"
							aria-label="Edit view"
							disabled={submitting}
							onclick={() => startViewEdit(view)}
						>
							<PencilIcon class="size-3" />
						</Button>
					{/if}
				</header>

				{#if isEditing}
					<div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
						<Field.Field class="gap-1">
							<Field.Label for={`map-view-desc-${view.id}`} class="text-[11px]">
								User description
							</Field.Label>
							<Textarea
								id={`map-view-desc-${view.id}`}
								bind:value={editingViewDescription}
								rows={3}
								disabled={submitting}
								autocomplete="off"
							/>
						</Field.Field>
					</div>
					<footer
						class="flex shrink-0 items-center justify-end gap-1.5 border-t border-border px-2 py-1.5"
					>
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="h-7 px-2 text-xs"
							disabled={submitting}
							onclick={cancelViewEdit}>Cancel</Button
						>
						<Button
							type="button"
							size="sm"
							class="h-7 px-2 text-xs"
							disabled={submitting}
							onclick={() => saveViewEdit(view)}
						>
							{#if submitting}
								<Spinner class="size-3" data-icon="inline-start" />
							{/if}
							Save
						</Button>
					</footer>
				{:else}
					<div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
						<dl class="flex flex-col gap-0.5">
							{#each view.fields.filter((f) => f.name !== 'id' && f.name !== 'image_url') as f (f.name)}
								<div
									class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0 py-0.5"
								>
									<dt class="truncate text-[10px] text-muted-foreground">{f.label}</dt>
									<dd class="truncate text-xs text-foreground" title={displayText(f.display)}>
										{displayText(f.display)}
									</dd>
								</div>
							{:else}
								{#if !imageUrl}
									<p class="text-[11px] text-muted-foreground">No properties on this record.</p>
								{/if}
							{/each}
						</dl>

						{#if imageUrl}
							<button
								type="button"
								class="mt-1.5 block w-full overflow-hidden rounded-md border border-border bg-muted/40 transition hover:opacity-90"
								title="Open image"
								aria-label={`Open image for ${view.title}`}
								onclick={() => openImagePreview(view, imageUrl)}
							>
								<img
									src={imageUrl}
									alt={view.title}
									loading="lazy"
									class="aspect-video w-full object-cover"
									onerror={(event) => {
										(event.currentTarget as HTMLImageElement).style.display = 'none';
									}}
								/>
							</button>
						{/if}
					</div>
				{/if}
			</aside>
		{/each}
	</div>
{/if}

<Dialog.Root bind:open={imagePreviewOpen}>
	<Dialog.Content
		class="max-h-[90vh] w-auto max-w-[min(92vw,64rem)] p-1 sm:max-w-[min(92vw,64rem)]"
	>
		{#if imagePreviewSrc}
			<img
				src={imagePreviewSrc}
				alt={imagePreviewTitle ?? 'Marker image'}
				class="block max-h-[85vh] max-w-[min(88vw,62rem)] rounded-md object-contain"
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
