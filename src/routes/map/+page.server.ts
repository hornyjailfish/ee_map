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
	patchRecord,
	queryEntities,
	queryLevels,
	type RecordOption
} from '$lib/server/data';
import { buildMapCrudMeta, type MapCrudMeta } from '$lib/transform/map-crud';
import { toMap, type MapFeature, type MapViewModel } from '$lib/transform/to-map';
import { entityByName } from '$lib/transform/to-table';
import {
	createEmbeddingMarker,
	reembedMarkerAfterEdit,
	resolveMarkerContext,
	type MarkerContext
} from '$lib/server/embedding';

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

const updateFeatureSchema = z
	.object({ table: z.string().default(''), id: z.string().default('') })
	.catchall(z.string());

/** Point GeoJSON string (markers). */
const markerPointSchema = z.object({
	point: z.string().default(''),
	level: z.string().default('')
});

const createMarkerSchema = z.object({
	point: z.string().default(''),
	level: z.string().default(''),
	description: z.string().default(''),
	zone: z.string().optional(),
	shop: z.string().optional(),
	image: z.string().optional()
});

/** Parse a Point GeoJSON string → `{ x, y }`, or null when invalid. */
function parsePointGeoJson(raw: string): { x: number; y: number } | null {
	if (!raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as { type?: string; coordinates?: unknown };
		if (typeof parsed.type !== 'string' || parsed.type.toLowerCase() !== 'point') return null;
		const c = parsed.coordinates as unknown;
		if (!Array.isArray(c) || c.length < 2) return null;
		const x = Number(c[0]);
		const y = Number(c[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
		return { x, y };
	} catch {
		return null;
	}
}

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
	mode: 'create' | 'assign' | 'update' | 'props'
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

	// Property panel: any map-layer table with update permission (includes floor plans).
	if (mode === 'props') {
		const onMap = config.map.layers.some((layer) => layer.table === table);
		if (!onMap) {
			throw new MutateError(403, 'readonly_table', `Table '${table}' is not a map layer`);
		}
		if (!entity.permissions.update) {
			throw new MutateError(
				403,
				'readonly_table',
				`Table '${table}' cannot be updated from the map`
			);
		}
		return entity;
	}

	const crud = buildMapCrudMeta(config);
	const spec = crud.byTable[table];
	if (!spec) {
		throw new MutateError(403, 'readonly_table', `Table '${table}' is not a map layer`);
	}
	if (mode === 'create' && !spec.canCreate) {
		throw new MutateError(403, 'readonly_table', `Table '${table}' cannot be created from the map`);
	}
	if ((mode === 'assign' || mode === 'update') && !spec.canUpdate) {
		throw new MutateError(403, 'readonly_table', `Table '${table}' cannot be updated from the map`);
	}
	if (!spec.drawKinds.includes('polygon') && !spec.drawKinds.includes('point')) {
		throw new MutateError(
			400,
			'invalid_geometry',
			`Table '${table}' has no drawable geometry kinds`
		);
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
		const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
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
		const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
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
	},

	/**
	 * Patch scalar / record-link fields on a selected map feature (properties panel).
	 * Form fields: table, id, plus writable column values.
	 */
	updateFeature: async ({ request, locals, fetch }) => {
		const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
		const parsed = updateFeatureSchema.safeParse(form);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const { table, id, ...values } = parsed.data;
		if (!table.trim() || !id.trim()) {
			return fail(400, { code: 'invalid_form', message: 'table and id are required' });
		}

		try {
			const entity = await resolveForMapWrite(locals, fetch, table, 'props');
			await patchRecord(locals.session!, entity, id, values);
			// Editing a marker's description (or image) invalidates its stored vector.
			await reembedMarkerAfterEdit(locals.session!, table, id, Object.keys(values));
			return { ok: true as const, id };
		} catch (err) {
			return failFromError(err);
		}
	},

	/**
	 * Patch geometry on an existing row after vertex edit (no level side-effects).
	 * Form fields: table, id, geometry (JSON Point | Polygon).
	 */
	updateGeometry: async ({ request, locals, fetch }) => {
		const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
		const parsed = assignFeatureSchema.safeParse(form);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const { table, id, geometry } = parsed.data;
		if (!table.trim() || !id.trim() || !geometry.trim()) {
			return fail(400, {
				code: 'invalid_form',
				message: 'table, id, and geometry are required'
			});
		}

		try {
			const entity = await resolveForMapWrite(locals, fetch, table, 'update');
			await patchGeometry(locals.session!, entity, id, geometry);
			return { ok: true as const, id };
		} catch (err) {
			return failFromError(err);
		}
	},

	/**
	 * Resolve auto-generated context (level / zone / rent+shop names + draft
	 * description) for a marker point. EDITOR/OWNER only. Returns JSON.
	 */
	resolveMarkerContext: async ({ request, locals, fetch }) => {
		const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
		const parsed = markerPointSchema.safeParse(form);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const point = parsePointGeoJson(parsed.data.point);
		if (!point) {
			return fail(400, { code: 'invalid_point', message: 'Invalid marker point' });
		}

		try {
			if (!locals.session?.isConnected) {
				throw new MutateError(503, 'db_unavailable', 'Database unavailable');
			}
			const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);
			assertCanEdit(roles);

			const level = parsed.data.level.trim() ? parsed.data.level.trim() : null;
			const context: MarkerContext = await resolveMarkerContext(locals.session, point, level);
			return { ok: true as const, context };
		} catch (err) {
			return failFromError(err);
		}
	},

	/**
	 * Create an embedding-search marker: point + description (+ optional image),
	 * with structured level/zone/shop context. Embedding computed server-side;
	 * on service failure the marker still saves with `embedding_status: failed`.
	 */
	createMarker: async ({ request, locals, fetch }) => {
		const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
		const parsed = createMarkerSchema.safeParse(form);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const point = parsePointGeoJson(parsed.data.point);
		if (!point) {
			return fail(400, { code: 'invalid_point', message: 'Invalid marker point' });
		}
		if (!parsed.data.level.trim()) {
			return fail(400, { code: 'invalid_form', message: 'level is required' });
		}

		try {
			if (!locals.session?.isConnected) {
				throw new MutateError(503, 'db_unavailable', 'Database unavailable');
			}
			const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);
			assertCanEdit(roles);

			const result = await createEmbeddingMarker(locals.session, {
				description: parsed.data.description,
				levelId: parsed.data.level.trim(),
				zoneId: parsed.data.zone?.trim() || null,
				shopId: parsed.data.shop?.trim() || null,
				point,
				image: parsed.data.image?.trim() || null
			});
			return { ok: true as const, id: result.id, embedding: result.status, error: result.error };
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
