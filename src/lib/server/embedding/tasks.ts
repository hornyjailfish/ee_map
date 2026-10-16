/**
 * Aggregates the Tasks view's data from two sources:
 *   - the DB `embedding_queue` table (authoritative history of every past task)
 *   - the embedding service (`GET /tasks`) for the freshest live status
 *
 * Both are normalised into a single {@link TaskRow} list keyed by the
 * `marker_views:<id>` each task embeds.
 */

import type { Surreal } from 'surrealdb';
import { normalizeRecordId } from '$lib/transform/to-table';
import { queryEntities } from '$lib/server/data';
import { normalizeStatus, type EmbeddingTask, type TaskRow } from '$lib/embedding-types';
import { listServiceTasks, serviceHealth } from './service';

function toText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function coerceVersion(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function coerceTime(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return value;
	const s = String(value);
	return s && s !== '[object Object]' ? s : null;
}

/**
 * The DB event writes `embedding_queue` with the same record key as the
 * `marker_views` row (`UPSERT ... type::record("embedding_queue", record::id($after.id))`),
 * so `embedding_queue:<key>` → `marker_views:<key>`.
 */
export function markerViewIdFromQueueId(queueId: string): string {
	if (queueId.startsWith('embedding_queue:')) {
		return `marker_views:${queueId.slice('embedding_queue:'.length)}`;
	}
	return queueId;
}

/** Normalise a raw `embedding_queue` row into an embedding-service-shaped task. */
function queueRowToTask(row: Record<string, unknown>): EmbeddingTask | null {
	const queueId = normalizeRecordId(row.id);
	const data = normalizeRecordId(row.data) || markerViewIdFromQueueId(queueId);
	const id = data || queueId;
	if (!id) return null;

	return {
		id,
		data: data || null,
		status: normalizeStatus(row.status),
		error: toText(row.error_message) ?? toText(row.error),
		updatedAt: coerceTime(row.updated_at),
		version: coerceVersion(row.version_snapshot ?? row.version)
	};
}

/**
 * Merge DB queue + service tasks by `marker_views:<id>` key.
 * DB rows provide the full history; service rows freshen a matching row's status
 * and add any runs the DB hasn't seen yet.
 */
export function mergeTasks(
	dbRows: Record<string, unknown>[],
	serviceTasks: EmbeddingTask[]
): TaskRow[] {
	const byKey = new Map<string, TaskRow>();

	for (const raw of dbRows) {
		const task = queueRowToTask(raw);
		if (!task) continue;
		byKey.set(task.id, {
			id: task.id,
			queueId: normalizeRecordId(raw.id) || null,
			status: task.status,
			error: task.error,
			updatedAt: task.updatedAt,
			version: task.version,
			source: 'db'
		});
	}

	for (const task of serviceTasks) {
		const key = task.data || task.id;
		const existing = byKey.get(key);
		if (existing) {
			if (task.status !== 'pending' || existing.status === 'pending') {
				existing.status = task.status;
			}
			existing.error = task.error ?? existing.error;
			existing.updatedAt = task.updatedAt ?? existing.updatedAt;
			if (task.version != null) existing.version = task.version;
			existing.source = 'both';
		} else {
			byKey.set(key, {
				id: key,
				queueId: null,
				status: task.status,
				error: task.error,
				updatedAt: task.updatedAt,
				version: task.version,
				source: 'service'
			});
		}
	}

	return [...byKey.values()].sort((a, b) => {
		const at = a.updatedAt;
		const bt = b.updatedAt;
		if (at && bt && at !== bt) return at < bt ? 1 : -1;
		if (at && !bt) return -1;
		if (!at && bt) return 1;
		return a.id.localeCompare(b.id);
	});
}

export type LoadTasksResult = {
	tasks: TaskRow[];
	dbTaskCount: number;
	serviceTaskCount: number;
	healthy: boolean;
	serviceError: string | null;
	dbError: string | null;
};

type FetchImpl = typeof globalThis.fetch;

/**
 * Read both the DB queue and the embedding service. Each failure is isolated so
 * the view still renders with whichever source is available.
 */
export async function loadTasks(
	session: Surreal | null,
	fetchImpl: FetchImpl = fetch
): Promise<LoadTasksResult> {
	let dbRows: Record<string, unknown>[] = [];
	let dbError: string | null = null;

	if (session) {
		try {
			dbRows = await queryEntities(session, 'embedding_queue');
		} catch (err) {
			dbError = err instanceof Error ? err.message : 'Failed to read embedding_queue';
			console.warn('[tasks] embedding_queue read failed:', dbError);
		}
	}

	let healthy = false;
	let serviceTasks: EmbeddingTask[] = [];
	let serviceError: string | null = null;

	try {
		healthy = await serviceHealth(fetchImpl);
	} catch {
		// health is best-effort; listTasks reports the real failure below
	}

	try {
		serviceTasks = await listServiceTasks(fetchImpl);
	} catch (err) {
		serviceError =
			err instanceof Error ? err.message : 'Embedding service unreachable';
	}

	return {
		tasks: mergeTasks(dbRows, serviceTasks),
		dbTaskCount: dbRows.length,
		serviceTaskCount: serviceTasks.length,
		healthy,
		serviceError,
		dbError
	};
}