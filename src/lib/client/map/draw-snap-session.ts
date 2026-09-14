/**
 * Browser-only draw snap session: CAD alignment + Shift ortho + guide overlay.
 * Feature vertex/edge/intersection snap stays on OL `Snap`.
 *
 * Interaction order (OL runs last-added first):
 *   AlignmentSnap → Feature Snap(s) → Draw
 * Alignment proposes H/V locks first; feature Snap overrides when the pointer is
 * near real geometry; Draw consumes the final coordinate. Shift-ortho is also
 * enforced in geometryFunction so committed vertices stay 0°/90°.
 */

import type Map from 'ol/Map';
import type { Coordinate } from 'ol/coordinate';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import type { SimpleGeometry } from 'ol/geom';
import type { Type as GeometryType } from 'ol/geom/Geometry';
import type Projection from 'ol/proj/Projection';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { always, never } from 'ol/events/condition';
import Draw, { type GeometryFunction, type SketchCoordType } from 'ol/interaction/Draw';
import { constrainOrtho, type XY } from './draw-snap';
import { MapSnapAssist } from './map-snap-assist';

export { MAP_SNAP_PIXEL_TOLERANCE as DRAW_SNAP_PIXEL_TOLERANCE } from './map-snap-assist';

type SessionOptions = {
	map: Map;
	/** Sketch destination (draft layer source). */
	draftSource: VectorSource;
	/** Geometry type for Draw. */
	type: GeometryType;
	/** Live vector sources to snap against (draft is always included). */
	getSnapSources: () => Iterable<VectorSource>;
};

/**
 * Owns Draw + shared MapSnapAssist (feature snaps + CAD alignment/ortho).
 */
export class DrawSnapSession {
	readonly draw: Draw;
	private readonly map: Map;
	private readonly draftSource: VectorSource;
	private readonly getSnapSources: () => Iterable<VectorSource>;
	private readonly snap: MapSnapAssist;
	/** Last committed sketch vertex (map units); null until first click. */
	private anchor: XY | null = null;
	private disposed = false;

	constructor(options: SessionOptions) {
		this.map = options.map;
		this.draftSource = options.draftSource;
		this.getSnapSources = options.getSnapSources;

		this.draw = new Draw({
			source: this.draftSource,
			type: options.type,
			// Reclaim Shift from freehand; allow Shift+click to place ortho vertices.
			condition: always,
			freehandCondition: never,
			geometryFunction: this.orthoGeometryFunction
		});

		this.draw.on('drawstart', () => {
			this.anchor = null;
			this.snap.invalidateVertexCache();
		});
		this.draw.on('drawend', () => {
			this.anchor = null;
			this.snap.clearGuides();
		});
		this.draw.on('drawabort', () => {
			this.anchor = null;
			this.snap.clearGuides();
		});

		this.snap = new MapSnapAssist({
			map: this.map,
			getSnapSources: () => this.collectSources(),
			getAnchor: () => {
				this.syncAnchorFromSketch();
				return this.anchor;
			}
		});

		// Add order: Draw → snaps → alignment last (alignment handleEvent runs first).
		this.map.addInteraction(this.draw);
		this.snap.attach();
	}

	/** Call when vector layers reload so Snap targets stay current. */
	rebindFeatureSnaps() {
		this.snap.rebindFeatureSnaps();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.snap.dispose();
		this.map.removeInteraction(this.draw);
		this.anchor = null;
	}

	abortDrawing() {
		this.draw.abortDrawing();
		this.anchor = null;
		this.snap.clearGuides();
	}

	get isActive() {
		return !this.disposed;
	}

	private collectSources(): Set<VectorSource> {
		const sources = new Set<VectorSource>();
		sources.add(this.draftSource);
		for (const source of this.getSnapSources()) {
			sources.add(source);
		}
		return sources;
	}

	private readonly orthoGeometryFunction: GeometryFunction = (
		coordinates: SketchCoordType,
		geometry: SimpleGeometry | undefined,
		_projection: Projection
	): SimpleGeometry => {
		const shift = this.snap.isShiftDown;

		// Point
		if (typeof (coordinates as Coordinate)[0] === 'number') {
			const c = coordinates as Coordinate;
			if (!geometry) geometry = new Point(c);
			else (geometry as Point).setCoordinates(c);
			return geometry;
		}

		// LineString: Coordinate[]
		const asLine = coordinates as Coordinate[];
		if (typeof asLine[0]?.[0] === 'number') {
			if (shift && this.anchor && asLine.length >= 1) {
				const last = asLine.length - 1;
				asLine[last] = constrainOrtho(this.anchor, asLine[last] as XY);
			}
			if (!geometry) geometry = new LineString(asLine);
			else (geometry as LineString).setCoordinates(asLine);
			return geometry;
		}

		// Polygon: Coordinate[][]
		const rings = coordinates as Coordinate[][];
		const ring = rings[0];
		if (ring && shift && this.anchor && ring.length >= 1) {
			const last = ring.length - 1;
			ring[last] = constrainOrtho(this.anchor, ring[last] as XY);
		}
		if (geometry) {
			if (ring && ring.length) {
				(geometry as Polygon).setCoordinates([ring.concat([ring[0]!])]);
			} else {
				(geometry as Polygon).setCoordinates([]);
			}
		} else {
			geometry = new Polygon(rings);
		}
		return geometry;
	};

	private syncAnchorFromSketch() {
		const overlay = this.draw.getOverlay();
		const source = overlay.getSource();
		if (!source) return;

		let best: XY | null = null;
		for (const f of source.getFeatures()) {
			const g = f.getGeometry();
			if (!g) continue;
			const t = g.getType();
			if (t === 'LineString') {
				const c = (g as LineString).getCoordinates();
				// Last fixed vertex is second-to-last (last is cursor).
				if (c.length >= 2) {
					const a = c[c.length - 2]!;
					best = [a[0]!, a[1]!];
				} else if (c.length === 1) {
					best = [c[0]![0]!, c[0]![1]!];
				}
			} else if (t === 'Polygon') {
				const ring = (g as Polygon).getCoordinates()[0] ?? [];
				// Closed ring sketch: [...fixed, cursor, first] — anchor = last fixed
				if (ring.length >= 3) {
					const a = ring[ring.length - 3]!;
					best = [a[0]!, a[1]!];
				}
			}
		}
		this.anchor = best;
	}
}

/** Collect VectorSources currently on the map (excluding draft/guides if passed). */
export function collectMapVectorSources(
	map: Map,
	exclude: Iterable<VectorSource> = []
): Set<VectorSource> {
	const skip = new Set(exclude);
	const sources = new Set<VectorSource>();
	for (const layer of map.getLayers().getArray()) {
		if (!(layer instanceof VectorLayer)) continue;
		if (layer.get('role') === 'snap-guides' || layer.get('role') === 'draft') continue;
		const source = layer.getSource();
		if (source instanceof VectorSource && !skip.has(source)) {
			sources.add(source);
		}
	}
	return sources;
}
