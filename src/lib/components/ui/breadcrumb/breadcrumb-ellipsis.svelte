<script lang="ts">
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import { cn } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let { class: className, ...restProps }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
	role="presentation"
	aria-hidden="true"
	data-slot="breadcrumb-ellipsis"
	class={cn('flex size-9 items-center justify-center', className)}
	{...restProps}
>
	<MoreHorizontal class="size-4" />
	<span class="sr-only">More</span>
</span>
