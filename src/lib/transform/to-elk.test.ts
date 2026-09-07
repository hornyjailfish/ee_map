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
		expect(board.children?.map((c) => c.id)).toEqual(['breakers:q1', 'breakers:q2']);

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

	it('sorts breakers naturally (Q0…Q2…Q10) and orders fan-out edges by target', () => {
		const model: GraphViewModel = {
			nodes: [
				{
					id: 'boards:b1',
					type: 'board',
					position: { x: 0, y: 0 },
					data: { label: 'Board 1', table: 'boards', role: 'board' }
				},
				// Intentionally out of order in the model input
				mkBreaker('q10', 'Q10'),
				mkBreaker('q2', 'Q2'),
				mkBreaker('q0', 'Q0'),
				mkBreaker('q1', 'Q1'),
				mkBreaker('q11', 'Q11')
			],
			edges: [
				{
					id: 'connects:c10',
					source: 'breakers:q0',
					target: 'breakers:q10',
					type: 'power',
					data: { table: 'connects', role: 'feeds' }
				},
				{
					id: 'connects:c2',
					source: 'breakers:q0',
					target: 'breakers:q2',
					type: 'power',
					data: { table: 'connects', role: 'feeds' }
				},
				{
					id: 'connects:c1',
					source: 'breakers:q0',
					target: 'breakers:q1',
					type: 'power',
					data: { table: 'connects', role: 'feeds' }
				},
				{
					id: 'connects:c11',
					source: 'breakers:q0',
					target: 'breakers:q11',
					type: 'power',
					data: { table: 'connects', role: 'feeds' }
				}
			],
			layout: defaultLayout
		};

		const elk = toElkGraph(model, {
			sizes: {
				'breakers:q0': { width: 40, height: 20 },
				'breakers:q1': { width: 40, height: 20 },
				'breakers:q2': { width: 40, height: 20 },
				'breakers:q10': { width: 40, height: 20 },
				'breakers:q11': { width: 40, height: 20 }
			}
		});

		const board = elk.children![0]!;
		expect(board.children?.map((c) => c.id)).toEqual([
			'breakers:q0',
			'breakers:q1',
			'breakers:q2',
			'breakers:q10',
			'breakers:q11'
		]);
		expect(elk.edges?.map((e) => e.id)).toEqual([
			'connects:c1',
			'connects:c2',
			'connects:c10',
			'connects:c11'
		]);
	});
});

function mkBreaker(key: string, label: string) {
	return {
		id: `breakers:${key}`,
		type: 'breaker' as const,
		position: { x: 0, y: 0 },
		parentId: 'boards:b1',
		extent: 'parent' as const,
		data: { label, table: 'breakers', role: 'breaker' }
	};
}

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

	it('reorders same-layer breakers by natural label (Q0…Q10)', () => {
		const model: GraphViewModel = {
			nodes: [
				{
					id: 'boards:b1',
					type: 'board',
					position: { x: 0, y: 0 },
					data: { label: 'Board 1', table: 'boards', role: 'board' }
				},
				mkBreaker('q0', 'Q0'),
				mkBreaker('q1', 'Q1'),
				mkBreaker('q2', 'Q2'),
				mkBreaker('q10', 'Q10'),
				mkBreaker('q11', 'Q11')
			],
			edges: [],
			layout: defaultLayout
		};

		const w = 40;
		// ELK placed fan-out in wrong label order on the same y layer (slots 0,60,120,180)
		const laid: ElkNodeLike = {
			id: 'root',
			children: [
				{
					id: 'boards:b1',
					x: 0,
					y: 0,
					children: [
						{ id: 'breakers:q0', x: 100, y: 0, width: w, height: 20 },
						{ id: 'breakers:q10', x: 0, y: 50, width: w, height: 20 },
						{ id: 'breakers:q2', x: 60, y: 50, width: w, height: 20 },
						{ id: 'breakers:q1', x: 120, y: 50, width: w, height: 20 },
						{ id: 'breakers:q11', x: 180, y: 50, width: w, height: 20 }
					]
				}
			]
		};

		const result = applyElkLayout(model, laid);
		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n.position] as const));

		expect(byId['breakers:q0']).toEqual({ x: 100, y: 0 });
		// Same layer span packed left→right as Q1,Q2,Q10,Q11 (equal widths → original slots)
		expect(byId['breakers:q1']).toEqual({ x: 0, y: 50 });
		expect(byId['breakers:q2']).toEqual({ x: 60, y: 50 });
		expect(byId['breakers:q10']).toEqual({ x: 120, y: 50 });
		expect(byId['breakers:q11']).toEqual({ x: 180, y: 50 });
	});

	it('does not reorder differently sized rooms/boards (avoids overlaps)', () => {
		const model: GraphViewModel = {
			nodes: [
				{
					id: 'electric_rooms:r2',
					type: 'room',
					position: { x: 0, y: 0 },
					data: { label: '1.2', table: 'electric_rooms', role: 'room' }
				},
				{
					id: 'electric_rooms:r1',
					type: 'room',
					position: { x: 0, y: 0 },
					data: { label: '1.1', table: 'electric_rooms', role: 'room' }
				},
				{
					id: 'boards:wide',
					type: 'board',
					position: { x: 0, y: 0 },
					parentId: 'electric_rooms:r1',
					extent: 'parent',
					data: { label: 'ЩО-1', table: 'boards', role: 'board' }
				},
				{
					id: 'boards:narrow',
					type: 'board',
					position: { x: 0, y: 0 },
					parentId: 'electric_rooms:r1',
					extent: 'parent',
					data: { label: 'ЩО-2', table: 'boards', role: 'board' }
				},
				mkBreaker('q0', 'Q0')
			],
			edges: [],
			layout: defaultLayout
		};
		// force breaker under wide board for compound detection
		model.nodes[4] = { ...mkBreaker('q0', 'Q0'), parentId: 'boards:wide' };

		const laid: ElkNodeLike = {
			id: 'root',
			children: [
				// ELK left-to-right: large room first, small room second (not label order)
				{
					id: 'electric_rooms:r2',
					x: 0,
					y: 0,
					width: 80,
					height: 60,
					children: []
				},
				{
					id: 'electric_rooms:r1',
					x: 100,
					y: 0,
					width: 500,
					height: 200,
					children: [
						// wide board sits left; narrow sits right — label order would swap and overlap
						{
							id: 'boards:wide',
							x: 10,
							y: 20,
							width: 300,
							height: 150,
							children: [{ id: 'breakers:q0', x: 20, y: 30, width: 40, height: 20 }]
						},
						{
							id: 'boards:narrow',
							x: 330,
							y: 20,
							width: 120,
							height: 80
						}
					]
				}
			]
		};

		const result = applyElkLayout(model, laid);
		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n.position] as const));

		// Rooms/boards keep ELK coordinates (no label shuffle)
		expect(byId['electric_rooms:r2']).toEqual({ x: 0, y: 0 });
		expect(byId['electric_rooms:r1']).toEqual({ x: 100, y: 0 });
		expect(byId['boards:wide']).toEqual({ x: 10, y: 20 });
		expect(byId['boards:narrow']).toEqual({ x: 330, y: 20 });
		expect(byId['breakers:q0']).toEqual({ x: 20, y: 30 });
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
