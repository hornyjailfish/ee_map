import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
	Surreal,
	type ConnectOptions,
	type DriverOptions,
	type NamespaceDatabase,
	type ReconnectOptions,
	type Tokens
} from 'surrealdb';

const CONNECT_MS = 5_000;

/** Bounded reconnect: recover mid-request drops without retrying forever after close. */
const DEFAULT_RECONNECT: Partial<ReconnectOptions> = {
	enabled: true,
	attempts: 4,
	retryDelay: 200,
	retryDelayMax: 5_000,
	retryDelayMultiplier: 1.5,
	retryDelayJitter: 0.1
};

export type DbSelection = {
	namespace: string;
	database: string;
};

export const dbConfig = {
	url: env.SURREALDB_HOST ?? 'ws://127.0.0.1:8008/rpc',
	namespace: env.SURREALDB_NAMESPACE ?? 'main',
	database: env.SURREALDB_NAME ?? 'main'
} as const;

/** App-user fallback when no auth cookie is present. */
export const defaultUserAuth = {
	username: env.SURREAL_DEFAULT_USER ?? 'user',
	password: env.SURREAL_DEFAULT_PASS ?? 'user'
} as const;

/** System-level reader used only for catalog queries (`INFO FOR … STRUCTURE`). */
export const systemViewerAuth = {
	username: env.SURREAL_SYSTEM_USER ?? 'viewer',
	password: env.SURREAL_SYSTEM_PASS ?? 'viewer'
} as const;

export { APP_ROLES, type AppRole } from '$lib/catalog-types';

/** @deprecated use dbConfig — kept for existing imports */
export const config = dbConfig;

export class DbUnavailableError extends Error {
	constructor(message = 'Database unavailable', options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'DbUnavailableError';
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new DbUnavailableError(`${label} timed out after ${ms}ms`));
		}, ms);

		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

export type CreateSessionOptions = {
	selection?: Partial<DbSelection> | null;
	tokens?: Tokens | null;
	/**
	 * Prefer SvelteKit's `event.fetch` so HTTP-engine calls / version checks
	 * go through the same fetch stack as the rest of the app.
	 */
	fetch?: typeof globalThis.fetch;
	/** Extra driver options (engines, codecs, websocketImpl, …). `fetchImpl` is set from `fetch` when provided. */
	driver?: Omit<DriverOptions, 'fetchImpl'>;
	/** Extra connect options. Defaults enable bounded reconnect. */
	connect?: ConnectOptions;
	/**
	 * When no cookie tokens are present, sign in as this user.
	 * Defaults to namespace-scoped `default/default`.
	 * Pass `null` to skip auto sign-in.
	 */
	defaultAuth?: {
		username: string;
		password: string;
		/** root = system user; namespace = DEFINE USER ON NAMESPACE */
		scope?: 'root' | 'namespace';
	} | null;
};

/**
 * Create a request-scoped Surreal session with SDK reconnect enabled.
 * Always pair with `closeSession` in a `finally` block so reconnect stops after the response.
 */
export async function createSession(options: CreateSessionOptions = {}): Promise<Surreal> {
	if (building) {
		throw new DbUnavailableError('Database unavailable during build');
	}

	const selection: DbSelection = {
		namespace: options.selection?.namespace || dbConfig.namespace,
		database: options.selection?.database || dbConfig.database
	};

	const tokens = options.tokens?.access ? options.tokens : null;
	const defaultAuth =
		options.defaultAuth === undefined
			? {
					username: defaultUserAuth.username,
					password: defaultUserAuth.password,
					scope: 'namespace' as const
				}
			: options.defaultAuth;

	const db = new Surreal({
		...options.driver,
		...(options.fetch ? { fetchImpl: options.fetch } : {})
	});

	const reconnect =
		options.connect?.reconnect === undefined ? DEFAULT_RECONNECT : options.connect.reconnect;

	try {
		await withTimeout(
			db.connect(dbConfig.url, {
				versionCheck: true,
				invalidateOnExpiry: false,
				...options.connect,
				namespace: selection.namespace,
				database: selection.database,
				reconnect,
				// Re-applied on reconnect / expiry while session auth isn't overridden by signin/authenticate.
				authentication: tokens
					? async () => tokens.access
					: (options.connect?.authentication ?? null)
			}),
			CONNECT_MS,
			'Surreal connect'
		);

		if (tokens) {
			// Full Tokens (access + optional refresh) so the driver can renew mid-session
			await withTimeout(db.authenticate(tokens), CONNECT_MS, 'Surreal authenticate');
		} else if (defaultAuth) {
			const auth =
				defaultAuth.scope === 'root'
					? {
							username: defaultAuth.username,
							password: defaultAuth.password
						}
					: {
							namespace: selection.namespace,
							username: defaultAuth.username,
							password: defaultAuth.password
						};

			// Soft-fail: keep a live connection even if the default principal is missing.
			try {
				await withTimeout(db.signin(auth), CONNECT_MS, 'Surreal default signin');
			} catch (error) {
				console.warn(
					'[surreal] default signin failed:',
					error instanceof Error ? error.message : error
				);
			}
		}

		if (db.namespace !== selection.namespace || db.database !== selection.database) {
			await withTimeout(db.use(selection), CONNECT_MS, 'Surreal use');
		}

		return db;
	} catch (error) {
		// Stops any reconnect loop started during a failed/slow connect
		await closeSession(db);
		if (error instanceof DbUnavailableError) throw error;
		throw new DbUnavailableError(
			error instanceof Error ? error.message : 'Failed to connect to SurrealDB',
			{ cause: error }
		);
	}
}

export async function closeSession(db: Surreal | undefined | null): Promise<void> {
	if (!db) return;
	try {
		await db.close();
	} catch {
		// ignore teardown errors
	}
}

export async function applySelection(
	db: Surreal,
	selection: NamespaceDatabase
): Promise<NamespaceDatabase> {
	return withTimeout(db.use(selection), CONNECT_MS, 'Surreal use');
}
