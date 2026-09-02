import { describe, it, expect } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import type { GraphViewModel } from './to-graph';
import { applyElkLayout, collectElkSizes, toElkGraph, type ElkNodeLike } from './to-elk';

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

describe('toElkGraph', () => {
	it('nests by parentId, sizes leaves, puts BALANCED on compounds', () => {
		const elk = toElkGraph(fixtureModel, { sizes: fixtureSizes });
		const pad = defaultLayout.compoundPadding;

		expect(elk.children).toHaveLength(1);
		const room = elk.children![0]!;
		const board = room.children![0]!;
		expect(board.children?.map((c) => c.id).sort()).toEqual(['breakers:q1', 'breakers:q2']);

		const q1 = board.children!.find((c) => c.id === 'breakers:q1')!;
		expect(q1.width).toBe(72);
		expect(q1.height).toBe(36);
		expect(board.width).toBeUndefined();

		// Compounds must carry placement — root-only BALANCED left-packs children
		expect(board.layoutOptions?.['elk.layered.nodePlacement.bk.fixedAlignment']).toBe('BALANCED');
		expect(board.layoutOptions?.['elk.padding']).toBe(
			`[top=${pad.top},left=${pad.left},bottom=${pad.bottom},right=${pad.right}]`
		);
		expect(elk.edges).toEqual([
			{ id: 'connects:c1', sources: ['breakers:q1'], targets: ['breakers:q2'] }
		]);
	});

	it('falls back when a size is missing', () => {
		const elk = toElkGraph(fixtureModel, {
			sizes: { 'breakers:q1': { width: 50, height: 20 } },
			fallbackSize: { width: 11, height: 13 }
		});
		const q2 = elk.children![0]!.children![0]!.children!.find((c) => c.id === 'breakers:q2')!;
		expect(q2.width).toBe(11);
		expect(q2.height).toBe(13);
	});

	it('treats unknown parentId as root', () => {
		const model: GraphViewModel = {
			nodes: [
				{
					id: 'boards:orphan',
					type: 'board',
					position: { x: 0, y: 0 },
					parentId: 'missing:parent',
					data: { label: 'O', table: 'boards', role: 'board' }
				}
			],
			edges: [],
			layout: defaultLayout
		};
		const elk = toElkGraph(model, {
			sizes: { 'boards:orphan': { width: 100, height: 40 } }
		});
		expect(elk.children?.map((c) => c.id)).toEqual(['boards:orphan']);
	});

	it('applies model.layout and layoutOptions overrides', () => {
		const model: GraphViewModel = {
			...fixtureModel,
			layout: {
				direction: 'RIGHT',
				align: 'start',
				spacing: {
					node: 24,
					layer: 32,
					edgeLayer: 10,
					edgeEdge: 4,
					edgeNode: 8
				},
				compoundPadding: { top: 12, left: 10, bottom: 8, right: 10 }
			}
		};
		const elk = toElkGraph(model, {
			sizes: fixtureSizes,
			layoutOptions: { 'elk.spacing.nodeNode': '99' }
		});
		expect(elk.layoutOptions?.['elk.direction']).toBe('RIGHT');
		expect(elk.layoutOptions?.['elk.layered.nodePlacement.bk.fixedAlignment']).toBe('LEFTDOWN');
		// explicit override wins over layout-derived spacing
		expect(elk.layoutOptions?.['elk.spacing.nodeNode']).toBe('99');
		const board = elk.children![0]!.children![0]!;
		expect(board.layoutOptions?.['elk.padding']).toContain('top=12');
		expect(board.layoutOptions?.['elk.layered.nodePlacement.bk.fixedAlignment']).toBe('LEFTDOWN');
	});
});

describe('applyElkLayout', () => {
	const laidOut: ElkNodeLike = {
		id: 'root',
		children: [
			{
				id: 'electric_rooms:r1',
				x: 10,
				y: 20,
				width: 240,
				height: 160,
				children: [
					{
						id: 'boards:b1',
						x: 5,
						y: 15,
						width: 200,
						height: 120,
						children: [
							{ id: 'breakers:q1', x: 0, y: 0, width: 72, height: 36 },
							{ id: 'breakers:q2', x: 180, y: 0, width: 80, height: 36 }
						]
					}
				]
			}
		]
	};

	it('writes parent-relative positions immutably', () => {
		const result = applyElkLayout(fixtureModel, laidOut);
		const pos = Object.fromEntries(result.nodes.map((n) => [n.id, n.position] as const));

		expect(pos['electric_rooms:r1']).toEqual({ x: 10, y: 20 });
		expect(pos['boards:b1']).toEqual({ x: 5, y: 15 });
		expect(pos['breakers:q1']).toEqual({ x: 0, y: 0 });
		expect(fixtureModel.nodes.find((n) => n.id === 'breakers:q1')?.position).toEqual({
			x: 0,
			y: 0
		});
		expect(result.edges[0]).not.toBe(fixtureModel.edges[0]);
		expect(result.layout).toEqual(fixtureModel.layout);
	});
});

describe('collectElkSizes', () => {
	it('reads width/height from nested layout result', () => {
		const sizes = collectElkSizes({
			id: 'root',
			children: [
				{
					id: 'room',
					width: 300,
					height: 200,
					children: [{ id: 'leaf', width: 40, height: 20 }]
				}
			]
		});
		expect(sizes.get('room')).toEqual({ width: 300, height: 200 });
		expect(sizes.get('leaf')).toEqual({ width: 40, height: 20 });
		expect(sizes.has('root')).toBe(false);
	});
});
