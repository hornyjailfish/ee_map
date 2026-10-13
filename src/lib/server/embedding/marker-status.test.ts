import { describe, it, expect } from 'vitest';
import {
	aggregateMarkerStatus,
	classifyView,
	type ViewEmbeddingState
} from './marker-status';

function view(partial: Partial<ViewEmbeddingState>): ViewEmbeddingState {
	return { version: 1, queueStatus: 'done', queueVersion: 1, ...partial };
}

describe('classifyView', () => {
	it('reports done when the queue version matches', () => {
		expect(classifyView(view({ version: 3, queueStatus: 'done', queueVersion: 3 }))).toBe('done');
	});

	it('reports stale when the view changed after embedding', () => {
		expect(classifyView(view({ version: 4, queueStatus: 'done', queueVersion: 3 }))).toBe('stale');
	});

	it('reports failed for failed / error statuses', () => {
		expect(classifyView(view({ queueStatus: 'failed' }))).toBe('failed');
		expect(classifyView(view({ queueStatus: 'error' }))).toBe('failed');
	});

	it('reports active for pending / processing / queued', () => {
		expect(classifyView(view({ queueStatus: 'pending' }))).toBe('active');
		expect(classifyView(view({ queueStatus: 'processing' }))).toBe('active');
		expect(classifyView(view({ queueStatus: 'queued' }))).toBe('active');
	});

	it('reports active when a pending view was also edited (blue beats stale)', () => {
		expect(classifyView(view({ version: 5, queueStatus: 'processing', queueVersion: 3 }))).toBe(
			'active'
		);
	});

	it('reports active when no queue row exists', () => {
		expect(classifyView(view({ queueStatus: null, queueVersion: null }))).toBe('active');
	});

	it('does not flag stale when the queue version is unknown', () => {
		expect(classifyView(view({ version: 2, queueStatus: 'done', queueVersion: null }))).toBe('done');
	});
});

describe('aggregateMarkerStatus', () => {
	it('reports empty for a marker with no views', () => {
		expect(aggregateMarkerStatus([])).toBe('empty');
	});

	it('reports green (done) when every view is done and current', () => {
		expect(
			aggregateMarkerStatus([view({ version: 1, queueVersion: 1 }), view({ version: 2, queueVersion: 2 })])
		).toBe('done');
	});

	it('reports failed when any view failed', () => {
		expect(
			aggregateMarkerStatus([view({ queueStatus: 'done' }), view({ queueStatus: 'failed' })])
		).toBe('failed');
	});

	it('prefers failed over active and stale', () => {
		expect(
			aggregateMarkerStatus([
				view({ queueStatus: 'failed' }),
				view({ queueStatus: 'processing' }),
				view({ version: 9, queueStatus: 'done', queueVersion: 1 })
			])
		).toBe('failed');
	});

	it('prefers active over stale (Red > Blue > Orange > Green)', () => {
		expect(
			aggregateMarkerStatus([
				view({ queueStatus: 'pending' }),
				view({ version: 9, queueStatus: 'done', queueVersion: 1 })
			])
		).toBe('active');
	});

	it('reports stale when one done view is out of date', () => {
		expect(
			aggregateMarkerStatus([
				view({ version: 1, queueStatus: 'done', queueVersion: 1 }),
				view({ version: 5, queueStatus: 'done', queueVersion: 4 })
			])
		).toBe('stale');
	});
});
