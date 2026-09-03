import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ResolvedConfig, ResolvedEntity } from '$lib/config/types';
import {
	assertCanEdit,
	createRecord,
	deleteRecord,
	isValidTableName,
	loadRecordLabels,
	loadRecordOptions,
	MutateError,
	patchRecord,
	queryEntities,
	type RecordOption
} from '$lib/server/data';
import { resolveAppConfig } from '$lib/server/config';
import { getUserRoles } from '$lib/server/catalog';
import { entityByName, toTable, type TableViewModel } from '$lib/transform/to-table';

export type TableOption = {
	name: string;
	label: string;
};

export type TablePageData = {
	/** Active table name (query param or default), null when none available. */
	table: string | null;
	/** Switcher options from resolved config. */
	tables: TableOption[];
	/** Serializable grid model, or null when nothing to show. */
	view: TableViewModel | null;
	/** Record-link picker options keyed by field name (add-row form). */
	recordOptions: Record<string, RecordOption[]>;
	/** Non-fatal load / validation message. */
	error: string | null;
};

function emptyPage(partial?: Partial<TablePageData>): TablePageData {
	return {
		table: null,
		tables: [],
		view: null,
		recordOptions: {},
		error: null,
		...partial
	};
}

function tableOptions(config: ResolvedConfig): TableOption[] {
	return config.tables.map((t) => ({ name: t.name, label: t.label }));
}

/** Prefer electric_rooms when present; else first resolved table. */
function pickDefaultTable(config: ResolvedConfig): string | null {
	if (config.tables.length === 0) return null;
	const preferred = config.tables.find((t) => t.name === 'electric_rooms');
	return (preferred ?? config.tables[0])!.name;
}

function resolveEntity(
	config: ResolvedConfig,
	requested: string | null
): { entity: ResolvedEntity | null; table: string | null; error: string | null } {
	const tables = config.tables;
	if (tables.length === 0) {
		return { entity: null, table: null, error: 'No tables in resolved config' };
	}

	const fallback = pickDefaultTable(config);
	const name = (requested && requested.trim()) || fallback;

	if (!name) {
		return { entity: null, table: null, error: 'No tables in resolved config' };
	}

	if (!isValidTableName(name)) {
		return {
			entity: null,
			table: fallback,
			error: `Invalid table name: ${name}`
		};
	}

	const entity = entityByName(config, name);
	if (!entity) {
		return {
			entity: entityByName(config, fallback!) ?? null,
			table: fallback,
			error: `Unknown table: ${name}`
		};
	}

	return { entity, table: entity.name, error: null };
}

/** Resolve the signed-in user's roles + the active entity for a write action. */
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
	return entity;
}

function failFromError(error: unknown) {
	if (error instanceof MutateError) {
		return fail(error.status, { code: error.code, message: error.message });
	}
	const message = error instanceof Error ? error.message : 'Write failed';
	console.warn('[table] write failed:', message);
	return fail(500, { code: 'write_failed', message });
}

export const actions: Actions = {
	updateCell: async ({ request, locals, fetch }) => {
		const data = await request.formData();
		const table = data.get('table');
		const id = String(data.get('id') ?? '');
		const field = String(data.get('field') ?? '');
		const value = data.get('value');

		try {
			const entity = await resolveForWrite(locals, fetch, table);
			await patchRecord(locals.session!, entity, id, { [field]: value });
			return { ok: true };
		} catch (error) {
			return failFromError(error);
		}
	},

	addRow: async ({ request, locals, fetch }) => {
		const data = await request.formData();
		const table = data.get('table');
		const values: Record<string, unknown> = {};
		for (const [key, value] of data.entries()) {
			if (key === 'table') continue;
			values[key] = value;
		}

		try {
			const entity = await resolveForWrite(locals, fetch, table);
			const id = await createRecord(locals.session!, entity, values);
			return { ok: true, id };
		} catch (error) {
			return failFromError(error);
		}
	},

	deleteRow: async ({ request, locals, fetch }) => {
		const data = await request.formData();
		const table = data.get('table');
		const id = String(data.get('id') ?? '');

		try {
			const entity = await resolveForWrite(locals, fetch, table);
			await deleteRecord(locals.session!, entity, id);
			return { ok: true };
		} catch (error) {
			return failFromError(error);
		}
	}
};

export const load: PageServerLoad = async ({ parent, locals, url }): Promise<TablePageData> => {
	const layout = await parent();
	const config = layout.config;
	const configError = layout.configError ?? null;
	const requested = url.searchParams.get('table');

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

	const tables = tableOptions(config);
	const resolved = resolveEntity(config, requested);

	if (!resolved.entity || !resolved.table) {
		return emptyPage({
			tables,
			table: resolved.table,
			error: resolved.error ?? configError
		});
	}

	if (!locals.session?.isConnected) {
		return emptyPage({
			tables,
			table: resolved.table,
			error: locals.dbError ?? 'Database unavailable'
		});
	}

	try {
		const rows = await queryEntities(locals.session, resolved.table);
		const [{ labels, store }, recordOptions] = await Promise.all([
			loadRecordLabels(locals.session, config, resolved.entity, rows),
			loadRecordOptions(locals.session, config, resolved.entity)
		]);
		const view = toTable(resolved.entity, rows, { labels, store, config });
		return {
			table: resolved.table,
			tables,
			view,
			recordOptions,
			error: resolved.error
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load table rows';
		console.warn('[table] queryEntities failed:', message);
		return emptyPage({
			tables,
			table: resolved.table,
			error: message
		});
	}
};
