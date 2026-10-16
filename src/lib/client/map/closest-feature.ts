/**
 * Browser-only nearest-feature lookup for the map editor.
 *
 * The view uses an identity metric XY plane (units: metres), so a straight
 * Euclidean distance from a coordinate to a feature's geometry is meaningful
 * space. `VectorSource.getClosestFeatureToCoordinate` does exactly that; we
 * wrap it with layer/level filtering so callers can request "the closest
 * feature on the `rents` layer for this level".
 */

import type Map from 'ol/Map';
import type { Coordinate } from 'ol/coordinate';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';

export type ClosestFeatureHit = {
	id: string;
	name: string | null;
	/** Straight-line distance from the coordinate to the feature geometry (metres). */
	distance: number;
};

/**
 * Find the feature on `table` (a MapView vector layer) closest to `coordinate`.
 * When `levelId` is provided, only features tagged with that level are considered.
 * Returns null when no matching layer / feature is loaded yet.
 */
export function findClosestFeatureByTable(
	map: Map,
	table: string,
	coordinate: Coordinate,
	levelId: string | null = null
): ClosestFeatureHit | null {
	let source: VectorSource | null = null;
	for (const layer of map.getLayers().getArray()) {
		if (!(layer instanceof VectorLayer)) continue;
		if (layer.get('table') !== table) continue;
		const candidate = layer.getSource();
		if (candidate instanceof VectorSource) {
			source = candidate;
			break;
		}
	}
	if (!source) return null;

	const feature = source.getClosestFeatureToCoordinate(coordinate, (f) => {
		if (f.get('table') !== table) return false;
		if (levelId != null) {
			const featureLevel = f.get('levelId');
			if (featureLevel != null && featureLevel !== levelId) return false;
		}
		return true;
	});
	if (!feature) return null;

	const id = feature.getId();
	if (id == null) return null;

	const geometry = feature.getGeometry();
	const closestPoint = geometry?.getClosestPoint(coordinate);
	const distance =
		closestPoint == null
			? 0
			: Math.hypot(closestPoint[0] - coordinate[0], closestPoint[1] - coordinate[1]);

	const label = feature.get('label');

	return {
		id: String(id),
		name: typeof label === 'string' && label.trim() !== '' ? label : null,
		distance
	};
}