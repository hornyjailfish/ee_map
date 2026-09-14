/**
 * Live DB: rent name search ranks exact "A2" above "A20" / "A21…".
 * Skips when Surreal is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Surreal } from 'surrealdb';
import { env } from '$env/dynamic/private';
import { queryEntitiesSearch } from './query-entities-search';

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
		const attempts = [
			{
				username: env.SURREAL_SYSTEM_USER ?? 'root',
				password: env.SURREAL_SYSTEM_PASS ?? 'root'
			},
			{ username: 'root', password: 'root' }
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
	if (session) {
		try {
			await session.close();
		} catch {
			// ignore
		}
	}
});

describe('live queryEntitiesSearch rents', () => {
	it('ranks exact A2 first when searching a2', async ({ skip }) => {
		if (!available || !session) skip();

		const rows = await queryEntitiesSearch(session!, 'rents', 'A2', {
			fields: ['name'],
			entityFields: [{ name: 'name', type: 'string' } as never]
		});

		expect(rows.length).toBeGreaterThan(0);
		const names = rows.map((r) => String(r.name ?? '').toLowerCase());
		expect(names[0]).toBe('a2');
		// Longer contains-matches may appear, but only after exact.
		const exactIdx = names.indexOf('a2');
		const a20 = names.indexOf('a20');
		const a21 = names.findIndex((n) => n.startsWith('a21'));
		expect(exactIdx).toBe(0);
		if (a20 >= 0) expect(a20).toBeGreaterThan(exactIdx);
		if (a21 >= 0) expect(a21).toBeGreaterThan(exactIdx);
	});
});
