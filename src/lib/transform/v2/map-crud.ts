/**
 * v2 map CRUD meta: layers index only (no entity.map fallback).
 * Output MapCrudMeta matches v1 so /map client stays stable at switch time.
 */

import type { ResolvedField } from '$lib/config/types';
import { buildColumns, type TableColumn } from '../to-table';
import { drawKindsForField, type MapCrudMeta, type MapEntityCrudSpec } from '../map-crud';
import type { ResolvedConfigV2, ResolvedEntityV2 } from './shapes';

/**
 * Build map CRUD metadata from v2 resolved config.
 * Only tables present in `config.map.layers` with drawable geometry appear.
 */
export function buildMapCrudMetaV2(config: ResolvedConfigV2): MapCrudMeta {
	const byTable: Record<string, MapEntityCrudSpec> = {};
	const entityByName = new Map(config.tables.map((t) => [t.name, t]));

	for (const layer of config.map.layers) {
		const entity = entityByName.get(layer.table);
		if (!entity) continue;

		const geomField = resolveGeometryField(entity, layer.geometryField);
		if (!geomField) continue;

		const drawKinds = drawKindsForField(geomField);
		if (drawKinds.length === 0) continue;

		const levelField = resolveLevelFieldV2(entity, layer.levelField);

		const fields = buildColumnsFromEntity(entity).filter(
			(c) => c.id !== 'id' && isWritableFormColumn(c)
		);

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

	const drawable = Object.values(byTable)
		.filter((s) => (s.canCreate || s.canUpdate) && s.drawKinds.includes('polygon'))
		.sort((a, b) => a.zIndex - b.zIndex || a.table.localeCompare(b.table));

	const createTargets = drawable.filter((s) => s.canCreate);

	return { createTargets, drawTargets: drawable, byTable };
}

function resolveGeometryField(
	entity: ResolvedEntityV2,
	geometryField: string | undefined
): ResolvedField | null {
	if (geometryField) {
		const named = entity.fields.find((f) => f.name === geometryField && f.type === 'geometry');
		if (named && !named.hidden && !named.readOnly) return named;
	}
	return entity.fields.find((f) => f.type === 'geometry' && !f.hidden && !f.readOnly) ?? null;
}

/** Level FK from layer only — no entity.map denorm. */
function resolveLevelFieldV2(entity: ResolvedEntityV2, layerLevelField?: string): string | null {
	if (layerLevelField && entity.fields.some((f) => f.name === layerLevelField)) {
		return layerLevelField;
	}
	const level = entity.fields.find((f) => f.name === 'level' && f.type === 'record');
	return level?.name ?? null;
}

function buildColumnsFromEntity(entity: ResolvedEntityV2): TableColumn[] {
	return buildColumns(entity as Parameters<typeof buildColumns>[0]);
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

export { drawKindsForField };
