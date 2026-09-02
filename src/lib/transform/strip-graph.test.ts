import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_LAYOUT } from '$lib/config/merge';
import { stripGraphForClient } from './strip-graph';
import type { GraphViewModel } from './to-graph';

const defaultLayout = {
	...DEFAULT_GRAPH_LAYOUT,
	spacing: { ...DEFAULT_GRAPH_LAYOUT.spacing },
	compoundPadding: { ...DEFAULT_GRAPH_LAYOUT.compoundPadding }
};

describe('stripGraphForClient', () => {
	it('removes data.raw and keeps serializable node fields', () => {
		const model: GraphViewModel = {
			nodes: [
				{
					id: 'boards:b1',
					type: 'board',
					position: { x: 0, y: 0 },
					parentId: 'electric_rooms:r1',
					extent: 'parent',
					connectable: false,
					data: {
						label: 'MDB',
						subtitle: 'main',
						table: 'boards',
						role: 'board',
						raw: { id: { tb: 'boards', id: 'b1' }, name: 'MDB' }
					}
				},
				{
					id: 'breakers:q1',
					type: 'breaker',
					position: { x: 0, y: 0 },
					connectable: true,
					data: {
						label: 'Q1',
						table: 'breakers',
						role: 'breaker',
						canConnect: true,
						raw: { name: 'Q1' }
					}
				}
			],
			edges: [
				{
					id: 'connects:c1',
					source: 'breakers:a',
					target: 'breakers:b',
					label: 'feed',
					data: {
						table: 'connects',
						role: 'feeds',
						cable: { tb: 'cables', id: 'x' }
					}
				}
			],
			layout: defaultLayout
		};

		const stripped = stripGraphForClient(model);

		expect(stripped.nodes[0]?.data).toEqual({
			label: 'MDB',
			subtitle: 'main',
			table: 'boards',
			role: 'board'
		});
		expect(stripped.nodes[0]?.data).not.toHaveProperty('raw');
		expect(stripped.nodes[0]?.parentId).toBe('electric_rooms:r1');
		expect(stripped.nodes[0]?.connectable).toBe(false);
		expect(stripped.nodes[0]?.position).toEqual({ x: 0, y: 0 });
		expect(stripped.nodes[1]?.connectable).toBe(true);
		expect(stripped.nodes[1]?.data.canConnect).toBe(true);
		expect(stripped.edges[0]?.data).toEqual({ table: 'connects', role: 'feeds' });
		expect(stripped.edges[0]?.label).toBe('feed');
		expect(stripped.layout).toEqual(defaultLayout);
	});

	it('does not mutate the input model', () => {
		const model: GraphViewModel = {
			nodes: [
				{
					id: 'n1',
					position: { x: 0, y: 0 },
					data: { label: 'A', table: 't', role: 'room', raw: { x: 1 } }
				}
			],
			edges: [],
			layout: defaultLayout
		};
		const before = structuredClone(model);
		stripGraphForClient(model);
		expect(model).toEqual(before);
	});
});
