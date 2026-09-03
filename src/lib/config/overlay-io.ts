/**
 * Soft I/O helpers for AppConfigOverlay.
 *
 * Shape is intentionally loose while the overlay contract is still evolving:
 * - Require / default `version: 1`
 * - Keep known top-level buckets when they are plain objects / arrays
 * - Do **not** deep-reject unknown nested keys (pass-through for future fields)
 * - Soft-fail only on non-JSON / non-object roots
 *
 * Types in `types.ts` stay the documented contract; this module is the runtime gate.
 */

import type {
	AppConfigOverlay,
	EdgeOverlay,
	EntityOverlay,
	GraphOverlay,
	MapOverlay,
	SearchOverlay
} from './types';

export const OVERLAY_DOC_ID = 'app_config:main';

export type OverlayParseResult =
	| { ok: true; overlay: AppConfigOverlay }
	| { ok: false; message: string };

/** Empty starter document for a missing overlay row. */
export function emptyOverlay(): AppConfigOverlay {
	return { version: 1 };
}

/** Deep clone suitable for editor local state. */
export function cloneOverlay(overlay: AppConfigOverlay): AppConfigOverlay {
	return structuredClone(overlay);
}

/** Stable pretty JSON for the editor / form payload. */
export function stringifyOverlay(overlay: AppConfigOverlay): string {
	return `${JSON.stringify(overlay, null, 2)}\n`;
}

/**
 * Parse JSON text into a soft-validated overlay.
 * Unknown nested keys inside entities/edges/… are preserved.
 */
export function parseOverlayJson(text: string): OverlayParseResult {
	const trimmed = text.trim();
	if (!trimmed) {
		return { ok: false, message: 'Overlay JSON is empty' };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(trimmed);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid JSON';
		return { ok: false, message: `Invalid JSON: ${message}` };
	}

	return softParseOverlay(raw);
}

/**
 * Soft-parse an unknown value (form payload, DB row, JSON) into AppConfigOverlay.
 * Strips Surreal `id` and non-plain values at the root; keeps nested unknowns.
 */
export function softParseOverlay(raw: unknown): OverlayParseResult {
	if (raw == null) {
		return { ok: false, message: 'Overlay is empty' };
	}

	if (typeof raw === 'string') {
		return parseOverlayJson(raw);
	}

	if (Array.isArray(raw)) {
		if (raw.length === 0) return { ok: false, message: 'Overlay array is empty' };
		return softParseOverlay(raw[0]);
	}

	if (!isPlainObject(raw)) {
		return { ok: false, message: 'Overlay must be a JSON object' };
	}

	const versionRaw = raw.version;
	if (versionRaw != null && versionRaw !== 1 && versionRaw !== '1') {
		return { ok: false, message: `Unsupported overlay version: ${String(versionRaw)}` };
	}

	const overlay: AppConfigOverlay = { version: 1 };

	if (raw.excludeTables != null) {
		if (!Array.isArray(raw.excludeTables)) {
			return { ok: false, message: 'excludeTables must be an array of strings' };
		}
		overlay.excludeTables = raw.excludeTables.filter((t): t is string => typeof t === 'string');
	}

	if (raw.entities != null) {
		if (!isPlainObject(raw.entities)) {
			return { ok: false, message: 'entities must be an object keyed by table name' };
		}
		// Pass through nested shape — entity fields still evolving.
		overlay.entities = raw.entities as Record<string, EntityOverlay>;
	}

	if (raw.edges != null) {
		if (!isPlainObject(raw.edges)) {
			return { ok: false, message: 'edges must be an object keyed by relation table' };
		}
		overlay.edges = raw.edges as Record<string, EdgeOverlay>;
	}

	if (raw.graph != null) {
		if (!isPlainObject(raw.graph)) {
			return { ok: false, message: 'graph must be an object' };
		}
		overlay.graph = raw.graph as GraphOverlay;
	}

	if (raw.map != null) {
		if (!isPlainObject(raw.map)) {
			return { ok: false, message: 'map must be an object' };
		}
		overlay.map = raw.map as MapOverlay;
	}

	if (raw.search != null) {
		if (!isPlainObject(raw.search)) {
			return { ok: false, message: 'search must be an object' };
		}
		overlay.search = raw.search as SearchOverlay;
	}

	// Forward-compat: keep unknown top-level keys (except Surreal id).
		const loose = overlay as AppConfigOverlay & Record<string, unknown>;
		for (const [key, value] of Object.entries(raw)) {
			if (key === 'id' || key === 'version' || key in overlay) continue;
			loose[key] = value;
		}

		return { ok: true, overlay };
	}

/** Comma / newline separated list → unique non-empty strings. */
export function parseStringList(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of text.split(/[\n,]/)) {
		const value = part.trim();
		if (!value || seen.has(value)) continue;
		seen.add(value);
		out.push(value);
	}
	return out;
}

export function formatStringList(values: string[] | undefined): string {
	return (values ?? []).join(', ');
}

/**
 * Parse sort text used in the entity table form.
 * - blank → undefined
 * - `field` or `field asc|desc`
 * - multi-line → multi-key
 * - JSON array/object passthrough when it starts with `[` or `{`
 */
export function parseSortText(text: string): EntityOverlay['table'] extends infer T
	? T extends { sort?: infer S }
		? S | undefined
		: undefined
	: undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;

	if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
		try {
			return JSON.parse(trimmed) as never;
		} catch {
			// fall through to line parser
		}
	}

	const keys = trimmed
		.split(/[\n,]/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const parts = line.split(/\s+/);
			const field = parts[0]!;
			const dirRaw = (parts[1] ?? 'asc').toLowerCase();
			const dir = dirRaw === 'desc' ? 'desc' : 'asc';
			return dir === 'asc' ? field : { field, dir: 'desc' as const };
		});

	if (keys.length === 0) return undefined;
	if (keys.length === 1) return keys[0] as never;
	return keys as never;
}

export function formatSortText(sort: unknown): string {
	if (sort == null) return '';
	if (typeof sort === 'string') return sort;
	if (Array.isArray(sort)) {
		return sort
			.map((entry) => {
				if (typeof entry === 'string') return entry;
				if (isPlainObject(entry) && typeof entry.field === 'string') {
					const dir = entry.dir === 'desc' ? ' desc' : '';
					return `${entry.field}${dir}`;
				}
				return '';
			})
			.filter(Boolean)
			.join('\n');
	}
	if (isPlainObject(sort) && typeof sort.field === 'string') {
		const dir = sort.dir === 'desc' ? ' desc' : '';
		return `${sort.field}${dir}`;
	}
	try {
		return JSON.stringify(sort);
	} catch {
		return '';
	}
}

/** Display overlay as single field path or multi-line paths. */
export function formatDisplayText(display: EntityOverlay['display'] | undefined): string {
	if (!display) return '';
	if (display.field) return display.field;
	if (display.parts?.length) {
		return display.parts.map((p) => p.path).join('\n');
	}
	return '';
}

/** One path → field; multiple paths → parts. Optional sep (keep spaces). */
export function parseDisplayText(
	text: string,
	sep?: string
): EntityOverlay['display'] | undefined {
	const paths = text
		.split(/[\n,]/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (paths.length === 0) return undefined;
	// Keep separator whitespace (e.g. ' · '); only drop when unset/empty string.
	const sepOut = sep === undefined || sep === '' ? undefined : sep;
	if (paths.length === 1) {
		const out: NonNullable<EntityOverlay['display']> = { field: paths[0] };
		if (sepOut !== undefined) out.sep = sepOut;
		return out;
	}
	const out: NonNullable<EntityOverlay['display']> = {
		parts: paths.map((path) => ({ path }))
	};
	if (sepOut !== undefined) out.sep = sepOut;
	return out;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Sorted entity / edge keys for stable list UIs. */
export function sortedKeys(record: Record<string, unknown> | undefined): string[] {
	return Object.keys(record ?? {}).sort((a, b) => a.localeCompare(b));
}
