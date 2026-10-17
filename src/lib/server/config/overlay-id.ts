/**
 * Which `app_config:<id>` row is active for this request.
 *
 * Priority: explicit arg → `locals.appConfigId` (cookie) → `APP_CONFIG_ID` env → `main`.
 * Allows multiple overlay rows in one DB for testing without wiping `main`.
 */

import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import type { Surreal } from 'surrealdb';

export const OVERLAY_TABLE = 'app_config';
export const DEFAULT_OVERLAY_ID = 'main';

/** Max length for overlay record keys (Surreal id segment). */
const MAX_ID_LEN = 64;

/**
 * Keep only `[A-Za-z0-9_-]`. Empty / invalid → fallback.
 * No regex — intentional simple scanner.
 */
export function sanitizeOverlayId(
	raw: unknown,
	fallback: string = DEFAULT_OVERLAY_ID
): string {
	if (typeof raw !== 'string') return fallback;
	const trimmed = raw.trim();
	if (!trimmed) return fallback;

	let out = '';
	for (let i = 0; i < trimmed.length && out.length < MAX_ID_LEN; i++) {
		const ch = trimmed[i]!;
		const code = ch.charCodeAt(0);
		const ok =
			(code >= 48 && code <= 57) || // 0-9
			(code >= 65 && code <= 90) || // A-Z
			(code >= 97 && code <= 122) || // a-z
			ch === '_' ||
			ch === '-';
		if (ok) out += ch;
	}
	return out || fallback;
}

/** Default key from private env (server boot / no request). */
export function envDefaultOverlayId(): string {
	return sanitizeOverlayId(env.APP_CONFIG_ID, DEFAULT_OVERLAY_ID);
}

/**
 * Active overlay id for load/save/resolve.
 * Pass `explicit` from form actions when switching targets.
 */
export function resolveOverlayId(explicit?: string | null): string {
	if (explicit != null && String(explicit).trim() !== '') {
		return sanitizeOverlayId(explicit, envDefaultOverlayId());
	}
	try {
		const fromLocals = getRequestEvent().locals.appConfigId;
		if (fromLocals) return sanitizeOverlayId(fromLocals, envDefaultOverlayId());
	} catch {
		// Outside a request (scripts / unit tests).
	}
	return envDefaultOverlayId();
}

/** `app_config:foo` string for UPSERT / query params. */
export function overlayRecordString(id?: string | null): string {
	return `${OVERLAY_TABLE}:${resolveOverlayId(id)}`;
}

/** Extract bare key from Surreal record id forms. */
export function recordIdKey(id: unknown): string | null {
	if (id == null) return null;

	if (typeof id === 'string') {
		const colon = id.lastIndexOf(':');
		const key = colon >= 0 ? id.slice(colon + 1) : id;
		return sanitizeOverlayId(key, '');
	}

	if (typeof id === 'object') {
		const obj = id as { id?: unknown; tb?: unknown };
		if (obj.id != null && typeof obj.id !== 'object') {
			return sanitizeOverlayId(String(obj.id), '');
		}
		// Nested string after toString() sometimes "app_config:main"
		const asStr = String(id);
		if (asStr && asStr !== '[object Object]') {
			return recordIdKey(asStr);
		}
	}

	return null;
}

/**
 * List existing `app_config` record keys (sorted). Always includes active id
 * so the switcher can show a not-yet-saved target.
 */
export async function listOverlayIds(
	session: Surreal,
	options?: { ensure?: string | null }
): Promise<string[]> {
	const keys = new Set<string>();
	const ensure = options?.ensure ? sanitizeOverlayId(options.ensure, '') : '';
	if (ensure) keys.add(ensure);

	try {
		const result = await session.query<[{ id: unknown }[]]>('SELECT id FROM app_config');
		const rows = Array.isArray(result?.[0]) ? result[0] : [];
		for (const row of rows) {
			const key = recordIdKey(row?.id);
			if (key) keys.add(key);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn('[config/overlay-id] list failed:', message);
	}

	if (keys.size === 0) {
		keys.add(envDefaultOverlayId());
	}

	return [...keys].sort((a, b) => a.localeCompare(b));
}
