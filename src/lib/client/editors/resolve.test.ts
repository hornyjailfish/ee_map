import { describe, expect, it } from 'vitest';
import {
	NONE_OPTION,
	boolEditorOptions,
	defaultEditorType,
	editorValueFromDb,
	isFormEditorField,
	normalizeEditorType,
	resolveFieldEditor,
	withNoneOption
} from './resolve';

describe('defaultEditorType', () => {
	it('maps scalar and record types', () => {
		expect(defaultEditorType('string')).toBe('text');
		expect(defaultEditorType('number')).toBe('text');
		expect(defaultEditorType('datetime')).toBe('text');
		expect(defaultEditorType('bool')).toBe('combo');
		expect(defaultEditorType('record')).toBe('combo');
		expect(defaultEditorType('geometry')).toBeNull();
		expect(defaultEditorType(undefined)).toBeNull();
	});
});

describe('normalizeEditorType', () => {
	it('aliases common aliases to built-ins', () => {
		expect(normalizeEditorType('combobox')).toBe('combo');
		expect(normalizeEditorType('select')).toBe('combo');
		expect(normalizeEditorType('string')).toBe('text');
		expect(normalizeEditorType('date')).toBe('datepicker');
	});

	it('keeps custom / unknown keys', () => {
		expect(normalizeEditorType('ampEditor')).toBe('ampEditor');
		expect(normalizeEditorType('richselect')).toBe('richselect');
	});
});

describe('resolveFieldEditor', () => {
	it('returns null for readOnly or editor:false', () => {
		expect(resolveFieldEditor({ valueType: 'string', readOnly: true })).toBeNull();
		expect(resolveFieldEditor({ valueType: 'string', editor: false })).toBeNull();
	});

	it('defaults by valueType', () => {
		expect(resolveFieldEditor({ valueType: 'string' })).toEqual({ type: 'text' });
		expect(resolveFieldEditor({ valueType: 'number' })).toEqual({ type: 'text' });
		// optional defaults → None + true/false
		expect(resolveFieldEditor({ valueType: 'bool' })).toEqual({
			type: 'combo',
			options: [NONE_OPTION, ...boolEditorOptions()]
		});
		expect(resolveFieldEditor({ valueType: 'bool', optional: false })).toEqual({
			type: 'combo',
			options: boolEditorOptions()
		});
	});

	it('requires options for record links unless allowEmptyOptions', () => {
		expect(resolveFieldEditor({ valueType: 'record' })).toBeNull();
		expect(resolveFieldEditor({ valueType: 'record' }, [])).toBeNull();
		expect(
			resolveFieldEditor({ valueType: 'record' }, [], { allowEmptyOptions: true })
		).toEqual({ type: 'combo', options: [NONE_OPTION] });

		const opts = [{ id: 'rooms:a', label: 'A' }];
		expect(resolveFieldEditor({ valueType: 'record' }, opts)).toEqual({
			type: 'combo',
			options: [NONE_OPTION, ...opts]
		});
		expect(resolveFieldEditor({ valueType: 'record', optional: false }, opts)).toEqual({
			type: 'combo',
			options: opts
		});
	});

	it('honors explicit overlay editor key', () => {
		expect(resolveFieldEditor({ valueType: 'string', editor: 'combo' })).toEqual({
			type: 'combo'
		});
		expect(resolveFieldEditor({ valueType: 'string', editor: 'ampEditor' })).toEqual({
			type: 'ampEditor'
		});
		expect(
			resolveFieldEditor({ valueType: 'record', editor: 'combobox' }, [
				{ id: 'x', label: 'X' }
			])
		).toEqual({
			type: 'combo',
			options: [NONE_OPTION, { id: 'x', label: 'X' }]
		});
		expect(
			resolveFieldEditor({ valueType: 'record', editor: 'richselect' }, [
				{ id: 'x', label: 'X' }
			])
		).toEqual({
			type: 'richselect',
			options: [NONE_OPTION, { id: 'x', label: 'X' }]
		});
	});

	it('withNoneOption and editorValueFromDb map null → None', () => {
		expect(withNoneOption([{ id: 'a', label: 'A' }], true)[0]).toEqual(NONE_OPTION);
		expect(withNoneOption([{ id: 'a', label: 'A' }], false)).toEqual([{ id: 'a', label: 'A' }]);
		expect(editorValueFromDb(null)).toBe('');
		expect(editorValueFromDb(undefined)).toBe('');
		expect(editorValueFromDb(true)).toBe('true');
		expect(editorValueFromDb(false)).toBe('false');
		expect(editorValueFromDb('rooms:a')).toBe('rooms:a');
	});

	it('returns null for unknown types without explicit editor', () => {
		expect(resolveFieldEditor({ valueType: 'geometry' })).toBeNull();
		expect(resolveFieldEditor({ valueType: 'geometry', editor: 'text' })).toEqual({
			type: 'text'
		});
	});
});

describe('isFormEditorField', () => {
	it('includes writable scalars and records', () => {
		expect(isFormEditorField({ id: 'name', valueType: 'string' })).toBe(true);
		expect(isFormEditorField({ id: 'room', valueType: 'record' })).toBe(true);
		expect(isFormEditorField({ id: 'on', valueType: 'bool' })).toBe(true);
	});

	it('excludes id, readOnly, editor:false, and non-editable types', () => {
		expect(isFormEditorField({ id: 'id', valueType: 'string' })).toBe(false);
		expect(isFormEditorField({ id: 'name', valueType: 'string', readOnly: true })).toBe(false);
		expect(isFormEditorField({ id: 'name', valueType: 'string', editor: false })).toBe(false);
		expect(isFormEditorField({ id: 'geometry', valueType: 'geometry' })).toBe(false);
	});

	it('includes explicit custom editor even for odd valueTypes', () => {
		expect(isFormEditorField({ id: 'geometry', valueType: 'geometry', editor: 'geoEditor' })).toBe(
			true
		);
	});
});
