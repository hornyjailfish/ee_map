import type { PageServerLoad } from './$types';
import type { ResolvedConfig, ResolvedEntity } from '$lib/config/types';
import { isValidTableName, loadRecordLabels, queryEntities } from '$lib/server/data';
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
	/** Non-fatal load / validation message. */
	error: string | null;
};

function emptyPage(partial?: Partial<TablePageData>): TablePageData {
	return {
		table: null,
		tables: [],
		view: null,
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
		const { labels, store } = await loadRecordLabels(locals.session, config, resolved.entity, rows);
		const view = toTable(resolved.entity, rows, { labels, store, config });
		return {
			table: resolved.table,
			tables,
			view,
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
