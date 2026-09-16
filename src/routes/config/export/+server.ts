/**
 * GET /config/export — download current ns/db as SurrealQL (OWNER only).
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserRoles } from '$lib/server/catalog';
import { MutateError } from '$lib/server/data';
import { exportDatabase, exportFilename } from '$lib/server/db-transfer';

export const GET: RequestHandler = async ({ locals, fetch }) => {
	if (!locals.session?.isConnected) {
		error(503, 'Database unavailable');
	}

	const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);

	try {
		const sql = await exportDatabase(locals.session, roles);
		const filename = exportFilename(locals.selection.namespace, locals.selection.database);
		// RFC 5987 filename* for non-ASCII-safe names; ascii fallback is already sanitized.
		const disposition = `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

		return new Response(sql, {
			status: 200,
			headers: {
				'content-type': 'application/surrealql; charset=utf-8',
				'content-disposition': disposition,
				'cache-control': 'no-store'
			}
		});
	} catch (err) {
		if (err instanceof MutateError) {
			error(err.status, err.message);
		}
		const message = err instanceof Error ? err.message : 'Export failed';
		console.warn('[config/export] failed:', message);
		error(500, message);
	}
};
