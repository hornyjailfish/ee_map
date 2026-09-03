<script lang="ts">
	/**
	 * One mount per node/layout identity (parent `{#key structureKey}`).
	 * Wire persist is lazy: optimistic UI + server id swap, no invalidate on success.
	 */
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		Panel,
		addEdge,
		type Connection,
		type Edge
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { ApiError, postFormAction } from '$lib/client/http';
	import { applyNodeSelection } from '$lib/client/selection';
	import { nodeTypes } from '$lib/client/registries/nodes';
	import { edgeTypes } from '$lib/client/registries/edges';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import type { GraphEdge, GraphNode, GraphViewModel } from '$lib/transform/to-graph';
	import { graphEdgeSignature, toFlowEdges, toMeasureNodes } from './graph-flow';
	import GraphLayoutRunner from './GraphLayoutRunner.svelte';

	type Props = {
		graph: GraphViewModel;
		/** EDITOR / OWNER can drag new wires; VIEWER is blocked client + server. */
		canEdit?: boolean;
		/** Relation table for connect/disconnect actions. */
		relation?: string | null;
	};

	let { graph, canEdit = false, relation = null }: Props = $props();

	type Phase = 'measuring' | 'layouting' | 'ready';

	// Mount-time only — parent `{#key structureKey}` remounts on node/layout change (not wires).
	// svelte-ignore state_referenced_locally (intentional: capture initial measure snapshot)
	let nodes = $state.raw<GraphNode[]>(applyNodeSelection(toMeasureNodes(graph), appUi.focusedId));
	// svelte-ignore state_referenced_locally (intentional: capture initial measure snapshot)
	let edges = $state.raw<GraphEdge[]>(toFlowEdges(graph));
	let phase = $state<Phase>('measuring');
	let layoutError = $state<string | null>(null);
	let writeError = $state<string | null>(null);
	let writePending = $state(false);
	/** Bumped by the Layout button to re-run ELK with current leaf measured sizes. */
	let layoutRequest = $state(0);
	/** Last server edge set we applied (skip no-op / mount double-apply). */
	// svelte-ignore state_referenced_locally (intentional: baseline for this mount)
	let lastEdgeSig = graphEdgeSignature(graph);

	function onLayoutStart() {
		phase = 'layouting';
	}

	function onLayoutDone(result: { nodes: GraphNode[]; edges: GraphEdge[] }) {
		nodes = applyNodeSelection(result.nodes, appUi.focusedId);
		const stillPending = edges.filter((e) => e.id.startsWith('tmp:'));
		edges = stillPending.length ? [...result.edges, ...stillPending] : result.edges;
		phase = 'ready';
		layoutError = null;
	}

	/** Live graph for ELK — canvas edges are authoritative after lazy wire writes. */
	const layoutGraph = $derived.by((): GraphViewModel => ({
		nodes: graph.nodes,
		layout: graph.layout,
		edges: edges.filter((e) => !String(e.id).startsWith('tmp:'))
	}));

	function onLayoutError(message: string, fallback: { nodes: GraphNode[]; edges: GraphEdge[] }) {
		layoutError = message;
		nodes = applyNodeSelection(fallback.nodes, appUi.focusedId);
		edges = fallback.edges;
		phase = 'ready';
	}

	function requestLayout() {
		if (phase === 'layouting' || phase === 'measuring') return;
		layoutRequest += 1;
	}

	function onnodeclick({ node }: { node: GraphNode }) {
		appUi.focusRecord(node.id);
	}

	$effect(() => {
		const focused = appUi.focusedId;
		nodes = applyNodeSelection(nodes, focused);
	});

	/**
	 * When parent load data changes (navigate back / other invalidates), merge server
	 * edges without clobbering optimistic tmp wires. Does not run after lazy connect
	 * unless something else reloads `graph`.
	 */
	$effect(() => {
		const sig = graphEdgeSignature(graph);
		if (sig === lastEdgeSig) return;
		lastEdgeSig = sig;
		const serverEdges = toFlowEdges(graph);
		const pending = edges.filter((e) => e.id.startsWith('tmp:'));
		const serverPairs = new Set(serverEdges.map((e) => `${e.source}>${e.target}`));
		const keepTmp = pending.filter((e) => !serverPairs.has(`${e.source}>${e.target}`));
		// Prefer server ids; keep any local-only persisted edges (lazy connect not yet in load).
		const serverIds = new Set(serverEdges.map((e) => e.id));
		const localOnly = edges.filter(
			(e) => !e.id.startsWith('tmp:') && !serverIds.has(e.id) && !serverPairs.has(`${e.source}>${e.target}`)
		);
		edges = [...serverEdges, ...localOnly, ...keepTmp];
	});

	/** Surface ActionResult failures (type:failure) — not bare response.ok. */
	function formatWriteError(err: unknown, fallback: string): string {
		if (err instanceof ApiError) {
			const code = err.code !== 'action_failed' ? ` [${err.code}]` : '';
			return `${err.message}${code} (${err.status})`;
		}
		return err instanceof Error ? err.message : fallback;
	}

	/** Client pre-check: both endpoints must be wireable roles. Server still enforces. */
	function canWirePair(source: string, target: string): boolean {
		if (!canEdit || !relation) return false;
		if (source === target) return false;
		const src = nodes.find((n) => n.id === source);
		const tgt = nodes.find((n) => n.id === target);
		if (!src?.data?.canConnect || !tgt?.data?.canConnect) return false;
		// connects: breakers → breakers | rents(output)
		if (src.data.role !== 'breaker') return false;
		if (tgt.data.role !== 'breaker' && tgt.data.role !== 'output') return false;
		return true;
	}

	function isValidConnection(connection: Connection | Edge): boolean {
		const source = 'source' in connection ? connection.source : null;
		const target = 'target' in connection ? connection.target : null;
		if (!source || !target) return false;
		return canWirePair(source, target);
	}

	async function onconnect(connection: Connection) {
		// Defense in depth: VIEWER never reaches here with wireEnabled, but bail anyway.
		if (!canEdit || !relation) return;
		const source = connection.source;
		const target = connection.target;
		if (!source || !target) return;
		if (!canWirePair(source, target)) {
			writeError = 'Invalid connection endpoints';
			return;
		}

		const tmpId = `tmp:${source}->${target}:${Date.now()}`;
		edges = addEdge(
			{
				...connection,
				id: tmpId,
				data: { table: relation, role: 'feeds', pending: true }
			},
			edges
		);

		try {
			writePending = true;
			writeError = null;
			const result = await postFormAction<{ id?: string }>('connect', {
				relation,
				in: source,
				out: target
			});
			const realId = typeof result.id === 'string' && result.id ? result.id : null;
			if (!realId) {
				// Persist worked but no id — drop optimistic edge rather than keep a fake id.
				edges = edges.filter((e) => e.id !== tmpId);
				writeError = 'Connection saved but server returned no edge id';
				return;
			}
			// Promote tmp → real record id; leave camera alone (no invalidate).
			edges = edges.map((e) =>
				e.id === tmpId
					? {
							...e,
							id: realId,
							data: { table: relation, role: 'feeds' }
						}
					: e
			);
		} catch (err) {
			writeError = formatWriteError(err, 'Failed to save connection');
			edges = edges.filter((e) => e.id !== tmpId);
		} finally {
			writePending = false;
		}
	}

	async function ondelete({ nodes: _nodes, edges: deleted }: { nodes: GraphNode[]; edges: Edge[] }) {
		if (!canEdit || !relation || deleted.length === 0) return;

		const persisted = deleted.filter((e) => e.id && !String(e.id).startsWith('tmp:')) as GraphEdge[];
		if (persisted.length === 0) return;

		// SF already removed them from `edges`; keep a snapshot to restore on failure.
		const snapshot = persisted.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined }));

		try {
			writePending = true;
			writeError = null;
			for (const edge of persisted) {
				const edgeRelation =
					typeof edge.data?.table === 'string' ? edge.data.table : relation;
				await postFormAction('disconnect', {
					relation: edgeRelation,
					id: String(edge.id)
				});
			}
			// Success: stay lazy — load data catches up on next navigation.
		} catch (err) {
			writeError = formatWriteError(err, 'Failed to delete connection');
			const existing = new Set(edges.map((e) => e.id));
			const restore = snapshot.filter((e) => !existing.has(e.id));
			if (restore.length) edges = [...edges, ...restore];
		} finally {
			writePending = false;
		}
	}

	/** Topology-only: edges when editable; never delete nodes from the canvas. */
	async function onbeforedelete({
		nodes: delNodes,
		edges: delEdges
	}: {
		nodes: GraphNode[];
		edges: Edge[];
	}): Promise<boolean> {
		if (!canEdit || !relation) return false;
		if (delNodes.length > 0) return false;
		return delEdges.length > 0;
	}

	const busy = $derived(phase !== 'ready');
	const busyLabel = $derived(phase === 'layouting' ? 'Laying out graph…' : 'Measuring nodes…');
	const layoutDisabled = $derived(busy);
	const wireEnabled = $derived(canEdit && Boolean(relation));
</script>

<div class="graph-canvas relative h-full min-h-0 w-full">
	{#if busy}
		<div
			class="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]"
			role="status"
			aria-live="polite"
			aria-busy="true"
		>
			<Spinner class="size-4" />
			{busyLabel}
		</div>
	{/if}

	{#if layoutError}
		<div
			class="absolute top-2 right-2 left-2 z-20 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			Layout: {layoutError}
		</div>
	{/if}

	{#if writeError}
		<div
			class="absolute right-2 left-2 z-20 max-w-xl"
			class:top-2={!layoutError}
			class:top-14={Boolean(layoutError)}
			role="alert"
		>
			<Alert.Root variant="destructive" class="bg-background/95 shadow-sm backdrop-blur-sm">
				<CircleAlertIcon />
				<Alert.Title>Write failed</Alert.Title>
				<Alert.Description class="flex items-start justify-between gap-2">
					<span class="min-w-0 flex-1 break-words">{writeError}</span>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						class="h-auto shrink-0 px-1 py-0 text-xs"
						onclick={() => (writeError = null)}
					>
						Dismiss
					</Button>
				</Alert.Description>
			</Alert.Root>
		</div>
	{/if}

	{#if writePending}
		<div
			class="pointer-events-none absolute right-3 bottom-3 z-20 flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm"
			role="status"
			aria-live="polite"
		>
			<Spinner class="size-3" />
			Saving…
		</div>
	{/if}

	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{edgeTypes}
		minZoom={0.15}
		maxZoom={2}
		nodesDraggable={true}
		nodesConnectable={wireEnabled}
		elementsSelectable={true}
		deleteKey={wireEnabled ? ['Backspace', 'Delete'] : null}
		{isValidConnection}
		proOptions={{ hideAttribution: true }}
		{onnodeclick}
		{onconnect}
		{onbeforedelete}
		{ondelete}
		class="h-full w-full bg-background"
	>
		<GraphLayoutRunner
			graph={layoutGraph}
			{layoutRequest}
			{onLayoutStart}
			{onLayoutDone}
			{onLayoutError}
		/>

		<Panel position="top-right" class="m-2!">
			<Button
				type="button"
				size="sm"
				variant="outline"
				class="bg-background/95 shadow-sm backdrop-blur-sm"
				disabled={layoutDisabled}
				aria-busy={phase === 'layouting'}
				onclick={requestLayout}
			>
				{#if phase === 'layouting'}
					<Spinner class="size-3.5" data-icon="inline-start" />
				{:else}
					<NetworkIcon class="size-3.5" data-icon="inline-start" />
				{/if}
				Layout
			</Button>
		</Panel>

		<Background gap={18} size={1} />
		<Controls showLock={false} />
		<MiniMap pannable zoomable class="bg-card!" />
	</SvelteFlow>
</div>

<style>
	.graph-canvas :global(.svelte-flow) {
		height: 100%;
		width: 100%;
	}

	.graph-canvas :global(.svelte-flow__node) {
		font-family: inherit;
		width: auto;
		height: auto;
		padding: 0;
		border: none;
		background: transparent;
		box-shadow: none;
		overflow: visible;
	}

	.graph-canvas :global(.svelte-flow__node-room),
	.graph-canvas :global(.svelte-flow__node-board),
	.graph-canvas :global(.svelte-flow__node-group) {
		overflow: visible;
	}
</style>
