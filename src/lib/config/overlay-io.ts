/**
 * Soft I/O helpers for AppConfigOverlay.
 *
 * Shape is intentionally loose while the overlay contract moves v1 → v2 (N13):
 * - Accept both v1 (nested `entities.*.graph/map`, top-level `edges`) and v2
 *   (`graph.nodes`, `map.layers`, `graph.edges`), lifting v1 → v2 on read
 * - `version: 2` is the written contract; v1 input is migrated transparently
 * - Keep known top-level buckets when they are plain objects / arrays
 * - Do **not** deep-reject unknown nested keys (pass-through for future fields)
 * - Soft-fail only on non-JSON / non-object roots
 */

import { z } from 'zod';
import type { AppConfigOverlay, EntityOverlay } from './types';

export const OVERLAY_DOC_ID = 'app_config:main';

/** Current written overlay contract version. */
export const OVERLAY_VERSION = 2 as const;

const sortKeySchema = z.object({ field: z.string(), dir: z.enum(['asc', 'desc']).optional() });
const sortSchema = z.union([
	z.string(),
	sortKeySchema,
	z.array(z.union([z.string(), sortKeySchema]))
]);

/** Drop non-string entries while keeping the array contract. */
const stringListSchema = z
	.array(z.unknown())
	.transform((list) => list.filter((value): value is string => typeof value === 'string'));

const BUCKET_KEYS = ['entities', 'edges', 'graph', 'map', 'search'] as const;
const BUCKET_MESSAGES: Record<(typeof BUCKET_KEYS)[number], string> = {
	entities: 'entities must be an object keyed by table name',
	edges: 'edges must be an object keyed by relation table',
	graph: 'graph must be an object',
	map: 'map must be an object',
	search: 'search must be an object'
};

/**
 * Single source of truth for the overlay root. Unknown keys pass through;
 * `id` (Surreal) and `version` are normalized away, and known buckets keep
 * their existing nested shape (still evolving).
 */
const overlaySchema = z
	.object({
		version: z.union([z.literal(1), z.literal(2), z.literal('1'), z.literal('2')]).optional(),
		excludeTables: stringListSchema.optional(),
		entities: z.record(z.string(), z.unknown()).optional(),
		edges: z.record(z.string(), z.unknown()).optional(),
		graph: z.record(z.string(), z.unknown()).optional(),
		map: z.record(z.string(), z.unknown()).optional(),
		search: z.record(z.string(), z.unknown()).optional()
	})
	.passthrough()
	.transform(({ id: _id, version: _version, ...rest }) => rest);

export type OverlayParseResult =
	{ ok: true; overlay: AppConfigOverlay } | { ok: false; message: string };

/** Empty starter document for a missing overlay row. */
export function emptyOverlay(): AppConfigOverlay {
	return { version: OVERLAY_VERSION };
}

/** Deep clone suitable for editor local state. Never returns null/undefined. */
export function cloneOverlay(overlay: AppConfigOverlay | null | undefined): AppConfigOverlay {
	if (overlay == null || typeof overlay !== 'object') return emptyOverlay();
	try {
		return structuredClone(overlay);
	} catch {
		return emptyOverlay();
	}
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
 * Strips Surreal `id`; keeps unknown top-level and nested keys.
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

	if (typeof raw !== 'object') {
		return { ok: false, message: 'Overlay must be a JSON object' };
	}

	const parsed = overlaySchema.safeParse(compactOverlay(raw as Record<string, unknown>));
	if (!parsed.success) {
		return {
			ok: false,
			message: overlayErrorMessage(raw as Record<string, unknown>, parsed.error)
		};
	}

	// Migrate v1 → v2 transparently: nested entities.*.graph/map + top-level edges
	// become graph.nodes / map.layers / graph.edges; version normalizes to 2.
	return { ok: true, overlay: liftOverlayV1toV2(parsed.data as Record<string, unknown>) };
}

/**
 * Pure v1 → v2 overlay migration (idempotent for already-v2 overlays).
 * - `entities[t].graph` → `graph.nodes[t]` (drops `role: 'ignore'`)
 * - `entities[t].map` (enabled) → `map.layers[t]` (drops `enabled`, presence = active)
 * - top-level `edges` → `graph.edges`
 * - strips nested `graph` / `map` from entities; version → 2
 */
export function liftOverlayV1toV2(raw: Record<string, unknown>): AppConfigOverlay {
	// Spread first so unknown top-level keys (and unknown nested entity keys) pass through.
	const overlay: Record<string, unknown> = { ...raw };
	overlay.version = OVERLAY_VERSION;
	delete overlay.id;

	const graphRaw = isPlainObject(raw.graph) ? raw.graph : {};
	const mapRaw = isPlainObject(raw.map) ? raw.map : {};

	// Seed v2 indexes from v2 locations first, so the lift is idempotent.
	const nodes: Record<string, unknown> = isPlainObject(graphRaw.nodes) ? { ...graphRaw.nodes } : {};
	const edges: Record<string, unknown> = isPlainObject(graphRaw.edges) ? { ...graphRaw.edges } : {};
	const layers: Record<string, unknown> = isPlainObject(mapRaw.layers) ? { ...mapRaw.layers } : {};

	// v1: top-level edges → graph.edges
	if (isPlainObject(raw.edges)) Object.assign(edges, raw.edges);
	delete overlay.edges;

	// v1: entities.*.graph / map lifted out; entities slim down.
	if (isPlainObject(raw.entities)) {
		const entities: Record<string, unknown> = {};
		for (const [table, entryRaw] of Object.entries(raw.entities)) {
			if (!isPlainObject(entryRaw)) {
				entities[table] = entryRaw;
				continue;
			}
			const entry: Record<string, unknown> = { ...entryRaw };

			if (isPlainObject(entry.graph)) {
				const g = entry.graph as Record<string, unknown>;
				if (g.role !== 'ignore' && typeof g.role === 'string') {
					nodes[table] = { ...g };
				}
			}

			if (isPlainObject(entry.map)) {
				const m = entry.map as Record<string, unknown>;
				if (m.enabled === true) {
					const { enabled: _enabled, ...layer } = m;
					layers[table] = layer;
				}
			}

			delete entry.graph;
			delete entry.map;
			entities[table] = entry;
		}
		overlay.entities = entities as AppConfigOverlay['entities'];
	}

	const graph: Record<string, unknown> = {};
	if (isPlainObject(graphRaw.layout)) graph.layout = graphRaw.layout;
	if (Object.keys(nodes).length > 0) graph.nodes = nodes;
	if (Object.keys(edges).length > 0) graph.edges = edges;
	if (Object.keys(graph).length > 0) overlay.graph = graph;
	else delete overlay.graph;

	if (isPlainObject(raw.map)) {
		const mapOut: Record<string, unknown> = { ...mapRaw };
		delete mapOut.layers;
		if (Object.keys(layers).length > 0) mapOut.layers = layers;
		if (Object.keys(mapOut).length > 0) overlay.map = mapOut;
		else delete overlay.map;
	} else if (Object.keys(layers).length > 0) {
		overlay.map = { layers };
	}

	if (!isPlainObject(raw.search)) delete overlay.search;

	return overlay as AppConfigOverlay;
}

/**
 * Inverse of {@link liftOverlayV1toV2} for the OWNER editor (transitional bridge).
 * The editor still edits the nested v1 shape (`entities.*.graph/map`, top-level
 * `edges`); its output is lifted back to v2 on save. Purely structural — unknown
 * keys and `layoutOptions` pass through so nothing is lost on a round-trip.
 */
export function overlayV2toV1(raw: AppConfigOverlay): AppConfigOverlay {
	const overlay: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
	overlay.version = 1;

	const entities: Record<string, unknown> = isPlainObject(raw.entities)
		? { ...(raw.entities as Record<string, unknown>) }
		: {};

	const nodes = isPlainObject(raw.graph?.nodes) ? raw.graph.nodes : {};
	for (const [table, nodeRaw] of Object.entries(nodes)) {
		const entry: Record<string, unknown> = isPlainObject(entities[table])
			? (entities[table] as Record<string, unknown>)
			: {};
		entry.graph = { ...(nodeRaw as Record<string, unknown>) };
		entities[table] = entry;
	}

	const layers = isPlainObject(raw.map?.layers) ? raw.map.layers : {};
	for (const [table, layerRaw] of Object.entries(layers)) {
		const entry: Record<string, unknown> = isPlainObject(entities[table])
			? (entities[table] as Record<string, unknown>)
			: {};
		entry.map = { enabled: true, ...(layerRaw as Record<string, unknown>) };
		entities[table] = entry;
	}
	if (Object.keys(entities).length > 0) overlay.entities = entities as AppConfigOverlay['entities'];

	if (isPlainObject(raw.graph?.layout)) {
		overlay.graph = { layout: raw.graph.layout as Record<string, unknown> };
	} else {
		delete overlay.graph;
	}

	if (isPlainObject(raw.graph?.edges)) {
		overlay.edges = raw.graph.edges as AppConfigOverlay['edges'];
	} else {
		delete overlay.edges;
	}

	if (isPlainObject(raw.map)) {
		const mapOut: Record<string, unknown> = { ...raw.map };
		delete mapOut.layers;
		overlay.map = mapOut;
	}

	return overlay as AppConfigOverlay;
}

/** Drop nullish known keys so `.optional()` stays strict but lenient. */
function compactOverlay(raw: Record<string, unknown>): Record<string, unknown> {
	const known = new Set<string>(['version', 'excludeTables', ...BUCKET_KEYS]);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (value == null && known.has(key)) continue;
		out[key] = value;
	}
	return out;
}

function overlayErrorMessage(raw: Record<string, unknown>, error: z.ZodError): string {
	const path = error.issues[0]?.path[0];
	if (path === 'version') {
		return `Unsupported overlay version: ${String(raw.version)}`;
	}
	if (path === 'excludeTables') {
		return 'excludeTables must be an array of strings';
	}
	if (typeof path === 'string' && path in BUCKET_MESSAGES) {
		return BUCKET_MESSAGES[path as keyof typeof BUCKET_MESSAGES];
	}
	return 'Invalid overlay';
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

type SortInput = NonNullable<NonNullable<EntityOverlay['table']>['sort']>;

/**
 * Parse sort text used in the entity table form.
 * - blank → undefined
 * - `field` or `field asc|desc`
 * - multi-line → multi-key
 * - JSON array/object passthrough when it starts with `[` or `{`
 */
export function parseSortText(text: string): SortInput | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;

	if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
		try {
			return sortSchema.parse(JSON.parse(trimmed)) as SortInput;
		} catch {
			// fall through to line parser
		}
	}

	const keys = trimmed
		.split(/[\n,]/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [field, dirRaw] = line.split(/\s+/);
			const dir = dirRaw?.toLowerCase() === 'desc' ? 'desc' : 'asc';
			return dir === 'asc' ? field! : { field: field!, dir: 'desc' as const };
		});

	if (keys.length === 0) return undefined;
	if (keys.length === 1) return keys[0] as SortInput;
	return keys as SortInput;
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
export function parseDisplayText(text: string, sep?: string): EntityOverlay['display'] | undefined {
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
