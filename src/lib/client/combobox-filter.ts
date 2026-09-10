/**
 * Combobox / Command search ranking.
 *
 * bits-ui Command passes `(value, search, keywords) => score` where score is 0..1.
 * Our items use `value = option id` and `keywords = name/label fields` so we can
 * prioritize human-facing names over record ids, and exact over fuzzy.
 */

import { computeCommandScore } from 'bits-ui';

/** Higher tiers for name/label fields. */
const NAME = {
	exact: 1,
	prefix: 0.96,
	wordPrefix: 0.92,
	includes: 0.78,
	fuzzyScale: 0.65
} as const;

/** Lower tiers for id / table:key matches. */
const ID = {
	exact: 0.52,
	prefix: 0.44,
	wordPrefix: 0.4,
	includes: 0.28,
	fuzzyScale: 0.18
} as const;

type Tier = typeof NAME;

/**
 * Score one option for the command filter.
 * @param value Option id (`table:key` or plain id) — unique Command item value.
 * @param search User query.
 * @param keywords Name / label fields only (not id).
 */
export function comboboxCommandFilter(
	value: string,
	search: string,
	keywords: string[] = []
): number {
	const q = search.trim().toLowerCase();
	if (!q) return 1;

	let best = 0;

	for (const kw of keywords) {
		if (!kw) continue;
		best = Math.max(best, scoreText(kw, q, NAME));
		if (best >= 1) return 1;
	}

	if (value) {
		best = Math.max(best, scoreText(value, q, ID));
		const colon = value.indexOf(':');
		if (colon > 0 && colon < value.length - 1) {
			// Bare key after table: — still id-tier
			best = Math.max(best, scoreText(value.slice(colon + 1), q, ID));
		}
	}

	return best;
}

function scoreText(text: string, q: string, tier: Tier): number {
	const t = text.trim().toLowerCase();
	if (!t) return 0;

	if (t === q) return tier.exact;
	if (t.startsWith(q)) return tier.prefix;

	// Word / segment starts (spaces, ·, :, /, _, -)
	for (const part of t.split(/[\s·:./_-]+/)) {
		if (part && part.startsWith(q)) return tier.wordPrefix;
	}

	if (t.includes(q)) return tier.includes;

	const fuzzy = computeCommandScore(t, q);
	if (fuzzy <= 0) return 0;
	return fuzzy * tier.fuzzyScale;
}
