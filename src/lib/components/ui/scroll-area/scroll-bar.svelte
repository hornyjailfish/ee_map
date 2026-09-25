<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		orientation = 'vertical',
		ref = $bindable(null),
		class: className,
		...restProps
	}: ScrollAreaPrimitive.ScrollbarProps = $props();
</script>

<ScrollAreaPrimitive.Scrollbar
	bind:ref
	{orientation}
	data-slot="scroll-area-scrollbar"
	class={cn(
		'flex touch-none p-px transition-colors select-none',
		orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
		orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
		className
	)}
	{...restProps}
>
	<ScrollAreaPrimitive.Thumb
		data-slot="scroll-area-thumb"
		class="relative flex-1 rounded-full bg-border"
	/>
</ScrollAreaPrimitive.Scrollbar>
