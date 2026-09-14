/**
 * Resolve field editor *key* from column / app_config field policy.
 *
 * Overlay `fields.<name>.editor`:
 * - omitted → default for `valueType` (string/number/datetime → text, bool/record → combo)
 * - `false` → non-editable
 * - string → registry key (`text`, `combo`, custom…)
 *
 * Components are registered separately via `registerEditor` (SVAR inline + form).
 */

import type { TEditorType } from '@svar-ui/grid-store';
import type { SelectOption } from '$lib/option-types';

/** Select/option row for field editors (SVAR IOption + optional group). */
export type EditorOption = SelectOption;

/** Column / field slice needed to pick an editor. */
export type FieldEditorSource = {
	id?: string;
	/** Overlay policy after merge. */
	editor?: false | string;
	readOnly?: boolean;
	/** Normalized field type from resolve (`string`, `record`, …). */
	valueType?: string;
	/** When true (default for optional schema fields), combo gets a None → null choice. */
	optional?: boolean;
};

/** Concrete editor choice for grid / form controls. */
export type FieldEditorSpec = {
	/** Editor key: SVAR built-in or future custom registry name. */
	type: TEditorType;
	options?: SelectOption[];
};

/** Built-in keys understood by SVAR grid (+ form control switch). */
export const BUILTIN_EDITOR_TYPES = [
	'text',
	'combo',
	'richselect',
	'multiselect',
	'datepicker'
] as const satisfies readonly TEditorType[];

export type BuiltinEditorType = (typeof BUILTIN_EDITOR_TYPES)[number];

const BOOL_OPTIONS: SelectOption[] = [
	{ id: 'true', label: 'true' },
	{ id: 'false', label: 'false' }
];

/**
 * Empty choice for optional combo/record fields.
 * id is `''` so form/grid clear → coerceScalar → DB `null`.
 */
export const NONE_OPTION_ID = '';
export const NONE_OPTION: SelectOption = { id: NONE_OPTION_ID, label: 'None' };

const CHOICE_EDITORS = new Set(['combo', 'richselect', 'multiselect']);

/** Alias legacy / doc names onto SVAR-style keys. */
const EDITOR_ALIASES: Record<string, string> = {
	combobox: 'combo',
	select: 'combo',
	boolean: 'combo',
	bool: 'combo',
	string: 'text',
	number: 'text',
	datetime: 'text',
	date: 'datepicker'
};

/**
 * Default editor key for a field type when overlay does not set `editor`.
 * Returns null for types without a generic control (geometry, array, …).
 */
export function defaultEditorType(valueType: string | undefined): TEditorType | null {
	switch (valueType) {
		case 'string':
		case 'number':
		case 'datetime':
			return 'text';
		case 'bool':
		case 'record':
			return 'combo';
		default:
			return null;
	}
}

/** Normalize overlay / type names to a stable editor key. */
export function normalizeEditorType(raw: string): TEditorType {
	const key = raw.trim();
	if (!key) return 'text';
	return EDITOR_ALIASES[key.toLowerCase()] ?? key;
}

export function boolEditorOptions(): SelectOption[] {
	return BOOL_OPTIONS.map((o) => ({ ...o }));
}

function hasOptions(options: SelectOption[] | null | undefined): options is SelectOption[] {
	return Array.isArray(options) && options.length > 0;
}

function isChoiceEditor(type: string): boolean {
	return CHOICE_EDITORS.has(type);
}

/** Optional fields get a leading None so users can clear → DB null. */
export function withNoneOption(
	options: SelectOption[] | null | undefined,
	optional: boolean | undefined
): SelectOption[] {
	const list = hasOptions(options) ? options.map((o) => ({ ...o })) : [];
	if (optional === false) return list;
	if (list.some((o) => o.id === NONE_OPTION_ID || o.id == null)) return list;
	return [{ ...NONE_OPTION }, ...list];
}

/**
 * Map a DB cell value into an editor/control value.
 * `null`/`undefined` → `''` (None) for choice editors so the empty option is selected.
 */
export function editorValueFromDb(value: unknown, editorType?: string | null): string {
	if (value == null) return NONE_OPTION_ID;
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (editorType && isChoiceEditor(editorType) && value === '') return NONE_OPTION_ID;
	return String(value);
}

export type ResolveFieldEditorOptions = {
	/**
	 * When true, record/combo fields resolve even without loaded choices
	 * (add-row form can still render an empty picker).
	 * Grid inline edit should leave this false so empty FKs stay non-editable.
	 */
	allowEmptyOptions?: boolean;
};

/**
 * Map field config → editor spec used by grid + forms.
 *
 * @param field column / resolved field policy
 * @param options choice list (record labels, or explicit override list)
 */
export function resolveFieldEditor(
	field: FieldEditorSource,
	options?: SelectOption[] | null,
	opts?: ResolveFieldEditorOptions
): FieldEditorSpec | null {
	if (field.editor === false || field.readOnly) return null;

	const explicit = typeof field.editor === 'string' ? normalizeEditorType(field.editor) : null;
	const type = explicit ?? defaultEditorType(field.valueType);
	if (!type) return null;

	if (field.valueType === 'record') {
		// Grid: need choices to edit. Form: may render empty picker.
		if (!hasOptions(options) && !opts?.allowEmptyOptions) return null;
		const raw = options ?? [];
		return {
			type,
			options: isChoiceEditor(type) ? withNoneOption(raw, field.optional) : raw
		};
	}

	if (field.valueType === 'bool') {
		// Bool defaults (and combo-like overrides) use true/false (+ None when optional).
		if (isChoiceEditor(type)) {
			const base = hasOptions(options) ? options : boolEditorOptions();
			return { type, options: withNoneOption(base, field.optional) };
		}
		return { type };
	}

	if (hasOptions(options)) {
		return {
			type,
			options: isChoiceEditor(type) ? withNoneOption(options, field.optional) : options
		};
	}
	return { type };
}

/**
 * Whether a column belongs in the add-row form.
 * Mirrors resolve defaults: writable scalars/records, or an explicit editor string.
 */
export function isFormEditorField(field: FieldEditorSource): boolean {
	if (field.id === 'id') return false;
	if (field.editor === false || field.readOnly) return false;
	if (typeof field.editor === 'string') return true;
	return defaultEditorType(field.valueType) != null;
}
