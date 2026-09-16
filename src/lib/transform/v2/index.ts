/**
 * Config-shape v2 transform alternatives (N13-ready).
 *
 * Shipped runtime still uses v1 modules (`to-graph`, `to-map`, …).
 * Switch call sites after merge emits ResolvedConfigV2 / soft-parse lifts overlay.
 */

export type {
	ProductView,
	ResolvedConfigV2,
	ResolvedEntityV2,
	ResolvedGraphNodeV2,
	ResolvedGraphV2
} from './shapes';

export {
	deriveViewsFromV1,
	graphNodesFromV1,
	liftGraphNode,
	liftResolvedConfigV1,
	slimEntityFromV1
} from './from-v1';

export { toGraphV2 } from './to-graph';
export { buildGraphCrudMetaV2, graphNodeOf } from './graph-crud';
export { entitiesForView, entityByNameV2, tableEntities, toTableV2 } from './to-table';
export { toMapV2 } from './to-map';
export { buildMapCrudMetaV2 } from './map-crud';
export {
	layoutOptionsByTableFromConfig,
	layoutOptionsByTableFromNodes,
	toElkGraphFromConfigV2,
	toElkGraphV2,
	type ToElkGraphV2Options
} from './to-elk';
