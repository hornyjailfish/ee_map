import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import type { ResolvedConfig, ResolvedEntity } from '$lib/config/types';
import { canEdit } from '$lib/roles';
import { getUserRoles } from '$lib/server/catalog';
import { resolveAppConfig } from '$lib/server/config';
import {
	assertCanEdit,
	geometryFieldName,
	isValidTableName,
	MutateError,
	patchGeometry,
	queryEntities,
	queryLevels
} from '$lib/server/data';
import {
	listGeoSources,
	loadGeoLayer,
	type GeoAssignLayer,
	type GeoSourceMeta
} from '$lib/server/geo-files';
import { displayValue, entityByName, normalizeRecordId } from '$lib/transform/to-table';

const assignSchema = z.object({
	table: z.string().default(''),
	id: z.string().default(''),
	geometry: z.string().default(''),
	/** Optional level record id to set alongside geometry when the table has a level field. */
	level: z.string().nullable().default(null)
});

export type AssignTableOption = {
	name: string;
	label: string;
	geometryField: string;
	levelField: string | null;
	/** Visible field names for the record list (id always first). */
	fields: Array<{ name: string; label: string; type: string }>;
};

export type AssignRecordRow = {
	id: string;
	/** Display cells for visible non-geometry fields. */
	cells: Record<string, unknown>;
	/** Compact geometry status for the list. */
	hasGeometry: boolean;
	levelId: string | null;
};

export type AssignPageData = {
	sources: GeoSourceMeta[];
	/** Selected source folder + name. */
	sourceFolder: string | null;
	sourceName: string | null;
	layer: GeoAssignLayer | null;
	/** Tables that can receive geometry. */
	tables: AssignTableOption[];
	table: string | null;
	records: AssignRecordRow[];
	levels: Array<{ id: string; name?: string; ord?: number }>;
	error: string | null;
};

function emptyPage(partial?: Partial<AssignPageData>): AssignPageData {
	return {
		sources: [],
		sourceFolder: null,
		sourceName: null,
		layer: null,
		tables: [],
		table: null,
		records: [],
		levels: [],
		error: null,
		...partial
	};
}

/** Entities with an updatable geometry field (map-enabled preferred). */
function geometryTables(config: ResolvedConfig): AssignTableOption[] {
	const out: AssignTableOption[] = [];
	for (const entity of config.tables) {
		const geom = geometryFieldName(entity);
		if (!geom) continue;
		if (!entity.permissions.update) continue;

		const levelField =
			entity.map?.levelField && entity.fields.some((f) => f.name === entity.map?.levelField)
				? entity.map.levelField
				: (entity.fields.find((f) => f.name === 'level' && f.type === 'record')?.name ?? null);

		const fields = entity.fields
			.filter((f) => !f.hidden && f.name !== 'id' && f.type !== 'geometry')
			.map((f) => ({ name: f.name, label: f.label, type: f.type }));

		out.push({
			name: entity.name,
			label: entity.label,
			geometryField: geom,
			levelField,
			fields
		});
	}

	// Prefer map-enabled entities first, then label
	out.sort((a, b) => {
		const ae = entityByName(config, a.name);
		const be = entityByName(config, b.name);
		const am = ae?.map?.enabled ? 0 : 1;
		const bm = be?.map?.enabled ? 0 : 1;
		if (am !== bm) return am - bm;
		return a.label.localeCompare(b.label);
	});

	return out;
}

function pickDefaultTable(tables: AssignTableOption[]): string | null {
	if (tables.length === 0) return null;
	const preferred = tables.find((t) => t.name === 'rents') ?? tables.find((t) => t.name === 'zones');
	return (preferred ?? tables[0])!.name;
}

function pickDefaultSource(sources: GeoSourceMeta[]): { folder: string; name: string } | null {
	if (sources.length === 0) return null;
	const preferred =
		sources.find((s) => s.folder === '1' && s.name === 'shops') ??
		sources.find((s) => s.name === 'shops') ??
		sources[0];
	return preferred ? { folder: preferred.folder, name: preferred.name } : null;
}

function mapRecords(
	_entity: ResolvedEntity,
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

function mapLevels(
	rows: Array<Record<string, unknown>>
): Array<{ id: string; name?: string; ord?: number }> {
	const levels = rows.map((row) => {
		const id = normalizeRecordId(row.id);
		const level: { id: string; name?: string; ord?: number } = { id: id || String(row.id ?? '') };
		if (typeof row.name === 'string') level.name = row.name;
		if (typeof row.ord === 'number' && Number.isFinite(row.ord)) level.ord = row.ord;
		return level;
	});
	levels.sort((a, b) => {
		if (a.ord != null && b.ord != null && a.ord !== b.ord) return a.ord - b.ord;
		if (a.ord != null && b.ord == null) return -1;
		if (a.ord == null && b.ord != null) return 1;
		return a.id.localeCompare(b.id);
	});
	return levels;
}

async function resolveForWrite(locals: App.Locals, fetch: typeof globalThis.fetch, table: unknown) {
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
	return entity;
}

function failFromError(err: unknown) {
	if (err instanceof MutateError) {
		return fail(err.status, { code: err.code, message: err.message });
	}
	const message = err instanceof Error ? err.message : 'Write failed';
	console.warn('[map/assign] write failed:', message);
	return fail(500, { code: 'write_failed', message });
}

export const actions: Actions = {
	assign: async ({ request, locals, fetch }) => {
		const parsed = assignSchema.safeParse(Object.fromEntries((await request.formData()).entries()));
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const { table, id, geometry, level } = parsed.data;

		try {
			const entity = await resolveForWrite(locals, fetch, table);
			const extra: Record<string, unknown> = {};
			const levelField =
				entity.map?.levelField && entity.fields.some((f) => f.name === entity.map?.levelField)
					? entity.map.levelField
					: entity.fields.find((f) => f.name === 'level' && f.type === 'record')?.name;
			if (levelField && level && level.trim()) {
				extra[levelField] = level.trim();
			}
			await patchGeometry(locals.session!, entity, id, geometry, extra);
			return { ok: true as const };
		} catch (err) {
			return failFromError(err);
		}
	}
};

export const load: PageServerLoad = async ({ parent, locals, url }): Promise<AssignPageData> => {
	const layout = await parent();
	const roles = layout.userRoles ?? [];

	if (!canEdit(roles)) {
		error(403, 'Geometry assignment requires EDITOR or OWNER role');
	}

	const config = layout.config;
	const configError = layout.configError ?? null;

	if (!config) {
		return emptyPage({
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
			error: locals.dbError ?? 'Database unavailable'
		});
	}

	const sources = await listGeoSources();
	const tables = geometryTables(config);

	const requestedFolder = url.searchParams.get('folder');
	const requestedName = url.searchParams.get('file');
	const requestedTable = url.searchParams.get('table');

	const defaultSource = pickDefaultSource(sources);
	const sourceFolder =
		requestedFolder && sources.some((s) => s.folder === requestedFolder)
			? requestedFolder
			: (defaultSource?.folder ?? null);
	const sourceName =
		requestedName &&
		sourceFolder &&
		sources.some((s) => s.folder === sourceFolder && s.name === requestedName)
			? requestedName
			: sourceFolder
				? (sources.find((s) => s.folder === sourceFolder)?.name ?? defaultSource?.name ?? null)
				: (defaultSource?.name ?? null);

	const table =
		requestedTable && tables.some((t) => t.name === requestedTable)
			? requestedTable
			: pickDefaultTable(tables);

	let layer: GeoAssignLayer | null = null;
	let loadError: string | null = null;

	if (sourceFolder && sourceName) {
		try {
			layer = await loadGeoLayer(sourceFolder, sourceName);
			if (!layer) {
				loadError = `Geo file not found: ${sourceFolder}/${sourceName}.geojson`;
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load geo file';
		}
	}

	let records: AssignRecordRow[] = [];
	const tableOpt = table ? tables.find((t) => t.name === table) : null;
	const entity = table ? entityByName(config, table) : null;

	if (tableOpt && entity) {
		try {
			const rows = await queryEntities(locals.session, tableOpt.name);
			records = mapRecords(entity, tableOpt, rows);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load records';
			loadError = loadError ? `${loadError}; ${message}` : message;
		}
	}

	let levels: AssignPageData['levels'] = [];
	const levelsTable = config.map.levelsTable;
	if (isValidTableName(levelsTable)) {
		try {
			levels = mapLevels(await queryLevels(locals.session, levelsTable));
		} catch {
			// non-fatal
		}
	}

	return {
		sources,
		sourceFolder,
		sourceName,
		layer,
		tables,
		table,
		records,
		levels,
		error: loadError
	};
};
