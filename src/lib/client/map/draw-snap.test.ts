import { describe, it, expect } from 'vitest';
import {
	applyDrawConstraints,
	collectVertices,
	constrainOrtho,
	snapAlignment
} from './draw-snap';

describe('constrainOrtho', () => {
	it('locks to horizontal when |dx| >= |dy|', () => {
		expect(constrainOrtho([10, 20], [40, 25])).toEqual([40, 20]);
	});

	it('locks to vertical when |dy| > |dx|', () => {
		expect(constrainOrtho([10, 20], [12, 50])).toEqual([10, 50]);
	});

	it('keeps coincident points', () => {
		expect(constrainOrtho([1, 2], [1, 2])).toEqual([1, 2]);
	});
});

describe('snapAlignment', () => {
	const verts: Array<[number, number]> = [
		[0, 0],
		[10, 0],
		[10, 8],
		[0, 8]
	];

	it('snaps X to a nearby vertical guide', () => {
		const r = snapAlignment([10.2, 3], verts, 0.5);
		expect(r).not.toBeNull();
		expect(r!.coordinate).toEqual([10, 3]);
		expect(r!.guides).toHaveLength(1);
		expect(r!.guides[0]?.axis).toBe('x');
	});

	it('snaps Y to a nearby horizontal guide', () => {
		const r = snapAlignment([4, 8.3], verts, 0.5);
		expect(r).not.toBeNull();
		expect(r!.coordinate).toEqual([4, 8]);
		expect(r!.guides[0]?.axis).toBe('y');
	});

	it('snaps to the intersection of two guides (concave corner case)', () => {
		// Cursor near the missing corner of a C-shape opening at x=10 and y=8
		const r = snapAlignment([10.2, 8.2], verts, 0.5);
		expect(r).not.toBeNull();
		expect(r!.coordinate).toEqual([10, 8]);
		expect(r!.guides).toHaveLength(2);
	});

	it('returns null when nothing is in tolerance', () => {
		expect(snapAlignment([50, 50], verts, 0.5)).toBeNull();
	});

	it('picks the closer of two X candidates', () => {
		const r = snapAlignment([0.1, 4], verts, 1);
		expect(r!.coordinate[0]).toBe(0);
	});
});

describe('applyDrawConstraints', () => {
	const verts: Array<[number, number]> = [
		[0, 0],
		[20, 0],
		[20, 10]
	];

	it('applies ortho then alignment along the locked axis', () => {
		// Shift from [0,0] toward [15, 2] → ortho to [15, 0]; then Y already on guide
		const r = applyDrawConstraints([15, 2], {
			vertices: verts,
			toleranceMap: 0.5,
			anchor: [0, 0],
			ortho: true
		});
		expect(r.coordinate).toEqual([15, 0]);
		expect(r.guides.some((g) => g.axis === 'y')).toBe(true);
	});

	it('aligns without ortho when shift is off', () => {
		const r = applyDrawConstraints([20.2, 5], {
			vertices: verts,
			toleranceMap: 0.5,
			ortho: false
		});
		expect(r.coordinate).toEqual([20, 5]);
	});
});

describe('collectVertices', () => {
	it('flattens polygon rings and dedupes the closer', () => {
		const ring = [
			[0, 0],
			[4, 0],
			[4, 3],
			[0, 3],
			[0, 0]
		];
		const out = collectVertices([ring]);
		expect(out).toHaveLength(4);
	});

	it('handles plain points and nested multiparts', () => {
		expect(collectVertices([1, 2])).toEqual([[1, 2]]);
		expect(collectVertices([[[0, 0], [1, 1]], [[2, 2]]])).toEqual([
			[0, 0],
			[1, 1],
			[2, 2]
		]);
	});
});
