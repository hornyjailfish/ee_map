import { describe, it, expect } from 'vitest';
import type { ResolvedEntity, ResolvedField } from '$lib/config/types';
import type { ResolvedEdge } from '$lib/config/types';
import {
	assertCanCreate,
	assertCanDelete,
	assertCanEdit,
	assertCanRelate,
	assertCanUnrelate,
	assertCanUpdate,
	coercePatch,
	coerceScalar,
	MutateError,
	tableOfId,
	validateConnectEndpoints,
	validateRecordId,
	writableFields
} from './mutate';

function field(name: string, partial: Partial<ResolvedField> = {}): ResolvedField {
	return {
		name,
		label: name,
		type: 'string',
		optional: false,
		hidden: false,
		readOnly: false,
		...partial
	};
}

function entity(
	name: string,
	fields: ResolvedField[],
	permissions = { create: true, update: true, delete: true, select: true }
): ResolvedEntity {
	return { name, label: name, fields, permissions };
}

describe('assertCanEdit', () => {
	it('allows EDITOR and OWNER', () => {
		expect(() => assertCanEdit(['EDITOR'])).not.toThrow();
		expect(() => assertCanEdit(['OWNER'])).not.toThrow();
	});

	it('rejects VIEWER, empty, and missing roles', () => {
		expect(() => assertCanEdit(['VIEWER'])).toThrow(MutateError);
		expect(() => assertCanEdit([])).toThrow(MutateError);
		expect(() => assertCanEdit(undefined)).toThrow(MutateError);
	});
});

describe('table permission gates', () => {
	it('throws when update permission is false', () => {
		const e = entity('x', [], { create: true, update: false, delete: true, select: true });
		expect(() => assertCanUpdate(e)).toThrow(/read-only/);
		expect(() => assertCanCreate(e)).not.toThrow();
		expect(() => assertCanDelete(e)).not.toThrow();
	});

	it('passes when all write permissions are true', () => {
		const e = entity('x', []);
		expect(() => assertCanUpdate(e)).not.toThrow();
		expect(() => assertCanCreate(e)).not.toThrow();
		expect(() => assertCanDelete(e)).not.toThrow();
	});
});

describe('writableFields', () => {
	it('excludes id, hidden, readOnly; includes record and geometry fields', () => {
		const e = entity('boards', [
			field('id'),
			field('name'),
			field('description', { optional: true }),
			field('hidden_note', { hidden: true }),
			field('locked', { readOnly: true }),
			field('room', { type: 'record', recordTargets: ['electric_rooms'] }),
			field('geometry', { type: 'geometry' })
		]);
		expect(writableFields(e).map((w) => w.name)).toEqual([
			'name',
			'description',
			'room',
			'geometry'
		]);
	});
});

describe('coerceScalar', () => {
	it('returns null for empty/null optional fields, throws for required', () => {
		expect(coerceScalar(field('d', { optional: true }), '')).toBeNull();
		expect(coerceScalar(field('d', { optional: true }), null)).toBeNull();
		expect(coerceScalar(field('d', { optional: true }), undefined)).toBeNull();
		expect(() => coerceScalar(field('n'), '')).toThrow(/required/);
		expect(() => coerceScalar(field('n'), null)).toThrow(/required/);
	});

	it('coerces numbers and rejects non-numeric', () => {
		expect(coerceScalar(field('v', { type: 'number' }), '42')).toBe(42);
		expect(coerceScalar(field('v', { type: 'number' }), 42)).toBe(42);
		expect(() => coerceScalar(field('v', { type: 'number' }), 'abc')).toThrow(/number/);
	});

	it('coerces booleans from strings and booleans', () => {
		expect(coerceScalar(field('v', { type: 'bool' }), 'true')).toBe(true);
		expect(coerceScalar(field('v', { type: 'bool' }), 'false')).toBe(false);
		expect(coerceScalar(field('v', { type: 'bool' }), true)).toBe(true);
		expect(() => coerceScalar(field('v', { type: 'bool' }), 'yes')).toThrow(/true or false/);
	});
});

describe('coercePatch', () => {
	it('rejects unknown and non-writable fields', () => {
		const e = entity('boards', [field('name')]);
		expect(() => coercePatch(e, { id: 'x' })).toThrow(/not editable/);
		expect(() => coercePatch(e, { nope: 'x' })).toThrow(/not editable/);
	});

	it('coerces writable scalar fields', () => {
		const e = entity('boards', [field('name'), field('ord', { type: 'number', optional: true })]);
		expect(coercePatch(e, { name: 'Main', ord: '7' })).toEqual({ name: 'Main', ord: 7 });
	});

	it('coerces record-link fields to StringRecordId', () => {
		const e = entity('boards', [
			field('name'),
			field('room', { type: 'record', recordTargets: ['electric_rooms'] })
		]);
		const out = coercePatch(e, { room: 'electric_rooms:r1' }) as {
			room: { toString: () => string };
		};
		expect(out.room.toString()).toBe('electric_rooms:r1');
	});

	it('coerces geometry GeoJSON into SDK Geometry values', () => {
		const e = entity('rents', [
			field('geometry', { type: 'geometry', geometryKinds: ['polygon'], optional: true })
		]);
		// Rings need 2+ distinct segments for GeometryLine; close the ring.
		const poly = {
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 1],
					[0, 0]
				]
			]
		};
		const fromObj = coercePatch(e, { geometry: poly }) as { geometry: { toJSON: () => unknown } };
		expect(fromObj.geometry.toJSON()).toEqual(poly);

		const fromStr = coercePatch(e, { geometry: JSON.stringify(poly) }) as {
			geometry: { toJSON: () => unknown };
		};
		expect(fromStr.geometry.toJSON()).toEqual(poly);

		expect(coercePatch(e, { geometry: '' })).toEqual({ geometry: null });
	});
});

describe('validateRecordId', () => {
	it('accepts table:id strings unchanged', () => {
		expect(validateRecordId('boards:abc')).toBe('boards:abc');
		expect(validateRecordId('levels:-2')).toBe('levels:-2');
	});

	it('rejects malformed ids with the public error', () => {
		expect(() => validateRecordId('no-colon')).toThrow(MutateError);
		expect(() => validateRecordId(':key')).toThrow(MutateError);
		expect(() => validateRecordId('table:')).toThrow(MutateError);
	});
});

function relation(partial: Partial<ResolvedEdge> = {}): ResolvedEdge {
	return {
		name: 'connects',
		role: 'feeds',
		in: ['breakers'],
		out: ['breakers', 'rents'],
		fields: [
			{
				name: 'cable',
				label: 'cable',
				type: 'string',
				optional: true,
				hidden: false,
				readOnly: false
			}
		],
		permissions: { create: true, update: true, delete: true, select: true },
		...partial
	};
}

describe('assertCanEdit blocks VIEWER from write paths', () => {
	it('rejects VIEWER (graph connect must call this first)', () => {
		const err = (() => {
			try {
				assertCanEdit(['VIEWER']);
				return null;
			} catch (e) {
				return e as MutateError;
			}
		})();
		expect(err).toBeInstanceOf(MutateError);
		expect(err?.status).toBe(403);
		expect(err?.code).toBe('forbidden');
	});
});

describe('relation permission gates', () => {
	it('assertCanRelate / assertCanUnrelate respect create/delete flags', () => {
		const locked = relation({
			permissions: { create: false, update: false, delete: false, select: true }
		});
		expect(() => assertCanRelate(locked)).toThrow(/read-only/);
		expect(() => assertCanUnrelate(locked)).toThrow(/read-only/);

		const open = relation();
		expect(() => assertCanRelate(open)).not.toThrow();
		expect(() => assertCanUnrelate(open)).not.toThrow();
	});
});

describe('validateConnectEndpoints', () => {
	it('accepts breaker → breaker and breaker → rent', () => {
		const rel = relation();
		expect(validateConnectEndpoints(rel, 'breakers:q1', 'breakers:q2')).toEqual({
			inId: 'breakers:q1',
			outId: 'breakers:q2'
		});
		expect(validateConnectEndpoints(rel, 'breakers:q1', 'rents:a1').outId).toBe('rents:a1');
	});

	it('rejects self-loops and wrong endpoint tables', () => {
		const rel = relation();
		expect(() => validateConnectEndpoints(rel, 'breakers:q1', 'breakers:q1')).toThrow(/itself/);
		expect(() => validateConnectEndpoints(rel, 'boards:b1', 'breakers:q1')).toThrow(
			/Source must be/
		);
		expect(() => validateConnectEndpoints(rel, 'breakers:q1', 'boards:b1')).toThrow(
			/Target must be/
		);
	});

	it('tableOfId extracts the table prefix', () => {
		expect(tableOfId('connects:abc')).toBe('connects');
		expect(tableOfId('levels:-2')).toBe('levels');
	});
});
