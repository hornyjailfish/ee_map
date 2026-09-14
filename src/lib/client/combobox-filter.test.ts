import { describe, expect, it } from 'vitest';
import { comboboxCommandFilter } from './combobox-filter';

describe('comboboxCommandFilter', () => {
	it('returns 1 for empty search', () => {
		expect(comboboxCommandFilter('boards:a', '', ['Main'])).toBe(1);
		expect(comboboxCommandFilter('boards:a', '   ', ['Main'])).toBe(1);
	});

	it('ranks exact name above fuzzy id noise', () => {
		const nameExact = comboboxCommandFilter('boards:xyz99', 'main', ['Main']);
		const idFuzzy = comboboxCommandFilter('boards:mainish', 'main', ['Other room']);
		expect(nameExact).toBeGreaterThan(idFuzzy);
		expect(nameExact).toBe(1);
	});

	it('ranks name prefix above id exact key', () => {
		const namePrefix = comboboxCommandFilter('boards:zz', 'er', ['ER-1']);
		const idExactKey = comboboxCommandFilter('boards:er', 'er', ['Something else']);
		expect(namePrefix).toBeGreaterThan(idExactKey);
	});

	it('ranks exact name above name substring and above id includes', () => {
		const exact = comboboxCommandFilter('rents:1', 'shop', ['shop']);
		const includes = comboboxCommandFilter('rents:2', 'shop', ['big shop east']);
		const idHit = comboboxCommandFilter('rents:shop', 'shop', ['Area A']);
		expect(exact).toBeGreaterThan(includes);
		expect(includes).toBeGreaterThan(idHit);
	});

	it('still finds id-only queries when name does not match', () => {
		const score = comboboxCommandFilter('electric_rooms:room12', 'room12', ['Basement']);
		expect(score).toBeGreaterThan(0);
	});

	it('matches composite labels by word prefix', () => {
		const score = comboboxCommandFilter('boards:b1', 'q1', ['ER-1 · Q1']);
		expect(score).toBeGreaterThan(0.9);
	});

	it('hides non-matches', () => {
		expect(comboboxCommandFilter('boards:a', 'zzzz', ['Main'])).toBe(0);
	});
});
