<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: HTMLAnchorAttributes & { children?: Snippet } = $props();
</script>

<a
	data-slot="breadcrumb-link"
	class={cn('transition-colors hover:text-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</a>
