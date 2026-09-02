/**
 * Contract test for database/seed/app_config.surql intent.
 * Keeps EE overlay deltas aligned with PLAN + merge behavior (no live DB).
 */

import { describe, it, expect } from 'vitest';
import { merge } from './merge';
import type { AppConfigOverlay, AutoProfile } from './types';

/** Mirrors database/seed/app_config.surql (keep in sync when seed changes). */
export const EE_OVERLAY_SEED: AppConfigOverlay = {
	version: 1,
	excludeTables: ['__entity', '__rollout', 'app_config', 'embeddings'],
	entities: {
		electric_rooms: {
			label: 'Electric rooms',
			display: { field: 'name' },
			graph: { role: 'room', labelField: 'name' },
			map: {
				enabled: true,
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'rooms',
				styleKey: 'electric_rooms',
				zIndex: 10
			},
			table: { order: ['name', 'level', 'geometry'], sort: 'name' }
		},
		boards: {
			label: 'Boards',
			display: {
				parts: [{ path: 'room.name' }, { path: 'name' }],
				sep: ' · '
			},
			graph: { role: 'board', parentField: 'room', labelField: 'name' },
			table: {
				order: ['name', 'room'],
				sort: [{ field: 'room' }, { field: 'name' }]
			}
		},
		breakers: {
			label: 'Breakers',
			display: { field: 'name' },
			graph: {
				role: 'breaker',
				parentField: 'board',
				labelField: 'name',
				subtitleField: 'description'
			},
			table: {
				order: ['name', 'board', 'description', 'value'],
				sort: [{ field: 'name' }, { field: 'board' }]
			}
		},
		rents: {
			label: 'Rents',
			display: { field: 'name' },
			graph: { role: 'ignore' },
			map: {
				enabled: true,
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'tenancy',
				styleKey: 'rents',
				zIndex: 20
			}
		},
		zones: {
			label: 'Zones',
			display: { field: 'name' },
			graph: { role: 'ignore' },
			map: {
				enabled: true,
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'zones',
				styleKey: 'zones',
				zIndex: 5
			}
		},
		shops: { label: 'Shops', display: { field: 'name' } },
		levels: {
			label: 'Levels',
			display: { field: 'name' },
			table: { order: ['ord', 'name'], sort: 'ord' }
		}
	},
	edges: {
		connects: { role: 'feeds', labelField: 'cable' }
	},
	map: {
		units: 'm',
		plane: 'xy-meters',
		levelsTable: 'levels',
		levelOrderField: 'ord'
	},
	search: {
		fieldsByTable: {
			electric_rooms: ['name'],
			boards: ['name'],
			breakers: ['name', 'description'],
			rents: ['name'],
			zones: ['name'],
			shops: ['name', 'aliases']
		}
	}
};

const eeAuto: AutoProfile = {
	tables: [
		{
			name: 'levels',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: false },
				{ name: 'ord', type: 'number', optional: false }
			]
		},
		{
			name: 'electric_rooms',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: false },
				{ name: 'level', type: 'record', optional: false, recordTargets: ['levels'] },
				{
					name: 'geometry',
					type: 'geometry',
					optional: true,
					geometryKinds: ['polygon']
				}
			]
		},
		{
			name: 'boards',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: false },
				{
					name: 'room',
					type: 'record',
					optional: false,
					recordTargets: ['electric_rooms']
				}
			]
		},
		{
			name: 'breakers',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: false },
				{ name: 'description', type: 'string', optional: true },
				{ name: 'value', type: 'number', optional: true },
				{ name: 'board', type: 'record', optional: false, recordTargets: ['boards'] }
			]
		},
		{
			name: 'rents',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: false },
				{ name: 'level', type: 'record', optional: false, recordTargets: ['levels'] },
				{
					name: 'geometry',
					type: 'geometry',
					optional: false,
					geometryKinds: ['polygon']
				}
			]
		},
		{
			name: 'zones',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: false },
				{ name: 'level', type: 'record', optional: false, recordTargets: ['levels'] },
				{
					name: 'geometry',
					type: 'geometry',
					optional: false,
					geometryKinds: ['polygon']
				}
			]
		},
		{
			name: 'shops',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: false },
				{ name: 'aliases', type: 'array', optional: true },
				{ name: 'area', type: 'record', optional: false, recordTargets: ['rents'] }
			]
		},
		{
			name: 'connects',
			kind: 'relation',
			in: ['breakers'],
			out: ['breakers', 'rents'],
			fields: [{ name: 'cable', type: 'string', optional: true }]
		},
		{
			name: 'embeddings',
			kind: 'normal',
			fields: [{ name: 'marker', type: 'geometry', optional: false, geometryKinds: ['point'] }]
		},
		{
			name: 'app_config',
			kind: 'normal',
			fields: [{ name: 'version', type: 'number', optional: false }]
		},
		{
			name: '__entity',
			kind: 'normal',
			fields: []
		}
	]
};

describe('EE app_config seed → merge', () => {
	it('excludes system + embeddings + app_config', () => {
		const config = merge(eeAuto, EE_OVERLAY_SEED);
		const names = config.tables.map((t) => t.name).sort();
		expect(names).toEqual(
			['boards', 'breakers', 'electric_rooms', 'levels', 'rents', 'shops', 'zones'].sort()
		);
		expect(config.relations.map((r) => r.name)).toEqual(['connects']);
	});

	it('resolves graph roles and parents for room/board/breaker', () => {
		const config = merge(eeAuto, EE_OVERLAY_SEED);
		expect(config.tables.find((t) => t.name === 'electric_rooms')?.graph).toMatchObject({
			role: 'room',
			labelField: 'name'
		});
		expect(config.tables.find((t) => t.name === 'boards')?.graph).toMatchObject({
			role: 'board',
			parentField: 'room'
		});
		expect(config.tables.find((t) => t.name === 'breakers')?.graph).toMatchObject({
			role: 'breaker',
			parentField: 'board',
			subtitleField: 'description'
		});
		expect(config.tables.find((t) => t.name === 'rents')?.graph?.role).toBe('ignore');
		expect(config.relations[0]).toMatchObject({
			name: 'connects',
			role: 'feeds',
			labelField: 'cable'
		});
	});

	it('builds map layers ordered by zIndex then table', () => {
		const layers = merge(eeAuto, EE_OVERLAY_SEED).map.layers;
		expect(layers.map((l) => l.table)).toEqual(['zones', 'electric_rooms', 'rents']);
		expect(layers.find((l) => l.table === 'rents')).toMatchObject({
			levelField: 'level',
			geometryField: 'geometry',
			zIndex: 20,
			styleKey: 'rents'
		});
		expect(merge(eeAuto, EE_OVERLAY_SEED).map).toMatchObject({
			units: 'm',
			plane: 'xy-meters',
			levelsTable: 'levels',
			levelOrderField: 'ord'
		});
	});

	it('keeps search fields for included tables only', () => {
		const search = merge(eeAuto, EE_OVERLAY_SEED).search.fieldsByTable;
		expect(search.breakers).toEqual(['name', 'description']);
		expect(search.embeddings).toBeUndefined();
	});

	it('resolves composite display for boards and simple display for levels/rooms', () => {
		const config = merge(eeAuto, EE_OVERLAY_SEED);
		expect(config.tables.find((t) => t.name === 'boards')?.display).toEqual({
			parts: [{ path: 'room.name' }, { path: 'name' }],
			sep: ' · '
		});
		expect(config.tables.find((t) => t.name === 'levels')?.display).toEqual({
			parts: [{ path: 'name' }],
			sep: ' · '
		});
		expect(config.tables.find((t) => t.name === 'electric_rooms')?.display).toEqual({
			parts: [{ path: 'name' }],
			sep: ' · '
		});
	});

	it('resolves default table sort from overlay', () => {
		const config = merge(eeAuto, EE_OVERLAY_SEED);
		expect(config.tables.find((t) => t.name === 'electric_rooms')?.sort).toEqual([
			{ field: 'name', dir: 'asc' }
		]);
		expect(config.tables.find((t) => t.name === 'boards')?.sort).toEqual([
			{ field: 'room', dir: 'asc' },
			{ field: 'name', dir: 'asc' }
		]);
		expect(config.tables.find((t) => t.name === 'breakers')?.sort).toEqual([
			{ field: 'name', dir: 'asc' },
			{ field: 'board', dir: 'asc' }
		]);
		expect(config.tables.find((t) => t.name === 'levels')?.sort).toEqual([
			{ field: 'ord', dir: 'asc' }
		]);
	});

	it('produces no orphan / missing-field diagnostics for the seed against EE auto', () => {
		const { diagnostics } = merge(eeAuto, EE_OVERLAY_SEED);
		expect(diagnostics).toEqual([]);
	});
});
