/**
 * Serializable map feature property payload (remote read).
 */

import type { SelectOption } from '$lib/option-types';
import type { TableColumn } from '$lib/transform/to-table';

/** One visible field on a selected map record. */
export type MapFeatureFieldView = {
	name: string;
	label: string;
	valueType: string;
	optional?: boolean;
	readOnly?: boolean;
	editor?: false | string;
	recordTargets?: string[];
	/**
	 * Edit/form value as string.
	 * Record links stay as `table:id`; booleans as `true`/`false`; empty → ''.
	 */
	value: string;
	/** Human-readable display (FK label, geometry summary, …). */
	display: string;
};

/** Full DB record slice for the map properties overlay. */
export type MapFeatureRecordDetail = {
	id: string;
	table: string;
	tableLabel: string;
	/** Title line (name / label / id). */
	title: string;
	/** Role + STRUCTURE update gate. */
	canUpdate: boolean;
	/** All non-hidden fields for the inspector (includes id / geometry readouts). */
	fields: MapFeatureFieldView[];
	/** Writable form columns (excludes id + geometry). */
	editFields: TableColumn[];
	/** FK picker options by field name (empty when viewer / no links). */
	recordOptions: Record<string, SelectOption[]>;
};
