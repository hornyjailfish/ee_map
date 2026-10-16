/**
 * Browser-only polygon split session.
 *
 * Flow: hover exterior edge → click anchor → drag/click second point on another edge
 * (Shift = 0°/90° from anchor) → commit two polygons.
 */

import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Interaction from 'ol/interaction/Interaction';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import type { Coordinate } from 'ol/coordinate';
import { constrainOrtho, type XY as SnapXY } from './draw-snap';
import { MAP_SNAP_PIXEL_TOLERANCE } from './map-snap-assist';
import {
	pickBoundaryPoint,
	snapToOtherEdge,
	splitPolygonByEdgePoints,
	splitResultToPolygons,
	type SplitEdgePoint,
	type XY
} from './polygon-split';
import type { WritableGeoJSON } from './geometry-ol';

export type SplitCommit = {
	id: string;
	table: string;
	/** Part geometries after the cut. */
	parts: [WritableGeoJSON, WritableGeoJSON];
	/** Chord endpoints (map units). */
	chord: [XY, XY];
};

type SessionOptions = {
	map: Map;
	onCommit: (commit: SplitCommit) => void;
};

const EDGE_STYLE = new Style({
	stroke: new Stroke({ color: '#7c3aed', width: 3.5 })
});

const LINE_STYLE = new Style({
	stroke: new Stroke({ color: '#7c3aed', width: 2, lineDash: [8, 6] })
});

const ANCHOR_STYLE = new Style({
	image: new CircleStyle({
		radius: 5,
		fill: new Fill({ color: '#7c3aed' }),
		stroke: new Stroke({ color: '#fff', width: 1.5 })
	})
});

function coordToXY(c: Coordinate): XY {
	return [Number(c[0]), Number(c[1])];
}

function ringsFromFeature(feature: Feature): XY[][] | null {
	const geom = feature.getGeometry();
	if (!geom || geom.getType() !== 'Polygon') return null;
	const raw = (geom as Polygon).getCoordinates();
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const rings: XY[][] = [];
	for (const ring of raw) {
		if (!Array.isArray(ring)) continue;
		const pts: XY[] = [];
		for (const c of ring) {
			if (!Array.isArray(c) || c.length < 2) continue;
			const x = Number(c[0]);
			const y = Number(c[1]);
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			pts.push([x, y]);
		}
		if (pts.length >= 3) rings.push(pts);
	}
	return rings.length > 0 ? rings : null;
}

/**
 * Owns pointer interaction + edge/chord overlays for the split tool.
 */
export class SplitPolygonSession {
	private readonly map: Map;
	private readonly onCommit: (commit: SplitCommit) => void;
	private readonly interaction: Interaction;
	private readonly overlaySource = new VectorSource({ wrapX: false });
	private readonly overlayLayer: VectorLayer<VectorSource>;
	private feature: Feature | null = null;
	private anchor: SplitEdgePoint | null = null;
	private hoverEnd: SplitEdgePoint | null = null;
	private disposed = false;
	private locked = false;

	constructor(options: SessionOptions) {
		this.map = options.map;
		this.onCommit = options.onCommit;

		this.overlayLayer = new VectorLayer({
			source: this.overlaySource,
			zIndex: 10_048,
			style: (f) => {
				const role = f.get('role');
				if (role === 'edge') return EDGE_STYLE;
				if (role === 'anchor' || role === 'end') return ANCHOR_STYLE;
				if (role === 'chord') return LINE_STYLE;
				return undefined;
			},
			properties: { role: 'split-overlay' },
			updateWhileAnimating: true,
			updateWhileInteracting: true
		});
		this.map.addLayer(this.overlayLayer);

		this.interaction = new Interaction({
			handleEvent: (evt) => this.handleEvent(evt)
		});
		this.map.addInteraction(this.interaction);
	}

	setLocked(locked: boolean) {
		this.locked = locked;
		if (locked) {
			this.anchor = null;
			this.hoverEnd = null;
			this.redraw();
		}
	}

	setFeature(feature: Feature | null) {
		if (this.feature === feature) return;
		this.feature = feature;
		this.anchor = null;
		this.hoverEnd = null;
		this.redraw();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.map.removeInteraction(this.interaction);
		this.map.removeLayer(this.overlayLayer);
		this.overlaySource.clear();
		this.feature = null;
		this.anchor = null;
		this.hoverEnd = null;
	}

	private mapTol(): number {
		const res = this.map.getView().getResolution() ?? 1;
		return Math.max(res * MAP_SNAP_PIXEL_TOLERANCE, res);
	}

	private handleEvent(evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>): boolean {
		if (this.disposed || this.locked || !this.feature) return true;
		const type = evt.type;

		if (type === 'pointermove') {
			this.onMove(evt);
			return true;
		}

		if (type === 'pointerup' || type === 'click' || type === 'singleclick') {
			// Use pointerup so we don't fight OL singleclick focus handler ordering.
			if (type === 'pointerup' && (evt as MapBrowserEvent<PointerEvent>).originalEvent) {
				const oe = (evt as MapBrowserEvent<PointerEvent>).originalEvent as PointerEvent;
				if (oe.button !== 0) return true;
			}
			if (type === 'click' || type === 'singleclick') return true;
			return this.onPointerUp(evt);
		}

		return true;
	}

	private onMove(evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>) {
		const rings = ringsFromFeature(this.feature!);
		if (!rings) return;
		const raw = coordToXY(evt.coordinate);
		const tol = this.mapTol();

		if (!this.anchor) {
			const hit = pickBoundaryPoint(rings, raw, tol);
			this.hoverEnd = hit;
			this.redraw(hit?.point ?? null);
			return;
		}

		let cursor: SnapXY = raw;
		const oe = evt.originalEvent as MouseEvent | PointerEvent | undefined;
		if (oe?.shiftKey) {
			cursor = constrainOrtho(this.anchor.point, raw);
		}

		const end = snapToOtherEdge(rings, cursor, this.anchor, tol * 3);
		this.hoverEnd = end;
		this.redraw(end?.point ?? cursor);
	}

	private onPointerUp(evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>): boolean {
		const rings = ringsFromFeature(this.feature!);
		if (!rings) return true;
		const raw = coordToXY(evt.coordinate);
		const tol = this.mapTol();

		if (!this.anchor) {
			const hit = pickBoundaryPoint(rings, raw, tol);
			if (!hit) return true;
			this.anchor = hit;
			this.hoverEnd = null;
			this.redraw();
			// Consume so MapView doesn't clear focus on empty-ish hits near edge
			return false;
		}

		let cursor: SnapXY = raw;
		const oe = evt.originalEvent as MouseEvent | PointerEvent | undefined;
		if (oe?.shiftKey) {
			cursor = constrainOrtho(this.anchor.point, raw);
		}

		const end =
			snapToOtherEdge(rings, cursor, this.anchor, tol * 3) ??
			pickBoundaryPoint(rings, cursor, tol);
		if (!end || end.edgeIndex === this.anchor.edgeIndex) {
			return false;
		}

		const result = splitPolygonByEdgePoints(rings, this.anchor, end);
		if (!result) {
			// Keep anchor; allow retry with another end edge
			this.hoverEnd = null;
			this.redraw();
			return false;
		}

		const id = this.feature!.getId();
		const table = this.feature!.get('table');
		if (id == null || typeof table !== 'string' || !table) {
			this.resetChord();
			return false;
		}

		const polys = splitResultToPolygons(result);
		this.onCommit({
			id: String(id),
			table,
			parts: polys,
			chord: [result.a.point, result.b.point]
		});

		this.resetChord();
		return false;
	}

	private resetChord() {
		this.anchor = null;
		this.hoverEnd = null;
		this.redraw();
	}

	private redraw(cursor: XY | null = null) {
		this.overlaySource.clear();
		if (!this.feature) return;

		if (this.anchor) {
			const a = new Feature({ geometry: new Point(this.anchor.point) });
			a.set('role', 'anchor');
			this.overlaySource.addFeature(a);

			const endPt = this.hoverEnd?.point ?? cursor;
			if (endPt) {
				const line = new Feature({
					geometry: new LineString([this.anchor.point, endPt])
				});
				line.set('role', 'chord');
				this.overlaySource.addFeature(line);

				if (this.hoverEnd) {
					const e = new Feature({ geometry: new Point(this.hoverEnd.point) });
					e.set('role', 'end');
					this.overlaySource.addFeature(e);

					// Highlight destination edge
					const rings = ringsFromFeature(this.feature);
					if (rings) {
						const open = rings[0]!;
						const n = open.length - (open.length > 1 && open[0]![0] === open[open.length - 1]![0] && open[0]![1] === open[open.length - 1]![1] ? 1 : 0);
						const i = this.hoverEnd.edgeIndex;
						const aPt = open[i]!;
						const bPt = open[(i + 1) % n]!;
						const edge = new Feature({
							geometry: new LineString([aPt, bPt])
						});
						edge.set('role', 'edge');
						this.overlaySource.addFeature(edge);
					}
				}
			}
			return;
		}

		// Hover edge before first click
		if (this.hoverEnd) {
			const rings = ringsFromFeature(this.feature);
			if (rings) {
				const open = rings[0]!;
				const closed =
					open.length > 1 &&
					open[0]![0] === open[open.length - 1]![0] &&
					open[0]![1] === open[open.length - 1]![1];
				const n = closed ? open.length - 1 : open.length;
				const i = this.hoverEnd.edgeIndex;
				const aPt = open[i]!;
				const bPt = open[(i + 1) % n]!;
				const edge = new Feature({ geometry: new LineString([aPt, bPt]) });
				edge.set('role', 'edge');
				this.overlaySource.addFeature(edge);
			}
			const p = new Feature({ geometry: new Point(this.hoverEnd.point) });
			p.set('role', 'anchor');
			this.overlaySource.addFeature(p);
		}
	}
}
