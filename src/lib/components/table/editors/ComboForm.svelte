<script lang="ts">
	/**
	 * Add-row / modal combo field (shadcn Combobox + optional groups).
	 */
	import { Combobox, type ComboboxOption } from '$lib/components/ui/combobox/index.js';
	import type { FormEditorProps } from '$lib/client/editors/registry';

	let {
		id,
		value = '',
		options = [],
		invalid = false,
		disabled = false,
		onValueChange
	}: FormEditorProps = $props();

	const comboOptions = $derived(
		options.map(
			(o): ComboboxOption => ({
				id: String(o.id),
				label: o.label,
				...(o.group ? { group: o.group } : {}),
				...(o.itemLabel ? { itemLabel: o.itemLabel } : {})
			})
		)
	);
</script>

<Combobox
	{id}
	options={comboOptions}
	{value}
	{disabled}
	onValueChange={(next) => onValueChange?.(next)}
	aria-invalid={invalid}
/>
