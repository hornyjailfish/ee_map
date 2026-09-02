import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import {
	clearTokens,
	readAuthState,
	saveSelection,
	saveTokens,
	saveUser,
	usernameFromToken
} from '$lib/server/auth';
import { closeSession, createSession, defaultUserAuth } from '$lib/server/db';

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

const handleSurreal: Handle = async ({ event, resolve }) => {
	const { cookies, locals } = event;
	const { tokens, selection, user } = readAuthState(cookies);

	locals.tokens = tokens;
	locals.selection = selection;
	locals.session = undefined;
	locals.user = user ?? undefined;
	locals.dbError = undefined;

	try {
		const hadCookieToken = Boolean(tokens?.access);

		const session = await createSession({
			selection,
			tokens,
			// No cookie → sign in as namespace user default/default (ns from cookie or "main")
			defaultAuth: hadCookieToken
				? null
				: {
						username: defaultUserAuth.username,
						password: defaultUserAuth.password,
						scope: 'namespace'
					},
			// SvelteKit request fetch (adapter-aware); used when the driver hits HTTP paths
			fetch: event.fetch
		});
		locals.session = session;

		// Auth may refresh tokens; selection may differ after connect — keep cookies fresh
		const access = session.accessToken;
		if (access && access !== tokens?.access) {
			const nextTokens = {
				access,
				...(tokens?.refresh ? { refresh: tokens.refresh } : {})
			};
			saveTokens(nextTokens, cookies);
			locals.tokens = nextTokens;

			const nextUser =
				usernameFromToken(access) ?? (!hadCookieToken ? defaultUserAuth.username : undefined);
			if (nextUser) {
				saveUser(nextUser, cookies);
				locals.user = nextUser;
			}
		} else if (!hadCookieToken && access) {
			// default sign-in produced a token matching nothing previous
			saveTokens({ access }, cookies);
			locals.tokens = { access };
			const nextUser = usernameFromToken(access) ?? defaultUserAuth.username;
			saveUser(nextUser, cookies);
			locals.user = nextUser;
		} else if (!locals.user && access) {
			const nextUser = usernameFromToken(access);
			if (nextUser) {
				saveUser(nextUser, cookies);
				locals.user = nextUser;
			}
		}

		const liveSelection = {
			namespace: session.namespace ?? selection.namespace,
			database: session.database ?? selection.database
		};
		if (
			liveSelection.namespace !== selection.namespace ||
			liveSelection.database !== selection.database
		) {
			saveSelection(liveSelection, cookies);
			locals.selection = liveSelection;
		}
	} catch (error) {
		locals.session = undefined;
		locals.dbError = error instanceof Error ? error.message : 'Database unavailable';

		// Stale JWT should not poison every subsequent request
		if (tokens) {
			const message = locals.dbError.toLowerCase();
			const authFailed =
				message.includes('token') ||
				message.includes('auth') ||
				message.includes('signin') ||
				message.includes('authenticate') ||
				message.includes('unauthorized') ||
				message.includes('forbidden');

			if (authFailed) {
				clearTokens(cookies);
				locals.tokens = null;
				locals.user = undefined;
			}
		}

		console.error('[surreal] session init failed:', locals.dbError);
	}

	try {
		return await resolve(event);
	} finally {
		await closeSession(locals.session);
		locals.session = undefined;
	}
};

export const handle: Handle = sequence(handleParaglide, handleSurreal);
