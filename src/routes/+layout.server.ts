import type { LayoutServerLoad } from './$types';
import type { ResolvedConfig } from '$lib/config/types';
import { APP_ROLES, type AppRole } from '$lib/catalog-types';
import { loadAppCatalog } from '$lib/server/catalog';
import { resolveAppConfig } from '$lib/server/config';
import { defaultUserAuth } from '$lib/server/db';
import { saveSelection } from '$lib/server/auth';

export const load: LayoutServerLoad = async ({ locals, fetch, cookies }) => {
	const catalog = await loadAppCatalog(locals.selection.namespace, fetch);

	const selection = {
		namespace: catalog.namespace || locals.selection.namespace,
		database: locals.selection.database
	};

	// Snap invalid / missing database onto a catalog entry (prefer main)
	if (!catalog.databases.includes(selection.database) && catalog.databases.length > 0) {
		selection.database = catalog.databases.includes('main') ? 'main' : catalog.databases[0];
	}

	// Keep cookie + live session aligned if catalog had to normalize values
	if (
		selection.namespace !== locals.selection.namespace ||
		selection.database !== locals.selection.database
	) {
		saveSelection(selection, cookies);
		locals.selection = selection;

		if (locals.session?.isConnected) {
			try {
				await locals.session.use(selection);
			} catch (error) {
				console.warn(
					'[layout] failed to apply snapped selection:',
					error instanceof Error ? error.message : error
				);
			}
		}
	}

	const user = locals.user ?? null;
	const userRoles: AppRole[] = catalog.users.find((entry) => entry.name === user)?.roles ?? [];

	let config: ResolvedConfig | null = null;
	let configError: string | null = null;

	if (locals.session?.isConnected) {
		try {
			config = await resolveAppConfig(locals.session);
		} catch (error) {
			configError = error instanceof Error ? error.message : 'Failed to resolve app config';
			console.warn('[layout] resolveAppConfig failed:', configError);
		}
	}

	return {
		selection,
		user,
		hasToken: Boolean(locals.tokens?.access),
		dbError: locals.dbError ?? null,
		catalog,
		/** Resolved presentation config for views (null when offline / failed). */
		config,
		/** Non-fatal message when config resolve failed. */
		configError,
		/** Static role enum for forms / labels */
		appRoles: APP_ROLES,
		/** Roles of the signed-in user (from catalog match by name) */
		userRoles,
		defaultUser: defaultUserAuth.username
	};
};
