<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLSpanElement> & { children?: Snippet } = $props();
</script>

<span
	role="link"
	aria-disabled="true"
	aria-current="page"
	data-slot="breadcrumb-page"
	class={cn('font-normal text-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</span>
