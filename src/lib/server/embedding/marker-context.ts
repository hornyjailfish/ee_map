/**
 * Resolve marker context for the modal badge + the structured links stored on
 * the `markers` row.
 *
 * Given a marker point (metric XY) and a level id, find:
 *   - the `zones` polygon containing the point  → zone name / id
 *   - the `rents` polygon containing the point  → the `shops` brand that rents it
 *     (falling back to `closestRentId` when the point isn't inside any rent)
 *
 * Returns human-readable names (for the badge) plus the ids to persist as
 * `markers.zone` / `markers.closest_shop` links. The editor writes the final
 * `user_description` itself — no description text is generated here.
 */

import type { Surreal } from 'surrealdb';
import { pointInPolygon } from '$lib/transform/geometry-points';
import { normalizeGeometry } from '$lib/transform/to-map';
import { normalizeRecordId } from '$lib/transform/to-table';
import type { MarkerContextData } from '$lib/transform/marker';
import { queryEntities } from '$lib/server/data/query-entities';

export type MarkerPoint = { x: number; y: number };

/** Alias kept for server call sites; canonical shape is {@link MarkerContextData}. */
export type MarkerContext = MarkerContextData;

type PolygonRow = {
	id: string;
	name: string | null;
	levelId: string | null;
	rings: Array<Array<[number, number]>> | null;
};

function toPolygonRow(row: Record<string, unknown>, levelField = 'level'): PolygonRow | null {
	const geometry = normalizeGeometry(row['geometry']);
	const rings = geometry.kind === 'polygon' ? geometry.rings : null;
	return {
		id: normalizeRecordId(row.id) || String(row.id ?? ''),
		name: typeof row.name === 'string' ? row.name : null,
		levelId: levelField ? normalizeRecordId(row[levelField]) || null : null,
		rings
	};
}

function findByLevel(rows: Record<string, unknown>[], levelId: string | null): PolygonRow[] {
	return rows
		.map((r) => toPolygonRow(r))
		.filter(
			(r): r is PolygonRow =>
				r !== null && r.rings !== null && (levelId === null || r.levelId === levelId)
		);
}

/**
 * Resolve level/zone/rent/shop context for a point.
 * Pure w.r.t. geometry; reads all context tables in one go (indoor dataset is small).
 */
export async function resolveMarkerContext(
	session: Surreal,
	point: MarkerPoint,
	levelId: string | null,
	closestRentId: string | null = null
): Promise<MarkerContext> {
	const [zonesRows, rentsRows, shopsRows, levelsRows] = await Promise.all([
		queryEntities(session, 'zones'),
		queryEntities(session, 'rents'),
		queryEntities(session, 'shops'),
		queryEntities(session, 'levels')
	]);

	const zones = findByLevel(zonesRows, levelId);
	const rents = findByLevel(rentsRows, levelId);

	let zoneId: string | null = null;
	let zoneName: string | null = null;
	for (const zone of zones) {
		if (pointInPolygon(point.x, point.y, zone.rings!)) {
			zoneId = zone.id;
			zoneName = zone.name;
			break;
		}
	}

	let rentId: string | null = null;
	let rentName: string | null = null;
	for (const rent of rents) {
		if (pointInPolygon(point.x, point.y, rent.rings!)) {
			rentId = rent.id;
			rentName = rent.name;
			break;
		}
	}

	// Fall back to the closest rent (computed client-side on the metric XY plane)
	// when the point doesn't land inside any rented area.
	if (!rentId && closestRentId) {
		for (const rent of rents) {
			if (rent.id === closestRentId) {
				rentId = rent.id;
				rentName = rent.name;
				break;
			}
		}
	}

	// Brand that rents this area: shops.area → rents (unique index on area).
	let shopId: string | null = null;
	let shopName: string | null = null;
	if (rentId) {
		for (const shop of shopsRows) {
			if (normalizeRecordId(shop.area) === rentId) {
				shopId = normalizeRecordId(shop.id) || String(shop.id ?? '');
				shopName = typeof shop.name === 'string' ? shop.name : null;
				break;
			}
		}
	}

	let levelName: string | null = null;
	if (levelId) {
		for (const level of levelsRows) {
			if ((normalizeRecordId(level.id) || String(level.id ?? '')) === levelId) {
				levelName = typeof level.name === 'string' ? level.name : null;
				break;
			}
		}
	}

	return {
		levelId,
		levelName,
		zoneId,
		zoneName,
		rentId,
		rentName,
		shopId,
		shopName
	};
}
