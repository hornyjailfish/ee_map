<script lang="ts">
	/**
	 * One mount per node/layout identity (parent `{#key structureKey}`).
	 * Wire persist is lazy: optimistic UI + server id swap, no invalidate on success.
	 * Edge Delete is topology-only; domain node delete goes through the node toolbar.
	 */
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		Panel,
		type Connection,
		type Edge
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { invalidateAll } from '$app/navigation';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { ApiError, postFormAction } from '$lib/client/http';
	import { applyNodeSelection } from '$lib/client/selection';
	import { nodeTypes } from '$lib/client/registries/nodes';
	import { edgeTypes } from '$lib/client/registries/edges';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import type { EditorOption } from '$lib/client/editors';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import AddRowModal from '$lib/components/table/AddRowModal.svelte';
	import type { GraphChildCreateSpec, GraphCrudMeta } from '$lib/transform/graph-crud';
	import type { TableColumn } from '$lib/transform/to-table';
	import type { GraphEdge, GraphNode, GraphViewModel } from '$lib/transform/to-graph';
	import { graphEdgeSignature, toFlowEdges, toMeasureNodes } from './graph-flow';
	import GraphLayoutRunner from './GraphLayoutRunner.svelte';
	import {
		setGraphNodeActions,
		type GraphNodeDeleteRef,
		type GraphNodeEditRef,
		type GraphNodeParentRef
	} from './graph-node-actions';
	import { setGraphNodeUi, type GraphNodeUiFlags } from './graph-node-ui';

	type Props = {
		graph: GraphViewModel;
		/** EDITOR / OWNER can drag new wires; VIEWER is blocked client + server. */
		canEdit?: boolean;
		/** Relation table for connect/disconnect actions. */
		relation?: string | null;
		/** Node create/delete gates from config + STRUCTURE. */
		crud?: GraphCrudMeta | null;
		/** Record-link picker options keyed by child table → field name. */
		recordOptionsByTable?: Record<string, Record<string, EditorOption[]>>;
	};

	let {
		graph,
		canEdit = false,
		relation = null,
		crud = null,
		recordOptionsByTable = {}
	}: Props = $props();

	const nodeUi = $derived({ canEdit, crud });

	type Phase = 'measuring' | 'layouting' | 'ready';

	/** Per-node UI overrides — survive ELK relayouts that rebuild nodes from `graph`. */
	let nodeUiFlags = $state<Record<string, GraphNodeUiFlags>>({});

	function applyNodeUiFlags(next: GraphNode[]): GraphNode[] {
		return next.map((n) => {
			const flags = nodeUiFlags[n.id];
			if (!flags) return n;
			return {
				...n,
				...(flags.selectable !== undefined ? { selectable: flags.selectable } : {}),
				...(flags.draggable !== undefined ? { draggable: flags.draggable } : {})
			};
		});
	}

	// Mount-time only — parent `{#key structureKey}` remounts on node/layout change (not wires).
	// svelte-ignore state_referenced_locally (intentional: capture initial measure snapshot)
	let nodes = $state.raw<GraphNode[]>(
		applyNodeUiFlags(
			applyNodeSelection(toMeasureNodes(graph, { canEdit, crud }), appUi.focusedId)
		)
	);
	// svelte-ignore state_referenced_locally (intentional: capture initial measure snapshot)
	let edges = $state.raw<GraphEdge[]>(toFlowEdges(graph));
	let phase = $state<Phase>('measuring');
	let layoutError = $state<string | null>(null);
	let writeError = $state<string | null>(null);
	let writePending = $state(false);
	/** Bumped to re-run ELK with current leaf measured sizes (full graph or subtree). */
	let layoutRequest = $state(0);
	/** Captured with the latest `layoutRequest` bump (root + fit). */
	let layoutRequestOpts = $state<{ rootId?: string | null; fit?: boolean } | null>(null);
	/** Last server edge set we applied (skip no-op / mount double-apply). */
	// svelte-ignore state_referenced_locally (intentional: baseline for this mount)
	let lastEdgeSig = graphEdgeSignature(graph);

	/** Add-child modal — same form as table AddRowModal. */
	let addOpen = $state(false);
	let addParent = $state<GraphNodeParentRef | null>(null);
	let addSpec = $state<GraphChildCreateSpec | null>(null);
	let addSubmitting = $state(false);
	let addError = $state<string | null>(null);

	const addInitialValues = $derived.by((): Record<string, string> => {
		if (!addSpec || !addParent) return {};
		return { [addSpec.parentField]: addParent.id };
	});
	const addLockedFields = $derived(addSpec ? [addSpec.parentField] : []);
	const addRecordOptions = $derived(
		addSpec ? (recordOptionsByTable[addSpec.childTable] ?? {}) : {}
	);
	const addTitle = $derived(
		addSpec ? `Add row to ${addSpec.childLabel}` : 'Add row'
	);
	const addDescription = $derived(
		addParent
			? `Under ${addParent.label}. Parent link is pre-filled.`
			: 'Fill required fields, then create the record.'
	);

	/** Edit-node modal — same form as table AddRowModal, pre-filled from node.values. */
	let editOpen = $state(false);
	let editTarget = $state<GraphNodeEditRef | null>(null);
	let editFields = $state<TableColumn[]>([]);
	let editRecordOptions = $state<Record<string, EditorOption[]>>({});
	let editInitialValues = $state<Record<string, string>>({});
	let editSubmitting = $state(false);
	let editError = $state<string | null>(null);

	const editTitle = $derived(editTarget ? `Edit ${editTarget.label}` : 'Edit node');
	const editDescription = $derived(
		editTarget ? `Update fields for ${editTarget.label}.` : 'Update the record fields.'
	);

	setGraphNodeActions({
		requestAddChild,
		requestEditNode,
		requestDeleteNode
	});

	setGraphNodeUi({
		setSelectable,
		setDraggable,
		layoutNode
	});

	function setSelectable(id: string, value: boolean) {
		nodeUiFlags[id] = { ...nodeUiFlags[id], selectable: value };
		nodes = nodes.map((n) => (n.id === id ? { ...n, selectable: value } : n));
	}

	function setDraggable(id: string, value: boolean) {
		nodeUiFlags[id] = { ...nodeUiFlags[id], draggable: value };
		nodes = nodes.map((n) => (n.id === id ? { ...n, draggable: value } : n));
	}

	function layoutNode(id: string) {
		requestLayout({ rootId: id, fit: false });
	}

	function requestAddChild(parent: GraphNodeParentRef) {
		if (!canEdit || !crud) return;
		const spec = crud.createByParentTable[parent.table];
		if (!spec?.canCreate) return;
		addParent = parent;
		addSpec = spec;
		addError = null;
		writeError = null;
		addOpen = true;
	}

	async function submitAddChild(values: Record<string, string>) {
		if (!addSpec || !addParent || addSubmitting) return;
		try {
			addSubmitting = true;
			addError = null;
			writeError = null;
			// Ensure parent FK is always present even if locked field was omitted.
			const payload: Record<string, string> = {
				...values,
				[addSpec.parentField]: addParent.id
			};
			const result = await postFormAction<{ id?: string }>('addNode', {
				table: addSpec.childTable,
				...payload
			});
			addOpen = false;
			await invalidateAll();
			if (result.id) appUi.focusRecord(result.id);
		} catch (err) {
			addError = formatWriteError(err, 'Failed to create node');
		} finally {
			addSubmitting = false;
		}
	}

	function requestEditNode(node: GraphNodeEditRef) {
		if (!canEdit || !crud) return;
		const fields = crud.editByTable[node.table];
		if (!fields?.length || !crud.updateByTable[node.table]) return;
		editTarget = node;
		editFields = fields;
		editRecordOptions = recordOptionsByTable[node.table] ?? {};
		editInitialValues = node.values ?? {};
		editError = null;
		writeError = null;
		editOpen = true;
	}

	async function submitEditNode(values: Record<string, string>) {
		if (!editTarget || editSubmitting) return;
		try {
			editSubmitting = true;
			editError = null;
			writeError = null;
			await postFormAction('editNode', {
				table: editTarget.table,
				id: editTarget.id,
				...values
			});
			editOpen = false;
			await invalidateAll();
		} catch (err) {
			editError = formatWriteError(err, 'Failed to update node');
		} finally {
			editSubmitting = false;
		}
	}

	async function requestDeleteNode(node: GraphNodeDeleteRef) {
		if (!canEdit || !crud?.deleteByTable[node.table] || writePending) return;
		if (!confirm(`Delete ${node.label} (${node.id})?`)) return;
		try {
			writePending = true;
			writeError = null;
			await postFormAction('deleteNode', { table: node.table, id: node.id });
			if (appUi.focusedId === node.id) appUi.focusRecord(null);
			await invalidateAll();
		} catch (err) {
			writeError = formatWriteError(err, 'Failed to delete node');
		} finally {
			writePending = false;
		}
	}

	function onLayoutStart() {
		phase = 'layouting';
	}

	function onLayoutDone(result: { nodes: GraphNode[]; edges?: GraphEdge[] }) {
		nodes = applyNodeUiFlags(applyNodeSelection(result.nodes, appUi.focusedId));
		if (result.edges) {
			const stillPending = edges.filter((e) => e.id.startsWith('tmp:'));
			edges = stillPending.length ? [...result.edges, ...stillPending] : result.edges;
		}
		phase = 'ready';
		layoutError = null;
	}

	/** Live graph for ELK — canvas edges are authoritative after lazy wire writes. */
	const layoutGraph = $derived.by((): GraphViewModel => ({
		nodes: graph.nodes,
		layout: graph.layout,
		edges: edges.filter((e) => !String(e.id).startsWith('tmp:'))
	}));

	function onLayoutError(message: string, fallback: { nodes: GraphNode[]; edges?: GraphEdge[] }) {
		layoutError = message;
		nodes = applyNodeUiFlags(applyNodeSelection(fallback.nodes, appUi.focusedId));
		if (fallback.edges) edges = fallback.edges;
		phase = 'ready';
	}

	function requestLayout(opts?: { rootId?: string | null; fit?: boolean }) {
		if (phase === 'layouting' || phase === 'measuring') return;
		layoutRequestOpts = opts ?? null;
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
			(e) =>
				!e.id.startsWith('tmp:') && !serverIds.has(e.id) && !serverPairs.has(`${e.source}>${e.target}`)
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

	/** Same source/target pair (handles optional). */
	function sameEndpoints(
		a: {
			source?: string | null;
			target?: string | null;
			sourceHandle?: string | null;
			targetHandle?: string | null;
		},
		b: {
			source?: string | null;
			target?: string | null;
			sourceHandle?: string | null;
			targetHandle?: string | null;
		}
	): boolean {
		return (
			a.source === b.source &&
			a.target === b.target &&
			(a.sourceHandle ?? null) === (b.sourceHandle ?? null) &&
			(a.targetHandle ?? null) === (b.targetHandle ?? null)
		);
	}

	/** Pending optimistic edge id (never a Surreal record id). */
	function makeTmpEdgeId(source: string, target: string): string {
		return `tmp:${source}->${target}:${Date.now()}`;
	}

	function isTmpEdgeId(id: string | undefined | null): boolean {
		return typeof id === 'string' && id.startsWith('tmp:');
	}

	/**
	 * SF adds the edge *before* onconnect (Handle → store.addEdge).
	 * Stamp a tmp id + relation metadata here so we never keep the default
	 * `xy-edge__…` id that fails relation delete validation.
	 */
	function onbeforeconnect(connection: Connection): GraphEdge | false {
		if (!canEdit || !relation) return false;
		const source = connection.source;
		const target = connection.target;
		if (!source || !target || !canWirePair(source, target)) return false;

		return {
			...connection,
			id: makeTmpEdgeId(source, target),
			data: { table: relation, role: 'feeds', pending: true }
		};
	}

	/** Find the edge SF just added (by tmp id or endpoints). */
	function findEdgeForConnection(connection: Connection): GraphEdge | undefined {
		const pending = edges.find((e) => isTmpEdgeId(e.id) && sameEndpoints(e, connection));
		if (pending) return pending;
		return edges.find((e) => sameEndpoints(e, connection));
	}

	/** Persist a newly drawn wire; promote tmp id → Surreal relation id. */
	async function onconnect(connection: Connection) {
		// Defense in depth: VIEWER never reaches here with wireEnabled, but bail anyway.
		if (!canEdit || !relation) return;
		const source = connection.source;
		const target = connection.target;
		if (!source || !target) return;
		if (!canWirePair(source, target)) {
			writeError = 'Invalid connection endpoints';
			edges = edges.filter((e) => !sameEndpoints(e, connection));
			return;
		}

		const local = findEdgeForConnection(connection);
		const tmpId = local?.id ?? makeTmpEdgeId(source, target);

		// Ensure the optimistic edge carries relation metadata even if SF path differed.
		edges = edges.map((e) =>
			sameEndpoints(e, connection)
				? {
						...e,
						id: isTmpEdgeId(e.id) ? e.id : tmpId,
						data: { table: relation, role: 'feeds', pending: true }
					}
				: e
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
				edges = edges.filter((e) => e.id !== tmpId && !sameEndpoints(e, connection));
				writeError = 'Connection saved but server returned no edge id';
				return;
			}
			// Promote tmp → real record id; leave camera alone (no invalidate).
			edges = edges.map((e) =>
				e.id === tmpId || (isTmpEdgeId(e.id) && sameEndpoints(e, connection))
					? {
							...e,
							id: realId,
							data: { table: relation, role: 'feeds' }
						}
					: e
			);
		} catch (err) {
			writeError = formatWriteError(err, 'Failed to save connection');
			edges = edges.filter((e) => e.id !== tmpId && !sameEndpoints(e, connection));
		} finally {
			writePending = false;
		}
	}

	/** Relation record id for disconnect — never send xy-edge / tmp ids to the server. */
	function relationEdgeId(edge: GraphEdge, fallbackRelation: string): string | null {
		const id = String(edge.id ?? '');
		if (!id || isTmpEdgeId(id)) return null;
		const colon = id.indexOf(':');
		if (colon <= 0) return null;
		const table = id.slice(0, colon);
		const expected =
			typeof edge.data?.table === 'string' && edge.data.table ? edge.data.table : fallbackRelation;
		return table === expected ? id : null;
	}

	async function ondelete({ edges: deleted }: { nodes: GraphNode[]; edges: Edge[] }) {
		if (!canEdit || !relation || deleted.length === 0) return;

		const edgeList = deleted as GraphEdge[];
		// SF already removed them from `edges`; snapshot for restore on failure.
		const snapshot = edgeList.map((e) => ({
			...e,
			data: e.data ? { ...e.data } : undefined
		}));

		try {
			writePending = true;
			writeError = null;

			for (const edge of edgeList) {
				if (isTmpEdgeId(edge.id)) continue;
				const edgeRelation =
					typeof edge.data?.table === 'string' && edge.data.table ? edge.data.table : relation;
				if (!edgeRelation) {
					throw new Error('No relation configured for edge delete');
				}
				const id = relationEdgeId(edge, edgeRelation);
				if (!id) {
					throw new Error(
						`Cannot delete edge '${edge.id}': missing Surreal relation id (draw may not have finished saving)`
					);
				}
				await postFormAction('disconnect', { relation: edgeRelation, id });
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

	/**
	 * Topology-only: Delete never removes domain nodes from the canvas.
	 * Shared focus marks nodes selected, so SF would otherwise include them —
	 * strip nodes and only honor explicitly selected edges.
	 */
	async function onbeforedelete({
		edges: delEdges
	}: {
		nodes: GraphNode[];
		edges: Edge[];
	}): Promise<boolean | { nodes: GraphNode[]; edges: Edge[] }> {
		if (!canEdit || !relation) return false;
		const edgesOnly = delEdges.filter((e) => e.selected);
		if (edgesOnly.length === 0) return false;
		return { nodes: [], edges: edgesOnly };
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
					<span class="min-w-0 flex-1 wrap-break-word">{writeError}</span>
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
		selectionOnDrag
		panOnDrag={[1]}
		onselectionchange={({nodes, edges})=>{if(nodes.length == 0) appUi.clearSelection(); if(nodes.length > 0) appUi.setSelected(nodes.map(n => n.id));}}
		selectNodesOnDrag={true}
		{onbeforeconnect}
		{onconnect}
		{onbeforedelete}
		{ondelete}
		class="h-full w-full bg-background"
	>
		<GraphLayoutRunner
			graph={layoutGraph}
			{nodeUi}
			{layoutRequest}
			{layoutRequestOpts}
			{onLayoutStart}
			{onLayoutDone}
			{onLayoutError}
		/>

		<Panel position="top-right" class="m-2!">
			<Button
				type="button"
				size="sm"
				variant="outline"
				class="bg-background/95 shadow-lg backdrop-blur-sm"
				disabled={layoutDisabled}
				aria-busy={phase === 'layouting'}
				onclick={() => requestLayout()}
			>
				{#if phase === 'layouting'}
					<Spinner class="size-3.5" data-icon="inline-start" />
				{:else}
					<NetworkIcon class="size-3.5" data-icon="inline-start" />
				{/if}
				Layout
			</Button>
		</Panel>

		<Background gap={28} size={4} />
					<Controls showLock={false} />
					<MiniMap pannable zoomable class="bg-accent!" />
	</SvelteFlow>

		<AddRowModal
					bind:open={addOpen}
					title={addTitle}
					description={addDescription}
					fields={addSpec?.fields ?? []}
					recordOptions={addRecordOptions}
					initialValues={addInitialValues}
					lockedFields={addLockedFields}
					submitting={addSubmitting}
					error={addError}
					onSubmit={submitAddChild}
				/>

			<AddRowModal
					bind:open={editOpen}
					title={editTitle}
					description={editDescription}
					fields={editFields}
					recordOptions={editRecordOptions}
					initialValues={editInitialValues}
					submitting={editSubmitting}
					error={editError}
					submitLabel="Save"
					errorTitle="Update failed"
					onSubmit={submitEditNode}
				/>
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
