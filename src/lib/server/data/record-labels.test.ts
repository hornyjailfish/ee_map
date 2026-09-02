import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT, type ResolvedConfig, type ResolvedEntity } from '$lib/config';
import { buildLabelIndex, formatRecordLabel, type RecordStore } from '$lib/transform/record-label';

/**
 * Planning / formatting coverage for the record-label load path.
 * Live Surreal select is integration-only; here we pin the pure closure behaviour
 * the loader relies on (store → labels for composite board refs).
 */

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

describe('record label load outcome (pure)', () => {
	it('produces composite board labels once room rows are in the store', () => {
		const cfg = config([
			{
				name: 'boards',
				label: 'Boards',
				fields: [],
				display: {
					parts: [{ path: 'room.name' }, { path: 'name' }],
					sep: ' · '
				}
			},
			{
				name: 'electric_rooms',
				label: 'Rooms',
				fields: [],
				display: { parts: [{ path: 'name' }], sep: ' · ' }
			}
		]);

		const store: RecordStore = new Map([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:r1' }],
			['boards:b2', { id: 'boards:b2', name: 'Main', room: 'electric_rooms:r2' }],
			['electric_rooms:r1', { id: 'electric_rooms:r1', name: 'ER-A' }],
			['electric_rooms:r2', { id: 'electric_rooms:r2', name: 'ER-B' }]
		]);

		const labels = buildLabelIndex(store, cfg);
		expect(labels.get('boards:b1')).toBe('ER-A · Main');
		expect(labels.get('boards:b2')).toBe('ER-B · Main');
		expect(
			formatRecordLabel('boards:b1', cfg.tables.find((t) => t.name === 'boards')!.display, store)
		).toBe('ER-A · Main');
	});

	it('toTable breakers.board uses boards composite display from labels', async () => {
		const { toTable } = await import('$lib/transform/to-table');
		const cfg = config([
			{
				name: 'boards',
				label: 'Boards',
				fields: [],
				display: {
					parts: [{ path: 'room.name' }, { path: 'name' }],
					sep: ' · '
				}
			},
			{
				name: 'breakers',
				label: 'Breakers',
				fields: [
					{
						name: 'name',
						label: 'name',
						type: 'string',
						optional: false,
						hidden: false,
						readOnly: false
					},
					{
						name: 'board',
						label: 'board',
						type: 'record',
						optional: false,
						hidden: false,
						readOnly: false,
						recordTargets: ['boards']
					}
				],
				display: { parts: [{ path: 'name' }], sep: ' · ' }
			},
			{
				name: 'electric_rooms',
				label: 'Rooms',
				fields: [],
				display: { parts: [{ path: 'name' }], sep: ' · ' }
			}
		]);

		const store: RecordStore = new Map([
			['boards:b1', { id: 'boards:b1', name: 'Main', room: 'electric_rooms:r1' }],
			['boards:b2', { id: 'boards:b2', name: 'Main', room: 'electric_rooms:r2' }],
			['electric_rooms:r1', { id: 'electric_rooms:r1', name: 'ER-A' }],
			['electric_rooms:r2', { id: 'electric_rooms:r2', name: 'ER-B' }]
		]);
		const labels = buildLabelIndex(store, cfg);
		const breakers = cfg.tables.find((t) => t.name === 'breakers')!;
		const view = toTable(
			breakers,
			[
				{ id: 'breakers:q1', name: 'Q1', board: 'boards:b1' },
				{ id: 'breakers:q2', name: 'Q2', board: 'boards:b2' }
			],
			{ labels, store, config: cfg }
		);

		expect(view.data.map((r) => r.board)).toEqual(['ER-A · Main', 'ER-B · Main']);
	});
});
