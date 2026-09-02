/**
 * Load entity + relation rows needed for a graph view from ResolvedConfig.
 */

import type { Surreal } from 'surrealdb';
import type { ResolvedConfig } from '$lib/config/types';
import { DEFAULT_ENTITY_LIMIT, queryEntities, type QueryEntitiesOptions } from './query-entities';
import { queryRelations } from './query-relations';

export type GraphBundle = {
	/** table name → entity rows */
	entities: Record<string, Record<string, unknown>[]>;
	/** relation table name → edge rows */
	relations: Record<string, Record<string, unknown>[]>;
};

export type QueryGraphBundleOptions = QueryEntitiesOptions;

/**
 * For each config table with graph.role not ignore → queryEntities.
 * For each config relation with role not ignore → queryRelations.
 * Failures on individual tables are collected; partial results still return.
 */
export async function queryGraphBundle(
	session: Surreal,
	config: ResolvedConfig,
	opts?: QueryGraphBundleOptions
): Promise<{ bundle: GraphBundle; errors: string[] }> {
	const limit = opts?.limit ?? DEFAULT_ENTITY_LIMIT;
	const entities: GraphBundle['entities'] = {};
	const relations: GraphBundle['relations'] = {};
	const errors: string[] = [];

	const entityTables = config.tables.filter((t) => t.graph != null && t.graph.role !== 'ignore');
	const edgeTables = config.relations.filter((r) => r.role !== 'ignore');

	await Promise.all([
		...entityTables.map(async (t) => {
			try {
				entities[t.name] = await queryEntities(session, t.name, { limit });
			} catch (err) {
				entities[t.name] = [];
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`${t.name}: ${message}`);
			}
		}),
		...edgeTables.map(async (r) => {
			try {
				relations[r.name] = await queryRelations(session, r.name, { limit });
			} catch (err) {
				relations[r.name] = [];
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`${r.name}: ${message}`);
			}
		})
	]);

	return { bundle: { entities, relations }, errors };
}
