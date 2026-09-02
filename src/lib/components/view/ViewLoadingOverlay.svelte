<script lang="ts">
	import { Spinner } from '$lib/components/ui/spinner/index.js';

	type Props = {
		label?: string;
		/** Dim existing content underneath instead of solid blank. */
		veil?: boolean;
		class?: string;
	};

	let { label = 'Loading…', veil = true, class: className = '' }: Props = $props();
</script>

<div
	class={[
		'absolute inset-0 z-20 flex items-center justify-center gap-2 text-sm text-muted-foreground',
		veil ? 'bg-background/70 backdrop-blur-[1px]' : 'bg-background',
		className
	]}
	role="status"
	aria-live="polite"
	aria-busy="true"
>
	<Spinner class="size-4" />
	<span>{label}</span>
</div>
