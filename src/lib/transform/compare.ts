/**
 * Shared cell / multi-key comparators for table sorting.
 * Fixes classic string sort (1, 10, 11, 2) via numeric-aware collator.
 */

import type { TSortFunction } from '@svar-ui/grid-store';

/** Locale(s) for Intl.Collator; default engine locale is fine for mixed Cyrillic/Latin EE data. */
const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
	ignorePunctuation: false
});

export type SortDir = 'asc' | 'desc';

export type SortKey = {
	/** Row field / column id. */
	field: string;
	dir?: SortDir;
};

/**
 * Compare two cell values:
 * - null/undefined last
 * - number / boolean by magnitude
 * - everything else as natural strings (Q1 < Q2 < Q10)
 */
export function compareValues(a: unknown, b: unknown): number {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;

	if (typeof a === 'number' && typeof b === 'number') {
		if (Number.isNaN(a) && Number.isNaN(b)) return 0;
		if (Number.isNaN(a)) return 1;
		if (Number.isNaN(b)) return -1;
		return a < b ? -1 : a > b ? 1 : 0;
	}

	if (typeof a === 'boolean' && typeof b === 'boolean') {
		return Number(a) - Number(b);
	}

	// Mixed number/string that look numeric still go through collator as strings
	return collator.compare(stringifyForSort(a), stringifyForSort(b));
}

function stringifyForSort(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return String(value);
	}
	if (value instanceof Date) return value.toISOString();
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return String(value);
	}
}

/** Natural string compare (public for tests). */
export function naturalCompare(a: string, b: string): number {
	return collator.compare(a, b);
}

/**
 * Multi-key row compare. Each key's dir flips that key's result.
 * Stable enough when used with Array.prototype.sort for equal tails.
 */
export function compareByKeys(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
	keys: readonly SortKey[]
): number {
	for (const key of keys) {
		const dir = key.dir === 'desc' ? -1 : 1;
		const cmp = compareValues(a[key.field], b[key.field]);
		if (cmp !== 0) return (cmp * dir) as -1 | 0 | 1;
	}
	return 0;
}

/** Sort a shallow copy of rows by keys (does not mutate input). */
export function sortRowsByKeys<T extends Record<string, unknown>>(
	rows: readonly T[],
	keys: readonly SortKey[] | undefined | null
): T[] {
	if (!keys || keys.length === 0) return rows.slice();
	return rows.slice().sort((a, b) => compareByKeys(a, b, keys));
}

/**
 * Build a SVAR column `sort` function for one field.
 * SVAR passes full row objects to column sort functions (grid-store ge()).
 */
export function columnSortFn(field: string): TSortFunction {
	return (a, b) => {
		const cmp = compareValues(a[field], b[field]);
		return cmp < 0 ? -1 : cmp > 0 ? 1 : 0;
	};
}
