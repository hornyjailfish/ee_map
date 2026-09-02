/**
 * resolveAppConfig(session) — introspect + overlay + merge, with ns/db cache.
 *
 * AutoProfile (INFO STRUCTURE) is relatively expensive → cached by ns::db.
 * Overlay (`app_config:main`) is one SELECT and owns display recipes → always
 * re-read and re-merged so OWNER/seed edits to `entities.*.display` apply without
 * restarting the server or changing database selection.
 */

import type { Surreal } from 'surrealdb';
import { merge } from '$lib/config/merge';
import type { AppConfigOverlay, AutoProfile, ResolvedConfig } from '$lib/config/types';
import { introspect } from './introspect';
import { loadOverlay } from './load-overlay';

export type ResolveAppConfigOptions = {
	/** Skip cache read/write (tests / force refresh). */
	skipCache?: boolean;
	/**
	 * Override cache key. Defaults to `session.namespace` + `session.database`.
	 * Pass when the driver hasn't exposed ns/db yet.
	 */
	cacheKey?: string;
};

type AutoCacheEntry = {
	auto: AutoProfile;
	at: number;
};

/** Soft TTL for STRUCTURE introspect (ms). Overlay is always fresh. */
const AUTO_TTL_MS = 60_000;

const autoCache = new Map<string, AutoCacheEntry>();

function selectionKey(session: Surreal, override?: string): string {
	if (override) return override;
	const ns = session.namespace ?? '';
	const db = session.database ?? '';
	return `${ns}::${db}`;
}

/**
 * Build ResolvedConfig for the active session (user ns/db).
 *
 * Steps: INFO STRUCTURE → AutoProfile (cached), SELECT app_config:main → overlay
 * (always), merge.
 * Drop AutoProfile cache with `invalidateConfigCache` (e.g. selection change).
 */
export async function resolveAppConfig(
	session: Surreal,
	options: ResolveAppConfigOptions = {}
): Promise<ResolvedConfig> {
	const key = selectionKey(session, options.cacheKey);
	const auto = await loadAutoProfile(session, key, options.skipCache === true);
	const overlay = await loadOverlay(session);
	return merge(auto, overlay);
}

async function loadAutoProfile(
	session: Surreal,
	key: string,
	skipCache: boolean
): Promise<AutoProfile> {
	if (!skipCache) {
		const hit = autoCache.get(key);
		if (hit && Date.now() - hit.at < AUTO_TTL_MS) {
			return hit.auto;
		}
	}

	const auto = await introspect(session);

	if (!skipCache) {
		autoCache.set(key, { auto, at: Date.now() });
	}

	return auto;
}

/** Drop cached AutoProfile for one ns::db key, or all when omitted. */
export function invalidateConfigCache(nsDbKey?: string): void {
	if (nsDbKey === undefined) {
		autoCache.clear();
		return;
	}
	autoCache.delete(nsDbKey);
}

/** Test helper: current AutoProfile cache size. */
export function configCacheSize(): number {
	return autoCache.size;
}

/** Test helper: peek cached auto only (no I/O). */
export function peekCachedAuto(nsDbKey: string): AutoProfile | undefined {
	return autoCache.get(nsDbKey)?.auto;
}

/** @internal test aid — force-seed auto cache. */
export function __setAutoCacheForTests(nsDbKey: string, auto: AutoProfile): void {
	autoCache.set(nsDbKey, { auto, at: Date.now() });
}

/** Exported type alias for docs/tests. */
export type { AppConfigOverlay };
