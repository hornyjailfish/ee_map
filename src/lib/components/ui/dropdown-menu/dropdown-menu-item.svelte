<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.ItemProps> & { children?: Snippet } = $props();
</script>

<DropdownMenuPrimitive.Item
	bind:ref
	data-slot="dropdown-menu-item"
	class={cn(
		'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</DropdownMenuPrimitive.Item>
