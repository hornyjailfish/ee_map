import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import type { ResolvedConfig, ResolvedEntity } from '$lib/config/types';
import { canEdit } from '$lib/roles';
import { getUserRoles } from '$lib/server/catalog';
import { resolveAppConfig } from '$lib/server/config';
import {
	assertCanEdit,
	createRecord,
	geometryFieldName,
	isValidTableName,
	loadRecordOptions,
	MutateError,
	patchGeometry,
	queryEntities,
	queryLevels,
	type RecordOption
} from '$lib/server/data';
import { buildMapCrudMeta, type MapCrudMeta } from '$lib/transform/map-crud';
import { toMap, type MapFeature, type MapViewModel } from '$lib/transform/to-map';
import { entityByName } from '$lib/transform/to-table';

export type MapPageData = {
	/** Active level filter from `?level=`; null = all levels. */
	levelId: string | null;
	/** Serializable indoor map model, or null when nothing to show. */
	view: MapViewModel | null;
	/** Create/update gates for map geometry tools (EDITOR+). */
	crud: MapCrudMeta | null;
	/**
	 * Record-link options for create modal fields, keyed by table → field.
	 * Empty for VIEWER (no create UI).
	 */
	recordOptionsByTable: Record<string, Record<string, RecordOption[]>>;
	/** Non-fatal load / validation message. */
	error: string | null;
};

const createFeatureSchema = z.object({
	table: z.string().default(''),
	/** GeoJSON string (Point or Polygon). */
	geometry: z.string().default('')
});

const assignFeatureSchema = z.object({
	table: z.string().default(''),
	id: z.string().default(''),
	/** GeoJSON string (Point or Polygon). */
	geometry: z.string().default(''),
	/** Optional level record id written with geometry when the table has a level field. */
	level: z.string().optional()
});

function emptyPage(partial?: Partial<MapPageData>): MapPageData {
	return {
		levelId: null,
		view: null,
		crud: null,
		recordOptionsByTable: {},
		error: null,
		...partial
	};
}

/** Keep payload lean and JSON-safe (drop Surreal RecordIds / fat row copies). */
function slimFeature(feature: MapFeature): MapFeature {
	const name =
		typeof feature.label === 'string'
			? feature.label
			: typeof feature.properties?.name === 'string'
				? feature.properties.name
				: undefined;

	const slim: MapFeature = {
		id: feature.id,
		table: feature.table,
		levelId: feature.levelId,
		geometry: feature.geometry,
		properties: name !== undefined ? { name } : {},
		styleKey: feature.styleKey,
		zIndex: feature.zIndex
	};

	if (feature.label !== undefined) slim.label = feature.label;
	if (feature.layerGroup !== undefined) slim.layerGroup = feature.layerGroup;

	return slim;
}

function slimView(view: MapViewModel): MapViewModel {
	return {
		...view,
		layers: view.layers.map((layer) => ({
			...layer,
			features: layer.features.map(slimFeature)
		}))
	};
}

/** Tables appearing in enabled map layers (unique, allowlisted). */
function layerTables(config: ResolvedConfig): string[] {
	const names = new Set<string>();
	for (const layer of config.map.layers) {
		if (isValidTableName(layer.table)) names.add(layer.table);
	}
	return [...names];
}

/** Parse `?level=`; empty / missing → null (all levels). */
function parseLevelParam(raw: string | null): string | null {
	if (raw == null) return null;
	const trimmed = raw.trim();
	return trimmed === '' ? null : trimmed;
}

async function resolveForMapWrite(
	locals: App.Locals,
	fetch: typeof globalThis.fetch,
	table: unknown,
	mode: 'create' | 'assign'
): Promise<ResolvedEntity> {
	if (!locals.session?.isConnected) {
		throw new MutateError(503, 'db_unavailable', 'Database unavailable');
	}
	if (typeof table !== 'string' || !isValidTableName(table)) {
		throw new MutateError(400, 'invalid_table', 'Invalid table name');
	}

	const [config, roles] = await Promise.all([
		resolveAppConfig(locals.session),
		getUserRoles(locals.selection.namespace, locals.user, fetch)
	]);

	assertCanEdit(roles);

	const entity = entityByName(config, table);
	if (!entity) {
		throw new MutateError(404, 'unknown_table', `Unknown table: ${table}`);
	}
	if (!geometryFieldName(entity)) {
		throw new MutateError(400, 'no_geometry_field', `Table '${table}' has no geometry field`);
	}

	const crud = buildMapCrudMeta(config);
	const spec = crud.byTable[table];
	if (!spec) {
		throw new MutateError(403, 'readonly_table', `Table '${table}' is not a map layer`);
	}
	if (mode === 'create' && !spec.canCreate) {
		throw new MutateError(403, 'readonly_table', `Table '${table}' cannot be created from the map`);
	}
	if (mode === 'assign' && !spec.canUpdate) {
		throw new MutateError(403, 'readonly_table', `Table '${table}' cannot be updated from the map`);
	}
	if (!spec.drawKinds.includes('polygon') && !spec.drawKinds.includes('point')) {
		throw new MutateError(400, 'invalid_geometry', `Table '${table}' has no drawable geometry kinds`);
	}

	return entity;
}

function failFromError(err: unknown) {
	if (err instanceof MutateError) {
		return fail(err.status, { code: err.code, message: err.message });
	}
	const message = err instanceof Error ? err.message : 'Write failed';
	console.warn('[map] write failed:', message);
	return fail(500, { code: 'write_failed', message });
}

/**
	 * Load record-link options for create targets (level picker, etc.).
	 * Skipped when the user cannot edit.
	 */
	async function loadCreateRecordOptions(
		session: NonNullable<App.Locals['session']>,
		config: ResolvedConfig,
		crud: MapCrudMeta
	): Promise<Record<string, Record<string, RecordOption[]>>> {
		const out: Record<string, Record<string, RecordOption[]>> = {};

		await Promise.all(
			crud.drawTargets
				.filter((spec) => spec.canCreate)
				.map(async (spec) => {
					const entity = entityByName(config, spec.table);
					if (!entity) return;
					try {
						const opts = await loadRecordOptions(session, config, entity);
						if (Object.keys(opts).length > 0) {
							out[spec.table] = opts;
						}
					} catch (err) {
						const message = err instanceof Error ? err.message : 'record options failed';
						console.warn(`[map] loadRecordOptions ${spec.table}:`, message);
					}
				})
		);

		return out;
	}

	export const actions: Actions = {
		/**
		 * Create a new domain row with geometry from the map draw tool.
		 * Form fields: table, geometry (JSON string), plus writable scalars/records.
		 */
		createFeature: async ({ request, locals, fetch }) => {
			const form = Object.fromEntries((await request.formData()).entries()) as Record<
				string,
				string
			>;
			const parsed = createFeatureSchema.safeParse(form);
			if (!parsed.success) {
				return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
			}
			const { table, geometry } = parsed.data;
			if (!table.trim() || !geometry.trim()) {
				return fail(400, { code: 'invalid_form', message: 'table and geometry are required' });
			}

			try {
				const entity = await resolveForMapWrite(locals, fetch, table, 'create');
				const geomName = geometryFieldName(entity);
				if (!geomName) {
					throw new MutateError(400, 'no_geometry_field', `Table '${table}' has no geometry field`);
				}

				const values: Record<string, unknown> = { [geomName]: geometry };
				for (const [key, value] of Object.entries(form)) {
					if (key === 'table' || key === 'geometry') continue;
					values[key] = value;
				}

				const id = await createRecord(locals.session!, entity, values);
				return { ok: true as const, id };
			} catch (err) {
				return failFromError(err);
			}
		},

		/**
		 * Attach drawn geometry to an existing row (empty-geometry backfill / replace).
		 * Form fields: table, id, geometry (JSON), optional level.
		 */
		assignFeature: async ({ request, locals, fetch }) => {
			const form = Object.fromEntries((await request.formData()).entries()) as Record<
				string,
				string
			>;
			const parsed = assignFeatureSchema.safeParse(form);
			if (!parsed.success) {
				return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
			}
			const { table, id, geometry, level } = parsed.data;
			if (!table.trim() || !id.trim() || !geometry.trim()) {
				return fail(400, {
					code: 'invalid_form',
					message: 'table, id, and geometry are required'
				});
			}

			try {
				const entity = await resolveForMapWrite(locals, fetch, table, 'assign');
				const extra: Record<string, unknown> = {};
				const levelField =
					entity.map?.levelField && entity.fields.some((f) => f.name === entity.map?.levelField)
						? entity.map.levelField
						: entity.fields.find((f) => f.name === 'level' && f.type === 'record')?.name;
				if (levelField && level && level.trim()) {
					extra[levelField] = level.trim();
				}
				await patchGeometry(locals.session!, entity, id, geometry, extra);
				return { ok: true as const, id };
			} catch (err) {
				return failFromError(err);
			}
		}
	};

export const load: PageServerLoad = async ({ parent, locals, url }): Promise<MapPageData> => {
	const layout = await parent();
	const config = layout.config;
	const configError = layout.configError ?? null;
	const levelId = parseLevelParam(url.searchParams.get('level'));
	const roles = layout.userRoles ?? [];
	const roleCanEdit = canEdit(roles);

	if (!config) {
		return emptyPage({
			levelId,
			error:
				configError ??
				locals.dbError ??
				(locals.session?.isConnected
					? 'Config unavailable'
					: 'No resolved config (session offline)')
		});
	}

	if (!locals.session?.isConnected) {
		return emptyPage({
			levelId,
			error: locals.dbError ?? 'Database unavailable'
		});
	}

	const session = locals.session;
	const tables = layerTables(config);
	const levelsTable = config.map.levelsTable;
	const crud = roleCanEdit ? buildMapCrudMeta(config) : null;

	try {
		const entities: Record<string, Array<Record<string, unknown>>> = {};

		await Promise.all(
			tables.map(async (table) => {
				entities[table] = await queryEntities(session, table);
			})
		);

		let levels: Array<Record<string, unknown>> | undefined;
		if (isValidTableName(levelsTable)) {
			try {
				levels = await queryLevels(session, levelsTable);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to load levels';
				console.warn('[map] queryLevels failed:', message);
				// Non-fatal: map still loads without switcher options
			}
		}

		const view = slimView(
			toMap({
				config,
				entities,
				levels,
				levelId
			})
		);

		let recordOptionsByTable: Record<string, Record<string, RecordOption[]>> = {};
		if (crud && crud.drawTargets.some((t) => t.canCreate)) {
			recordOptionsByTable = await loadCreateRecordOptions(session, config, crud);
		}

		return {
			levelId,
			view,
			crud,
			recordOptionsByTable,
			error: null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load map data';
		console.warn('[map] load failed:', message);
		return emptyPage({
			levelId,
			crud,
			error: message
		});
	}
};
