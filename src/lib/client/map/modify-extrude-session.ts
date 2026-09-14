/**
 * Browser-only polygon edge-extrude session.
 *
 * Hover nearest edge → highlight → drag along edge normal → commit on pointer up.
 * Snap is 1D along the edge normal (vertex/parallel-edge depths near the edge strip),
 * not free 2D feature snap — that jumped off-normal to distant geometry.
 */

import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import type { SimpleGeometry } from 'ol/geom';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Interaction from 'ol/interaction/Interaction';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import type { Coordinate } from 'ol/coordinate';
import { collectVertices, type XY as SnapXY } from './draw-snap';
import {
	collectExtrudeSnapCandidates,
	extrudePolygonEdge,
	findClosestEdge,
	listPolygonEdges,
	openRingLength,
	projectAlongNormal,
	snapExtrudeDistance,
	type ExtrudeSegment,
	type ExtrudeSnapCandidate,
	type XY
} from './edge-extrude';
import { olToWritableGeoJSON } from './geometry-ol';
import { MAP_SNAP_PIXEL_TOLERANCE } from './map-snap-assist';
import type { ModifyCommit } from './modify-vertex-session';

export { findMapFeatureById } from './modify-vertex-session';
export type { ModifyCommit } from './modify-vertex-session';

const EDGE_HIGHLIGHT_STYLE = new Style({
	stroke: new Stroke({
		color: '#7c3aed',
		width: 3.5
	})
});

const SNAP_GUIDE_STYLE = new Style({
	stroke: new Stroke({
		color: 'rgba(56, 189, 248, 0.85)',
		width: 1,
		lineDash: [6, 5]
	})
});

type SessionOptions = {
	map: Map;
	getSnapSources: () => Iterable<VectorSource>;
	onCommit: (commit: ModifyCommit) => void;
};

type DragState = {
	ringIndex: number;
	edgeIndex: number;
	/** Pre-drag polygon rings (map units). */
	baseRings: XY[][];
	edgeA: XY;
	edgeB: XY;
	/** Left unit normal at drag start (from base geometry). */
	normal: XY;
	/** Pointer coordinate when drag began. */
	pointerOrigin: XY;
	/** 1D snap candidates computed once at drag start. */
	candidates: ExtrudeSnapCandidate[];
	preDragGeometry: Geometry;
};

/**
 * Owns pointer interaction + edge highlight + normal-aligned snap guides.
 */
export class ModifyExtrudeSession {
	private readonly map: Map;
	private readonly onCommit: (commit: ModifyCommit) => void;
	private readonly getSnapSources: () => Iterable<VectorSource>;
	private readonly interaction: Interaction;
	private readonly highlightSource = new VectorSource({ wrapX: false });
	private readonly highlightLayer: VectorLayer<VectorSource>;
	private readonly guideSource = new VectorSource({ wrapX: false });
	private readonly guideLayer: VectorLayer<VectorSource>;
	private feature: Feature | null = null;
	private drag: DragState | null = null;
	private disposed = false;
	private locked = false;

	constructor(options: SessionOptions) {
		this.map = options.map;
		this.onCommit = options.onCommit;
		this.getSnapSources = options.getSnapSources;

		this.highlightLayer = new VectorLayer({
			source: this.highlightSource,
			zIndex: 10_040,
			style: EDGE_HIGHLIGHT_STYLE,
			properties: { role: 'extrude-highlight' },
			updateWhileAnimating: true,
			updateWhileInteracting: true
		});
		this.guideLayer = new VectorLayer({
			source: this.guideSource,
			zIndex: 10_045,
			style: SNAP_GUIDE_STYLE,
			properties: { role: 'snap-guides' },
			updateWhileAnimating: true,
			updateWhileInteracting: true
		});
		this.map.addLayer(this.highlightLayer);
		this.map.addLayer(this.guideLayer);

		this.interaction = new Interaction({
			handleEvent: (evt) => this.handleEvent(evt)
		});
		this.map.addInteraction(this.interaction);
	}

	setFeature(feature: Feature | null) {
		if (this.disposed) return;
		if (this.feature === feature) return;

		this.cancelDrag(true);
		this.feature = feature && isPolygonFeature(feature) ? feature : null;
		this.clearHighlight();
		this.clearGuides();
	}

	setLocked(locked: boolean) {
		this.locked = locked;
		if (locked) {
			// Keep live geometry while save is pending (commit already applied).
			this.cancelDrag(false);
			this.clearHighlight();
			this.clearGuides();
		}
	}

	/** No OL feature snaps to rebind — candidates are rebuilt each drag. */
	rebindFeatureSnaps() {}

	getFeature(): Feature | null {
		return this.feature;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelDrag(false);
		this.feature = null;
		this.clearHighlight();
		this.clearGuides();
		this.map.removeInteraction(this.interaction);
		this.interaction.dispose();
		this.map.removeLayer(this.highlightLayer);
		this.map.removeLayer(this.guideLayer);
		this.highlightSource.clear();
		this.guideSource.clear();
	}

	private handleEvent(
		evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>
	): boolean {
		if (this.disposed || this.locked || !this.feature) return true;

		const type = evt.type;
		if (type === 'pointermove' || type === 'pointerdrag') {
			if (this.drag) {
				this.updateDrag(evt);
				return false;
			}
			if (type === 'pointermove') this.updateHover(evt);
			return true;
		}

		if (type === 'pointerdown') {
			if (evt.originalEvent instanceof MouseEvent && evt.originalEvent.button !== 0) {
				return true;
			}
			return this.beginDrag(evt) ? false : true;
		}

		if (type === 'pointerup' || type === 'pointercancel') {
			if (this.drag) {
				this.endDrag();
				return false;
			}
		}

		return true;
	}

	private updateHover(evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>) {
		const rings = readPolygonRings(this.feature);
		if (!rings || !evt.coordinate) {
			this.clearHighlight();
			return;
		}
		const resolution = evt.map.getView().getResolution() ?? 1;
		const maxDist = MAP_SNAP_PIXEL_TOLERANCE * resolution;
		const point: XY = [evt.coordinate[0]!, evt.coordinate[1]!];
		const hit = findClosestEdge(rings, point, maxDist);
		if (hit) this.setHighlight(hit.a, hit.b);
		else this.clearHighlight();
	}

	private beginDrag(evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>): boolean {
		const feature = this.feature;
		const geom = feature?.getGeometry();
		if (!feature || !(geom instanceof Polygon) || !evt.coordinate) return false;

		const rings = readPolygonRings(feature);
		if (!rings) return false;

		const resolution = evt.map.getView().getResolution() ?? 1;
		const maxDist = MAP_SNAP_PIXEL_TOLERANCE * resolution;
		const point: XY = [evt.coordinate[0]!, evt.coordinate[1]!];
		const hit = findClosestEdge(rings, point, maxDist);
		if (!hit) return false;

		const baseRings = rings.map((r) => r.map((c) => [c[0], c[1]] as XY));
		const { vertices, edges } = collectSnapGeometry(this.getSnapSources(), feature, baseRings, {
			ringIndex: hit.ringIndex,
			edgeIndex: hit.edgeIndex
		});

		const candidates = collectExtrudeSnapCandidates(hit.a, hit.b, hit.normal, vertices, edges, {
			// Reach a bit past endpoints so neighboring / slightly offset walls still catch
			lateralPad: maxDist * 2
		});

		this.drag = {
			ringIndex: hit.ringIndex,
			edgeIndex: hit.edgeIndex,
			baseRings,
			edgeA: [hit.a[0], hit.a[1]],
			edgeB: [hit.b[0], hit.b[1]],
			normal: [hit.normal[0], hit.normal[1]],
			pointerOrigin: [point[0], point[1]],
			candidates,
			preDragGeometry: geom.clone()
		};
		this.setHighlight(hit.a, hit.b);
		this.clearGuides();
		return true;
	}

	private updateDrag(evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>) {
		const drag = this.drag;
		const feature = this.feature;
		if (!drag || !feature || !evt.coordinate) return;

		const resolution = evt.map.getView().getResolution() ?? 1;
		const toleranceMap = MAP_SNAP_PIXEL_TOLERANCE * resolution;
		const cursor: XY = [evt.coordinate[0]!, evt.coordinate[1]!];
		const free = projectAlongNormal(drag.pointerOrigin, cursor, drag.normal);
		const snapped = snapExtrudeDistance(free, drag.candidates, toleranceMap);
		const distance = snapped ? snapped.distance : free;

		const nextRings = extrudePolygonEdge(
			drag.baseRings,
			drag.ringIndex,
			drag.edgeIndex,
			distance
		);
		feature.setGeometry(new Polygon(nextRings as Coordinate[][]));

		const open = nextRings[drag.ringIndex];
		if (open) {
			const n = openRingLength(open);
			if (n >= 2) {
				const a = open[drag.edgeIndex]!;
				const b = open[(drag.edgeIndex + 1) % n]!;
				this.setHighlight(a, b);
			}
		}

		if (snapped && snapped.kind !== 'origin') {
			this.renderSnapGuide(drag, snapped, distance);
		} else {
			this.clearGuides();
		}
	}

	private endDrag() {
		const drag = this.drag;
		const feature = this.feature;
		this.drag = null;
		this.clearGuides();

		if (!drag || !feature) return;

		const id = feature.getId();
		const table = feature.get('table');
		if (id == null || typeof table !== 'string' || !table) {
			feature.setGeometry(drag.preDragGeometry.clone());
			return;
		}

		const writable = olToWritableGeoJSON(feature.getGeometry() ?? null);
		if (!writable) {
			feature.setGeometry(drag.preDragGeometry.clone());
			return;
		}

		const before = olToWritableGeoJSON(drag.preDragGeometry);
		if (before && geometriesEqual(before, writable)) {
			return;
		}

		const snapshot = drag.preDragGeometry;
		this.onCommit({
			id: String(id),
			table,
			geometry: writable,
			revert: () => {
				feature.setGeometry(snapshot.clone());
			}
		});
	}

	private cancelDrag(restore: boolean) {
		if (!this.drag) return;
		const snap = this.drag.preDragGeometry;
		const feature = this.feature;
		this.drag = null;
		this.clearGuides();
		if (restore && feature) feature.setGeometry(snap.clone());
	}

	private setHighlight(a: XY, b: XY) {
		this.highlightSource.clear(true);
		const f = new Feature({
			geometry: new LineString([
				[a[0], a[1]],
				[b[0], b[1]]
			])
		});
		f.set('role', 'extrude-edge');
		this.highlightSource.addFeature(f);
	}

	private clearHighlight() {
		this.highlightSource.clear(true);
	}

	private clearGuides() {
		this.guideSource.clear(true);
	}

	/**
	 * CAD-style dashed H/V cross through the snap origin (same look as draw/vertex align),
	 * plus ticks from origin to the live extruded edge.
	 */
	private renderSnapGuide(drag: DragState, snapped: ExtrudeSnapCandidate, distance: number) {
		this.guideSource.clear(true);

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

		const ox = snapped.origin[0];
		const oy = snapped.origin[1];

		// Full-viewport dashed cross at the alignment target (draw/edit parity)
		const vGuide = new Feature({
			geometry: new LineString([
				[ox, y0],
				[ox, y1]
			])
		});
		vGuide.set('role', 'guide');
		this.guideSource.addFeature(vGuide);

		const hGuide = new Feature({
			geometry: new LineString([
				[x0, oy],
				[x1, oy]
			])
		});
		hGuide.set('role', 'guide');
		this.guideSource.addFeature(hGuide);

		// Live edge line after extrude
		const liveA: XY = [
			drag.edgeA[0] + drag.normal[0] * distance,
			drag.edgeA[1] + drag.normal[1] * distance
		];
		const liveB: XY = [
			drag.edgeB[0] + drag.normal[0] * distance,
			drag.edgeB[1] + drag.normal[1] * distance
		];
		const edgeGuide = new Feature({
			geometry: new LineString([
				[liveA[0], liveA[1]],
				[liveB[0], liveB[1]]
			])
		});
		edgeGuide.set('role', 'guide');
		this.guideSource.addFeature(edgeGuide);

		// Tick from origin down to the extruded edge plane (normal direction)
		const onEdge: XY = [
			drag.edgeA[0] + drag.normal[0] * distance,
			drag.edgeA[1] + drag.normal[1] * distance
		];
		const alongN = projectAlongNormal(onEdge, snapped.origin, drag.normal);
		const foot: XY = [
			snapped.origin[0] - drag.normal[0] * alongN,
			snapped.origin[1] - drag.normal[1] * alongN
		];
		const tick = new Feature({
			geometry: new LineString([
				[ox, oy],
				[foot[0], foot[1]]
			])
		});
		tick.set('role', 'guide-tick');
		this.guideSource.addFeature(tick);
	}
}

function isPolygonFeature(feature: Feature): boolean {
	return feature.getGeometry()?.getType() === 'Polygon';
}

function readPolygonRings(feature: Feature | null): XY[][] | null {
	const geom = feature?.getGeometry();
	if (!(geom instanceof Polygon)) return null;
	const raw = geom.getCoordinates();
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const rings: XY[][] = [];
	for (const ring of raw) {
		if (!Array.isArray(ring) || ring.length < 4) return null;
		const out: XY[] = [];
		for (const c of ring) {
			if (!Array.isArray(c) || c.length < 2) return null;
			const x = Number(c[0]);
			const y = Number(c[1]);
			if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
			out.push([x, y]);
		}
		rings.push(out);
	}
	return rings;
}

/**
 * Vertices + edges from live layers, plus other edges/vertices of the edited polygon
 * (excluding the dragged edge endpoints so d=0 is only the explicit origin candidate).
 */
function collectSnapGeometry(
	sources: Iterable<VectorSource>,
	edited: Feature,
	editedRings: XY[][],
	dragged: { ringIndex: number; edgeIndex: number }
): { vertices: XY[]; edges: ExtrudeSegment[] } {
	const vertices: XY[] = [];
	const edges: ExtrudeSegment[] = [];
	const seenV = new Set<string>();
	const exclude = new Set<string>();

	const dragEdges = listPolygonEdges(editedRings);
	const dragEdge = dragEdges.find(
		(e) => e.ringIndex === dragged.ringIndex && e.edgeIndex === dragged.edgeIndex
	);
	if (dragEdge) {
		exclude.add(vertexKey(dragEdge.a));
		exclude.add(vertexKey(dragEdge.b));
	}

	const pushVertex = (xy: XY) => {
		const key = vertexKey(xy);
		if (exclude.has(key) || seenV.has(key)) return;
		seenV.add(key);
		vertices.push([xy[0], xy[1]]);
	};

	const pushEdge = (a: XY, b: XY) => {
		if (dragEdge && sameXY(a, dragEdge.a) && sameXY(b, dragEdge.b)) return;
		if (dragEdge && sameXY(a, dragEdge.b) && sameXY(b, dragEdge.a)) return;
		edges.push({ a: [a[0], a[1]], b: [b[0], b[1]] });
	};

	// Other geometry on the edited polygon
	for (const edge of dragEdges) {
		if (edge.ringIndex === dragged.ringIndex && edge.edgeIndex === dragged.edgeIndex) continue;
		pushEdge(edge.a, edge.b);
		pushVertex(edge.a);
		pushVertex(edge.b);
	}

	for (const source of sources) {
		for (const feature of source.getFeatures()) {
			if (feature === edited) continue;
			const g = feature.getGeometry();
			if (!g || typeof (g as SimpleGeometry).getCoordinates !== 'function') continue;
			const coords = (g as SimpleGeometry).getCoordinates();
			const verts: SnapXY[] = [];
			collectVertices(coords, verts);
			for (const v of verts) pushVertex(v as XY);

			const type = g.getType();
			if (type === 'Polygon') {
				for (const edge of listPolygonEdges((g as Polygon).getCoordinates() as XY[][])) {
					pushEdge(edge.a, edge.b);
				}
			} else if (type === 'LineString') {
				const c = (coords as Coordinate[]) ?? [];
				for (let i = 0; i + 1 < c.length; i++) {
					const a = c[i]!;
					const b = c[i + 1]!;
					if (a.length < 2 || b.length < 2) continue;
					pushEdge([Number(a[0]), Number(a[1])], [Number(b[0]), Number(b[1])]);
				}
			}
		}
	}

	return { vertices, edges };
}

function vertexKey(xy: XY): string {
	return `${Math.round(xy[0] * 1000)},${Math.round(xy[1] * 1000)}`;
}

function sameXY(a: XY, b: XY): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

function geometriesEqual(
	a: { type: string; coordinates: unknown },
	b: { type: string; coordinates: unknown }
): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
