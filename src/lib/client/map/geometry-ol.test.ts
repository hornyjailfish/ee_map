import { describe, it, expect } from 'vitest';
import Polygon from 'ol/geom/Polygon';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import MultiLineString from 'ol/geom/MultiLineString';
import {
	geoJsonToNormalized,
	normalizedToOl,
	olToNormalized,
	olToWritableGeoJSON
} from './geometry-ol';

describe('normalizedToOl / olToNormalized', () => {
	it('round-trips points', () => {
		const ol = normalizedToOl({ kind: 'point', x: 12.5, y: -3 });
		expect(ol).toBeInstanceOf(Point);
		expect(olToNormalized(ol)).toEqual({ kind: 'point', x: 12.5, y: -3 });
	});

	it('round-trips polygons and closes rings', () => {
		const rings: Array<Array<[number, number]>> = [
			[
				[0, 0],
				[4, 0],
				[4, 3],
				[0, 3],
				[0, 0]
			]
		];
		const ol = normalizedToOl({ kind: 'polygon', rings });
		expect(ol).toBeInstanceOf(Polygon);
		const back = olToNormalized(ol);
		expect(back.kind).toBe('polygon');
		if (back.kind === 'polygon') {
			expect(back.rings[0]?.[0]).toEqual([0, 0]);
			expect(back.rings[0]?.at(-1)).toEqual([0, 0]);
		}
	});

	it('round-trips single and multi lines', () => {
		const single = normalizedToOl({
			kind: 'line',
			paths: [
				[
					[0, 0],
					[1, 1]
				]
			]
		});
		expect(single).toBeInstanceOf(LineString);

		const multi = normalizedToOl({
			kind: 'line',
			paths: [
				[
					[0, 0],
					[1, 0]
				],
				[
					[2, 2],
					[3, 3]
				]
			]
		});
		expect(multi).toBeInstanceOf(MultiLineString);
		expect(olToNormalized(multi).kind).toBe('line');
	});

	it('returns empty for null / empty kind', () => {
		expect(normalizedToOl({ kind: 'empty' })).toBeNull();
		expect(olToNormalized(null)).toEqual({ kind: 'empty' });
	});
});

describe('olToWritableGeoJSON', () => {
	it('exports polygon GeoJSON for Surreal writes', () => {
		const poly = new Polygon([
			[
				[0, 0],
				[2, 0],
				[2, 2],
				[0, 2],
				[0, 0]
			]
		]);
		expect(olToWritableGeoJSON(poly)).toEqual({
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[2, 0],
					[2, 2],
					[0, 2],
					[0, 0]
				]
			]
		});
	});

	it('exports point GeoJSON', () => {
		expect(olToWritableGeoJSON(new Point([1, 2]))).toEqual({
			type: 'Point',
			coordinates: [1, 2]
		});
	});

	it('rejects line geometries (not writable via coerceGeometry)', () => {
		const line = new LineString([
			[0, 0],
			[1, 1]
		]);
		expect(olToWritableGeoJSON(line)).toBeNull();
	});
});

describe('geoJsonToNormalized', () => {
	it('delegates to shared normalizer', () => {
		expect(geoJsonToNormalized({ type: 'Point', coordinates: [1, 2] })).toEqual({
			kind: 'point',
			x: 1,
			y: 2
		});
	});
});
