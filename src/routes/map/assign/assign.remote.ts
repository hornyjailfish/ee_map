/**
 * Remote reads for geometry assignment (search uses Surreal fuzzy similarity).
 */
import { getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { ResolvedEntity } from '$lib/config/types';
import { canEdit } from '$lib/roles';
import { getUserRoles } from '$lib/server/catalog';
import { resolveAppConfig } from '$lib/server/config';
import {
	geometryFieldName,
	isValidTableName,
	queryEntitiesSearch,
	resolveSearchFields
} from '$lib/server/data';
import { displayValue, entityByName, normalizeRecordId } from '$lib/transform/to-table';
import type { AssignRecordRow, AssignTableOption } from './assign-types';

export type { AssignRecordRow, AssignTableOption } from './assign-types';

function mapRecords(
	tableOpt: AssignTableOption,
	rows: Array<Record<string, unknown>>
): AssignRecordRow[] {
	const geomName = tableOpt.geometryField;
	const levelName = tableOpt.levelField;
	const fieldNames = tableOpt.fields.map((f) => f.name);

	return rows.map((row) => {
		const id = normalizeRecordId(row.id);
		const cells: Record<string, unknown> = {};
		for (const name of fieldNames) {
			const raw = row[name];
			if (name === levelName) {
				cells[name] = normalizeRecordId(raw) || null;
			} else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
				const asId = normalizeRecordId(raw);
				cells[name] = asId && asId.includes(':') ? asId : displayValue(raw);
			} else {
				cells[name] = displayValue(raw);
			}
		}

		const geom = row[geomName];
		const hasGeometry =
			geom != null &&
			typeof geom === 'object' &&
			'type' in (geom as object) &&
			(geom as { type?: unknown }).type != null;

		return {
			id,
			cells,
			hasGeometry,
			levelId: levelName ? normalizeRecordId(row[levelName]) || null : null
		};
	});
}

function toTableOption(entity: ResolvedEntity): AssignTableOption | null {
	const geom = geometryFieldName(entity);
	if (!geom || !entity.permissions.update) return null;

	const levelField =
		entity.map?.levelField && entity.fields.some((f) => f.name === entity.map?.levelField)
			? entity.map.levelField
			: (entity.fields.find((f) => f.name === 'level' && f.type === 'record')?.name ?? null);

	const fields = entity.fields
		.filter((f) => !f.hidden && f.name !== 'id' && f.type !== 'geometry')
		.map((f) => ({ name: f.name, label: f.label, type: f.type }));

	return {
		name: entity.name,
		label: entity.label,
		geometryField: geom,
		levelField,
		fields
	};
}

/**
 * Fuzzy-search assignable records for a geometry table.
 * Empty `q` returns a soft-capped full list (same as previous page load).
 */
export const searchAssignRecords = query(
	z.object({
		table: z.string().min(1),
		q: z.string().default('')
	}),
	async ({ table, q }) => {
		const { locals, fetch } = getRequestEvent();

		if (!locals.session?.isConnected) {
			error(503, 'Database unavailable');
		}

		const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);
		if (!canEdit(roles)) {
			error(403, 'Geometry assignment requires EDITOR or OWNER role');
		}

		if (!isValidTableName(table)) {
			error(400, 'Invalid table name');
		}

		const config = await resolveAppConfig(locals.session);
		const entity = entityByName(config, table);
		if (!entity) {
			error(404, `Unknown table: ${table}`);
		}

		const tableOpt = toTableOption(entity);
		if (!tableOpt) {
			error(400, `Table '${table}' is not assignable`);
		}

		const fields = resolveSearchFields(config, entity);
		const rows = await queryEntitiesSearch(locals.session, table, q, {
			fields,
			entityFields: entity.fields
		});
		return {
			table: tableOpt.name,
			records: mapRecords(tableOpt, rows)
		};
	}
);
