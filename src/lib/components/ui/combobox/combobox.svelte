<script lang="ts">
	import { Popover as PopoverPrimitive, Command as CommandPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { cn } from '$lib/utils.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	/** UI combobox option (string ids); map from SelectOption at call sites. */
	export type ComboboxOption = {
		id: string;
		/** Full text (closed trigger / grid cell via optionsMap). */
		label: string;
		/** When set, options are rendered under a Command group heading. */
		group?: string;
		/** Short list text when grouped (avoids repeating the group). */
		itemLabel?: string;
	};

	type OptionGroup = {
		key: string;
		label: string;
		options: ComboboxOption[];
	};

	type Props = Omit<HTMLButtonAttributes, 'type' | 'value'> & {
		options?: ComboboxOption[];
		value?: string;
		placeholder?: string;
		/** Controlled open state (inline editors bind this). */
		open?: boolean;
		onValueChange?: (value: string) => void;
		onOpenChange?: (open: boolean) => void;
	};

	let {
		options = [],
		value = $bindable(''),
		open = $bindable(false),
		placeholder = 'Select…',
		onValueChange,
		onOpenChange,
		disabled = false,
		id,
		class: className,
		...restProps
	}: Props = $props();

	function setOpen(next: boolean) {
		if (open === next) return;
		open = next;
		onOpenChange?.(next);
	}

	const selected = $derived(options.find((option) => option.id === value));
	/** Closed control shows the full cell-style label. */
	const selectedLabel = $derived(selected?.label ?? placeholder);

	/** Grouped list when any option carries `group`; otherwise a flat list. */
	const groups = $derived.by((): OptionGroup[] | null => {
		if (!options.some((o) => o.group && o.group.trim())) return null;

		const map = new Map<string, ComboboxOption[]>();
		const ungrouped: ComboboxOption[] = [];
		for (const option of options) {
			const g = option.group?.trim();
			if (!g) {
				ungrouped.push(option);
				continue;
			}
			let list = map.get(g);
			if (!list) {
				list = [];
				map.set(g, list);
			}
			list.push(option);
		}

		const out: OptionGroup[] = [...map.entries()].map(([key, opts]) => ({
			key,
			label: key,
			options: opts
		}));
		if (ungrouped.length) {
			out.push({ key: '__other__', label: 'Other', options: ungrouped });
		}
		return out;
	});

	function listText(option: ComboboxOption): string {
		return option.itemLabel?.trim() || option.label;
	}

	function selectOption(option: ComboboxOption) {
		value = option.id;
		// Notify parent before close so inline editors can mark committed first.
		onValueChange?.(option.id);
		setOpen(false);
	}
</script>

<PopoverPrimitive.Root bind:open onOpenChange={setOpen}>
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

				{#if groups}
					{#each groups as group (group.key)}
						<CommandPrimitive.Group value={group.key} class="overflow-hidden p-1">
							<div
								class="px-2 py-1.5 text-xs font-medium text-muted-foreground"
								aria-hidden="true"
							>
								{group.label}
							</div>
							{#each group.options as option (option.id)}
								{@const text = listText(option)}
								<CommandPrimitive.Item
									value={`${text} ${option.label} ${option.id}`}
									keywords={[text, option.label, option.group ?? '', option.id]}
									onSelect={() => selectOption(option)}
									class="group relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-selected:bg-muted data-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
								>
									<span class="truncate">{text}</span>
									{#if option.id === value}
										<CheckIcon class="ml-auto size-4 shrink-0 opacity-100" />
									{/if}
								</CommandPrimitive.Item>
							{/each}
						</CommandPrimitive.Group>
					{/each}
				{:else}
					{#each options as option (option.id)}
						{@const text = listText(option)}
						<CommandPrimitive.Item
							value={`${text} ${option.id}`}
							keywords={[text, option.label, option.id]}
							onSelect={() => selectOption(option)}
							class="group relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-selected:bg-muted data-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
						>
							<span class="truncate">{text}</span>
							{#if option.id === value}
								<CheckIcon class="ml-auto size-4 shrink-0 opacity-100" />
							{/if}
						</CommandPrimitive.Item>
					{/each}
				{/if}
			</CommandPrimitive.List>
		</CommandPrimitive.Root>
	</PopoverPrimitive.Content>
</PopoverPrimitive.Root>
