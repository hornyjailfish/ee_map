/**
 * Contract test for database/seed/99-app_config.surql intent.
 * Keeps EE overlay deltas aligned with PLAN + merge behavior (no live DB).
 */

import { describe, it, expect } from 'vitest';
import { merge } from './merge';
import type { AppConfigOverlay, AutoProfile } from './types';

/** Mirrors database/seed/99-app_config.surql (keep in sync when seed changes). */
export const EE_OVERLAY_SEED: AppConfigOverlay = {
	version: 3,
	excludeTables: ['__entity', '__rollout', 'app_config', 'embedding_queue'],
	entities: {
		electric_rooms: {
			label: 'Electric rooms',
			display: { field: 'name' },
			table: { order: ['name', 'level', 'geometry'], sort: 'name' }
		},
		boards: {
			label: 'Boards',
			display: {
				parts: [{ path: 'room.name' }, { path: 'name' }],
				sep: ' · '
			},
			table: {
				order: ['name', 'room'],
				sort: [{ field: 'room' }, { field: 'name' }]
			}
		},
		breakers: {
			label: 'Breakers',
			display: { field: 'name' },
			table: {
				order: ['name', 'board', 'description', 'value'],
				sort: [{ field: 'board' }, { field: 'name' }]
			}
		},
		transformers: {
			label: 'Transformers',
			display: { field: 'name' },
			table: { order: ['name', 'room'] }
		},
		rooms: {
			label: 'Other rooms',
			display: { field: 'name' }
		},
		rents: {
			label: 'Rents',
			display: { field: 'name' }
		},
		zones: {
			label: 'Zones',
			display: { field: 'name' }
		},
		shops: { label: 'Shops', display: { field: 'name' } },
		markers: {
			label: 'Markers',
			display: { field: 'level.name' },
			table: { order: ['level', 'zone', 'closest_shop', 'geometry'] }
		},
		marker_views: {
			label: 'Marker views',
			display: { field: 'generated_description' },
			table: {
				order: ['user_description', 'marker', 'image_url', 'version'],
				hide: ['text_embedding', 'image_embedding'],
				readOnly: ['generated_description', 'version'],
				sort: 'generated_description'
			}
		},
		levels: {
			label: 'Levels',
			display: { field: 'name' },
			table: { order: ['ord', 'name', 'geometry'], sort: 'ord' }
		}
	},
	graph: {
		nodes: {
			electric_rooms: { role: 'room', labelField: 'name' },
			boards: { role: 'board', parentField: 'room', labelField: 'name' },
			breakers: {
				role: 'breaker',
				parentField: 'board',
				labelField: 'name',
				subtitleField: 'description'
			},
			transformers: { role: 'input', parentField: 'room', labelField: 'name' }
		},
		edges: {
			connects: { role: 'feeds', labelField: 'cable' }
		}
	},
	map: {
		units: 'm',
		plane: 'xy-meters',
		levelsTable: 'levels',
		levelOrderField: 'ord',
		layers: {
			levels: {
				geometryField: 'geometry',
				layerGroup: 'background',
				styleKey: 'levels',
				zIndex: 0
			},
			zones: {
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'zones',
				styleKey: 'zones',
				zIndex: 5
			},
			electric_rooms: {
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'rooms',
				styleKey: 'electric_rooms',
				zIndex: 10
			},
			rooms: {
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'rooms',
				styleKey: 'rooms',
				zIndex: 20
			},
			rents: {
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'tenancy',
				styleKey: 'rents',
				zIndex: 20
			},
			markers: {
				levelField: 'level',
				geometryField: 'geometry',
				layerGroup: 'markers',
				styleKey: 'point',
				zIndex: 60
			}
		}
	},
	search: {
		fieldsByTable: {
			electric_rooms: ['name'],
			boards: ['name'],
			breakers: ['name', 'description'],
			rents: ['name'],
			zones: ['name'],
			shops: ['name', 'aliases'],
			marker_views: ['generated_description', 'user_description']
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
				{ name: 'ord', type: 'number', optional: false },
				{
					name: 'geometry',
					type: 'geometry',
					optional: true,
					geometryKinds: ['multiline', 'polygon']
				}
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
			name: 'transformers',
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
			name: 'rooms',
			kind: 'normal',
			fields: [
				{ name: 'name', type: 'string', optional: true },
				{ name: 'level', type: 'record', optional: true, recordTargets: ['levels'] },
				{
					name: 'geometry',
					type: 'geometry',
					optional: true,
					geometryKinds: ['polygon']
				}
			]
		},
		{
			name: 'markers',
			kind: 'normal',
			fields: [
				{ name: 'level', type: 'record', optional: false, recordTargets: ['levels'] },
				{ name: 'zone', type: 'record', optional: false, recordTargets: ['zones'] },
				{ name: 'closest_shop', type: 'record', optional: false, recordTargets: ['rents'] },
				{
					name: 'geometry',
					type: 'geometry',
					optional: false,
					geometryKinds: ['point']
				}
			]
		},
		{
			name: 'marker_views',
			kind: 'normal',
			fields: [
				{ name: 'marker', type: 'record', optional: false, recordTargets: ['markers'] },
				{ name: 'user_description', type: 'string', optional: true },
				{ name: 'generated_description', type: 'string', optional: false },
				{ name: 'text_embedding', type: 'array', optional: true },
				{ name: 'image_embedding', type: 'array', optional: true },
				{ name: 'image_url', type: 'string', optional: true },
				{ name: 'version', type: 'number', optional: false }
			]
		},
		{
			name: 'embedding_queue',
			kind: 'normal',
			fields: [
				{ name: 'data', type: 'record', optional: true, recordTargets: ['marker_views'] },
				{ name: 'status', type: 'string', optional: false }
			]
		},
		{
			name: 'connects',
			kind: 'relation',
			in: ['breakers', 'transformers'],
			out: ['breakers', 'rents'],
			fields: [{ name: 'cable', type: 'string', optional: true }]
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
	it('excludes system tables, app_config, and the out-of-scope embedding_queue', () => {
		const config = merge(eeAuto, EE_OVERLAY_SEED);
		const names = config.tables.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				'boards',
				'breakers',
				'electric_rooms',
				'levels',
				'marker_views',
				'markers',
				'rents',
				'rooms',
				'shops',
				'transformers',
				'zones'
			].sort()
		);
		expect(config.relations.map((r) => r.name)).toEqual(['connects']);
	});

	it('resolves graph roles and parents for room/board/breaker/input', () => {
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
		expect(config.tables.find((t) => t.name === 'transformers')?.graph).toMatchObject({
			role: 'input',
			parentField: 'room'
		});
		expect(config.tables.find((t) => t.name === 'rents')?.graph).toBeUndefined();
		expect(config.graph.nodes?.rents).toBeUndefined();
		expect(config.relations[0]).toMatchObject({
			name: 'connects',
			role: 'feeds',
			labelField: 'cable'
		});
	});

	it('builds map layers ordered by zIndex then table', () => {
		const layers = merge(eeAuto, EE_OVERLAY_SEED).map.layers;
		expect(layers.map((l) => l.table)).toEqual([
			'levels',
			'zones',
			'electric_rooms',
			'rents',
			'rooms',
			'markers'
		]);
		expect(layers.find((l) => l.table === 'rents')).toMatchObject({
			levelField: 'level',
			geometryField: 'geometry',
			zIndex: 20,
			styleKey: 'rents'
		});
		expect(layers.find((l) => l.table === 'markers')).toMatchObject({
			levelField: 'level',
			geometryField: 'geometry',
			zIndex: 60,
			styleKey: 'point'
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
		expect(search.marker_views).toEqual(['generated_description', 'user_description']);
		expect(search.embedding_queue).toBeUndefined();
	});

	it('resolves composite display for boards and simple/accessor display for others', () => {
		const config = merge(eeAuto, EE_OVERLAY_SEED);
		expect(config.tables.find((t) => t.name === 'boards')?.display).toEqual({
			parts: [{ path: 'room.name' }, { path: 'name' }],
			sep: ' · '
		});
		expect(config.tables.find((t) => t.name === 'levels')?.display).toEqual({
			parts: [{ path: 'name' }],
			sep: ' · '
		});
		// Dotted accessor survives merge; the root segment is the only compile-time check.
		expect(config.tables.find((t) => t.name === 'markers')?.display).toEqual({
			parts: [{ path: 'level.name' }],
			sep: ' · '
		});
		expect(config.tables.find((t) => t.name === 'marker_views')?.display).toEqual({
			parts: [{ path: 'generated_description' }],
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
		expect(config.tables.find((t) => t.name === 'marker_views')?.sort).toEqual([
			{ field: 'generated_description', dir: 'asc' }
		]);
		expect(config.tables.find((t) => t.name === 'levels')?.sort).toEqual([
			{ field: 'ord', dir: 'asc' }
		]);
	});

	it('hides embedding vectors + readOnly computed fields on marker_views', () => {
		const config = merge(eeAuto, EE_OVERLAY_SEED);
		const views = config.tables.find((t) => t.name === 'marker_views');
		const fields = Object.fromEntries(views!.fields.map((f) => [f.name, f]));
		expect(fields.text_embedding?.hidden).toBe(true);
		expect(fields.image_embedding?.hidden).toBe(true);
		expect(fields.generated_description?.readOnly).toBe(true);
		expect(fields.version?.readOnly).toBe(true);
		expect(fields.user_description?.readOnly).toBe(false);
	});

	it('produces no orphan / missing-field diagnostics for the seed against EE auto', () => {
		const { diagnostics } = merge(eeAuto, EE_OVERLAY_SEED);
		expect(diagnostics).toEqual([]);
	});
});
