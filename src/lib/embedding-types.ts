/**
 * Shared types for the embedding "Tasks" view.
 * Pure shape-only module — safe to import from both server and client bundles.
 */

export type TaskStatus = 'pending' | 'processing' | 'failed' | 'done';

/** Where a task row came from (DB embedding_queue, service, or both merged). */
export type TaskSource = 'db' | 'service' | 'both';

/** A task as returned by the embedding service (`GET /tasks`). */
export type EmbeddingTask = {
	/** Canonical record id (usually `marker_views:<id>`, or the service's own id). */
	id: string;
	/** `marker_views:<id>` the task embeds, when the service reports it. */
	data: string | null;
	status: TaskStatus;
	error: string | null;
	updatedAt: string | null;
	version: number | null;
};

/** A task row shown in the Tasks page (DB + service merged). */
export type TaskRow = {
	/** Canonical `marker_views:<id>` — used as the `/generate` item and the table key. */
	id: string;
	/** `embedding_queue:<id>` when the row came from the DB queue. */
	queueId: string | null;
	status: TaskStatus;
	error: string | null;
	updatedAt: string | null;
	version: number | null;
	source: TaskSource;
};

/**
 * Coerce an arbitrary status value onto the known set.
 * The service / SSE events use `queued`, `processing`, `done`, `error`;
 * the DB queue uses `pending`, `processing`, `done`, `failed`. Both feed here.
 */
export function normalizeStatus(value: unknown): TaskStatus {
	if (typeof value !== 'string') return 'pending';
	switch (value.trim().toLowerCase()) {
		case 'processing':
		case 'running':
			return 'processing';
		case 'failed':
		case 'error':
			return 'failed';
		case 'done':
		case 'completed':
		case 'success':
			return 'done';
		default:
			// queued, pending, and anything unknown all read as pending
			return 'pending';
	}
}