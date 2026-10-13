/**
 * Aggregate embedding status per marker for the map view.
 *
 * A `markers` row is only the physical point; its embedding state lives on its
 * `marker_views` rows (one per photo/description), each backed by an
 * `embedding_queue` row that tracks the embedding service's progress. Several
 * views can share one marker, so the marker's colour is the highest-severity
 * state across all of its views:
 *
 *   failed  (red)    — any view's embedding failed
 *   active  (blue)   — any view is queued or currently processing
 *   stale   (orange) — any view changed after its embedding was generated
 *                      (`embedding_queue.version_snapshot` ≠ `marker_views.version`)
 *   done    (green)  — every view embedded and up to date
 *   empty   (gray)   — the marker has no views at all
 *
 * Precedence (most severe first): failed > active > stale > done.
 */

import type { Surreal } from 'surrealdb';
import { normalizeRecordId } from '$lib/transform/to-table';
import { queryEntities } from '$lib/server/data/query-entities';
import { normalizeStatus } from '$lib/embedding-types';

/** Marker-level state that drives the map pin colour. */
export type MarkerEmbeddingStatus = 'done' | 'active' | 'stale' | 'failed' | 'empty';

/** Per-view classification before aggregation (no `empty` — a view exists). */
export type MarkerViewState = 'done' | 'active' | 'stale' | 'failed';

/** Severity order used to fold per-view states into one marker colour. */
const VIEW_SEVERITY: Record<MarkerViewState, number> = {
	done: 0,
	stale: 1,
	active: 2,
	failed: 3
};

/** The inputs needed to classify a single marker_view against its queue row. */
export type ViewEmbeddingState = {
	/** `marker_views.version` — bumps whenever the description/image changes. */
	version: number;
	/** Raw `embedding_queue.status`, or `null` when no queue row exists. */
	queueStatus: string | null;
	/** `embedding_queue.version_snapshot`, or `null` when unknown. */
	queueVersion: number | null;
};

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** Classify one view. Missing queue row → `active` (unprocessed work). */
export function classifyView(view: ViewEmbeddingState): MarkerViewState {
	if (view.queueStatus == null) return 'active';
	switch (normalizeStatus(view.queueStatus)) {
		case 'failed':
			return 'failed';
		case 'done':
			// Embedded at an older version → the vector no longer matches the text.
			return view.queueVersion != null && view.queueVersion !== view.version ? 'stale' : 'done';
		default:
			// pending / processing
			return 'active';
	}
}

/** Fold all of a marker's view states into a single marker colour. */
export function aggregateMarkerStatus(views: ViewEmbeddingState[]): MarkerEmbeddingStatus {
	if (views.length === 0) return 'empty';
	let worst: MarkerViewState = 'done';
	for (const view of views) {
		const state = classifyView(view);
		if (VIEW_SEVERITY[state] > VIEW_SEVERITY[worst]) worst = state;
	}
	return worst;
}

/**
 * Derive the canonical `marker_views:<id>` key from an `embedding_queue` row.
 * The DB event writes the queue record with the same key as the view and stores
 * the view id in `data`, so either source identifies the view.
 */
function markerViewKeyFromQueueRow(row: Record<string, unknown>): string {
	const dataId = normalizeRecordId(row.data);
	if (dataId) return dataId;
	const queueId = normalizeRecordId(row.id);
	const key = queueId.includes(':') ? queueId.slice(queueId.indexOf(':') + 1) : queueId;
	return key ? `marker_views:${key}` : '';
}

/**
 * Map every marker record id → aggregate embedding status.
 *
 * Markers with no views report `empty`; markers whose views have no queue row
 * report `active` (via {@link classifyView}). Isolated from map geometry so the
 * caller can inject the result as a style variant.
 */
export async function loadMarkerEmbeddingStatuses(
	session: Surreal
): Promise<Record<string, MarkerEmbeddingStatus>> {
	const [markers, views, queue] = await Promise.all([
		queryEntities(session, 'markers', { limit: 5000 }),
		queryEntities(session, 'marker_views', { limit: 5000 }),
		queryEntities(session, 'embedding_queue', { limit: 5000 })
	]);

	const queueByViewId = new Map<string, { status: string | null; version: number | null }>();
	for (const row of queue) {
		const viewKey = markerViewKeyFromQueueRow(row);
		if (!viewKey) continue;
		queueByViewId.set(viewKey, {
			status: typeof row.status === 'string' ? row.status : null,
			version: toNumber(row.version_snapshot ?? row.version)
		});
	}

	const viewsByMarker = new Map<string, ViewEmbeddingState[]>();
	for (const row of views) {
		const markerId = normalizeRecordId(row.marker);
		if (!markerId) continue;
		const queueRow = queueByViewId.get(normalizeRecordId(row.id));
		const entry: ViewEmbeddingState = {
			version: toNumber(row.version) ?? 0,
			queueStatus: queueRow?.status ?? null,
			queueVersion: queueRow?.version ?? null
		};
		const list = viewsByMarker.get(markerId);
		if (list) list.push(entry);
		else viewsByMarker.set(markerId, [entry]);
	}

	const out: Record<string, MarkerEmbeddingStatus> = {};
	for (const row of markers) {
		const markerId = normalizeRecordId(row.id);
		if (markerId) out[markerId] = 'empty';
	}
	for (const [markerId, list] of viewsByMarker) {
		out[markerId] = aggregateMarkerStatus(list);
	}
	return out;
}
