/**
 * Draw-time snap helpers for the map editor (CAD-style).
 *
 * Pure geometry math lives here so it can be unit-tested without OpenLayers.
 * Interaction wiring (OL Snap, guides layer) stays in MapView / DrawSnapSession.
 *
 * Modes:
 * - **ortho** (Shift): lock the active segment to 0° / 90° from the last fixed vertex
 * - **alignment**: snap X and/or Y to existing vertices (axis + corner intersection)
 * - **feature**: delegated to OL `Snap` (vertex / edge / intersection)
 */

export type XY = [number, number];

/**
 * Coordinate precision for every position written through the shared CAD snap.
 * The map plane is metric YX in metres, so millimetres (0.001 m) are ~1 mm —
 * well below what mouse-derived floats need and consistent with the dedupe keys
 * used elsewhere in this module.
 */
export const SNAP_COORD_DECIMALS = 3;

/** Round a snap output to {@link SNAP_COORD_DECIMALS}. */
export function roundSnapCoord(n: number): number {
	const f = 10 ** SNAP_COORD_DECIMALS;
	return Math.round(n * f) / f;
}

export type AlignmentGuide = {
	/** Vertical guide at this map X, or horizontal at this map Y. */
	axis: 'x' | 'y';
	/** Fixed axis value in map units. */
	value: number;
	/** Source vertex that defines the guide. */
	origin: XY;
};

export type AlignmentSnapResult = {
	/** Snapped coordinate (map units). */
	coordinate: XY;
	/** Active H/V guides (0–2). */
	guides: AlignmentGuide[];
};

export type DrawSnapOptions = {
	/** Pixel tolerance converted to map units by caller (resolution * px). */
	toleranceMap: number;
};

/**
 * Project `point` onto the nearest axis-aligned ray from `anchor` (0° / 90°).
 * Map plane is metric XY — no projection distortion.
 */
export function constrainOrtho(anchor: XY, point: XY): XY {
	const dx = point[0] - anchor[0];
	const dy = point[1] - anchor[1];
	if (dx === 0 && dy === 0) return [point[0], point[1]];
	// Prefer the axis with larger absolute delta (closer to that direction).
	if (Math.abs(dx) >= Math.abs(dy)) {
		return [point[0], anchor[1]];
	}
	return [anchor[0], point[1]];
}

/**
 * Project `point` onto the nearest axis-aligned ray (0°/90°/180°/270°) through
 * any of the given anchors. A single anchor behaves like {@link constrainOrtho};
 * with several (e.g. a polygon vertex's two neighbours) the closest projection
 * wins.
 */
export function constrainOrthoToAnchors(anchors: readonly XY[], point: XY): XY {
	if (anchors.length === 0) return [point[0], point[1]];
	let best: XY = constrainOrtho(anchors[0]!, point);
	let bestDist = distSq(best, point);
	for (let i = 1; i < anchors.length; i++) {
		const candidate = constrainOrtho(anchors[i]!, point);
		const d = distSq(candidate, point);
		if (d < bestDist) {
			best = candidate;
			bestDist = d;
		}
	}
	return best;
}

function distSq(a: XY, b: XY): number {
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	return dx * dx + dy * dy;
}

/**
 * Snap cursor to horizontal and/or vertical alignment with nearby vertices.
 *
 * CAD “object snap tracking” lite:
 * - Within tolerance of a vertex’s X → lock X (vertical guide)
 * - Within tolerance of a vertex’s Y → lock Y (horizontal guide)
 * - Both at once → corner intersection of two guides (possibly from different vertices)
 *
 * Picks the closest candidate per axis (by perpendicular distance in map units).
 */
export function snapAlignment(
	cursor: XY,
	vertices: readonly XY[],
	toleranceMap: number
): AlignmentSnapResult | null {
	if (!(toleranceMap > 0) || vertices.length === 0) return null;

	let bestX: { dist: number; value: number; origin: XY } | null = null;
	let bestY: { dist: number; value: number; origin: XY } | null = null;

	for (const v of vertices) {
		const dx = Math.abs(cursor[0] - v[0]);
		if (dx <= toleranceMap && (bestX === null || dx < bestX.dist)) {
			bestX = { dist: dx, value: v[0], origin: [v[0], v[1]] };
		}
		const dy = Math.abs(cursor[1] - v[1]);
		if (dy <= toleranceMap && (bestY === null || dy < bestY.dist)) {
			bestY = { dist: dy, value: v[1], origin: [v[0], v[1]] };
		}
	}

	if (!bestX && !bestY) return null;

	const coordinate: XY = [
		bestX ? bestX.value : cursor[0],
		bestY ? bestY.value : cursor[1]
	];
	const guides: AlignmentGuide[] = [];
	if (bestX) guides.push({ axis: 'x', value: bestX.value, origin: bestX.origin });
	if (bestY) guides.push({ axis: 'y', value: bestY.value, origin: bestY.origin });

	return { coordinate, guides };
}

/**
 * Apply Shift-ortho first (when requested), then vertex alignment.
 * Feature snap (OL) should still run separately with higher priority when close.
 */
export function applyDrawConstraints(
	cursor: XY,
	opts: {
		vertices: readonly XY[];
		toleranceMap: number;
		/** Anchor vertices enabling Shift ortho (draw: last vertex, edit: neighbours). */
		anchors?: readonly XY[];
		ortho?: boolean;
	}
): AlignmentSnapResult {
	let coordinate: XY = [cursor[0], cursor[1]];
	if (opts.ortho && opts.anchors?.length) {
		coordinate = constrainOrthoToAnchors(opts.anchors, coordinate);
	}

	const aligned = snapAlignment(coordinate, opts.vertices, opts.toleranceMap);
	if (aligned) return aligned;

	return { coordinate, guides: [] };
}

/**
 * Collect unique XY vertices from nested coordinate arrays (Point / Line / Polygon rings).
 * Depth-first; skips non-finite values. Dedupes with a fixed precision key.
 */
export function collectVertices(
	coords: unknown,
	out: XY[] = [],
	seen: Set<string> = new Set()
): XY[] {
	if (!Array.isArray(coords) || coords.length === 0) return out;

	// Coordinate pair: [x, y, …]
	if (typeof coords[0] === 'number') {
		const x = Number(coords[0]);
		const y = Number(coords[1]);
		if (Number.isFinite(x) && Number.isFinite(y)) {
			// ~1 mm grid in metric plane — enough to de-dupe ring closers
			const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
			if (!seen.has(key)) {
				seen.add(key);
				out.push([x, y]);
			}
		}
		return out;
	}

	for (const child of coords) {
		collectVertices(child, out, seen);
	}
	return out;
}
