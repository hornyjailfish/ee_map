/**
 * Dual editor registry: one key drives both SVAR inline + add-row form controls.
 *
 * Overlay / type resolve still picks the key (`text`, `combo`, …).
 * Components plug in here once; grid uses SVAR `registerInlineEditor`,
 * FormFieldControl looks up `getFormEditor`.
 */

import type { Component } from 'svelte';
import { registerInlineEditor } from '@svar-ui/svelte-grid';
import type { TEditorConfig } from '@svar-ui/grid-store';
import type { EditorOption } from './resolve';

/** Props for add-row / modal form field controls (shadcn). */
export type FormEditorProps = {
	id: string;
	value?: string;
	options?: EditorOption[];
	/** Field value type — used by text control for `input type=number`. */
	valueType?: string;
	invalid?: boolean;
	disabled?: boolean;
	onValueChange?: (value: string) => void;
};

/** Props SVAR passes into registered inline editors. */
export type InlineEditorProps = {
	editor: TEditorConfig;
	onsave?: (ignoreFocus: boolean) => void;
	oncancel?: () => void;
	onapply?: (value: unknown) => void;
	onaction?: (ev: { action: string; data?: Record<string, unknown> }) => void;
};

export type FormEditorComponent = Component<FormEditorProps>;
export type InlineEditorComponent = Component<InlineEditorProps>;

export type EditorRegistration = {
	/** Grid cell editor (SVAR). Omit to keep SVAR built-in for that key. */
	inline?: InlineEditorComponent;
	/** Add-row modal control. Omit → form falls back to `text`. */
	form?: FormEditorComponent;
};

const formEditors = new Map<string, FormEditorComponent>();

/**
 * Register (or replace) components for an editor key used in app_config.
 * Call from client modules only (imports Svelte components + SVAR).
 */
export function registerEditor(type: string, components: EditorRegistration): void {
	const key = type.trim();
	if (!key) return;

	if (components.inline) {
		registerInlineEditor(key, components.inline);
	}
	if (components.form) {
		formEditors.set(key, components.form);
	}
}

/** Form control for a resolved editor key; falls back to `text` then null. */
export function getFormEditor(type: string | null | undefined): FormEditorComponent | null {
	if (!type) return formEditors.get('text') ?? null;
	return formEditors.get(type) ?? formEditors.get('text') ?? null;
}

/** Test helper — clear form registrations (does not unhook SVAR). */
export function clearFormEditors(): void {
	formEditors.clear();
}
