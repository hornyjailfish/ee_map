import { describe, expect, it, beforeEach } from 'vitest';
import { clearFormEditors, getFormEditor, registerEditor } from './registry';
import type { FormEditorComponent } from './registry';

const FakeForm = {} as FormEditorComponent;
const FakeText = {} as FormEditorComponent;

describe('editor registry', () => {
	beforeEach(() => {
		clearFormEditors();
	});

	it('stores form editors by key and falls back to text', () => {
		registerEditor('text', { form: FakeText });
		registerEditor('combo', { form: FakeForm });

		expect(getFormEditor('combo')).toBe(FakeForm);
		expect(getFormEditor('unknown')).toBe(FakeText);
		expect(getFormEditor(null)).toBe(FakeText);
	});

	it('returns null when nothing is registered', () => {
		expect(getFormEditor('text')).toBeNull();
	});
});
