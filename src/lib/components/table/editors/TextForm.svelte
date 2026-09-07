<script lang="ts">
	/**
	 * Add-row / modal text field (shadcn Input).
	 * `valueType === 'number'` → native number input.
	 */
	import { Input } from '$lib/components/ui/input/index.js';
	import type { FormEditorProps } from '$lib/client/editors/registry';

	let {
		id,
		value = '',
		valueType,
		invalid = false,
		disabled = false,
		onValueChange
	}: FormEditorProps = $props();

	const inputType = $derived(valueType === 'number' ? 'number' : 'text');
</script>

<Input
	{id}
	type={inputType}
	{value}
	{disabled}
	oninput={(e) => onValueChange?.((e.currentTarget as HTMLInputElement).value)}
	aria-invalid={invalid}
/>
