import { describe, it, expect } from 'vitest';
import {
	DEFAULT_GRAPH_LAYOUT,
	type ResolvedConfig,
	type ResolvedEntity,
	type ResolvedField
} from '$lib/config';
import { buildColumns, displayValue, entityByName, normalizeRecordId, toTable } from './to-table';

function field(partial: Partial<ResolvedField> & Pick<ResolvedField, 'name'>): ResolvedField {
	return {
		label: partial.label ?? partial.name,
		type: partial.type ?? 'string',
		optional: partial.optional ?? false,
		hidden: partial.hidden ?? false,
		readOnly: partial.readOnly ?? false,
		...partial
	};
}

function entity(
	overrides: Partial<ResolvedEntity> & Pick<ResolvedEntity, 'fields'>
): ResolvedEntity {
	return {
		name: overrides.name ?? 'people',
		label: overrides.label ?? overrides.name ?? 'People',
		permissions: { create: false, update: false, delete: false, select: false },
		...overrides
	};
}

/** Minimal mock resembling surrealdb RecordId (custom toString + tb/id). */
function mockRecordId(tb: string, id: string) {
	return {
		tb,
		id,
		toString() {
			return `${tb}:${id}`;
		}
	};
}

describe('buildColumns', () => {
	it('hides hidden fields', () => {
		const cols = buildColumns(
			entity({
				fields: [
					field({ name: 'name' }),
					field({ name: 'secret', hidden: true }),
					field({ name: 'notes' })
				]
			})
		);

		expect(cols.map((c) => c.id)).toEqual(['name', 'notes']);
	});

	it('follows entity.fields order', () => {
		const cols = buildColumns(
			entity({
				fields: [
					field({ name: 'amps', type: 'number' }),
					field({ name: 'name' }),
					field({ name: 'notes' })
				]
			})
		);

		expect(cols.map((c) => c.id)).toEqual(['amps', 'name', 'notes']);
	});

	it('puts identity field first when named id', () => {
		const cols = buildColumns(
			entity({
				fields: [field({ name: 'name' }), field({ name: 'id' }), field({ name: 'notes' })]
			})
		);

		expect(cols.map((c) => c.id)).toEqual(['id', 'name', 'notes']);
	});

	it('passes width, label, readOnly, and editor through', () => {
		const cols = buildColumns(
			entity({
				fields: [
					field({
						name: 'name',
						label: 'Name',
						width: 160,
						readOnly: true,
						editor: false
					})
				]
			})
		);

		expect(cols).toEqual([
			{
				id: 'name',
				header: 'Name',
				sort: true,
				width: 160,
				readOnly: true,
				editor: false,
				valueType: 'string',
				optional: false
			}
		]);
	});

	it('marks record columns with valueType and recordTargets', () => {
		const cols = buildColumns(
			entity({
				fields: [
					field({
						name: 'room',
						type: 'record',
						recordTargets: ['electric_rooms']
					})
				]
			})
		);
		expect(cols[0]).toMatchObject({
			id: 'room',
			valueType: 'record',
			recordTargets: ['electric_rooms']
		});
	});
});

describe('normalizeRecordId', () => {
	it('keeps string ids', () => {
		expect(normalizeRecordId('person:alice')).toBe('person:alice');
	});

	it('stringifies mock RecordId via toString', () => {
		expect(normalizeRecordId(mockRecordId('person', 'alice'))).toBe('person:alice');
	});

	it('builds table:id from { tb, id } plain objects', () => {
		expect(normalizeRecordId({ tb: 'boards', id: 'main' })).toBe('boards:main');
	});

	it('returns empty string for nullish', () => {
		expect(normalizeRecordId(null)).toBe('');
		expect(normalizeRecordId(undefined)).toBe('');
	});
});

describe('displayValue', () => {
	it('maps null and undefined to null', () => {
		expect(displayValue(null)).toBeNull();
		expect(displayValue(undefined)).toBeNull();
	});

	it('passes through booleans, numbers, and strings', () => {
		expect(displayValue(true)).toBe(true);
		expect(displayValue(42)).toBe(42);
		expect(displayValue('hi')).toBe('hi');
	});

	it('stringifies record refs', () => {
		expect(displayValue(mockRecordId('levels', 'l1'))).toBe('levels:l1');
		expect(displayValue({ tb: 'levels', id: 'l2' })).toBe('levels:l2');
	});

	it('joins arrays of record refs', () => {
		expect(displayValue([mockRecordId('person', 'a'), { tb: 'person', id: 'b' }, 'person:c'])).toBe(
			'person:a, person:b, person:c'
		);
	});

	it('compacts geometry objects without throwing', () => {
		expect(
			displayValue({
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 0]
					]
				]
			})
		).toBe('polygon');

		expect(displayValue({ type: 'Point', coordinates: [1, 2] })).toBe('point');
		expect(
			displayValue({
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 1]
				]
			})
		).toBe('line');
	});

	it('shortens nested plain objects', () => {
		const value = displayValue({ a: 1, b: 'two' });
		expect(value).toBe('{"a":1,"b":"two"}');
	});
});

describe('toTable', () => {
	const boards = entity({
		name: 'boards',
		label: 'Boards',
		fields: [
			field({ name: 'name', label: 'Name', width: 120 }),
			field({ name: 'secret', hidden: true }),
			field({ name: 'room', type: 'record', recordTargets: ['electric_rooms'] }),
			field({ name: 'geom', type: 'geometry', geometryKinds: ['polygon'] }),
			field({ name: 'amps', type: 'number' }),
			field({ name: 'active', type: 'bool' })
		]
	});

	it('returns empty data for empty rows', () => {
		const view = toTable(boards, []);
		expect(view.table).toBe('boards');
		expect(view.label).toBe('Boards');
		expect(view.data).toEqual([]);
		expect(view.columns.map((c) => c.id)).toEqual(['name', 'room', 'geom', 'amps', 'active']);
	});

	it('normalizes row id and visible field values without mutating input', () => {
		const raw = {
			id: mockRecordId('boards', 'b1'),
			name: 'Main',
			secret: 'nope',
			room: { tb: 'electric_rooms', id: 'r1' },
			geom: {
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[0, 0]
					]
				]
			},
			amps: 100,
			active: true,
			extra: 'ignored'
		};
		const rows = [raw];

		const view = toTable(boards, rows);

		expect(view.data).toEqual([
			{
				id: 'boards:b1',
				name: 'Main',
				room: 'electric_rooms:r1',
				geom: 'polygon',
				amps: 100,
				active: true
			}
		]);
		// Input not mutated
		expect(raw.secret).toBe('nope');
		expect(raw.room).toEqual({ tb: 'electric_rooms', id: 'r1' });
		expect(typeof raw.id).toBe('object');
	});

	it('keeps record ids as cell values (labels come from column options client-side)', () => {
		const labels = new Map([['electric_rooms:r1', 'ER-A']]);
		const view = toTable(
			boards,
			[
				{
					id: 'boards:b1',
					name: 'Main',
					room: 'electric_rooms:r1',
					amps: 100,
					active: true
				}
			],
			{ labels }
		);
		// Ids stay writeable; display is via SVAR options / combobox labels.
		expect(view.data[0]!.room).toBe('electric_rooms:r1');
	});

	it('applies entity.sort with natural string order to view data', () => {
		const breakers = entity({
			name: 'breakers',
			label: 'Breakers',
			sort: [{ field: 'name', dir: 'asc' }],
			fields: [
				field({ name: 'name' }),
				field({ name: 'board', type: 'record', recordTargets: ['boards'] })
			]
		});
		const view = toTable(breakers, [
			{ id: 'breakers:a', name: 'Q10' },
			{ id: 'breakers:b', name: 'Q2' },
			{ id: 'breakers:c', name: 'Q1' }
		]);
		expect(view.data.map((r) => r.name)).toEqual(['Q1', 'Q2', 'Q10']);
		expect(view.sort).toEqual([{ field: 'name', dir: 'asc' }]);
	});

	it('normalizes string ids and handles missing optional values', () => {
		const view = toTable(boards, [
			{
				id: 'boards:b2',
				name: 'Spare',
				amps: null,
				active: false
			}
		]);

		expect(view.data[0]).toEqual({
			id: 'boards:b2',
			name: 'Spare',
			room: null,
			geom: null,
			amps: null,
			active: false
		});
	});

	it('always includes string id even when id field is not a visible column', () => {
		const view = toTable(boards, [{ id: 'boards:x', name: 'X' }]);
		expect(view.columns.some((c) => c.id === 'id')).toBe(false);
		expect(view.data[0]!.id).toBe('boards:x');
	});

	it('does not throw on nested records and geometry mix', () => {
		expect(() =>
			toTable(boards, [
				{
					id: { tb: 'boards', id: 'nested' },
					name: 'N',
					room: [mockRecordId('electric_rooms', 'a'), mockRecordId('electric_rooms', 'b')],
					geom: { type: 'MultiPolygon', coordinates: [] },
					amps: 0,
					active: true
				}
			])
		).not.toThrow();

		const view = toTable(boards, [
			{
				id: { tb: 'boards', id: 'nested' },
				name: 'N',
				room: [mockRecordId('electric_rooms', 'a'), mockRecordId('electric_rooms', 'b')],
				geom: { type: 'MultiPolygon', coordinates: [] },
				amps: 0,
				active: true
			}
		]);

		expect(view.data[0]!.id).toBe('boards:nested');
		expect(view.data[0]!.room).toBe('electric_rooms:a, electric_rooms:b');
		expect(view.data[0]!.geom).toBe('multipolygon');
	});
});

describe('entityByName', () => {
	it('finds a table entity by name', () => {
		const config = {
			version: 1,
			tables: [
				entity({ name: 'boards', label: 'Boards', fields: [] }),
				entity({ name: 'rooms', label: 'Rooms', fields: [] })
			],
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
		} satisfies ResolvedConfig;

		expect(entityByName(config, 'rooms')?.label).toBe('Rooms');
		expect(entityByName(config, 'missing')).toBeUndefined();
	});
});
