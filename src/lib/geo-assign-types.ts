/**
 * Shared types for geometry-assignment UI (safe for client + server).
 */

import type { NormalizedGeometry } from '$lib/transform/to-map';

export type GeoSourceMeta = {
	/** Folder key under static/geo (e.g. `1`, `-1`, `roof`). */
	folder: string;
	/** File name without extension (e.g. `shops`). */
	name: string;
	/** URL path served by SvelteKit static (`/geo/1/shops.geojson`). */
	path: string;
	/** Feature count from the FeatureCollection (raw, not geometry-validated). */
	featureCount: number;
};

export type GeoAssignFeature = {
	/** Stable client id for selection (not a DB record id). */
	id: string;
	geometry: NormalizedGeometry;
	/** Non-id properties from the feature (legacy ids stripped). */
	properties: Record<string, unknown>;
	label?: string;
};

export type GeoAssignLayer = {
	folder: string;
	name: string;
	path: string;
	features: GeoAssignFeature[];
	extent: [number, number, number, number] | null;
};
