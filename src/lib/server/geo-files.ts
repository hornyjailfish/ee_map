/**
 * Load static GeoJSON sources under `static/geo/{folder}/{file}.geojson`.
 * Folders are arbitrary labels (often level ord / name keys) — not DB ids.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GeoAssignFeature, GeoAssignLayer, GeoSourceMeta } from '$lib/geo-assign-types';
import { geometryBBox, normalizeGeometry } from '$lib/transform/to-map';

export type { GeoAssignFeature, GeoAssignLayer, GeoSourceMeta } from '$lib/geo-assign-types';

const GEOJSON_EXT = '.geojson';

/** Allowlisted folder / file name segment (no path traversal). */
const SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function geoRoot(): string {
	return path.join(process.cwd(), 'static', 'geo');
}

function isSafeSegment(value: string): boolean {
	return SEGMENT_RE.test(value) && !value.includes('..');
}

/**
 * List available geojson sources under static/geo.
 * Skips empty folders and non-.geojson files.
 */
export async function listGeoSources(): Promise<GeoSourceMeta[]> {
	const root = geoRoot();
	let folders: string[];
	try {
		folders = await readdir(root);
	} catch {
		return [];
	}

	const out: GeoSourceMeta[] = [];

	for (const folder of folders.sort(compareFolderKeys)) {
		if (!isSafeSegment(folder)) continue;
		const folderPath = path.join(root, folder);
		let st;
		try {
			st = await stat(folderPath);
		} catch {
			continue;
		}
		if (!st.isDirectory()) continue;

		let files: string[];
		try {
			files = await readdir(folderPath);
		} catch {
			continue;
		}

		for (const file of files.sort((a, b) => a.localeCompare(b))) {
			if (!file.toLowerCase().endsWith(GEOJSON_EXT)) continue;
			const name = file.slice(0, -GEOJSON_EXT.length);
			if (!isSafeSegment(name)) continue;

			const filePath = path.join(folderPath, file);
			let featureCount = 0;
			try {
				const raw = await readFile(filePath, 'utf8');
				const parsed = JSON.parse(raw) as { type?: string; features?: unknown };
				if (Array.isArray(parsed.features)) featureCount = parsed.features.length;
				else if (parsed.type === 'Feature') featureCount = 1;
			} catch {
				featureCount = 0;
			}

			out.push({
				folder,
				name,
				path: `/geo/${folder}/${name}${GEOJSON_EXT}`,
				featureCount
			});
		}
	}

	return out;
}

/**
 * Load one geojson file as assign-map features (metric XY, ids are synthetic).
 */
export async function loadGeoLayer(folder: string, name: string): Promise<GeoAssignLayer | null> {
	if (!isSafeSegment(folder) || !isSafeSegment(name)) {
		throw new Error('Invalid geo source path');
	}

	const filePath = path.join(geoRoot(), folder, `${name}${GEOJSON_EXT}`);
	let text: string;
	try {
		text = await readFile(filePath, 'utf8');
	} catch {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`Invalid GeoJSON: ${folder}/${name}`);
	}

	if (!parsed || typeof parsed !== 'object') {
		throw new Error(`Invalid GeoJSON: ${folder}/${name}`);
	}

	const root = parsed as Record<string, unknown>;
	const featuresRaw = Array.isArray(root.features)
		? root.features
		: root.type === 'Feature'
			? [root]
			: [];

	const features: GeoAssignFeature[] = [];
	const boxes: Array<[number, number, number, number]> = [];

	for (let i = 0; i < featuresRaw.length; i++) {
		const item = featuresRaw[i];
		if (!item || typeof item !== 'object') continue;
		const feat = item as Record<string, unknown>;
		const geometry = normalizeGeometry(feat.geometry ?? feat);
		if (geometry.kind === 'empty') continue;

		const propsRaw =
			feat.properties && typeof feat.properties === 'object' && !Array.isArray(feat.properties)
				? { ...(feat.properties as Record<string, unknown>) }
				: {};
		// Legacy feature props ids are not real DB ids — drop them.
		delete propsRaw.id;
		delete propsRaw.ID;
		delete propsRaw.Id;

		const id = `geo:${folder}/${name}:${i}`;
		const feature: GeoAssignFeature = {
			id,
			geometry,
			properties: propsRaw
		};

		const label =
			typeof propsRaw.name === 'string' && propsRaw.name
				? propsRaw.name
				: typeof propsRaw.label === 'string' && propsRaw.label
					? propsRaw.label
					: undefined;
		if (label) feature.label = label;

		const box = geometryBBox(geometry);
		if (box) boxes.push(box);
		features.push(feature);
	}

	return {
		folder,
		name,
		path: `/geo/${folder}/${name}${GEOJSON_EXT}`,
		features,
		extent: unionBoxes(boxes)
	};
}

function unionBoxes(
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
	if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null;
	return [minX, minY, maxX, maxY];
}

/** Sort folder keys: numeric ord first (…-2,-1,1,2…), then alpha (roof). */
function compareFolderKeys(a: string, b: string): number {
	const an = Number(a);
	const bn = Number(b);
	const aNum = a.trim() !== '' && Number.isFinite(an);
	const bNum = b.trim() !== '' && Number.isFinite(bn);
	if (aNum && bNum && an !== bn) return an - bn;
	if (aNum && !bNum) return -1;
	if (!aNum && bNum) return 1;
	return a.localeCompare(b);
}
