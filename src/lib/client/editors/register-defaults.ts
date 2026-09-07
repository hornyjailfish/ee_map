/**
 * Default field editors for table grid + add-row form.
 * Import once from a client entry (table page) — safe to call repeatedly.
 *
 * Add custom editors:
 *   registerEditor('ampEditor', { inline: AmpInline, form: AmpForm });
 * then set `fields.amps.editor: 'ampEditor'` in app_config.
 */

import { registerEditor } from './registry';
import ComboInline from '$lib/components/table/editors/ComboInline.svelte';
import ComboForm from '$lib/components/table/editors/ComboForm.svelte';
import TextForm from '$lib/components/table/editors/TextForm.svelte';

let registered = false;

/** Idempotent — registers SVAR inline overrides + form controls. */
export function ensureEditorsRegistered(): void {
	if (registered) return;
	registered = true;

	// Choice editors → shadcn Combobox (groups work for multi-part record labels).
	registerEditor('combo', { inline: ComboInline, form: ComboForm });
	registerEditor('richselect', { inline: ComboInline, form: ComboForm });
	registerEditor('multiselect', { form: ComboForm }); // single-select until multi UI exists
	// SVAR keeps built-in `text` / `datepicker` inline; form uses Input.
	registerEditor('text', { form: TextForm });
	registerEditor('datepicker', { form: TextForm });
}
