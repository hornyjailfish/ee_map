import { Surreal } from 'surrealdb';
import { APP_ROLES, type AppCatalog, type AppRole, type CatalogUser } from '$lib/catalog-types';
import { closeSession, dbConfig, systemViewerAuth } from '$lib/server/db';

export type { AppCatalog, AppRole, CatalogUser } from '$lib/catalog-types';

/**
 * Resolve the signed-in user's roles from the namespace catalog.
 * Returns an empty array when the user is unknown or has no roles.
 */
export async function getUserRoles(
	namespace: string,
	user: string | null | undefined,
	fetchImpl?: typeof globalThis.fetch
): Promise<AppRole[]> {
	if (!user) return [];
	const catalog = await loadAppCatalog(namespace, fetchImpl);
	return catalog.users.find((entry) => entry.name === user)?.roles ?? [];
}

type StructuredUser = {
	name?: unknown;
	roles?: unknown;
};

type StructuredNamed = {
	name?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeRole(value: unknown): AppRole | null {
	if (typeof value !== 'string') return null;
	const role = value.trim().toUpperCase();
	return (APP_ROLES as readonly string[]).includes(role) ? (role as AppRole) : null;
}

function rolesFromUnknown(raw: unknown): AppRole[] {
	if (!Array.isArray(raw)) return [];
	const roles = raw.map(normalizeRole).filter((role): role is AppRole => role !== null);
	return [...new Set(roles)];
}

function parseNamedList(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return raw
			.map((entry) => {
				if (typeof entry === 'string') return entry;
				const row = asRecord(entry) as StructuredNamed | null;
				return typeof row?.name === 'string' ? row.name : null;
			})
			.filter((name): name is string => Boolean(name));
	}

	const map = asRecord(raw);
	if (!map) return [];
	return Object.keys(map);
}

/** Parse NS STRUCTURE users — array of `{ name, roles[] }` or name→`{ roles[] }` map. */
function parseUsers(raw: unknown): CatalogUser[] {
	const users: CatalogUser[] = [];

	if (Array.isArray(raw)) {
		for (const entry of raw) {
			const row = asRecord(entry) as StructuredUser | null;
			if (!row || typeof row.name !== 'string' || !row.name) continue;
			users.push({ name: row.name, roles: rolesFromUnknown(row.roles) });
		}
		return users;
	}

	const map = asRecord(raw);
	if (!map) return users;

	for (const [name, def] of Object.entries(map)) {
		const row = asRecord(def) as StructuredUser | null;
		users.push({ name, roles: rolesFromUnknown(row?.roles) });
	}

	return users;
}

/**
 * Separate system-level connection (`viewer` / `viewer`) to load:
 * - root namespaces (`INFO FOR ROOT STRUCTURE`)
 * - namespace-level users + databases (`INFO FOR NS STRUCTURE`)
 *
 * App auth stays on `locals.session`; only namespace-level users are offered in the UI.
 */
export async function loadAppCatalog(
	namespace: string,
	fetchImpl?: typeof globalThis.fetch
): Promise<AppCatalog> {
	const empty: AppCatalog = {
		namespaces: [namespace],
		namespace,
		databases: [],
		users: []
	};

	const db = new Surreal(fetchImpl ? { fetchImpl } : undefined);

	try {
		await db.connect(dbConfig.url, {
			versionCheck: true,
			authentication: null,
			namespace
		});
		await db.signin({
			username: systemViewerAuth.username,
			password: systemViewerAuth.password
		});

		const [rootInfo] = await db.query<[Record<string, unknown>]>('INFO FOR ROOT STRUCTURE');
		const namespaces = parseNamedList(rootInfo?.namespaces).sort((a, b) => a.localeCompare(b));

		const selected =
			namespaces.includes(namespace) || namespaces.length === 0 ? namespace : namespaces[0];

		await db.use({ namespace: selected, database: null });
		const [nsInfo] = await db.query<[Record<string, unknown>]>('INFO FOR NS STRUCTURE');

		return {
			namespaces: namespaces.length > 0 ? namespaces : [selected],
			namespace: selected,
			databases: parseNamedList(nsInfo?.databases).sort((a, b) => a.localeCompare(b)),
			// Namespace-level users only (root users intentionally excluded)
			users: parseUsers(nsInfo?.users).sort((a, b) => a.name.localeCompare(b.name))
		};
	} catch (error) {
		console.error('[catalog] failed to load structure:', error);
		return empty;
	} finally {
		await closeSession(db);
	}
}
