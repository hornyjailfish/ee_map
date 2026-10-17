/**
 * Load sparse AppConfigOverlay from `app_config:<id>`.
 * Missing table / record → null (merge treats as empty overlay).
 *
 * Active id: cookie / `APP_CONFIG_ID` / `main` (see overlay-id.ts).
 */

import { RecordId, type Surreal } from 'surrealdb';
import type { AppConfigOverlay } from '$lib/config/types';
import { liftOverlayToV3 } from '$lib/config/overlay-io';
import { OVERLAY_TABLE, resolveOverlayId } from './overlay-id';

/**
 * Select active `app_config` row and normalize to AppConfigOverlay | null.
 * Never throws on missing table/record — returns null and logs soft failures.
 */
export async function loadOverlay(
	session: Surreal,
	overlayId?: string | null
): Promise<AppConfigOverlay | null> {
	const id = resolveOverlayId(overlayId);
	try {
		const row = await session.select<Record<string, unknown>>(
			new RecordId(OVERLAY_TABLE, id)
		);
		return normalizeOverlay(row);
	} catch (error) {
		// Soft-fail when table/record missing in a fresh DB before seed/sync.
		const message = error instanceof Error ? error.message : String(error);
		const lower = message.toLowerCase();
		const soft =
			lower.includes('not found') ||
			lower.includes('no such') ||
			lower.includes('does not exist') ||
			lower.includes('failed to select');
		if (!soft) {
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
		version === 3 ||
		version === '3' ||
		row.entities != null ||
		row.edges != null ||
		row.graph != null ||
		row.map != null ||
		row.search != null ||
		row.excludeTables != null;

	if (!hasOverlayShape) return null;

	// Older rows (v1/v2, incl. legacy `embeddings`) are migrated to v3 in place.
	return liftOverlayToV3(row);
}
