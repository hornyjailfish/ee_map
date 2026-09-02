/**
 * Request-scoped Surreal row loaders for table/graph views.
 * Callers must allowlist table names against ResolvedConfig first.
 */

import { Table, type Surreal } from 'surrealdb';

/** Soft default so payloads stay reasonable for first paint. */
export const DEFAULT_ENTITY_LIMIT = 500;

const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Surreal table identifiers we accept as query targets. */
export function isValidTableName(name: string): boolean {
	return typeof name === 'string' && TABLE_NAME_RE.test(name);
}

export type QueryEntitiesOptions = {
	/** Max rows (default {@link DEFAULT_ENTITY_LIMIT}). */
	limit?: number;
};

/**
 * SELECT * FROM $table (via SDK select + Table) with a soft limit.
 * Returns plain record objects; RecordIds may still be present — pass through toTable.
 */
export async function queryEntities(
	session: Surreal,
	table: string,
	opts?: QueryEntitiesOptions
): Promise<Record<string, unknown>[]> {
	if (!isValidTableName(table)) {
		throw new Error(`Invalid table name: ${table}`);
	}

	const limit = opts?.limit ?? DEFAULT_ENTITY_LIMIT;
	if (!Number.isFinite(limit) || limit < 0) {
		throw new Error(`Invalid limit: ${limit}`);
	}

	const rows = await session.select<Record<string, unknown>>(new Table(table)).limit(limit);

	if (!Array.isArray(rows)) {
		return rows == null ? [] : [rows as Record<string, unknown>];
	}

	return rows as Record<string, unknown>[];
}
