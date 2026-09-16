import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { ResolvedConfig, ResolvedEntity, ResolvedField, ResolvedMapLayer } from '$lib/config/types';
import { buildMapCrudMeta } from '../map-crud';
import { liftResolvedConfigV1 } from './from-v1';
import { buildMapCrudMetaV2 } from './map-crud';

function field(name: string, type = 'string', extra: Partial<ResolvedField> = {}): ResolvedField {
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
		fields: [
			field('id'),
			field('name'),
			field('level', 'record', { recordTargets: ['levels'], optional: true }),
			field('geometry', 'geometry', { geometryKinds: ['polygon'], optional: true })
		],
		permissions: { create: true, update: true, delete: false, select: true },
		map: { enabled: true, levelField: 'level', geometryField: 'geometry' },
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

function configV1(overrides: {
	tables?: ResolvedEntity[];
	layers?: ResolvedMapLayer[];
} = {}): ResolvedConfig {
	const tables = overrides.tables ?? [entity('rents'), entity('zones')];
	const layers =
		overrides.layers ??
		tables
			.filter((t) => t.map?.enabled)
			.map((t, i) => layer({ table: t.name, zIndex: i + 1, styleKey: t.name }));

	return {
		version: 1,
		tables,
		relations: [],
		map: {
			units: 'm',
			plane: 'xy-meters',
			levelsTable: 'levels',
			levelOrderField: 'ord',
			layers
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

describe('buildMapCrudMetaV2', () => {
	it('matches v1 meta on lifted config', () => {
		const v1 = configV1();
		const v2 = liftResolvedConfigV1(v1);
		const a = buildMapCrudMeta(v1);
		const b = buildMapCrudMetaV2(v2);

		expect(Object.keys(b.byTable).sort()).toEqual(Object.keys(a.byTable).sort());
		expect(b.createTargets.map((s) => s.table)).toEqual(a.createTargets.map((s) => s.table));
		expect(b.byTable.rents).toMatchObject({
			geometryField: 'geometry',
			levelField: 'level',
			canCreate: true,
			drawKinds: ['polygon']
		});
	});

	it('does not fall back to entity.map (slim entities have none)', () => {
		// layer without levelField → heuristic `level` record field still works
		const v1 = configV1({
			tables: [entity('rents')],
			layers: [layer({ table: 'rents', levelField: undefined, zIndex: 1 })]
		});
		const v2 = liftResolvedConfigV1(v1);
		const meta = buildMapCrudMetaV2(v2);
		expect(meta.byTable.rents?.levelField).toBe('level');
	});

	it('skips layers whose table is missing from tables[]', () => {
		const v2 = liftResolvedConfigV1(configV1({ tables: [entity('rents')] }));
		v2.map.layers.push(layer({ table: 'ghost', zIndex: 9 }));
		const meta = buildMapCrudMetaV2(v2);
		expect(meta.byTable.ghost).toBeUndefined();
		expect(meta.byTable.rents).toBeDefined();
	});
});
