<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLElement> & { children?: Snippet } = $props();
</script>

<nav aria-label="breadcrumb" data-slot="breadcrumb" class={cn('', className)} {...restProps}>
	{@render children?.()}
</nav>
