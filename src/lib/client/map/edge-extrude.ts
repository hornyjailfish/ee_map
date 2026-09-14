/**
 * Pure 2D polygon edge-extrude helpers (CAD push/pull on a single edge).
 * Moves both endpoints of an edge along the edge’s left unit normal.
 */

export type XY = [number, number];

export type PolygonEdge = {
	/** Ring index in the polygon coordinates array. */
	ringIndex: number;
	/** Start vertex index in the open ring (0 … n-1). */
	edgeIndex: number;
	a: XY;
	b: XY;
	/** Left unit normal of directed edge A→B. */
	normal: XY;
	midpoint: XY;
};

export type ClosestEdgeHit = PolygonEdge & {
	/** Perpendicular distance from point to the segment (map units). */
	distance: number;
};

/** Open unique-vertex count for a possibly-closed ring. */
export function openRingLength(ring: readonly XY[]): number {
	if (ring.length === 0) return 0;
	if (ring.length > 1 && sameXY(ring[0]!, ring[ring.length - 1]!)) {
		return ring.length - 1;
	}
	return ring.length;
}

export function edgeUnitNormal(a: XY, b: XY): XY | null {
	const ex = b[0] - a[0];
	const ey = b[1] - a[1];
	const len = Math.hypot(ex, ey);
	if (!(len > 0) || !Number.isFinite(len)) return null;
	// Left normal of A→B (outward for CCW exterior rings).
	return [-ey / len, ex / len];
}

/**
 * Enumerate edges of all rings. Closing duplicate vertices are skipped.
 */
export function listPolygonEdges(rings: readonly (readonly XY[])[]): PolygonEdge[] {
	const out: PolygonEdge[] = [];
	for (let ri = 0; ri < rings.length; ri++) {
		const ring = rings[ri]!;
		const n = openRingLength(ring);
		if (n < 3) continue;
		for (let i = 0; i < n; i++) {
			const a = ring[i] as XY;
			const b = ring[(i + 1) % n] as XY;
			if (!a || !b || a.length < 2 || b.length < 2) continue;
			const ax = Number(a[0]);
			const ay = Number(a[1]);
			const bx = Number(b[0]);
			const by = Number(b[1]);
			if (![ax, ay, bx, by].every(Number.isFinite)) continue;
			const aa: XY = [ax, ay];
			const bb: XY = [bx, by];
			const normal = edgeUnitNormal(aa, bb);
			if (!normal) continue;
			out.push({
				ringIndex: ri,
				edgeIndex: i,
				a: aa,
				b: bb,
				normal,
				midpoint: [(aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2]
			});
		}
	}
	return out;
}

/** Closest point on segment AB and distance to P. */
export function pointToSegment(p: XY, a: XY, b: XY): { closest: XY; distance: number; t: number } {
	const abx = b[0] - a[0];
	const aby = b[1] - a[1];
	const len2 = abx * abx + aby * aby;
	if (!(len2 > 0)) {
		const dx = p[0] - a[0];
		const dy = p[1] - a[1];
		return { closest: [a[0], a[1]], distance: Math.hypot(dx, dy), t: 0 };
	}
	let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
	t = Math.max(0, Math.min(1, t));
	const cx = a[0] + t * abx;
	const cy = a[1] + t * aby;
	return {
		closest: [cx, cy],
		distance: Math.hypot(p[0] - cx, p[1] - cy),
		t
	};
}

/** Nearest edge within `maxDistance` map units, or null. */
export function findClosestEdge(
	rings: readonly (readonly XY[])[],
	point: XY,
	maxDistance: number
): ClosestEdgeHit | null {
	if (!(maxDistance > 0)) return null;
	let best: ClosestEdgeHit | null = null;
	for (const edge of listPolygonEdges(rings)) {
		const { distance } = pointToSegment(point, edge.a, edge.b);
		if (distance > maxDistance) continue;
		if (!best || distance < best.distance) {
			best = { ...edge, distance };
		}
	}
	return best;
}

/**
 * Translate the two endpoints of an edge by `distance` along that edge’s left normal.
 * Always based on the supplied rings (pass a pre-drag snapshot for stable live updates).
 * Returns a deep-copied ring list; closes each ring if it was closed.
 */
export function extrudePolygonEdge(
	rings: readonly (readonly XY[])[],
	ringIndex: number,
	edgeIndex: number,
	distance: number
): XY[][] {
	const next = cloneRings(rings);
	const ring = next[ringIndex];
	if (!ring) return next;

	const n = openRingLength(ring);
	if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return next;

	const i0 = edgeIndex;
	const i1 = (edgeIndex + 1) % n;
	const a = ring[i0]!;
	const b = ring[i1]!;
	const normal = edgeUnitNormal(a, b);
	if (!normal) return next;

	ring[i0] = [a[0] + normal[0] * distance, a[1] + normal[1] * distance];
	ring[i1] = [b[0] + normal[0] * distance, b[1] + normal[1] * distance];
	closeIfNeeded(ring, n);
	return next;
}

/** Signed displacement of `point` from `origin` along unit `normal`. */
export function projectAlongNormal(origin: XY, point: XY, normal: XY): number {
	return (point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1];
}

export type ExtrudeSnapCandidate = {
	/** Signed offset along the extruded edge normal. */
	distance: number;
	/** Geometry that produced the candidate (for guides). */
	origin: XY;
	kind: 'vertex' | 'edge' | 'origin';
};

export type ExtrudeSegment = {
	a: XY;
	b: XY;
};

/**
 * Build 1D snap candidates along `normal` for extruding edge A→B.
 *
 * Only targets that lie near the infinite strip of the edge (along-edge ± pad)
 * contribute — avoids locking to far-away geometry that shares a similar depth.
 */
export function collectExtrudeSnapCandidates(
	edgeA: XY,
	edgeB: XY,
	normal: XY,
	vertices: readonly XY[],
	edges: readonly ExtrudeSegment[],
	opts?: {
		/** Extra reach past endpoints along the edge direction (map units). */
		lateralPad?: number;
		/** Min |cos| between edge directions to treat as parallel (default 0.98). */
		parallelCos?: number;
	}
): ExtrudeSnapCandidate[] {
	const tangent = edgeUnitTangent(edgeA, edgeB);
	if (!tangent) return [{ distance: 0, origin: midpoint(edgeA, edgeB), kind: 'origin' }];

	const edgeLen = Math.hypot(edgeB[0] - edgeA[0], edgeB[1] - edgeA[1]);
	const lateralPad = opts?.lateralPad ?? 0;
	const parallelCos = opts?.parallelCos ?? 0.98;
	const out: ExtrudeSnapCandidate[] = [
		{ distance: 0, origin: midpoint(edgeA, edgeB), kind: 'origin' }
	];
	const seen = new Set<string>([distanceKey(0)]);

	const push = (distance: number, origin: XY, kind: ExtrudeSnapCandidate['kind']) => {
		if (!Number.isFinite(distance)) return;
		const key = distanceKey(distance);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ distance, origin: [origin[0], origin[1]], kind });
	};

	for (const v of vertices) {
		if (!alongEdgeSpan(edgeA, tangent, edgeLen, lateralPad, v)) continue;
		push(projectAlongNormal(edgeA, v, normal), v, 'vertex');
	}

	for (const seg of edges) {
		const t2 = edgeUnitTangent(seg.a, seg.b);
		if (!t2) continue;
		const cos = Math.abs(tangent[0] * t2[0] + tangent[1] * t2[1]);
		if (cos < parallelCos) continue;
		if (!segmentsOverlapAlong(edgeA, tangent, edgeLen, lateralPad, seg.a, seg.b)) continue;
		// Parallel → both endpoints share the same normal depth
		push(projectAlongNormal(edgeA, seg.a, normal), midpoint(seg.a, seg.b), 'edge');
	}

	return out;
}

/**
 * Pick the candidate whose distance is closest to `freeDistance` within tolerance.
 * Prefers smallest |delta|; ties break toward 0 then smaller |distance|.
 */
export function snapExtrudeDistance(
	freeDistance: number,
	candidates: readonly ExtrudeSnapCandidate[],
	toleranceMap: number
): ExtrudeSnapCandidate | null {
	if (!(toleranceMap > 0) || candidates.length === 0) return null;
	let best: ExtrudeSnapCandidate | null = null;
	let bestDelta = Infinity;
	for (const c of candidates) {
		const delta = Math.abs(c.distance - freeDistance);
		if (delta > toleranceMap) continue;
		if (
			best === null ||
			delta < bestDelta - 1e-12 ||
			(Math.abs(delta - bestDelta) <= 1e-12 &&
				(Math.abs(c.distance) < Math.abs(best.distance) ||
					(Math.abs(c.distance) === Math.abs(best.distance) && c.distance < best.distance)))
		) {
			best = c;
			bestDelta = delta;
		}
	}
	return best;
}

function cloneRings(rings: readonly (readonly XY[])[]): XY[][] {
	return rings.map((ring) => ring.map((c) => [Number(c[0]), Number(c[1])] as XY));
}

function closeIfNeeded(ring: XY[], openLen: number) {
	if (ring.length === openLen) {
		// Was open — keep open
		return;
	}
	// Closed: last must equal first
	const first = ring[0]!;
	ring[ring.length - 1] = [first[0], first[1]];
}

function sameXY(a: XY, b: XY): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

function midpoint(a: XY, b: XY): XY {
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function edgeUnitTangent(a: XY, b: XY): XY | null {
	const ex = b[0] - a[0];
	const ey = b[1] - a[1];
	const len = Math.hypot(ex, ey);
	if (!(len > 0) || !Number.isFinite(len)) return null;
	return [ex / len, ey / len];
}

function alongEdgeSpan(
	edgeA: XY,
	tangent: XY,
	edgeLen: number,
	pad: number,
	point: XY
): boolean {
	const along = (point[0] - edgeA[0]) * tangent[0] + (point[1] - edgeA[1]) * tangent[1];
	return along >= -pad && along <= edgeLen + pad;
}

function segmentsOverlapAlong(
	edgeA: XY,
	tangent: XY,
	edgeLen: number,
	pad: number,
	a: XY,
	b: XY
): boolean {
	const s0 = (a[0] - edgeA[0]) * tangent[0] + (a[1] - edgeA[1]) * tangent[1];
	const s1 = (b[0] - edgeA[0]) * tangent[0] + (b[1] - edgeA[1]) * tangent[1];
	const lo = Math.min(s0, s1);
	const hi = Math.max(s0, s1);
	return hi >= -pad && lo <= edgeLen + pad;
}

function distanceKey(d: number): string {
	// ~1 mm grid — de-dupe near-identical depths
	return String(Math.round(d * 1000));
}
