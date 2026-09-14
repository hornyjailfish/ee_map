<script lang="ts">
	/**
	 * SVAR inline combo: keep cell value visible, float a search list via Popover.
	 * Anchored to the parent `.wx-editor` with `customAnchor` — no Trigger in the cell
	 * (a trigger replaces the cell and fights SVAR close-editor / focus).
	 */
	import { untrack } from 'svelte';
	import { Command as CommandPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { comboboxCommandFilter } from '$lib/client/combobox-filter';
	import type { InlineEditorProps } from '$lib/client/editors/registry';
	import type { ComboboxOption } from '$lib/components/ui/combobox/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';

	let { editor, onsave, onapply, oncancel }: InlineEditorProps = $props();

	// Grid mounts a fresh editor per cell open — seed once from the opening value.
	let value = $state(untrack(() => (editor.value == null ? '' : String(editor.value))));
	let open = $state(true);
	let committed = false;
	/** SVAR `.wx-editor` cell — positioning target for the floating list. */
	let anchor = $state<HTMLElement | null>(null);

	const options = $derived(
		(editor.options ?? []).map((o): ComboboxOption => {
			const group = (o as { group?: string }).group;
			const itemLabel = (o as { itemLabel?: string }).itemLabel;
			return {
				id: String(o.id),
				label: o.label,
				...(group ? { group } : {}),
				...(itemLabel ? { itemLabel } : {})
			};
		})
	);

	const displayLabel = $derived(
		options.find((o) => o.id === value)?.label ??
			(editor.renderedValue != null ? String(editor.renderedValue) : value)
	);

	type OptionGroup = { key: string; label: string; options: ComboboxOption[] };

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

	function handleChange(next: string) {
		committed = true;
		value = next;
		onapply?.(next);
		onsave?.(false);
		open = false;
	}

	function setOpen(next: boolean) {
		if (open === next) return;
		open = next;
		// Dismiss without a selection → cancel SVAR editor (don't re-focus a trigger).
		if (!next && !committed) oncancel?.();
	}

	function selectOption(option: ComboboxOption) {
		handleChange(option.id);
	}

	/** Resolve SVAR editor cell as the floating anchor (not a local trigger). */
	function bindValueEl(node: HTMLElement) {
		const cell = node.closest('.wx-editor');
		anchor = cell instanceof HTMLElement ? cell : node;
	}
</script>

<!--
  Plain cell text only. SVAR owns the .wx-editor chrome; we must not mount a
  Popover.Trigger here or it becomes the close-focus target and eats the cell.
-->
<div use:bindValueEl class="flex h-full w-full min-w-0 items-center overflow-hidden px-2 text-sm">
	<span class="truncate">{displayLabel}</span>
</div>

{#if anchor}
	<Popover.Root bind:open onOpenChange={setOpen}>
		<Popover.Content
			customAnchor={anchor}
			side="bottom"
			align="start"
			sideOffset={2}
			trapFocus={true}
			class="w-(--bits-popover-anchor-width) min-w-48 gap-0 p-1"
			onCloseAutoFocus={(e) => {
				// Don't bounce focus back into a missing/replaced trigger.
				e.preventDefault();
			}}
			onInteractOutside={(e) => {
				// Clicks on the editing cell itself shouldn't dismiss mid-interaction.
				const t = e.target;
				if (t instanceof Node && anchor?.contains(t)) e.preventDefault();
			}}
		>
			<CommandPrimitive.Root
				class="flex w-full flex-col overflow-hidden"
				filter={comboboxCommandFilter}
			>
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
								<div class="px-2 py-1.5 text-sm font-bold text-muted-foreground" aria-hidden="true">
									{group.label}
								</div>
								{#each group.options as option (option.id)}
									{@const text = listText(option)}
									<!-- value = id (unique); keywords = names only (ranked above id). -->
									<CommandPrimitive.Item
										value={option.id}
										keywords={[text, option.label, option.group ?? '']}
										onSelect={() => selectOption(option)}
										class="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-selected:bg-muted data-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
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
								value={option.id}
								keywords={[text, option.label]}
								onSelect={() => selectOption(option)}
								class="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-selected:bg-muted data-selected:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
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
		</Popover.Content>
	</Popover.Root>
{/if}
