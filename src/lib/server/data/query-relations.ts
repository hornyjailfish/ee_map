/**
 * Relation-table loaders for graph edges.
 * Relation tables are normal Surreal tables with in/out — same SELECT path as entities.
 */

import type { Surreal } from 'surrealdb';
import {
	DEFAULT_ENTITY_LIMIT,
	isValidTableName,
	queryEntities,
	type QueryEntitiesOptions
} from './query-entities';

/** Soft default shared with entity loads. */
export { DEFAULT_ENTITY_LIMIT, isValidTableName };

export type QueryRelationsOptions = QueryEntitiesOptions;

/**
 * SELECT rows from a relation table (e.g. `connects`).
 * Allowlist the table name against ResolvedConfig before calling.
 */
export async function queryRelations(
	session: Surreal,
	table: string,
	opts?: QueryRelationsOptions
): Promise<Record<string, unknown>[]> {
	return queryEntities(session, table, opts);
}
