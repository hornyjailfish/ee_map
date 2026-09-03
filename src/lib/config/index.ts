export type {
	// Shared unions
	GraphRole,
	GraphHierarchyRole,
	EdgeRole,
	MapUnits,
	MapPlane,
	DiagnosticLevel,
	FieldTypeName,
	// Overlay
	AppConfigOverlay,
	EntityOverlay,
	EntityDisplayOverlay,
	TableSortKeyOverlay,
	FieldOverlay,
	EdgeOverlay,
	MapOverlay,
	SearchOverlay,
	GraphOverlay,
	GraphLayoutDirection,
	GraphLayoutAlign,
	GraphLayoutSpacingOverlay,
	GraphCompoundPaddingOverlay,
	// AutoProfile
	AutoProfileTableKind,
	AutoProfileField,
	AutoProfileTable,
	AutoProfile,
	TablePermissions,
	SurrealEngineVersion,
	// Resolved
	Diagnostic,
	ResolvedField,
	ResolvedEntityDisplay,
	ResolvedTableSortKey,
	ResolvedEntityGraph,
	ResolvedEntityMap,
	ResolvedEntity,
	ResolvedEdge,
	ResolvedMapLayer,
	ResolvedFloorPlan,
	ResolvedMap,
	ResolvedSearch,
	ResolvedGraph,
	ResolvedGraphLayout,
	ResolvedConfig
} from './types';

export { merge, DEFAULT_GRAPH_LAYOUT } from './merge';
export { parseSurrealVersion, engineAtLeast } from './surreal-version';
export {
	OVERLAY_DOC_ID,
	emptyOverlay,
	cloneOverlay,
	stringifyOverlay,
	parseOverlayJson,
	softParseOverlay,
	parseStringList,
	formatStringList,
	parseSortText,
	formatSortText,
	formatDisplayText,
	parseDisplayText,
	sortedKeys,
	type OverlayParseResult
} from './overlay-io';
