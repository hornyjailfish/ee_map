import { describe, it, expect } from 'vitest';
import {
	columnSortFn,
	compareByKeys,
	compareValues,
	naturalCompare,
	sortRowsByKeys
} from './compare';

describe('naturalCompare / compareValues', () => {
	it('sorts numeric-looking strings in human order', () => {
		const items = ['Q10', 'Q1', 'Q2', 'Q11', 'Q20'];
		expect([...items].sort(naturalCompare)).toEqual(['Q1', 'Q2', 'Q10', 'Q11', 'Q20']);
	});

	it('sorts room-like names without classic 1/10/2 mess', () => {
		const items = ['1.10', '1.2', '2.1', '1.1', '10.1'];
		expect([...items].sort(naturalCompare)).toEqual(['1.1', '1.2', '1.10', '2.1', '10.1']);
	});

	it('puts nullish last', () => {
		expect(compareValues(null, 'a')).toBe(1);
		expect(compareValues('a', null)).toBe(-1);
		expect(compareValues(null, undefined)).toBe(0);
	});

	it('compares numbers numerically', () => {
		expect(compareValues(2, 10)).toBeLessThan(0);
		expect(compareValues(10, 2)).toBeGreaterThan(0);
	});

	it('compares mixed number-ish display via collator when not both numbers', () => {
		expect(compareValues('2', '10')).toBeLessThan(0);
	});
});

describe('compareByKeys / sortRowsByKeys', () => {
	it('sorts by single field asc', () => {
		const rows = [{ name: 'Q10' }, { name: 'Q2' }, { name: 'Q1' }];
		expect(sortRowsByKeys(rows, [{ field: 'name' }]).map((r) => r.name)).toEqual([
			'Q1',
			'Q2',
			'Q10'
		]);
	});

	it('sorts desc when dir is desc', () => {
		const rows = [{ name: 'Q1' }, { name: 'Q10' }, { name: 'Q2' }];
		expect(sortRowsByKeys(rows, [{ field: 'name', dir: 'desc' }]).map((r) => r.name)).toEqual([
			'Q10',
			'Q2',
			'Q1'
		]);
	});

	it('uses secondary key when primary ties', () => {
		const rows = [
			{ room: 'ER-A', name: 'Main' },
			{ room: 'ER-B', name: 'Main' },
			{ room: 'ER-A', name: 'Spare' }
		];
		const sorted = sortRowsByKeys(rows, [
			{ field: 'room', dir: 'asc' },
			{ field: 'name', dir: 'asc' }
		]);
		expect(sorted).toEqual([
			{ room: 'ER-A', name: 'Main' },
			{ room: 'ER-A', name: 'Spare' },
			{ room: 'ER-B', name: 'Main' }
		]);
	});

	it('returns a copy when keys empty', () => {
		const rows = [{ a: 1 }];
		const next = sortRowsByKeys(rows, []);
		expect(next).toEqual(rows);
		expect(next).not.toBe(rows);
	});
});

describe('columnSortFn', () => {
	it('compares the named field on row objects (SVAR contract)', () => {
		const sort = columnSortFn('name');
		expect(sort({ name: 'Q2' }, { name: 'Q10' })).toBe(-1);
		expect(sort({ name: 'Q10' }, { name: 'Q2' })).toBe(1);
		expect(sort({ name: 'Q2' }, { name: 'Q2' })).toBe(0);
	});
});

describe('compareByKeys direction flip', () => {
	it('flips only the key with desc', () => {
		const a = { level: '2 · Floor', name: 'A' };
		const b = { level: '1 · Floor', name: 'B' };
		expect(compareByKeys(a, b, [{ field: 'level', dir: 'desc' }])).toBeLessThan(0);
	});
});
