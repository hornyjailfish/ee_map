import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedConfig, ResolvedEntity, ResolvedMapLayer } from '$lib/config/types';
import { geometryBBox, normalizeGeometry, toMap } from './to-map';

function field(name: string, type = 'string') {
	return {
		name,
		label: name,
		type,
		optional: false,
		hidden: false,
		readOnly: false
	};
}

function entity(name: string, extra: Partial<ResolvedEntity> = {}): ResolvedEntity {
	return {
		name,
		label: name,
		fields: [field('id'), field('name'), field('level', 'record'), field('geometry', 'geometry')],
		permissions: { create: false, update: false, delete: false, select: false },
		...extra
	};
}

function layer(
	partial: Partial<ResolvedMapLayer> & Pick<ResolvedMapLayer, 'table'>
): ResolvedMapLayer {
	return {
		levelField: 'level',
		geometryField: 'geometry',
		styleKey: partial.table,
		zIndex: 0,
		...partial
	};
}

function config(
	overrides: {
		tables?: ResolvedConfig['tables'];
		relations?: ResolvedConfig['relations'];
		map?: Partial<ResolvedConfig['map']>;
		search?: ResolvedConfig['search'];
		graph?: ResolvedConfig['graph'];
		diagnostics?: ResolvedConfig['diagnostics'];
	} = {}
): ResolvedConfig {
	const mapOv = overrides.map ?? {};
	return {
		version: 1,
		tables: overrides.tables ?? [],
		relations: overrides.relations ?? [],
		map: {
			units: 'm',
			plane: 'xy-meters',
			levelsTable: 'levels',
			levelOrderField: 'ord',
			layers: [],
			...mapOv
		},
		search: overrides.search ?? { fieldsByTable: {} },
		graph: overrides.graph ?? {
			hierarchy: ['room', 'board', 'breaker', 'output', 'group'],
			layout: {
				...DEFAULT_GRAPH_LAYOUT,
				spacing: { ...DEFAULT_GRAPH_LAYOUT.spacing },
				compoundPadding: { ...DEFAULT_GRAPH_LAYOUT.compoundPadding }
			}
		},
		diagnostics: overrides.diagnostics ?? []
	};
}

const pointGeom = { type: 'Point', coordinates: [10, 20] };
const polyGeom = {
	type: 'Polygon',
	coordinates: [
		[
			[0, 0],
			[4, 0],
			[4, 3],
			[0, 3],
			[0, 0]
		]
	]
};

describe('normalizeGeometry', () => {
	it('normalizes GeoJSON Point', () => {
		expect(normalizeGeometry(pointGeom)).toEqual({ kind: 'point', x: 10, y: 20 });
	});

	it('normalizes GeoJSON Polygon rings', () => {
		const g = normalizeGeometry(polyGeom);
		expect(g.kind).toBe('polygon');
		if (g.kind === 'polygon') {
			expect(g.rings).toHaveLength(1);
			expect(g.rings[0]).toEqual([
				[0, 0],
				[4, 0],
				[4, 3],
				[0, 3],
				[0, 0]
			]);
		}
	});

	it('accepts case-insensitive type and polygon with hole', () => {
		const g = normalizeGeometry({
			type: 'POLYGON',
			coordinates: [
				[
					[0, 0],
					[10, 0],
					[10, 10],
					[0, 10],
					[0, 0]
				],
				[
					[2, 2],
					[4, 2],
					[4, 4],
					[2, 4],
					[2, 2]
				]
			]
		});
		expect(g.kind).toBe('polygon');
		if (g.kind === 'polygon') {
			expect(g.rings).toHaveLength(2);
			expect(g.rings[1][0]).toEqual([2, 2]);
		}
	});

	it('unwraps Feature geometry', () => {
		expect(
			normalizeGeometry({
				type: 'Feature',
				geometry: pointGeom,
				properties: {}
			})
		).toEqual({ kind: 'point', x: 10, y: 20 });
	});

	it('accepts bare { x, y }', () => {
		expect(normalizeGeometry({ x: 1.5, y: -2 })).toEqual({ kind: 'point', x: 1.5, y: -2 });
	});

	it('returns empty for invalid geometry', () => {
		expect(normalizeGeometry(null)).toEqual({ kind: 'empty' });
		expect(normalizeGeometry(undefined)).toEqual({ kind: 'empty' });
		expect(normalizeGeometry({})).toEqual({ kind: 'empty' });
		expect(normalizeGeometry({ type: 'Point', coordinates: [1] })).toEqual({ kind: 'empty' });
		expect(
			normalizeGeometry({
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[1, 1]
					]
				]
			})
		).toEqual({
			kind: 'empty'
		});
		expect(
			normalizeGeometry({
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 1]
				]
			})
		).toEqual({
			kind: 'empty'
		});
		expect(normalizeGeometry('not-geometry')).toEqual({ kind: 'empty' });
	});
});

describe('geometryBBox', () => {
	it('returns point degenerate box', () => {
		expect(geometryBBox({ kind: 'point', x: 3, y: 7 })).toEqual([3, 7, 3, 7]);
	});

	it('returns polygon envelope', () => {
		const g = normalizeGeometry(polyGeom);
		expect(geometryBBox(g)).toEqual([0, 0, 4, 3]);
	});

	it('returns null for empty', () => {
		expect(geometryBBox({ kind: 'empty' })).toBeNull();
	});
});

describe('toMap', () => {
	const mapConfig = config({
		tables: [
			entity('electric_rooms'),
			entity('rents'),
			entity('zones'),
			entity('levels', {
				fields: [field('id'), field('name'), field('ord', 'number')]
			}),
			// Present in tables but map.enabled false → not in layers
			entity('hidden_stuff')
		],
		map: {
			layers: [
				layer({ table: 'zones', styleKey: 'zones', zIndex: 5, layerGroup: 'zones' }),
				layer({
					table: 'electric_rooms',
					styleKey: 'electric_rooms',
					zIndex: 10,
					layerGroup: 'rooms'
				}),
				layer({ table: 'rents', styleKey: 'rents', zIndex: 20, layerGroup: 'tenancy' })
			]
		}
	});

	const entities = {
		zones: [
			{
				id: 'zones:z1',
				name: 'Zone A',
				level: 'levels:1',
				geometry: polyGeom
			}
		],
		electric_rooms: [
			{
				id: 'electric_rooms:r1',
				name: 'ER-A',
				level: 'levels:1',
				geometry: pointGeom
			},
			{
				id: 'electric_rooms:r2',
				name: 'ER-B',
				level: 'levels:2',
				geometry: { type: 'Point', coordinates: [100, 200] }
			},
			{
				id: 'electric_rooms:r3',
				name: 'No geom',
				level: 'levels:1',
				geometry: null
			}
		],
		rents: [
			{
				id: 'rents:t1',
				name: 'Unit 101',
				level: { tb: 'levels', id: '1', toString: () => 'levels:1' },
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[1, 1],
							[2, 1],
							[2, 2],
							[1, 2],
							[1, 1]
						]
					]
				}
			}
		],
		// Not in config.map.layers — must be ignored
		hidden_stuff: [
			{
				id: 'hidden_stuff:h1',
				name: 'Nope',
				level: 'levels:1',
				geometry: pointGeom
			}
		]
	};

	it('builds layers in config zIndex order with features', () => {
		const vm = toMap({ config: mapConfig, entities });

		expect(vm.units).toBe('m');
		expect(vm.plane).toBe('xy-meters');
		expect(vm.layers.map((l) => l.table)).toEqual(['zones', 'electric_rooms', 'rents']);
		expect(vm.layers.map((l) => l.zIndex)).toEqual([5, 10, 20]);

		const rooms = vm.layers.find((l) => l.table === 'electric_rooms')!;
		// empty geometry skipped
		expect(rooms.features.map((f) => f.id)).toEqual(['electric_rooms:r1', 'electric_rooms:r2']);
		expect(rooms.features[0]).toMatchObject({
			table: 'electric_rooms',
			levelId: 'levels:1',
			label: 'ER-A',
			styleKey: 'electric_rooms',
			zIndex: 10,
			layerGroup: 'rooms',
			geometry: { kind: 'point', x: 10, y: 20 }
		});
		expect(rooms.features[0].properties).toMatchObject({ name: 'ER-A' });

		const zones = vm.layers.find((l) => l.table === 'zones')!;
		expect(zones.features[0].geometry.kind).toBe('polygon');

		// Only layers listed in config.map.layers
		expect(vm.layers.some((l) => l.table === 'hidden_stuff')).toBe(false);
	});

	it('filters features by levelId when provided', () => {
		const vm = toMap({ config: mapConfig, entities, levelId: 'levels:1' });

		const rooms = vm.layers.find((l) => l.table === 'electric_rooms')!;
		expect(rooms.features.map((f) => f.id)).toEqual(['electric_rooms:r1']);

		const rents = vm.layers.find((l) => l.table === 'rents')!;
		expect(rents.features).toHaveLength(1);
		expect(rents.features[0].levelId).toBe('levels:1');

		const all = toMap({ config: mapConfig, entities, levelId: null });
		expect(all.layers.find((l) => l.table === 'electric_rooms')!.features).toHaveLength(2);
	});

	it('uses config.map.extent when set', () => {
		const withExtent = config({
			map: {
				extent: [0, 0, 50, 50],
				layers: [layer({ table: 'electric_rooms', zIndex: 1 })]
			}
		});

		const vm = toMap({
			config: withExtent,
			entities: {
				electric_rooms: [{ id: 'electric_rooms:r1', level: 'levels:1', geometry: pointGeom }]
			}
		});

		expect(vm.extent).toEqual([0, 0, 50, 50]);
	});

	it('computes extent from feature bboxes when config omits extent', () => {
		const vm = toMap({ config: mapConfig, entities });
		// union of poly [0,0]-[4,3], point [10,20], point [100,200], rent poly [1,1]-[2,2]
		expect(vm.extent).toEqual([0, 0, 100, 200]);
	});

	it('returns null extent when no features and no config extent', () => {
		const emptyCfg = config({
			map: { layers: [layer({ table: 'electric_rooms' })] }
		});
		const vm = toMap({
			config: emptyCfg,
			entities: {
				electric_rooms: [{ id: 'electric_rooms:r1', level: 'levels:1', geometry: null }]
			}
		});
		expect(vm.extent).toBeNull();
		expect(vm.layers[0].features).toEqual([]);
	});

	it('maps optional levels list ordered by ord', () => {
		const vm = toMap({
			config: mapConfig,
			entities: {},
			levels: [
				{ id: 'levels:2', name: 'L2', ord: 2 },
				{ id: 'levels:1', name: 'L1', ord: 1 }
			]
		});

		expect(vm.levels).toEqual([
			{ id: 'levels:1', name: 'L1', ord: 1 },
			{ id: 'levels:2', name: 'L2', ord: 2 }
		]);
	});

	it('does not mutate inputs', () => {
		const rows = [
			{
				id: 'electric_rooms:r1',
				name: 'ER-A',
				level: 'levels:1',
				geometry: { type: 'Point', coordinates: [1, 2] as [number, number] }
			}
		];
		const snapshot = structuredClone(rows);
		const cfg = config({
			map: { layers: [layer({ table: 'electric_rooms' })] }
		});

		toMap({ config: cfg, entities: { electric_rooms: rows } });
		expect(rows).toEqual(snapshot);
	});

	it('keeps metric coordinates without projection', () => {
		const vm = toMap({
			config: config({
				map: { layers: [layer({ table: 'electric_rooms' })] }
			}),
			entities: {
				electric_rooms: [
					{
						id: 'electric_rooms:r1',
						level: 'levels:1',
						// values far outside lon/lat range — must pass through unchanged
						geometry: { type: 'Point', coordinates: [450.25, -12.5] }
					}
				]
			}
		});

		expect(vm.layers[0].features[0].geometry).toEqual({
			kind: 'point',
			x: 450.25,
			y: -12.5
		});
	});
});
