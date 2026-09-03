import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ResolvedConfig, ResolvedEdge } from '$lib/config/types';
import {
	assertCanEdit,
	isValidTableName,
	MutateError,
	queryGraphBundle,
	relateConnect,
	unrelateConnect
} from '$lib/server/data';
import { resolveAppConfig } from '$lib/server/config';
import { getUserRoles } from '$lib/server/catalog';
import { stripGraphForClient } from '$lib/transform/strip-graph';
import { toGraph, type GraphViewModel } from '$lib/transform/to-graph';

export type GraphPageData = {
	/** Graph without positions; client runs ELK. Null when nothing to show. */
	graph: GraphViewModel | null;
	/** Default relation table for wire create/delete (first non-ignore). */
	relation: string | null;
	/** Non-fatal load / validation message. */
	error: string | null;
};

function emptyPage(partial?: Partial<GraphPageData>): GraphPageData {
	return {
		graph: null,
		relation: null,
		error: null,
		...partial
	};
}

/** Prefer `connects`, else first non-ignore relation. */
function pickRelation(config: ResolvedConfig): ResolvedEdge | null {
	const active = config.relations.filter((r) => r.role !== 'ignore');
	if (active.length === 0) return null;
	return active.find((r) => r.name === 'connects') ?? active[0] ?? null;
}

function relationByName(config: ResolvedConfig, name: string): ResolvedEdge | null {
	return config.relations.find((r) => r.name === name && r.role !== 'ignore') ?? null;
}

async function resolveForWire(
	locals: App.Locals,
	fetch: typeof globalThis.fetch,
	relationName: unknown
): Promise<ResolvedEdge> {
	if (!locals.session?.isConnected) {
		throw new MutateError(503, 'db_unavailable', 'Database unavailable');
	}

	const [config, roles] = await Promise.all([
		resolveAppConfig(locals.session),
		getUserRoles(locals.selection.namespace, locals.user, fetch)
	]);

	// VIEWER is rejected here — connect/disconnect never proceed without EDITOR/OWNER.
	assertCanEdit(roles);

	const name =
		typeof relationName === 'string' && relationName.trim()
			? relationName.trim()
			: pickRelation(config)?.name;

	if (!name || !isValidTableName(name)) {
		throw new MutateError(400, 'invalid_table', 'Invalid relation name');
	}

	const relation = relationByName(config, name);
	if (!relation) {
		throw new MutateError(404, 'unknown_relation', `Unknown relation: ${name}`);
	}
	return relation;
}

function failFromError(error: unknown) {
	if (error instanceof MutateError) {
		return fail(error.status, { code: error.code, message: error.message });
	}
	const message = error instanceof Error ? error.message : 'Write failed';
	console.warn('[graph] write failed:', message);
	return fail(500, { code: 'write_failed', message });
}

export const actions: Actions = {
	connect: async ({ request, locals, fetch }) => {
		const data = await request.formData();
		const relation = data.get('relation');
		const inId = String(data.get('in') ?? '');
		const outId = String(data.get('out') ?? '');
		const cable = data.get('cable');

		try {
			const edge = await resolveForWire(locals, fetch, relation);
			const meta: Record<string, unknown> = {};
			if (typeof cable === 'string' && cable.trim()) meta.cable = cable.trim();
			const id = await relateConnect(locals.session!, edge, inId, outId, meta);
			return { ok: true, id };
		} catch (error) {
			return failFromError(error);
		}
	},

	disconnect: async ({ request, locals, fetch }) => {
		const data = await request.formData();
		const relation = data.get('relation');
		const edgeId = String(data.get('id') ?? '');

		try {
			const edge = await resolveForWire(locals, fetch, relation);
			await unrelateConnect(locals.session!, edge, edgeId);
			return { ok: true };
		} catch (error) {
			return failFromError(error);
		}
	}
};

export const load: PageServerLoad = async ({ parent, locals }): Promise<GraphPageData> => {
	const layout = await parent();
	const config = layout.config;
	const configError = layout.configError ?? null;

	if (!config) {
		return emptyPage({
			error:
				configError ??
				locals.dbError ??
				(locals.session?.isConnected
					? 'Config unavailable'
					: 'No resolved config (session offline)')
		});
	}

	if (!locals.session?.isConnected) {
		return emptyPage({
			error: locals.dbError ?? 'Database unavailable'
		});
	}

	const graphTables = config.tables.filter((t) => t.graph != null && t.graph.role !== 'ignore');
	const defaultRelation = pickRelation(config);

	if (graphTables.length === 0) {
		return emptyPage({
			relation: defaultRelation?.name ?? null,
			error: 'No graph entities in resolved config (assign graph.role in overlay)'
		});
	}

	try {
		const { bundle, errors } = await queryGraphBundle(locals.session, config);
		const model = toGraph({
			config,
			entities: bundle.entities,
			relations: bundle.relations
		});
		const graph = stripGraphForClient(model);

		const parts: string[] = [];
		if (errors.length) parts.push(errors.join('; '));
		if (graph.nodes.length === 0 && graphTables.length > 0) {
			parts.push('No graph nodes loaded');
		}

		return {
			graph,
			relation: defaultRelation?.name ?? null,
			error: parts.length ? parts.join(' · ') : null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load graph data';
		console.warn('[graph] queryGraphBundle failed:', message);
		return emptyPage({
			relation: defaultRelation?.name ?? null,
			error: message
		});
	}
};
