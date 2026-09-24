/**
 * Load sparse AppConfigOverlay from `app_config:main`.
 * Missing table / record → null (merge treats as empty overlay).
 */

import { RecordId, type Surreal } from 'surrealdb';
import type { AppConfigOverlay } from '$lib/config/types';
import { liftOverlayV1toV2 } from '$lib/config/overlay-io';

const OVERLAY_TABLE = 'app_config';
const OVERLAY_ID = 'main';

/**
 * Select `app_config:main` and normalize to AppConfigOverlay | null.
 * Never throws on missing table/record — returns null and logs soft failures.
 */
export async function loadOverlay(session: Surreal): Promise<AppConfigOverlay | null> {
	try {
		const row = await session.select<Record<string, unknown>>(
			new RecordId(OVERLAY_TABLE, OVERLAY_ID)
		);
		return normalizeOverlay(row);
	} catch (error) {
		// Soft-fail when table/record missing in a fresh DB before seed/sync.
		const message = error instanceof Error ? error.message : String(error);
		if (!/not found|no such|does not exist|failed to select/i.test(message)) {
			console.warn('[config/load-overlay] select failed:', message);
		}
		return null;
	}
}

/**
 * Coerce a raw record (or SELECT row) into AppConfigOverlay when possible.
 * Exported for tests.
 */
export function normalizeOverlay(raw: unknown): AppConfigOverlay | null {
	if (raw == null) return null;

	// SELECT sometimes returns array
	if (Array.isArray(raw)) {
		if (raw.length === 0) return null;
		return normalizeOverlay(raw[0]);
	}

	if (typeof raw !== 'object') return null;

	const row = raw as Record<string, unknown>;

	// version is required by contract; default to 2 if present-ish overlay fields exist
	const version = row.version;
	const hasOverlayShape =
		version === 1 ||
		version === '1' ||
		version === 2 ||
		version === '2' ||
		row.entities != null ||
		row.edges != null ||
		row.graph != null ||
		row.map != null ||
		row.search != null ||
		row.excludeTables != null;

	if (!hasOverlayShape) return null;

	// v1 rows are migrated to v2 in place (nested graph/map/edges lifted).
	return liftOverlayV1toV2(row);
}
