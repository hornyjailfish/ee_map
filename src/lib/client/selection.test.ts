import { describe, it, expect } from 'vitest';
import { applyNodeSelection, hasRecordId, tableOfRecordId } from './selection';

describe('tableOfRecordId', () => {
	it('extracts the table from table:key ids', () => {
		expect(tableOfRecordId('breakers:q1')).toBe('breakers');
		expect(tableOfRecordId('electric_rooms:er-a')).toBe('electric_rooms');
	});

	it('returns null for bare keys, empty, and nullish', () => {
		expect(tableOfRecordId('q1')).toBeNull();
		expect(tableOfRecordId('')).toBeNull();
		expect(tableOfRecordId('   ')).toBeNull();
		expect(tableOfRecordId(null)).toBeNull();
		expect(tableOfRecordId(undefined)).toBeNull();
		expect(tableOfRecordId(':key')).toBeNull();
	});
});

describe('applyNodeSelection', () => {
	it('marks only the focused node selected', () => {
		const nodes = [
			{ id: 'boards:b1', selected: false },
			{ id: 'breakers:q1' },
			{ id: 'breakers:q2', selected: true }
		];

		const next = applyNodeSelection(nodes, 'breakers:q1');

		expect(next).toEqual([
			{ id: 'boards:b1', selected: false },
			{ id: 'breakers:q1', selected: true },
			{ id: 'breakers:q2', selected: false }
		]);
		// Unchanged nodes keep identity
		expect(next[0]).toBe(nodes[0]);
	});

	it('returns the same array reference when nothing changes', () => {
		const nodes = [
			{ id: 'a', selected: true },
			{ id: 'b', selected: false }
		];
		expect(applyNodeSelection(nodes, 'a')).toBe(nodes);
	});

	it('clears selection when focusedId is null', () => {
		const nodes = [
			{ id: 'a', selected: true },
			{ id: 'b', selected: false }
		];
		expect(applyNodeSelection(nodes, null)).toEqual([
			{ id: 'a', selected: false },
			{ id: 'b', selected: false }
		]);
	});
});

describe('hasRecordId', () => {
	it('checks membership', () => {
		expect(hasRecordId(['breakers:q1', 'boards:b1'], 'breakers:q1')).toBe(true);
		expect(hasRecordId(['breakers:q1'], 'breakers:q2')).toBe(false);
		expect(hasRecordId(['breakers:q1'], null)).toBe(false);
	});
});
