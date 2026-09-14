import { describe, it, expect } from 'vitest';
import type { ActionResult } from '@sveltejs/kit';
import { ApiError, unwrapActionResult } from './http';

describe('unwrapActionResult', () => {
	it('returns success data', () => {
		const result = {
			type: 'success',
			status: 200,
			data: { ok: true, id: 'connects:1' }
		} as ActionResult<{ ok: true; id: string }, Record<string, unknown>>;
		expect(unwrapActionResult(result)).toEqual({ ok: true, id: 'connects:1' });
	});

	it('throws ApiError on failure with logical status (not HTTP wrapper)', () => {
		const result = {
			type: 'failure',
			status: 400,
			data: { code: 'db_error', message: 'Failed to relate connects' }
		} as ActionResult<Record<string, unknown>, { code: string; message: string }>;

		try {
			unwrapActionResult(result);
			expect.unreachable('should throw');
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			const e = err as ApiError;
			expect(e.status).toBe(400);
			expect(e.code).toBe('db_error');
			expect(e.message).toBe('Failed to relate connects');
		}
	});

	it('throws on error results', () => {
		const result = {
			type: 'error',
			status: 500,
			error: { message: 'boom' }
		} as ActionResult;

		expect(() => unwrapActionResult(result)).toThrow(ApiError);
	});
});
