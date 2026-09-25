/**
 * Map editor tool modes (C4.1+).
 * Active: navigate, draw-polygon, modify (vertices), extrude (polygon edges).
 * Draw tools use DrawSnapSession; Edit uses ModifyVertexSession;
 * Extrude uses ModifyExtrudeSession.
 */

export const MAP_TOOL_MODES = [
	'navigate',
	'draw-polygon',
	'draw-point',
	'modify',
	'extrude',
	'clear'
] as const;

export type MapToolMode = (typeof MAP_TOOL_MODES)[number];

/** Tools shipped for create + geometry edit. */
export const MAP_ACTIVE_TOOLS = [
	'navigate',
	'draw-polygon',
	'draw-point',
	'modify',
	'extrude'
] as const satisfies readonly MapToolMode[];

/** @deprecated Prefer MAP_ACTIVE_TOOLS — create subset. */
export const MAP_CREATE_TOOLS = [
	'navigate',
	'draw-polygon',
	'draw-point'
] as const satisfies readonly MapToolMode[];

export type MapCreateTool = (typeof MAP_CREATE_TOOLS)[number];
export type MapActiveTool = (typeof MAP_ACTIVE_TOOLS)[number];

/** Tools reserved for follow-ups (UI may show disabled). */
export const MAP_FUTURE_TOOLS = ['draw-point', 'clear'] as const satisfies readonly MapToolMode[];

export function isMapToolMode(value: unknown): value is MapToolMode {
	return typeof value === 'string' && (MAP_TOOL_MODES as readonly string[]).includes(value);
}

export function isCreateTool(mode: MapToolMode): mode is MapCreateTool {
	return (MAP_CREATE_TOOLS as readonly string[]).includes(mode);
}

export function isActiveTool(mode: MapToolMode): mode is MapActiveTool {
	return (MAP_ACTIVE_TOOLS as readonly string[]).includes(mode);
}

/** Geometry edit tools that lock focus and share save/retry UX. */
export function isGeometryEditTool(mode: MapToolMode): boolean {
	return mode === 'modify' || mode === 'extrude';
}

/** Human label for toolbar buttons. */
export function mapToolLabel(mode: MapToolMode): string {
	switch (mode) {
		case 'navigate':
			return 'Select';
		case 'draw-polygon':
			return 'Draw';
		case 'draw-point':
			return 'Point';
		case 'modify':
			return 'Edit';
		case 'extrude':
			return 'Extrude';
		case 'clear':
			return 'Clear';
	}
}

/** Short help under the toolbar while a tool is active. */
export function mapToolHint(mode: MapToolMode): string | null {
	switch (mode) {
		case 'draw-polygon':
			return 'Click vertices · snap edges/points · Shift = 0°/90° · align to other corners · double-click finishes · Esc cancels';
		case 'draw-point':
			return 'Click to place · snaps to geometry and alignment guides';
		case 'modify':
			return 'Drag corners · click edge/midpoint to add · Alt+click corner to remove · snap · Shift = 0°/90° · release saves · Esc exits';
		case 'extrude':
			return 'Hover an edge · drag along its normal · snaps depth to nearby parallel edges/vertices · release saves · Esc exits';
		case 'clear':
			return 'Clear geometry on the focused feature';
		default:
			return null;
	}
}
