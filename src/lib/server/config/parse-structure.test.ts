import { describe, it, expect } from 'vitest';
import {
	buildAutoProfile,
	parseDbTables,
	parsePermissions,
	parseTableFields
} from './parse-structure';

/** Fixtures shaped like live Surreal STRUCTURE responses from this project. */
const dbStructure = {
	tables: [
		{
			name: 'boards',
			kind: { kind: 'NORMAL' },
			schemafull: true
		},
		{
			name: 'connects',
			kind: {
				kind: 'RELATION',
				enforced: false,
				in: ['breakers'],
				out: ['breakers', 'rents']
			},
			schemafull: false
		},
		{
			name: '__entity',
			kind: { kind: 'NORMAL' },
			schemafull: true
		},
		{
			name: 'electric_rooms',
			kind: { kind: 'NORMAL' },
			schemafull: true
		}
	]
};

const breakersFields = {
	fields: [
		{
			kind: 'record<boards>',
			name: 'board',
			table: 'breakers'
		},
		{
			kind: 'string | none',
			name: 'description',
			table: 'breakers'
		},
		{
			kind: 'string',
			name: 'name',
			table: 'breakers'
		},
		{
			kind: 'number | none',
			name: '`value`',
			table: 'breakers'
		}
	]
};

const connectsFields = {
	fields: [
		{ kind: 'string | none', name: 'cable', table: 'connects' },
		{ kind: 'record<breakers>', name: 'in', table: 'connects' },
		{ kind: 'record<breakers | rents>', name: 'out', table: 'connects' }
	]
};

const electricRoomsFields = {
	fields: [
		{ kind: 'geometry<polygon> | none', name: 'geometry', table: 'electric_rooms' },
		{ kind: 'record<levels>', name: 'level', table: 'electric_rooms' },
		{ kind: 'string', name: 'name', table: 'electric_rooms' }
	]
};

describe('parseDbTables (STRUCTURE only)', () => {
	it('parses STRUCTURE array tables with NORMAL and RELATION kinds', () => {
		const stubs = parseDbTables(dbStructure);
		expect(stubs.map((s) => s.name)).toEqual(['__entity', 'boards', 'connects', 'electric_rooms']);
		expect(stubs.find((s) => s.name === 'boards')).toEqual({
			name: 'boards',
			kind: 'normal'
		});
		expect(stubs.find((s) => s.name === 'connects')).toEqual({
			name: 'connects',
			kind: 'relation',
			in: ['breakers'],
			out: ['breakers', 'rents']
		});
	});

	it('ignores plain INFO map-of-DEFINE-string shape', () => {
		const plain = {
			tables: {
				boards: 'DEFINE TABLE boards TYPE NORMAL SCHEMAFULL PERMISSIONS NONE',
				connects:
					'DEFINE TABLE connects TYPE RELATION IN breakers OUT breakers | rents SCHEMALESS PERMISSIONS NONE'
			}
		};
		expect(parseDbTables(plain)).toEqual([]);
	});

	it('returns empty for garbage', () => {
		expect(parseDbTables(null)).toEqual([]);
		expect(parseDbTables({})).toEqual([]);
		expect(parseDbTables({ tables: 'nope' })).toEqual([]);
	});

	it('treats unknown structured kinds as unknown (future-safe)', () => {
		const stubs = parseDbTables({
			tables: [{ name: 'mv', kind: { kind: 'VIEW' } }]
		});
		expect(stubs).toEqual([{ name: 'mv', kind: 'unknown' }]);
	});

	it('ignores string table.kind (not STRUCTURE shape)', () => {
		const stubs = parseDbTables({
			tables: [{ name: 'x', kind: 'TYPE RELATION IN a OUT b' }]
		});
		expect(stubs).toEqual([{ name: 'x', kind: 'unknown' }]);
	});
});

describe('parseTableFields (STRUCTURE only)', () => {
	it('parses STRUCTURE field arrays with real EE kinds', () => {
		expect(parseTableFields(breakersFields)).toEqual([
			{
				name: 'board',
				type: 'record',
				optional: false,
				recordTargets: ['boards']
			},
			{
				name: 'description',
				type: 'string',
				optional: true
			},
			{
				name: 'name',
				type: 'string',
				optional: false
			},
			{
				name: 'value',
				type: 'number',
				optional: true
			}
		]);
	});

	it('parses geometry and level fields on electric_rooms', () => {
		expect(parseTableFields(electricRoomsFields)).toEqual([
			{
				name: 'geometry',
				type: 'geometry',
				optional: true,
				geometryKinds: ['polygon']
			},
			{
				name: 'level',
				type: 'record',
				optional: false,
				recordTargets: ['levels']
			},
			{
				name: 'name',
				type: 'string',
				optional: false
			}
		]);
	});

	it('parses multi-target out on connects', () => {
		const fields = parseTableFields(connectsFields);
		expect(fields.find((f) => f.name === 'out')).toEqual({
			name: 'out',
			type: 'record',
			optional: false,
			recordTargets: ['breakers', 'rents']
		});
	});

	it('drops array element markers so arrays stay a single column', () => {
		const fields = parseTableFields({
			fields: [
				{ name: 'name', kind: 'string' },
				{ name: 'aliases', kind: 'array<string> | none' },
				{ name: 'aliases.*', kind: 'string' }
			]
		});
		expect(fields.map((f) => f.name)).toEqual(['aliases', 'name']);
		expect(fields.find((f) => f.name === 'aliases')).toEqual({
			name: 'aliases',
			type: 'array',
			optional: true
		});
	});

	it('ignores plain INFO fields map of DEFINE strings', () => {
		const plain = {
			fields: {
				cable: 'DEFINE FIELD cable ON connects TYPE string | none PERMISSIONS FULL',
				in: 'DEFINE FIELD in ON connects TYPE record<breakers> PERMISSIONS FULL'
			}
		};
		expect(parseTableFields(plain)).toEqual([]);
	});
});

describe('parsePermissions', () => {
	it('maps FULL booleans and NONE booleans', () => {
		expect(
			parsePermissions({ create: true, delete: false, select: true, update: false })
		).toEqual({ create: true, delete: false, select: true, update: false });
	});

	it('treats non-empty role-scoped WHERE expressions as writable', () => {
		expect(
			parsePermissions({
				create: '$auth.role INSIDE [EDITOR, OWNER]',
				update: '$auth.role INSIDE [EDITOR, OWNER]',
				delete: false,
				select: true
			})
		).toEqual({ create: true, update: true, delete: false, select: true });
	});

	it('returns undefined for missing or empty permissions', () => {
		expect(parsePermissions(undefined)).toBeUndefined();
		expect(parsePermissions(null)).toBeUndefined();
		expect(parsePermissions({})).toBeUndefined();
		expect(parsePermissions({ create: '', update: ' ' })).toBeUndefined();
	});
});

describe('buildAutoProfile', () => {
	it('assembles tables and enriches relation endpoints from fields when missing', () => {
		const stubs = [
			{ name: 'rooms', kind: 'normal' as const },
			{ name: 'wires', kind: 'relation' as const }
		];
		const fieldsByTable = new Map([
			['rooms', parseTableFields({ fields: [{ name: 'name', kind: 'string' }] })],
			[
				'wires',
				parseTableFields({
					fields: [
						{ name: 'in', kind: 'record<a>' },
						{ name: 'out', kind: 'record<b | c>' }
					]
				})
			]
		]);

		const profile = buildAutoProfile(stubs, fieldsByTable);
		expect(profile.tables).toHaveLength(2);
		expect(profile.tables[1]).toMatchObject({
			name: 'wires',
			kind: 'relation',
			in: ['a'],
			out: ['b', 'c']
		});
	});

	it('keeps DB-level relation in/out when present', () => {
		const stubs = [
			{
				name: 'connects',
				kind: 'relation' as const,
				in: ['breakers'],
				out: ['breakers', 'rents']
			}
		];
		const profile = buildAutoProfile(
			stubs,
			new Map([['connects', parseTableFields(connectsFields)]])
		);
		expect(profile.tables[0]?.in).toEqual(['breakers']);
		expect(profile.tables[0]?.out).toEqual(['breakers', 'rents']);
	});
});
