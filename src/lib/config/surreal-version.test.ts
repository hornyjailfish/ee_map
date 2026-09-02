import { describe, it, expect } from 'vitest';
import { engineAtLeast, parseSurrealVersion } from './surreal-version';
import { merge } from './merge';
import type { AutoProfile } from './types';

describe('parseSurrealVersion', () => {
	it('parses SDK object form from session.version()', () => {
		expect(parseSurrealVersion({ version: 'surrealdb-3.2.4+20260803.93ab219' })).toEqual({
			raw: 'surrealdb-3.2.4+20260803.93ab219',
			major: 3,
			minor: 2,
			patch: 4
		});
	});

	it('parses bare strings', () => {
		expect(parseSurrealVersion('3.1.0')).toEqual({
			raw: '3.1.0',
			major: 3,
			minor: 1,
			patch: 0
		});
	});

	it('keeps raw when semver missing', () => {
		expect(parseSurrealVersion('dev-build')).toEqual({
			raw: 'dev-build',
			major: null,
			minor: null,
			patch: null
		});
	});

	it('returns undefined for empty input', () => {
		expect(parseSurrealVersion(null)).toBeUndefined();
		expect(parseSurrealVersion({})).toBeUndefined();
		expect(parseSurrealVersion('')).toBeUndefined();
	});
});

describe('engineAtLeast', () => {
	const v324 = parseSurrealVersion('surrealdb-3.2.4')!;

	it('compares major.minor.patch', () => {
		expect(engineAtLeast(v324, 3, 2, 4)).toBe(true);
		expect(engineAtLeast(v324, 3, 2, 5)).toBe(false);
		expect(engineAtLeast(v324, 3, 1, 0)).toBe(true);
		expect(engineAtLeast(v324, 4, 0, 0)).toBe(false);
	});

	it('is false when engine unknown', () => {
		expect(engineAtLeast(undefined, 3, 0, 0)).toBe(false);
		expect(engineAtLeast(parseSurrealVersion('nope'), 1, 0, 0)).toBe(false);
	});
});

describe('merge preserves engine', () => {
	it('copies auto.engine onto ResolvedConfig', () => {
		const auto: AutoProfile = {
			tables: [],
			engine: { raw: 'surrealdb-3.2.4', major: 3, minor: 2, patch: 4 }
		};
		expect(merge(auto).engine).toEqual(auto.engine);
	});

	it('omits engine when fixture has none', () => {
		expect(merge({ tables: [] }).engine).toBeUndefined();
	});
});
