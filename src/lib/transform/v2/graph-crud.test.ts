import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedConfig, ResolvedEntity, ResolvedField } from '$lib/config/types';
import { buildGraphCrudMeta } from '../graph-crud';
import { liftResolvedConfigV1 } from './from-v1';
import { buildGraphCrudMetaV2, graphNodeOf } from './graph-crud';

function field(
	name: string,
	type = 'string',
	extra: Partial<ResolvedField> = {}
): ResolvedField {
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

function entity(name: string, extra: Partial<ResolvedEntity> = {}): ResolvedEntity {
	return {
		name,
		label: name,
		fields: [field('id'), field('name')],
		permissions: { create: true, update: true, delete: true, select: true },
		...extra
	};
}

function configV1(tables: ResolvedEntity[]): ResolvedConfig {
	return {
		version: 1,
		tables,
		relations: [],
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

const eeTables: ResolvedEntity[] = [
	entity('electric_rooms', {
		graph: { role: 'room', labelField: 'name' },
		fields: [field('id'), field('name'), field('level', 'record', { recordTargets: ['levels'] })]
	}),
	entity('boards', {
		graph: { role: 'board', parentField: 'room', labelField: 'name' },
		fields: [
			field('id'),
			field('name'),
			field('room', 'record', { recordTargets: ['electric_rooms'] })
		]
	}),
	entity('breakers', {
		graph: { role: 'breaker', parentField: 'board', labelField: 'name' },
		fields: [
			field('id'),
			field('name'),
			field('board', 'record', { recordTargets: ['boards'] }),
			field('value', 'number')
		]
	}),
	entity('rents', {
		graph: { role: 'ignore' },
		fields: [field('id'), field('name')]
	})
];

describe('buildGraphCrudMetaV2', () => {
	it('matches v1 meta on lifted config', () => {
		const v1 = configV1(eeTables);
		const v2 = liftResolvedConfigV1(v1);
		const a = buildGraphCrudMeta(v1);
		const b = buildGraphCrudMetaV2(v2);

		expect(Object.keys(b.createByParentTable).sort()).toEqual(
			Object.keys(a.createByParentTable).sort()
		);
		expect(b.createByParentTable.electric_rooms?.childTable).toBe('boards');
		expect(b.createByParentTable.boards?.childTable).toBe('breakers');
		expect(b.createByParentTable.electric_rooms?.parentField).toBe('room');
		expect(b.editByTable.breakers?.map((c) => c.id).sort()).toEqual(
			a.editByTable.breakers?.map((c) => c.id).sort()
		);
		expect(b.editByTable.rents).toBeUndefined();
		expect(b.deleteByTable.boards).toBe(true);
	});

	it('skips graph.nodes tables missing from tables[]', () => {
		const v2 = liftResolvedConfigV1(configV1(eeTables));
		// orphan node key with no entity → no edit/create entry
		v2.graph.nodes.ghost = { role: 'group' };
		const meta = buildGraphCrudMetaV2(v2);
		expect(meta.editByTable.ghost).toBeUndefined();
	});
});

describe('graphNodeOf', () => {
	it('returns node settings by table', () => {
		const v2 = liftResolvedConfigV1(configV1(eeTables));
		expect(graphNodeOf(v2, 'boards')).toMatchObject({
			role: 'board',
			parentField: 'room'
		});
		expect(graphNodeOf(v2, 'rents')).toBeUndefined();
	});
});
