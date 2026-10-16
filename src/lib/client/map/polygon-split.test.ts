import { describe, it, expect } from 'vitest';
import {
	closeRing,
	openExteriorRing,
	pickBoundaryPoint,
	ringAbsArea,
	snapToOtherEdge,
	splitPolygonAtPoints,
	splitPolygonByEdgePoints,
	splitResultToPolygons,
	type XY
} from './polygon-split';

/** Unit square (0,0)-(10,0)-(10,10)-(0,10). */
const SQUARE: XY[][] = [
	[
		[0, 0],
		[10, 0],
		[10, 10],
		[0, 10],
		[0, 0]
	]
];

describe('polygon-split', () => {
	it('opens and closes exterior rings', () => {
		const open = openExteriorRing(SQUARE);
		expect(open).toEqual([
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		]);
		const closed = closeRing(open!);
		expect(closed[0]).toEqual(closed[closed.length - 1]);
	});

	it('picks a boundary point on the nearest edge', () => {
		const hit = pickBoundaryPoint(SQUARE, [5, -0.1], 1);
		expect(hit).not.toBeNull();
		expect(hit!.edgeIndex).toBe(0);
		expect(hit!.point[0]).toBeCloseTo(5, 3);
		expect(hit!.point[1]).toBeCloseTo(0, 3);
	});

	it('snaps the second point onto a different edge', () => {
		const a = pickBoundaryPoint(SQUARE, [5, 0], 1)!;
		const b = snapToOtherEdge(SQUARE, [5, 10.2], a, 2);
		expect(b).not.toBeNull();
		expect(b!.edgeIndex).not.toBe(a.edgeIndex);
		expect(b!.point[1]).toBeCloseTo(10, 3);
	});

	it('refuses a second point on the same edge', () => {
		const a = pickBoundaryPoint(SQUARE, [3, 0], 1)!;
		const b = snapToOtherEdge(SQUARE, [7, 0.05], a, 1);
		// Same bottom edge filtered out — may still hit left/right if close enough; with y≈0 stay on bottom so null
		expect(b === null || b.edgeIndex !== a.edgeIndex).toBe(true);
		if (b) expect(b.edgeIndex).not.toBe(a.edgeIndex);
	});

	it('splits a square top-bottom into two equal rectangles', () => {
		const a = pickBoundaryPoint(SQUARE, [5, 0], 1)!;
		const b = pickBoundaryPoint(SQUARE, [5, 10], 1)!;
		expect(a.edgeIndex).not.toBe(b.edgeIndex);

		const result = splitPolygonByEdgePoints(SQUARE, a, b);
		expect(result).not.toBeNull();
		const [r1, r2] = result!.parts;
		const area1 = ringAbsArea(r1);
		const area2 = ringAbsArea(r2);
		expect(area1 + area2).toBeCloseTo(100, 5);
		expect(Math.abs(area1 - 50)).toBeLessThan(1);
		expect(Math.abs(area2 - 50)).toBeLessThan(1);

		const geos = splitResultToPolygons(result!);
		expect(geos[0].type).toBe('Polygon');
		expect(geos[1].type).toBe('Polygon');
		expect(geos[0].coordinates[0]!.length).toBeGreaterThanOrEqual(4);
	});

	it('splits a square left-right midpoints', () => {
		const result = splitPolygonAtPoints(SQUARE, [0, 5], [10, 5], 1);
		expect(result).not.toBeNull();
		const sum = ringAbsArea(result!.parts[0]) + ringAbsArea(result!.parts[1]);
		expect(sum).toBeCloseTo(100, 5);
	});

	it('rejects degenerate same-edge cut', () => {
		const a = pickBoundaryPoint(SQUARE, [2, 0], 1)!;
		const b = { ...a, t: 0.8, point: [8, 0] as XY };
		expect(splitPolygonByEdgePoints(SQUARE, a, b)).toBeNull();
	});

	it('rejects cut that is not area-preserving (outside chord)', () => {
		// Two points on adjacent edges near a corner produce thin slices — still valid.
		// Far-from-boundary endpoints fail pick.
		expect(splitPolygonAtPoints(SQUARE, [5, 5], [6, 6], 0.1)).toBeNull();
	});

	it('split through vertices works', () => {
		const a = pickBoundaryPoint(SQUARE, [0, 0], 1)!;
		const b = pickBoundaryPoint(SQUARE, [10, 10], 1)!;
		const result = splitPolygonByEdgePoints(SQUARE, a, b);
		expect(result).not.toBeNull();
		const sum = ringAbsArea(result!.parts[0]) + ringAbsArea(result!.parts[1]);
		expect(sum).toBeCloseTo(100, 4);
	});
});
