/**
 * Static corner + edge-midpoint markers for the feature under Edit
 * (always visible, not only on hover).
 * Display-only — drag / insert / delete stays on OL Modify.
 */

import type { FeatureLike } from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';

/** Existing corner handle. */
const HANDLE_IMAGE = new CircleStyle({
	radius: 5,
	fill: new Fill({ color: 'rgba(255, 255, 255, 0.95)' }),
	stroke: new Stroke({ color: '#7c3aed', width: 1.75 })
});

/** Mid-edge insert affordance (click edge / midpoint → add vertex). */
const MIDPOINT_IMAGE = new CircleStyle({
	radius: 3.5,
	fill: new Fill({ color: 'rgba(255, 255, 255, 0.7)' }),
	stroke: new Stroke({ color: 'rgba(124, 58, 237, 0.75)', width: 1.25 })
});

/**
 * Append a Style per existing vertex and polygon edge midpoint.
 * Polygon rings skip the closing duplicate corner.
 * Returns `[base]` unchanged for empty / unsupported geometries.
 */
export function withVertexHandles(base: Style, feature: FeatureLike): Style[] {
	const geom = feature.getGeometry?.() as Geometry | undefined;
	if (!geom) return [base];

	const type = geom.getType();
	const styles: Style[] = [base];

	if (type === 'Point') {
		styles.push(
			new Style({
				geometry: geom.clone(),
				image: HANDLE_IMAGE
			})
		);
		return styles;
	}

	if (type === 'Polygon') {
		const rings = (geom as Polygon).getCoordinates();
		for (const ring of rings) {
			// Closed ring: last === first — only draw unique corners
			const n = ring.length > 1 ? ring.length - 1 : ring.length;
			for (let i = 0; i < n; i++) {
				const c = ring[i];
				if (!c || c.length < 2) continue;
				styles.push(
					new Style({
						geometry: new Point([c[0]!, c[1]!]),
						image: HANDLE_IMAGE
					})
				);

				// Midpoint on edge i → i+1 (wraps to first corner on last segment)
				const next = ring[(i + 1) % n];
				if (!next || next.length < 2) continue;
				const mx = (c[0]! + next[0]!) / 2;
				const my = (c[1]! + next[1]!) / 2;
				styles.push(
					new Style({
						geometry: new Point([mx, my]),
						image: MIDPOINT_IMAGE
					})
				);
			}
		}
	}

	return styles;
}
