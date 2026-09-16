/**
 * OWNER-only database dump helpers via the Surreal JS SDK.
 *
 * `session.export()` / `session.import()` hit SurrealDB HTTP `/export` and
 * `/import` (the SDK rewrites `ws`/`wss` → `http`/`https` for those calls).
 * This is the in-app stand-in for CLI transfer when the NAT/path to the engine
 * is awkward.
 */

import type { Surreal } from 'surrealdb';
import type { AppRole } from '$lib/catalog-types';
import { MutateError, assertCanOwn } from '$lib/server/data/mutate';

/** Safe filename fragment for Content-Disposition. */
const SAFE_NAME_RE = /[^A-Za-z0-9._-]+/g;

/**
 * Export the current ns/db as SurrealQL (schema + records by default).
 * Throws MutateError when the caller is not OWNER or the engine rejects the call.
 */
export async function exportDatabase(
	session: Surreal,
	roles: readonly AppRole[] | null | undefined
): Promise<string> {
	assertCanOwn(roles);

	if (!session.isConnected) {
		throw new MutateError(503, 'db_unavailable', 'Database unavailable');
	}

	try {
		const sql = await session.export({
			// Full dump suitable for machine-to-machine restore of app data.
			tables: true,
			records: true,
			versions: false
		});
		if (typeof sql !== 'string') {
			throw new MutateError(500, 'export_failed', 'Unexpected export response type');
		}
		return sql;
	} catch (error) {
		if (error instanceof MutateError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		console.warn('[db-transfer] export failed:', message);
		throw new MutateError(500, 'export_failed', `Export failed: ${message}`);
	}
}

/**
 * Import a SurrealQL dump into the current ns/db.
 * Replaces/merges content according to statements in the dump (typically UPSERT/DEFINE).
 */
export async function importDatabase(
	session: Surreal,
	roles: readonly AppRole[] | null | undefined,
	sql: string
): Promise<void> {
	assertCanOwn(roles);

	if (!session.isConnected) {
		throw new MutateError(503, 'db_unavailable', 'Database unavailable');
	}

	const trimmed = sql.trim();
	if (!trimmed) {
		throw new MutateError(400, 'empty_import', 'Import file is empty');
	}

	try {
		await session.import(trimmed);
	} catch (error) {
		if (error instanceof MutateError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		console.warn('[db-transfer] import failed:', message);
		throw new MutateError(500, 'import_failed', `Import failed: ${message}`);
	}
}

/** Suggested download name: `surreal-{ns}-{db}-{iso}.surql`. */
export function exportFilename(namespace: string, database: string, at = new Date()): string {
	const ns = (namespace || 'ns').replace(SAFE_NAME_RE, '_');
	const db = (database || 'db').replace(SAFE_NAME_RE, '_');
	const stamp = at.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
	return `surreal-${ns}-${db}-${stamp}.surql`;
}
