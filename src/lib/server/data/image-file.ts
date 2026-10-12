/**
 * Image file write seam for editable image fields (e.g. `marker_views.image_url`).
 *
 * Images live in the SurrealDB `images` bucket and are referenced by the field
 * value `images:<key>`. Replacing an image overwrites the bytes at that same key
 * via `file::put`, so the stored filename (and `image_url` value) never changes —
 * only the underlying bytes do. The marker_views `version` counter is bumped
 * afterwards so the separate embedding pipeline re-processes the new bytes.
 */

import { FileRef, type Surreal } from 'surrealdb';
import type { ResolvedEntity } from '$lib/config/types';
import { MutateError, validateRecordId, writableFields } from './mutate';

const IMAGE_BUCKET = 'images';
/** Safe field identifier for embedding in a SurrealQL SELECT. */
const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Stored file key is a plain `images` bucket path without traversal. */
const FILE_KEY_RE = /^[A-Za-z0-9_.\-/]+$/;

export type ImageFileRef = { bucket: string; key: string };

/** Parse a stored `images:<key>` file reference; null when not a plain images path. */
export function parseImageFileRef(value: unknown): ImageFileRef | null {
	if (typeof value !== 'string') return null;

	const trimmed = value.trim();
	const colon = trimmed.indexOf(':');
	if (colon <= 0 || colon === trimmed.length - 1) return null;

	const bucket = trimmed.slice(0, colon);
	const key = trimmed.slice(colon + 1);
	if (bucket !== IMAGE_BUCKET || !key || key.includes('..')) return null;
	if (!FILE_KEY_RE.test(key)) return null;

	return { bucket, key };
}

/** Parse a base64 image data URL into raw bytes; null when malformed / non-image. */
export function parseImageDataUrl(
	dataUrl: unknown
): { bytes: Uint8Array; mime: string } | null {
	if (typeof dataUrl !== 'string' || dataUrl.trim() === '') return null;
	const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
	if (!match) return null;

	let bytes: Uint8Array;
	try {
		bytes = Uint8Array.from(Buffer.from(match[2]!, 'base64'));
	} catch {
		return null;
	}
	if (bytes.length === 0) return null;

	return { bytes, mime: match[1]! };
}

/**
 * Overwrite the image referenced by `fieldName` on record `id` with new bytes.
 * The existing `images:<key>` reference is kept; only its file contents change.
 */
export async function replaceRecordImageFile(
	session: Surreal,
	entity: ResolvedEntity,
	id: string,
	fieldName: string,
	dataUrl: string
): Promise<void> {
	if (!FIELD_NAME_RE.test(fieldName)) {
		throw new MutateError(400, 'invalid_field', 'Invalid field name');
	}

	const writable = writableFields(entity);
	const target = writable.find((f) => f.name === fieldName);
	if (!target) {
		throw new MutateError(400, 'unknown_field', `Field '${fieldName}' is not editable on '${entity.name}'`);
	}
	if (target.field.type !== 'string') {
		throw new MutateError(400, 'invalid_image_field', `Field '${fieldName}' is not an image field`);
	}

	const image = parseImageDataUrl(dataUrl);
	if (!image) {
		throw new MutateError(400, 'invalid_image', 'Image must be a base64 data URL');
	}

	const recordId = validateRecordId(id);

	// Read the current value → must be a well-formed `images:<key>` reference.
	const [rows] = await session.query<[Record<string, unknown>[]]>(
		`SELECT ${fieldName} FROM type::record($id)`,
		{ id: recordId }
	);
	const ref = parseImageFileRef(rows?.[0]?.[fieldName]);
	if (!ref) {
		throw new MutateError(400, 'invalid_image_ref', 'Record has no image reference to replace');
	}

	await session.query('RETURN file::put($ref, $data)', {
		ref: new FileRef(ref.bucket, ref.key),
		data: image.bytes
	});

	// image_url is unchanged (same filename), so the DB's add_embedding_task event
	// won't fire on its own. Bump the version counter to re-queue embedding renewal.
	if (entity.name === 'marker_views') {
		await bumpMarkerVersion(session, recordId);
	}
}

/** Bump `marker_views.version` + re-enqueue, mirroring `add_embedding_task`. */
async function bumpMarkerVersion(session: Surreal, recordId: string): Promise<void> {
	try {
		const [rows] = await session.query<[Record<string, unknown>[]]>(
			'SELECT version FROM type::record($id)',
			{ id: recordId }
		);
		const current = typeof rows?.[0]?.version === 'number' ? rows[0].version : 0;
		const next = current + 1;
		const queueId = `embedding_queue:${recordId.slice(recordId.indexOf(':') + 1)}`;

		await session.query(
			'UPDATE type::record($record) SET version = $version; ' +
				'UPSERT type::record($queue) SET data = type::record($record), version_snapshot = $version;',
			{ record: recordId, version: next, queue: queueId }
		);
	} catch (error) {
		// Non-fatal: the file bytes are already replaced even if the version
		// bookkeeping / queue re-enqueue did not run.
		console.warn('[table] image version bump failed:', error instanceof Error ? error.message : error);
	}
}