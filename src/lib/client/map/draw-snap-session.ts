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
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { Coordinate } from 'ol/coordinate';
import Feature from 'ol/Feature';
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
import Snap from 'ol/interaction/Snap';
import Interaction from 'ol/interaction/Interaction';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import {
	applyDrawConstraints,
	collectVertices,
	constrainOrtho,
	type AlignmentGuide,
	type XY
} from './draw-snap';

export const DRAW_SNAP_PIXEL_TOLERANCE = 12;

const GUIDE_STYLE = new Style({
	stroke: new Stroke({
		color: 'rgba(56, 189, 248, 0.85)',
		width: 1,
		lineDash: [6, 5]
	})
});

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
 * Mutates `evt.coordinate` / `evt.pixel` like OL Snap; never consumes the event.
 */
class AlignmentSnapInteraction extends Interaction {
	constructor(private readonly session: DrawSnapSession) {
		super({
			handleEvent: (evt) => {
				session.handlePointer(evt);
				return true;
			}
		});
	}
}

/**
 * Owns Draw + feature Snaps + alignment interaction + guide overlay for one tool session.
 */
export class DrawSnapSession {
	readonly draw: Draw;
	private readonly map: Map;
	private readonly draftSource: VectorSource;
	private readonly getSnapSources: () => Iterable<VectorSource>;
	private readonly guideSource = new VectorSource({ wrapX: false });
	private readonly guideLayer: VectorLayer<VectorSource>;
	private readonly alignment: AlignmentSnapInteraction;
	private featureSnaps: Snap[] = [];
	private snappedSources: VectorSource[] = [];
	private shiftDown = false;
	/** Last committed sketch vertex (map units); null until first click. */
	private anchor: XY | null = null;
	private vertexCache: XY[] = [];
	private cacheDirty = true;
	private readonly onKeyDown: (ev: KeyboardEvent) => void;
	private readonly onKeyUp: (ev: KeyboardEvent) => void;
	private disposed = false;

	constructor(options: SessionOptions) {
		this.map = options.map;
		this.draftSource = options.draftSource;
		this.getSnapSources = options.getSnapSources;

		this.guideLayer = new VectorLayer({
			source: this.guideSource,
			zIndex: 10_050,
			style: GUIDE_STYLE,
			properties: { role: 'snap-guides' }
		});
		this.map.addLayer(this.guideLayer);

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
			this.invalidateVertexCache();
		});
		this.draw.on('drawend', () => {
			this.anchor = null;
			this.clearGuides();
		});
		this.draw.on('drawabort', () => {
			this.anchor = null;
			this.clearGuides();
		});

		this.alignment = new AlignmentSnapInteraction(this);

		this.onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Shift') this.shiftDown = true;
		};
		this.onKeyUp = (ev: KeyboardEvent) => {
			if (ev.key === 'Shift') this.shiftDown = false;
		};
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);

		// Add order: Draw → feature snaps → alignment last (alignment handleEvent runs first).
		this.map.addInteraction(this.draw);
		this.rebindFeatureSnaps();
		this.map.addInteraction(this.alignment);
	}

	/** Call when vector layers reload so Snap targets stay current. */
	rebindFeatureSnaps() {
		this.clearFeatureSnaps();
		if (this.disposed) return;

		const sources = new Set<VectorSource>();
		sources.add(this.draftSource);
		for (const source of this.getSnapSources()) {
			sources.add(source);
		}

		// Keep alignment on top of the stack (last) so it still runs first, while
		// freshly rebound feature snaps sit under it and override when relevant.
		const hadAlignment = this.map.getInteractions().getArray().includes(this.alignment);
		if (hadAlignment) this.map.removeInteraction(this.alignment);

		for (const source of sources) {
			const snap = new Snap({
				source,
				pixelTolerance: DRAW_SNAP_PIXEL_TOLERANCE,
				vertex: true,
				edge: true,
				intersection: true
			});
			this.map.addInteraction(snap);
			this.featureSnaps.push(snap);
			this.snappedSources.push(source);
			source.on('changefeature', this.onSourceChange);
			source.on('addfeature', this.onSourceChange);
			source.on('removefeature', this.onSourceChange);
			source.on('clear', this.onSourceChange);
		}

		if (hadAlignment) this.map.addInteraction(this.alignment);
		this.invalidateVertexCache();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.clearFeatureSnaps();
		this.map.removeInteraction(this.alignment);
		this.map.removeInteraction(this.draw);
		this.map.removeLayer(this.guideLayer);
		this.guideSource.clear();
		this.clearGuides();
	}

	abortDrawing() {
		this.draw.abortDrawing();
		this.anchor = null;
		this.clearGuides();
	}

	get isActive() {
		return !this.disposed;
	}

	/**
	 * Propose ortho + alignment. Feature Snap may override afterward when near geometry.
	 * Guides always reflect the proposed alignment (even if feature snap wins next).
	 */
	handlePointer(evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>) {
		if (this.disposed) return;
		const type = evt.type;
		if (
			type !== 'pointermove' &&
			type !== 'pointerdown' &&
			type !== 'click' &&
			type !== 'singleclick'
		) {
			return;
		}
		if (!evt.coordinate || !evt.map) return;

		this.syncAnchorFromSketch();

		const resolution = evt.map.getView().getResolution() ?? 1;
		const toleranceMap = DRAW_SNAP_PIXEL_TOLERANCE * resolution;
		const cursor: XY = [evt.coordinate[0]!, evt.coordinate[1]!];

		const result = applyDrawConstraints(cursor, {
			vertices: this.getVertices(),
			toleranceMap,
			anchor: this.anchor,
			ortho: this.shiftDown && this.anchor != null
		});

		const moved =
			result.coordinate[0] !== cursor[0] || result.coordinate[1] !== cursor[1];
		if (moved) {
			evt.coordinate = result.coordinate.slice() as Coordinate;
			evt.pixel = evt.map.getPixelFromCoordinate(evt.coordinate);
		}

		if (result.guides.length > 0) {
			this.renderGuides(result.guides, result.coordinate);
		} else {
			this.clearGuides();
		}
	}

	private readonly orthoGeometryFunction: GeometryFunction = (
		coordinates: SketchCoordType,
		geometry: SimpleGeometry | undefined,
		_projection: Projection
	): SimpleGeometry => {
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
			if (this.shiftDown && this.anchor && asLine.length >= 1) {
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
		if (ring && this.shiftDown && this.anchor && ring.length >= 1) {
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

	private getVertices(): XY[] {
		if (!this.cacheDirty) return this.vertexCache;
		const out: XY[] = [];
		const seen = new Set<string>();
		const sources = new Set<VectorSource>();
		sources.add(this.draftSource);
		for (const s of this.getSnapSources()) sources.add(s);

		for (const source of sources) {
			for (const feature of source.getFeatures()) {
				const g = feature.getGeometry();
				if (!g || typeof (g as SimpleGeometry).getCoordinates !== 'function') continue;
				collectVertices((g as SimpleGeometry).getCoordinates(), out, seen);
			}
		}
		this.vertexCache = out;
		this.cacheDirty = false;
		return out;
	}

	private readonly onSourceChange = () => {
		this.invalidateVertexCache();
	};

	private invalidateVertexCache() {
		this.cacheDirty = true;
	}

	private renderGuides(guides: AlignmentGuide[], cursor: XY) {
		this.guideSource.clear(true);
		if (guides.length === 0) return;

		const size = this.map.getSize();
		if (!size) return;
		const extent = this.map.getView().calculateExtent(size);
		if (!extent || extent.length < 4) return;
		const [minX, minY, maxX, maxY] = extent;
		const pad = Math.max(maxX - minX, maxY - minY) * 0.05;
		const x0 = minX - pad;
		const x1 = maxX + pad;
		const y0 = minY - pad;
		const y1 = maxY + pad;

		for (const g of guides) {
			const coords: Coordinate[] =
				g.axis === 'x'
					? [
							[g.value, y0],
							[g.value, y1]
						]
					: [
							[x0, g.value],
							[x1, g.value]
						];
			const f = new Feature({ geometry: new LineString(coords) });
			f.set('role', 'guide');
			this.guideSource.addFeature(f);

			const tick =
				g.axis === 'x'
					? new LineString([g.origin as Coordinate, [g.value, cursor[1]]])
					: new LineString([g.origin as Coordinate, [cursor[0], g.value]]);
			const tf = new Feature({ geometry: tick });
			tf.set('role', 'guide-tick');
			this.guideSource.addFeature(tf);
		}
	}

	private clearGuides() {
		this.guideSource.clear(true);
	}

	private clearFeatureSnaps() {
		for (const source of this.snappedSources) {
			source.un('changefeature', this.onSourceChange);
			source.un('addfeature', this.onSourceChange);
			source.un('removefeature', this.onSourceChange);
			source.un('clear', this.onSourceChange);
		}
		this.snappedSources = [];
		for (const snap of this.featureSnaps) {
			this.map.removeInteraction(snap);
		}
		this.featureSnaps = [];
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
