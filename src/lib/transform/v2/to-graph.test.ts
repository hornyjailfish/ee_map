import { describe, it, expect } from 'vitest';
import { RecordId } from 'surrealdb';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedConfig, ResolvedEntity, ResolvedEdge } from '$lib/config/types';
import { toGraph } from '../to-graph';
import { liftResolvedConfigV1 } from './from-v1';
import { toGraphV2 } from './to-graph';
import type { ResolvedConfigV2 } from './shapes';

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
		graph,
		permissions: { create: false, update: false, delete: false, select: false }
	};
}

function edge(
	name: string,
	partial: Partial<ResolvedEdge> & Pick<ResolvedEdge, 'role' | 'in' | 'out'>
): ResolvedEdge {
	return {
		name,
		fields: [],
		permissions: { create: false, update: false, delete: false, select: false },
		...partial
	};
}

function configV1(tables: ResolvedEntity[], relations: ResolvedEdge[] = []): ResolvedConfig {
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

const eeV1 = configV1(
	[
		entity('electric_rooms', { role: 'room', labelField: 'name' }, ['name', 'level']),
		entity('boards', { role: 'board', parentField: 'room', labelField: 'name' }, [
			'name',
			'room'
		]),
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

const eeV2: ResolvedConfigV2 = liftResolvedConfigV1(eeV1);

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
		{ id: 'breakers:q2', name: 'Q2', board: 'boards:b1' }
	],
	rents: [{ id: 'rents:t1', name: 'Tenant' }],
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
			id: 'connects:orphan',
			in: 'breakers:q1',
			out: 'rents:t1',
			cable: 'gone'
		}
	]
};

function fingerprint(model: ReturnType<typeof toGraph>) {
	return {
		nodeIds: model.nodes.map((n) => n.id),
		parentOf: Object.fromEntries(
			model.nodes.filter((n) => n.parentId).map((n) => [n.id, n.parentId])
		),
		types: Object.fromEntries(model.nodes.map((n) => [n.id, n.type])),
		roles: Object.fromEntries(model.nodes.map((n) => [n.id, n.data.role])),
		labels: Object.fromEntries(model.nodes.map((n) => [n.id, n.data.label])),
		subtitles: Object.fromEntries(
			model.nodes.filter((n) => n.data.subtitle).map((n) => [n.id, n.data.subtitle])
		),
		edgeIds: model.edges.map((e) => e.id),
		edgePairs: model.edges.map((e) => `${e.source}->${e.target}`),
		layoutDirection: model.layout.direction
	};
}

describe('toGraphV2', () => {
	it('matches v1 toGraph on lifted EE fixture', () => {
		const v1 = toGraph({ config: eeV1, entities, relations });
		const v2 = toGraphV2({ config: eeV2, entities, relations });
		expect(fingerprint(v2)).toEqual(fingerprint(v1));
	});

	it('builds room → board → breaker parentId chain', () => {
		const model = toGraphV2({ config: eeV2, entities, relations });
		const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));

		expect(byId['electric_rooms:r1']?.data.role).toBe('room');
		expect(byId['boards:b1']?.parentId).toBe('electric_rooms:r1');
		expect(byId['breakers:q1']?.parentId).toBe('boards:b1');
		expect(byId['breakers:q1']?.data.subtitle).toBe('Main feed');
	});

	it('excludes tables not in graph.nodes (ignore / missing)', () => {
		const model = toGraphV2({ config: eeV2, entities, relations });
		const tables = new Set(model.nodes.map((n) => n.data.table));
		expect(tables.has('rents')).toBe(false);
		expect(tables.has('levels')).toBe(false);
		expect(eeV2.graph.nodes.rents).toBeUndefined();
	});

	it('builds connects edges; drops edges to missing target nodes', () => {
		const model = toGraphV2({ config: eeV2, entities, relations });
		expect(model.edges).toHaveLength(1);
		expect(model.edges[0]).toMatchObject({
			id: 'connects:c1',
			source: 'breakers:q1',
			target: 'breakers:q2',
			type: 'power',
			label: 'C-12'
		});
	});

	it('normalizes RecordId objects', () => {
		const model = toGraphV2({
			config: eeV2,
			entities: {
				electric_rooms: [{ id: new RecordId('electric_rooms', 'r1'), name: 'ER-A' }],
				boards: [
					{
						id: new RecordId('boards', 'b1'),
						name: 'Board 1',
						room: new RecordId('electric_rooms', 'r1')
					}
				],
				breakers: []
			},
			relations: {}
		});
		expect(model.nodes.map((n) => n.id).sort()).toEqual(['boards:b1', 'electric_rooms:r1']);
		expect(model.nodes.find((n) => n.id === 'boards:b1')?.parentId).toBe('electric_rooms:r1');
	});

	it('uses nodeType from graph.nodes when set', () => {
		const v1 = configV1([
			entity('breakers', {
				role: 'breaker',
				nodeType: 'customBreaker',
				labelField: 'name'
			})
		]);
		const model = toGraphV2({
			config: liftResolvedConfigV1(v1),
			entities: { breakers: [{ id: 'breakers:x', name: 'X' }] },
			relations: {}
		});
		expect(model.nodes[0]?.type).toBe('customBreaker');
	});

	it('reads membership only from graph.nodes even if tables list is incomplete', () => {
		// tables missing board entity still builds nodes from graph.nodes + rows
		const slim: ResolvedConfigV2 = {
			...eeV2,
			tables: eeV2.tables.filter((t) => t.name !== 'boards')
		};
		const model = toGraphV2({
			config: slim,
			entities: {
				boards: [{ id: 'boards:b1', name: 'Board 1', room: 'electric_rooms:r1' }]
			},
			relations: {}
		});
		expect(model.nodes.some((n) => n.id === 'boards:b1')).toBe(true);
		expect(model.nodes.find((n) => n.id === 'boards:b1')?.data.role).toBe('board');
	});
});
