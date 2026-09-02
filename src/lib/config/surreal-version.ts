/**
 * Parse Surreal `session.version()` payloads into SurrealEngineVersion.
 * Pure — used by introspect and available to kind parsers for dialect checks.
 */

import type { SurrealEngineVersion } from './types';

/**
 * Normalize SDK version return values:
 * - `{ version: "surrealdb-3.2.4+…" }`
 * - bare `"3.2.4"` / `"surrealdb-3.2.4+…"`
 */
export function parseSurrealVersion(raw: unknown): SurrealEngineVersion | undefined {
	const text = extractVersionText(raw);
	if (!text) return undefined;

	const semver = text.match(/(\d+)\.(\d+)\.(\d+)/);
	if (!semver) {
		return { raw: text, major: null, minor: null, patch: null };
	}

	return {
		raw: text,
		major: Number(semver[1]),
		minor: Number(semver[2]),
		patch: Number(semver[3])
	};
}

function extractVersionText(raw: unknown): string | undefined {
	if (typeof raw === 'string' && raw.trim()) return raw.trim();
	if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
		const v = (raw as Record<string, unknown>).version;
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return undefined;
}

/** True when engine is at least major.minor.patch (unknown engine → false). */
export function engineAtLeast(
	engine: SurrealEngineVersion | undefined | null,
	major: number,
	minor = 0,
	patch = 0
): boolean {
	if (!engine || engine.major == null || engine.minor == null || engine.patch == null) {
		return false;
	}
	if (engine.major !== major) return engine.major > major;
	if (engine.minor !== minor) return engine.minor > minor;
	return engine.patch >= patch;
}
