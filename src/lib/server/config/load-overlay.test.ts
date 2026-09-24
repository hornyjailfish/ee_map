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
			version: 2,
			excludeTables: ['embeddings', 'app_config'],
			entities: {
				breakers: {},
				boards: {
					display: {
						parts: [{ path: 'room.name' }, { path: 'name' }],
						sep: ' · '
					}
				}
			},
			graph: {
				layout: { direction: 'DOWN' },
				nodes: { breakers: { role: 'breaker', parentField: 'board' } },
				edges: { connects: { role: 'feeds' } }
			},
			map: { units: 'm', plane: 'xy-meters' },
			search: { fieldsByTable: { breakers: ['name'] } }
		});
	});

	it('unwraps single-element SELECT arrays', () => {
		const overlay = normalizeOverlay([{ version: 1, excludeTables: ['x'] }]);
		expect(overlay).toEqual({ version: 2, excludeTables: ['x'] });
	});

	it('infers overlay when version missing but map present', () => {
		const overlay = normalizeOverlay({
			map: { units: 'm', plane: 'xy-meters' }
		});
		expect(overlay).toEqual({
			version: 2,
			map: { units: 'm', plane: 'xy-meters' }
		});
	});
});
