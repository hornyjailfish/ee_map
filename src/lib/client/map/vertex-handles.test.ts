import { describe, it, expect } from 'vitest';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import Style from 'ol/style/Style';
import { withVertexHandles } from './vertex-handles';

describe('withVertexHandles', () => {
	const base = new Style();

	it('returns only base for empty geometry', () => {
		const f = new Feature();
		expect(withVertexHandles(base, f)).toEqual([base]);
	});

	it('adds one handle for a point', () => {
		const f = new Feature({ geometry: new Point([1, 2]) });
		expect(withVertexHandles(base, f)).toHaveLength(2);
	});

	it('adds a corner + midpoint handle per polygon edge', () => {
		const ring = [
			[0, 0],
			[10, 0],
			[10, 8],
			[0, 8],
			[0, 0]
		];
		const f = new Feature({ geometry: new Polygon([ring]) });
		// base + 4 corners + 4 midpoints
		expect(withVertexHandles(base, f)).toHaveLength(1 + 4 + 4);
	});
});
