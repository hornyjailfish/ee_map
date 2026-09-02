import { describe, it, expect } from 'vitest';
import { normalizeOverlay } from './load-overlay';

describe('normalizeOverlay', () => {
	it('returns null for empty / missing', () => {
		expect(normalizeOverlay(null)).toBeNull();
		expect(normalizeOverlay(undefined)).toBeNull();
		expect(normalizeOverlay([])).toBeNull();
		expect(normalizeOverlay({ id: 'app_config:main' })).toBeNull();
	});

	it('accepts version 1 overlay with entities, display, and graph layout', () => {
		const overlay = normalizeOverlay({
			id: { tb: 'app_config', id: 'main' },
			version: 1,
			excludeTables: ['embeddings', 'app_config'],
			entities: {
				breakers: { graph: { role: 'breaker', parentField: 'board' } },
				boards: {
					display: {
						parts: [{ path: 'room.name' }, { path: 'name' }],
						sep: ' · '
					}
				}
			},
			edges: {
				connects: { role: 'feeds' }
			},
			graph: { layout: { direction: 'DOWN' } },
			map: { units: 'm', plane: 'xy-meters' },
			search: { fieldsByTable: { breakers: ['name'] } }
		});

		expect(overlay).toEqual({
			version: 1,
			excludeTables: ['embeddings', 'app_config'],
			entities: {
				breakers: { graph: { role: 'breaker', parentField: 'board' } },
				boards: {
					display: {
						parts: [{ path: 'room.name' }, { path: 'name' }],
						sep: ' · '
					}
				}
			},
			edges: {
				connects: { role: 'feeds' }
			},
			graph: { layout: { direction: 'DOWN' } },
			map: { units: 'm', plane: 'xy-meters' },
			search: { fieldsByTable: { breakers: ['name'] } }
		});
	});

	it('unwraps single-element SELECT arrays', () => {
		const overlay = normalizeOverlay([{ version: 1, excludeTables: ['x'] }]);
		expect(overlay).toEqual({ version: 1, excludeTables: ['x'] });
	});

	it('infers overlay when version missing but map present', () => {
		const overlay = normalizeOverlay({
			map: { units: 'm', plane: 'xy-meters' }
		});
		expect(overlay).toEqual({
			version: 1,
			map: { units: 'm', plane: 'xy-meters' }
		});
	});
});
