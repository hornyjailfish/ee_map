/**
 * Map editor tool modes (C4.1+).
 * Create-first: navigate + draw-polygon are active; modify/clear/point reserved.
 * Draw tools use DrawSnapSession (feature snap + Shift-ortho + CAD alignment).
 */

export const MAP_TOOL_MODES = [
	'navigate',
	'draw-polygon',
	'draw-point',
	'modify',
	'clear'
] as const;

export type MapToolMode = (typeof MAP_TOOL_MODES)[number];

/** Tools shipped in the create-first slice. */
export const MAP_CREATE_TOOLS = ['navigate', 'draw-polygon'] as const satisfies readonly MapToolMode[];

export type MapCreateTool = (typeof MAP_CREATE_TOOLS)[number];

/** Tools reserved for modify / attach / search follow-ups (UI may show disabled). */
export const MAP_FUTURE_TOOLS = ['draw-point', 'modify', 'clear'] as const satisfies readonly MapToolMode[];

export function isMapToolMode(value: unknown): value is MapToolMode {
	return typeof value === 'string' && (MAP_TOOL_MODES as readonly string[]).includes(value);
}

export function isCreateTool(mode: MapToolMode): mode is MapCreateTool {
	return (MAP_CREATE_TOOLS as readonly string[]).includes(mode);
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
			return 'Drag vertices to reshape the focused feature';
		case 'clear':
			return 'Clear geometry on the focused feature';
		default:
			return null;
	}
}
