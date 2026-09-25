/**
 * Pure point-in-polygon helpers for indoor metric XY geometry.
 * Used server-side to resolve the zone / rented area that a marker point falls
 * into (auto-generated description context). No OpenLayers / DB imports.
 */

/**
 * Even-odd (ray casting) containment for a single ring.
 * Ring is an ordered list of `[x, y]` vertices; need not be explicitly closed.
 */
export function pointInRing(
	x: number,
	y: number,
	ring: ReadonlyArray<readonly [number, number]>
): boolean {
	if (ring.length < 3) return false;

	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i]![0];
		const yi = ring[i]![1];
		const xj = ring[j]![0];
		const yj = ring[j]![1];

		const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (intersects) inside = !inside;
	}
	return inside;
}

/**
 * Containment for a polygon with optional holes.
 * `rings[0]` is the exterior; remaining rings are holes (inside the exterior but
 * outside any hole). Indoor zones / rents are treated as simple exterior-only.
 */
export function pointInPolygon(
	x: number,
	y: number,
	rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
): boolean {
	if (rings.length === 0) return false;
	if (!pointInRing(x, y, rings[0]!)) return false;
	for (let i = 1; i < rings.length; i++) {
		if (pointInRing(x, y, rings[i]!)) return false;
	}
	return true;
}
