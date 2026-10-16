/**
 * Minimal HTTP client for the external embedding service.
 *
 * The base URL comes from the `EMBEDDING_SERVICE_URL` env var (server only) and
 * defaults to `http://localhost:8030`. The user owns that env value — this module
 * never touches env files.
 *
 * Endpoints used by the Tasks view:
 *   - GET  /health                    → service reachable?
 *   - GET  /tasks                     → list of tasks
 *   - POST /generate  {"items":[...]} → (re)queue marker_views for embedding (202)
 *
 * Those shapes are tolerant on purpose: the service contract is still settling,
 * so we normalise whatever record-ish object comes back instead of failing hard.
 */

import { env } from '$env/dynamic/private';
import { normalizeRecordId } from '$lib/transform/to-table';
import { normalizeStatus, type EmbeddingTask } from '$lib/embedding-types';

export const EMBEDDING_SERVICE_DEFAULT = 'http://localhost:8030';

/** Configurable embedding service origin from `EMBEDDING_SERVICE_URL`. */
export function embeddingServiceUrl(): string {
	return env.EMBEDDING_SERVICE_URL || EMBEDDING_SERVICE_DEFAULT;
}

/** Failure talking to the embedding service (carries an HTTP-ish status). */
export class EmbeddingServiceError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'EmbeddingServiceError';
		this.status = status;
		this.code = code;
	}
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
	// Surreal datetime objects / other wrappers → best-effort string
	const s = String(value);
	return s && s !== '[object Object]' ? s : null;
}

function coerceText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function coerceId(...values: unknown[]): string {
	for (const value of values) {
		const id = normalizeRecordId(value);
		if (id) return id;
	}
	return '';
}

/** Normalise one task-ish object from the service into a typed shape. */
function toEmbeddingTask(raw: unknown): EmbeddingTask | null {
	if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;

	const id = coerceId(r.id, r.record_id, r.recordId, r.task_id);
	if (!id) return null;

	return {
		id,
		data: coerceId(r.data, r.marker, r.marker_view, r.view, r.marker_views, r.record_id) || null,
		status: normalizeStatus(r.status ?? r.state),
		error: coerceText(r.error ?? r.error_message ?? r.message ?? r.detail),
		updatedAt: coerceTime(r.updated_at ?? r.updatedAt ?? r.created_at ?? r.finished_at),
		version: coerceVersion(r.version ?? r.version_snapshot)
	};
}

type FetchImpl = typeof globalThis.fetch;

async function requestJson(
	url: string,
	fetchImpl: FetchImpl,
	init: RequestInit
): Promise<unknown> {
	const response = await fetchImpl(url, init);
	const text = await response.text();
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = null;
	}

	if (!response.ok) {
		const detail =
			(asRecord(body)?.message as string | undefined) ||
			(asRecord(body)?.detail as string | undefined) ||
			(asRecord(body)?.error as string | undefined) ||
			response.statusText ||
			'Embedding service error';
		throw new EmbeddingServiceError(response.status, 'service_error', String(detail));
	}

	return body;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** `GET /health` — true when the service answers 2xx. */
export async function serviceHealth(fetchImpl: FetchImpl = fetch): Promise<boolean> {
	try {
		await requestJson(`${embeddingServiceUrl()}/health`, fetchImpl, { method: 'GET' });
		return true;
	} catch {
		return false;
	}
}

/** `GET /tasks` — returns a normalised list (empty on malformed / unreachable). */
export async function listServiceTasks(fetchImpl: FetchImpl = fetch): Promise<EmbeddingTask[]> {
	const body = await requestJson(`${embeddingServiceUrl()}/tasks`, fetchImpl, { method: 'GET' });

	let list: unknown[] = [];
	if (Array.isArray(body)) {
		list = body;
	} else {
		const record = asRecord(body);
		if (record) {
			if (Array.isArray(record.tasks)) {
				list = record.tasks;
			} else if (Array.isArray(record.items)) {
				list = record.items;
			} else if (Array.isArray(record.results)) {
				list = record.results;
			} else {
				// Dict form: { "marker_views:<id>": { status, error, ... }, ... }
				list = Object.entries(record)
					.filter(([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value))
					.map(([key, value]) => ({ id: key, record_id: key, ...(value as Record<string, unknown>) }));
			}
		}
	}

	return list.map(toEmbeddingTask).filter((task): task is EmbeddingTask => task !== null);
}

/** `POST /generate` — queue the given `marker_views:<id>` items for embedding. */
export async function generateEmbeddings(
	items: string[],
	fetchImpl: FetchImpl = fetch
): Promise<void> {
	await requestJson(`${embeddingServiceUrl()}/generate`, fetchImpl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ items })
	});
}