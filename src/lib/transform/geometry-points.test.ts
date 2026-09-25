import { describe, it, expect } from 'vitest';
import { pointInPolygon, pointInRing } from './geometry-points';

// Axis-aligned 10×10 square [(0,0),(10,0),(10,10),(0,10)].
const square = [
	[0, 0],
	[10, 0],
	[10, 10],
	[0, 10]
] as const;

describe('pointInRing', () => {
	it('detects interior points', () => {
		expect(pointInRing(5, 5, square)).toBe(true);
		expect(pointInRing(0.1, 9.9, square)).toBe(true);
	});

	it('detects exterior points', () => {
		expect(pointInRing(-1, 5, square)).toBe(false);
		expect(pointInRing(5, 11, square)).toBe(false);
		expect(pointInRing(20, 20, square)).toBe(false);
	});

	it('handles concave-ish winding-independent cases (even-odd)', () => {
		const U = [
			[0, 0],
			[0, 10],
			[10, 10],
			[10, 0],
			[5, 0],
			[5, 5],
			[6, 5],
			[6, 0]
		] as const;
		// In the notch but outside the polygon body → outside (even-odd crossing).
		expect(pointInRing(5.5, 1, U)).toBe(false);
		// Left body → inside.
		expect(pointInRing(2, 5, U)).toBe(true);
	});

	it('rejects degenerate rings', () => {
		expect(pointInRing(0, 0, [])).toBe(false);
		expect(pointInRing(0, 0, [[0, 0]])).toBe(false);
	});
});

describe('pointInPolygon', () => {
	it('is inside the exterior only', () => {
		expect(pointInPolygon(5, 5, [square])).toBe(true);
	});

	it('excludes points inside a hole', () => {
		const hole = [
			[4, 4],
			[6, 4],
			[6, 6],
			[4, 6]
		] as const;
		// Center is inside the hole ring → not in polygon.
		expect(pointInPolygon(5, 5, [square, hole])).toBe(false);
		// Just outside the hole, still inside exterior → in polygon.
		expect(pointInPolygon(2, 2, [square, hole])).toBe(true);
	});

	it('is outside when no rings', () => {
		expect(pointInPolygon(0, 0, [])).toBe(false);
	});
});
