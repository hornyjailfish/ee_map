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
	it('emptyOverlay starts at version 1', () => {
		expect(emptyOverlay()).toEqual({ version: 1 });
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
		expect(result.overlay.version).toBe(1);
		expect(result.overlay.excludeTables).toEqual(['embeddings']);
		expect(result.overlay.entities?.boards).toMatchObject({
			label: 'Boards',
			futureKnob: true,
			graph: { role: 'board', parentField: 'room' }
		});
		expect((result.overlay as Record<string, unknown>).customTop).toEqual({ keep: 1 });
		expect((result.overlay as Record<string, unknown>).id).toBeUndefined();
	});

	it('rejects unsupported version and non-objects', () => {
		expect(softParseOverlay({ version: 2 }).ok).toBe(false);
		expect(softParseOverlay(42).ok).toBe(false);
		expect(parseOverlayJson('{').ok).toBe(false);
	});

	it('parses string lists and sort text', () => {
		expect(parseStringList('a, b\nc')).toEqual(['a', 'b', 'c']);
		expect(parseSortText('name')).toBe('name');
		expect(parseSortText('name desc')).toEqual({ field: 'name', dir: 'desc' });
		expect(parseSortText('room\nname desc')).toEqual([
			'room',
			{ field: 'name', dir: 'desc' }
		]);
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
});
