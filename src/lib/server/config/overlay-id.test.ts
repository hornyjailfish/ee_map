import { describe, it, expect } from 'vitest';
import { recordIdKey, sanitizeOverlayId } from './overlay-id';

describe('sanitizeOverlayId', () => {
	it('keeps alphanumerics underscore hyphen', () => {
		expect(sanitizeOverlayId('map-related_1')).toBe('map-related_1');
	});

	it('strips other characters', () => {
		expect(sanitizeOverlayId('foo bar!@#')).toBe('foobar');
		expect(sanitizeOverlayId('app_config:main')).toBe('app_configmain');
	});

	it('falls back on empty', () => {
		expect(sanitizeOverlayId('')).toBe('main');
		expect(sanitizeOverlayId('!!!', 'fallback')).toBe('fallback');
		expect(sanitizeOverlayId(null)).toBe('main');
	});
});

describe('recordIdKey', () => {
	it('parses string record ids', () => {
		expect(recordIdKey('app_config:main')).toBe('main');
		expect(recordIdKey('map-related')).toBe('map-related');
	});

	it('parses object form', () => {
		expect(recordIdKey({ tb: 'app_config', id: 'main' })).toBe('main');
	});
});
