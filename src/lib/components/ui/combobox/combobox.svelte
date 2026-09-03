<script lang="ts">
	import { Popover as PopoverPrimitive, Command as CommandPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { cn } from '$lib/utils.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	export type ComboboxOption = {
		id: string;
		label: string;
	};

	type Props = Omit<HTMLButtonAttributes, 'type' | 'value'> & {
		options?: ComboboxOption[];
		value?: string;
		placeholder?: string;
		onValueChange?: (value: string) => void;
	};

	let {
		options = [],
		value = $bindable(''),
		placeholder = 'Select…',
		onValueChange,
		disabled = false,
		id,
		class: className,
		...restProps
	}: Props = $props();

	let open = $state(false);

	const selected = $derived(options.find((option) => option.id === value));
	const selectedLabel = $derived(selected?.label ?? placeholder);

	function selectOption(option: ComboboxOption) {
		value = option.id;
		open = false;
		onValueChange?.(option.id);
	}
</script>

<PopoverPrimitive.Root bind:open>
	<PopoverPrimitive.Trigger {disabled}>
		{#snippet child({ props })}
			<button
				{...props}
				{...restProps}
				{id}
				type="button"
				class={cn(
					'flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
					className
				)}
			>
				<span class={cn('truncate text-left', !selected && 'text-muted-foreground')}>
					{selectedLabel}
				</span>
				<ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" />
			</button>
		{/snippet}
	</PopoverPrimitive.Trigger>

	<PopoverPrimitive.Content
		sideOffset={4}
		align="start"
		class="z-50 w-(--bits-popover-anchor-width) origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden"
	>
		<CommandPrimitive.Root class="flex size-full flex-col overflow-hidden">
			<div class="flex items-center gap-2 border-b border-border px-2.5">
				<SearchIcon class="size-4 shrink-0 text-muted-foreground" />
				<CommandPrimitive.Input
					autofocus
					class="h-8 w-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					placeholder="Search…"
				/>
			</div>
			<CommandPrimitive.List class="max-h-64 overflow-x-hidden overflow-y-auto p-1">
				<CommandPrimitive.Empty class="py-6 text-center text-sm text-muted-foreground">
					No results found.
				</CommandPrimitive.Empty>
				{#each options as option (option.id)}
					<CommandPrimitive.Item
						value={option.id}
						keywords={[option.label]}
						onSelect={() => selectOption(option)}
						class="group relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-selected:bg-muted data-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
					>
						<span class="truncate">{option.label}</span>
						<CheckIcon class="ml-auto size-4 shrink-0 opacity-0 group-data-selected:opacity-100" />
					</CommandPrimitive.Item>
				{/each}
			</CommandPrimitive.List>
		</CommandPrimitive.Root>
	</PopoverPrimitive.Content>
</PopoverPrimitive.Root>