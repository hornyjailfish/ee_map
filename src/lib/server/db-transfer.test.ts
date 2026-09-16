import { describe, expect, it } from 'vitest';
import { exportFilename } from './db-transfer';

describe('exportFilename', () => {
	it('builds a sanitized stamp name', () => {
		const name = exportFilename('main', 'main', new Date('2026-04-01T12:34:56.789Z'));
		expect(name).toBe('surreal-main-main-2026-04-01T12-34-56-789Z.surql');
	});

	it('sanitizes unsafe ns/db characters', () => {
		const name = exportFilename('acme/ops', 'db:1', new Date('2026-01-01T00:00:00.000Z'));
		expect(name).toBe('surreal-acme_ops-db_1-2026-01-01T00-00-00-000Z.surql');
		expect(name).not.toMatch(/[/:]/);
	});
});
