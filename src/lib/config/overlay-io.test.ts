import { describe, expect, it } from 'vitest';
import {
	emptyOverlay,
	formatSortText,
	parseDisplayText,
	parseOverlayJson,
	parseSortText,
	parseStringList,
	softParseOverlay
} from './overlay-io';

describe('overlay-io', () => {
	it('emptyOverlay starts at version 3', () => {
		expect(emptyOverlay()).toEqual({ version: 3 });
	});

	it('soft-parses known buckets and preserves unknown nested keys', () => {
		const result = softParseOverlay({
			id: 'app_config:main',
			version: 1,
			excludeTables: ['embeddings'],
			entities: {
				boards: {
					label: 'Boards',
					futureKnob: true,
					graph: { role: 'board', parentField: 'room' }
				}
			},
			customTop: { keep: 1 }
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.overlay.version).toBe(3);
		expect(result.overlay.excludeTables).toEqual(['embeddings']);
		expect(result.overlay.entities?.boards).toMatchObject({
			label: 'Boards',
			futureKnob: true
		});
		expect(result.overlay.graph?.nodes?.boards).toEqual({
			role: 'board',
			parentField: 'room'
		});
		expect((result.overlay as Record<string, unknown>).customTop).toEqual({ keep: 1 });
		expect((result.overlay as Record<string, unknown>).id).toBeUndefined();
	});

	it('rejects unsupported version and non-objects', () => {
		expect(softParseOverlay({ version: 99 }).ok).toBe(false);
		expect(softParseOverlay(42).ok).toBe(false);
		expect(parseOverlayJson('{').ok).toBe(false);
	});

	it('parses string lists and sort text', () => {
		expect(parseStringList('a, b\nc')).toEqual(['a', 'b', 'c']);
		expect(parseSortText('name')).toBe('name');
		expect(parseSortText('name desc')).toEqual({ field: 'name', dir: 'desc' });
		expect(parseSortText('room\nname desc')).toEqual(['room', { field: 'name', dir: 'desc' }]);
		expect(formatSortText([{ field: 'room' }, { field: 'name', dir: 'desc' }])).toBe(
			'room\nname desc'
		);
	});

	it('parses display text into field or parts', () => {
		expect(parseDisplayText('name')).toEqual({ field: 'name' });
		expect(parseDisplayText('room.name\nname', ' · ')).toEqual({
			parts: [{ path: 'room.name' }, { path: 'name' }],
			sep: ' · '
		});
	});

	it('migrates a legacy embeddings overlay to the v3 marker-split model', () => {
		const result = softParseOverlay({
			version: 1,
			excludeTables: ['__entity', 'embeddings'],
			entities: {
				embeddings: {
					label: 'Markers',
					display: { field: 'description' },
					map: { enabled: true, levelField: 'level', geometryField: 'marker', zIndex: 60 }
				}
			},
			search: { fieldsByTable: { embeddings: ['description'] } }
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const overlay = result.overlay;
		expect(overlay.version).toBe(3);
		expect(overlay.excludeTables).toEqual(['__entity', 'embedding_queue']);
		expect(overlay.entities?.embeddings).toBeUndefined();
		expect(overlay.entities?.markers).toMatchObject({
			label: 'Markers',
			display: { field: 'level.name' }
		});
		expect(overlay.entities?.marker_views).toMatchObject({
			label: 'Marker views',
			display: { field: 'generated_description' }
		});
		expect(overlay.map?.layers).toMatchObject({
			markers: { geometryField: 'geometry', levelField: 'level', zIndex: 60 }
		});
		expect(overlay.map?.layers?.embeddings).toBeUndefined();
		expect(overlay.search?.fieldsByTable).toEqual({
			marker_views: ['generated_description', 'user_description']
		});
	});

	it('keeps an existing markers entry and is idempotent', () => {
		const first = softParseOverlay({
			version: 1,
			entities: { embeddings: { label: 'Old' } }
		});
		if (!first.ok) return;
		const migrated = {
			...first.overlay,
			entities: {
				...(first.overlay.entities ?? {}),
				markers: { label: 'Custom markers' }
			}
		};
		const second = softParseOverlay(migrated);
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.overlay.entities?.markers).toEqual({ label: 'Custom markers' });
		expect(second.overlay.entities?.embeddings).toBeUndefined();
	});
});
