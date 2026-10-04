/**
 * Indoor marker write seam.
 *
 * The embedding dataset is split across two tables:
 * - `markers`      — metainfo + the point geometry (`level`, `zone`, `closest_shop`)
 * - `marker_views` — userfacing description (`user_description` →
 *                    `generated_description` computed by the DB) and the vector
 *                    holder filled by the separate embedding pipeline.
 *
 * Generating embeddings itself is **out of scope** here: edits to a
 * `marker_views` row are queued in `embedding_queue` by a DB event and a
 * separate project consumes that queue.
 */

import { FileRef, Geometry, StringRecordId, type Surreal } from 'surrealdb';
import { normalizeRecordId } from '$lib/transform/to-table';
import { MutateError, tableOfId, validateRecordId } from '$lib/server/data/mutate';
import type { MarkerPoint } from '$lib/server/embedding/marker-context';

export type CreateMarkerInput = {
	/** Editor-owned text; stored as `marker_views.user_description`. */
	description: string;
	levelId: string;
	zoneId?: string | null;
	/** Nearest rented area; stored as `markers.closest_shop` (record<rents>). */
	rentId?: string | null;
	point: MarkerPoint;
	/** Optional image as a base64 data URL, uploaded to the `images` bucket. */
	image?: string | null;
};

export type CreateMarkerResult = {
	/** `markers` id — the map layer / focus target. */
	id: string;
	/** `marker_views` id — the userfacing row. */
	viewId: string;
	/** `images:/...` reference when an image was uploaded, else null. */
	imageUrl: string | null;
};

const IMAGE_BUCKET = 'images';

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

function assertRentLink(value: string | null | undefined): StringRecordId | undefined {
	if (!value) return undefined;
	validateRecordId(value);
	if (tableOfId(value) !== 'rents') {
		throw new MutateError(400, 'invalid_rent', `Field 'closest_shop' must reference a rents record`);
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

type PreparedImage = {
	ref: FileRef;
	bytes: Uint8Array;
};

/** Parse a base64 data URL into image bytes + a deterministically keyed file ref. */
function prepareImage(image: string | null | undefined): PreparedImage | null {
	if (!image || image.trim() === '') return null;
	const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(image.trim());
	if (!match) return null;

	const mime = match[1]!;
	const b64 = match[2]!;
	let bytes: Uint8Array;
	try {
		bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
	} catch {
		return null;
	}
	if (bytes.length === 0) return null;

	const key = `${imageKey()}${mimeToExt(mime)}`;
	return { ref: new FileRef(IMAGE_BUCKET, key), bytes };
}

function mimeToExt(mime: string): string {
	switch (mime) {
		case 'image/png':
			return '.png';
		case 'image/jpeg':
			return '.jpg';
		case 'image/webp':
			return '.webp';
		case 'image/gif':
			return '.gif';
		case 'image/svg+xml':
			return '.svg';
		default:
			return '';
	}
}

function imageKey(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid) return uuid;
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function markerError(error: unknown): MutateError {
	if (error instanceof MutateError) return error;
	return new MutateError(
		500,
		'create_failed',
		error instanceof Error ? error.message : 'Failed to create marker rows'
	);
}

/**
 * Create one indoor marker plus its linked `marker_views` row.
 *
 * Order (per product flow):
 *   1. reserve an image file pointer (no bytes written yet)
 *   2. create `markers`, then `marker_views` (marker is rolled back if the view fails)
 *   3. after the records exist, write the image bytes into the reserved file ref
 *
 * The image upload is intentionally last and non-fatal — a working marker never
 * depends on the bucket backend being reachable.
 */
export async function createMarker(
	session: Surreal,
	input: CreateMarkerInput
): Promise<CreateMarkerResult> {
	const description = typeof input.description === 'string' ? input.description : '';
	const level = assertLevelLink(input.levelId);
	const image = prepareImage(input.image ?? null);

	// 1. Reserved file pointer (bytes written later).
	const imageUrl = image ? image.ref.toString() : null;

	const markerData: Record<string, unknown> = {
		level,
		geometry: pointGeometry(input.point)
	};

	const zone = recordLink(input.zoneId ?? null);
	if (zone) markerData.zone = zone;
	const rent = assertRentLink(input.rentId ?? null);
	if (rent) markerData.closest_shop = rent;

	// 2. Create marker, then view; roll back the marker if the view fails (HTTP
	//    engine has no transactions, so compensation keeps the pair atomic).
	let id: string | null = null;
	let viewId: string;
	try {
		const [created] = await session.query<[Record<string, unknown>[] | Record<string, unknown>]>(
			'CREATE type::table("markers") CONTENT $data RETURN id',
			{ data: markerData }
		);
		id = normalizeRecordId(Array.isArray(created) ? created[0]?.id : created?.id);
		if (!id) {
			throw new MutateError(500, 'create_failed', 'Failed to create markers row');
		}

		const viewData: Record<string, unknown> = {
			marker: new StringRecordId(id),
			user_description: description || undefined
		};
		if (imageUrl) viewData.image_url = imageUrl;

		const [view] = await session.query<[Record<string, unknown>[] | Record<string, unknown>]>(
			'CREATE type::table("marker_views") CONTENT $view RETURN id',
			{ view: viewData }
		);
		viewId = normalizeRecordId(Array.isArray(view) ? view[0]?.id : view?.id);
		if (!viewId) {
			throw new MutateError(500, 'create_failed', 'Failed to create marker_views row');
		}
	} catch (error) {
		if (id) {
			try {
				await session.query('DELETE type::record($id)', { id });
			} catch {
				// best-effort rollback
			}
		}
		throw markerError(error);
	}

	// 3. Write the image bytes into the reserved file ref (non-fatal).
	if (image) {
		try {
			await session.query('RETURN file::put($ref, $data)', { ref: image.ref, data: image.bytes });
		} catch (error) {
			console.warn('[marker] image upload failed:', error instanceof Error ? error.message : error);
		}
	}

	return { id, viewId, imageUrl };
}

export type CreateMarkerViewInput = {
	/** Existing `markers` record the new view references. */
	markerId: string;
	/** Editor-owned text; stored as `marker_views.user_description`. */
	description: string;
	/** Optional image as a base64 data URL, uploaded to the `images` bucket. */
	image?: string | null;
};

/**
 * Create a `marker_views` row for an existing marker (no `markers` row is
 * created). Mirrors {@link createMarker}'s view-handling: reserve the image
 * pointer, create the row, then write the image bytes (non-fatal).
 */
export async function createMarkerView(
	session: Surreal,
	input: CreateMarkerViewInput
): Promise<{ viewId: string }> {
	const markerId = validateRecordId(input.markerId.trim());
	if (tableOfId(markerId) !== 'markers') {
		throw new MutateError(400, 'invalid_marker', 'marker must reference a markers record');
	}

	const description = typeof input.description === 'string' ? input.description : '';
	const image = prepareImage(input.image ?? null);
	const imageUrl = image ? image.ref.toString() : null;

	const viewData: Record<string, unknown> = {
		marker: new StringRecordId(markerId),
		user_description: description || undefined
	};
	if (imageUrl) viewData.image_url = imageUrl;

	const [view] = await session.query<[Record<string, unknown>[] | Record<string, unknown>]>(
		'CREATE type::table("marker_views") CONTENT $view RETURN id',
		{ view: viewData }
	);
	const viewId = normalizeRecordId(Array.isArray(view) ? view[0]?.id : view?.id);
	if (!viewId) {
		throw new MutateError(500, 'create_failed', 'Failed to create marker_views row');
	}

	if (image) {
		try {
			await session.query('RETURN file::put($ref, $data)', { ref: image.ref, data: image.bytes });
		} catch (error) {
			console.warn('[marker] image upload failed:', error instanceof Error ? error.message : error);
		}
	}

	return { viewId };
}
