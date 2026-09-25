<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import DropdownMenuPortal from './dropdown-menu-portal.svelte';
	import type { ComponentProps } from 'svelte';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = 'start',
		portalProps,
		children,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
		children?: Snippet;
	} = $props();
</script>

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.Content
		bind:ref
		data-slot="dropdown-menu-content"
		{sideOffset}
		{align}
		class={cn(
			'z-50 min-w-40 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</DropdownMenuPrimitive.Content>
</DropdownMenuPortal>
