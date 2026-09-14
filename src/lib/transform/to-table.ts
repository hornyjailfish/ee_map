/**
 * Pure transform: ResolvedEntity + Surreal rows → SVAR Grid columns/data.
 * No DB, no Svelte — serializable view model only.
 */

import type {
	ResolvedConfig,
	ResolvedEntity,
	ResolvedField,
	ResolvedTableSortKey,
	TablePermissions
} from '$lib/config';
import { sortRowsByKeys } from './compare';
import type { RecordLabelIndex, RecordStore } from './record-label';

export type TableColumn = {
	id: string;
	header: string;
	width?: number;
	/** Enable header sort (natural compare is applied client-side). */
	sort?: boolean;
	readOnly?: boolean;
	editor?: false | string;
	/** Present when the column is a record link (future editors / styling). */
	valueType?: string;
	recordTargets?: string[];
	/** False when the field is required (drives add-row form validation). */
	optional?: boolean;
};

export type TableRow = Record<string, unknown> & { id: string };

export type TableViewModel = {
	table: string;
	label: string;
	columns: TableColumn[];
	/** Row objects keyed by field name; always include string `id` for selection. */
	data: TableRow[];
	/** Default sort keys from entity config (applied to `data`; client shows marks). */
	sort?: ResolvedTableSortKey[];
	/** Live write capabilities from STRUCTURE — drives add/edit/delete controls. */
	permissions: TablePermissions;
};

export type ToTableOptions = {
	/**
	 * Precomputed id → label. Kept for callers/tests; cell values store record ids
	 * so inline editors can patch. Labels are applied via column.options on the client.
	 */
	labels?: RecordLabelIndex;
	/** Related rows (optional; unused for cell mapping, retained for API stability). */
	store?: RecordStore;
	/** Full config (optional; unused for cell mapping, retained for API stability). */
	config?: ResolvedConfig;
};

/** Build columns from resolved entity (skip hidden fields). */
export function buildColumns(entity: ResolvedEntity): TableColumn[] {
	const visible = entity.fields.filter((f) => !f.hidden);
	const ordered = orderColumns(visible);

	return ordered.map((field) => {
		const col: TableColumn = {
			id: field.name,
			header: field.label,
			sort: true,
			optional: field.optional
		};
		if (field.width !== undefined) col.width = field.width;
		if (field.readOnly) col.readOnly = true;
		if (field.editor !== undefined) col.editor = field.editor;
		if (field.recordTargets?.length) {
			col.valueType = 'record';
			col.recordTargets = field.recordTargets;
		} else if (field.type) {
			col.valueType = field.type;
		}
		return col;
	});
}

/**
 * Prefer identity (`id`) first when present; otherwise keep entity.fields order.
 */
function orderColumns(fields: ResolvedField[]): ResolvedField[] {
	const idIndex = fields.findIndex((f) => f.name === 'id');
	if (idIndex <= 0) return fields;

	const next = fields.slice();
	const [idField] = next.splice(idIndex, 1);
	if (idField) next.unshift(idField);
	return next;
}

/**
 * Map raw Surreal rows into grid data.
 * - Normalize record ids to string
 * - Include only non-hidden fields (+ id)
 * - Coerce values for display; record FKs use label index when provided
 * Does not mutate input rows.
 */
export function toTable(
	entity: ResolvedEntity,
	rows: ReadonlyArray<Record<string, unknown>>,
	opts?: ToTableOptions
): TableViewModel {
	const columns = buildColumns(entity);
	const visibleFields = entity.fields.filter((f) => !f.hidden);
	const fieldByName = new Map(visibleFields.map((f) => [f.name, f]));

	const mapped = rows.map((row) => mapRow(row, fieldByName, opts));
	// Only keys that still appear as columns (hidden fields dropped)
	const visibleIds = new Set(columns.map((c) => c.id));
	const sort = entity.sort?.filter((k) => visibleIds.has(k.field));
	const data = sort?.length ? sortRowsByKeys(mapped, sort) : mapped;

	const view: TableViewModel = {
		table: entity.name,
		label: entity.label,
		columns,
		data,
		permissions: entity.permissions
	};
	if (sort?.length) view.sort = sort;
	return view;
}

function mapRow(
	row: Record<string, unknown>,
	fieldByName: Map<string, ResolvedField>,
	opts?: ToTableOptions
): TableRow {
	const out: TableRow = {
		id: normalizeRecordId(row.id)
	};

	for (const [name, field] of fieldByName) {
		if (name === 'id') {
			// Already set as string identity; keep the same normalized string.
			continue;
		}
		const raw = row[name];
		if (isRecordLinkField(field)) {
			// Keep record ids as cell values so inline combo/richselect editors can
			// round-trip patches. Display labels come from column.options on the client.
			out[name] = recordCellId(raw);
		} else {
			out[name] = displayValue(raw);
		}
	}

	return out;
}

function isRecordLinkField(field: ResolvedField): boolean {
	if (field.recordTargets && field.recordTargets.length > 0) return true;
	const t = field.type.toLowerCase();
	return t === 'record' || t.startsWith('record<') || t.startsWith('record ');
}

/**
 * Normalize a record-link cell to a `table:id` string (or joined list for multi-links).
 * null/empty → null so optional FKs clear cleanly in editors.
 */
function recordCellId(value: unknown): string | null {
	if (value == null) return null;
	if (Array.isArray(value)) {
		const ids = value.map((item) => normalizeRecordId(item)).filter((id) => id !== '');
		return ids.length ? ids.join(', ') : null;
	}
	const id = normalizeRecordId(value);
	return id || null;
}

/** Pick entity by table name from ResolvedConfig. */
export function entityByName(config: ResolvedConfig, table: string): ResolvedEntity | undefined {
	return config.tables.find((t) => t.name === table);
}

/**
 * Normalize Surreal record ids to `table:id` strings.
 * Accepts string | RecordId-like (`toString`) | `{ tb, id }`.
 */
export function normalizeRecordId(value: unknown): string {
	if (value == null) return '';

	if (typeof value === 'string') return value;

	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;

		if (typeof (value as { toString?: unknown }).toString === 'function') {
			const tag = Object.prototype.toString.call(value);
			// Prefer custom toString (RecordId) over Object.prototype
			if ((value as { toString: () => string }).toString !== Object.prototype.toString) {
				const s = (value as { toString: () => string }).toString();
				if (s && s !== tag && s !== '[object Object]') return s;
			}
		}

		if (hasOwnRecordShape(obj)) {
			const tb = String(obj.tb);
			const idPart = formatIdPart(obj.id);
			return `${tb}:${idPart}`;
		}
	}

	return String(value);
}

function hasOwnRecordShape(obj: Record<string, unknown>): boolean {
	return typeof obj.tb === 'string' && 'id' in obj;
}

function formatIdPart(id: unknown): string {
	if (id == null) return '';
	if (typeof id === 'string' || typeof id === 'number' || typeof id === 'bigint') {
		return String(id);
	}
	if (typeof id === 'object' && typeof (id as { toString?: unknown }).toString === 'function') {
		const s = (id as { toString: () => string }).toString();
		if (s && s !== '[object Object]') return s;
	}
	return String(id);
}

/**
 * Coerce a cell value for grid display.
 * null/undefined → null; records → string; geometry → compact label.
 */
export function displayValue(value: unknown): unknown {
	if (value == null) return null;

	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value;
	}

	if (typeof value === 'bigint') return value.toString();

	if (Array.isArray(value)) {
		return value
			.map((item) => displayValue(item))
			.map(stringifyJoinedPart)
			.join(', ');
	}

	if (typeof value === 'object') {
		if (isRecordIdLike(value)) return normalizeRecordId(value);
		if (isGeometryLike(value)) return geometryLabel(value as Record<string, unknown>);

		// Plain objects: keep short JSON so the grid stays readable
		try {
			const json = JSON.stringify(value);
			if (json.length > 80) return json.slice(0, 77) + '...';
			return json;
		} catch {
			return String(value);
		}
	}

	return String(value);
}

function stringifyJoinedPart(v: unknown): string {
	if (v == null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

function isRecordIdLike(value: object): boolean {
	const obj = value as Record<string, unknown>;
	if (hasOwnRecordShape(obj)) return true;

	// surrealdb RecordId instances expose tb/id and a meaningful toString()
	if ('tb' in obj && 'id' in obj) return true;

	const proto = Object.getPrototypeOf(value);
	if (
		proto &&
		proto !== Object.prototype &&
		typeof (value as { toString?: unknown }).toString === 'function' &&
		(value as { toString: () => string }).toString !== Object.prototype.toString
	) {
		const s = (value as { toString: () => string }).toString();
		// Record ids look like `table:key`
		if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(s)) return true;
	}

	return false;
}

function isGeometryLike(value: object): boolean {
	const obj = value as Record<string, unknown>;
	if (typeof obj.type !== 'string') return false;

	const t = obj.type.toLowerCase();
	const geoTypes = new Set([
		'point',
		'line',
		'linestring',
		'polygon',
		'multipoint',
		'multilinestring',
		'multipolygon',
		'geometrycollection',
		'collection',
		'feature',
		'featurecollection'
	]);

	if (!geoTypes.has(t)) return false;

	// GeoJSON / Surreal geometry usually has coordinates or geometries
	return 'coordinates' in obj || 'geometries' in obj || 'geometry' in obj;
}

function geometryLabel(value: Record<string, unknown>): string {
	const rawType = String(value.type);
	const kind = rawType.toLowerCase();

	// Prefer short kind labels for the grid
	if (kind === 'linestring') return 'line';
	if (kind === 'geometrycollection' || kind === 'collection') return 'collection';
	if (kind === 'featurecollection') return 'featurecollection';

	return kind;
}
