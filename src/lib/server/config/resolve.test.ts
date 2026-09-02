import { describe, it, expect, beforeEach } from 'vitest';
import { merge } from '$lib/config/merge';
import type { AppConfigOverlay, AutoProfile } from '$lib/config/types';
import { configCacheSize, invalidateConfigCache } from './resolve';

/**
 * resolveAppConfig I/O is integration-tested live when DB is up.
 * Here we lock the cache helper API and the merge composition contract
 * that resolve uses (auto + overlay → ResolvedConfig).
 */
describe('resolve composition (merge path used by resolveAppConfig)', () => {
	beforeEach(() => {
		invalidateConfigCache();
	});

	it('invalidateConfigCache clears all entries', () => {
		expect(configCacheSize()).toBe(0);
		invalidateConfigCache();
		expect(configCacheSize()).toBe(0);
	});

	it('merge(auto, overlay) is what resolve returns shape-wise', () => {
		const auto: AutoProfile = {
			tables: [
				{
					name: 'electric_rooms',
					kind: 'normal',
					fields: [
						{ name: 'name', type: 'string', optional: false },
						{
							name: 'level',
							type: 'record',
							optional: false,
							recordTargets: ['levels']
						},
						{
							name: 'geometry',
							type: 'geometry',
							optional: true,
							geometryKinds: ['polygon']
						}
					]
				},
				{
					name: 'connects',
					kind: 'relation',
					in: ['breakers'],
					out: ['breakers', 'rents'],
					fields: [{ name: 'cable', type: 'string', optional: true }]
				},
				{
					name: 'embeddings',
					kind: 'normal',
					fields: [{ name: 'marker', type: 'geometry', optional: false }]
				}
			]
		};

		const overlay: AppConfigOverlay = {
			version: 1,
			excludeTables: ['embeddings', 'app_config'],
			entities: {
				electric_rooms: {
					graph: { role: 'room', labelField: 'name' },
					map: { enabled: true }
				}
			},
			edges: {
				connects: { role: 'feeds' }
			},
			map: { units: 'm', plane: 'xy-meters' }
		};

		const config = merge(auto, overlay);

		expect(config.version).toBe(1);
		expect(config.tables.map((t) => t.name)).toEqual(['electric_rooms']);
		expect(config.relations[0]).toMatchObject({
			name: 'connects',
			role: 'feeds',
			in: ['breakers'],
			out: ['breakers', 'rents']
		});
		expect(config.map.layers).toEqual([
			{
				table: 'electric_rooms',
				levelField: 'level',
				geometryField: 'geometry',
				styleKey: 'electric_rooms',
				zIndex: 0
			}
		]);
		expect(config.diagnostics).toEqual([]);
	});
});
