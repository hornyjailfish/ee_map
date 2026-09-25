<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
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
	role="presentation"
	aria-hidden="true"
	data-slot="breadcrumb-separator"
	class={cn('[&>svg]:size-3.5', className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<ChevronRight />
	{/if}
</li>
