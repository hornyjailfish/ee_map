import type { PageServerLoad } from './$types';
import { queryGraphBundle } from '$lib/server/data';
import { toGraph, type GraphViewModel } from '$lib/transform/to-graph';
import { stripGraphForClient } from '$lib/transform/strip-graph';

export type GraphPageData = {
	/** Graph without positions; client runs ELK. Null when nothing to show. */
	graph: GraphViewModel | null;
	/** Non-fatal load / validation message. */
	error: string | null;
};

function emptyPage(partial?: Partial<GraphPageData>): GraphPageData {
	return {
		graph: null,
		error: null,
		...partial
	};
}

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
	const graphEdges = config.relations.filter((r) => r.role !== 'ignore');

	if (graphTables.length === 0) {
		return emptyPage({
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
		// Informative only when edges configured but empty and nodes exist
		if (graph.nodes.length > 0 && graphEdges.length > 0 && graph.edges.length === 0) {
			// silent — empty connects is valid
		}

		return {
			graph,
			error: parts.length ? parts.join(' · ') : null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load graph data';
		console.warn('[graph] queryGraphBundle failed:', message);
		return emptyPage({ error: message });
	}
};
