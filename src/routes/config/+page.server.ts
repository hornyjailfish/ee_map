import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import type { AppConfigOverlay, Diagnostic } from '$lib/config/types';
import { emptyOverlay, softParseOverlay } from '$lib/config/overlay-io';
import { canOwn } from '$lib/roles';
import { getUserRoles } from '$lib/server/catalog';
import { loadOverlay, saveOverlay, invalidateConfigCache } from '$lib/server/config';
import { MutateError } from '$lib/server/data';
import { importDatabase } from '$lib/server/db-transfer';

const saveSchema = z.object({ overlay: z.string().nullable().default(null) });

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export type ConfigPageData = {
	/** Sparse overlay currently stored (or empty starter). */
	overlay: AppConfigOverlay;
	/** Whether `app_config:main` exists. */
	hasStoredOverlay: boolean;
	/** Known normal tables from resolved config (hints for entity keys). */
	knownTables: string[];
	/** Known relation tables from resolved config (hints for edge keys). */
	knownRelations: string[];
	/** Last resolve diagnostics (helpful while editing). */
	diagnostics: Diagnostic[];
	error: string | null;
};

function failFromError(err: unknown, fallback = 'Request failed') {
	if (err instanceof MutateError) {
		return fail(err.status, { code: err.code, message: err.message });
	}
	const message = err instanceof Error ? err.message : fallback;
	console.warn('[config] action failed:', message);
	return fail(500, { code: 'action_failed', message });
}

export const load: PageServerLoad = async ({ parent, locals }): Promise<ConfigPageData> => {
	const layout = await parent();
	const roles = layout.userRoles ?? [];

	// Client hides the link; server is the real gate.
	if (!canOwn(roles)) {
		error(403, 'App config requires OWNER role');
	}

	if (!locals.session?.isConnected) {
		return {
			overlay: emptyOverlay(),
			hasStoredOverlay: false,
			knownTables: [],
			knownRelations: [],
			diagnostics: [],
			error: locals.dbError ?? layout.configError ?? 'Database unavailable'
		};
	}

	try {
		const stored = await loadOverlay(locals.session);
		const config = layout.config;
		return {
			overlay: stored ?? emptyOverlay(),
			hasStoredOverlay: stored != null,
			knownTables: config?.tables.map((t) => t.name) ?? [],
			knownRelations: config?.relations.map((r) => r.name) ?? [],
			diagnostics: config?.diagnostics ?? [],
			error: layout.configError ?? null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load overlay';
		console.warn('[config] load failed:', message);
		return {
			overlay: emptyOverlay(),
			hasStoredOverlay: false,
			knownTables: [],
			knownRelations: [],
			diagnostics: [],
			error: message
		};
	}
};

export const actions: Actions = {
	save: async ({ request, locals, fetch }) => {
		if (!locals.session?.isConnected) {
			return fail(503, { code: 'db_unavailable', message: 'Database unavailable' });
		}

		const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);
		const parsedForm = saveSchema.safeParse(
			Object.fromEntries((await request.formData()).entries())
		);
		if (!parsedForm.success) {
			return fail(400, { code: 'invalid_overlay', message: 'Overlay is empty' });
		}

		try {
			const parsed = softParseOverlay(parsedForm.data.overlay);
			if (!parsed.ok) {
				return fail(400, { code: 'invalid_overlay', message: parsed.message });
			}
			const overlay = await saveOverlay(locals.session, roles, parsed.overlay);
			return { ok: true as const, overlay };
		} catch (err) {
			return failFromError(err, 'Save failed');
		}
	},

	/** Import a .surql dump into the active ns/db (OWNER). */
	importDb: async ({ request, locals, fetch }) => {
		if (!locals.session?.isConnected) {
			return fail(503, { code: 'db_unavailable', message: 'Database unavailable' });
		}

		const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);
		const form = await request.formData();
		const file = form.get('file');

		if (!(file instanceof File)) {
			return fail(400, { code: 'missing_file', message: 'Choose a .surql file to import' });
		}
		if (file.size === 0) {
			return fail(400, { code: 'empty_import', message: 'Import file is empty' });
		}
		if (file.size > MAX_IMPORT_BYTES) {
			return fail(400, {
				code: 'import_too_large',
				message: `Import file exceeds ${MAX_IMPORT_BYTES / (1024 * 1024)} MB limit`
			});
		}

		try {
			const sql = await file.text();
			await importDatabase(locals.session, roles, sql);
			// STRUCTURE + overlay may both change; drop auto cache so next load is fresh.
			invalidateConfigCache();
			return {
				ok: true as const,
				imported: true as const,
				bytes: file.size,
				filename: file.name || 'import.surql'
			};
		} catch (err) {
			return failFromError(err, 'Import failed');
		}
	}
};
