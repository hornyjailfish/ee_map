/**
 * OpenLayers ↔ normalized / writable GeoJSON helpers (metric XY plane).
 * Shared by MapView draw/create and later modify paths.
 * Browser-only — imports `ol/geom`.
 */

import type { Geometry as OlGeometry } from 'ol/geom';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import LineString from 'ol/geom/LineString';
import MultiLineString from 'ol/geom/MultiLineString';
import {
	geometryToGeoJSON,
	normalizeGeometry,
	type NormalizedGeometry
} from '$lib/transform/to-map';

/** Writable GeoJSON accepted by mutate coerceGeometry (Point | Polygon). */
export type WritableGeoJSON =
	| { type: 'Point'; coordinates: [number, number] }
	| { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };

/** Build an OL geometry from a normalized map feature geometry. */
export function normalizedToOl(
	geometry: NormalizedGeometry
): Point | Polygon | LineString | MultiLineString | null {
	if (geometry.kind === 'point') {
		return new Point([geometry.x, geometry.y]);
	}
	if (geometry.kind === 'polygon') {
		return new Polygon(geometry.rings);
	}
	if (geometry.kind === 'line') {
		if (geometry.paths.length === 1) {
			return new LineString(geometry.paths[0]!);
		}
		return new MultiLineString(geometry.paths);
	}
	return null;
}

/**
 * Read an OL geometry back into normalized form (same plane, no reprojection).
 * Empty / unsupported → `{ kind: 'empty' }`.
 */
export function olToNormalized(geometry: OlGeometry | null | undefined): NormalizedGeometry {
	if (!geometry) return { kind: 'empty' };

	const type = geometry.getType();

	if (type === 'Point') {
		const c = (geometry as Point).getCoordinates();
		if (!Array.isArray(c) || c.length < 2) return { kind: 'empty' };
		const x = Number(c[0]);
		const y = Number(c[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) return { kind: 'empty' };
		return { kind: 'point', x, y };
	}

	if (type === 'Polygon') {
		const rings = normalizeRings((geometry as Polygon).getCoordinates());
		if (!rings) return { kind: 'empty' };
		return { kind: 'polygon', rings };
	}

	if (type === 'LineString') {
		const path = normalizePath((geometry as LineString).getCoordinates());
		if (!path) return { kind: 'empty' };
		return { kind: 'line', paths: [path] };
	}

	if (type === 'MultiLineString') {
		const raw = (geometry as MultiLineString).getCoordinates();
		if (!Array.isArray(raw) || raw.length === 0) return { kind: 'empty' };
		const paths: Array<Array<[number, number]>> = [];
		for (const part of raw) {
			const path = normalizePath(part);
			if (path) paths.push(path);
		}
		if (paths.length === 0) return { kind: 'empty' };
		return { kind: 'line', paths };
	}

	// MultiPolygon etc. — not used on indoor layers today
	return { kind: 'empty' };
}

/**
 * Convert an OL geometry to Point/Polygon GeoJSON for create / patchGeometry.
 * Lines and other kinds → null (server coerce rejects them).
 */
export function olToWritableGeoJSON(geometry: OlGeometry | null | undefined): WritableGeoJSON | null {
	const normalized = olToNormalized(geometry);
	const geo = geometryToGeoJSON(normalized);
	if (!geo) return null;
	if (geo.type === 'Point' || geo.type === 'Polygon') return geo;
	return null;
}

/** Normalize already-known GeoJSON-ish value via shared map normalizer. */
export function geoJsonToNormalized(value: unknown): NormalizedGeometry {
	return normalizeGeometry(value);
}

function normalizePath(coords: unknown): Array<[number, number]> | null {
	if (!Array.isArray(coords) || coords.length < 2) return null;
	const path: Array<[number, number]> = [];
	for (const c of coords) {
		if (!Array.isArray(c) || c.length < 2) return null;
		const x = Number(c[0]);
		const y = Number(c[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
		path.push([x, y]);
	}
	return path;
}

function normalizeRings(coords: unknown): Array<Array<[number, number]>> | null {
	if (!Array.isArray(coords) || coords.length === 0) return null;
	const rings: Array<Array<[number, number]>> = [];
	for (const ring of coords) {
		const path = normalizePath(ring);
		// GeoJSON polygon rings need ≥ 4 positions (closed)
		if (!path || path.length < 4) return null;
		rings.push(closeRing(path));
	}
	return rings;
}

/** Ensure first === last vertex (Surreal / GeoJSON expectation). */
function closeRing(ring: Array<[number, number]>): Array<[number, number]> {
	if (ring.length === 0) return ring;
	const first = ring[0]!;
	const last = ring[ring.length - 1]!;
	if (first[0] === last[0] && first[1] === last[1]) return ring;
	return [...ring, [first[0], first[1]]];
}
