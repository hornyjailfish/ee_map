/**
 * Remote read for selected map feature properties (FK labels resolved).
 */
import { getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { ResolvedConfig, ResolvedEntity, ResolvedField } from '$lib/config/types';
import { canEdit } from '$lib/roles';
import { getUserRoles } from '$lib/server/catalog';
import { resolveAppConfig } from '$lib/server/config';
import {
	isValidTableName,
	loadRecordLabels,
	loadRecordOptions,
	MutateError,
	queryRecordById,
	tableOfId,
	type RecordOption
} from '$lib/server/data';
import { formatRecordCellValue } from '$lib/transform/record-label';
import { buildColumns, displayValue, entityByName, normalizeRecordId } from '$lib/transform/to-table';
import type { MapFeatureFieldView, MapFeatureRecordDetail } from './feature-types';

export type { MapFeatureFieldView, MapFeatureRecordDetail } from './feature-types';

function isRecordLinkField(field: ResolvedField): boolean {
	if (field.recordTargets && field.recordTargets.length > 0) return true;
	const t = field.type.toLowerCase();
	return t === 'record' || t.startsWith('record<') || t.startsWith('record ');
}

function fieldValueType(field: ResolvedField): string {
	if (isRecordLinkField(field)) return 'record';
	return field.type;
}

function formValue(field: ResolvedField, raw: unknown): string {
	if (raw == null) return '';
	if (isRecordLinkField(field)) {
		return normalizeRecordId(raw);
	}
	if (typeof raw === 'boolean') return raw ? 'true' : 'false';
	if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
	if (typeof raw === 'string') return raw;
	const shown = displayValue(raw);
	return shown == null ? '' : String(shown);
}

function fieldDisplay(
	field: ResolvedField,
	raw: unknown,
	config: ResolvedConfig,
	labels: ReadonlyMap<string, string>,
	store: ReadonlyMap<string, Record<string, unknown>>
): string {
	if (raw == null) return '';
	if (isRecordLinkField(field)) {
		const labeled = formatRecordCellValue(raw, field, { labels, store, config });
		if (labeled != null && String(labeled).trim() !== '') return String(labeled);
		const id = normalizeRecordId(raw);
		return id || '';
	}
	const shown = displayValue(raw);
	return shown == null ? '' : String(shown);
}

function titleFromRow(row: Record<string, unknown>, id: string): string {
	for (const key of ['name', 'label', 'title'] as const) {
		const v = row[key];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return id;
}

function buildDetail(
	config: ResolvedConfig,
	entity: ResolvedEntity,
	row: Record<string, unknown>,
	id: string,
	roleCanEdit: boolean,
	labels: ReadonlyMap<string, string>,
	store: ReadonlyMap<string, Record<string, unknown>>,
	recordOptions: Record<string, RecordOption[]>
): MapFeatureRecordDetail {
	const visible = entity.fields.filter((f) => !f.hidden);
	const fields: MapFeatureFieldView[] = visible.map((field) => {
		const raw = field.name === 'id' ? row.id : row[field.name];
		const view: MapFeatureFieldView = {
			name: field.name,
			label: field.label,
			valueType: fieldValueType(field),
			value: field.name === 'id' ? id : formValue(field, raw),
			display: field.name === 'id' ? id : fieldDisplay(field, raw, config, labels, store)
		};
		if (field.optional !== undefined) view.optional = field.optional;
		if (field.readOnly) view.readOnly = true;
		if (field.editor !== undefined) view.editor = field.editor;
		if (field.recordTargets?.length) view.recordTargets = field.recordTargets;
		return view;
	});

	const editFields = buildColumns(entity).filter((c) => {
		if (c.id === 'id') return false;
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
	});

	return {
		id,
		table: entity.name,
		tableLabel: entity.label,
		title: titleFromRow(row, id),
		canUpdate: roleCanEdit && Boolean(entity.permissions.update),
		fields,
		editFields,
		recordOptions
	};
}

/**
 * Load one domain record for the map properties overlay.
 * Resolves multi-hop FK labels; loads picker options when the user can edit.
 */
export const getMapFeatureRecord = query(
	z.object({
		id: z.string().min(1)
	}),
	async ({ id }): Promise<MapFeatureRecordDetail | null> => {
		const { locals, fetch } = getRequestEvent();

		if (!locals.session?.isConnected) {
			error(503, 'Database unavailable');
		}

		let recordId: string;
		try {
			const colon = id.indexOf(':');
			if (colon <= 0) error(400, 'Invalid record id');
			const table = id.slice(0, colon);
			if (!isValidTableName(table)) error(400, 'Invalid record id');
			recordId = id.trim();
		} catch {
			error(400, 'Invalid record id');
		}

		const [config, roles] = await Promise.all([
			resolveAppConfig(locals.session),
			getUserRoles(locals.selection.namespace, locals.user, fetch)
		]);
		const roleCanEdit = canEdit(roles);

		const table = tableOfId(recordId);
		if (!table) error(400, 'Invalid record id');

		const entity = entityByName(config, table);
		if (!entity) {
			error(404, `Unknown table: ${table}`);
		}

		let row: Record<string, unknown> | null;
		try {
			row = await queryRecordById(locals.session, recordId);
		} catch (err) {
			if (err instanceof MutateError) {
				error(err.status, err.message);
			}
			throw err;
		}
		if (!row) return null;

		const normalizedId = normalizeRecordId(row.id) || recordId;

		const { labels, store } = await loadRecordLabels(locals.session, config, entity, [row]);

		let recordOptions: Record<string, RecordOption[]> = {};
		if (roleCanEdit && entity.permissions.update) {
			try {
				recordOptions = await loadRecordOptions(locals.session, config, entity);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'record options failed';
				console.warn(`[map] loadRecordOptions ${entity.name}:`, message);
			}
		}

		return buildDetail(
			config,
			entity,
			row,
			normalizedId,
			roleCanEdit,
			labels,
			store,
			recordOptions
		);
	}
);
