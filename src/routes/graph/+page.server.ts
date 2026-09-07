import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import type { ResolvedConfig, ResolvedEdge } from '$lib/config/types';
import {
	assertCanEdit,
	createRecord,
	deleteRecord,
	isValidTableName,
	loadRecordOptions,
	MutateError,
	queryGraphBundle,
	relateConnect,
	type RecordOption,
	unrelateConnect
} from '$lib/server/data';
import { resolveAppConfig } from '$lib/server/config';
import { getUserRoles } from '$lib/server/catalog';
import { buildGraphCrudMeta, type GraphCrudMeta } from '$lib/transform/graph-crud';
import { stripGraphForClient } from '$lib/transform/strip-graph';
import { toGraph, type GraphViewModel } from '$lib/transform/to-graph';
import { entityByName } from '$lib/transform/to-table';

const connectSchema = z.object({
	relation: z.string().optional(),
	in: z.string().default(''),
	out: z.string().default(''),
	cable: z.string().optional()
});
const disconnectSchema = z.object({ relation: z.string().optional(), id: z.string().default('') });
const addNodeSchema = z.record(z.string(), z.string());
const deleteNodeSchema = z.object({ table: z.string().default(''), id: z.string().default('') });

export type GraphPageData = {
	/** Graph without positions; client runs ELK. Null when nothing to show. */
	graph: GraphViewModel | null;
	/** Default relation table for wire create/delete (first non-ignore). */
	relation: string | null;
	/** Create/delete gates for node toolbars (null when offline / no config). */
	crud: GraphCrudMeta | null;
	/** Add-row record pickers keyed by child table → field name. */
	recordOptionsByTable: Record<string, Record<string, RecordOption[]>>;
	/** Non-fatal load / validation message. */
	error: string | null;
};

function emptyPage(partial?: Partial<GraphPageData>): GraphPageData {
	return {
		graph: null,
		relation: null,
		crud: null,
		recordOptionsByTable: {},
		error: null,
		...partial
	};
}

/** Load add-row picker options for every child table reachable from graph parents. */
async function loadChildRecordOptions(
	session: NonNullable<App.Locals['session']>,
	config: ResolvedConfig,
	crud: GraphCrudMeta
): Promise<Record<string, Record<string, RecordOption[]>>> {
	const childTables = new Set(
		Object.values(crud.createByParentTable).map((s) => s.childTable)
	);
	const out: Record<string, Record<string, RecordOption[]>> = {};
	await Promise.all(
		[...childTables].map(async (name) => {
			const entity = entityByName(config, name);
			if (!entity) return;
			out[name] = await loadRecordOptions(session, config, entity);
		})
	);
	return out;
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

/** Resolve roles + entity for domain node create/delete. */
async function resolveForNodeWrite(
	locals: App.Locals,
	fetch: typeof globalThis.fetch,
	table: unknown
) {
	if (!locals.session?.isConnected) {
		throw new MutateError(503, 'db_unavailable', 'Database unavailable');
	}
	if (typeof table !== 'string' || !isValidTableName(table)) {
		throw new MutateError(400, 'invalid_table', 'Invalid table name');
	}

	const [config, roles] = await Promise.all([
		resolveAppConfig(locals.session),
		getUserRoles(locals.selection.namespace, locals.user, fetch)
	]);

	assertCanEdit(roles);

	const entity = entityByName(config, table);
	if (!entity) {
		throw new MutateError(404, 'unknown_table', `Unknown table: ${table}`);
	}
	return entity;
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
		const parsed = connectSchema.safeParse(Object.fromEntries((await request.formData()).entries()));
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const { relation, in: inId, out: outId, cable } = parsed.data;

		try {
			const edge = await resolveForWire(locals, fetch, relation);
			const meta: Record<string, unknown> = {};
			if (cable?.trim()) meta.cable = cable.trim();
			const id = await relateConnect(locals.session!, edge, inId, outId, meta);
			return { ok: true, id };
		} catch (error) {
			return failFromError(error);
		}
	},

	disconnect: async ({ request, locals, fetch }) => {
		const parsed = disconnectSchema.safeParse(
			Object.fromEntries((await request.formData()).entries())
		);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const { relation, id: edgeId } = parsed.data;

		try {
			const edge = await resolveForWire(locals, fetch, relation);
			await unrelateConnect(locals.session!, edge, edgeId);
			return { ok: true };
		} catch (error) {
			return failFromError(error);
		}
	},

	addNode: async ({ request, locals, fetch }) => {
		const parsed = addNodeSchema.safeParse(
			Object.fromEntries((await request.formData()).entries())
		);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const { table, ...values } = parsed.data;

		try {
			const entity = await resolveForNodeWrite(locals, fetch, table);
			const id = await createRecord(locals.session!, entity, values);
			return { ok: true, id };
		} catch (error) {
			return failFromError(error);
		}
	},

	deleteNode: async ({ request, locals, fetch }) => {
		const parsed = deleteNodeSchema.safeParse(
			Object.fromEntries((await request.formData()).entries())
		);
		if (!parsed.success) {
			return fail(400, { code: 'invalid_form', message: 'Invalid form data' });
		}
		const { table, id } = parsed.data;

		try {
			const entity = await resolveForNodeWrite(locals, fetch, table);
			await deleteRecord(locals.session!, entity, id);
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

	const crud = buildGraphCrudMeta(config);

	if (!locals.session?.isConnected) {
		return emptyPage({
			crud,
			error: locals.dbError ?? 'Database unavailable'
		});
	}

	const graphTables = config.tables.filter((t) => t.graph != null && t.graph.role !== 'ignore');
	const defaultRelation = pickRelation(config);

	if (graphTables.length === 0) {
		return emptyPage({
			relation: defaultRelation?.name ?? null,
			crud,
			error: 'No graph entities in resolved config (assign graph.role in overlay)'
		});
	}

	try {
			const [{ bundle, errors }, recordOptionsByTable] = await Promise.all([
				queryGraphBundle(locals.session, config),
				loadChildRecordOptions(locals.session, config, crud)
			]);
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
				crud,
				recordOptionsByTable,
				error: parts.length ? parts.join(' · ') : null
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load graph data';
			console.warn('[graph] queryGraphBundle failed:', message);
			return emptyPage({
				relation: defaultRelation?.name ?? null,
				crud,
				error: message
			});
		}
	};
