import { describe, it, expect } from 'vitest';
import {
	parseFieldKind,
	peelOptions,
	peelOuterOption,
	splitUnion,
	toAutoField,
	unquoteIdent
} from './parse-kind';

describe('unquoteIdent', () => {
	it('strips surrounding backticks', () => {
		expect(unquoteIdent('`value`')).toBe('value');
		expect(unquoteIdent('name')).toBe('name');
	});
});

describe('splitUnion', () => {
	it('splits top-level | only', () => {
		expect(splitUnion('record<a | b> | none')).toEqual(['record<a | b>', 'none']);
		expect(splitUnion('none | geometry<polygon>')).toEqual(['none', 'geometry<polygon>']);
		expect(splitUnion('string | none')).toEqual(['string', 'none']);
		expect(splitUnion('geometry<polygon>')).toEqual(['geometry<polygon>']);
	});
});

describe('peelOuterOption / peelOptions', () => {
	it('peels a single option layer with nested generics', () => {
		expect(peelOuterOption('option<geometry<polygon>>')).toEqual({
			inner: 'geometry<polygon>',
			peeled: true
		});
		expect(peelOptions('option<option<string>>')).toEqual({
			inner: 'string',
			optional: true
		});
	});

	it('does not peel when option is only one union arm', () => {
		expect(peelOuterOption('option<string> | none')).toEqual({
			inner: 'option<string> | none',
			peeled: false
		});
	});
});

describe('parseFieldKind', () => {
	it('normalizes scalar kinds', () => {
		expect(parseFieldKind('string')).toEqual({ type: 'string', optional: false });
		expect(parseFieldKind('int')).toEqual({ type: 'number', optional: false });
		expect(parseFieldKind('number | none')).toEqual({ type: 'number', optional: true });
		expect(parseFieldKind('bool')).toEqual({ type: 'bool', optional: false });
	});

	it('parses record targets', () => {
		expect(parseFieldKind('record<boards>')).toEqual({
			type: 'record',
			optional: false,
			recordTargets: ['boards']
		});
		expect(parseFieldKind('record<breakers | rents>')).toEqual({
			type: 'record',
			optional: false,
			recordTargets: ['breakers', 'rents']
		});
		expect(parseFieldKind('record<levels> | none')).toEqual({
			type: 'record',
			optional: true,
			recordTargets: ['levels']
		});
	});

	it('parses geometry kinds', () => {
		expect(parseFieldKind('geometry<polygon>')).toEqual({
			type: 'geometry',
			optional: false,
			geometryKinds: ['polygon']
		});
		expect(parseFieldKind('geometry<polygon> | none')).toEqual({
			type: 'geometry',
			optional: true,
			geometryKinds: ['polygon']
		});
		expect(parseFieldKind('geometry<point | polygon>')).toEqual({
			type: 'geometry',
			optional: false,
			geometryKinds: ['point', 'polygon']
		});
	});

	/**
	 * Live Surreal 3.2.4 STRUCTURE: DEFINE option<T> is emitted as `none | T`.
	 * DEFINE T | none stays `T | none`. Both must parse identically as optional.
	 */
	it('treats STRUCTURE none|T the same as T|none and option<T>', () => {
		const geo = {
			type: 'geometry',
			optional: true,
			geometryKinds: ['polygon']
		};
		expect(parseFieldKind('none | geometry<polygon>')).toEqual(geo);
		expect(parseFieldKind('geometry<polygon> | none')).toEqual(geo);
		expect(parseFieldKind('option<geometry<polygon>>')).toEqual(geo);

		const rec = {
			type: 'record',
			optional: true,
			recordTargets: ['levels']
		};
		expect(parseFieldKind('none | record<levels>')).toEqual(rec);
		expect(parseFieldKind('record<levels> | none')).toEqual(rec);
		expect(parseFieldKind('option<record<levels>>')).toEqual(rec);

		const str = { type: 'string', optional: true };
		expect(parseFieldKind('none | string')).toEqual(str);
		expect(parseFieldKind('string | none')).toEqual(str);
		expect(parseFieldKind('option<string>')).toEqual(str);
	});

	it('peels option on a union arm and marks optional', () => {
		expect(parseFieldKind('option<string> | none')).toEqual({
			type: 'string',
			optional: true
		});
		expect(parseFieldKind('none | option<geometry<polygon>>')).toEqual({
			type: 'geometry',
			optional: true,
			geometryKinds: ['polygon']
		});
	});

	it('parses option/array forms from STRUCTURE', () => {
		expect(parseFieldKind('array<string> | none')).toEqual({ type: 'array', optional: true });
		expect(parseFieldKind('none | array<string>')).toEqual({ type: 'array', optional: true });
		expect(parseFieldKind('option<array<string>>')).toEqual({ type: 'array', optional: true });
		// multi-type optional: first non-none arm wins
		expect(parseFieldKind('none | string | int')).toEqual({ type: 'string', optional: true });
		expect(parseFieldKind('option<string | int>')).toEqual({ type: 'string', optional: true });
	});

	it('never leaves type as the literal "option"', () => {
		expect(parseFieldKind('option<string> | none').type).not.toBe('option');
		expect(parseFieldKind('option<geometry<polygon>>').type).toBe('geometry');
	});
});

describe('toAutoField', () => {
	it('unquotes name and attaches kind metadata', () => {
		expect(toAutoField('`value`', 'number | none')).toEqual({
			name: 'value',
			type: 'number',
			optional: true
		});
		expect(toAutoField('geometry', 'none | geometry<polygon>')).toEqual({
			name: 'geometry',
			type: 'geometry',
			optional: true,
			geometryKinds: ['polygon']
		});
	});
});
