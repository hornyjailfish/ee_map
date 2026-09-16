import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { GraphViewModel } from '../to-graph';
import { toElkGraph } from '../to-elk';
import {
	layoutOptionsByTableFromNodes,
	toElkGraphFromConfigV2,
	toElkGraphV2
} from './to-elk';
import type { ResolvedConfigV2 } from './shapes';

const defaultLayout = {
	...DEFAULT_GRAPH_LAYOUT,
	spacing: { ...DEFAULT_GRAPH_LAYOUT.spacing },
	compoundPadding: { ...DEFAULT_GRAPH_LAYOUT.compoundPadding }
};

const fixtureModel: GraphViewModel = {
	nodes: [
		{
			id: 'electric_rooms:r1',
			type: 'room',
			position: { x: 0, y: 0 },
			data: { label: 'ER-A', table: 'electric_rooms', role: 'room' }
		},
		{
			id: 'boards:b1',
			type: 'board',
			position: { x: 0, y: 0 },
			parentId: 'electric_rooms:r1',
			extent: 'parent',
			data: { label: 'Board 1', table: 'boards', role: 'board' }
		},
		{
			id: 'breakers:q1',
			type: 'breaker',
			position: { x: 0, y: 0 },
			parentId: 'boards:b1',
			extent: 'parent',
			data: { label: 'Q1', table: 'breakers', role: 'breaker' }
		},
		{
			id: 'breakers:q2',
			type: 'breaker',
			position: { x: 0, y: 0 },
			parentId: 'boards:b1',
			extent: 'parent',
			data: { label: 'Q2', table: 'breakers', role: 'breaker' }
		}
	],
	edges: [
		{
			id: 'connects:c1',
			source: 'breakers:q1',
			target: 'breakers:q2',
			type: 'power',
			label: 'C-12',
			data: { table: 'connects', role: 'feeds' }
		}
	],
	layout: defaultLayout
};

const fixtureSizes = {
	'breakers:q1': { width: 72, height: 36 },
	'breakers:q2': { width: 80, height: 36 }
};

describe('toElkGraphV2', () => {
	it('matches v1 when no per-table options', () => {
		const a = toElkGraph(fixtureModel, { sizes: fixtureSizes });
		const b = toElkGraphV2(fixtureModel, { sizes: fixtureSizes });
		expect(b).toEqual(a);
	});

	it('merges table layoutOptions onto compounds (table wins on clash)', () => {
		const elk = toElkGraphV2(fixtureModel, {
			sizes: fixtureSizes,
			layoutOptionsByTable: {
				boards: {
					'elk.padding': '[top=40,left=8,bottom=8,right=8]',
					'elk.spacing.nodeNode': '22'
				}
			}
		});

		const room = elk.children![0]!;
		const board = room.children![0]!;
		expect(board.layoutOptions?.['elk.padding']).toBe('[top=40,left=8,bottom=8,right=8]');
		expect(board.layoutOptions?.['elk.spacing.nodeNode']).toBe('22');
		// still has baseline keys from compoundLayoutOptions
		expect(board.layoutOptions?.['elk.direction']).toBe(defaultLayout.direction);
	});

	it('applies layoutOptions to leaves when present', () => {
		const elk = toElkGraphV2(fixtureModel, {
			sizes: fixtureSizes,
			layoutOptionsByTable: {
				breakers: { 'elk.priority': '10' }
			}
		});
		const board = elk.children![0]!.children![0]!;
		const q1 = board.children!.find((c) => c.id === 'breakers:q1')!;
		expect(q1.layoutOptions).toEqual({ 'elk.priority': '10' });
		expect(q1.width).toBe(72);
	});
});

describe('layoutOptionsByTableFromNodes', () => {
	it('skips empty maps', () => {
		expect(
			layoutOptionsByTableFromNodes({
				boards: { role: 'board', layoutOptions: { a: '1' } },
				rooms: { role: 'room', layoutOptions: {} },
				breakers: { role: 'breaker' }
			})
		).toEqual({ boards: { a: '1' } });
	});
});

describe('toElkGraphFromConfigV2', () => {
	it('reads layoutOptions from graph.nodes', () => {
		const config = {
			graph: {
				hierarchy: ['room', 'board', 'breaker', 'output', 'group'] as const,
				layout: defaultLayout,
				nodes: {
					boards: {
						role: 'board' as const,
						layoutOptions: { 'elk.spacing.nodeNode': '30' }
					}
				}
			}
		} satisfies Pick<ResolvedConfigV2, 'graph'>;

		const elk = toElkGraphFromConfigV2(fixtureModel, config, { sizes: fixtureSizes });
		const board = elk.children![0]!.children![0]!;
		expect(board.layoutOptions?.['elk.spacing.nodeNode']).toBe('30');
	});
});
