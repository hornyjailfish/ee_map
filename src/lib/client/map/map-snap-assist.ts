/**
 * Shared CAD snap stack for draw + vertex edit:
 *   AlignmentSnap (last added → runs first) → OL feature Snap(s) → tool (Draw/Modify)
 *
 * - Shift ortho via caller-provided anchor
 * - H/V alignment guides to existing vertices
 * - Feature vertex/edge/intersection snap (OL Snap)
 *
 * Edit mode must exclude the feature being dragged from OL Snap — otherwise the
 * live vertex/edges pin the pointer near the start position until you leave
 * pixelTolerance. Alignment still uses other corners of that feature (minus
 * the vertex under the cursor).
 */

import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { Coordinate } from 'ol/coordinate';
import Feature from 'ol/Feature';
import LineString from 'ol/geom/LineString';
import type { SimpleGeometry } from 'ol/geom';
import Collection from 'ol/Collection';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Snap from 'ol/interaction/Snap';
import Interaction from 'ol/interaction/Interaction';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import {
	applyDrawConstraints,
	collectVertices,
	type AlignmentGuide,
	type XY
} from './draw-snap';

/** Pixel radius for feature / alignment snap (draw + edit). */
export const MAP_SNAP_PIXEL_TOLERANCE = 16;

const GUIDE_STYLE = new Style({
	stroke: new Stroke({
		color: 'rgba(56, 189, 248, 0.85)',
		width: 1,
		lineDash: [6, 5]
	})
});

export type MapSnapAssistOptions = {
	map: Map;
	/** Live vector sources to snap / align against. */
	getSnapSources: () => Iterable<VectorSource>;
	/**
	 * When false, pointer is left alone and guides clear
	 * (e.g. Edit only while a vertex is mid-drag).
	 */
	isEnabled?: () => boolean;
	/** Last fixed vertex for Shift-ortho (map units). */
	getAnchor?: () => XY | null;
	/**
	 * Vertices ignored by alignment (e.g. drag-start corner so it cannot
	 * snap back to itself).
	 */
	getExcludeVertices?: () => readonly XY[];
	/**
	 * Features omitted from OL feature Snap only (not from alignment vertices).
	 * Edit passes the feature being modified so own edges cannot pin the pointer.
	 */
	getExcludeFeatures?: () => Iterable<Feature>;
};

/**
 * Mutates `evt.coordinate` / `evt.pixel` like OL Snap; never consumes the event.
 */
class AlignmentSnapInteraction extends Interaction {
	constructor(private readonly assist: MapSnapAssist) {
		super({
			handleEvent: (evt) => {
				assist.handlePointer(evt);
				return true;
			}
		});
	}
}

/**
 * Owns feature Snap + alignment interaction + guide overlay.
 * Call {@link attach} after the Draw/Modify interaction is on the map.
 */
export class MapSnapAssist {
	private readonly map: Map;
	private readonly getSnapSources: () => Iterable<VectorSource>;
	private readonly isEnabled: () => boolean;
	private readonly getAnchor: () => XY | null;
	private readonly getExcludeVertices: () => readonly XY[];
	private readonly getExcludeFeatures: () => Iterable<Feature>;
	private readonly guideSource = new VectorSource({ wrapX: false });
	private readonly guideLayer: VectorLayer<VectorSource>;
	private readonly alignment: AlignmentSnapInteraction;
	/** One Snap over a filtered feature set (excludes edited feature). */
	private readonly snapFeatures = new Collection<Feature>();
	private featureSnap: Snap | null = null;
	private snappedSources: VectorSource[] = [];
	private shiftDown = false;
	/** When false, OL Snap is inactive (edit idle — don’t steal vertex hits). */
	private snapsWanted = true;
	private vertexCache: XY[] = [];
	private cacheDirty = true;
	private readonly onKeyDown: (ev: KeyboardEvent) => void;
	private readonly onKeyUp: (ev: KeyboardEvent) => void;
	private disposed = false;
	private attached = false;

	constructor(options: MapSnapAssistOptions) {
		this.map = options.map;
		this.getSnapSources = options.getSnapSources;
		this.isEnabled = options.isEnabled ?? (() => true);
		this.getAnchor = options.getAnchor ?? (() => null);
		this.getExcludeVertices = options.getExcludeVertices ?? (() => []);
		this.getExcludeFeatures = options.getExcludeFeatures ?? (() => []);

		this.guideLayer = new VectorLayer({
			source: this.guideSource,
			zIndex: 10_050,
			style: GUIDE_STYLE,
			properties: { role: 'snap-guides' }
		});
		this.map.addLayer(this.guideLayer);

		this.alignment = new AlignmentSnapInteraction(this);

		this.onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Shift') this.shiftDown = true;
		};
		this.onKeyUp = (ev: KeyboardEvent) => {
			if (ev.key === 'Shift') this.shiftDown = false;
		};
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
	}

	get isShiftDown() {
		return this.shiftDown;
	}

	/**
	 * Enable/disable OL feature Snap (alignment still gated by isEnabled).
	 * Edit keeps this off until a vertex drag starts so hit-testing stays clean.
	 */
	setSnapsActive(active: boolean) {
		this.snapsWanted = active;
		this.featureSnap?.setActive(active && !this.disposed);
		if (!active) this.clearGuides();
	}

	/**
	 * Add feature snap + alignment on top of the stack.
	 * Tool interaction (Draw/Modify) must already be on the map.
	 */
	attach() {
		if (this.disposed || this.attached) return;
		this.attached = true;
		this.rebindFeatureSnaps();
		this.map.addInteraction(this.alignment);
	}

	/** Call when vector layers reload so Snap targets stay current. */
	rebindFeatureSnaps() {
		this.clearFeatureSnaps();
		if (this.disposed || !this.attached) return;

		const sources = new Set<VectorSource>();
		for (const source of this.getSnapSources()) {
			sources.add(source);
		}

		// Keep alignment on top (last) so it still runs first after rebind.
		const hadAlignment = this.map.getInteractions().getArray().includes(this.alignment);
		if (hadAlignment) this.map.removeInteraction(this.alignment);

		this.rebuildSnapFeatures(sources);

		const snap = new Snap({
			features: this.snapFeatures,
			pixelTolerance: MAP_SNAP_PIXEL_TOLERANCE,
			vertex: true,
			edge: true,
			intersection: true
		});
		snap.setActive(this.snapsWanted);
		this.map.addInteraction(snap);
		this.featureSnap = snap;

		for (const source of sources) {
			this.snappedSources.push(source);
			source.on('changefeature', this.onSourceChange);
			source.on('addfeature', this.onSourceChange);
			source.on('removefeature', this.onSourceChange);
			source.on('clear', this.onSourceChange);
		}

		if (hadAlignment) this.map.addInteraction(this.alignment);
		this.invalidateVertexCache();
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

		if (!this.isEnabled()) {
			this.clearGuides();
			return;
		}

		const resolution = evt.map.getView().getResolution() ?? 1;
		const toleranceMap = MAP_SNAP_PIXEL_TOLERANCE * resolution;
		const cursor: XY = [evt.coordinate[0]!, evt.coordinate[1]!];
		const anchor = this.getAnchor();

		// Drop the live dragged vertex (≈ under cursor) so alignment cannot lock to self.
		const selfR2 = (resolution * 2) ** 2;
		const vertices = this.getVertices().filter((v) => {
			const dx = v[0] - cursor[0];
			const dy = v[1] - cursor[1];
			return dx * dx + dy * dy > selfR2;
		});

		const result = applyDrawConstraints(cursor, {
			vertices,
			toleranceMap,
			anchor,
			ortho: this.shiftDown && anchor != null
		});

		const moved = result.coordinate[0] !== cursor[0] || result.coordinate[1] !== cursor[1];
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

	clearGuides() {
		this.guideSource.clear(true);
	}

	invalidateVertexCache() {
		this.cacheDirty = true;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.clearFeatureSnaps();
		if (this.attached) {
			this.map.removeInteraction(this.alignment);
		}
		this.map.removeLayer(this.guideLayer);
		this.guideSource.clear();
		this.clearGuides();
		this.attached = false;
	}

	private rebuildSnapFeatures(sources: Iterable<VectorSource>) {
		const exclude = new Set<Feature>();
		for (const f of this.getExcludeFeatures()) {
			exclude.add(f);
		}

		// Rebuild filtered set — Snap watches the Collection for add/remove.
		const keep = new Set<Feature>();
		for (const source of sources) {
			for (const feature of source.getFeatures()) {
				if (exclude.has(feature)) continue;
				keep.add(feature);
			}
		}

		for (const existing of this.snapFeatures.getArray().slice()) {
			if (!keep.has(existing)) this.snapFeatures.remove(existing);
		}
		for (const feature of keep) {
			if (!this.snapFeatures.getArray().includes(feature)) {
				this.snapFeatures.push(feature);
			}
		}
	}

	private getVertices(): XY[] {
		if (!this.cacheDirty) return this.vertexCache;
		const out: XY[] = [];
		const seen = new Set<string>();

		for (const xy of this.getExcludeVertices()) {
			seen.add(vertexKey(xy));
		}

		// Alignment intentionally includes excluded snap features (other corners of
		// the room being edited) — only getExcludeVertices drops specific points.
		for (const source of this.getSnapSources()) {
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
		// Keep OL Snap feature set in sync (add/remove/clear) without full rebind.
		if (this.featureSnap && this.attached && !this.disposed) {
			this.rebuildSnapFeatures(this.snappedSources);
		}
	};

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

	private clearFeatureSnaps() {
		for (const source of this.snappedSources) {
			source.un('changefeature', this.onSourceChange);
			source.un('addfeature', this.onSourceChange);
			source.un('removefeature', this.onSourceChange);
			source.un('clear', this.onSourceChange);
		}
		this.snappedSources = [];
		if (this.featureSnap) {
			this.map.removeInteraction(this.featureSnap);
			this.featureSnap.dispose();
			this.featureSnap = null;
		}
		this.snapFeatures.clear();
	}
}

function vertexKey(xy: XY): string {
	return `${Math.round(xy[0] * 1000)},${Math.round(xy[1] * 1000)}`;
}
