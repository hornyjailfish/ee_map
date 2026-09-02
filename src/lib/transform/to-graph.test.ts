import { describe, it, expect } from 'vitest';
import { RecordId } from 'surrealdb';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedConfig, ResolvedEntity, ResolvedEdge } from '$lib/config/types';
import { recordIdToString, toGraph } from './to-graph';

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

function entity(
	name: string,
	graph: ResolvedEntity['graph'],
	fieldNames: string[] = ['name']
): ResolvedEntity {
	return {
		name,
		label: name,
		fields: fieldNames.map((n) => field(n)),
		graph
	};
}

function edge(
	name: string,
	partial: Partial<ResolvedEdge> & Pick<ResolvedEdge, 'role' | 'in' | 'out'>
): ResolvedEdge {
	return {
		name,
		fields: [],
		...partial
	};
}

/** Minimal ResolvedConfig for graph fixtures. */
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
			layers: []
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

const eeConfig = config(
	[
		entity('electric_rooms', { role: 'room', labelField: 'name' }, ['name', 'level']),
		entity('boards', { role: 'board', parentField: 'room', labelField: 'name' }, ['name', 'room']),
		entity(
			'breakers',
			{
				role: 'breaker',
				parentField: 'board',
				labelField: 'name',
				subtitleField: 'description'
			},
			['name', 'board', 'description', 'value']
		),
		entity('rents', { role: 'ignore', labelField: 'name' }, ['name', 'level']),
		entity('levels', undefined, ['name', 'ord'])
	],
	[
		edge('connects', {
			role: 'feeds',
			edgeType: 'power',
			labelField: 'cable',
			in: ['breakers'],
			out: ['breakers', 'rents']
		})
	]
);

describe('recordIdToString', () => {
	it('passes through table:key strings', () => {
		expect(recordIdToString('breakers:q1')).toBe('breakers:q1');
	});

	it('prefixes bare keys with fallback table', () => {
		expect(recordIdToString('q1', 'breakers')).toBe('breakers:q1');
	});

	it('stringifies surrealdb RecordId', () => {
		expect(recordIdToString(new RecordId('boards', 'b1'))).toBe('boards:b1');
	});

	it('accepts plain { table, id } objects', () => {
		expect(recordIdToString({ table: 'electric_rooms', id: 'r1' })).toBe('electric_rooms:r1');
		expect(recordIdToString({ tb: 'boards', id: 'b1' })).toBe('boards:b1');
	});

	it('returns null for empty / nullish', () => {
		expect(recordIdToString(null)).toBeNull();
		expect(recordIdToString(undefined)).toBeNull();
		expect(recordIdToString('')).toBeNull();
	});
});

describe('toGraph', () => {
	const entities = {
		electric_rooms: [{ id: 'electric_rooms:r1', name: 'ER-A' }],
		boards: [{ id: 'boards:b1', name: 'Board 1', room: 'electric_rooms:r1' }],
		breakers: [
			{
				id: 'breakers:q1',
				name: 'Q1',
				board: 'boards:b1',
				description: 'Main feed'
			},
			{
				id: 'breakers:q2',
				name: 'Q2',
				board: 'boards:b1',
				description: 'Downstream'
			}
		],
		rents: [{ id: 'rents:t1', name: 'Unit 101' }],
		levels: [{ id: 'levels:1', name: 'L1', ord: 1 }]
	};

	const relations = {
		connects: [
			{
				id: 'connects:c1',
				in: 'breakers:q1',
				out: 'breakers:q2',
				cable: 'C-12'
			},
			{
				id: 'connects:c2',
				in: 'breakers:q2',
				out: 'rents:t1',
				cable: 'C-out'
			}
		]
	};

	it('builds room → board → breaker parentId chain and orders parents first', () => {
		const model = toGraph({ config: eeConfig, entities, relations });

		const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));

		expect(byId['electric_rooms:r1']).toMatchObject({
			id: 'electric_rooms:r1',
			type: 'room',
			data: { label: 'ER-A', table: 'electric_rooms', role: 'room' }
		});
		expect(byId['electric_rooms:r1']?.parentId).toBeUndefined();

		expect(byId['boards:b1']).toMatchObject({
			parentId: 'electric_rooms:r1',
			extent: 'parent',
			type: 'board',
			data: { label: 'Board 1', role: 'board' }
		});

		expect(byId['breakers:q1']).toMatchObject({
			parentId: 'boards:b1',
			extent: 'parent',
			type: 'breaker',
			data: { label: 'Q1', subtitle: 'Main feed', role: 'breaker' }
		});
		expect(byId['breakers:q2']?.parentId).toBe('boards:b1');

		const ids = model.nodes.map((n) => n.id);
		expect(ids.indexOf('electric_rooms:r1')).toBeLessThan(ids.indexOf('boards:b1'));
		expect(ids.indexOf('boards:b1')).toBeLessThan(ids.indexOf('breakers:q1'));
		expect(ids.indexOf('boards:b1')).toBeLessThan(ids.indexOf('breakers:q2'));
	});

	it('excludes entities without graph and graph.role ignore', () => {
		const model = toGraph({ config: eeConfig, entities, relations });
		const tables = new Set(model.nodes.map((n) => n.data.table));
		expect(tables.has('rents')).toBe(false);
		expect(tables.has('levels')).toBe(false);
		expect(model.nodes.some((n) => n.id === 'rents:t1')).toBe(false);
	});

	it('builds connects edges with labels; drops edges to missing target nodes', () => {
		const model = toGraph({ config: eeConfig, entities, relations });

		expect(model.edges).toHaveLength(1);
		expect(model.edges[0]).toMatchObject({
			id: 'connects:c1',
			source: 'breakers:q1',
			target: 'breakers:q2',
			type: 'power',
			label: 'C-12',
			data: { table: 'connects', role: 'feeds', cable: 'C-12' }
		});
		// c2 targets rents:t1 which is not a graph node
		expect(model.edges.find((e) => e.id === 'connects:c2')).toBeUndefined();
	});

	it('normalizes RecordId objects on id/parent/in/out', () => {
		const model = toGraph({
			config: eeConfig,
			entities: {
				electric_rooms: [{ id: new RecordId('electric_rooms', 'r1'), name: 'ER-A' }],
				boards: [
					{
						id: new RecordId('boards', 'b1'),
						name: 'Board 1',
						room: new RecordId('electric_rooms', 'r1')
					}
				],
				breakers: [
					{
						id: new RecordId('breakers', 'q1'),
						name: 'Q1',
						board: new RecordId('boards', 'b1')
					},
					{
						id: new RecordId('breakers', 'q2'),
						name: 'Q2',
						board: new RecordId('boards', 'b1')
					}
				]
			},
			relations: {
				connects: [
					{
						id: new RecordId('connects', 'c1'),
						in: new RecordId('breakers', 'q1'),
						out: new RecordId('breakers', 'q2')
					}
				]
			}
		});

		expect(model.nodes.map((n) => n.id).sort()).toEqual([
			'boards:b1',
			'breakers:q1',
			'breakers:q2',
			'electric_rooms:r1'
		]);
		expect(model.nodes.find((n) => n.id === 'boards:b1')?.parentId).toBe('electric_rooms:r1');
		expect(model.edges).toEqual([
			expect.objectContaining({
				id: 'connects:c1',
				source: 'breakers:q1',
				target: 'breakers:q2'
			})
		]);
	});

	it('clears parentId when parent node is not in the graph', () => {
		const model = toGraph({
			config: eeConfig,
			entities: {
				// room missing
				boards: [{ id: 'boards:b1', name: 'Orphan board', room: 'electric_rooms:missing' }],
				breakers: [{ id: 'breakers:q1', name: 'Q1', board: 'boards:b1' }]
			},
			relations: {}
		});

		const board = model.nodes.find((n) => n.id === 'boards:b1')!;
		expect(board.parentId).toBeUndefined();
		expect(board.extent).toBeUndefined();
		expect(model.nodes.find((n) => n.id === 'breakers:q1')?.parentId).toBe('boards:b1');
	});

	it('skips ignore-role relations', () => {
		const cfg = config(
			[entity('breakers', { role: 'breaker', labelField: 'name' }, ['name'])],
			[
				edge('connects', {
					role: 'ignore',
					in: ['breakers'],
					out: ['breakers']
				})
			]
		);
		const model = toGraph({
			config: cfg,
			entities: {
				breakers: [
					{ id: 'breakers:a', name: 'A' },
					{ id: 'breakers:b', name: 'B' }
				]
			},
			relations: {
				connects: [{ id: 'connects:1', in: 'breakers:a', out: 'breakers:b' }]
			}
		});
		expect(model.nodes).toHaveLength(2);
		expect(model.edges).toHaveLength(0);
	});

	it('uses nodeType from config when set', () => {
		const cfg = config([
			entity('breakers', {
				role: 'breaker',
				nodeType: 'customBreaker',
				labelField: 'name'
			})
		]);
		const model = toGraph({
			config: cfg,
			entities: { breakers: [{ id: 'breakers:x', name: 'X' }] },
			relations: {}
		});
		expect(model.nodes[0]?.type).toBe('customBreaker');
	});

	it('falls back label to id when labelField missing or empty', () => {
		const cfg = config([entity('breakers', { role: 'breaker', labelField: 'name' })]);
		const model = toGraph({
			config: cfg,
			entities: { breakers: [{ id: 'breakers:x' }] },
			relations: {}
		});
		expect(model.nodes[0]?.data.label).toBe('breakers:x');
	});
});
