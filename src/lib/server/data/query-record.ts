/**
 * Load a single Surreal row by `table:id`.
 */

import { StringRecordId, type Surreal } from 'surrealdb';
import { MutateError, tableOfId, validateRecordId } from './mutate';
import { isValidTableName } from './query-entities';

/**
 * SELECT one record. Returns null when missing.
 * Throws on invalid id / table name.
 */
export async function queryRecordById(
	session: Surreal,
	id: string
): Promise<Record<string, unknown> | null> {
	const recordId = validateRecordId(id.trim());
	const table = tableOfId(recordId);
	if (!isValidTableName(table)) {
		throw new MutateError(400, 'invalid_id', `Invalid record id: ${id}`);
	}

	try {
		const row = await session.select<Record<string, unknown>>(new StringRecordId(recordId));
		if (row == null) return null;
		if (Array.isArray(row)) {
			return (row[0] as Record<string, unknown> | undefined) ?? null;
		}
		return row as Record<string, unknown>;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Record load failed';
		throw new MutateError(500, 'read_failed', message);
	}
}
