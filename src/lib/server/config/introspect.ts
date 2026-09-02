/**
 * Live schema introspect on the user session → AutoProfile.
 * Always uses INFO FOR DB/TABLE STRUCTURE (never plain INFO).
 * Captures Surreal engine version for STRUCTURE dialect compatibility.
 */

import type { Surreal } from 'surrealdb';
import { parseSurrealVersion } from '$lib/config/surreal-version';
import type { AutoProfile, AutoProfileField } from '$lib/config/types';
import {
	buildAutoProfile,
	parseDbTables,
	parseTableFields,
	type TableStub
} from './parse-structure';

/**
 * Introspect all tables on the connected session into an AutoProfile.
 * Does not apply overlay excludes — merge handles that.
 */
export async function introspect(session: Surreal): Promise<AutoProfile> {
	const [dbInfo, engine] = await Promise.all([
		queryInfo(session, 'INFO FOR DB STRUCTURE'),
		readEngineVersion(session)
	]);

	const stubs = parseDbTables(dbInfo);
	const fieldsByTable = new Map<string, AutoProfileField[]>();
	const kindOpts = engine ? { engine } : undefined;

	if (stubs.length > 0) {
		await fillFields(session, stubs, fieldsByTable, kindOpts);
	}

	const profile = buildAutoProfile(stubs, fieldsByTable);
	if (engine) profile.engine = engine;
	return profile;
}

async function readEngineVersion(session: Surreal): Promise<AutoProfile['engine']> {
	try {
		return parseSurrealVersion(await session.version());
	} catch (error) {
		console.warn(
			'[config/introspect] session.version() failed:',
			error instanceof Error ? error.message : error
		);
		return undefined;
	}
}

async function fillFields(
	session: Surreal,
	stubs: TableStub[],
	fieldsByTable: Map<string, AutoProfileField[]>,
	kindOpts?: { engine: NonNullable<AutoProfile['engine']> }
): Promise<void> {
	// One multi-statement STRUCTURE query for fewer RTTs
	const statements = stubs.map((s) => `INFO FOR TABLE ${quoteIdent(s.name)} STRUCTURE;`).join('\n');

	try {
		const results = await session.query(statements);
		if (Array.isArray(results) && results.length === stubs.length) {
			for (let i = 0; i < stubs.length; i++) {
				const stub = stubs[i]!;
				fieldsByTable.set(stub.name, parseTableFields(results[i], kindOpts));
			}
			return;
		}
	} catch {
		// fall through to per-table STRUCTURE
	}

	for (const stub of stubs) {
		try {
			const info = await queryInfo(session, `INFO FOR TABLE ${quoteIdent(stub.name)} STRUCTURE`);
			fieldsByTable.set(stub.name, parseTableFields(info, kindOpts));
		} catch (error) {
			console.warn(
				`[config/introspect] failed TABLE STRUCTURE for ${stub.name}:`,
				error instanceof Error ? error.message : error
			);
			fieldsByTable.set(stub.name, []);
		}
	}
}

async function queryInfo(session: Surreal, sql: string): Promise<unknown> {
	const [result] = await session.query<[unknown]>(sql);
	return result;
}

/** Safe table ident for INFO FOR TABLE (alphanumeric + underscore unquoted). */
function quoteIdent(name: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
	const escaped = name.replace(/`/g, '``');
	return `\`${escaped}\``;
}
