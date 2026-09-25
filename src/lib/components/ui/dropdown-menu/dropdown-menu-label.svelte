<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.GroupHeadingProps> & {
		children?: Snippet;
	} = $props();
</script>

<DropdownMenuPrimitive.GroupHeading
	bind:ref
	data-slot="dropdown-menu-label"
	class={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</DropdownMenuPrimitive.GroupHeading>
