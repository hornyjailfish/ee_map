<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import type { Snippet } from 'svelte';
	import ScrollBar from './scroll-bar.svelte';

	type Props = WithoutChildrenOrChild<ScrollAreaPrimitive.RootProps> & {
		orientation?: 'horizontal' | 'vertical';
		children?: Snippet;
	};

	let {
		class: className,
		children,
		orientation = 'vertical',
		ref = $bindable(null),
		...restProps
	}: Props = $props();
</script>

<ScrollAreaPrimitive.Root
	data-slot="scroll-area"
	bind:ref
	class={cn('relative overflow-hidden', className)}
	{...restProps}
>
	<ScrollAreaPrimitive.Viewport
		data-slot="scroll-area-viewport"
		class="max-h-[inherit] w-full rounded-[inherit]"
	>
		{@render children?.()}
	</ScrollAreaPrimitive.Viewport>

	<ScrollBar orientation="vertical" />
	{#if orientation === 'horizontal'}
		<ScrollBar orientation="horizontal" />
	{/if}
	<ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
