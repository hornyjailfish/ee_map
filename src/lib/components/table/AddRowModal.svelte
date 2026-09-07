<script lang="ts">
	/**
	 * Shared add-row dialog (table page + graph node toolbar).
	 * Full field form via FormFieldControl; caller owns submit/persist.
	 */
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import {
		ensureEditorsRegistered,
		isFormEditorField,
		resolveFieldEditor,
		type EditorOption
	} from '$lib/client/editors';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import type { TableColumn } from '$lib/transform/to-table';
	import FormFieldControl from './FormFieldControl.svelte';

	ensureEditorsRegistered();

	type Props = {
		open?: boolean;
		/** Dialog title, e.g. "Add row to Boards". */
		title?: string;
		description?: string;
		/** Candidate columns; filtered with isFormEditorField. */
		fields?: TableColumn[];
		/** Record-link picker options by field id. */
		recordOptions?: Record<string, EditorOption[]>;
		/**
		 * Prefill values when the dialog opens (e.g. parent FK from graph).
		 * Applied when `open` becomes true.
		 */
		initialValues?: Record<string, string>;
		/** Field ids that cannot be edited (shown disabled). */
		lockedFields?: string[];
		submitting?: boolean;
		error?: string | null;
		/** Called with non-empty trimmed field values on Create. */
		onSubmit?: (values: Record<string, string>) => void | Promise<void>;
	};

	let {
		open = $bindable(false),
		title = 'Add row',
		description = 'Fill required fields, then create the record.',
		fields = [],
		recordOptions = {},
		initialValues = {},
		lockedFields = [],
		submitting = false,
		error = null,
		onSubmit
	}: Props = $props();

	let values = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});
	/** Track open edge so we only seed values when the dialog opens. */
	let wasOpen = false;

	const formFields = $derived(fields.filter((c) => isFormEditorField(c)));
	const locked = $derived(new Set(lockedFields));

	function seedValues() {
		const next: Record<string, string> = {};
		for (const c of formFields) {
			next[c.id] = initialValues[c.id] ?? '';
		}
		values = next;
		errors = {};
	}

	// Seed once per open (parent sets bind:open=true before first paint of fields).
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) seedValues();
		wasOpen = isOpen;
	});

	function optionsForColumn(c: TableColumn): EditorOption[] | null {
		if (c.valueType !== 'record') return null;
		const opts = recordOptions[c.id];
		return opts && opts.length > 0 ? opts : null;
	}

	function formEditorFor(c: TableColumn) {
		return resolveFieldEditor(c, optionsForColumn(c), { allowEmptyOptions: true });
	}

	function validate(): boolean {
		const next: Record<string, string> = {};
		for (const c of formFields) {
			if (c.optional === false && !values[c.id]?.trim()) {
				next[c.id] = 'Required';
			}
		}
		errors = next;
		return Object.keys(next).length === 0;
	}

	async function handleSubmit() {
		if (submitting) return;
		if (!validate()) return;
		const payload: Record<string, string> = {};
		for (const c of formFields) {
			const value = values[c.id]?.trim();
			if (value) payload[c.id] = value;
		}
		await onSubmit?.(payload);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

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
							<Field.Label for={`add-row-${c.id}`}>
								{c.header}
								{c.optional === false ? ' *' : ''}
							</Field.Label>
							<FormFieldControl
								id={`add-row-${c.id}`}
								type={editor.type}
								valueType={c.valueType}
								value={values[c.id] ?? ''}
								options={editor.options ?? []}
								{invalid}
								disabled={isLocked}
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

		{#if error}
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Create failed</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props}>Cancel</Button>
				{/snippet}
			</Dialog.Close>
			<Button type="button" disabled={submitting} onclick={handleSubmit}>
				{#if submitting}
					<Spinner class="size-3.5" data-icon="inline-start" />
				{/if}
				Create
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
