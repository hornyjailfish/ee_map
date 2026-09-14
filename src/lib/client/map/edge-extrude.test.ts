import { describe, it, expect } from 'vitest';
import {
	collectExtrudeSnapCandidates,
	edgeUnitNormal,
	extrudePolygonEdge,
	findClosestEdge,
	listPolygonEdges,
	openRingLength,
	pointToSegment,
	projectAlongNormal,
	snapExtrudeDistance
} from './edge-extrude';

const square: Array<Array<[number, number]>> = [
	[
		[0, 0],
		[10, 0],
		[10, 8],
		[0, 8],
		[0, 0]
	]
];

describe('openRingLength', () => {
	it('drops the closing duplicate', () => {
		expect(openRingLength(square[0]!)).toBe(4);
	});
});

describe('edgeUnitNormal', () => {
	it('gives left normal for a rightward edge (outward for CCW bottom)', () => {
		const n = edgeUnitNormal([0, 0], [10, 0]);
		expect(n).not.toBeNull();
		expect(n![0]).toBeCloseTo(0);
		expect(n![1]).toBeCloseTo(1);
	});
});

describe('listPolygonEdges / findClosestEdge', () => {
	it('lists four edges on a closed square', () => {
		expect(listPolygonEdges(square)).toHaveLength(4);
	});

	it('picks the nearest edge within tolerance', () => {
		const hit = findClosestEdge(square, [5, -0.2], 1);
		expect(hit).not.toBeNull();
		expect(hit!.edgeIndex).toBe(0);
		expect(hit!.ringIndex).toBe(0);
		expect(hit!.distance).toBeCloseTo(0.2);
	});

	it('returns null when nothing is near', () => {
		expect(findClosestEdge(square, [50, 50], 1)).toBeNull();
	});
});

describe('pointToSegment', () => {
	it('clamps to endpoints', () => {
		const r = pointToSegment([-2, 1], [0, 0], [10, 0]);
		expect(r.closest).toEqual([0, 0]);
		expect(r.t).toBe(0);
	});
});

describe('extrudePolygonEdge', () => {
	it('pushes the bottom edge outward (positive left-normal)', () => {
		const next = extrudePolygonEdge(square, 0, 0, 2);
		// Bottom A(0,0) B(10,0) normal (0,1) → y += 2
		expect(next[0]![0]).toEqual([0, 2]);
		expect(next[0]![1]).toEqual([10, 2]);
		// Top corners unchanged
		expect(next[0]![2]).toEqual([10, 8]);
		expect(next[0]![3]).toEqual([0, 8]);
		// Still closed
		expect(next[0]![4]).toEqual([0, 2]);
	});

	it('pulls inward with negative distance', () => {
		const next = extrudePolygonEdge(square, 0, 0, -1);
		expect(next[0]![0]).toEqual([0, -1]);
		expect(next[0]![1]).toEqual([10, -1]);
	});

	it('does not mutate the source rings', () => {
		const before = structuredClone(square);
		extrudePolygonEdge(square, 0, 0, 3);
		expect(square).toEqual(before);
	});
});

describe('projectAlongNormal', () => {
	it('projects displacement onto the normal', () => {
		expect(projectAlongNormal([0, 0], [3, 4], [0, 1])).toBe(4);
		expect(projectAlongNormal([0, 0], [3, 4], [1, 0])).toBe(3);
	});
});

describe('extrude 1D snap', () => {
	const a: [number, number] = [0, 0];
	const b: [number, number] = [10, 0];
	const n: [number, number] = [0, 1];

	it('snaps depth to a vertex over the edge span', () => {
		const cands = collectExtrudeSnapCandidates(a, b, n, [[5, 4]], [], { lateralPad: 1 });
		const hit = snapExtrudeDistance(3.8, cands, 0.5);
		expect(hit?.distance).toBe(4);
		expect(hit?.kind).toBe('vertex');
	});

	it('ignores vertices far along the edge (distant room)', () => {
		const cands = collectExtrudeSnapCandidates(a, b, n, [[100, 4]], [], { lateralPad: 1 });
		// only origin candidate
		expect(cands.filter((c) => c.kind === 'vertex')).toHaveLength(0);
		expect(snapExtrudeDistance(3.8, cands, 0.5)).toBeNull();
	});

	it('snaps to a parallel edge depth', () => {
		const cands = collectExtrudeSnapCandidates(
			a,
			b,
			n,
			[],
			[{ a: [1, 6], b: [9, 6] }],
			{ lateralPad: 1 }
		);
		const hit = snapExtrudeDistance(5.7, cands, 0.5);
		expect(hit?.distance).toBe(6);
		expect(hit?.kind).toBe('edge');
	});

	it('skips non-parallel edges', () => {
		const cands = collectExtrudeSnapCandidates(
			a,
			b,
			n,
			[],
			[{ a: [0, 0], b: [0, 8] }],
			{ lateralPad: 1 }
		);
		expect(cands.filter((c) => c.kind === 'edge')).toHaveLength(0);
	});

	it('snaps back to origin within tolerance', () => {
		const cands = collectExtrudeSnapCandidates(a, b, n, [], []);
		const hit = snapExtrudeDistance(0.2, cands, 0.5);
		expect(hit?.distance).toBe(0);
		expect(hit?.kind).toBe('origin');
	});
});
