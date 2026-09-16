/**
 * v2 map transform — same engine as v1 (`config.map.layers` already is the index).
 * Thin wrapper typed on ResolvedConfigV2 for a clean switch later.
 */

import { toMap, type MapViewModel } from '../to-map';
import type { ResolvedConfigV2 } from './shapes';

/**
 * Build map view model from v2 resolved config + entity rows.
 * Delegates to shared toMap (layers path is version-stable).
 */
export function toMapV2(input: {
	config: ResolvedConfigV2;
	entities: Record<string, Array<Record<string, unknown>>>;
	levels?: Array<Record<string, unknown>>;
	levelId?: string | null;
}): MapViewModel {
	return toMap({
		// map.layers + map globals are identical; cast keeps v1 toMap signature without editing it
		config: input.config as unknown as Parameters<typeof toMap>[0]['config'],
		entities: input.entities,
		levels: input.levels,
		levelId: input.levelId
	});
}
