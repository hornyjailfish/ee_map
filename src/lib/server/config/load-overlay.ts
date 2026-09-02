/**
 * Load sparse AppConfigOverlay from `app_config:main`.
 * Missing table / record → null (merge treats as empty overlay).
 */

import { RecordId, type Surreal } from 'surrealdb';
import type { AppConfigOverlay } from '$lib/config/types';

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

	// version is required by contract; default to 1 if present-ish overlay fields exist
	const version = row.version;
	const hasOverlayShape =
		version === 1 ||
		version === '1' ||
		row.entities != null ||
		row.edges != null ||
		row.map != null ||
		row.search != null ||
		row.excludeTables != null;

	if (!hasOverlayShape) return null;

	const overlay: AppConfigOverlay = { version: 1 };

	if (Array.isArray(row.excludeTables)) {
		overlay.excludeTables = row.excludeTables.filter((t): t is string => typeof t === 'string');
	}

	if (isPlainObject(row.entities)) {
		overlay.entities = row.entities as AppConfigOverlay['entities'];
	}

	if (isPlainObject(row.edges)) {
		overlay.edges = row.edges as AppConfigOverlay['edges'];
	}

	if (isPlainObject(row.graph)) {
		overlay.graph = row.graph as AppConfigOverlay['graph'];
	}

	if (isPlainObject(row.map)) {
		overlay.map = row.map as AppConfigOverlay['map'];
	}

	if (isPlainObject(row.search)) {
		overlay.search = row.search as AppConfigOverlay['search'];
	}

	return overlay;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
