/**
 * Map geometry CRUD metadata derived from ResolvedConfig.
 * Pure — no DB. Used by /map load and client create toolbar.
 *
 * Create-first (C4.1): tables with map layer + geometry + create permission.
 * Modify/clear gates (`canUpdate`) are included for the next slice.
 */

import type { ResolvedConfig, ResolvedEntity, ResolvedField } from '$lib/config/types';
import { buildColumns, type TableColumn } from './to-table';

/** Draw kinds the client may offer (mutate accepts Point | Polygon only). */
export type MapDrawKind = 'polygon' | 'point';

/** Per-table create/edit gates + form fields for map geometry tools. */
export type MapEntityCrudSpec = {
	table: string;
	label: string;
	geometryField: string;
	/** Level record field when present; null for self-level / no level. */
	levelField: string | null;
	/** Allowed draw tools for this table's geometry kinds. */
	drawKinds: MapDrawKind[];
	/** Writable form columns (excludes id + geometry). */
	fields: TableColumn[];
	canCreate: boolean;
	/** Update permission — modify / clear / attach later. */
	canUpdate: boolean;
	styleKey: string;
	zIndex: number;
	layerGroup?: string;
};

/** Serializable map CRUD payload for the page. */
export type MapCrudMeta = {
	/** Creatable map layers (draw target picker). */
	createTargets: MapEntityCrudSpec[];
	/** All map geometry tables keyed by name (create + update-capable). */
	byTable: Record<string, MapEntityCrudSpec>;
};

/**
 * Build map CRUD metadata from resolved config.
 * Only map-enabled entities with a geometry field appear.
 */
export function buildMapCrudMeta(config: ResolvedConfig): MapCrudMeta {
	const byTable: Record<string, MapEntityCrudSpec> = {};

	const layerByTable = new Map(config.map.layers.map((l) => [l.table, l]));

	for (const entity of config.tables) {
		const layer = layerByTable.get(entity.name);
		if (!layer) continue;

		const geomField = resolveGeometryField(entity, layer.geometryField);
		if (!geomField) continue;

		const drawKinds = drawKindsForField(geomField);
		// Nothing drawable via Point/Polygon coerce → skip (e.g. multiline floor plans)
		if (drawKinds.length === 0) continue;

		const levelField = resolveLevelField(entity, layer.levelField);

		const fields = buildColumns(entity).filter((c) => c.id !== 'id' && isWritableFormColumn(c));

		const spec: MapEntityCrudSpec = {
			table: entity.name,
			label: entity.label,
			geometryField: geomField.name,
			levelField,
			drawKinds,
			fields,
			canCreate: Boolean(entity.permissions.create),
			canUpdate: Boolean(entity.permissions.update),
			styleKey: layer.styleKey,
			zIndex: layer.zIndex
		};
		if (layer.layerGroup) spec.layerGroup = layer.layerGroup;

		byTable[entity.name] = spec;
	}

	const createTargets = Object.values(byTable)
		.filter((s) => s.canCreate && s.drawKinds.includes('polygon'))
		.sort((a, b) => a.zIndex - b.zIndex || a.table.localeCompare(b.table));

	return { createTargets, byTable };
}

function resolveGeometryField(
	entity: ResolvedEntity,
	geometryField: string | undefined
): ResolvedField | null {
	if (geometryField) {
		const named = entity.fields.find((f) => f.name === geometryField && f.type === 'geometry');
		if (named && !named.hidden && !named.readOnly) return named;
	}
	return entity.fields.find((f) => f.type === 'geometry' && !f.hidden && !f.readOnly) ?? null;
}

function resolveLevelField(entity: ResolvedEntity, layerLevelField?: string): string | null {
	if (layerLevelField && entity.fields.some((f) => f.name === layerLevelField)) {
		return layerLevelField;
	}
	if (entity.map?.levelField && entity.fields.some((f) => f.name === entity.map?.levelField)) {
		return entity.map.levelField;
	}
	const level = entity.fields.find((f) => f.name === 'level' && f.type === 'record');
	return level?.name ?? null;
}

/**
 * Map Surreal geometryKinds → draw tools.
 * Empty kinds → both (overlay/STRUCTURE may omit kinds); multiline-only → none.
 */
export function drawKindsForField(field: ResolvedField): MapDrawKind[] {
	const raw = field.geometryKinds?.map((k) => k.toLowerCase()) ?? [];
	if (raw.length === 0) {
		// Unknown constraint — allow polygon (primary indoor shape)
		return ['polygon'];
	}

	const out: MapDrawKind[] = [];
	if (raw.some((k) => k.includes('polygon'))) out.push('polygon');
	if (raw.some((k) => k === 'point')) out.push('point');
	return out;
}

function isWritableFormColumn(c: TableColumn): boolean {
	if (c.readOnly) return false;
	if (c.editor === false) return false;
	if (c.valueType === 'geometry') return false;
	if (typeof c.editor === 'string') return true;
	switch (c.valueType) {
		case 'string':
		case 'number':
		case 'bool':
		case 'datetime':
		case 'record':
			return true;
		default:
			return false;
	}
}
