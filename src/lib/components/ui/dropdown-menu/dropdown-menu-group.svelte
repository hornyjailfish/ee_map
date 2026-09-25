<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import type { WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		children,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.GroupProps> & { children?: Snippet } = $props();
</script>

<DropdownMenuPrimitive.Group bind:ref data-slot="dropdown-menu-group" {...restProps}>
	{@render children?.()}
</DropdownMenuPrimitive.Group>
