/**
 * Pure record-label formatting for table FK cells (and future pickers).
 * Walks config display paths against an in-memory record store.
 * No I/O.
 */

import type {
	ResolvedConfig,
	ResolvedEntity,
	ResolvedEntityDisplay,
	ResolvedField
} from '$lib/config/types';
import type { SelectOption } from '$lib/option-types';
import { normalizeRecordId } from './to-table';

/** id (`table:key`) → plain row object (may still contain RecordId-like values). */
export type RecordStore = ReadonlyMap<string, Record<string, unknown>>;

/** id → final display string for grid cells. */
export type RecordLabelIndex = ReadonlyMap<string, string>;

const DEFAULT_SEP = ' · ';

/**
 * Format one record id using a display recipe and related rows in the store.
 * Missing hops / empty parts fall back toward the id string.
 */
	export function formatRecordLabel(
		id: string,
		display: ResolvedEntityDisplay | undefined,
		store: RecordStore
	): string {
		return formatRecordOption(id, display, store).label;
	}

	/**
	 * Build a picker option from a display recipe.
	 *
	 * - `label` — full joined text for grid cells / optionsMap
	 * - multi-part recipes (2+ paths) with a resolved first path also set:
	 *   - `group` = first path text
	 *   - `itemLabel` = remaining paths (combo list text, no group echo)
	 */
	export function formatRecordOption(
		id: string,
		display: ResolvedEntityDisplay | undefined,
		store: RecordStore
	): SelectOption {
		if (!id) return { id: '', label: '' };
		if (!display || display.parts.length === 0) return { id, label: id };

		const sep = display.sep ?? DEFAULT_SEP;
		const texts = display.parts.map((part) => resolvePathText(id, part.path, store));
		const present = texts.map((t) => (t != null && t !== '' ? t : null));
		const labelChunks = present.filter((t): t is string => t != null);
		const label = labelChunks.length > 0 ? labelChunks.join(sep) : id;

		if (display.parts.length < 2) return { id, label };

		// First path → group heading; rest → list item (avoids "Room / Room · Board").
		const group = present[0];
		if (group == null) return { id, label };

		const rest = present.slice(1).filter((t): t is string => t != null);
		if (rest.length === 0) return { id, label };

		return { id, label, group, itemLabel: rest.join(sep) };
	}

/**
 * Resolve display recipe for a FK field: column override → target entity.display.
 * When the id's table is known and listed in recordTargets (or alone), use that entity.
 */
export function displayForRecordRef(
	field: ResolvedField,
	recordId: string,
	config: ResolvedConfig
): ResolvedEntityDisplay | undefined {
	if (field.display) return field.display;

	const table = tableOfId(recordId);
	if (table) {
		const entity = config.tables.find((t) => t.name === table);
		if (entity?.display) return entity.display;
	}

	const targets = field.recordTargets;
	if (targets && targets.length === 1) {
		const entity = config.tables.find((t) => t.name === targets[0]);
		if (entity?.display) return entity.display;
	}

	return undefined;
}

/** Build label index for every id present in `store` using entity display from config. */
export function buildLabelIndex(store: RecordStore, config: ResolvedConfig): RecordLabelIndex {
	const out = new Map<string, string>();
	const entityByName = new Map(config.tables.map((t) => [t.name, t]));

	for (const [id, row] of store) {
		const table = tableOfId(id) ?? inferTableFromRow(row);
		const entity = table ? entityByName.get(table) : undefined;
		out.set(id, formatRecordLabel(id, entity?.display, store));
	}

	return out;
}

/**
 * Format a cell value that may be a record id, array of ids, or scalar.
 * Uses label index first; falls back to live format from store+config when needed.
 */
export function formatRecordCellValue(
	value: unknown,
	field: ResolvedField,
	opts: {
		labels?: RecordLabelIndex;
		store?: RecordStore;
		config?: ResolvedConfig;
	}
): unknown {
	if (value == null) return null;

	if (Array.isArray(value)) {
		return value
			.map((item) => formatOneRef(item, field, opts))
			.filter((s) => s !== '')
			.join(', ');
	}

	if (isRecordRefValue(value)) {
		return formatOneRef(value, field, opts);
	}

	return undefined; // signal: not a record — caller keeps displayValue
}

function formatOneRef(
	value: unknown,
	field: ResolvedField,
	opts: {
		labels?: RecordLabelIndex;
		store?: RecordStore;
		config?: ResolvedConfig;
	}
): string {
	const id = normalizeRecordId(value);
	if (!id) return '';

	const cached = opts.labels?.get(id);
	if (cached != null && cached !== '') return cached;

	if (opts.config && opts.store) {
		const display = displayForRecordRef(field, id, opts.config);
		return formatRecordLabel(id, display, opts.store);
	}

	return id;
}

function resolvePathText(rootId: string, path: string, store: RecordStore): string | null {
	const segments = path
		.split('.')
		.map((s) => s.trim())
		.filter(Boolean);
	if (segments.length === 0) return null;

	let currentId = rootId;
	let row = store.get(currentId);

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;
		const isLast = i === segments.length - 1;

		if (!row) return null;

		const raw = row[seg];
		if (raw == null) return null;

		if (isLast) {
			return scalarText(raw);
		}

		// Intermediate segment must be a record hop
		const nextId = normalizeRecordId(raw);
		if (!nextId) return null;
		currentId = nextId;
		row = store.get(currentId);
	}

	return null;
}

function scalarText(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (typeof value === 'bigint') return value.toString();
	// Record-like at leaf: use id string (unusual for display parts)
	if (typeof value === 'object' && isRecordRefValue(value)) {
		return normalizeRecordId(value) || null;
	}
	return null;
}

function isRecordRefValue(value: unknown): boolean {
	if (value == null) return false;
	if (typeof value === 'string') {
		return /^[A-Za-z_][A-Za-z0-9_]*:/.test(value);
	}
	if (typeof value !== 'object') return false;
	const obj = value as Record<string, unknown>;
	if (typeof obj.tb === 'string' && 'id' in obj) return true;
	if ('tb' in obj && 'id' in obj) return true;
	const proto = Object.getPrototypeOf(value);
	if (
		proto &&
		proto !== Object.prototype &&
		typeof (value as { toString?: unknown }).toString === 'function' &&
		(value as { toString: () => string }).toString !== Object.prototype.toString
	) {
		const s = (value as { toString: () => string }).toString();
		return /^[A-Za-z_][A-Za-z0-9_]*:/.test(s);
	}
	return false;
}

export function tableOfId(id: string): string | null {
	const colon = id.indexOf(':');
	if (colon <= 0) return null;
	const table = id.slice(0, colon).trim();
	return table.length > 0 ? table : null;
}

function inferTableFromRow(row: Record<string, unknown>): string | null {
	const id = normalizeRecordId(row.id);
	return id ? tableOfId(id) : null;
}

/** Collect record-link field names on an entity that need label resolution. */
export function recordLinkFields(entity: ResolvedEntity): ResolvedField[] {
	return entity.fields.filter((f) => !f.hidden && isRecordFieldType(f));
}

function isRecordFieldType(field: ResolvedField): boolean {
	if (field.recordTargets && field.recordTargets.length > 0) return true;
	const t = field.type.toLowerCase();
	return t === 'record' || t.startsWith('record<') || t.startsWith('record ');
}

/**
 * Paths used by a display recipe, as segment arrays.
 * `name` → [['name']]; `room.name` → [['room','name']].
 */
export function displayPathSegments(display: ResolvedEntityDisplay | undefined): string[][] {
	if (!display) return [];
	return display.parts
		.map((p) =>
			p.path
				.split('.')
				.map((s) => s.trim())
				.filter(Boolean)
		)
		.filter((segs) => segs.length > 0);
}
