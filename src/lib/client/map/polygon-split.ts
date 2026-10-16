/**
 * Pure polygon split by a chord between two different boundary edges.
 * Exterior ring only (simple map polygons).
 */

import {
	findClosestEdge,
	listPolygonEdges,
	openRingLength,
	pointToSegment,
	type ClosestEdgeHit,
	type XY
} from './edge-extrude';
import { roundSnapCoord } from './draw-snap';

export type { XY };

export type SplitEdgePoint = {
	ringIndex: number;
	edgeIndex: number;
	/** Param along edge A→B in [0, 1]. */
	t: number;
	point: XY;
};

export type PolygonSplitResult = {
	/** Two simple exterior rings (closed: first === last). */
	parts: [XY[], XY[]];
	a: SplitEdgePoint;
	b: SplitEdgePoint;
};

const EPS = 1e-9;

function sameXY(a: XY, b: XY, eps = EPS): boolean {
	return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function roundXY(p: XY): XY {
	return [roundSnapCoord(p[0]), roundSnapCoord(p[1])];
}

/** Open exterior ring as unique vertices (drop closing duplicate). */
export function openExteriorRing(rings: readonly (readonly XY[])[]): XY[] | null {
	const ring = rings[0];
	if (!ring) return null;
	const n = openRingLength(ring as XY[]);
	if (n < 3) return null;
	const out: XY[] = [];
	for (let i = 0; i < n; i++) {
		const v = ring[i]!;
		const x = Number(v[0]);
		const y = Number(v[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
		out.push([x, y]);
	}
	return out;
}

/** Close ring if needed (first === last). */
export function closeRing(open: readonly XY[]): XY[] {
	if (open.length === 0) return [];
	const first = open[0]!;
	const last = open[open.length - 1]!;
	if (sameXY(first, last)) return open.map((p) => [p[0], p[1]] as XY);
	return [...open.map((p) => [p[0], p[1]] as XY), [first[0], first[1]]];
}

/** Signed area of an open or closed ring (shoelace). */
export function ringSignedArea(ring: readonly XY[]): number {
	const n = openRingLength(ring as XY[]);
	if (n < 3) return 0;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const a = ring[i]!;
		const b = ring[(i + 1) % n]!;
		sum += a[0] * b[1] - b[0] * a[1];
	}
	return sum / 2;
}

export function ringAbsArea(ring: readonly XY[]): number {
	return Math.abs(ringSignedArea(ring));
}

/**
 * Project a map point onto the nearest exterior edge within `maxDistance`.
 * Only ring 0 (exterior).
 */
export function pickBoundaryPoint(
	rings: readonly (readonly XY[])[],
	point: XY,
	maxDistance: number
): SplitEdgePoint | null {
	const exterior = rings[0] ? [rings[0]] : [];
	const hit = findClosestEdge(exterior, point, maxDistance);
	if (!hit || hit.ringIndex !== 0) return null;
	return edgeHitToSplitPoint(hit, point);
}

function edgeHitToSplitPoint(hit: ClosestEdgeHit, prefer?: XY): SplitEdgePoint {
	const { closest, t } = pointToSegment(prefer ?? hit.midpoint, hit.a, hit.b);
	return {
		ringIndex: hit.ringIndex,
		edgeIndex: hit.edgeIndex,
		t: Math.max(0, Math.min(1, t)),
		point: roundXY(closest)
	};
}

/**
 * Snap free pointer to the nearest different exterior edge than `anchor`.
 */
export function snapToOtherEdge(
	rings: readonly (readonly XY[])[],
	point: XY,
	anchor: SplitEdgePoint,
	maxDistance: number
): SplitEdgePoint | null {
	const exterior = rings[0] ? [rings[0]] : [];
	const edges = listPolygonEdges(exterior).filter(
		(e) => !(e.ringIndex === anchor.ringIndex && e.edgeIndex === anchor.edgeIndex)
	);
	if (edges.length === 0) return null;

	let best: SplitEdgePoint | null = null;
	let bestDist = maxDistance;

	for (const e of edges) {
		const { closest, distance, t } = pointToSegment(point, e.a, e.b);
		if (distance > bestDist) continue;
		if (sameXY(closest, anchor.point, 1e-6)) continue;
		bestDist = distance;
		best = {
			ringIndex: e.ringIndex,
			edgeIndex: e.edgeIndex,
			t: Math.max(0, Math.min(1, t)),
			point: roundXY(closest)
		};
	}
	return best;
}

/**
 * Build ordered open boundary = ring vertices with A/B inserted on their edges.
 */
function buildBoundarySimple(
	open: readonly XY[],
	a: SplitEdgePoint,
	b: SplitEdgePoint
): { nodes: XY[]; indexA: number; indexB: number } | null {
	const n = open.length;
	type Extra = { t: number; point: XY; tag: 'a' | 'b' };

	/** Per-edge extras; t≈1 is folded onto the next vertex as t=0. */
	const extras = new Map<number, Extra[]>();

	const enqueue = (edgeIndex: number, t: number, point: XY, tag: 'a' | 'b') => {
		let ei = ((edgeIndex % n) + n) % n;
		let tt = t;
		let pt = point;
		// Fold onto vertices so each split is either mid-edge or on a vertex.
		if (tt <= EPS) {
			tt = 0;
			pt = [open[ei]![0], open[ei]![1]];
		} else if (tt >= 1 - EPS) {
			ei = (ei + 1) % n;
			tt = 0;
			pt = [open[ei]![0], open[ei]![1]];
		}
		const list = extras.get(ei) ?? [];
		list.push({ t: tt, point: roundXY(pt), tag });
		extras.set(ei, list);
	};

	enqueue(a.edgeIndex, a.t, a.point, 'a');
	enqueue(b.edgeIndex, b.t, b.point, 'b');

	const nodes: XY[] = [];
	let indexA = -1;
	let indexB = -1;

	const mark = (tag: 'a' | 'b', idx: number) => {
		if (tag === 'a') indexA = idx;
		else indexB = idx;
	};

	for (let i = 0; i < n; i++) {
		const v = open[i]!;
		const list = (extras.get(i) ?? []).slice().sort((p, q) => p.t - q.t);
		const atVertex = list.filter((e) => e.t <= EPS || sameXY(e.point, v, 1e-6));
		const mid = list.filter((e) => e.t > EPS && !sameXY(e.point, v, 1e-6));

		if (atVertex.length > 0) {
			const pt = roundXY(atVertex[0]!.point);
			nodes.push(pt);
			for (const e of atVertex) mark(e.tag, nodes.length - 1);
		} else {
			nodes.push([v[0], v[1]]);
		}

		for (const e of mid) {
			const last = nodes[nodes.length - 1]!;
			if (!sameXY(last, e.point, 1e-6)) nodes.push(roundXY(e.point));
			mark(e.tag, nodes.length - 1);
		}
	}

	if (indexA < 0 || indexB < 0 || indexA === indexB) return null;
	if (nodes.length < 3) return null;
	return { nodes, indexA, indexB };
}

function walkOpen(nodes: readonly XY[], from: number, to: number): XY[] {
	const out: XY[] = [];
	const n = nodes.length;
	let i = from;
	out.push([nodes[i]![0], nodes[i]![1]]);
	if (from === to) return out;
	do {
		i = (i + 1) % n;
		out.push([nodes[i]![0], nodes[i]![1]]);
	} while (i !== to);
	return out;
}

function uniqueCount(path: readonly XY[]): number {
	let count = 0;
	for (let i = 0; i < path.length; i++) {
		const p = path[i]!;
		const prev = i > 0 ? path[i - 1]! : null;
		if (!prev || !sameXY(prev, p, 1e-6)) count++;
	}
	if (path.length > 1 && sameXY(path[0]!, path[path.length - 1]!, 1e-6)) count--;
	return count;
}

/**
 * Split exterior ring by chord A–B (A,B on different edges).
 * Returns two closed rings or null if degenerate.
 */
export function splitPolygonByEdgePoints(
	rings: readonly (readonly XY[])[],
	a: SplitEdgePoint,
	b: SplitEdgePoint
): PolygonSplitResult | null {
	const open = openExteriorRing(rings);
	if (!open) return null;
	if (a.ringIndex !== 0 || b.ringIndex !== 0) return null;
	if (a.edgeIndex === b.edgeIndex) return null;
	if (sameXY(a.point, b.point, 1e-6)) return null;

	const built = buildBoundarySimple(open, a, b);
	if (!built) return null;
	const { nodes, indexA, indexB } = built;

	const path1 = walkOpen(nodes, indexA, indexB);
	const path2 = walkOpen(nodes, indexB, indexA);
	if (uniqueCount(path1) < 3 || uniqueCount(path2) < 3) return null;

	const ring1 = closeRing(path1);
	const ring2 = closeRing(path2);
	if (ringAbsArea(ring1) < EPS || ringAbsArea(ring2) < EPS) return null;

	// Soft area conservation — reject cuts that clearly leave the exterior
	const orig = ringAbsArea(open);
	const sum = ringAbsArea(ring1) + ringAbsArea(ring2);
	if (orig > EPS && Math.abs(sum - orig) / orig > 0.05) return null;

	return { parts: [ring1, ring2], a, b };
}

/**
 * Full split from two map coordinates: snap each to boundary edges, then cut.
 */
export function splitPolygonAtPoints(
	rings: readonly (readonly XY[])[],
	start: XY,
	end: XY,
	edgeTolerance: number
): PolygonSplitResult | null {
	const a = pickBoundaryPoint(rings, start, edgeTolerance);
	if (!a) return null;
	const b =
		snapToOtherEdge(rings, end, a, edgeTolerance * 4) ??
		pickBoundaryPoint(rings, end, edgeTolerance);
	if (!b) return null;
	if (a.edgeIndex === b.edgeIndex) return null;
	return splitPolygonByEdgePoints(rings, a, b);
}

/** Writable GeoJSON polygons from a split result. */
export function splitResultToPolygons(result: PolygonSplitResult): [
	{ type: 'Polygon'; coordinates: Array<Array<[number, number]>> },
	{ type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
] {
	return [
		{
			type: 'Polygon',
			coordinates: [result.parts[0].map((p) => [p[0], p[1]] as [number, number])]
		},
		{
			type: 'Polygon',
			coordinates: [result.parts[1].map((p) => [p[0], p[1]] as [number, number])]
		}
	];
}
