import type {
	AppConfigOverlay,
	AutoProfile,
	AutoProfileField,
	AutoProfileTable,
	Diagnostic,
	EntityDisplayOverlay,
	EntityOverlay,
	FieldOverlay,
	GraphOverlay,
	ResolvedConfig,
	ResolvedEdge,
	ResolvedEntity,
	ResolvedEntityDisplay,
	ResolvedEntityGraph,
	ResolvedEntityMap,
	ResolvedField,
	ResolvedGraphLayout,
	ResolvedMapLayer,
	ResolvedSearch,
	ResolvedTableSortKey,
	TablePermissions,
	TableSortKeyOverlay
} from './types';

const DEFAULT_HIERARCHY = ['room', 'board', 'breaker', 'output', 'group'] as const;
const SYSTEM_TABLE = /^__/;
const DEFAULT_DISPLAY_SEP = ' · ';

/** Fail-closed permissions: absent STRUCTURE flags mean "not writable". */
const NO_PERMISSIONS: TablePermissions = {
	create: false,
	update: false,
	delete: false,
	select: false
};

/** Normalize STRUCTURE permissions to concrete booleans (default false). */
function normalizePermissions(raw?: TablePermissions): TablePermissions {
	return {
		create: raw?.create ?? false,
		update: raw?.update ?? false,
		delete: raw?.delete ?? false,
		select: raw?.select ?? false
	};
}

export const DEFAULT_GRAPH_LAYOUT: ResolvedGraphLayout = {
	direction: 'DOWN',
	align: 'center',
	// node/layer: node packing; edge*: keep multi-edge fans from inflating board height
	spacing: { node: 14, layer: 28, edgeLayer: 10, edgeEdge: 4, edgeNode: 8 },
	// top clears board/room header chrome
	compoundPadding: { top: 28, left: 16, bottom: 16, right: 16 }
};

/**
 * Merge live AutoProfile with a sparse AppConfigOverlay into ResolvedConfig.
 * Pure — no I/O.
 */
export function merge(auto: AutoProfile, overlay?: AppConfigOverlay | null): ResolvedConfig {
	const ov = overlay ?? undefined;
	const exclude = new Set(ov?.excludeTables ?? []);
	const diagnostics: Diagnostic[] = [];

	const autoByName = new Map(auto.tables.map((t) => [t.name, t]));
	const included = auto.tables.filter((t) => !SYSTEM_TABLE.test(t.name) && !exclude.has(t.name));

	const tables: ResolvedEntity[] = [];
	const relations: ResolvedEdge[] = [];

	for (const table of included) {
		if (table.kind === 'relation') {
			relations.push(resolveEdge(table, ov));
			continue;
		}

		if (table.kind === 'unknown') {
			diagnostics.push({
				level: 'info',
				code: 'unknown_table_kind',
				message: `Table '${table.name}' has unknown kind; treated as entity`
			});
		}

		tables.push(resolveEntity(table, ov, diagnostics));
	}

	const layers = buildMapLayers(tables, diagnostics);
	const search = resolveSearch(ov, autoByName, exclude, diagnostics);
	collectOrphanOverlays(ov, autoByName, exclude, diagnostics);

	diagnostics.sort((a, b) => {
		const byCode = a.code.localeCompare(b.code);
		if (byCode !== 0) return byCode;
		return a.message.localeCompare(b.message);
	});

	const config: ResolvedConfig = {
		version: 1,
		tables,
		relations,
		map: {
			units: ov?.map?.units ?? 'm',
			plane: ov?.map?.plane ?? 'xy-meters',
			...(ov?.map?.extent ? { extent: ov.map.extent } : {}),
			levelsTable: ov?.map?.levelsTable ?? 'levels',
			levelOrderField: ov?.map?.levelOrderField ?? 'ord',
			...(ov?.map?.floorPlan ? { floorPlan: { ...ov.map.floorPlan } } : {}),
			layers
		},
		search,
		graph: {
			hierarchy: [...DEFAULT_HIERARCHY],
			layout: resolveGraphLayout(ov?.graph)
		},
		diagnostics
	};
	if (auto.engine) config.engine = auto.engine;
	return config;
}

function resolveEntity(
	table: AutoProfileTable,
	overlay: AppConfigOverlay | undefined,
	diagnostics: Diagnostic[]
): ResolvedEntity {
	const entityOv = overlay?.entities?.[table.name];
	const fieldNames = new Set(table.fields.map((f) => f.name));
	const entity: ResolvedEntity = {
		name: table.name,
		label: entityOv?.label ?? table.name,
		fields: resolveFields(table, entityOv?.table, diagnostics),
		permissions: normalizePermissions(table.permissions)
	};

	const display = resolveEntityDisplay(table, entityOv, fieldNames, diagnostics);
	if (display) entity.display = display;

	const sort = resolveEntitySort(table.name, entityOv?.table?.sort, fieldNames, diagnostics);
	if (sort) entity.sort = sort;

	if (entityOv?.graph) {
		entity.graph = resolveGraph(entityOv.graph, table.name, fieldNames, diagnostics);
	}

	if (entityOv?.map) {
		entity.map = resolveEntityMap(entityOv.map, table.fields);
	}

	return entity;
}

/**
 * Default table sort from overlay.
 * Heuristic when omitted: field named `name` ascending (if present).
 */
function resolveEntitySort(
	tableName: string,
	overlaySort: string | TableSortKeyOverlay | TableSortKeyOverlay[] | undefined,
	fieldNames: Set<string>,
	diagnostics: Diagnostic[]
): ResolvedTableSortKey[] | undefined {
	if (overlaySort !== undefined && overlaySort !== null) {
		const keys = normalizeSortOverlay(overlaySort, tableName, fieldNames, diagnostics);
		return keys.length > 0 ? keys : undefined;
	}

	if (fieldNames.has('name')) {
		return [{ field: 'name', dir: 'asc' }];
	}

	return undefined;
}

function normalizeSortOverlay(
	raw: string | TableSortKeyOverlay | TableSortKeyOverlay[],
	tableName: string,
	fieldNames: Set<string>,
	diagnostics: Diagnostic[]
): ResolvedTableSortKey[] {
	const items: TableSortKeyOverlay[] = Array.isArray(raw)
		? raw
		: typeof raw === 'string'
			? [{ field: raw }]
			: raw && typeof raw === 'object'
				? [raw]
				: [];

	const out: ResolvedTableSortKey[] = [];
	const seen = new Set<string>();

	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		const field = typeof item.field === 'string' ? item.field.trim() : '';
		if (!field) {
			diagnostics.push({
				level: 'warn',
				code: 'invalid_sort_field',
				message: `Entity '${tableName}' table.sort has empty field`
			});
			continue;
		}
		if (!fieldNames.has(field)) {
			diagnostics.push({
				level: 'warn',
				code: 'missing_sort_field',
				message: `Entity '${tableName}' table.sort field '${field}' not found`
			});
			continue;
		}
		if (seen.has(field)) continue;
		seen.add(field);
		const dir = item.dir === 'desc' ? 'desc' : 'asc';
		out.push({ field, dir });
	}

	return out;
}

/**
 * Resolve how this entity labels itself when referenced.
 * Priority: overlay.display → graph.labelField → field named `name`.
 */
function resolveEntityDisplay(
	table: AutoProfileTable,
	overlay: EntityOverlay | undefined,
	fieldNames: Set<string>,
	diagnostics: Diagnostic[]
): ResolvedEntityDisplay | undefined {
	if (overlay?.display) {
		return normalizeDisplayOverlay(
			overlay.display,
			`Entity '${table.name}' display`,
			fieldNames,
			diagnostics
		);
	}

	const graphLabel = overlay?.graph?.labelField;
	if (graphLabel) {
		return { parts: [{ path: graphLabel }], sep: DEFAULT_DISPLAY_SEP };
	}

	if (fieldNames.has('name')) {
		return { parts: [{ path: 'name' }], sep: DEFAULT_DISPLAY_SEP };
	}

	return undefined;
}

function normalizeDisplayOverlay(
	overlay: EntityDisplayOverlay,
	context: string,
	fieldNames: Set<string> | null,
	diagnostics: Diagnostic[]
): ResolvedEntityDisplay | undefined {
	const sep = overlay.sep ?? DEFAULT_DISPLAY_SEP;

	if (overlay.parts && overlay.parts.length > 0) {
		const parts: Array<{ path: string }> = [];
		for (const part of overlay.parts) {
			const path = typeof part?.path === 'string' ? part.path.trim() : '';
			if (!path) {
				diagnostics.push({
					level: 'warn',
					code: 'invalid_display_path',
					message: `${context} has empty path part`
				});
				continue;
			}
			validateDisplayPathRoot(path, context, fieldNames, diagnostics);
			parts.push({ path });
		}
		if (parts.length === 0) return undefined;
		return { parts, sep };
	}

	if (overlay.field) {
		const field = overlay.field.trim();
		if (!field) {
			diagnostics.push({
				level: 'warn',
				code: 'invalid_display_path',
				message: `${context} has empty field`
			});
			return undefined;
		}
		validateDisplayPathRoot(field, context, fieldNames, diagnostics);
		return { parts: [{ path: field }], sep };
	}

	diagnostics.push({
		level: 'warn',
		code: 'empty_display',
		message: `${context} has neither field nor parts`
	});
	return undefined;
}

/** Warn when the first path segment is not a known local field (hops beyond root are runtime). */
function validateDisplayPathRoot(
	path: string,
	context: string,
	fieldNames: Set<string> | null,
	diagnostics: Diagnostic[]
): void {
	if (!fieldNames) return;
	const root = path.split('.')[0]?.trim() ?? '';
	if (!root) return;
	if (!fieldNames.has(root)) {
		diagnostics.push({
			level: 'warn',
			code: 'missing_display_field',
			message: `${context} path '${path}' root '${root}' not found`
		});
	}
}

function resolveGraph(
	graphOv: NonNullable<EntityOverlay['graph']>,
	tableName: string,
	fieldNames: Set<string>,
	diagnostics: Diagnostic[]
): ResolvedEntityGraph {
	const graph: ResolvedEntityGraph = { role: graphOv.role };

	if (graphOv.parentField !== undefined) {
		graph.parentField = graphOv.parentField;
		if (!fieldNames.has(graphOv.parentField)) {
			diagnostics.push({
				level: 'warn',
				code: 'missing_parent_field',
				message: `Entity '${tableName}' graph.parentField '${graphOv.parentField}' not found`
			});
		}
	}

	if (graphOv.nodeType !== undefined) graph.nodeType = graphOv.nodeType;

	if (graphOv.labelField !== undefined) {
		graph.labelField = graphOv.labelField;
		if (!fieldNames.has(graphOv.labelField)) {
			diagnostics.push({
				level: 'warn',
				code: 'missing_label_field',
				message: `Entity '${tableName}' graph.labelField '${graphOv.labelField}' not found`
			});
		}
	}

	if (graphOv.subtitleField !== undefined) {
		graph.subtitleField = graphOv.subtitleField;
		if (!fieldNames.has(graphOv.subtitleField)) {
			diagnostics.push({
				level: 'warn',
				code: 'missing_subtitle_field',
				message: `Entity '${tableName}' graph.subtitleField '${graphOv.subtitleField}' not found`
			});
		}
	}

	return graph;
}

function resolveEntityMap(
	mapOv: NonNullable<EntityOverlay['map']>,
	fields: AutoProfileField[]
): ResolvedEntityMap {
	const levelHeuristic = fields.find((f) => f.name === 'level' && f.type === 'record');
	const geometryHeuristic = fields.find((f) => f.type === 'geometry');

	const map: ResolvedEntityMap = {
		enabled: mapOv.enabled ?? false
	};

	const levelField = mapOv.levelField ?? levelHeuristic?.name;
	const geometryField = mapOv.geometryField ?? geometryHeuristic?.name;

	if (levelField !== undefined) map.levelField = levelField;
	if (geometryField !== undefined) map.geometryField = geometryField;
	if (mapOv.layerGroup !== undefined) map.layerGroup = mapOv.layerGroup;
	if (mapOv.styleKey !== undefined) map.styleKey = mapOv.styleKey;
	if (mapOv.zIndex !== undefined) map.zIndex = mapOv.zIndex;

	return map;
}

function buildMapLayers(tables: ResolvedEntity[], diagnostics: Diagnostic[]): ResolvedMapLayer[] {
	const layers: ResolvedMapLayer[] = [];

	for (const entity of tables) {
		if (!entity.map || entity.map.enabled !== true) continue;

		const levelField = entity.map.levelField;
		const geometryField = entity.map.geometryField;

		// geometryField required; levelField optional (self-level layers such as floor plans)
		if (!geometryField) {
			diagnostics.push({
				level: 'warn',
				code: 'map_layer_incomplete',
				message: `Entity '${entity.name}' map.enabled but missing geometryField`
			});
			continue;
		}

		const layer: ResolvedMapLayer = {
			table: entity.name,
			geometryField,
			styleKey: entity.map.styleKey ?? entity.name,
			zIndex: entity.map.zIndex ?? 0
		};
		if (levelField !== undefined) layer.levelField = levelField;
		if (entity.map.layerGroup !== undefined) layer.layerGroup = entity.map.layerGroup;
		layers.push(layer);
	}

	layers.sort((a, b) => {
		if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
		return a.table.localeCompare(b.table);
	});

	return layers;
}

function resolveEdge(table: AutoProfileTable, overlay: AppConfigOverlay | undefined): ResolvedEdge {
	const edgeOv = overlay?.edges?.[table.name];
	const edge: ResolvedEdge = {
		name: table.name,
		role: edgeOv?.role ?? 'other',
		in: table.in ?? [],
		out: table.out ?? [],
		fields: resolveFields(table),
		permissions: normalizePermissions(table.permissions)
	};
	if (edgeOv?.edgeType !== undefined) edge.edgeType = edgeOv.edgeType;
	if (edgeOv?.labelField !== undefined) edge.labelField = edgeOv.labelField;
	return edge;
}

function resolveFields(
	table: AutoProfileTable,
	tableOv?: {
		hide?: string[];
		readOnly?: string[];
		order?: string[];
		fields?: Record<string, FieldOverlay>;
	},
	diagnostics: Diagnostic[] = []
): ResolvedField[] {
	const byName = new Map(table.fields.map((f) => [f.name, f]));
	const order = tableOv?.order ?? [];
	const orderedNames: string[] = [];
	const seen = new Set<string>();

	for (const name of order) {
		if (byName.has(name) && !seen.has(name)) {
			orderedNames.push(name);
			seen.add(name);
		}
	}
	for (const f of table.fields) {
		if (!seen.has(f.name)) orderedNames.push(f.name);
	}

	const hide = new Set(tableOv?.hide ?? []);
	const readOnly = new Set(tableOv?.readOnly ?? []);

	return orderedNames.map((name) => {
		const autoField = byName.get(name)!;
		const fieldOv = tableOv?.fields?.[name];
		const resolved: ResolvedField = {
			name: autoField.name,
			label: fieldOv?.label ?? autoField.name,
			type: autoField.type,
			optional: autoField.optional ?? false,
			hidden: fieldOv?.hidden ?? hide.has(name),
			readOnly: readOnly.has(name)
		};
		if (autoField.recordTargets) resolved.recordTargets = autoField.recordTargets;
		if (autoField.geometryKinds) resolved.geometryKinds = autoField.geometryKinds;
		if (fieldOv?.editor !== undefined) resolved.editor = fieldOv.editor;
		if (fieldOv?.width !== undefined) resolved.width = fieldOv.width;
		if (fieldOv?.display) {
			const colDisplay = normalizeDisplayOverlay(
				fieldOv.display,
				`Entity '${table.name}' field '${name}' display`,
				null,
				diagnostics
			);
			if (colDisplay) resolved.display = colDisplay;
		}
		return resolved;
	});
}

function resolveGraphLayout(graphOv: GraphOverlay | undefined): ResolvedGraphLayout {
	const layoutOv = graphOv?.layout;
	const spacingOv = layoutOv?.spacing;
	const padOv = layoutOv?.compoundPadding;

	return {
		direction: layoutOv?.direction ?? DEFAULT_GRAPH_LAYOUT.direction,
		align: layoutOv?.align ?? DEFAULT_GRAPH_LAYOUT.align,
		spacing: {
			node: spacingOv?.node ?? DEFAULT_GRAPH_LAYOUT.spacing.node,
			layer: spacingOv?.layer ?? DEFAULT_GRAPH_LAYOUT.spacing.layer,
			edgeLayer: spacingOv?.edgeLayer ?? DEFAULT_GRAPH_LAYOUT.spacing.edgeLayer,
			edgeEdge: spacingOv?.edgeEdge ?? DEFAULT_GRAPH_LAYOUT.spacing.edgeEdge,
			edgeNode: spacingOv?.edgeNode ?? DEFAULT_GRAPH_LAYOUT.spacing.edgeNode
		},
		compoundPadding: {
			top: padOv?.top ?? DEFAULT_GRAPH_LAYOUT.compoundPadding.top,
			left: padOv?.left ?? DEFAULT_GRAPH_LAYOUT.compoundPadding.left,
			bottom: padOv?.bottom ?? DEFAULT_GRAPH_LAYOUT.compoundPadding.bottom,
			right: padOv?.right ?? DEFAULT_GRAPH_LAYOUT.compoundPadding.right
		}
	};
}

function resolveSearch(
	overlay: AppConfigOverlay | undefined,
	autoByName: Map<string, AutoProfileTable>,
	exclude: Set<string>,
	diagnostics: Diagnostic[]
): ResolvedSearch {
	const raw = overlay?.search?.fieldsByTable ?? {};
	const fieldsByTable: Record<string, string[]> = {};

	for (const [tableName, fields] of Object.entries(raw)) {
		const autoTable = autoByName.get(tableName);
		const dropped = !autoTable || SYSTEM_TABLE.test(tableName) || exclude.has(tableName);

		if (dropped) {
			diagnostics.push({
				level: 'warn',
				code: 'search_unknown_table',
				message: `Search fields reference unknown or excluded table '${tableName}'`
			});
			continue;
		}

		fieldsByTable[tableName] = fields;
	}

	return { fieldsByTable };
}

function collectOrphanOverlays(
	overlay: AppConfigOverlay | undefined,
	autoByName: Map<string, AutoProfileTable>,
	exclude: Set<string>,
	diagnostics: Diagnostic[]
): void {
	if (!overlay) return;

	if (overlay.entities) {
		for (const name of Object.keys(overlay.entities)) {
			const autoTable = autoByName.get(name);
			if (
				autoTable &&
				autoTable.kind !== 'relation' &&
				!SYSTEM_TABLE.test(name) &&
				!exclude.has(name)
			) {
				continue;
			}

			if (!autoTable) {
				const excludedByName = exclude.has(name);
				diagnostics.push({
					level: excludedByName ? 'info' : 'warn',
					code: 'orphan_entity_overlay',
					message: excludedByName
						? `Entity overlay '${name}' targets excluded table`
						: `Entity overlay '${name}' has no matching auto profile table`
				});
				continue;
			}

			if (exclude.has(name) || SYSTEM_TABLE.test(name)) {
				diagnostics.push({
					level: 'info',
					code: 'orphan_entity_overlay',
					message: `Entity overlay '${name}' targets excluded table`
				});
				continue;
			}

			// Exists but is a relation — still orphan for entity overlay
			diagnostics.push({
				level: 'warn',
				code: 'orphan_entity_overlay',
				message: `Entity overlay '${name}' has no matching auto profile table`
			});
		}
	}

	if (overlay.edges) {
		for (const name of Object.keys(overlay.edges)) {
			const autoTable = autoByName.get(name);
			if (
				autoTable &&
				autoTable.kind === 'relation' &&
				!SYSTEM_TABLE.test(name) &&
				!exclude.has(name)
			) {
				continue;
			}

			diagnostics.push({
				level: 'warn',
				code: 'orphan_edge_overlay',
				message: `Edge overlay '${name}' has no matching relation table`
			});
		}
	}
}
