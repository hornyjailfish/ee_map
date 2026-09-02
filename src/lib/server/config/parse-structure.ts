/**
 * Parsers for Surreal `INFO … STRUCTURE` objects.
 * Pure — no I/O. STRUCTURE only (never plain INFO / DEFINE strings).
 *
 * Live table kind shape (Surreal 3.2):
 *   { kind: "NORMAL" }
 *   { kind: "RELATION", in: string[], out: string[], enforced?: boolean }
 *
 * Field kinds remain type-expression strings (`geometry<polygon> | none`) —
 * those are handled by parse-kind.ts.
 */

import type {
	AutoProfile,
	AutoProfileField,
	AutoProfileTable,
	AutoProfileTableKind
} from '$lib/config/types';
import { toAutoField, unquoteIdent, type ParseFieldKindOptions } from './parse-kind';

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Table stub from DB STRUCTURE before fields are filled. */
export type TableStub = {
	name: string;
	kind: AutoProfileTableKind;
	in?: string[];
	out?: string[];
};

/**
 * Extract table stubs from `INFO FOR DB STRUCTURE`.
 * Expects `tables: Array<{ name, kind: { kind, in?, out? } }>`.
 */
export function parseDbTables(dbInfo: unknown): TableStub[] {
	const root = asRecord(dbInfo);
	if (!root) return [];
	if (!Array.isArray(root.tables)) return [];

	return root.tables
		.map((entry) => parseTableStub(entry))
		.filter((t): t is TableStub => t !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function parseTableStub(entry: unknown): TableStub | null {
	const row = asRecord(entry);
	if (!row) return null;

	const name = asString(row.name);
	if (!name) return null;

	const kindObj = asRecord(row.kind);
	if (!kindObj) {
		// Missing / non-object kind → still register the table for field introspect
		return { name, kind: 'unknown' };
	}

	const k = asString(kindObj.kind)?.toUpperCase();
	if (k === 'RELATION') {
		return {
			name,
			kind: 'relation',
			in: tableNameList(kindObj.in),
			out: tableNameList(kindObj.out)
		};
	}
	if (k === 'NORMAL' || k === 'ANY') {
		return { name, kind: 'normal' };
	}
	// Future table kinds (e.g. VIEW) → unknown entity until we model them
	return { name, kind: 'unknown' };
}

/** STRUCTURE relation endpoints are string[] of table names. */
function tableNameList(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((v) => (typeof v === 'string' ? unquoteIdent(v) : null))
		.filter((v): v is string => Boolean(v));
}

/**
 * Parse fields from `INFO FOR TABLE $t STRUCTURE`.
 * Expects `fields: Array<{ name, kind: string }>`.
 * Pass `engine` when known so kind parsing can dialect-branch later.
 */
export function parseTableFields(
	tableInfo: unknown,
	options?: ParseFieldKindOptions
): AutoProfileField[] {
	const root = asRecord(tableInfo);
	if (!root) return [];
	if (!Array.isArray(root.fields)) return [];

	return root.fields
		.map((entry) => parseFieldEntry(entry, options))
		.filter((f): f is AutoProfileField => f !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function parseFieldEntry(entry: unknown, options?: ParseFieldKindOptions): AutoProfileField | null {
	const row = asRecord(entry);
	if (!row) return null;

	const name = asString(row.name);
	if (!name) return null;

	// STRUCTURE field kind is always a type-expression string
	const kind = asString(row.kind) ?? '';
	if (!kind) {
		return { name: unquoteIdent(name), type: 'unknown', optional: false };
	}

	return toAutoField(name, kind, options);
}

/**
 * Fill relation in/out from field `in`/`out` recordTargets when the DB stub
 * omitted them (still STRUCTURE-derived — no string DEFINE parsing).
 */
export function enrichRelationEndpoints(stub: TableStub, fields: AutoProfileField[]): TableStub {
	if (stub.kind !== 'relation') return stub;

	const next = { ...stub };
	if (!next.in?.length) {
		const inField = fields.find((f) => f.name === 'in');
		if (inField?.recordTargets?.length) next.in = [...inField.recordTargets];
	}
	if (!next.out?.length) {
		const outField = fields.find((f) => f.name === 'out');
		if (outField?.recordTargets?.length) next.out = [...outField.recordTargets];
	}
	return next;
}

/** Build a complete AutoProfileTable from stub + fields. */
export function toAutoProfileTable(stub: TableStub, fields: AutoProfileField[]): AutoProfileTable {
	const enriched = enrichRelationEndpoints(stub, fields);
	const table: AutoProfileTable = {
		name: enriched.name,
		kind: enriched.kind,
		fields
	};
	if (enriched.kind === 'relation') {
		table.in = enriched.in ?? [];
		table.out = enriched.out ?? [];
	}
	return table;
}

/** Assemble AutoProfile from stubs + per-table field maps. */
export function buildAutoProfile(
	stubs: TableStub[],
	fieldsByTable: Map<string, AutoProfileField[]>
): AutoProfile {
	const tables = stubs.map((stub) => toAutoProfileTable(stub, fieldsByTable.get(stub.name) ?? []));
	return { tables };
}
