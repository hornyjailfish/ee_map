/**
 * Normalize Surreal field `kind` strings from INFO FOR TABLE STRUCTURE
 * into AutoProfile field type metadata.
 *
 * Surreal 3.2 STRUCTURE observations (this project):
 * - `TYPE option<T>` is stored/emitted as `none | T`
 * - `TYPE T | none` is emitted as `T | none`
 * - both mean optional; parser accepts option<> and none| unions
 * Nested `option<option<T>>` is rejected by Surreal and not supported.
 *
 * Engine identity lives on `AutoProfile.engine` / `ResolvedConfig.engine`
 * (from introspect). Pass `engine` into parse options when a future dialect
 * branch is needed; today both option spellings parse the same.
 */

import type { AutoProfileField, FieldTypeName, SurrealEngineVersion } from '$lib/config/types';

/** Optional dialect context for kind parsing (future Surreal STRUCTURE changes). */
export type ParseFieldKindOptions = {
	engine?: SurrealEngineVersion;
};

/** Strip surrounding backticks from identifiers (`value` → value). */
export function unquoteIdent(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`')) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Split a top-level `|` union without breaking nested `<…>` / `(…)`.
 * e.g. `record<a | b> | none` → [`record<a | b>`, `none`]
 * e.g. `none | geometry<polygon>` → [`none`, `geometry<polygon>`]
 */
export function splitUnion(typeExpr: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;

	for (let i = 0; i < typeExpr.length; i++) {
		const ch = typeExpr[i]!;
		if (ch === '<' || ch === '(') depth++;
		else if (ch === '>' || ch === ')') depth = Math.max(0, depth - 1);
		else if (ch === '|' && depth === 0) {
			parts.push(typeExpr.slice(start, i).trim());
			start = i + 1;
		}
	}
	parts.push(typeExpr.slice(start).trim());
	return parts.filter(Boolean);
}

/**
 * If `expr` is exactly `option<…>` (balanced angles), peel one layer.
 * Leaves mixed forms like `option<string> | none` untouched (split first).
 */
export function peelOuterOption(expr: string): { inner: string; peeled: boolean } {
	const trimmed = expr.trim();
	const head = /^option\s*</i.exec(trimmed);
	if (!head) return { inner: trimmed, peeled: false };

	const openIdx = head[0].length - 1;
	let depth = 0;
	for (let i = openIdx; i < trimmed.length; i++) {
		const ch = trimmed[i]!;
		if (ch === '<') depth++;
		else if (ch === '>') {
			depth--;
			if (depth === 0) {
				// Must consume the whole expression
				if (i !== trimmed.length - 1) return { inner: trimmed, peeled: false };
				return { inner: trimmed.slice(openIdx + 1, i).trim(), peeled: true };
			}
		}
	}
	return { inner: trimmed, peeled: false };
}

/** Peel all outer `option<>` layers. */
export function peelOptions(expr: string): { inner: string; optional: boolean } {
	let inner = expr.trim();
	let optional = false;
	for (;;) {
		const step = peelOuterOption(inner);
		if (!step.peeled) break;
		optional = true;
		inner = step.inner;
	}
	return { inner, optional };
}

function isNoneLike(expr: string): boolean {
	return /^(none|null)$/i.test(expr.trim());
}

function extractAngleArgs(expr: string, head: string): string | null {
	const re = new RegExp(`^${head}\\s*<\\s*([\\s\\S]+)\\s*>$`, 'i');
	const m = re.exec(expr.trim());
	return m ? m[1]!.trim() : null;
}

function normalizeBaseName(raw: string): FieldTypeName {
	const lower = raw.trim().toLowerCase();
	switch (lower) {
		case 'int':
		case 'integer':
		case 'float':
		case 'decimal':
		case 'number':
			return 'number';
		case 'bool':
		case 'boolean':
			return 'bool';
		case 'string':
		case 'str':
			return 'string';
		case 'datetime':
			return 'datetime';
		case 'duration':
			return 'duration';
		case 'uuid':
			return 'uuid';
		case 'bytes':
			return 'bytes';
		case 'object':
			return 'object';
		case 'any':
			return 'any';
		case 'null':
		case 'none':
			return 'none';
		default:
			return lower || 'unknown';
	}
}

/**
 * Classify a non-optional, non-option-wrapped primary type expression.
 */
function classifyPrimary(primary: string): Omit<AutoProfileField, 'name' | 'optional'> {
	// record<table | other>
	const recordArgs = extractAngleArgs(primary, 'record');
	if (recordArgs !== null) {
		const targets = splitUnion(recordArgs)
			.map(unquoteIdent)
			.filter((t) => t && !isNoneLike(t));
		const field: Omit<AutoProfileField, 'name' | 'optional'> = { type: 'record' };
		if (targets.length) field.recordTargets = targets;
		return field;
	}

	// geometry<point | polygon>
	const geomArgs = extractAngleArgs(primary, 'geometry');
	if (geomArgs !== null || /^geometry$/i.test(primary)) {
		const kinds = geomArgs
			? splitUnion(geomArgs)
					.map((k) => k.trim().toLowerCase())
					.filter((k) => k && !isNoneLike(k))
			: [];
		const field: Omit<AutoProfileField, 'name' | 'optional'> = { type: 'geometry' };
		if (kinds.length) field.geometryKinds = kinds;
		return field;
	}

	// array / set / list — element type ignored for AutoProfile
	if (/^(array|set|list)\b/i.test(primary)) {
		return { type: 'array' };
	}

	// plain base type (strip trailing generics we don't model)
	const base = primary.replace(/\s*<[\s\S]*>\s*$/, '').trim();
	return { type: normalizeBaseName(base || primary) };
}

/**
 * Parse a Surreal type expression into AutoProfile field metadata (name filled by caller).
 *
 * Accepts STRUCTURE forms and DEFINE-equivalent spellings:
 * - `string` / `geometry<polygon>`
 * - `T | none` / `none | T` (STRUCTURE canonical for option)
 * - `option<T>` / nested option peels
 * - `option<string> | none` (redundant but valid)
 */
export function parseFieldKind(
	kindRaw: string,
	_options?: ParseFieldKindOptions
): Omit<AutoProfileField, 'name'> {
	// `_options.engine` reserved for STRUCTURE dialect branches (see AutoProfile.engine).
	const kind = kindRaw.trim();
	if (!kind) {
		return { type: 'unknown', optional: false };
	}

	// Whole-expr option peel first (option<geometry<polygon>>)
	const whole = peelOptions(kind);
	let optional = whole.optional;

	const parts = splitUnion(whole.inner)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		return { type: 'unknown', optional };
	}

	// Peel option per union arm (option<string> | none)
	const arms = parts.map((part) => {
		const peeled = peelOptions(part);
		return { expr: peeled.inner, optional: peeled.optional };
	});

	if (arms.some((a) => a.optional || isNoneLike(a.expr))) {
		optional = true;
	}

	const nonNone = arms.filter((a) => !isNoneLike(a.expr));
	const primary = (nonNone[0] ?? arms[0])!.expr;

	const classified = classifyPrimary(primary);
	return {
		...classified,
		optional
	};
}

/**
 * Build a full AutoProfileField from STRUCTURE field entry pieces.
 */
export function toAutoField(
	name: string,
	kind: string,
	options?: ParseFieldKindOptions
): AutoProfileField {
	const parsed = parseFieldKind(kind, options);
	const field: AutoProfileField = {
		name: unquoteIdent(name),
		type: parsed.type,
		optional: parsed.optional ?? false
	};
	if (parsed.recordTargets) field.recordTargets = parsed.recordTargets;
	if (parsed.geometryKinds) field.geometryKinds = parsed.geometryKinds;
	return field;
}
