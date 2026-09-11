import { describe, expect, it } from 'vitest';
import { isValidFieldName, resolveSearchFields } from './query-entities-search';
import type { ResolvedConfig, ResolvedEntity } from '$lib/config/types';

describe('isValidFieldName', () => {
	it('accepts simple identifiers', () => {
		expect(isValidFieldName('name')).toBe(true);
		expect(isValidFieldName('aliases')).toBe(true);
		expect(isValidFieldName('_meta')).toBe(true);
	});

	it('rejects non-identifiers', () => {
		expect(isValidFieldName('')).toBe(false);
		expect(isValidFieldName('has-dash')).toBe(false);
		expect(isValidFieldName('a.b')).toBe(false);
		expect(isValidFieldName('name; DROP')).toBe(false);
	});
});

describe('resolveSearchFields', () => {
	const entity = {
		name: 'rents',
		label: 'Rents',
		kind: 'entity',
		fields: [
			{ name: 'id', label: 'Id', type: 'string', hidden: false, readOnly: true },
			{ name: 'name', label: 'Name', type: 'string', hidden: false, readOnly: false },
			{ name: 'note', label: 'Note', type: 'string', hidden: false, readOnly: false },
			{ name: 'geom', label: 'Geom', type: 'geometry', hidden: false, readOnly: false }
		],
		permissions: { select: true, create: false, update: true, delete: false }
	} as unknown as ResolvedEntity;

	it('prefers config search fields', () => {
		const config = {
			search: { fieldsByTable: { rents: ['name'] } }
		} as unknown as ResolvedConfig;
		expect(resolveSearchFields(config, entity)).toEqual(['name']);
	});

	it('falls back to name then string fields', () => {
		const config = { search: { fieldsByTable: {} } } as unknown as ResolvedConfig;
		expect(resolveSearchFields(config, entity)).toEqual(['name', 'note']);
	});
});
