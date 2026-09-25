<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.TriggerProps> & { children?: Snippet } = $props();
</script>

<DropdownMenuPrimitive.Trigger
	bind:ref
	data-slot="dropdown-menu-trigger"
	class={cn('', className)}
	{...restProps}
>
	{@render children?.()}
</DropdownMenuPrimitive.Trigger>
