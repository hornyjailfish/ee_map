import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canEdit } from '$lib/roles';
import { getUserRoles } from '$lib/server/catalog';
import { embeddingServiceUrl } from '$lib/server/embedding/service';

/**
 * Same-origin SSE proxy for the embedding service's `GET /queue/stream` feed.
 *
 * The browser can't open an EventSource directly against `localhost:8030` (CORS),
 * and the service origin is server-side env anyway — so this route pipes the
 * upstream byte stream through verbatim. The client only ever talks to this app.
 */
export const GET: RequestHandler = async ({ locals, fetch }) => {
	const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);
	if (!canEdit(roles)) {
		error(403, 'Tasks stream requires EDITOR or OWNER role');
	}

	// Use the native fetch (not SvelteKit's) so the upstream response stays a true
	// streaming ReadableStream instead of being buffered.
	const upstream = await globalThis.fetch(`${embeddingServiceUrl()}/queue/stream`, {
		headers: { accept: 'text/event-stream' }
	});

	if (!upstream.ok || !upstream.body) {
		error(502, 'Embedding service stream unavailable');
	}

	return new Response(upstream.body, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no'
		}
	});
};