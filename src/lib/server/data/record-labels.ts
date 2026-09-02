/**
 * Load related rows needed to format record-link labels for a table view.
 * Pure planning + Surreal batch reads; formatting stays in $lib/transform/record-label.
 *
 * Multi-hop display (e.g. boards: `room.name` · `name`) loads each hop target by
 * walking entity.display parts — same recipe merge uses for every table's FKs.
 */

import { RecordId, Table, type Surreal } from 'surrealdb';
import type {
	ResolvedConfig,
	ResolvedEntity,
	ResolvedEntityDisplay,
	ResolvedField
} from '$lib/config/types';
import {
	buildLabelIndex,
	displayPathSegments,
	recordLinkFields,
	tableOfId,
	type RecordLabelIndex,
	type RecordStore
} from '$lib/transform/record-label';
import { normalizeRecordId } from '$lib/transform/to-table';
import { isValidTableName } from './query-entities';

export type RecordLabelLoadResult = {
	store: Map<string, Record<string, unknown>>;
	labels: RecordLabelIndex;
};

/**
 * From active-table rows + config, pull every related record needed for FK labels
 * (including multi-hop display paths like board → room → name).
 */
export async function loadRecordLabels(
	session: Surreal,
	config: ResolvedConfig,
	entity: ResolvedEntity,
	rows: ReadonlyArray<Record<string, unknown>>
): Promise<RecordLabelLoadResult> {
	const store = new Map<string, Record<string, unknown>>();
	const linkFields = recordLinkFields(entity);

	if (linkFields.length === 0 || rows.length === 0) {
		return { store, labels: buildLabelIndex(store, config) };
	}

	// Seed queue with direct FK ids on the active rows
	const pending = new Set<string>();
	for (const row of rows) {
		for (const field of linkFields) {
			collectIdsFromValue(row[field.name], pending);
		}
	}

	const entityByName = new Map(config.tables.map((t) => [t.name, t]));

	// BFS: load pending ids; enqueue hop targets from each loaded row's display recipe
	let guard = 0;
	while (pending.size > 0 && guard < 8) {
		guard += 1;
		const batch = [...pending];
		pending.clear();

		const byTable = new Map<string, Set<string>>();
		for (const id of batch) {
			if (store.has(id)) continue;
			const table = tableOfId(id);
			if (!table || !isValidTableName(table)) continue;
			let set = byTable.get(table);
			if (!set) {
				set = new Set();
				byTable.set(table, set);
			}
			set.add(id);
		}

		await Promise.all(
			[...byTable.entries()].map(async ([table, ids]) => {
				const fetched = await selectByIds(session, table, [...ids]);
				for (const row of fetched) {
					const id = normalizeRecordId(row.id) || '';
					if (!id) continue;
					// Always keep string-form FKs so path walking never depends on RecordId shape
					store.set(id, normalizeRowRefs(row));
				}
			})
		);

		// Enqueue hop targets required by display recipes of rows we just resolved
		for (const id of batch) {
			const row = store.get(id);
			if (!row) continue;
			const table = tableOfId(id);
			const targetEntity = table ? entityByName.get(table) : undefined;
			const display = resolveDisplayForStoredId(id, linkFields, targetEntity, config);
			enqueueDisplayHops(row, display, store, pending);
			// Safety net: any record-shaped field on the row may be needed by a path hop
			enqueueRecordFields(row, store, pending);
		}
	}

	const labels = buildLabelIndex(store, config);
	return { store, labels };
}

/**
 * Prefer column override (field.display) when the link field points at this table,
 * else the target entity's canonical display recipe.
 */
function resolveDisplayForStoredId(
	id: string,
	linkFields: ResolvedField[],
	targetEntity: ResolvedEntity | undefined,
	config: ResolvedConfig
): ResolvedEntityDisplay | undefined {
	const table = tableOfId(id);
	if (table) {
		for (const field of linkFields) {
			if (field.display && field.recordTargets?.includes(table)) {
				return field.display;
			}
		}
	}
	if (targetEntity?.display) return targetEntity.display;
	if (table) {
		return config.tables.find((t) => t.name === table)?.display;
	}
	return undefined;
}

function enqueueDisplayHops(
	row: Record<string, unknown>,
	display: ResolvedEntityDisplay | undefined,
	store: RecordStore,
	pending: Set<string>
): void {
	for (const segments of displayPathSegments(display)) {
		if (segments.length < 2) continue; // no hop
		let current: unknown = row;
		for (let i = 0; i < segments.length - 1; i++) {
			if (current == null || typeof current !== 'object') break;
			const seg = segments[i]!;
			const raw = (current as Record<string, unknown>)[seg];
			if (raw == null) break;
			const hopId = normalizeRecordId(raw);
			if (!hopId || !tableOfId(hopId)) break;
			if (!store.has(hopId)) pending.add(hopId);
			current = store.get(hopId);
			if (!current) break;
		}
	}
}

/** Enqueue every record-typed field value on a loaded row (covers hops not yet walked). */
function enqueueRecordFields(
	row: Record<string, unknown>,
	store: RecordStore,
	pending: Set<string>
): void {
	for (const [key, value] of Object.entries(row)) {
		if (key === 'id') continue;
		collectIdsFromValue(value, pending, store);
	}
}

function collectIdsFromValue(value: unknown, out: Set<string>, store?: RecordStore): void {
	if (value == null) return;
	if (Array.isArray(value)) {
		for (const item of value) collectIdsFromValue(item, out, store);
		return;
	}
	const id = normalizeRecordId(value);
	if (!id || !tableOfId(id)) return;
	if (store?.has(id)) return;
	out.add(id);
}

/** Normalize RecordId-like field values on a row to `table:key` strings. */
function normalizeRowRefs(row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...row };
	for (const [key, value] of Object.entries(row)) {
		if (key === 'id') {
			out.id = normalizeRecordId(value) || value;
			continue;
		}
		if (Array.isArray(value)) {
			out[key] = value.map((item) => {
				const id = normalizeRecordId(item);
				return id && tableOfId(id) ? id : item;
			});
			continue;
		}
		const id = normalizeRecordId(value);
		if (id && tableOfId(id) && (typeof value === 'object' || typeof value === 'string')) {
			// Only replace actual record refs, not plain strings that happen to match table:key pattern
			// when they aren't record-typed — string ids from Surreal are fine either way.
			if (typeof value === 'object' || looksLikeRecordIdString(value)) {
				out[key] = id;
			}
		}
	}
	return out;
}

function looksLikeRecordIdString(value: unknown): boolean {
	return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*:/.test(value);
}

/**
 * Fetch rows by record id list.
 * Surreal matches `id IN $ids` on RecordId values — plain `table:key` strings miss.
 */
async function selectByIds(
	session: Surreal,
	table: string,
	ids: string[]
): Promise<Record<string, unknown>[]> {
	if (ids.length === 0) return [];
	if (!isValidTableName(table)) return [];

	const recordIds = ids.map((id) => toRecordId(id, table)).filter((r): r is RecordId => r != null);

	if (recordIds.length > 0) {
		try {
			const result = await session.query<Record<string, unknown>[][]>(
				`SELECT * FROM type::table($table) WHERE id IN $ids`,
				{ table, ids: recordIds }
			);
			const rows = Array.isArray(result) ? result[0] : null;
			if (Array.isArray(rows) && rows.length > 0) {
				return rows as Record<string, unknown>[];
			}
		} catch {
			// fall through to table scan
		}
	}

	// Fallback: full table select (soft-capped) and filter — acceptable for EE scale
	try {
		const all = await session.select<Record<string, unknown>>(new Table(table)).limit(500);
		const list = Array.isArray(all) ? all : all == null ? [] : [all];
		const want = new Set(ids);
		return (list as Record<string, unknown>[]).filter((row) => {
			const id = normalizeRecordId(row.id);
			return id !== '' && want.has(id);
		});
	} catch {
		return [];
	}
}

/** Parse `table:key` into a Surreal RecordId (key may be string or nested). */
function toRecordId(id: string, fallbackTable?: string): RecordId | null {
	const trimmed = id.trim();
	if (!trimmed) return null;
	const colon = trimmed.indexOf(':');
	let table: string;
	let key: string;
	if (colon > 0) {
		table = trimmed.slice(0, colon);
		key = trimmed.slice(colon + 1);
	} else if (fallbackTable) {
		table = fallbackTable;
		key = trimmed;
	} else {
		return null;
	}
	if (!isValidTableName(table) || !key) return null;
	return new RecordId(table, key);
}
