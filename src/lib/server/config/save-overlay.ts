/**
 * Persist AppConfigOverlay as `app_config:main` (OWNER only).
 *
 * Shape stays soft: nested objects are written as plain JSON content.
 * Schema is SCHEMALESS for nested keys so seeds / editor can evolve together.
 */

import { RecordId, type Surreal } from 'surrealdb';
import type { AppConfigOverlay } from '$lib/config/types';
import { softParseOverlay } from '$lib/config/overlay-io';
import type { AppRole } from '$lib/catalog-types';
import { MutateError, assertCanOwn } from '$lib/server/data/mutate';
import { normalizeOverlay } from './load-overlay';

const OVERLAY_TABLE = 'app_config';
const OVERLAY_ID = 'main';

/**
 * Soft-validate + UPSERT `app_config:main`.
 * Returns the normalized overlay that merge will see.
 */
export async function saveOverlay(
	session: Surreal,
	roles: readonly AppRole[] | null | undefined,
	raw: unknown
): Promise<AppConfigOverlay> {
	assertCanOwn(roles);

	const parsed = softParseOverlay(raw);
	if (!parsed.ok) {
		throw new MutateError(400, 'invalid_overlay', parsed.message);
	}

	const content = toWritableContent(parsed.overlay);

	try {
		// String record id (same pattern as mutate.ts) so key types stay correct.
		await session.query('UPSERT type::record($record) CONTENT $content', {
			record: `${OVERLAY_TABLE}:${OVERLAY_ID}`,
			content
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new MutateError(400, 'db_error', `Failed to save app_config: ${message}`);
	}

	// Re-read via the same normalize path resolve uses.
	const row = await session.select<Record<string, unknown>>(
		new RecordId(OVERLAY_TABLE, OVERLAY_ID)
	);
	const normalized = normalizeOverlay(row) ?? parsed.overlay;
	return normalized;
}

/** Strip non-content fields before CONTENT write. */
function toWritableContent(overlay: AppConfigOverlay): Record<string, unknown> {
	const content: Record<string, unknown> = { ...overlay, version: 1 };
	delete content.id;
	return content;
}
