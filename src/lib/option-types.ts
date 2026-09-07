/**
 * Shared select/option shapes built on SVAR grid types.
 * Used by server record loaders, client editors, and form controls.
 */

import type { IOption } from '@svar-ui/grid-store';

/**
 * SVAR `IOption` plus picker extras.
 * - `label` — full cell / closed-control text (optionsMap)
 * - `group` + `itemLabel` — multi-part recipes split for combo lists so the
 *   group heading is not repeated inside each item
 */
export type SelectOption = IOption & {
	group?: string;
	/** Short list text when `group` is set; falls back to `label` in pickers. */
	itemLabel?: string;
};
