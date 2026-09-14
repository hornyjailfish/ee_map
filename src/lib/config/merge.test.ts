import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT, merge } from './merge';
import type { AppConfigOverlay, AutoProfile } from './types';

const emptyAuto: AutoProfile = { tables: [] };

const defaultMap = {
	units: 'm' as const,
	plane: 'xy-meters' as const,
	levelsTable: 'levels',
	levelOrderField: 'ord',
	layers: []
};

const defaultGraph = {
	hierarchy: ['room', 'board', 'breaker', 'output', 'group'] as const,
	layout: {
		...DEFAULT_GRAPH_LAYOUT,
		spacing: { ...DEFAULT_GRAPH_LAYOUT.spacing },
		compoundPadding: { ...DEFAULT_GRAPH_LAYOUT.compoundPadding }
	}
};

describe('merge', () => {
	it('returns empty tables/relations, default map, and empty diagnostics for empty inputs', () => {
		const result = merge(emptyAuto);

		expect(result).toEqual({
			version: 1,
			tables: [],
			relations: [],
			map: defaultMap,
			search: { fieldsByTable: {} },
			graph: {
				hierarchy: [...defaultGraph.hierarchy],
				layout: {
					...defaultGraph.layout,
					spacing: { ...defaultGraph.layout.spacing },
					compoundPadding: { ...defaultGraph.layout.compoundPadding }
				}
			},
			diagnostics: []
		});
	});

	it('treats null and undefined overlay like no overlay', () => {
		expect(merge(emptyAuto, null)).toEqual(merge(emptyAuto));
		expect(merge(emptyAuto, undefined)).toEqual(merge(emptyAuto));
	});

	it('resolves graph.layout overrides from overlay', () => {
		const overlay: AppConfigOverlay = {
			version: 1,
			graph: {
				layout: {
					direction: 'RIGHT',
					align: 'start',
					spacing: { node: 20, layer: 40 },
					compoundPadding: { top: 16 }
				}
			}
		};

		const result = merge(emptyAuto, overlay);

		expect(result.graph.layout).toEqual({
			direction: 'RIGHT',
			align: 'start',
			spacing: {
				...DEFAULT_GRAPH_LAYOUT.spacing,
				node: 20,
				layer: 40
			},
			compoundPadding: {
				...DEFAULT_GRAPH_LAYOUT.compoundPadding,
				top: 16
			}
		});
	});

	it('excludes /^__/ tables and overlay.excludeTables from tables and relations', () => {
		const auto: AutoProfile = {
			tables: [
				{ name: '__entity', kind: 'normal', fields: [{ name: 'id', type: 'string' }] },
				{ name: 'embeddings', kind: 'normal', fields: [{ name: 'vec', type: 'array' }] },
				{ name: 'app_config', kind: 'normal', fields: [{ name: 'version', type: 'number' }] },
				{ name: 'electric_rooms', kind: 'normal', fields: [{ name: 'name', type: 'string' }] },
				{
					name: 'connects',
					kind: 'relation',
					in: ['boards'],
					out: ['breakers'],
					fields: []
				},
				{
					name: '__rel',
					kind: 'relation',
					in: ['a'],
					out: ['b'],
					fields: []
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			excludeTables: ['embeddings', 'app_config']
		};

		const result = merge(auto, overlay);

		expect(result.tables.map((t) => t.name)).toEqual(['electric_rooms']);
		expect(result.relations.map((r) => r.name)).toEqual(['connects']);
	});

	it('resolves a normal table into an entity with default field presentation', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'electric_rooms',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{
							name: 'level',
							type: 'record',
							recordTargets: ['levels'],
							optional: true
						},
						{
							name: 'geom',
							type: 'geometry',
							geometryKinds: ['polygon']
						}
					]
				}
			]
		};

		const result = merge(auto);

		expect(result.tables).toHaveLength(1);
		const entity = result.tables[0]!;
		expect(entity.name).toBe('electric_rooms');
		expect(entity.label).toBe('electric_rooms');
		expect(entity.graph).toBeUndefined();
		expect(entity.map).toBeUndefined();
		// Heuristic: field named `name` → default display recipe
		expect(entity.display).toEqual({ parts: [{ path: 'name' }], sep: ' · ' });
		expect(entity.fields).toEqual([
			{
				name: 'name',
				label: 'name',
				type: 'string',
				optional: false,
				hidden: false,
				readOnly: false
			},
			{
				name: 'level',
				label: 'level',
				type: 'record',
				optional: true,
				recordTargets: ['levels'],
				hidden: false,
				readOnly: false
			},
			{
				name: 'geom',
				label: 'geom',
				type: 'geometry',
				optional: false,
				geometryKinds: ['polygon'],
				hidden: false,
				readOnly: false
			}
		]);
	});

	it('applies field order, hide, readOnly, labels, editor, and width from overlay', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'boards',
					kind: 'normal',
					fields: [
						{ name: 'id', type: 'string' },
						{ name: 'name', type: 'string' },
						{ name: 'notes', type: 'string', optional: true },
						{ name: 'amps', type: 'number' }
					]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				boards: {
					label: 'Boards',
					table: {
						order: ['name', 'amps', 'missing_field'],
						hide: ['id'],
						readOnly: ['amps'],
						fields: {
							name: { label: 'Board name', width: 180 },
							notes: { hidden: true, editor: false },
							amps: { editor: 'ampEditor' }
						}
					}
				}
			}
		};

		const entity = merge(auto, overlay).tables[0]!;

		expect(entity.label).toBe('Boards');
		expect(entity.fields.map((f) => f.name)).toEqual(['name', 'amps', 'id', 'notes']);
		expect(entity.fields[0]).toMatchObject({
			name: 'name',
			label: 'Board name',
			width: 180,
			hidden: false,
			readOnly: false
		});
		expect(entity.fields[1]).toMatchObject({
			name: 'amps',
			readOnly: true,
			editor: 'ampEditor'
		});
		expect(entity.fields[2]).toMatchObject({ name: 'id', hidden: true });
		expect(entity.fields[3]).toMatchObject({
			name: 'notes',
			hidden: true,
			editor: false
		});
	});

	it('resolves relation tables to edges with in/out and overlay role', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'connects',
					kind: 'relation',
					in: ['boards'],
					out: ['breakers'],
					fields: [{ name: 'label', type: 'string', optional: true }]
				},
				{
					name: 'rents',
					kind: 'relation',
					in: ['shops'],
					out: ['zones'],
					fields: []
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			edges: {
				connects: { role: 'feeds', edgeType: 'power', labelField: 'label' }
			}
		};

		const result = merge(auto, overlay);

		expect(result.relations).toEqual([
			{
				name: 'connects',
				role: 'feeds',
				edgeType: 'power',
				labelField: 'label',
				in: ['boards'],
				out: ['breakers'],
				fields: [
					{
						name: 'label',
						label: 'label',
						type: 'string',
						optional: true,
						hidden: false,
						readOnly: false
					}
				],
				permissions: { create: false, update: false, delete: false, select: false }
			},
			{
				name: 'rents',
				role: 'other',
				in: ['shops'],
				out: ['zones'],
				fields: [],
				permissions: { create: false, update: false, delete: false, select: false }
			}
		]);
	});

	it('resolves table.sort from string, object, and multi-key array', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'rooms',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'level', type: 'record', recordTargets: ['levels'] }
					]
				},
				{
					name: 'boards',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'room', type: 'record', recordTargets: ['rooms'] }
					]
				},
				{
					name: 'levels',
					kind: 'normal',
					fields: [
						{ name: 'ord', type: 'number' },
						{ name: 'name', type: 'string' }
					]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				rooms: { table: { sort: 'name' } },
				boards: {
					table: {
						sort: [
							{ field: 'room', dir: 'asc' },
							{ field: 'name', dir: 'desc' }
						]
					}
				},
				levels: { table: { sort: { field: 'ord', dir: 'desc' } } }
			}
		};

		const result = merge(auto, overlay);
		expect(result.tables.find((t) => t.name === 'rooms')?.sort).toEqual([
			{ field: 'name', dir: 'asc' }
		]);
		expect(result.tables.find((t) => t.name === 'boards')?.sort).toEqual([
			{ field: 'room', dir: 'asc' },
			{ field: 'name', dir: 'desc' }
		]);
		expect(result.tables.find((t) => t.name === 'levels')?.sort).toEqual([
			{ field: 'ord', dir: 'desc' }
		]);
	});

	it('defaults table.sort to name asc when field exists and overlay omits sort', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'shops',
					kind: 'normal',
					fields: [{ name: 'name', type: 'string' }]
				}
			]
		};
		expect(merge(auto).tables[0]?.sort).toEqual([{ field: 'name', dir: 'asc' }]);
	});

	it('warns when table.sort field is missing', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'shops',
					kind: 'normal',
					fields: [{ name: 'name', type: 'string' }]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				shops: { table: { sort: 'title' } }
			}
		};
		const result = merge(auto, overlay);
		expect(result.diagnostics.some((d) => d.code === 'missing_sort_field')).toBe(true);
		expect(result.tables[0]?.sort).toBeUndefined();
	});

	it('resolves entity display from overlay parts, field sugar, and graph.labelField', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'levels',
					kind: 'normal',
					fields: [
						{ name: 'ord', type: 'number' },
						{ name: 'name', type: 'string' }
					]
				},
				{
					name: 'boards',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'room', type: 'record', recordTargets: ['electric_rooms'] }
					]
				},
				{
					name: 'breakers',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'board', type: 'record', recordTargets: ['boards'] }
					]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				levels: {
					display: { parts: [{ path: 'ord' }, { path: 'name' }] }
				},
				boards: {
					display: {
						parts: [{ path: 'room.name' }, { path: 'name' }],
						sep: ' · '
					}
				},
				breakers: {
					graph: { role: 'breaker', labelField: 'name' }
				}
			}
		};

		const result = merge(auto, overlay);
		expect(result.tables.find((t) => t.name === 'levels')?.display).toEqual({
			parts: [{ path: 'ord' }, { path: 'name' }],
			sep: ' · '
		});
		expect(result.tables.find((t) => t.name === 'boards')?.display).toEqual({
			parts: [{ path: 'room.name' }, { path: 'name' }],
			sep: ' · '
		});
		// graph.labelField promotes to display when overlay.display omitted
		expect(result.tables.find((t) => t.name === 'breakers')?.display).toEqual({
			parts: [{ path: 'name' }],
			sep: ' · '
		});
	});

	it('warns when display path root is missing from entity fields', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'boards',
					kind: 'normal',
					fields: [{ name: 'name', type: 'string' }]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				boards: {
					display: { field: 'title' }
				}
			}
		};
		const result = merge(auto, overlay);
		expect(result.diagnostics.some((d) => d.code === 'missing_display_field')).toBe(true);
		expect(result.tables[0]?.display).toEqual({
			parts: [{ path: 'title' }],
			sep: ' · '
		});
	});

	it('resolves EE graph roles, connects edge, rents map layer, and constant hierarchy', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'electric_rooms',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'level', type: 'record', recordTargets: ['levels'] }
					]
				},
				{
					name: 'boards',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'room', type: 'record', recordTargets: ['electric_rooms'] }
					]
				},
				{
					name: 'breakers',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'board', type: 'record', recordTargets: ['boards'] }
					]
				},
				{
					name: 'shops',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'level', type: 'record', recordTargets: ['levels'] },
						{ name: 'footprint', type: 'geometry', geometryKinds: ['polygon'] }
					]
				},
				{
					name: 'connects',
					kind: 'relation',
					in: ['boards'],
					out: ['breakers'],
					fields: []
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				electric_rooms: {
					graph: { role: 'room', labelField: 'name' }
				},
				boards: {
					graph: { role: 'board', parentField: 'room', labelField: 'name' }
				},
				breakers: {
					graph: { role: 'breaker', parentField: 'board', labelField: 'name' }
				},
				shops: {
					map: { enabled: true, zIndex: 2, layerGroup: 'tenancy' }
				}
			},
			edges: {
				connects: { role: 'feeds' }
			}
		};

		const result = merge(auto, overlay);

		expect(result.graph.hierarchy).toEqual(['room', 'board', 'breaker', 'output', 'group']);
		expect(result.tables.find((t) => t.name === 'electric_rooms')?.graph).toEqual({
			role: 'room',
			labelField: 'name'
		});
		expect(result.tables.find((t) => t.name === 'boards')?.graph).toEqual({
			role: 'board',
			parentField: 'room',
			labelField: 'name'
		});
		expect(result.tables.find((t) => t.name === 'breakers')?.graph).toEqual({
			role: 'breaker',
			parentField: 'board',
			labelField: 'name'
		});
		expect(result.relations[0]?.role).toBe('feeds');
		expect(result.map.layers).toEqual([
			{
				table: 'shops',
				levelField: 'level',
				geometryField: 'footprint',
				layerGroup: 'tenancy',
				styleKey: 'shops',
				zIndex: 2
			}
		]);
		const shops = result.tables.find((t) => t.name === 'shops')!;
		expect(shops.map).toMatchObject({
			enabled: true,
			levelField: 'level',
			geometryField: 'footprint',
			layerGroup: 'tenancy',
			zIndex: 2
		});
	});

	it('warns on orphan entity overlay keys that are not in the auto profile', () => {
		const auto: AutoProfile = {
			tables: [
				{ name: 'electric_rooms', kind: 'normal', fields: [{ name: 'name', type: 'string' }] }
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			excludeTables: ['ghost_excluded'],
			entities: {
				electric_rooms: { label: 'Rooms' },
				never_existed: { label: 'Nope' },
				ghost_excluded: { label: 'Excluded' }
			}
		};

		const result = merge(auto, overlay);

		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				{
					level: 'warn',
					code: 'orphan_entity_overlay',
					message: expect.stringContaining('never_existed')
				},
				{
					level: 'info',
					code: 'orphan_entity_overlay',
					message: expect.stringContaining('ghost_excluded')
				}
			])
		);
		expect(
			result.diagnostics.filter(
				(d) => d.code === 'orphan_entity_overlay' && d.message.includes('electric_rooms')
			)
		).toHaveLength(0);
	});

	it('warns and skips map layers that are enabled without geometry', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'zones',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string' },
						{ name: 'level', type: 'record', recordTargets: ['levels'] }
					]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				zones: {
					map: { enabled: true }
				}
			}
		};

		const result = merge(auto, overlay);

		expect(result.tables[0]?.map?.enabled).toBe(true);
		expect(result.map.layers).toEqual([]);
		expect(result.diagnostics).toContainEqual({
			level: 'warn',
			code: 'map_layer_incomplete',
			message: expect.stringContaining('zones')
		});
	});

	it('warns when graph parentField is missing from the table fields', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'breakers',
					kind: 'normal',
					fields: [{ name: 'name', type: 'string' }]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				breakers: {
					graph: { role: 'breaker', parentField: 'board', labelField: 'title' }
				}
			}
		};

		const result = merge(auto, overlay);

		expect(result.tables[0]?.graph).toEqual({
			role: 'breaker',
			parentField: 'board',
			labelField: 'title'
		});
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				{
					level: 'warn',
					code: 'missing_parent_field',
					message: expect.stringMatching(/board/)
				},
				{
					level: 'warn',
					code: 'missing_label_field',
					message: expect.stringMatching(/title/)
				}
			])
		);
	});

	it('puts unknown kind tables in tables with an info diagnostic', () => {
		const auto: AutoProfile = {
			tables: [{ name: 'mystery', kind: 'unknown', fields: [{ name: 'x', type: 'string' }] }]
		};

		const result = merge(auto);

		expect(result.tables.map((t) => t.name)).toEqual(['mystery']);
		expect(result.relations).toEqual([]);
		expect(result.diagnostics).toContainEqual({
			level: 'info',
			code: 'unknown_table_kind',
			message: expect.stringContaining('mystery')
		});
	});

	it('strips search fields for excluded or missing tables with warn diagnostics', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'electric_rooms',
					kind: 'normal',
					fields: [{ name: 'name', type: 'string' }]
				},
				{
					name: 'embeddings',
					kind: 'normal',
					fields: [{ name: 'vec', type: 'array' }]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			excludeTables: ['embeddings'],
			search: {
				fieldsByTable: {
					electric_rooms: ['name'],
					embeddings: ['vec'],
					nope: ['x']
				}
			}
		};

		const result = merge(auto, overlay);

		expect(result.search.fieldsByTable).toEqual({ electric_rooms: ['name'] });
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				{
					level: 'warn',
					code: 'search_unknown_table',
					message: expect.stringContaining('embeddings')
				},
				{
					level: 'warn',
					code: 'search_unknown_table',
					message: expect.stringContaining('nope')
				}
			])
		);
	});

	it('warns on orphan edge overlay keys that are not relation tables', () => {
		const auto: AutoProfile = {
			tables: [
				{ name: 'boards', kind: 'normal', fields: [{ name: 'name', type: 'string' }] },
				{
					name: 'connects',
					kind: 'relation',
					in: ['boards'],
					out: ['breakers'],
					fields: []
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			edges: {
				connects: { role: 'feeds' },
				boards: { role: 'other' },
				missing_rel: { role: 'other' }
			}
		};

		const result = merge(auto, overlay);

		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				{
					level: 'warn',
					code: 'orphan_edge_overlay',
					message: expect.stringContaining('boards')
				},
				{
					level: 'warn',
					code: 'orphan_edge_overlay',
					message: expect.stringContaining('missing_rel')
				}
			])
		);
	});

	it('sorts map layers by zIndex then table name', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'zones',
					kind: 'normal',
					fields: [
						{ name: 'level', type: 'record', recordTargets: ['levels'] },
						{ name: 'geom', type: 'geometry', geometryKinds: ['polygon'] }
					]
				},
				{
					name: 'shops',
					kind: 'normal',
					fields: [
						{ name: 'level', type: 'record', recordTargets: ['levels'] },
						{ name: 'geom', type: 'geometry', geometryKinds: ['polygon'] }
					]
				},
				{
					name: 'alpha',
					kind: 'normal',
					fields: [
						{ name: 'level', type: 'record', recordTargets: ['levels'] },
						{ name: 'geom', type: 'geometry', geometryKinds: ['polygon'] }
					]
				}
			]
		};
		const overlay: AppConfigOverlay = {
			version: 1,
			entities: {
				zones: { map: { enabled: true, zIndex: 5 } },
				shops: { map: { enabled: true, zIndex: 1 } },
				alpha: { map: { enabled: true, zIndex: 1 } }
			}
		};

		const layers = merge(auto, overlay).map.layers;

		expect(layers.map((l) => l.table)).toEqual(['alpha', 'shops', 'zones']);
	});
});
