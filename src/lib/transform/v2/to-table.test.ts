import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedConfig, ResolvedEntity } from '$lib/config/types';
import { liftResolvedConfigV1 } from './from-v1';
import { entitiesForView, entityByNameV2, tableEntities, toTableV2 } from './to-table';

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

function entity(name: string, extra: Partial<ResolvedEntity> = {}): ResolvedEntity {
	return {
		name,
		label: name,
		fields: [field('id'), field('name'), field('secret', 'string', { hidden: true })],
		permissions: { create: false, update: false, delete: false, select: true },
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
			layers: tables
				.filter((t) => t.map?.enabled)
				.map((t, i) => ({
					table: t.name,
					geometryField: 'geometry',
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

describe('entitiesForView / tableEntities', () => {
	it('filters by derived views', () => {
		const v2 = liftResolvedConfigV1(
			configV1([
				entity('shops'),
				entity('boards', { graph: { role: 'board' } }),
				entity('rents', {
					map: { enabled: true, geometryField: 'geometry' },
					fields: [
						field('id'),
						field('name'),
						field('geometry', 'geometry', { geometryKinds: ['polygon'] })
					]
				})
			])
		);

		expect(tableEntities(v2).map((t) => t.name).sort()).toEqual([
			'boards',
			'rents',
			'shops'
		]);
		expect(entitiesForView(v2, 'graph').map((t) => t.name)).toEqual(['boards']);
		expect(entitiesForView(v2, 'map').map((t) => t.name)).toEqual(['rents']);
	});
});

describe('toTableV2', () => {
	it('builds grid model from slim entity', () => {
		const v2 = liftResolvedConfigV1(configV1([entity('shops', { label: 'Shops' })]));
		const shops = entityByNameV2(v2, 'shops')!;
		const view = toTableV2(shops, [
			{ id: 'shops:1', name: 'A', secret: 'nope' },
			{ id: 'shops:2', name: 'B', secret: 'x' }
		]);

		expect(view.table).toBe('shops');
		expect(view.label).toBe('Shops');
		expect(view.columns.map((c) => c.id)).toEqual(['id', 'name']);
		expect(view.data).toHaveLength(2);
		expect(view.data[0]).not.toHaveProperty('secret');
	});
});
