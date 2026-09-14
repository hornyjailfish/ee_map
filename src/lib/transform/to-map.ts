/**
 * Pure transform: ResolvedConfig map layers + Surreal rows → map view model.
 * Indoor metric XY only — never project to Web Mercator / lon-lat.
 * No OpenLayers imports.
 */

import type { ResolvedConfig, ResolvedMapLayer } from '$lib/config/types';
import { normalizeRecordId } from './to-table';

export type NormalizedGeometry =
	| { kind: 'point'; x: number; y: number }
	| { kind: 'polygon'; rings: Array<Array<[number, number]>> }
	/** One or more polylines (GeoJSON LineString / MultiLineString). */
	| { kind: 'line'; paths: Array<Array<[number, number]>> }
	| { kind: 'empty' };

export type MapFeature = {
	id: string;
	table: string;
	levelId: string | null;
	geometry: NormalizedGeometry;
	label?: string;
	properties: Record<string, unknown>;
	styleKey: string;
	zIndex: number;
	layerGroup?: string;
};

export type MapLayerView = {
	table: string;
	styleKey: string;
	zIndex: number;
	layerGroup?: string;
	features: MapFeature[];
};

export type MapViewModel = {
	units: 'm';
	plane: 'xy-meters';
	extent: [number, number, number, number] | null;
	layers: MapLayerView[];
	/** optional levels list if provided */
	levels?: Array<{ id: string; name?: string; ord?: number }>;
};

/**
 * Normalize Surreal / GeoJSON-ish geometry into metric XY kinds.
 * Accepts Point, Polygon, LineString, MultiLineString (case-insensitive).
 * Unknown / invalid → `{ kind: 'empty' }`.
 */
export function normalizeGeometry(value: unknown): NormalizedGeometry {
	if (value == null || typeof value !== 'object') return { kind: 'empty' };

	const obj = value as Record<string, unknown>;

	// Surreal SDK Geometry* values expose GeoJSON via toJSON(), have a coordinates
	// getter, but no own `type` — must call toJSON before treating as plain GeoJSON.
	if (
		typeof (obj as { toJSON?: unknown }).toJSON === 'function' &&
		typeof obj.type !== 'string'
	) {
		try {
			const json = (obj as { toJSON: () => unknown }).toJSON();
			// Guard against pathological toJSON() returning the same object
			if (json !== value) return normalizeGeometry(json);
		} catch {
			// fall through
		}
	}

	// Feature wrapper
	if (typeof obj.type === 'string' && obj.type.toLowerCase() === 'feature' && 'geometry' in obj) {
		return normalizeGeometry(obj.geometry);
	}

	const typeRaw = typeof obj.type === 'string' ? obj.type.toLowerCase() : null;
	const coordinates = obj.coordinates;

	// Nested geometry bag (without a type of its own)
	if (!typeRaw && 'geometry' in obj) {
		return normalizeGeometry(obj.geometry);
	}

	if (typeRaw === 'point') {
		const xy = parsePosition(coordinates);
		if (!xy) return { kind: 'empty' };
		return { kind: 'point', x: xy[0], y: xy[1] };
	}

	if (typeRaw === 'polygon') {
		const rings = parsePolygonRings(coordinates);
		if (!rings || rings.length === 0) return { kind: 'empty' };
		return { kind: 'polygon', rings };
	}

	if (typeRaw === 'linestring') {
		const path = parseLinePath(coordinates);
		if (!path) return { kind: 'empty' };
		return { kind: 'line', paths: [path] };
	}

	if (typeRaw === 'multilinestring') {
		const paths = parseMultiLinePaths(coordinates);
		if (!paths || paths.length === 0) return { kind: 'empty' };
		return { kind: 'line', paths };
	}

	// Bare coordinate pair → point
	if (Array.isArray(value) && value.length >= 2 && typeRaw == null) {
		const xy = parsePosition(value);
		if (xy) return { kind: 'point', x: xy[0], y: xy[1] };
	}

	// Object with x/y numeric fields
	if (
		typeof obj.x === 'number' &&
		typeof obj.y === 'number' &&
		Number.isFinite(obj.x) &&
		Number.isFinite(obj.y)
	) {
		return { kind: 'point', x: obj.x, y: obj.y };
	}

	return { kind: 'empty' };
}

/**
 * Convert a normalized geometry back to GeoJSON for Surreal writes.
 * Empty / unsupported → null.
 */
export function geometryToGeoJSON(
	geometry: NormalizedGeometry
):
	| { type: 'Point'; coordinates: [number, number] }
	| { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
	| { type: 'LineString'; coordinates: Array<[number, number]> }
	| { type: 'MultiLineString'; coordinates: Array<Array<[number, number]>> }
	| null {
	if (geometry.kind === 'point') {
		return { type: 'Point', coordinates: [geometry.x, geometry.y] };
	}
	if (geometry.kind === 'polygon') {
		return { type: 'Polygon', coordinates: geometry.rings };
	}
	if (geometry.kind === 'line') {
		if (geometry.paths.length === 1) {
			return { type: 'LineString', coordinates: geometry.paths[0]! };
		}
		return { type: 'MultiLineString', coordinates: geometry.paths };
	}
	return null;
}

/** Coordinate rounding for stable fingerprints across serialize/round-trip. */
const GEOM_KEY_DECIMALS = 6;

function roundCoord(n: number): number {
	const f = 10 ** GEOM_KEY_DECIMALS;
	return Math.round(n * f) / f;
}

/**
 * Canonical fingerprint for geometry equality (assign UI: mark used source features).
 * Empty → empty string. Points/polygons rounded so DB ↔ geojson matches survive float noise.
 */
export function geometryKey(g: NormalizedGeometry): string {
	if (g.kind === 'empty') return '';
	if (g.kind === 'point') {
		return `p:${roundCoord(g.x)},${roundCoord(g.y)}`;
	}
	if (g.kind === 'line') {
		const paths = g.paths
			.map((path) => path.map(([x, y]) => `${roundCoord(x)},${roundCoord(y)}`).join(';'))
			.join('|');
		return `l:${paths}`;
	}
	const rings = g.rings
		.map((ring) => ring.map(([x, y]) => `${roundCoord(x)},${roundCoord(y)}`).join(';'))
		.join('|');
	return `g:${rings}`;
}

/** Axis-aligned bbox [minX, minY, maxX, maxY] in map units, or null if empty. */
export function geometryBBox(g: NormalizedGeometry): [number, number, number, number] | null {
	if (g.kind === 'empty') return null;

	if (g.kind === 'point') {
		return [g.x, g.y, g.x, g.y];
	}

	const paths = g.kind === 'polygon' ? g.rings : g.paths;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let any = false;

	for (const path of paths) {
		for (const [x, y] of path) {
			any = true;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}

	if (!any) return null;
	return [minX, minY, maxX, maxY];
}

/**
 * Build map view model from resolved config + entity rows.
 * Iterates `config.map.layers` (already z-sorted). Does not mutate inputs.
 * Never converts coordinates to lon/lat.
 */
export function toMap(input: {
	config: ResolvedConfig;
	/** table → rows */
	entities: Record<string, Array<Record<string, unknown>>>;
	levels?: Array<Record<string, unknown>>;
	/** if set, filter features to this level id string */
	levelId?: string | null;
}): MapViewModel {
	const { config, entities } = input;
	const levelFilter =
		input.levelId === undefined || input.levelId === null || input.levelId === ''
			? null
			: String(input.levelId);

	const layers: MapLayerView[] = [];
	const computedBoxes: Array<[number, number, number, number]> = [];

	for (const layer of config.map.layers) {
		const view = buildLayerView(layer, entities[layer.table] ?? [], levelFilter, computedBoxes);
		layers.push(view);
	}

	const extent = resolveExtent(config.map.extent, computedBoxes);

	const model: MapViewModel = {
		units: config.map.units,
		plane: config.map.plane,
		extent,
		layers
	};

	if (input.levels) {
		model.levels = mapLevels(input.levels, config.map.levelOrderField);
	}

	return model;
}

function buildLayerView(
	layer: ResolvedMapLayer,
	rows: Array<Record<string, unknown>>,
	levelFilter: string | null,
	computedBoxes: Array<[number, number, number, number]>
): MapLayerView {
	const features: MapFeature[] = [];

	for (const row of rows) {
		const geometry = normalizeGeometry(row[layer.geometryField]);
		if (geometry.kind === 'empty') continue;

		// Levels floor plan: row is the level itself (no FK field)
		const levelId = layer.levelField
			? levelFromRow(row[layer.levelField])
			: levelFromRow(row.id);

		if (levelFilter !== null) {
			if (levelId === null || levelId !== levelFilter) continue;
		}

		const id = normalizeRecordId(row.id);
		const feature: MapFeature = {
			id: id || fallbackFeatureId(layer.table, features.length),
			table: layer.table,
			levelId,
			geometry,
			properties: { ...row },
			styleKey: layer.styleKey,
			zIndex: layer.zIndex
		};

		if (typeof row.name === 'string' && row.name.length > 0) {
			feature.label = row.name;
		}

		if (layer.layerGroup !== undefined) {
			feature.layerGroup = layer.layerGroup;
		}

		const box = geometryBBox(geometry);
		if (box) computedBoxes.push(box);

		features.push(feature);
	}

	const view: MapLayerView = {
		table: layer.table,
		styleKey: layer.styleKey,
		zIndex: layer.zIndex,
		features
	};

	if (layer.layerGroup !== undefined) {
		view.layerGroup = layer.layerGroup;
	}

	return view;
}

function levelFromRow(value: unknown): string | null {
	if (value == null || value === '') return null;
	const id = normalizeRecordId(value);
	return id === '' ? null : id;
}

function fallbackFeatureId(table: string, index: number): string {
	return `${table}:__row_${index}`;
}

function resolveExtent(
	configExtent: [number, number, number, number] | undefined,
	boxes: Array<[number, number, number, number]>
): [number, number, number, number] | null {
	if (configExtent) {
		return [configExtent[0], configExtent[1], configExtent[2], configExtent[3]];
	}
	return unionBBoxes(boxes);
}

function unionBBoxes(
	boxes: Array<[number, number, number, number]>
): [number, number, number, number] | null {
	if (boxes.length === 0) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const [a, b, c, d] of boxes) {
		if (a < minX) minX = a;
		if (b < minY) minY = b;
		if (c > maxX) maxX = c;
		if (d > maxY) maxY = d;
	}

	if (
		!Number.isFinite(minX) ||
		!Number.isFinite(minY) ||
		!Number.isFinite(maxX) ||
		!Number.isFinite(maxY)
	) {
		return null;
	}

	return [minX, minY, maxX, maxY];
}

function mapLevels(
	rows: Array<Record<string, unknown>>,
	orderField: string
): Array<{ id: string; name?: string; ord?: number }> {
	const levels = rows.map((row) => {
		const id = normalizeRecordId(row.id);
		const level: { id: string; name?: string; ord?: number } = {
			id: id || String(row.id ?? '')
		};

		if (typeof row.name === 'string') {
			level.name = row.name;
		}

		const ordVal = row[orderField];
		if (typeof ordVal === 'number' && Number.isFinite(ordVal)) {
			level.ord = ordVal;
		} else if (
			typeof ordVal === 'string' &&
			ordVal.trim() !== '' &&
			Number.isFinite(Number(ordVal))
		) {
			level.ord = Number(ordVal);
		}

		return level;
	});

	levels.sort((a, b) => {
		const ao = a.ord;
		const bo = b.ord;
		if (ao != null && bo != null && ao !== bo) return ao - bo;
		if (ao != null && bo == null) return -1;
		if (ao == null && bo != null) return 1;
		return a.id.localeCompare(b.id);
	});

	return levels;
}

function parsePosition(value: unknown): [number, number] | null {
	if (!Array.isArray(value) || value.length < 2) return null;
	const x = toFiniteNumber(value[0]);
	const y = toFiniteNumber(value[1]);
	if (x === null || y === null) return null;
	return [x, y];
}

function parsePolygonRings(value: unknown): Array<Array<[number, number]>> | null {
	if (!Array.isArray(value) || value.length === 0) return null;

	const rings: Array<Array<[number, number]>> = [];

	for (const ringRaw of value) {
		if (!Array.isArray(ringRaw) || ringRaw.length === 0) continue;
		const ring: Array<[number, number]> = [];
		for (const pos of ringRaw) {
			const xy = parsePosition(pos);
			if (!xy) {
				// Skip invalid vertices; empty ring dropped below
				continue;
			}
			ring.push(xy);
		}
		if (ring.length >= 3) {
			rings.push(ring);
		}
	}

	return rings.length > 0 ? rings : null;
}

function parseLinePath(value: unknown): Array<[number, number]> | null {
	if (!Array.isArray(value) || value.length < 2) return null;
	const path: Array<[number, number]> = [];
	for (const pos of value) {
		const xy = parsePosition(pos);
		if (!xy) continue;
		path.push(xy);
	}
	return path.length >= 2 ? path : null;
}

function parseMultiLinePaths(value: unknown): Array<Array<[number, number]>> | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const paths: Array<Array<[number, number]>> = [];
	for (const lineRaw of value) {
		const path = parseLinePath(lineRaw);
		if (path) paths.push(path);
	}
	return paths.length > 0 ? paths : null;
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	if (typeof value === 'bigint') {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return null;
}
