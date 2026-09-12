import { describe, it, expect } from 'vitest';
import type { ResolvedConfig, ResolvedEntity, ResolvedField, ResolvedMapLayer } from '$lib/config/types';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import { buildMapCrudMeta, drawKindsForField } from './map-crud';

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

function config(overrides: {
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

describe('drawKindsForField', () => {
	it('defaults to polygon when kinds omitted', () => {
		expect(drawKindsForField(field('geometry', 'geometry'))).toEqual(['polygon']);
	});

	it('maps polygon and point kinds', () => {
		expect(
			drawKindsForField(field('geometry', 'geometry', { geometryKinds: ['polygon'] }))
		).toEqual(['polygon']);
		expect(drawKindsForField(field('geometry', 'geometry', { geometryKinds: ['point'] }))).toEqual(
			['point']
		);
		expect(
			drawKindsForField(field('geometry', 'geometry', { geometryKinds: ['polygon', 'point'] }))
		).toEqual(['polygon', 'point']);
	});

	it('excludes multiline-only fields', () => {
		expect(
			drawKindsForField(field('geometry', 'geometry', { geometryKinds: ['multiline'] }))
		).toEqual([]);
	});
});

describe('buildMapCrudMeta', () => {
	it('lists creatable polygon layers and form fields without geometry', () => {
		const meta = buildMapCrudMeta(config());
		expect(meta.createTargets.map((t) => t.table)).toEqual(['rents', 'zones']);
		expect(meta.drawTargets.map((t) => t.table)).toEqual(['rents', 'zones']);
		const rents = meta.byTable.rents!;
		expect(rents.canCreate).toBe(true);
		expect(rents.canUpdate).toBe(true);
		expect(rents.drawKinds).toEqual(['polygon']);
		expect(rents.geometryField).toBe('geometry');
		expect(rents.levelField).toBe('level');
		expect(rents.fields.map((f) => f.id)).toEqual(['name', 'level']);
		expect(rents.fields.some((f) => f.id === 'geometry')).toBe(false);
	});

	it('skips multiline floor-plan layers', () => {
		const levels = entity('levels', {
			fields: [
				field('id'),
				field('name'),
				field('ord', 'number'),
				field('geometry', 'geometry', { geometryKinds: ['multiline'], optional: true })
			],
			map: { enabled: true, geometryField: 'geometry' },
			permissions: { create: true, update: true, delete: false, select: true }
		});
		const meta = buildMapCrudMeta(
			config({
				tables: [levels, entity('rents')],
				layers: [
					layer({ table: 'levels', zIndex: 0, styleKey: 'levels' }),
					layer({ table: 'rents', zIndex: 1 })
				]
			})
		);
		expect(meta.byTable.levels).toBeUndefined();
		expect(meta.createTargets.map((t) => t.table)).toEqual(['rents']);
	});

	it('omits createTargets when create is false but keeps drawTargets for assign', () => {
		const rooms = entity('electric_rooms', {
			permissions: { create: false, update: true, delete: false, select: true }
		});
		const meta = buildMapCrudMeta(config({ tables: [rooms] }));
		expect(meta.createTargets).toHaveLength(0);
		expect(meta.drawTargets.map((t) => t.table)).toEqual(['electric_rooms']);
		expect(meta.byTable.electric_rooms?.canUpdate).toBe(true);
		expect(meta.byTable.electric_rooms?.canCreate).toBe(false);
	});
});
