<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		value = $bindable(''),
		class: className,
		children,
		...restProps
	}: TabsPrimitive.RootProps & { children?: Snippet } = $props();
</script>

<TabsPrimitive.Root
	bind:ref
	bind:value
	data-slot="tabs"
	class={cn('flex gap-2 group/tabs data-[orientation=horizontal]:flex-col', className)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.Root>
