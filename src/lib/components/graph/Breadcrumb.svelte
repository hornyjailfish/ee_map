<script lang="ts">
	import { useNodes, useOnSelectionChange, useSvelteFlow } from '@xyflow/svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';
	import * as Dropdown from '$lib/components/ui/dropdown-menu';
	import * as ScrollArea from '$lib/components/ui/scroll-area';
	import { cn } from '$lib/utils.js';
	import { naturalCompare } from '$lib/transform/compare';
	import type { BreadcrumbLevel, GraphNode } from '$lib/transform/to-graph';
	import { CrumbBuilder } from './breadcrumb-controller.svelte';

	type Props = {
		/** Ordered breadcrumb levels from resolved graph config. */
		levels: BreadcrumbLevel[];
	};

	let { levels }: Props = $props();

	const { updateNode, fitView, getNode } = useSvelteFlow();
	const nodeStore = useNodes();
	// svelte-ignore state_referenced_locally (levels are static for this canvas mount)
	const cb = new CrumbBuilder(levels);

	// Keep the controller's node + selection inputs in sync with the flow.
	$effect(() => {
		cb.all = nodeStore.current as GraphNode[];
	});

	useOnSelectionChange(({ nodes }) => {
		cb.selection = nodes as GraphNode[];
	});

	/** Focus a single trail node: select it and fit the viewport to it. */
	function selectNode(node: GraphNode) {
		for (const n of nodeStore.current) {
			if (n.id !== node.id && n.selected) updateNode(n.id, { selected: false });
		}
		updateNode(node.id, { selected: true, hidden: false });
		void fitView({ nodes: [node], duration: 350 });
	}

	/** Group sibling nodes by parentId so dropdowns read as "child under parent". */
	type CrumbGroup = {
		parentId?: string;
		label: string | null;
		nodes: GraphNode[];
	};

	/**
	 * Natural-sort a level's nodes, group by parent, then sort groups by their
	 * parent label (Q1 < Q2 < Q10 …). Preserves sorted order within each group.
	 */
	function prepareGroups(items: GraphNode[]): CrumbGroup[] {
		const sorted = [...items].sort((a, b) => {
			const byLabel = naturalCompare(a.data.label ?? '', b.data.label ?? '');
			return byLabel !== 0 ? byLabel : naturalCompare(a.id, b.id);
		});

		const order: CrumbGroup[] = [];
		const index = new Map<string, CrumbGroup>();
		for (const node of sorted) {
			const key = node.parentId ?? '__root__';
			let group = index.get(key);
			if (!group) {
				group = { parentId: node.parentId, label: null, nodes: [] };
				index.set(key, group);
				order.push(group);
			}
			group.nodes.push(node);
		}

		for (const group of order) group.label = parentLabel(group.parentId);
		order.sort((a, b) => naturalCompare(a.label ?? '', b.label ?? ''));
		return order;
	}

	function parentLabel(parentId: string | undefined): string | null {
		if (!parentId) return null;
		const parent = getNode(parentId) as GraphNode | undefined;
		return parent?.data.label ?? parentId;
	}
</script>

<Breadcrumb.Root>
	<Breadcrumb.List>
		{#each cb.filter_grouped as items, idx}
			{#if items.length > 0}
				<Breadcrumb.Item>
					{#if items.length === 1}
						<button
							type="button"
							class={cn('cursor-pointer text-foreground', cb.italics[idx] && 'italic')}
							onclick={() => selectNode(items[0])}
						>
							{cb.titles[idx]}
						</button>
					{:else}
						{@const groups = prepareGroups(items)}
						<Dropdown.Root>
							<Dropdown.Trigger
								class="flex cursor-pointer flex-row items-center gap-0.5 text-foreground"
							>
								<span class={cn(cb.italics[idx] && 'italic')}>{cb.titles[idx]}</span>
								<ChevronDown class="size-3.5 text-muted-foreground" />
							</Dropdown.Trigger>
							<Dropdown.Content>
								<ScrollArea.Root class="max-h-96 w-full">
									{#each groups as group, gi}
										<Dropdown.Group>
											{#if group.label}
												<Dropdown.Label>{group.label}</Dropdown.Label>
											{/if}
											{#each group.nodes as node}
												<Dropdown.Item class="pl-4" onSelect={() => selectNode(node)}>
													{node.data.label}
												</Dropdown.Item>
											{/each}
											{#if gi !== groups.length - 1}
												<Dropdown.Separator />
											{/if}
										</Dropdown.Group>
									{/each}
								</ScrollArea.Root>
							</Dropdown.Content>
						</Dropdown.Root>
					{/if}
				</Breadcrumb.Item>

				{#if idx !== cb.filter_grouped.length - 1}
					<Breadcrumb.Separator />
				{/if}
			{/if}
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
