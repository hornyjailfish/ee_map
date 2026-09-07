<script lang="ts">
	/**
	 * Add-row form control: looks up a registered form editor by type key.
	 * Register new types via `registerEditor(type, { form })` in client/editors.
	 */
	import { getFormEditor, type EditorOption } from '$lib/client/editors';

	type Props = {
		id: string;
		/** Resolved editor key (`text`, `combo`, …). */
		type: string;
		/** Field value type — only used for text input `type=` (number vs text). */
		valueType?: string;
		value?: string;
		options?: EditorOption[];
		invalid?: boolean;
		disabled?: boolean;
		onValueChange?: (value: string) => void;
	};

	let {
		id,
		type,
		valueType,
		value = '',
		options = [],
		invalid = false,
		disabled = false,
		onValueChange
	}: Props = $props();

	const Control = $derived(getFormEditor(type));
</script>

{#if Control}
	<Control {id} {valueType} {value} {options} {invalid} {disabled} {onValueChange} />
{/if}
