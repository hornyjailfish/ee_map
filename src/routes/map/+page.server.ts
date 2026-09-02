import type { PageServerLoad } from './$types';
import type { ResolvedConfig } from '$lib/config/types';
import { isValidTableName, queryEntities, queryLevels } from '$lib/server/data';
import { toMap, type MapFeature, type MapViewModel } from '$lib/transform/to-map';

export type MapPageData = {
	/** Active level filter from `?level=`; null = all levels. */
	levelId: string | null;
	/** Serializable indoor map model, or null when nothing to show. */
	view: MapViewModel | null;
	/** Non-fatal load / validation message. */
	error: string | null;
};

function emptyPage(partial?: Partial<MapPageData>): MapPageData {
	return {
		levelId: null,
		view: null,
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

export const load: PageServerLoad = async ({ parent, locals, url }): Promise<MapPageData> => {
	const layout = await parent();
	const config = layout.config;
	const configError = layout.configError ?? null;
	const levelId = parseLevelParam(url.searchParams.get('level'));

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

		return {
			levelId,
			view,
			error: null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load map data';
		console.warn('[map] load failed:', message);
		return emptyPage({
			levelId,
			error: message
		});
	}
};
