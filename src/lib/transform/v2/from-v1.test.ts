import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedConfig, ResolvedEntity, ResolvedEdge } from '$lib/config/types';
import {
	deriveViewsFromV1,
	graphNodesFromV1,
	liftGraphNode,
	liftResolvedConfigV1,
	slimEntityFromV1
} from './from-v1';

function field(name: string, type = 'string', extra: Record<string, unknown> = {}) {
	return {
		name,
		label: name,
		type,
		optional: false,
		hidden: false,
		readOnly: false,
		...extra
	};
}

function entity(
	name: string,
	extra: Partial<ResolvedEntity> = {},
	fieldNames: string[] = ['name']
): ResolvedEntity {
	return {
		name,
		label: name,
		fields: fieldNames.map((n) => field(n)),
		permissions: { create: false, update: false, delete: false, select: false },
		...extra
	};
}

function config(tables: ResolvedEntity[], relations: ResolvedEdge[] = []): ResolvedConfig {
	return {
		version: 1,
		tables,
		relations,
		map: {
			units: 'm',
			plane: 'xy-meters',
			levelsTable: 'levels',
			levelOrderField: 'ord',
			layers: tables
				.filter((t) => t.map?.enabled)
				.map((t, i) => ({
					table: t.name,
					geometryField: t.map?.geometryField ?? 'geometry',
					levelField: t.map?.levelField,
					styleKey: t.name,
					zIndex: i
				}))
		},
		search: { fieldsByTable: {} },
		graph: {
			hierarchy: ['room', 'board', 'breaker', 'output', 'group'],
			layout: {
				...DEFAULT_GRAPH_LAYOUT,
				spacing: { ...DEFAULT_GRAPH_LAYOUT.spacing },
				compoundPadding: { ...DEFAULT_GRAPH_LAYOUT.compoundPadding }
			}
		},
		diagnostics: []
	};
}

describe('liftGraphNode', () => {
	it('returns null for missing or ignore', () => {
		expect(liftGraphNode(undefined)).toBeNull();
		expect(liftGraphNode({ role: 'ignore' })).toBeNull();
	});

	it('keeps real role + knobs', () => {
		expect(
			liftGraphNode({
				role: 'breaker',
				parentField: 'board',
				labelField: 'name',
				nodeType: 'custom'
			})
		).toEqual({
			role: 'breaker',
			parentField: 'board',
			labelField: 'name',
			nodeType: 'custom'
		});
	});
});

describe('graphNodesFromV1', () => {
	it('indexes non-ignore graph entities by table name', () => {
		const nodes = graphNodesFromV1([
			entity('electric_rooms', { graph: { role: 'room', labelField: 'name' } }),
			entity('boards', { graph: { role: 'board', parentField: 'room' } }),
			entity('rents', { graph: { role: 'ignore' } }),
			entity('shops')
		]);

		expect(Object.keys(nodes).sort()).toEqual(['boards', 'electric_rooms']);
		expect(nodes.boards).toMatchObject({ role: 'board', parentField: 'room' });
		expect(nodes.rents).toBeUndefined();
	});
});

describe('deriveViewsFromV1', () => {
	it('always includes table; graph/map from membership', () => {
		const layers = new Set(['rents']);

		expect(deriveViewsFromV1(entity('shops'), layers)).toEqual(['table']);
		expect(
			deriveViewsFromV1(entity('boards', { graph: { role: 'board' } }), layers)
		).toEqual(['table', 'graph']);
		expect(
			deriveViewsFromV1(
				entity('rents', { map: { enabled: true, geometryField: 'geometry' } }),
				layers
			)
		).toEqual(['table', 'map']);
		expect(
			deriveViewsFromV1(
				entity('rooms', {
					graph: { role: 'room' },
					map: { enabled: true, geometryField: 'geometry' }
				}),
				new Set(['rooms'])
			)
		).toEqual(['table', 'graph', 'map']);
	});

	it('treats layer index as map membership even without entity.map.enabled', () => {
		expect(deriveViewsFromV1(entity('levels'), new Set(['levels']))).toEqual([
			'table',
			'map'
		]);
	});
});

describe('slimEntityFromV1', () => {
	it('strips graph/map denorm and keeps display/sort', () => {
		const e = entity(
			'boards',
			{
				label: 'Boards',
				display: { parts: [{ path: 'name' }], sep: ' · ' },
				sort: [{ field: 'name', dir: 'asc' }],
				graph: { role: 'board', parentField: 'room' },
				map: { enabled: false }
			},
			['name', 'room']
		);
		const slim = slimEntityFromV1(e, new Set());
		expect(slim).toEqual({
			name: 'boards',
			label: 'Boards',
			fields: e.fields,
			permissions: e.permissions,
			display: e.display,
			sort: e.sort,
			views: ['table', 'graph']
		});
		expect('graph' in slim).toBe(false);
		expect('map' in slim).toBe(false);
	});
});

describe('liftResolvedConfigV1', () => {
	it('produces version 2 with graph.nodes and derived views', () => {
		const v1 = config(
			[
				entity('electric_rooms', { graph: { role: 'room', labelField: 'name' } }, [
					'name',
					'level'
				]),
				entity(
					'boards',
					{ graph: { role: 'board', parentField: 'room', labelField: 'name' } },
					['name', 'room']
				),
				entity(
					'rents',
					{
						graph: { role: 'ignore' },
						map: { enabled: true, geometryField: 'geometry', levelField: 'level' }
					},
					['name', 'level', 'geometry']
				),
				entity('shops')
			],
			[
				{
					name: 'connects',
					role: 'feeds',
					in: ['breakers'],
					out: ['breakers'],
					fields: [],
					permissions: { create: false, update: false, delete: false, select: false }
				}
			]
		);

		const v2 = liftResolvedConfigV1(v1);

		expect(v2.version).toBe(2);
		expect(Object.keys(v2.graph.nodes).sort()).toEqual(['boards', 'electric_rooms']);
		expect(v2.graph.nodes.electric_rooms).toMatchObject({ role: 'room', labelField: 'name' });
		expect(v2.map.layers.map((l) => l.table)).toEqual(['rents']);
		expect(v2.tables.find((t) => t.name === 'boards')?.views).toEqual(['table', 'graph']);
		expect(v2.tables.find((t) => t.name === 'rents')?.views).toEqual(['table', 'map']);
		expect(v2.tables.find((t) => t.name === 'shops')?.views).toEqual(['table']);
		expect(v2.relations[0]?.name).toBe('connects');
		// slim: no nested graph/map on entities
		for (const t of v2.tables) {
			expect(t).not.toHaveProperty('graph');
			expect(t).not.toHaveProperty('map');
		}
	});

	it('does not mutate the source config', () => {
		const v1 = config([entity('boards', { graph: { role: 'board' } })]);
		const before = structuredClone(v1);
		liftResolvedConfigV1(v1);
		expect(v1).toEqual(before);
	});
});
