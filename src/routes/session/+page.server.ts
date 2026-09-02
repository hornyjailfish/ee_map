import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { clearTokens, saveSelection, signIn, signOut } from '$lib/server/auth';
import { invalidateConfigCache } from '$lib/server/config';

export const load: PageServerLoad = async () => {
	redirect(303, '/');
};

export const actions: Actions = {
	selectNamespace: async ({ request, locals, cookies }) => {
		const data = await request.formData();
		const namespace = String(data.get('namespace') ?? '').trim();
		if (!namespace) {
			return fail(400, { field: 'namespace', message: 'Namespace is required' });
		}

		// Reset db on ns change; layout snaps to a real catalog db if main is missing
		const database = 'main';
		const selection = { namespace, database };
		saveSelection(selection, cookies);
		locals.selection = selection;
		invalidateConfigCache();

		// JWT is ns-scoped; drop it so hooks re-auth as default/default on the new ns
		clearTokens(cookies);
		locals.tokens = null;
		locals.user = undefined;

		return { ok: true };
	},

	selectDatabase: async ({ request, locals, cookies }) => {
		const data = await request.formData();
		const database = String(data.get('database') ?? '').trim();
		if (!database) {
			return fail(400, { field: 'database', message: 'Database is required' });
		}

		const namespace = locals.selection.namespace;
		saveSelection({ namespace, database }, cookies);

		try {
			if (locals.session?.isConnected) {
				await locals.session.use({ namespace, database });
			}
		} catch (error) {
			return fail(400, {
				field: 'database',
				message: error instanceof Error ? error.message : 'Failed to select database'
			});
		}

		locals.selection = { namespace, database };
		// Drop all cached configs — next resolve fills the new ns::db key
		invalidateConfigCache();
		return { ok: true };
	},

	selectUser: async ({ request, locals }) => {
		const data = await request.formData();
		const username = String(data.get('username') ?? '').trim();
		const password = String(data.get('password') ?? '');

		if (!username) {
			return fail(400, { field: 'username', message: 'User is required' });
		}
		if (!password) {
			return fail(400, { field: 'password', message: 'Password is required' });
		}
		if (!locals.session?.isConnected) {
			return fail(503, { message: locals.dbError ?? 'Database unavailable' });
		}

		try {
			await signIn(
				{
					namespace: locals.selection.namespace,
					username,
					password
				},
				username
			);
			return { ok: true };
		} catch (error) {
			return fail(401, {
				field: 'password',
				message: error instanceof Error ? error.message : 'Sign-in failed'
			});
		}
	},

	logout: async () => {
		await signOut();
		return { ok: true };
	}
};
