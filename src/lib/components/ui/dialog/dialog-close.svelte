<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		type = 'button',
		child,
		children,
		...restProps
	}: DialogPrimitive.CloseProps & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
		children?: Snippet;
	} = $props();
</script>

{#if child}
	<DialogPrimitive.Close bind:ref data-slot="dialog-close" {type} {child} {...restProps} />
{:else}
	<DialogPrimitive.Close bind:ref data-slot="dialog-close" {type} {...restProps}>
		{@render children?.()}
	</DialogPrimitive.Close>
{/if}
