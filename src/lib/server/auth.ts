import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import type { Cookies } from '@sveltejs/kit';
import type { AnyAuth, Tokens } from 'surrealdb';
import { invalidateConfigCache } from '$lib/server/config';
import { applySelection, dbConfig, type DbSelection } from '$lib/server/db';

const ACCESS_COOKIE = 'sdb_access';
const REFRESH_COOKIE = 'sdb_refresh';
const NS_COOKIE = 'sdb_ns';
const DB_COOKIE = 'sdb_db';
const USER_COOKIE = 'sdb_user';

const TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SELECTION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function cookieOpts(maxAge: number) {
	return {
		path: '/',
		httpOnly: true,
		// false on local http so cookies actually stick in `vite dev`
		secure: !dev,
		sameSite: 'lax' as const,
		maxAge
	};
}

export type AuthCookies = {
	tokens: Tokens | null;
	selection: DbSelection;
	user: string | null;
};

/** Best-effort decode of Surreal access JWT payload (no signature check). */
export function usernameFromToken(access: string | undefined | null): string | undefined {
	if (!access) return undefined;
	try {
		const payload = access.split('.')[1];
		if (!payload) return undefined;
		const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
			ID?: unknown;
			id?: unknown;
		};
		const id = json.ID ?? json.id;
		return typeof id === 'string' && id ? id : undefined;
	} catch {
		return undefined;
	}
}

/** Read sign-in tokens + last selected ns/db + username from cookies. */
export function readAuthState(cookies: Cookies = getRequestEvent().cookies): AuthCookies {
	const access = cookies.get(ACCESS_COOKIE);
	const refresh = cookies.get(REFRESH_COOKIE);

	const tokens: Tokens | null = access
		? {
				access,
				...(refresh ? { refresh } : {})
			}
		: null;

	return {
		tokens,
		selection: {
			// cookie ns, otherwise default "main" via dbConfig
			namespace: cookies.get(NS_COOKIE) || dbConfig.namespace,
			database: cookies.get(DB_COOKIE) || dbConfig.database
		},
		user: cookies.get(USER_COOKIE) || usernameFromToken(access) || null
	};
}

/** Persist access/refresh tokens after signin/signup/authenticate. */
export function saveTokens(tokens: Tokens, cookies: Cookies = getRequestEvent().cookies): void {
	cookies.set(ACCESS_COOKIE, tokens.access, cookieOpts(TOKEN_MAX_AGE));

	if (tokens.refresh) {
		cookies.set(REFRESH_COOKIE, tokens.refresh, cookieOpts(TOKEN_MAX_AGE));
	} else {
		cookies.delete(REFRESH_COOKIE, { path: '/' });
	}

	const user = usernameFromToken(tokens.access);
	if (user) {
		cookies.set(USER_COOKIE, user, cookieOpts(TOKEN_MAX_AGE));
	}
}

export function saveUser(username: string, cookies: Cookies = getRequestEvent().cookies): void {
	cookies.set(USER_COOKIE, username, cookieOpts(TOKEN_MAX_AGE));
}

export function clearTokens(cookies: Cookies = getRequestEvent().cookies): void {
	cookies.delete(ACCESS_COOKIE, { path: '/' });
	cookies.delete(REFRESH_COOKIE, { path: '/' });
	cookies.delete(USER_COOKIE, { path: '/' });
}

/** Persist last selected namespace/database. */
export function saveSelection(
	selection: DbSelection,
	cookies: Cookies = getRequestEvent().cookies
): void {
	cookies.set(NS_COOKIE, selection.namespace, cookieOpts(SELECTION_MAX_AGE));
	cookies.set(DB_COOKIE, selection.database, cookieOpts(SELECTION_MAX_AGE));
}

export function getToken(cookies: Cookies = getRequestEvent().cookies): string | undefined {
	return cookies.get(ACCESS_COOKIE);
}

/**
 * Sign in on the current request session and persist tokens (+ selection) to cookies.
 * Requires `locals.session` from hooks.
 */
export async function signIn(auth: AnyAuth, username?: string): Promise<Tokens> {
	const event = getRequestEvent();
	const { session, selection } = event.locals;

	if (!session?.isConnected) {
		throw new Error('Database session is not connected');
	}

	const tokens = await session.signin(auth);
	saveTokens(tokens, event.cookies);

	const resolvedUser =
		username ||
		usernameFromToken(tokens.access) ||
		('username' in auth && typeof auth.username === 'string' ? auth.username : undefined);

	if (resolvedUser) {
		saveUser(resolvedUser, event.cookies);
		event.locals.user = resolvedUser;
	}

	// Keep cookie selection in sync with whatever the session ended on
	const nextSelection: DbSelection = {
		namespace: session.namespace ?? selection.namespace,
		database: session.database ?? selection.database
	};
	saveSelection(nextSelection, event.cookies);
	event.locals.selection = nextSelection;
	event.locals.tokens = tokens;

	return tokens;
}

/** Sign out: invalidate Surreal session and clear auth cookies. */
export async function signOut(): Promise<void> {
	const event = getRequestEvent();
	const { session } = event.locals;

	try {
		if (session?.isConnected) {
			await session.invalidate();
		}
	} catch {
		// still clear cookies if server-side invalidate fails
	}

	clearTokens(event.cookies);
	event.locals.tokens = null;
	event.locals.user = undefined;
}

/**
 * Switch namespace/database on the live session and remember it in cookies.
 */
export async function selectDatabase(selection: Partial<DbSelection>): Promise<DbSelection> {
	const event = getRequestEvent();
	const { session } = event.locals;

	if (!session?.isConnected) {
		throw new Error('Database session is not connected');
	}

	const next: DbSelection = {
		namespace: selection.namespace ?? session.namespace ?? event.locals.selection.namespace,
		database: selection.database ?? session.database ?? event.locals.selection.database
	};

	await applySelection(session, next);
	saveSelection(next, event.cookies);
	event.locals.selection = next;
	invalidateConfigCache();

	return next;
}
