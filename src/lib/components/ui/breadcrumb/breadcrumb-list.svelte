<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLOListElement> & { children?: Snippet } = $props();
</script>

<ol
	data-slot="breadcrumb-list"
	class={cn(
		'flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground sm:gap-2.5',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</ol>
