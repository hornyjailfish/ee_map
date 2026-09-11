/**
 * Graph node CRUD metadata derived from ResolvedConfig.
 * Pure — no DB. Used by graph page load and client toolbar gates.
 */

import type { ResolvedConfig } from '$lib/config/types';
import { buildColumns, type TableColumn } from './to-table';

/** Form fields for creating a child under a parent graph node. */
export type GraphChildCreateSpec = {
	/** Child entity table name (e.g. boards, breakers). */
	childTable: string;
	/** Human label for the child entity. */
	childLabel: string;
	/** FK field on the child that points at the parent (e.g. room, board). */
	parentField: string;
	/** Graph role of the child (board | breaker | …). */
	childRole: string;
	/** Writable form columns excluding parentField (parent is injected on submit). */
	fields: TableColumn[];
	/** STRUCTURE create permission on the child table. */
	canCreate: boolean;
};

/**
 * Serializable CRUD gates for the graph canvas.
 * Keyed by parent/own table names from node.data.table.
 */
export type GraphCrudMeta = {
	/**
	 * Parent entity table → child create form.
	 * room table → board child; board table → breaker child.
	 */
	createByParentTable: Record<string, GraphChildCreateSpec>;
	/** Entity table → STRUCTURE delete allowed. */
	deleteByTable: Record<string, boolean>;
	/** Entity table → STRUCTURE update allowed. */
	updateByTable: Record<string, boolean>;
	/** Entity table → writable form columns (node edit modal). */
	editByTable: Record<string, TableColumn[]>;
};

/**
 * Build graph CRUD metadata from resolved config.
 * Child entities are those with graph.parentField pointing at a parent table.
 */
export function buildGraphCrudMeta(config: ResolvedConfig): GraphCrudMeta {
	const createByParentTable: Record<string, GraphChildCreateSpec> = {};
	const deleteByTable: Record<string, boolean> = {};
	const updateByTable: Record<string, boolean> = {};
	const editByTable: Record<string, TableColumn[]> = {};

	for (const entity of config.tables) {
		deleteByTable[entity.name] = Boolean(entity.permissions.delete);
		updateByTable[entity.name] = Boolean(entity.permissions.update);

		const graph = entity.graph;
		if (graph && graph.role !== 'ignore') {
			editByTable[entity.name] = buildColumns(entity).filter(
				(c) => c.id !== 'id' && isWritableFormColumn(c)
			);
		}

		if (!graph || graph.role === 'ignore' || !graph.parentField) continue;

		const parentField = entity.fields.find((f) => f.name === graph.parentField);
		const parentTables = parentField?.recordTargets ?? [];
		if (parentTables.length === 0) continue;

		// Same fields as the table add-row form (includes parent FK).
		const columns = buildColumns(entity).filter(
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
			// First child type wins if multiple point at the same parent table.
			if (!createByParentTable[parentTable]) {
				createByParentTable[parentTable] = spec;
			}
		}
	}

	return { createByParentTable, deleteByTable, updateByTable, editByTable };
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
