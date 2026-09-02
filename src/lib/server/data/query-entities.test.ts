import { describe, expect, it } from 'vitest';
import { isValidTableName } from './query-entities';

describe('isValidTableName', () => {
	it('accepts simple identifiers', () => {
		expect(isValidTableName('electric_rooms')).toBe(true);
		expect(isValidTableName('levels')).toBe(true);
		expect(isValidTableName('_meta')).toBe(true);
		expect(isValidTableName('T1')).toBe(true);
	});

	it('rejects empty and non-identifiers', () => {
		expect(isValidTableName('')).toBe(false);
		expect(isValidTableName('1starts')).toBe(false);
		expect(isValidTableName('has-dash')).toBe(false);
		expect(isValidTableName('has space')).toBe(false);
		expect(isValidTableName('foo; DROP')).toBe(false);
		expect(isValidTableName('a.b')).toBe(false);
	});
});
