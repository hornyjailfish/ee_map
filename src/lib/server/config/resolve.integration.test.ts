/**
 * Live DB smoke for resolveAppConfig.
 * Skips cleanly when Surreal is unreachable (CI without DB).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Surreal } from 'surrealdb';
import { env } from '$env/dynamic/private';
import { introspect } from './introspect';
import { loadOverlay } from './load-overlay';
import { invalidateConfigCache, resolveAppConfig } from './resolve';

const url = env.SURREALDB_HOST ?? 'ws://127.0.0.1:8008/rpc';
const namespace = env.SURREALDB_NAMESPACE ?? 'main';
const database = env.SURREALDB_NAME ?? 'main';

let session: Surreal | null = null;
let available = false;

beforeAll(async () => {
	const db = new Surreal();
	try {
		await db.connect(url, {
			namespace,
			database,
			versionCheck: false,
			authentication: null
		});
		// Prefer root for STRUCTURE (viewer may lack perms in some setups)
		const attempts = [
			{
				username: env.SURREAL_SYSTEM_USER ?? 'root',
				password: env.SURREAL_SYSTEM_PASS ?? 'root'
			},
			{ username: 'root', password: 'root' },
			{
				namespace,
				username: env.SURREAL_DEFAULT_USER ?? 'default',
				password: env.SURREAL_DEFAULT_PASS ?? 'default'
			}
		];
		let ok = false;
		for (const auth of attempts) {
			try {
				await db.signin(auth);
				ok = true;
				break;
			} catch {
				// try next
			}
		}
		if (!ok) {
			await db.close();
			return;
		}
		await db.use({ namespace, database });
		session = db;
		available = true;
	} catch {
		try {
			await db.close();
		} catch {
			// ignore
		}
		session = null;
		available = false;
	}
}, 15_000);

afterAll(async () => {
	invalidateConfigCache();
	if (session) {
		try {
			await session.close();
		} catch {
			// ignore
		}
	}
});

describe('live resolveAppConfig', () => {
	it('introspects EE tables from live STRUCTURE', async ({ skip }) => {
		if (!available || !session) skip();

		const auto = await introspect(session!);
		const names = auto.tables.map((t) => t.name);

		expect(auto.engine?.raw).toMatch(/surrealdb|\d+\.\d+\.\d+/i);
		expect(auto.engine?.major).toEqual(expect.any(Number));
		expect(names).toEqual(
			expect.arrayContaining(['electric_rooms', 'boards', 'breakers', 'connects'])
		);

		const rooms = auto.tables.find((t) => t.name === 'electric_rooms');
		expect(rooms?.kind).toBe('normal');
		expect(rooms?.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'geometry',
					type: 'geometry',
					optional: true,
					geometryKinds: ['polygon']
				}),
				expect.objectContaining({
					name: 'level',
					type: 'record',
					recordTargets: ['levels']
				})
			])
		);

		const connects = auto.tables.find((t) => t.name === 'connects');
		expect(connects).toMatchObject({
			kind: 'relation',
			in: ['breakers'],
			out: expect.arrayContaining(['breakers', 'rents'])
		});
	});

	it('loadOverlay returns seeded app_config:main overlay', async ({ skip }) => {
		if (!available || !session) skip();
		const overlay = await loadOverlay(session!);
		expect(overlay).not.toBeNull();
		expect(overlay?.version).toBe(1);
		expect(overlay?.excludeTables).toEqual(
			expect.arrayContaining(['app_config', 'embeddings', '__entity', '__rollout'])
		);
		expect(overlay?.entities?.breakers?.graph).toMatchObject({
			role: 'breaker',
			parentField: 'board'
		});
		expect(overlay?.edges?.connects?.role).toBe('feeds');
		expect(overlay?.map).toMatchObject({
			units: 'm',
			plane: 'xy-meters',
			levelsTable: 'levels',
			levelOrderField: 'ord'
		});
	});

	it('resolveAppConfig merges live profile and caches by ns/db', async ({ skip }) => {
		if (!available || !session) skip();
		invalidateConfigCache();

		const a = await resolveAppConfig(session!, { skipCache: true });
		expect(a.version).toBe(1);
		expect(a.engine?.major).toEqual(expect.any(Number));
		expect(a.tables.map((t) => t.name)).toEqual(
			expect.arrayContaining(['electric_rooms', 'boards', 'breakers'])
		);
		expect(a.tables.map((t) => t.name)).not.toContain('app_config');
		expect(a.tables.map((t) => t.name)).not.toContain('embeddings');
		expect(a.tables.find((t) => t.name === 'breakers')?.graph).toMatchObject({
			role: 'breaker',
			parentField: 'board'
		});
		expect(a.relations.find((r) => r.name === 'connects')?.role).toBe('feeds');
		expect(a.map.layers.map((l) => l.table)).toEqual(
			expect.arrayContaining(['electric_rooms', 'rents', 'zones'])
		);
		expect(a.map.units).toBe('m');
		expect(a.graph.hierarchy).toContain('breaker');
		expect(a.diagnostics).toEqual([]);

		// AutoProfile is cached; overlay is always re-read → merge returns a new object,
		// but table inventory stays stable for a warm session.
		const b = await resolveAppConfig(session!);
		const c = await resolveAppConfig(session!);
		expect(c.tables.map((t) => t.name)).toEqual(b.tables.map((t) => t.name));
		expect(c.tables.find((t) => t.name === 'boards')?.display).toEqual(
			b.tables.find((t) => t.name === 'boards')?.display
		);

		const d = await resolveAppConfig(session!, { skipCache: true });
		expect(d.tables.map((t) => t.name)).toEqual(b.tables.map((t) => t.name));
		// Live EE seed: boards show room · name when referenced (breakers.board, …)
		expect(d.tables.find((t) => t.name === 'boards')?.display?.parts.map((p) => p.path)).toEqual([
			'room.name',
			'name'
		]);
	});
});
