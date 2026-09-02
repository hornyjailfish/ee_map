/**
 * Load floor / level rows for map switcher.
 * Sorting by ord is applied in toMap — this is a thin allowlisted select.
 */

import type { Surreal } from 'surrealdb';
import { isValidTableName, queryEntities, type QueryEntitiesOptions } from './query-entities';

/** Soft default; levels tables are small. */
export const DEFAULT_LEVEL_LIMIT = 200;

/**
 * SELECT levels (or configured levelsTable) via queryEntities.
 * Caller must pass a name already taken from ResolvedConfig.map.levelsTable.
 */
export async function queryLevels(
	session: Surreal,
	table: string,
	opts?: QueryEntitiesOptions
): Promise<Record<string, unknown>[]> {
	if (!isValidTableName(table)) {
		throw new Error(`Invalid levels table name: ${table}`);
	}

	return queryEntities(session, table, {
		limit: opts?.limit ?? DEFAULT_LEVEL_LIMIT
	});
}
