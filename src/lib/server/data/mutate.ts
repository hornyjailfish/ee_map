/**
 * Server write seam for domain data (C0 + C3).
 *
 * Role + table/relation permission + field allowlisting happen here so every
 * write path (table cells/rows, graph wires, map geometry) uses the same gates.
 */

import { Geometry, StringRecordId, type Surreal } from 'surrealdb';
import type { AppRole } from '$lib/catalog-types';
import type { ResolvedEdge, ResolvedEntity, ResolvedField } from '$lib/config/types';
import { canEdit, canOwn } from '$lib/roles';

/** Safe identifier for embedding an allowlisted table name in SurrealQL. */
const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validation / authorization failure. `status` maps to an HTTP response. */
export class MutateError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'MutateError';
		this.status = status;
		this.code = code;
	}
}

/** A field that a client may write (excludes hidden / readOnly / id). */
export type WritableField = {
	name: string;
	field: ResolvedField;
};

/**
 * Fields editable on this entity.
 * Excludes `id`, hidden, readOnly; scalars + record links + geometry are coercible.
 */
export function writableFields(entity: ResolvedEntity): WritableField[] {
	return entity.fields
		.filter(
			(field) => field.name !== 'id' && !field.hidden && !field.readOnly && isCoercible(field)
		)
		.map((field) => ({ name: field.name, field }));
}

function isCoercible(field: ResolvedField): boolean {
	return isScalar(field) || field.type === 'record' || field.type === 'geometry';
}

function isScalar(field: ResolvedField): boolean {
	switch (field.type) {
		case 'string':
		case 'number':
		case 'bool':
		case 'datetime':
			return true;
		default:
			return false;
	}
}

/** Throw unless the user holds EDITOR or OWNER. */
export function assertCanEdit(roles: readonly AppRole[] | null | undefined): void {
	if (!canEdit(roles)) {
		throw new MutateError(403, 'forbidden', 'Requires EDITOR or OWNER role');
	}
}

/** Throw unless the user holds OWNER (overlay / app config admin). */
export function assertCanOwn(roles: readonly AppRole[] | null | undefined): void {
	if (!canOwn(roles)) {
		throw new MutateError(403, 'forbidden', 'Requires OWNER role');
	}
}

/** Throw unless the entity's live STRUCTURE permissions allow `update`. */
export function assertCanUpdate(entity: ResolvedEntity): void {
	if (!entity.permissions.update) {
		throw new MutateError(403, 'readonly_table', `Table '${entity.name}' is read-only`);
	}
}

/** Throw unless the entity's live STRUCTURE permissions allow `create`. */
export function assertCanCreate(entity: ResolvedEntity): void {
	if (!entity.permissions.create) {
		throw new MutateError(403, 'readonly_table', `Table '${entity.name}' is read-only`);
	}
}

/** Throw unless the entity's live STRUCTURE permissions allow `delete`. */
export function assertCanDelete(entity: ResolvedEntity): void {
	if (!entity.permissions.delete) {
		throw new MutateError(403, 'readonly_table', `Table '${entity.name}' is read-only`);
	}
}

/** Throw unless the relation's STRUCTURE permissions allow create (RELATE). */
export function assertCanRelate(relation: ResolvedEdge): void {
	if (!relation.permissions.create) {
		throw new MutateError(403, 'readonly_table', `Relation '${relation.name}' is read-only`);
	}
}

/** Throw unless the relation's STRUCTURE permissions allow delete. */
export function assertCanUnrelate(relation: ResolvedEdge): void {
	if (!relation.permissions.delete) {
		throw new MutateError(403, 'readonly_table', `Relation '${relation.name}' is read-only`);
	}
}

/**
 * Coerce a raw client value for a scalar/record field.
 * Empty / null / undefined → DB `null` for optional fields (None in combo editors).
 */
export function coerceScalar(field: ResolvedField, raw: unknown): unknown {
	if (raw === '' || raw === undefined || raw === null) {
		// Explicit null so MERGE clears the field (undefined keys are omitted by JSON/SDK).
		if (field.optional) return null;
		throw new MutateError(400, 'required_field', `Field '${field.name}' is required`);
	}

	switch (field.type) {
		case 'number': {
			const n = typeof raw === 'number' ? raw : Number(raw);
			if (!Number.isFinite(n)) {
				throw new MutateError(400, 'invalid_number', `Field '${field.name}' must be a number`);
			}
			return n;
		}
		case 'bool': {
			if (typeof raw === 'boolean') return raw;
			if (raw === 'true') return true;
			if (raw === 'false') return false;
			throw new MutateError(400, 'invalid_bool', `Field '${field.name}' must be true or false`);
		}
		case 'string':
			return String(raw);
		case 'datetime':
			return String(raw);
		case 'record': {
			const value = String(raw);
			if (!/^[A-Za-z_][A-Za-z0-9_]*:/.test(value)) {
				throw new MutateError(
					400,
					'invalid_record',
					`Field '${field.name}' must be a table:id reference`
				);
			}
			if (field.recordTargets?.length) {
				const table = value.slice(0, value.indexOf(':'));
				if (!field.recordTargets.includes(table)) {
					throw new MutateError(
						400,
						'invalid_record',
						`Field '${field.name}' must reference ${field.recordTargets.join(' | ')}`
					);
				}
			}
			// StringRecordId preserves numeric vs string key types (e.g. levels:-2).
			return new StringRecordId(value);
		}
		case 'geometry':
			return coerceGeometry(field, raw);
		default:
			throw new MutateError(400, 'unsupported_type', `Field '${field.name}' is not editable`);
	}
}

/**
 * Coerce GeoJSON geometry for a geometry field.
 * Accepts a plain object, JSON string, or SDK {@link Geometry} instance.
 * Returns a Surreal SDK Geometry value (CBOR-tagged) — plain `{ type, coordinates }`
 * objects are rejected by the engine over MERGE/params.
 * Optional empty → `null`.
 */
export function coerceGeometry(field: ResolvedField, raw: unknown): Geometry | null {
	if (raw === '' || raw === undefined || raw === null) {
		if (field.optional) return null;
		throw new MutateError(400, 'required_field', `Field '${field.name}' is required`);
	}

	// Already a Surreal geometry value from a prior coerce / SDK path
	if (raw instanceof Geometry) {
		return assertGeometryKind(field, raw);
	}

	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			throw new MutateError(400, 'invalid_geometry', `Field '${field.name}' must be valid GeoJSON`);
		}
	}

	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		throw new MutateError(
			400,
			'invalid_geometry',
			`Field '${field.name}' must be a geometry object`
		);
	}

	const obj = value as Record<string, unknown>;
	const typeRaw = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
	if (typeRaw !== 'point' && typeRaw !== 'polygon') {
		throw new MutateError(
			400,
			'invalid_geometry',
			`Field '${field.name}' supports Point or Polygon geometry`
		);
	}

	const kind = typeRaw; // point | polygon
	if (
		field.geometryKinds?.length &&
		!field.geometryKinds.map((k) => k.toLowerCase()).includes(kind)
	) {
		throw new MutateError(
			400,
			'invalid_geometry',
			`Field '${field.name}' expects ${field.geometryKinds.join(' | ')}`
		);
	}

	if (!('coordinates' in obj)) {
		throw new MutateError(400, 'invalid_geometry', `Field '${field.name}' is missing coordinates`);
	}

	// Title-case GeoJSON for Geometry.fromJSON / constructors
	const type = kind === 'point' ? 'Point' : 'Polygon';
	const geojson = { type, coordinates: obj.coordinates } as {
		type: 'Point' | 'Polygon';
		coordinates: unknown;
	};

	try {
		return Geometry.fromJSON(geojson as Parameters<typeof Geometry.fromJSON>[0]);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Invalid geometry';
		throw new MutateError(400, 'invalid_geometry', `Field '${field.name}': ${message}`);
	}
}

function assertGeometryKind(field: ResolvedField, geometry: Geometry): Geometry {
	if (!field.geometryKinds?.length) return geometry;
	const allowed = new Set(field.geometryKinds.map((k) => k.toLowerCase()));
	const json = geometry.toJSON();
	const kind = typeof json.type === 'string' ? json.type.toLowerCase() : '';
	if (!allowed.has(kind)) {
		throw new MutateError(
			400,
			'invalid_geometry',
			`Field '${field.name}' expects ${field.geometryKinds.join(' | ')}`
		);
	}
	return geometry;
}

/**
 * Resolve the geometry field name for an entity (map overlay or first geometry field).
 */
export function geometryFieldName(entity: ResolvedEntity): string | null {
	const fromMap = entity.map?.geometryField;
	if (fromMap && entity.fields.some((f) => f.name === fromMap && f.type === 'geometry')) {
		return fromMap;
	}
	const field = entity.fields.find((f) => f.type === 'geometry' && !f.hidden && !f.readOnly);
	return field?.name ?? null;
}

/**
 * Patch a record's geometry (and optional companion fields such as level).
 * `geometry` may be a GeoJSON object or JSON string.
 */
export async function patchGeometry(
	session: Surreal,
	entity: ResolvedEntity,
	id: string,
	geometry: unknown,
	extra: Record<string, unknown> = {}
): Promise<void> {
	assertCanUpdate(entity);

	const geomName = geometryFieldName(entity);
	if (!geomName) {
		throw new MutateError(400, 'no_geometry_field', `Table '${entity.name}' has no geometry field`);
	}

	const values: Record<string, unknown> = { [geomName]: geometry, ...extra };
	const data = coercePatch(entity, values);

	try {
		const record = validateRecordId(id);
		await session.query('UPDATE type::record($record) MERGE $data', { record, data });
	} catch (error) {
		throw normalizeSurrealError(error, `update geometry on ${entity.name}`);
	}
}

/**
 * Validate + coerce field names → raw values against an entity.
 * Unknown / non-writable fields are rejected rather than silently dropped.
 */
export function coercePatch(
	entity: ResolvedEntity,
	values: Record<string, unknown>
): Record<string, unknown> {
	const writable = new Map(writableFields(entity).map((w) => [w.name, w.field]));

	const out: Record<string, unknown> = {};
	for (const [name, raw] of Object.entries(values)) {
		const field = writable.get(name);
		if (!field) {
			throw new MutateError(
				400,
				'unknown_field',
				`Field '${name}' is not editable on '${entity.name}'`
			);
		}
		out[name] = coerceScalar(field, raw);
	}
	return out;
}

/**
 * Validate a `table:id` string.
 * Callers pass it to `type::record($id)` so Surreal keeps native key types
 * (numeric keys like `levels:-2` vs string keys like `boards:abc`).
 */
export function validateRecordId(value: string): string {
	const colon = value.indexOf(':');
	if (colon <= 0 || colon === value.length - 1) {
		throw new MutateError(400, 'invalid_id', `Invalid record id: ${value}`);
	}
	const table = value.slice(0, colon);
	const id = value.slice(colon + 1);
	if (!table || !id) {
		throw new MutateError(400, 'invalid_id', `Invalid record id: ${value}`);
	}
	return value;
}

/** Table name portion of a `table:id` string. */
export function tableOfId(recordId: string): string {
	const colon = recordId.indexOf(':');
	if (colon <= 0) {
		throw new MutateError(400, 'invalid_id', `Invalid record id: ${recordId}`);
	}
	return recordId.slice(0, colon);
}

/**
 * Patch selected scalar fields on one record (MERGE semantics).
 * Re-checks table update permission; coerces via {@link coercePatch}.
 */
export async function patchRecord(
	session: Surreal,
	entity: ResolvedEntity,
	id: string,
	values: Record<string, unknown>
): Promise<void> {
	assertCanUpdate(entity);
	const data = coercePatch(entity, values);

	try {
		const record = validateRecordId(id);
		await session.query('UPDATE type::record($record) MERGE $data', { record, data });
	} catch (error) {
		throw normalizeSurrealError(error, `update ${entity.name}`);
	}
}

/** Create a new record in `entity.name` with coerced fields. */
export async function createRecord(
	session: Surreal,
	entity: ResolvedEntity,
	values: Record<string, unknown>
): Promise<string> {
	assertCanCreate(entity);
	const data = coercePatch(entity, values);

	try {
		const [result] = await session.query<[Record<string, unknown>[] | Record<string, unknown>]>(
			'CREATE type::table($table) CONTENT $data',
			{ table: entity.name, data }
		);
		const created = Array.isArray(result) ? result[0] : result;
		const id = normalizeRecordIdFromRow(created);
		if (!id) {
			throw new MutateError(500, 'create_failed', `Failed to create ${entity.name}`);
		}
		return id;
	} catch (error) {
		if (error instanceof MutateError) throw error;
		throw normalizeSurrealError(error, `create ${entity.name}`);
	}
}

/** Delete one record by id. */
export async function deleteRecord(
	session: Surreal,
	entity: ResolvedEntity,
	id: string
): Promise<void> {
	assertCanDelete(entity);

	try {
		const record = validateRecordId(id);
		await session.query('DELETE type::record($record)', { record });
	} catch (error) {
		throw normalizeSurrealError(error, `delete ${entity.name}`);
	}
}

/**
 * Validate endpoint ids against a relation's IN/OUT table allowlists.
 */
export function validateConnectEndpoints(
	relation: ResolvedEdge,
	inId: string,
	outId: string
): { inId: string; outId: string } {
	const source = validateRecordId(inId);
	const target = validateRecordId(outId);

	if (source === target) {
		throw new MutateError(400, 'invalid_connect', 'Cannot connect a node to itself');
	}

	const inTable = tableOfId(source);
	const outTable = tableOfId(target);

	if (relation.in.length > 0 && !relation.in.includes(inTable)) {
		throw new MutateError(
			400,
			'invalid_connect',
			`Source must be one of: ${relation.in.join(' | ')}`
		);
	}
	if (relation.out.length > 0 && !relation.out.includes(outTable)) {
		throw new MutateError(
			400,
			'invalid_connect',
			`Target must be one of: ${relation.out.join(' | ')}`
		);
	}

	return { inId: source, outId: target };
}

/**
 * Create a graph wire: RELATE in → relation → out.
 * Call site must assertCanEdit (EDITOR/OWNER). VIEWER is never allowed.
 * Optional meta is coerced against relation.fields (e.g. cable).
 */
export async function relateConnect(
	session: Surreal,
	relation: ResolvedEdge,
	inId: string,
	outId: string,
	meta: Record<string, unknown> = {}
): Promise<string> {
	assertCanRelate(relation);
	if (!TABLE_NAME_RE.test(relation.name)) {
		throw new MutateError(400, 'invalid_table', `Invalid relation name: ${relation.name}`);
	}
	const endpoints = validateConnectEndpoints(relation, inId, outId);
	const data = Object.keys(meta).length === 0 ? {} : coerceRelationMeta(relation, meta);

	// RELATE grammar wants record values (params), not type::record() expressions.
	// Relation table name is allowlisted (ResolvedConfig + TABLE_NAME_RE).
	const sql =
		Object.keys(data).length > 0
			? `RELATE $in->${relation.name}->$out CONTENT $data`
			: `RELATE $in->${relation.name}->$out`;

	try {
		const [result] = await session.query<[Record<string, unknown>[] | Record<string, unknown>]>(
			sql,
			{
				in: new StringRecordId(endpoints.inId),
				out: new StringRecordId(endpoints.outId),
				...(Object.keys(data).length > 0 ? { data } : {})
			}
		);
		const created = Array.isArray(result) ? result[0] : result;
		const id = normalizeRecordIdFromRow(created);
		if (!id) {
			throw new MutateError(500, 'relate_failed', `Failed to create ${relation.name} edge`);
		}
		return id;
	} catch (error) {
		if (error instanceof MutateError) throw error;
		throw normalizeSurrealError(error, `relate ${relation.name}`);
	}
}

/**
 * Delete a graph wire by edge record id (must belong to the relation table).
 * Call site must assertCanEdit (EDITOR/OWNER).
 */
export async function unrelateConnect(
	session: Surreal,
	relation: ResolvedEdge,
	edgeId: string
): Promise<void> {
	assertCanUnrelate(relation);
	const id = validateRecordId(edgeId);
	const table = tableOfId(id);
	if (table !== relation.name) {
		throw new MutateError(400, 'invalid_id', `Edge id must be on relation '${relation.name}'`);
	}

	try {
		await session.query('DELETE $edge', { edge: new StringRecordId(id) });
	} catch (error) {
		throw normalizeSurrealError(error, `unrelate ${relation.name}`);
	}
}

/** Coerce optional meta against relation field definitions. */
function coerceRelationMeta(
	relation: ResolvedEdge,
	meta: Record<string, unknown>
): Record<string, unknown> {
	const writable = new Map(
		relation.fields
			.filter(
				(f) => f.name !== 'id' && f.name !== 'in' && f.name !== 'out' && !f.hidden && !f.readOnly
			)
			.map((f) => [f.name, f])
	);

	const out: Record<string, unknown> = {};
	for (const [name, raw] of Object.entries(meta)) {
		const field = writable.get(name);
		if (!field) {
			throw new MutateError(
				400,
				'unknown_field',
				`Field '${name}' is not editable on '${relation.name}'`
			);
		}
		out[name] = coerceScalar(field, raw);
	}
	return out;
}

function normalizeRecordIdFromRow(row: Record<string, unknown> | undefined | null): string {
	if (!row || typeof row !== 'object') return '';
	const id = row.id;
	if (id == null) return '';
	if (typeof id === 'string') return id.trim();
	if (typeof id !== 'object') return String(id);

	// Surreal RecordId instances expose toString(); prefer it over [object Object].
	const toString = (id as { toString?: unknown }).toString;
	if (typeof toString === 'function' && toString !== Object.prototype.toString) {
		const value = (toString as () => unknown).call(id);
		if (typeof value === 'string' && value && value !== '[object Object]') return value;
	}

	// Plain { tb, id } shape from some drivers / JSON paths.
	const shape = id as { tb?: unknown; id?: unknown };
	if (typeof shape.tb === 'string' && shape.id != null) {
		const key = recordKeyString(shape.id);
		if (key) return `${shape.tb}:${key}`;
	}

	return String(id);
}

function recordKeyString(value: unknown): string {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
		return String(value);
	}
	if (typeof value === 'object' && value !== null) {
		const toString = (value as { toString?: unknown }).toString;
		if (typeof toString === 'function') {
			const text = (toString as () => unknown).call(value);
			if (typeof text === 'string') return text;
		}
	}
	return '';
}

/** Map a Surreal SDK error to a MutateError without leaking internals. */
function normalizeSurrealError(error: unknown, context: string): MutateError {
	if (error instanceof MutateError) return error;
	const message = error instanceof Error ? error.message : String(error);
	return new MutateError(400, 'db_error', `Failed to ${context}: ${message}`);
}
