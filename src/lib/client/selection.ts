/**
 * Pure selection helpers shared by Table / Graph / Map.
 * Record ids are `table:key` strings (see normalizeRecordId / recordIdToString).
 */

/** Table name from a Surreal-style record id, or null if unusable. */
export function tableOfRecordId(id: string | null | undefined): string | null {
	if (id == null) return null;
	const trimmed = id.trim();
	if (!trimmed) return null;
	const colon = trimmed.indexOf(':');
	if (colon <= 0) return null;
	const table = trimmed.slice(0, colon).trim();
	return table.length > 0 ? table : null;
}

/**
 * Apply shared focus to a node list without mutating inputs.
 * Only rewrites when a node's `selected` flag would change.
 */
export function applyNodeSelection<T extends { id: string; selected?: boolean }>(
	nodes: readonly T[],
	focusedId: string | null | undefined
): T[] {
	const focus = focusedId && focusedId.length > 0 ? focusedId : null;
	let changed = false;
	const next = nodes.map((node) => {
		const selected = focus != null && node.id === focus;
		if (Boolean(node.selected) === selected) return node;
		changed = true;
		return { ...node, selected };
	});
	return changed ? next : (nodes as T[]);
}

/** True when `id` appears in a table/graph/map id list. */
export function hasRecordId(ids: readonly string[], id: string | null | undefined): boolean {
	if (id == null || id === '') return false;
	return ids.includes(id);
}
