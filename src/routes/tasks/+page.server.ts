import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import { canEdit } from '$lib/roles';
import { getUserRoles } from '$lib/server/catalog';
import { loadTasks } from '$lib/server/embedding/tasks';
import {
	EmbeddingServiceError,
	generateEmbeddings
} from '$lib/server/embedding/service';
import type { TaskRow } from '$lib/embedding-types';

export type { TaskRow } from '$lib/embedding-types';

export type TasksPageData = {
	tasks: TaskRow[];
	dbTaskCount: number;
	serviceTaskCount: number;
	healthy: boolean;
	serviceError: string | null;
	dbError: string | null;
};

const regenerateSchema = z.object({ items: z.string().min(1) });

/** Make `/generate` items canonical: always `marker_views:<id>`. */
function toMarkerViewsItem(id: string): string | null {
	const value = id.trim();
	if (!value) return null;
	if (value.includes(':') && !value.startsWith('marker_views:')) {
		// embedding_queue:<key> uses the same key as marker_views:<key> (DB event).
		if (value.startsWith('embedding_queue:')) {
			return `marker_views:${value.slice('embedding_queue:'.length)}`;
		}
		return null;
	}
	return value;
}

function failFromError(err: unknown) {
	if (err instanceof EmbeddingServiceError) {
		return fail(err.status, { code: err.code, message: err.message });
	}
	const message = err instanceof Error ? err.message : 'Request failed';
	console.warn('[tasks] regenerate failed:', message);
	return fail(502, { code: 'generate_failed', message });
}

export const actions: Actions = {
	/** Requeue one or more `marker_views` for embedding via the service. */
	regenerate: async ({ request, locals, fetch }) => {
		const roles = await getUserRoles(locals.selection.namespace, locals.user, fetch);
		if (!canEdit(roles)) {
			return fail(403, { code: 'forbidden', message: 'Requires EDITOR or OWNER role' });
		}

		const parsed = regenerateSchema.safeParse(
			Object.fromEntries((await request.formData()).entries())
		);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Missing items' });
		}

		let raw: unknown;
		try {
			raw = JSON.parse(parsed.data.items);
		} catch {
			return fail(400, { code: 'invalid_items', message: 'Invalid items payload' });
		}

		const items = Array.isArray(raw)
			? raw.map((x) => (typeof x === 'string' ? toMarkerViewsItem(x) : null))
			: [toMarkerViewsItem(parsed.data.items)];

		const valid = items.filter((x): x is string => x !== null);
		if (valid.length === 0) {
			return fail(400, { code: 'invalid_items', message: 'No valid marker_views items' });
		}

		try {
			await generateEmbeddings(valid, fetch);
			return { ok: true as const, count: valid.length };
		} catch (err) {
			return failFromError(err);
		}
	}
};

export const load: PageServerLoad = async ({ parent, locals, fetch }): Promise<TasksPageData> => {
	const layout = await parent();
	const roles = layout.userRoles ?? [];

	// Client hides the link; server is the real gate (EDITOR or OWNER).
	if (!canEdit(roles)) {
		error(403, 'Tasks requires EDITOR or OWNER role');
	}

	const session = locals.session?.isConnected ? locals.session : null;
	const result = await loadTasks(session, fetch);

	return {
		tasks: result.tasks,
		dbTaskCount: result.dbTaskCount,
		serviceTaskCount: result.serviceTaskCount,
		healthy: result.healthy,
		serviceError: result.serviceError,
		dbError: result.dbError ?? (!session ? (locals.dbError ?? 'Database unavailable') : null)
	};
};