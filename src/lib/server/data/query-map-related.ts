/**
 * Load inverse-linked rows for map layer `related` config.
 * Geometry stays on the layer table; related tables point at it (e.g. shops.area → rents).
 * No Surreal REFERENCE / schema change required — plain FK filter.
 */
import type { Surreal } from 'surrealdb';
import type { ResolvedConfig, ResolvedEntity, ResolvedMapLayerRelated } from '$lib/config/types';
import { normalizeRecordId } from '$lib/transform/to-table';
import { isValidFieldName } from './query-entities-search';
import { isValidTableName, queryEntities } from './query-entities';
import {
	createRecord,
	MutateError,
	patchRecord,
	tableOfId,
	validateRecordId
} from './mutate';
import { loadRecordLabels, type RecordOption } from './record-labels';

export type MapRelatedRow = {
	/** Related record id (e.g. shops:…). */
	id: string;
	/** Layer feature id this row points at (e.g. rents:…). */
	targetId: string;
	/** Display label from related.labelField. */
	label: string;
};

/**
 * Unique related specs from enabled map layers (skip invalid identifiers).
 */
export function relatedSpecsFromConfig(config: ResolvedConfig): ResolvedMapLayerRelated[] {
	const seen = new Set<string>();
	const out: ResolvedMapLayerRelated[] = [];
	for (const layer of config.map.layers) {
		const rel = layer.related;
		if (!rel) continue;
		if (!isValidTableName(rel.table) || !isValidFieldName(rel.via)) continue;
		if (!isValidFieldName(rel.labelField)) continue;
		const key = `${rel.table}\0${rel.via}\0${rel.labelField}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(rel);
	}
	return out;
}

/**
 * Fetch related rows for one spec. Returns label map keyed by **target** (layer) id.
 */
export async function queryRelatedLabelMap(
	session: Surreal,
	related: ResolvedMapLayerRelated
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (!isValidTableName(related.table)) return out;
	if (!isValidFieldName(related.via) || !isValidFieldName(related.labelField)) return out;

	// Identifiers interpolated only after allowlist checks above.
	const sql =
		`SELECT id, ${related.via} AS target, ${related.labelField} AS label ` +
		`FROM type::table($table) WHERE ${related.via} IS NOT NONE`;

	try {
		const result = await session.query<Record<string, unknown>[][]>(sql, {
			table: related.table
		});
		const rows = Array.isArray(result?.[0]) ? result[0] : [];
		for (const row of rows) {
			const targetId = normalizeRecordId(row.target);
			if (!targetId) continue;
			const label =
				typeof row.label === 'string'
					? row.label.trim()
					: row.label != null
						? String(row.label).trim()
						: '';
			if (!label) continue;
			// 1:1 — last write wins if duplicates exist
			out.set(targetId, label);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'related query failed';
		console.warn(`[map] related ${related.table}.${related.via}:`, message);
	}

	return out;
}

/**
 * Load all related label maps for the config and merge into one feature-id → label map.
 */
export async function loadMapRelatedLabels(
	session: Surreal,
	config: ResolvedConfig
): Promise<Map<string, string>> {
	const specs = relatedSpecsFromConfig(config);
	if (specs.length === 0) return new Map();

	const merged = new Map<string, string>();
	await Promise.all(
		specs.map(async (spec) => {
			const part = await queryRelatedLabelMap(session, spec);
			for (const [id, label] of part) merged.set(id, label);
		})
	);
	return merged;
}

/**
 * Find the related row pointing at a specific layer feature (1:1).
 */
export async function queryRelatedForTarget(
	session: Surreal,
	related: ResolvedMapLayerRelated,
	targetId: string
): Promise<MapRelatedRow | null> {
	if (!isValidTableName(related.table)) return null;
	if (!isValidFieldName(related.via) || !isValidFieldName(related.labelField)) return null;
	if (!targetId.trim()) return null;

	const sql =
		`SELECT id, ${related.via} AS target, ${related.labelField} AS label ` +
		`FROM type::table($table) WHERE ${related.via} = type::record($target) LIMIT 1`;

	try {
		const result = await session.query<Record<string, unknown>[][]>(sql, {
			table: related.table,
			target: targetId
		});
		const rows = Array.isArray(result?.[0]) ? result[0] : [];
		const row = rows[0];
		if (!row) return null;
		const id = normalizeRecordId(row.id);
		const t = normalizeRecordId(row.target) || targetId;
		const label =
			typeof row.label === 'string'
				? row.label.trim()
				: row.label != null
					? String(row.label).trim()
					: '';
		if (!id) return null;
		return { id, targetId: t, label };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'related target query failed';
		console.warn(`[map] relatedForTarget ${related.table}:`, message);
		return null;
	}
}

/** Layer.related for a table, if configured. */
export function relatedForLayerTable(
	config: ResolvedConfig,
	table: string
): ResolvedMapLayerRelated | undefined {
	return config.map.layers.find((l) => l.table === table)?.related;
}

/** All rows of a related table as picker options (display recipe labels). */
export async function loadRelatedTableOptions(
	session: Surreal,
	config: ResolvedConfig,
	entity: ResolvedEntity
): Promise<RecordOption[]> {
	const rows = await queryEntities(session, entity.name);
	const { labels } = await loadRecordLabels(session, config, entity, rows);
	const opts: RecordOption[] = [];
	for (const row of rows) {
		const id = normalizeRecordId(row.id);
		if (!id) continue;
		const fromLabel = labels.get(id);
		const fallback =
			typeof row.name === 'string' && row.name.trim()
				? row.name.trim()
				: id;
		opts.push({ id, label: fromLabel || fallback });
	}
	opts.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
	return opts;
}

export type LinkRelatedInput = {
	/** Layer feature id (e.g. rents:…). */
	featureId: string;
	/** Existing related id to attach, or empty to leave vacant (ignored when createName set). */
	relatedId?: string;
	/** When non-empty, create a new related row instead of picking relatedId. */
	createName?: string;
};

export type LinkRelatedResult = {
	relatedId: string | null;
};

/**
 * 1:1 inverse link: clear any previous related row pointing at `featureId`, then
 * attach `relatedId` or create a new row with `createName`.
 * Writes only the related table's FK (`via`) — geometry stays on the layer table.
 */
export async function linkRelatedToFeature(
	session: Surreal,
	config: ResolvedConfig,
	layerTable: string,
	input: LinkRelatedInput
): Promise<LinkRelatedResult> {
	const relatedSpec = relatedForLayerTable(config, layerTable);
	if (!relatedSpec) {
		throw new MutateError(400, 'no_related', `Table '${layerTable}' has no map.related config`);
	}

	const relatedEntity = config.tables.find((e) => e.name === relatedSpec.table);
	if (!relatedEntity) {
		throw new MutateError(404, 'unknown_table', `Unknown related table: ${relatedSpec.table}`);
	}

	const featureId = validateRecordId(input.featureId);
	const createName = input.createName?.trim() ?? '';
	const relatedIdRaw = input.relatedId?.trim() ?? '';

	const previous = await queryRelatedForTarget(session, relatedSpec, featureId);

	const clearVia = async (id: string) => {
		await patchRecord(session, relatedEntity, id, { [relatedSpec.via]: '' });
	};

	// Create new related row pointing at this feature.
	if (createName) {
		if (!relatedEntity.permissions.create) {
			throw new MutateError(
				403,
				'readonly_table',
				`Table '${relatedEntity.name}' cannot be created from the map`
			);
		}
		if (previous && previous.id) {
			await clearVia(previous.id);
		}
		const values: Record<string, unknown> = {
			[relatedSpec.labelField]: createName,
			[relatedSpec.via]: featureId
		};
		const id = await createRecord(session, relatedEntity, values);
		return { relatedId: id };
	}

	// Clear / vacant.
	if (!relatedIdRaw) {
		if (previous?.id) {
			if (!relatedEntity.permissions.update) {
				throw new MutateError(
					403,
					'readonly_table',
					`Table '${relatedEntity.name}' cannot be updated from the map`
				);
			}
			await clearVia(previous.id);
		}
		return { relatedId: null };
	}

	// Attach existing related row.
	if (!relatedEntity.permissions.update) {
		throw new MutateError(
			403,
			'readonly_table',
			`Table '${relatedEntity.name}' cannot be updated from the map`
		);
	}

	const relatedId = validateRecordId(relatedIdRaw);
	if (tableOfId(relatedId) !== relatedEntity.name) {
		throw new MutateError(
			400,
			'invalid_id',
			`Related id must be on table '${relatedEntity.name}'`
		);
	}

	if (previous?.id && previous.id !== relatedId) {
		await clearVia(previous.id);
	}

	if (previous?.id !== relatedId) {
		await patchRecord(session, relatedEntity, relatedId, {
			[relatedSpec.via]: featureId
		});
	}

	return { relatedId };
}
