<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLLIElement> & { children?: Snippet } = $props();
</script>

<li
	data-slot="breadcrumb-item"
	class={cn('inline-flex items-center gap-1.5', className)}
	{...restProps}
>
	{@render children?.()}
</li>
