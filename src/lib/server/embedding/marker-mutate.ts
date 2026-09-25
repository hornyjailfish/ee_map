/**
 * Embedding marker write seam.
 *
 * Creates an `embeddings` row (marker point + description + structured context),
 * then computes text/image vectors server-side and stores them. If the embedding
 * service is unreachable, the row **still saves** with `embedding_status: 'failed'`
 * so no marker is lost; callers can retry via {@link reembedMarker}.
 */

import { Geometry, StringRecordId, type Surreal } from 'surrealdb';
import { normalizeRecordId } from '$lib/transform/to-table';
import { MutateError, tableOfId, validateRecordId } from '$lib/server/data/mutate';
import { queryRecordById } from '$lib/server/data/query-record';
import { createEmbeddingClient, type EmbeddingClient } from '$lib/server/embedding/client';
import type { MarkerPoint } from '$lib/server/embedding/marker-context';

export type MarkerEmbeddingStatus = 'pending' | 'done' | 'failed';

export type CreateEmbeddingMarkerInput = {
	description: string;
	levelId: string;
	zoneId?: string | null;
	shopId?: string | null;
	point: MarkerPoint;
	/** Optional base64 data URL for an image-marker (image vector only). */
	image?: string | null;
};

export type CreateEmbeddingMarkerResult = {
	id: string;
	/** Computed on save; `failed` means the service was unreachable (retryable). */
	status: MarkerEmbeddingStatus;
	error?: string;
};

function recordLink(value: string | null | undefined): StringRecordId | undefined {
	if (!value || value.trim() === '') return undefined;
	validateRecordId(value);
	return new StringRecordId(value);
}

function assertLevelLink(value: string): StringRecordId {
	validateRecordId(value);
	if (tableOfId(value) !== 'levels') {
		throw new MutateError(400, 'invalid_level', `Field 'level' must reference a levels record`);
	}
	return new StringRecordId(value);
}

function pointGeometry(point: MarkerPoint): Geometry {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		throw new MutateError(400, 'invalid_point', 'Marker point must be finite x/y');
	}
	return Geometry.fromJSON({
		type: 'Point',
		coordinates: [point.x, point.y]
	} as Parameters<typeof Geometry.fromJSON>[0]);
}

/**
 * Compute + store vectors for one marker. Always returns a status; never throws
 * on embedding failure (the caller already persisted the marker).
 */
async function computeAndStoreVectors(
	session: Surreal,
	id: string,
	description: string,
	image: string | null | undefined,
	client: EmbeddingClient
): Promise<{ status: MarkerEmbeddingStatus; error?: string }> {
	const patch: Record<string, unknown> = { embedding_model: client.model };

	const text = description.trim();
	const hasText = text.length > 0;
	const hasImage = Boolean(image && image.trim().length > 0);

	try {
		if (hasText) patch.text_embedding = await client.embedText(text);
		if (hasImage) patch.image_embedding = await client.embedImage(image!);
		patch.embedding_status = 'done';
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Embedding failed';
		patch.embedding_status = 'failed';
		try {
			await session.query('UPDATE type::record($id) MERGE $patch', { id, patch });
		} catch (updateError) {
			console.warn('[embedding] failed to record failure status:', updateError);
		}
		return { status: 'failed', error: message };
	}

	try {
		await session.query('UPDATE type::record($id) MERGE $patch', { id, patch });
		return { status: 'done' };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Embedding store failed';
		return { status: 'failed', error: message };
	}
}

export async function createEmbeddingMarker(
	session: Surreal,
	input: CreateEmbeddingMarkerInput,
	client: EmbeddingClient = createEmbeddingClient()
): Promise<CreateEmbeddingMarkerResult> {
	const description = typeof input.description === 'string' ? input.description : '';
	const level = assertLevelLink(input.levelId);

	const data: Record<string, unknown> = {
		description: description || undefined,
		level,
		marker: pointGeometry(input.point),
		embedding_model: client.model,
		embedding_status: 'pending'
	};

	const zone = recordLink(input.zoneId ?? null);
	if (zone) data.zone = zone;
	const shop = recordLink(input.shopId ?? null);
	if (shop) data.shop = shop;

	let id: string;
	try {
		const [created] = await session.query<[Record<string, unknown>[] | Record<string, unknown>]>(
			'CREATE type::table("embeddings") CONTENT $data RETURN id',
			{ data }
		);
		const row = Array.isArray(created) ? created[0] : created;
		id = normalizeRecordId(row?.id);
		if (!id) {
			throw new MutateError(500, 'create_failed', 'Failed to create embeddings row');
		}
	} catch (error) {
		if (error instanceof MutateError) throw error;
		throw new MutateError(
			500,
			'create_failed',
			error instanceof Error ? error.message : 'Failed to create embeddings row'
		);
	}

	const result = await computeAndStoreVectors(
		session,
		id,
		description,
		input.image ?? null,
		client
	);
	return { id, status: result.status, error: result.error };
}

/**
 * Recompute vectors for an existing marker (retry after a failure, or after a
 * model change). Reads the row's stored description/image.
 */
export async function reembedMarker(
	session: Surreal,
	id: string,
	client: EmbeddingClient = createEmbeddingClient()
): Promise<{ status: MarkerEmbeddingStatus; error?: string }> {
	validateRecordId(id);
	if (tableOfId(id) !== 'embeddings') {
		throw new MutateError(400, 'invalid_id', 'Marker id must reference `embeddings`');
	}

	const row = await queryRecordById(session, id);
	if (!row) {
		throw new MutateError(404, 'not_found', `Marker not found: ${id}`);
	}

	const description = typeof row.description === 'string' ? row.description : '';
	const image = typeof row.image === 'string' ? row.image : null;
	return computeAndStoreVectors(session, id, description, image, client);
}

/**
 * Re-embed a marker after a scalar edit, when that edit invalidates a stored
 * vector (text → `description`, image → `image`). No-op for other tables/fields.
 * Call twice-per-write from the generic patch seams (table cell, map props).
 */
export async function reembedMarkerAfterEdit(
	session: Surreal,
	table: string,
	id: string,
	editedFields: Iterable<string>,
	client: EmbeddingClient = createEmbeddingClient()
): Promise<void> {
	if (table !== 'embeddings') return;
	const changed = new Set(editedFields);
	if (!changed.has('description') && !changed.has('image')) return;
	await reembedMarker(session, id, client);
}
