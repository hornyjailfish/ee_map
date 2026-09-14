/**
 * Live DB smoke: loadRecordLabels + toTable produce composite FK labels.
 * Skips when Surreal is unreachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Surreal } from 'surrealdb';
import { env } from '$env/dynamic/private';
import { invalidateConfigCache, resolveAppConfig } from '$lib/server/config/resolve';
import { entityByName, toTable } from '$lib/transform/to-table';
import { queryEntities } from './query-entities';
import { loadRecordLabels } from './record-labels';

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
	invalidateConfigCache();
	if (session) {
		try {
			await session.close();
		} catch {
			// ignore
		}
	}
});

describe('live record labels → table view', () => {
	it('breakers.board shows room · board, not bare record id', async ({ skip }) => {
		if (!available || !session) skip();

		invalidateConfigCache();
		// Default resolve path (fresh overlay every time) — must match what /table load uses
		const config = await resolveAppConfig(session!);
		const boardsEntity = entityByName(config, 'boards');
		expect(boardsEntity?.display?.parts.map((p) => p.path)).toEqual(['room.name', 'name']);

		const breakers = entityByName(config, 'breakers');
		expect(breakers).toBeTruthy();

		const rows = await queryEntities(session!, 'breakers');
		expect(rows.length).toBeGreaterThan(0);

		const { labels, store } = await loadRecordLabels(session!, config, breakers!, rows);
		expect(store.size).toBeGreaterThan(0);
		// Room hops must be loaded for composite board labels
		const hasRoom = [...store.keys()].some((id) => id.startsWith('electric_rooms:'));
		expect(hasRoom).toBe(true);

		const view = toTable(breakers!, rows, { labels, store, config });
		const withBoard = view.data.filter((r) => r.board != null && r.board !== '');
		expect(withBoard.length).toBeGreaterThan(0);

		// Cells keep record ids for inline editors; labels stay on the index (and options).
		for (const row of withBoard.slice(0, 20)) {
			const cell = String(row.board);
			expect(cell).toMatch(/^boards:/);
			const label = labels.get(cell);
			expect(label).toBeTruthy();
			expect(label).not.toMatch(/^boards:/);
			expect(label!.includes(' · ')).toBe(true);
		}

		const sampleId = String(withBoard[0]!.board);
		const sample = labels.get(sampleId)!;
		const [roomPart, boardPart] = sample.split(' · ');
		expect(roomPart?.length).toBeGreaterThan(0);
		expect(boardPart?.length).toBeGreaterThan(0);
		// eslint-disable-next-line no-console
		console.info('[record-labels] breaker.board sample:', sampleId, '→', sample);
	});

	it('boards.room and electric_rooms.level use entity display labels', async ({ skip }) => {
		if (!available || !session) skip();

		const config = await resolveAppConfig(session!, { skipCache: true });

		const boards = entityByName(config, 'boards')!;
		const boardRows = await queryEntities(session!, 'boards');
		const boardLabels = await loadRecordLabels(session!, config, boards, boardRows);
		const boardView = toTable(boards, boardRows, {
			labels: boardLabels.labels,
			store: boardLabels.store,
			config
		});
		const roomCell = boardView.data.find((r) => r.room != null)?.room;
		expect(roomCell).toBeTruthy();
		// Cell stores the record id; readable labels are on the label index / options.
		expect(String(roomCell)).toMatch(/^electric_rooms:/);
		const roomLabel = boardLabels.labels.get(String(roomCell));
		expect(roomLabel).toBeTruthy();
		expect(roomLabel).not.toMatch(/^electric_rooms:/);

		const rooms = entityByName(config, 'electric_rooms')!;
		const roomRows = await queryEntities(session!, 'electric_rooms');
		const roomLabels = await loadRecordLabels(session!, config, rooms, roomRows);
		const roomView = toTable(rooms, roomRows, {
			labels: roomLabels.labels,
			store: roomLabels.store,
			config
		});
		const levelCell = roomView.data.find((r) => r.level != null)?.level;
		expect(levelCell).toBeTruthy();
		expect(String(levelCell)).toMatch(/^levels:/);
		const levelLabel = roomLabels.labels.get(String(levelCell));
		expect(levelLabel).toBeTruthy();
		expect(levelLabel).not.toMatch(/^levels:/);
		// levels display is the level name (overlay: display.field = 'name')
		expect(String(levelLabel)).not.toMatch(/ · /);
	});
});
