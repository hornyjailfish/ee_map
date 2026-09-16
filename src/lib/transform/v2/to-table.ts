/**
 * v2 table helpers: picker membership via derived `views`, not entity.graph/map.
 * Row mapping stays on shared `toTable` / `buildColumns` (entity field surface unchanged).
 */

import type { ResolvedConfigV2, ResolvedEntityV2, ProductView } from './shapes';
import { toTable, buildColumns, type TableViewModel, type ToTableOptions } from '../to-table';

/** Tables included in a product view (default filter for pickers). */
export function entitiesForView(config: ResolvedConfigV2, view: ProductView): ResolvedEntityV2[] {
	return config.tables.filter((t) => t.views.includes(view));
}

/** Table-picker list: `views` includes `'table'`. */
export function tableEntities(config: ResolvedConfigV2): ResolvedEntityV2[] {
	return entitiesForView(config, 'table');
}

/** Pick slim entity by table name. */
export function entityByNameV2(
	config: ResolvedConfigV2,
	table: string
): ResolvedEntityV2 | undefined {
	return config.tables.find((t) => t.name === table);
}

/**
 * Grid view model for a v2 entity.
 * Delegates to shared toTable — field/column contract is the same.
 */
export function toTableV2(
	entity: ResolvedEntityV2,
	rows: ReadonlyArray<Record<string, unknown>>,
	opts?: ToTableOptions
): TableViewModel {
	// Structural: v2 entity is a subset of v1 ResolvedEntity fields used by toTable
	return toTable(entity as Parameters<typeof toTable>[0], rows, opts);
}

export { buildColumns };
