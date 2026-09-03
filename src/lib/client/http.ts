/**
 * Client HTTP helpers.
 *
 * Form actions (`fetch('?/action')`) do **not** use bare `response.ok`.
 * SvelteKit returns an ActionResult payload; use {@link postFormAction}.
 *
 * For real HTTP status APIs (`+server.ts`), use {@link apiJson}.
 */

import { deserialize } from '$app/forms';
import type { ActionResult } from '@sveltejs/kit';

/** Failed form action or JSON API call. */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly data?: Record<string, unknown>;

	constructor(status: number, code: string, message: string, data?: Record<string, unknown>) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.data = data;
	}
}

type FailureData = {
	code?: string;
	message?: string;
	[key: string]: unknown;
};

/**
 * POST to a page form action (`?/name`) and interpret the ActionResult.
 *
 * SvelteKit often responds with **HTTP 200** and encodes failure as:
 * `{ type: 'failure', status: 400, data: { message, code } }`.
 * Checking only `response.ok` will miss those — this helper uses `deserialize`.
 *
 * @param action Action name without `?/` (e.g. `'connect'`, `'updateCell'`).
 * @param fields Plain fields → FormData (nullish skipped).
 * @returns Success `data` (or `{}` when the action returned nothing).
 */
export async function postFormAction<T extends Record<string, unknown> = Record<string, unknown>>(
	action: string,
	fields: Record<string, unknown> = {}
): Promise<T> {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (value != null) form.set(key, String(value));
	}

	const response = await fetch(`?/${action}`, {
		method: 'POST',
		body: form,
		headers: {
			// Prefer ActionResult body over full HTML page on error paths
			accept: 'application/json',
			'x-sveltekit-action': 'true'
		}
	});

	const text = await response.text();
	let result: ActionResult<T, FailureData>;
	try {
		result = deserialize(text) as ActionResult<T, FailureData>;
	} catch {
		// Non-ActionResult body (unexpected HTML / plain text)
		if (!response.ok) {
			throw new ApiError(response.status, 'http_error', text.slice(0, 200) || response.statusText);
		}
		throw new ApiError(500, 'invalid_action_result', 'Invalid form action response');
	}

	return unwrapActionResult(result);
}

/** Turn an ActionResult into data or throw {@link ApiError}. */
export function unwrapActionResult<T extends Record<string, unknown>>(
	result: ActionResult<T, FailureData>
): T {
	switch (result.type) {
		case 'success':
			return (result.data ?? {}) as T;
		case 'failure': {
			const data = (result.data ?? {}) as FailureData;
			const message =
				typeof data.message === 'string' && data.message
					? data.message
					: `Request failed (${result.status})`;
			const code = typeof data.code === 'string' ? data.code : 'action_failed';
			throw new ApiError(result.status, code, message, data);
		}
		case 'error': {
			const err = result.error;
			const message =
				err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
					? err.message
					: 'Request failed';
			throw new ApiError(result.status ?? 500, 'action_error', message);
		}
		case 'redirect':
			// Mutations shouldn't redirect; surface rather than silently navigate.
			throw new ApiError(result.status, 'redirect', `Redirected to ${result.location}`);
		default:
			throw new ApiError(500, 'unknown_result', 'Unknown form action result');
	}
}

/**
 * fetch JSON from a `+server.ts` route.
 * Failures must set a real non-2xx HTTP status + `{ code?, message? }` body.
 */
export async function apiJson<T = unknown>(
	url: string,
	init?: RequestInit & { json?: unknown }
): Promise<T> {
	const headers = new Headers(init?.headers);
	headers.set('accept', 'application/json');

	let body = init?.body;
	if (init && 'json' in init && init.json !== undefined) {
		headers.set('content-type', 'application/json');
		body = JSON.stringify(init.json);
	}

	const { json: _json, ...rest } = (init ?? {}) as RequestInit & { json?: unknown };
	const response = await fetch(url, { ...rest, headers, body });

	const payload = (await response.json().catch(() => ({}))) as T & FailureData;

	if (!response.ok) {
		throw new ApiError(
			response.status,
			typeof payload.code === 'string' ? payload.code : 'http_error',
			typeof payload.message === 'string' && payload.message
				? payload.message
				: response.statusText || 'Request failed',
			payload as Record<string, unknown>
		);
	}

	return payload;
}
