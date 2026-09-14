/**
 * Entity text search via SurrealQL string functions.
 *
 * Why not bare `string::similarity::fuzzy` as ORDER BY?
 * That score is not a normalized 0–1 quality rank — longer near-matches
 * (e.g. "A21" vs query "A2") can outrank exact "A2". Surreal's distance
 * functions are the right ranking primitive for short labels.
 *
 * Match strategy (no SEARCH index required):
 * - include row if any field contains the needle, OR levenshtein distance is small
 * - order: exact → prefix → shorter label → lower distance → alphabetically
 *
 * Field identifiers are interpolated only after {@link isValidFieldName}.
 */

import type { Surreal } from 'surrealdb';
import type { ResolvedConfig, ResolvedEntity } from '$lib/config/types';
import { DEFAULT_ENTITY_LIMIT, isValidTableName, queryEntities } from './query-entities';

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Soft default for interactive typeahead. */
export const DEFAULT_SEARCH_LIMIT = 100;

/**
 * Max levenshtein edits for fuzzy include (typos). Contains-matches always include.
 * Kept small so short codes don't pull unrelated rows.
 */
export const DEFAULT_MAX_DISTANCE = 2;

export function isValidFieldName(name: string): boolean {
	return typeof name === 'string' && FIELD_NAME_RE.test(name);
}

export type QueryEntitiesSearchOptions = {
	limit?: number;
	/** Max edit distance for non-contains fuzzy hits (default {@link DEFAULT_MAX_DISTANCE}). */
	maxDistance?: number;
	/** Allowlisted field names to search. */
	fields?: string[];
};

/**
 * Resolve searchable field names: config.search.fieldsByTable → name → string fields.
 */
export function resolveSearchFields(
	config: ResolvedConfig,
	entity: ResolvedEntity,
	extra?: string[]
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();

	const push = (name: string | undefined | null) => {
		if (!name || !isValidFieldName(name) || seen.has(name)) return;
		if (!entity.fields.some((f) => f.name === name)) return;
		seen.add(name);
		out.push(name);
	};

	for (const name of config.search.fieldsByTable[entity.name] ?? []) push(name);
	for (const name of extra ?? []) push(name);

	if (out.length === 0) {
		push(entity.fields.find((f) => f.name === 'name')?.name);
		for (const f of entity.fields) {
			if (f.hidden || f.name === 'id' || f.type === 'geometry') continue;
			if (f.type === 'string' || f.type === 'array') push(f.name);
			if (out.length >= 6) break;
		}
	}

	return out;
}

/**
 * Lowercased searchable text for a field.
 * Arrays (e.g. aliases) become a space-joined string via array::join.
 */
function fieldText(field: string, entityFields: ResolvedEntity['fields'] | undefined): string {
	const meta = entityFields?.find((f) => f.name === field);
	if (meta?.type === 'array') {
		return `string::lowercase(array::join(${field} ?? [], " "))`;
	}
	return `string::lowercase(type::string(${field}) ?? "")`;
}

/**
 * Search rows in `table`. Empty `q` → plain {@link queryEntities}.
 *
 * Pass `entityFields` when available so array fields use array::join.
 */
export async function queryEntitiesSearch(
	session: Surreal,
	table: string,
	q: string,
	opts?: QueryEntitiesSearchOptions & {
		entityFields?: ResolvedEntity['fields'];
	}
): Promise<Record<string, unknown>[]> {
	if (!isValidTableName(table)) {
		throw new Error(`Invalid table name: ${table}`);
	}

	const limit = opts?.limit ?? DEFAULT_SEARCH_LIMIT;
	if (!Number.isFinite(limit) || limit < 0) {
		throw new Error(`Invalid limit: ${limit}`);
	}

	const needle = q.trim().toLowerCase();
	if (!needle) {
		return queryEntities(session, table, {
			limit: Math.min(limit, DEFAULT_ENTITY_LIMIT)
		});
	}

	const fields = (opts?.fields ?? []).filter(isValidFieldName);
	if (fields.length === 0) {
		return [];
	}

	const maxDistance = opts?.maxDistance ?? DEFAULT_MAX_DISTANCE;
	const texts = fields.map((f) => fieldText(f, opts?.entityFields));

	// Best (minimum) edit distance across fields — exact match ⇒ 0.
	const distParts = texts.map((t) => `string::distance::levenshtein(${t}, $q)`);
	const bestDist = `math::min([${distParts.join(', ')}])`;

	// Shortest field length among those that contain / prefix the query (for tie-break).
	// Prefer exact equality, then prefix, then other contains, then pure-distance hits.
	const rankParts = texts.map((t) => {
		return `(
			IF ${t} = $q THEN 0
			ELSE IF string::starts_with(${t}, $q) THEN 1
			ELSE IF string::contains(${t}, $q) THEN 2
			ELSE 3
			END
		)`;
	});
	const bestRank = `math::min([${rankParts.join(', ')}])`;

	const lenParts = texts.map((t) => `string::len(${t})`);
	const bestLen = `math::min([${lenParts.join(', ')}])`;

	const matched = texts
		.map(
			(t) =>
				`(string::contains(${t}, $q) OR string::distance::levenshtein(${t}, $q) <= $maxDistance)`
		)
		.join(' OR ');

	const sql = `
		SELECT *,
			${bestRank} AS _rank,
			${bestDist} AS _dist,
			${bestLen} AS _len
		FROM type::table($table)
		WHERE ${matched}
		ORDER BY _rank ASC, _dist ASC, _len ASC
		LIMIT $limit
	`;

	const [rows] = await session.query<[Record<string, unknown>[]]>(sql, {
		table,
		q: needle,
		maxDistance,
		limit
	});

	if (!Array.isArray(rows)) {
		return rows == null ? [] : [rows as Record<string, unknown>];
	}
	return rows;
}
