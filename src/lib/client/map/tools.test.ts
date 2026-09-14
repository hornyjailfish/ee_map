import { describe, it, expect } from 'vitest';
import {
	isActiveTool,
	isCreateTool,
	isGeometryEditTool,
	isMapToolMode,
	mapToolHint,
	mapToolLabel,
	MAP_ACTIVE_TOOLS,
	MAP_FUTURE_TOOLS
} from './tools';

describe('map tools', () => {
	it('recognizes known modes', () => {
		expect(isMapToolMode('modify')).toBe(true);
		expect(isMapToolMode('extrude')).toBe(true);
		expect(isMapToolMode('nope')).toBe(false);
	});

	it('lists modify and extrude as active and clear as future', () => {
		expect(MAP_ACTIVE_TOOLS).toContain('modify');
		expect(MAP_ACTIVE_TOOLS).toContain('extrude');
		expect(MAP_FUTURE_TOOLS).toContain('clear');
		expect(MAP_FUTURE_TOOLS).not.toContain('modify');
		expect(isActiveTool('modify')).toBe(true);
		expect(isActiveTool('extrude')).toBe(true);
		expect(isCreateTool('modify')).toBe(false);
		expect(isGeometryEditTool('modify')).toBe(true);
		expect(isGeometryEditTool('extrude')).toBe(true);
		expect(isGeometryEditTool('draw-polygon')).toBe(false);
	});

	it('labels and hints for edit tools', () => {
		expect(mapToolLabel('modify')).toBe('Edit');
		expect(mapToolHint('modify')).toMatch(/snap/i);
		expect(mapToolHint('modify')).toMatch(/Shift/i);
		expect(mapToolHint('modify')).toMatch(/add/i);
		expect(mapToolHint('modify')).toMatch(/Alt/i);
		expect(mapToolHint('modify')).toMatch(/remove/i);
		expect(mapToolLabel('extrude')).toBe('Extrude');
		expect(mapToolHint('extrude')).toMatch(/edge/i);
		expect(mapToolHint('extrude')).toMatch(/normal/i);
		expect(mapToolHint('extrude')).toMatch(/parallel/i);
	});
});
