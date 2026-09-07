/**
 * Pure helpers for GraphViewModel at the SF canvas boundary.
 * GraphViewModel nodes/edges are already SF Node/Edge — no structural remap.
 */

import type { ElkNodeSize } from '$lib/transform/to-elk';
import type { GraphCrudMeta } from '$lib/transform/graph-crud';
import type { GraphEdge, GraphNode, GraphViewModel } from '$lib/transform/to-graph';

/** Node + layout identity — used for `{#key}` remounts (camera reset OK). */
export function graphStructureSignature(model: GraphViewModel): string {
	const nodePart = model.nodes
		.map(
			(n) =>
				`${n.id}|${n.type ?? ''}|${n.parentId ?? ''}|${n.data.role}|${n.data.label}|${n.connectable ? 1 : 0}`
			)
		.join(';');
	const layout = model.layout;
	const layoutPart = [
		layout.direction,
		layout.align,
		layout.spacing.node,
		layout.spacing.layer,
		layout.compoundPadding.top,
		layout.compoundPadding.left,
		layout.compoundPadding.bottom,
		layout.compoundPadding.right
	].join('|');
	return `${nodePart}#${layoutPart}`;
}

/** Edge-only identity — canvas stays mounted; edges sync in place (keep camera). */
export function graphEdgeSignature(model: GraphViewModel): string {
	return model.edges.map((e) => `${e.id}|${e.source}>${e.target}`).join(';');
}

/** Full identity (nodes + edges + layout). */
export function graphSignature(model: GraphViewModel): string {
	return `${graphStructureSignature(model)}#${graphEdgeSignature(model)}`;
}

/** Parent ids that have at least one child in the model. */
export function compoundIds(model: GraphViewModel): Set<string> {
	return new Set(model.nodes.filter((n) => n.parentId).map((n) => n.parentId as string));
}

export type GraphNodeUiOpts = {
	canEdit?: boolean;
	crud?: GraphCrudMeta | null;
};

/** Annotate node data with EDITOR toolbar flags (add child / delete). */
export function withNodeUiFlags(data: GraphNode['data'], opts: GraphNodeUiOpts): GraphNode['data'] {
	const canEdit = Boolean(opts.canEdit);
	const table = data.table;
	const create = opts.crud?.createByParentTable[table];
	const canAddChild = canEdit && Boolean(create?.canCreate);
	const canDelete = canEdit && Boolean(opts.crud?.deleteByTable[table]);
	const next = {
		...data,
		canEdit,
		canAddChild,
		canDelete
	};
	if (canAddChild && create) {
		next.addChildLabel = create.childRole || create.childLabel;
	} else {
		delete next.addChildLabel;
	}
	return next;
}

/**
 * Content-sized SF nodes parked at origin for measure phase.
 * Strips width/height so SF measures leaf content; ensures canConnect on wire endpoints.
 */
export function toMeasureNodes(model: GraphViewModel, ui: GraphNodeUiOpts = {}): GraphNode[] {
	return model.nodes.map((n) => {
		const role = n.data.role;
		const canWire = n.connectable === true || role === 'breaker' || role === 'output';
		const { width: _w, height: _h, style: _s, measured: _m, ...rest } = n;
		const node: GraphNode = {
			...rest,
			position: { x: 0, y: 0 },
			connectable: canWire,
			data: withNodeUiFlags(
				{
					...n.data,
					canConnect: canWire
				},
				ui
			)
		};
		return node;
	});
}

export function toFlowEdges(model: GraphViewModel): GraphEdge[] {
	return model.edges.map((e) => ({
		...e,
		...(e.data ? { data: { ...e.data } } : {})
	}));
}

/**
 * Positioned nodes after ELK.
 * Compounds get explicit ELK box (width/height/style); leaves stay content-sized.
 */
export function toLaidOutNodes(
	model: GraphViewModel,
	sizes?: Map<string, ElkNodeSize>,
	ui: GraphNodeUiOpts = {}
): GraphNode[] {
	const parents = compoundIds(model);

	return model.nodes.map((n) => {
		const size = sizes?.get(n.id);
		const isCompound = parents.has(n.id);
		const role = n.data.role;
		const canWire = n.connectable === true || role === 'breaker' || role === 'output';
		const { width: _w, height: _h, style: _s, measured: _m, ...rest } = n;

		const node: GraphNode = {
			...rest,
			position: n.position ?? { x: 0, y: 0 },
			connectable: canWire,
			data: withNodeUiFlags(
				{
					...n.data,
					canConnect: canWire
				},
				ui
			)
		};

		if (isCompound && size) {
			node.width = size.width;
			node.height = size.height;
			node.style = `width: ${size.width}px; height: ${size.height}px;`;
		}

		return node;
	});
}

/**
 * Leaf-only measured sizes for ELK.
 * Compound nodes fill 100% of their ELK box after layout, so measured height includes children —
 * using that for padding would grow parents on every re-layout.
 */
export function sizesFromFlow(
	flowNodes: GraphNode[],
	compoundNodeIds: ReadonlySet<string>
): Map<string, ElkNodeSize> {
	const sizes = new Map<string, ElkNodeSize>();
	for (const n of flowNodes) {
		if (compoundNodeIds.has(n.id)) continue;
		const w = n.measured?.width ?? n.width;
		const h = n.measured?.height ?? n.height;
		if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
			sizes.set(n.id, { width: w, height: h });
		}
	}
	return sizes;
}
