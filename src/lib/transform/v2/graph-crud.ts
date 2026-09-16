/**
 * v2 graph CRUD meta: participation from `config.graph.nodes`, entity for fields/permissions.
 * Output GraphCrudMeta shape matches v1 (client toolbar unchanged).
 */

import { buildColumns, type TableColumn } from '../to-table';
import type { GraphChildCreateSpec, GraphCrudMeta } from '../graph-crud';
import type { ResolvedConfigV2, ResolvedEntityV2, ResolvedGraphNodeV2 } from './shapes';

/**
 * Build graph CRUD metadata from v2 resolved config.
 * Child specs use graph.nodes[table].parentField + entity field recordTargets.
 */
export function buildGraphCrudMetaV2(config: ResolvedConfigV2): GraphCrudMeta {
	const createByParentTable: Record<string, GraphChildCreateSpec> = {};
	const deleteByTable: Record<string, boolean> = {};
	const updateByTable: Record<string, boolean> = {};
	const editByTable: Record<string, TableColumn[]> = {};

	const entityByName = new Map(config.tables.map((t) => [t.name, t]));

	for (const entity of config.tables) {
		deleteByTable[entity.name] = Boolean(entity.permissions.delete);
		updateByTable[entity.name] = Boolean(entity.permissions.update);
	}

	for (const [table, graph] of Object.entries(config.graph.nodes)) {
		const entity = entityByName.get(table);
		if (!entity) continue;

		editByTable[table] = buildColumnsFromEntity(entity).filter(
			(c) => c.id !== 'id' && isWritableFormColumn(c)
		);

		if (!graph.parentField) continue;

		const parentField = entity.fields.find((f) => f.name === graph.parentField);
		const parentTables = parentField?.recordTargets ?? [];
		if (parentTables.length === 0) continue;

		const columns = buildColumnsFromEntity(entity).filter(
			(c) => c.id !== 'id' && isWritableFormColumn(c)
		);

		const spec: GraphChildCreateSpec = {
			childTable: entity.name,
			childLabel: entity.label,
			parentField: graph.parentField,
			childRole: graph.role,
			fields: columns,
			canCreate: Boolean(entity.permissions.create)
		};

		for (const parentTable of parentTables) {
			if (!createByParentTable[parentTable]) {
				createByParentTable[parentTable] = spec;
			}
		}
	}

	return { createByParentTable, deleteByTable, updateByTable, editByTable };
}

/**
 * buildColumns expects ResolvedEntity; slim v2 entity is structurally compatible
 * (name, label, fields, permissions — no graph/map required).
 */
function buildColumnsFromEntity(entity: ResolvedEntityV2): TableColumn[] {
	return buildColumns(entity as Parameters<typeof buildColumns>[0]);
}

function isWritableFormColumn(c: TableColumn): boolean {
	if (c.readOnly) return false;
	if (c.editor === false) return false;
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

/** Lookup helper for tests / future loaders. */
export function graphNodeOf(
	config: ResolvedConfigV2,
	table: string
): ResolvedGraphNodeV2 | undefined {
	return config.graph.nodes[table];
}
