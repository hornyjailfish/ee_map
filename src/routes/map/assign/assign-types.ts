/** Shared types for /map/assign page + remote search (client-safe). */

export type AssignTableOption = {
	name: string;
	label: string;
	geometryField: string;
	levelField: string | null;
	/** Visible field names for the record list (id always first). */
	fields: Array<{ name: string; label: string; type: string }>;
};

export type AssignRecordRow = {
	id: string;
	/** Display cells for visible non-geometry fields. */
	cells: Record<string, unknown>;
	/** Compact geometry status for the list. */
	hasGeometry: boolean;
	levelId: string | null;
};
