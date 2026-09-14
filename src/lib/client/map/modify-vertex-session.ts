/**
 * Browser-only vertex modify session: move / add / remove corners + CAD snap.
 *
 * - Drag existing corners
 * - Pointer-down on an edge inserts a vertex (then drag to place)
 * - Alt+click an existing corner removes it (OL keeps ≥3 polygon corners)
 *
 * Snap stack matches draw (MapSnapAssist):
 *   Alignment → Feature Snap → Modify
 *
 * Edit-specific anti-stick rules:
 * - OL feature Snap excludes the feature being edited (own edges/vertex pinned the pointer)
 * - Feature Snap is off until drag starts (so vertex hit-test stays clean)
 * - Alignment still uses other corners of the same shape; drag-start + live vertex filtered out
 * - Shift locks the dragged corner to H/V from its start position
 */

import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Collection from 'ol/Collection';
import Modify from 'ol/interaction/Modify';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { altKeyOnly, singleClick } from 'ol/events/condition';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import type { XY } from './draw-snap';
import { olToWritableGeoJSON, type WritableGeoJSON } from './geometry-ol';
import { MAP_SNAP_PIXEL_TOLERANCE, MapSnapAssist } from './map-snap-assist';

export const MODIFY_PIXEL_TOLERANCE = MAP_SNAP_PIXEL_TOLERANCE;

/** Drag handle for the active vertex under the pointer (existing or mid-edge insert). */
const VERTEX_HANDLE_STYLE = new Style({
	image: new CircleStyle({
		radius: 6,
		fill: new Fill({ color: 'rgba(250, 250, 250, 0.95)' }),
		stroke: new Stroke({ color: '#7c3aed', width: 2 })
	})
});

export type ModifyCommit = {
	id: string;
	table: string;
	geometry: WritableGeoJSON;
	/** Restore feature geometry from before this edit. */
	revert: () => void;
};

type SessionOptions = {
	map: Map;
	/** Live vector sources to snap / align against. */
	getSnapSources: () => Iterable<VectorSource>;
	/** Fired once after a vertex move / insert / delete finishes. */
	onCommit: (commit: ModifyCommit) => void;
};

/**
 * Owns Modify + MapSnapAssist for one focused feature.
 * Call {@link setFeature} when focus changes while the Edit tool is active.
 */
export class ModifyVertexSession {
	readonly modify: Modify;
	private readonly map: Map;
	private readonly onCommit: (commit: ModifyCommit) => void;
	private readonly features = new Collection<Feature>();
	private readonly snap: MapSnapAssist;
	private preDragGeometry: Geometry | null = null;
	/** Vertex position at drag start — Shift ortho anchor + alignment exclude. */
	private dragStart: XY | null = null;
	private dragging = false;
	private disposed = false;
	private locked = false;

	constructor(options: SessionOptions) {
		this.map = options.map;
		this.onCommit = options.onCommit;

		this.modify = new Modify({
			features: this.features,
			pixelTolerance: MODIFY_PIXEL_TOLERANCE,
			// Edge press inserts a vertex (when unlocked)
			insertVertexCondition: () => !this.locked && !this.disposed,
			// Alt+click removes the hovered corner (OL enforces min ring size)
			deleteCondition: (evt) =>
				!this.locked && !this.disposed && altKeyOnly(evt) && singleClick(evt),
			// Always follow the (possibly snapped) pointer while dragging
			snapToPointer: true,
			style: VERTEX_HANDLE_STYLE,
			wrapX: false
		});

		this.modify.on('modifystart', (evt) => {
			const feature = this.features.item(0);
			const geom = feature?.getGeometry();
			this.preDragGeometry = geom ? geom.clone() : null;
			this.dragging = true;

			const c = evt.mapBrowserEvent?.coordinate;
			this.dragStart =
				c && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
					? [c[0]!, c[1]!]
					: null;

			// Edit mutates live geometry — refresh targets, enable feature snap (others only)
			this.snap.invalidateVertexCache();
			this.snap.rebindFeatureSnaps();
			this.snap.setSnapsActive(true);
		});

		this.modify.on('modifyend', () => {
			this.dragging = false;
			this.dragStart = null;
			this.snap.setSnapsActive(false);
			this.snap.clearGuides();
			this.snap.invalidateVertexCache();

			const feature = this.features.item(0);
			if (!feature) return;

			// Topology change (insert/delete) — refresh static corner handles
			feature.changed();

			const id = feature.getId();
			const table = feature.get('table');
			if (id == null || typeof table !== 'string' || !table) return;

			const geom = feature.getGeometry() ?? null;
			const writable = olToWritableGeoJSON(geom);
			if (!writable) return;

			const snapshot = this.preDragGeometry;
			this.preDragGeometry = null;

			// No-op when delete was refused (e.g. triangle already at min corners)
			if (snapshot && geom && geometriesEqualXY(snapshot, geom)) return;

			this.onCommit({
				id: String(id),
				table,
				geometry: writable,
				revert: () => {
					if (snapshot) feature.setGeometry(snapshot.clone());
				}
			});
		});

		this.snap = new MapSnapAssist({
			map: this.map,
			getSnapSources: options.getSnapSources,
			// Only constrain while a corner is mid-drag (avoid hover fighting Select)
			isEnabled: () => this.dragging && !this.locked && !this.disposed,
			// Shift = H/V from the corner's start position
			getAnchor: () => this.dragStart,
			// Do not align back onto the pre-drag corner
			getExcludeVertices: () => (this.dragStart ? [this.dragStart] : []),
			// Critical: don't OL-snap to own edges / live vertex (that pinned near start)
			getExcludeFeatures: () => {
				const f = this.features.item(0);
				return f ? [f] : [];
			}
		});

		// Add order: Modify → snaps → alignment last
		this.map.addInteraction(this.modify);
		this.snap.attach();
		// Idle: feature snap off so pointer hit-test can grab corners cleanly
		this.snap.setSnapsActive(false);
	}

	/** Bind the focused editable feature, or clear when null. */
	setFeature(feature: Feature | null) {
		if (this.disposed) return;
		const current = this.features.item(0) ?? null;
		if (current === feature) {
			this.modify.setActive(!this.locked && this.features.getLength() > 0);
			return;
		}

		this.features.clear();
		this.preDragGeometry = null;
		this.dragging = false;
		this.dragStart = null;
		this.snap.setSnapsActive(false);
		this.snap.clearGuides();
		if (feature) this.features.push(feature);
		this.modify.setActive(!this.locked && this.features.getLength() > 0);
		this.snap.invalidateVertexCache();
		// Exclude set changed — rebuild snap feature list
		this.snap.rebindFeatureSnaps();
		this.snap.setSnapsActive(false);
	}

	/** Freeze interaction while a save is pending/failed. */
	setLocked(locked: boolean) {
		this.locked = locked;
		this.modify.setActive(!this.disposed && !locked && this.features.getLength() > 0);
		if (locked) {
			this.dragging = false;
			this.dragStart = null;
			this.snap.setSnapsActive(false);
			this.snap.clearGuides();
		}
	}

	/** Call when vector layers reload so Snap targets stay current. */
	rebindFeatureSnaps() {
		this.snap.rebindFeatureSnaps();
		// Preserve idle vs dragging snap state
		this.snap.setSnapsActive(this.dragging && !this.locked);
	}

	getFeature(): Feature | null {
		return this.features.item(0) ?? null;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.features.clear();
		this.preDragGeometry = null;
		this.dragging = false;
		this.dragStart = null;
		this.snap.dispose();
		this.map.removeInteraction(this.modify);
		this.modify.dispose();
	}
}

/** Find a live OL feature by record id across map vector layers. */
export function findMapFeatureById(map: Map, id: string): Feature | null {
	for (const layer of map.getLayers().getArray()) {
		if (!(layer instanceof VectorLayer)) continue;
		const role = layer.get('role');
		if (role === 'draft' || role === 'snap-guides') continue;
		const source = layer.getSource();
		if (!(source instanceof VectorSource)) continue;
		const feature = source.getFeatureById(id);
		if (feature) return feature;
	}
	return null;
}

/** Shallow XY equality for Point / Polygon / LineString (skip no-op commits). */
function geometriesEqualXY(a: Geometry, b: Geometry): boolean {
	if (a === b) return true;
	if (a.getType() !== b.getType()) return false;
	const ac = (a as Geometry & { getCoordinates?: () => unknown }).getCoordinates?.();
	const bc = (b as Geometry & { getCoordinates?: () => unknown }).getCoordinates?.();
	if (ac == null || bc == null) return false;
	return coordsEqual(ac, bc);
}

function coordsEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a === 'number' && typeof b === 'number') {
		return a === b || (Number.isNaN(a) && Number.isNaN(b));
	}
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!coordsEqual(a[i], b[i])) return false;
	}
	return true;
}
