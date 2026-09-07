<script lang="ts">
	import { browser } from '$app/environment';
	import type { Component } from 'svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import ViewLoadingOverlay from '$lib/components/view/ViewLoadingOverlay.svelte';
	import GraphView from '$lib/components/graph/GraphView.svelte';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import type { AppRole } from '$lib/catalog-types';
	import { canEdit } from '$lib/roles';
	import type { GraphViewModel } from '$lib/transform/to-graph';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const graph = $derived(data.graph);
	const error = $derived(data.error);
	const relation = $derived(data.relation);
	const crud = $derived(data.crud);
	const recordOptionsByTable = $derived(data.recordOptionsByTable ?? {});
	const nodeCount = $derived(graph?.nodes.length ?? 0);
	const edgeCount = $derived(graph?.edges.length ?? 0);
	const userRoles = $derived((data.userRoles ?? []) as AppRole[]);
	/** EDITOR and OWNER both edit wires/nodes; VIEWER is read-only. */
	const roleCanEdit = $derived(canEdit(userRoles));

	type GraphViewProps = {
		graph: GraphViewModel;
		canEdit?: boolean;
		relation?: string | null;
		crud?: typeof crud;
		recordOptionsByTable?: typeof recordOptionsByTable;
	};
	// let GraphView = $state<Component<GraphViewProps> | null>(null);

	// if (browser) {
	// 	void import('$lib/components/graph/GraphView.svelte').then((m) => {
	// 		GraphView = m.default;
	// 	});
	// }
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div
		class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background/80 px-4 py-2"
	>
		<span class="text-sm font-medium tracking-tight">Graph</span>
		{#if graph}
			<span class="text-xs text-muted-foreground tabular-nums">
				{nodeCount}
				{nodeCount === 1 ? 'node' : 'nodes'}
				· {edgeCount}
				{edgeCount === 1 ? 'edge' : 'edges'}
			</span>
		{/if}
		{#if roleCanEdit && relation}
			<span class="text-xs text-muted-foreground">· edit wires</span>
		{/if}
	</div>

	{#if error}
		<div class="shrink-0 px-4 pt-3">
			<Alert.Root variant="destructive">
				<CircleAlertIcon />
				<Alert.Title>Graph load issue</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	<div class="relative min-h-0 flex-1 overflow-hidden">
		{#if !graph}
			<div
				class="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground"
			>
				{#if error}
					<p>Fix the issue above, then retry.</p>
				{:else}
					<p>No graph data available. Connect a database with graph-enabled tables.</p>
				{/if}
			</div>
		{:else if nodeCount === 0}
			<div
				class="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground"
			>
				<p>No nodes to display. Check entity rows and graph roles in config.</p>
			</div>
		{:else if browser && GraphView}
			<GraphView {graph} canEdit={roleCanEdit} {relation} {crud} {recordOptionsByTable} />
		{:else}
			<ViewLoadingOverlay label="Loading graph canvas…" veil={false} />
		{/if}
	</div>
</div>
