/**
 * GET /map/marker-image?id=marker_views:<id> — stream a marker view's image.
 *
 * `marker_views.image_url` stores a SurrealDB `file` reference whose bytes live
 * in the `images` bucket. We re-read the row server-side so the client can't
 * point this endpoint at arbitrary bucket keys, then stream the bytes back
 * through `file::get` with the correct content type.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MutateError, parseImageFileRef, tableOfId, validateRecordId } from '$lib/server/data';

function contentTypeForKey(key: string): string {
	const lower = key.toLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.svg')) return 'image/svg+xml';
	return 'application/octet-stream';
}

/** SDK decodes `file::get` bytes to `ArrayBuffer` (Node) or `Uint8Array`; tolerate a wrapping array. */
function toBytes(value: unknown): ArrayBuffer | Uint8Array | null {
	if (value instanceof ArrayBuffer) return value;
	if (value instanceof Uint8Array) return value;
	if (Array.isArray(value)) {
		const first = value[0];
		if (first instanceof ArrayBuffer) return first;
		if (first instanceof Uint8Array) return first;
	}
	return null;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.session?.isConnected) {
		error(503, 'Database unavailable');
	}

	const id = url.searchParams.get('id') ?? '';
	try {
		validateRecordId(id);
	} catch {
		error(400, 'Invalid marker view id');
	}
	if (tableOfId(id) !== 'marker_views') {
		error(400, 'Invalid marker view id');
	}

	let imageUrl: unknown;
	try {
		const [rows] = await locals.session.query<[Record<string, unknown>[]]>(
			'SELECT image_url FROM type::record($id)',
			{ id }
		);
		imageUrl = rows?.[0]?.image_url;
	} catch (err) {
		if (err instanceof MutateError) error(err.status, err.message);
		const message = err instanceof Error ? err.message : 'failed to read marker view';
		console.warn('[map/marker-image] load:', message);
		error(500, message);
	}

	const ref = parseImageFileRef(imageUrl);
	if (!ref) {
		error(404, 'Marker view image reference is malformed');
	}

	let bytes: ArrayBuffer | Uint8Array | null = null;
	try {
		const [frame] = await locals.session.query<[unknown]>('RETURN file::get($ref)', {
			ref
		});
		bytes = toBytes(frame);
	} catch (err) {
		if (err instanceof MutateError) error(err.status, err.message);
		const message = err instanceof Error ? err.message : 'failed to read image';
		console.warn('[map/marker-image] file::get:', message);
		error(500, message);
	}

	if (!bytes || bytes.byteLength === 0) {
		error(404, 'Image is empty or unavailable');
	}

	// `Response` accepts an `ArrayBuffer`; a `Uint8Array` view is sliced into one.
	const data = bytes instanceof ArrayBuffer ? bytes : bytes.slice().buffer;
	return new Response(data, {
		status: 200,
		headers: {
			'content-type': contentTypeForKey(ref.key),
			'cache-control': 'private, no-store'
		}
	});
};
