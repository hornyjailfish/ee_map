<script lang="ts">
	/**
	 * Graph canvas host.
	 * Remount only when nodes/layout change — edge wire edits keep the camera.
	 */
	import type { EditorOption } from '$lib/client/editors';
	import type { GraphCrudMeta } from '$lib/transform/graph-crud';
	import type { GraphViewModel } from '$lib/transform/to-graph';
	import { graphStructureSignature } from './graph-flow';
	import GraphCanvas from './GraphCanvas.svelte';

	type Props = {
		/** Stripped graph model without positions (from server). */
		graph: GraphViewModel;
		/** EDITOR / OWNER only — VIEWER never draws wires or node CRUD. */
		canEdit?: boolean;
		/** Relation table used for persist (e.g. connects). */
		relation?: string | null;
		/** Create/delete gates from config + STRUCTURE. */
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

	/** Nodes + ELK knobs only. New/deleted wires must not remount (that fitViews). */
	const structureKey = $derived(graphStructureSignature(graph));
</script>

<div class="graph-view relative h-full min-h-0 w-full">
	{#key structureKey}
		<GraphCanvas {graph} {canEdit} {relation} {crud} {recordOptionsByTable} />
	{/key}
</div>
