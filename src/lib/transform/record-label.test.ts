import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT, type ResolvedConfig, type ResolvedEntity } from '$lib/config';
import {
	buildLabelIndex,
	displayForRecordRef,
	formatRecordCellValue,
	formatRecordLabel,
	formatRecordOption,
	tableOfId
} from './record-label';

function config(tables: ResolvedEntity[]): ResolvedConfig {
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

function entity(
	name: string,
	display: ResolvedEntity['display'],
	fields: ResolvedEntity['fields'] = []
): ResolvedEntity {
	return {
		name,
		label: name,
		fields,
		permissions: { create: false, update: false, delete: false, select: false },
		...(display ? { display } : {})
	};
}

describe('formatRecordLabel', () => {
	it('returns id when display is missing', () => {
		const store = new Map([['boards:b1', { id: 'boards:b1', name: 'Main' }]]);
		expect(formatRecordLabel('boards:b1', undefined, store)).toBe('boards:b1');
	});

	it('formats a single field path', () => {
		const store = new Map([['levels:l1', { id: 'levels:l1', name: 'Ground', ord: 1 }]]);
		expect(
			formatRecordLabel('levels:l1', { parts: [{ path: 'name' }], sep: ' · ' }, store)
		).toBe('Ground');
	});

	it('joins multi-field parts on the same row', () => {
		const store = new Map([['levels:l1', { id: 'levels:l1', name: 'Ground', ord: 1 }]]);
		expect(
			formatRecordLabel(
				'levels:l1',
				{ parts: [{ path: 'ord' }, { path: 'name' }], sep: ' · ' },
				store
			)
		).toBe('1 · Ground');
	});

	it('walks record hops for composite board labels', () => {
		const store = new Map<string, Record<string, unknown>>([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:r1' }],
			['electric_rooms:r1', { id: 'electric_rooms:r1', name: 'ER-A' }]
		]);
		expect(
			formatRecordLabel(
				'boards:b1',
				{ parts: [{ path: 'room.name' }, { path: 'name' }], sep: ' · ' },
				store
			)
		).toBe('ER-A · Main');
	});

	it('disambiguates same board name in different rooms', () => {
		const store = new Map<string, Record<string, unknown>>([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:r1' }],
			['boards:b2', { id: 'boards:b2', name: 'Main', room: 'electric_rooms:r2' }],
			['electric_rooms:r1', { id: 'electric_rooms:r1', name: 'ER-A' }],
			['electric_rooms:r2', { id: 'electric_rooms:r2', name: 'ER-B' }]
		]);
		const display = { parts: [{ path: 'room.name' }, { path: 'name' }], sep: ' · ' };
		expect(formatRecordLabel('boards:b1', display, store)).toBe('ER-A · Main');
		expect(formatRecordLabel('boards:b2', display, store)).toBe('ER-B · Main');
	});

	it('falls back to id when hop target is missing from store', () => {
		const store = new Map<string, Record<string, unknown>>([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:missing' }]
		]);
		expect(
			formatRecordLabel(
				'boards:b1',
				{ parts: [{ path: 'room.name' }, { path: 'name' }], sep: ' · ' },
				store
			)
		).toBe('Main'); // room hop failed; still shows remaining part
	});

	it('falls back to id when no parts resolve', () => {
		const store = new Map([['boards:b1', { id: 'boards:b1' }]]);
		expect(
			formatRecordLabel('boards:b1', { parts: [{ path: 'name' }], sep: ' · ' }, store)
		).toBe('boards:b1');
	});
});

describe('formatRecordOption', () => {
	const boardDisplay = { parts: [{ path: 'room.name' }, { path: 'name' }], sep: ' · ' };

	it('keeps single-path options flat', () => {
		const store = new Map([['rooms:r1', { id: 'rooms:r1', name: 'ER-A' }]]);
		expect(
			formatRecordOption('rooms:r1', { parts: [{ path: 'name' }], sep: ' · ' }, store)
		).toEqual({ id: 'rooms:r1', label: 'ER-A' });
	});

	it('splits multi-part recipes into group + itemLabel without duplicating', () => {
		const store = new Map<string, Record<string, unknown>>([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:r1' }],
			['electric_rooms:r1', { id: 'electric_rooms:r1', name: 'ER-A' }]
		]);
		expect(formatRecordOption('boards:b1', boardDisplay, store)).toEqual({
			id: 'boards:b1',
			label: 'ER-A · Main',
			group: 'ER-A',
			itemLabel: 'Main'
		});
	});

	it('falls back to flat label when the group hop is missing', () => {
		const store = new Map<string, Record<string, unknown>>([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:missing' }]
		]);
		expect(formatRecordOption('boards:b1', boardDisplay, store)).toEqual({
			id: 'boards:b1',
			label: 'Main'
		});
	});
});

describe('displayForRecordRef + formatRecordCellValue', () => {
	const cfg = config([
		entity('electric_rooms', { parts: [{ path: 'name' }], sep: ' · ' }, [
			{
				name: 'name',
				label: 'name',
				type: 'string',
				optional: false,
				hidden: false,
				readOnly: false
			}
		]),
		entity(
			'boards',
			{ parts: [{ path: 'room.name' }, { path: 'name' }], sep: ' · ' },
			[
				{
					name: 'name',
					label: 'name',
					type: 'string',
					optional: false,
					hidden: false,
					readOnly: false
				},
				{
					name: 'room',
					label: 'room',
					type: 'record',
					optional: false,
					hidden: false,
					readOnly: false,
					recordTargets: ['electric_rooms']
				}
			]
		),
		entity('breakers', { parts: [{ path: 'name' }], sep: ' · ' }, [
			{
				name: 'board',
				label: 'board',
				type: 'record',
				optional: false,
				hidden: false,
				readOnly: false,
				recordTargets: ['boards']
			}
		])
	]);

	const boardField = cfg.tables.find((t) => t.name === 'breakers')!.fields[0]!;

	it('uses target entity display from id table', () => {
		const d = displayForRecordRef(boardField, 'boards:b1', cfg);
		expect(d?.parts).toEqual([{ path: 'room.name' }, { path: 'name' }]);
	});

	it('formats cell via label index', () => {
		const labels = new Map([['boards:b1', 'ER-A · Main']]);
		expect(
			formatRecordCellValue('boards:b1', boardField, { labels, config: cfg })
		).toBe('ER-A · Main');
	});

	it('formats cell via store when labels missing', () => {
		const store = new Map<string, Record<string, unknown>>([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:r1' }],
			['electric_rooms:r1', { id: 'electric_rooms:r1', name: 'ER-A' }]
		]);
		expect(
			formatRecordCellValue('boards:b1', boardField, { store, config: cfg })
		).toBe('ER-A · Main');
	});

	it('joins array of record refs', () => {
		const labels = new Map([
			['boards:b1', 'ER-A · Main'],
			['boards:b2', 'ER-B · Main']
		]);
		expect(
			formatRecordCellValue(['boards:b1', 'boards:b2'], boardField, { labels, config: cfg })
		).toBe('ER-A · Main, ER-B · Main');
	});

	it('returns undefined for non-record values so caller can use displayValue', () => {
		expect(formatRecordCellValue(42, boardField, { config: cfg })).toBeUndefined();
		expect(formatRecordCellValue('plain', boardField, { config: cfg })).toBeUndefined();
	});
});

describe('buildLabelIndex', () => {
	it('indexes every store row with entity display', () => {
		const cfg = config([
			entity('boards', { parts: [{ path: 'room.name' }, { path: 'name' }], sep: ' · ' }),
			entity('electric_rooms', { parts: [{ path: 'name' }], sep: ' · ' })
		]);
		const store = new Map<string, Record<string, unknown>>([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:r1' }],
			['electric_rooms:r1', { id: 'electric_rooms:r1', name: 'ER-A' }]
		]);
		const labels = buildLabelIndex(store, cfg);
		expect(labels.get('boards:b1')).toBe('ER-A · Main');
		expect(labels.get('electric_rooms:r1')).toBe('ER-A');
	});
});

describe('tableOfId', () => {
	it('extracts table prefix', () => {
		expect(tableOfId('boards:b1')).toBe('boards');
		expect(tableOfId('bad')).toBeNull();
	});
});
