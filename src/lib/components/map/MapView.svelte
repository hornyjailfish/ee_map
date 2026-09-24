<script lang="ts">
	/**
	 * Client-only OpenLayers map on an identity metric XY plane (no Web Mercator).
	 * Layers are DB-backed MapViewModel features loaded via VectorSource.loader.
	 * Parent should mount this only when `browser` is true (same pattern as GraphView).
	 *
	 * C4.1 create: DrawSnapSession when `tool` is draw-polygon / draw-point —
	 * feature Snap + Shift-ortho + vertex alignment guides.
	 * C4.1b edit: ModifyVertexSession when `tool` is modify — move / add / remove corners.
	 * C4.1c extrude: ModifyExtrudeSession when `tool` is extrude — polygon edge push/pull.
	 */
	import type { Attachment } from 'svelte/attachments';
	import { untrack } from 'svelte';
	import Map from 'ol/Map';
	import View from 'ol/View';
	import VectorLayer from 'ol/layer/Vector';
	import VectorSource from 'ol/source/Vector';
	import Feature from 'ol/Feature';
	import type { FeatureLike } from 'ol/Feature';
	import Projection from 'ol/proj/Projection';
	import { getCenter } from 'ol/extent';
	import { all as loadAll } from 'ol/loadingstrategy';
	import type { Type as GeometryType } from 'ol/geom/Geometry';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import {
		normalizedToOl,
		olToWritableGeoJSON,
		type MapToolMode,
		type ModifyCommit,
		type WritableGeoJSON
	} from '$lib/client/map';
	import {
		collectMapVectorSources,
		DrawSnapSession
	} from '$lib/client/map/draw-snap-session';
	import {
		findMapFeatureById,
		ModifyVertexSession
	} from '$lib/client/map/modify-vertex-session';
	import { ModifyExtrudeSession } from '$lib/client/map/modify-extrude-session';
	import { withVertexHandles } from '$lib/client/map/vertex-handles';
	import { styleFor } from '$lib/client/registries/styles';
	import type { MapFeature, MapViewModel, NormalizedGeometry } from '$lib/transform/to-map';
	import 'ol/ol.css';

	type Props = {
		view: MapViewModel;
		/** EDITOR/OWNER — enable draw/modify interactions when tool is set. */
		canEdit?: boolean;
		/** Active tool; `navigate` is pan/select only. */
		tool?: MapToolMode;
		/**
		 * Transient sketch after draw (held until create modal confirms/cancels).
		 * Rendered above live layers with the draft style.
		 */
		draftGeometry?: NormalizedGeometry | null;
		/** Style key for draft sketch (defaults to `draw-draft`). */
		draftStyleKey?: string;
		/** Freeze vertex/edge drag while a geometry save is in flight / failed. */
		modifyLocked?: boolean;
		/** Fired when a draw tool completes a writable Point/Polygon. */
		onDrawEnd?: (geometry: WritableGeoJSON) => void;
		/** Fired when a vertex or edge edit finishes on the focused feature. */
		onModifyEnd?: (commit: ModifyCommit) => void;
		class?: string;
	};

	let {
		view,
		canEdit = false,
		tool = 'navigate',
		draftGeometry = null,
		draftStyleKey = 'draw-draft',
		modifyLocked = false,
		onDrawEnd,
		onModifyEnd,
		class: className = ''
	}: Props = $props();

	const FALLBACK_EXTENT: [number, number, number, number] = [-1000, -1000, 1000, 1000];

	function resolveExtent(v: MapViewModel): [number, number, number, number] {
		if (v.extent && v.extent.length === 4) {
			const [a, b, c, d] = v.extent;
			if ([a, b, c, d].every((n) => typeof n === 'number' && Number.isFinite(n))) {
				// Degenerate (point) box — pad so View.fit still works
				if (a === c || b === d) {
					const pad = 10;
					return [a - pad, b - pad, c + pad, d + pad];
				}
				return [a, b, c, d];
			}
		}
		return FALLBACK_EXTENT;
	}

	function featureToOl(mf: MapFeature): Feature | null {
		const geom = normalizedToOl(mf.geometry);
		if (!geom) return null;

		const f = new Feature({ geometry: geom });
		f.setId(mf.id);
		f.set('styleKey', mf.styleKey);
		f.set('table', mf.table);
		f.set('levelId', mf.levelId);
		if (mf.label !== undefined) f.set('label', mf.label);
		if (mf.layerGroup !== undefined) f.set('layerGroup', mf.layerGroup);
		return f;
	}

	function drawTypeForTool(mode: MapToolMode): GeometryType | null {
		if (mode === 'draw-polygon') return 'Polygon';
		if (mode === 'draw-point') return 'Point';
		return null;
	}

	/**
	 * Attachment owns the OL Map lifecycle.
	 * Nested effects track `view` (layers + extent), focus, tool, and draft geometry.
	 */
	const mapAttach: Attachment<HTMLDivElement> = (element) => {
		// Do not subscribe to `view` here — nested $effect owns updates.
		// Otherwise level navigation would destroy/recreate the whole Map.
		const initialExtent = untrack(() => resolveExtent(view));
		const projection = new Projection({
			code: 'MAP:XY',
			units: 'm',
			extent: initialExtent
		});

		const map = new Map({
			target: element,
			layers: [],
			controls: [],
			view: new View({
				projection,
				extent: [-100, -100, 500, 500],
				center: getCenter(initialExtent),
				zoom: 2,
				multiWorld: false
			})
		});

		map.getView().fit(initialExtent, {
			padding: [24, 24, 24, 24],
			maxZoom: 6,
			duration: 0
		});

		const resizeObserver = new ResizeObserver(() => {
			map.updateSize();
		});
		resizeObserver.observe(element);

		/** Draft sketch source — Draw writes here; confirmed draft stays until parent clears. */
		const draftSource = new VectorSource({ wrapX: false });
		const draftLayer = new VectorLayer({
			source: draftSource,
			zIndex: 10_000,
			style: (olFeature: FeatureLike) => {
				const key = (olFeature.get('styleKey') as string | undefined) ?? draftStyleKey;
				return styleFor(key, { focused: true });
			},
			properties: { role: 'draft' }
		});
		map.addLayer(draftLayer);

		map.on('singleclick', (evt) => {
			// While drawing, let Draw own the click; skip selection changes mid-sketch.
			if (drawBox.session) return;
			// While a geometry save needs retry/cancel, keep focus stable.
			if (toolBox.modifyLocked) return;

			// Edit/extrude own pointer clicks (add/remove vertex, edge drag).
			// Empty hits and Alt+click (delete vertex) must NOT clear focus — that
			// unbinds the edit session and feels like a deselect after remove.
			const editMode = toolBox.mode === 'modify' || toolBox.mode === 'extrude';
			const original = evt.originalEvent as MouseEvent | PointerEvent | undefined;
			if (editMode && original?.altKey) return;

			const hit = map.forEachFeatureAtPixel(
				evt.pixel,
				(f) => f,
				{
					hitTolerance: 4,
					layerFilter: (layer) => {
						if (layer === draftLayer) return false;
						const role = layer.get('role');
						return role !== 'snap-guides' && role !== 'extrude-highlight';
					}
				}
			);
			if (hit) {
				const id = hit.getId();
				appUi.focusRecord(id != null ? String(id) : null);
			} else if (!editMode) {
				// Navigate: click empty map clears selection.
				// Edit/extrude: miss keeps the feature under edit selected.
				appUi.focusRecord(null);
			}
		});

		let lastExtentKey = initialExtent.join(',');
		/** Mutable so OL style fn can read focus without subscribing the layer $effect. */
		const focusBox: { id: string | null } = { id: untrack(() => appUi.focusedId) };
		/** Mutable edit-mode flags for style fn + click gate (no effect churn). */
		const toolBox: { mode: MapToolMode; modifyLocked: boolean } = {
			mode: untrack(() => tool),
			modifyLocked: untrack(() => modifyLocked)
		};
		/** Latest callbacks without rebinding interactions on every render. */
		const drawCb: {
			onDrawEnd?: (geometry: WritableGeoJSON) => void;
			onModifyEnd?: (commit: ModifyCommit) => void;
		} = {
			onDrawEnd: untrack(() => onDrawEnd),
			onModifyEnd: untrack(() => onModifyEnd)
		};
		/** Draw + feature Snap + CAD alignment/ortho session (null when navigate). */
		const drawBox: { session: DrawSnapSession | null } = { session: null };
		/** Vertex modify session (null unless tool === modify). */
		const modifyBox: { session: ModifyVertexSession | null } = { session: null };
		/** Polygon edge-extrude session (null unless tool === extrude). */
		const extrudeBox: { session: ModifyExtrudeSession | null } = { session: null };

		function disposeDrawSession() {
			drawBox.session?.dispose();
			drawBox.session = null;
		}

		function disposeModifySession() {
			modifyBox.session?.dispose();
			modifyBox.session = null;
		}

		function disposeExtrudeSession() {
			extrudeBox.session?.dispose();
			extrudeBox.session = null;
		}

		// Keep callback + lock pointers fresh
		$effect(() => {
			drawCb.onDrawEnd = onDrawEnd;
			drawCb.onModifyEnd = onModifyEnd;
		});

		$effect(() => {
			toolBox.mode = tool;
			toolBox.modifyLocked = modifyLocked;
			modifyBox.session?.setLocked(modifyLocked);
			extrudeBox.session?.setLocked(modifyLocked);
			for (const layer of map.getLayers().getArray()) {
				if (layer === draftLayer) continue;
				if (layer.get('role') === 'snap-guides') continue;
				if (layer.get('role') === 'extrude-highlight') continue;
				layer.changed();
			}
		});

		// Layers + fit when MapViewModel changes (level navigation etc.)
		$effect(() => {
			const v = view;

			const existing = [...map.getLayers().getArray()];
			for (const layer of existing) {
				if (layer === draftLayer) continue;
				// Draw/edit sessions own temporary overlays.
				const role = layer.get('role');
				if (role === 'snap-guides' || role === 'extrude-highlight') continue;
				map.removeLayer(layer);
			}

			const layers = [...v.layers].sort(
				(a, b) => a.zIndex - b.zIndex || a.table.localeCompare(b.table)
			);

			for (const layerView of layers) {
				// DB rows already queried in /map load → toMap; loader materializes features
				const snapshot = layerView.features.slice();
				const source = new VectorSource({
					strategy: loadAll,
					loader: async () => {
						const out: Feature[] = [];
						for (const mf of snapshot) {
							const olFeature = featureToOl(mf);
							if (olFeature) out.push(olFeature);
						}
						return out;
					}
				});

				const vector = new VectorLayer({
					source,
					zIndex: layerView.zIndex,
					updateWhileAnimating: true,
					updateWhileInteracting: true,
					style: (olFeature: FeatureLike) => {
						const id = olFeature.getId();
						const styleKey =
							(olFeature.get('styleKey') as string | undefined) ?? layerView.styleKey;
						const focused = id != null && String(id) === focusBox.id;
						const base = styleFor(styleKey, { focused });
						// Show corner + mid-edge handles on the focused feature while Edit is active
						if (focused && toolBox.mode === 'modify') {
							return withVertexHandles(base, olFeature);
						}
						return base;
					},
					properties: {
						table: layerView.table,
						styleKey: layerView.styleKey
					}
				});

				map.addLayer(vector);
			}

			// Keep draft + guides / highlights on top after layer rebuild
			draftLayer.setZIndex(10_000);
			for (const layer of map.getLayers().getArray()) {
				const role = layer.get('role');
				if (role === 'extrude-highlight') layer.setZIndex(10_040);
				if (role === 'snap-guides') layer.setZIndex(10_050);
			}
			// Layer sources changed — rebind feature snaps while draw/edit is active.
			drawBox.session?.rebindFeatureSnaps();
			modifyBox.session?.rebindFeatureSnaps();
			extrudeBox.session?.rebindFeatureSnaps();

			const nextExtent = resolveExtent(v);
			const key = nextExtent.join(',');
			if (key !== lastExtentKey) {
				lastExtentKey = key;
				projection.setExtent(nextExtent);
				map.getView().fit(nextExtent, {
					padding: [24, 24, 24, 24],
					maxZoom: 6,
					duration: 0
				});
			}
		});

		// Focus highlight only — do not rebuild geometry or reset view
		$effect(() => {
			focusBox.id = appUi.focusedId;
			for (const layer of map.getLayers().getArray()) {
				if (layer === draftLayer) continue;
				const role = layer.get('role');
				if (role === 'snap-guides' || role === 'extrude-highlight') continue;
				layer.changed();
			}
			});

		// Pending draft geometry (after draw, before create submit / cancel)
		$effect(() => {
			const draft = draftGeometry;
			const styleKey = draftStyleKey;
			// Keep in-progress Draw vertices (role undefined); only replace confirmed draft
			for (const f of draftSource.getFeatures().slice()) {
				if (f.get('role') === 'confirmed') draftSource.removeFeature(f);
			}
			if (draft && draft.kind !== 'empty') {
				const geom = normalizedToOl(draft);
				if (geom) {
					const f = new Feature({ geometry: geom });
					f.set('role', 'confirmed');
					f.set('styleKey', styleKey);
					draftSource.addFeature(f);
				}
			}
		});

		// Draw + snap session — create tools only
		$effect(() => {
			const mode = tool;
			const edit = canEdit;

			disposeDrawSession();

			const geomType = edit ? drawTypeForTool(mode) : null;
			if (!geomType) {
				if (mode !== 'modify' && mode !== 'extrude') element.style.cursor = '';
				return;
			}

			// Draw and geometry-edit tools are mutually exclusive
			disposeModifySession();
			disposeExtrudeSession();

			const session = new DrawSnapSession({
				map,
				draftSource,
				type: geomType,
				getSnapSources: () => collectMapVectorSources(map, [draftSource])
			});

			session.draw.on('drawend', (evt) => {
				const feature = evt.feature;
				feature.set('styleKey', draftStyleKey);
				const writable = olToWritableGeoJSON(feature.getGeometry() ?? null);
				// Draw already added the feature; parent will set draftGeometry
				queueMicrotask(() => {
					if (draftSource.hasFeature(feature)) draftSource.removeFeature(feature);
				});
				if (writable) drawCb.onDrawEnd?.(writable);
			});

			drawBox.session = session;
			element.style.cursor = 'crosshair';

			return () => {
				if (drawBox.session === session) {
					session.dispose();
					drawBox.session = null;
				}
				element.style.cursor = '';
			};
		});

		// Vertex edit session — move / add / remove corners on the focused feature
		$effect(() => {
			const mode = tool;
			const edit = canEdit;
			const focusedId = appUi.focusedId;
			// Re-run after layer rebuild so features are findable again
			void view;

			disposeModifySession();

			if (!edit || mode !== 'modify') {
				if (mode !== 'draw-polygon' && mode !== 'draw-point' && mode !== 'extrude') {
					element.style.cursor = '';
				}
				return;
			}

			disposeExtrudeSession();

			const session = new ModifyVertexSession({
				map,
				getSnapSources: () => collectMapVectorSources(map, [draftSource]),
				onCommit: (commit) => drawCb.onModifyEnd?.(commit)
			});
			session.setLocked(toolBox.modifyLocked);
			modifyBox.session = session;

			const bindFocused = () => {
				const feature = focusedId ? findMapFeatureById(map, focusedId) : null;
				session.setFeature(feature);
				element.style.cursor = feature && !toolBox.modifyLocked ? 'grab' : '';
			};
			bindFocused();

			// VectorSource loaders are async — rebind when features appear (e.g. focus from graph).
			const sources = [...collectMapVectorSources(map, [draftSource])];
			for (const source of sources) {
				source.on('addfeature', bindFocused);
				source.on('removefeature', bindFocused);
				source.on('clear', bindFocused);
			}

			return () => {
				for (const source of sources) {
					source.un('addfeature', bindFocused);
					source.un('removefeature', bindFocused);
					source.un('clear', bindFocused);
				}
				if (modifyBox.session === session) {
					session.dispose();
					modifyBox.session = null;
				}
				element.style.cursor = '';
			};
		});

		// Edge extrude session — push/pull nearest polygon edge along its normal
		$effect(() => {
			const mode = tool;
			const edit = canEdit;
			const focusedId = appUi.focusedId;
			void view;

			disposeExtrudeSession();

			if (!edit || mode !== 'extrude') {
				if (mode !== 'draw-polygon' && mode !== 'draw-point' && mode !== 'modify') {
					element.style.cursor = '';
				}
				return;
			}

			disposeModifySession();

			const session = new ModifyExtrudeSession({
				map,
				getSnapSources: () => collectMapVectorSources(map, [draftSource]),
				onCommit: (commit) => drawCb.onModifyEnd?.(commit)
			});
			session.setLocked(toolBox.modifyLocked);
			extrudeBox.session = session;

			const bindFocused = () => {
				const feature = focusedId ? findMapFeatureById(map, focusedId) : null;
				const poly =
					feature && feature.getGeometry()?.getType() === 'Polygon' ? feature : null;
				session.setFeature(poly);
				element.style.cursor = poly && !toolBox.modifyLocked ? 'grab' : '';
			};
			bindFocused();

			const sources = [...collectMapVectorSources(map, [draftSource])];
			for (const source of sources) {
				source.on('addfeature', bindFocused);
				source.on('removefeature', bindFocused);
				source.on('clear', bindFocused);
			}

			return () => {
				for (const source of sources) {
					source.un('addfeature', bindFocused);
					source.un('removefeature', bindFocused);
					source.un('clear', bindFocused);
				}
				if (extrudeBox.session === session) {
					session.dispose();
					extrudeBox.session = null;
				}
				element.style.cursor = '';
			};
		});

		// Esc cancels in-progress draw (edit exit is handled by the page tool state)
		const onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key !== 'Escape') return;
			if (drawBox.session) {
				drawBox.session.abortDrawing();
				const stale = draftSource
					.getFeatures()
					.filter((f) => f.get('role') !== 'confirmed');
				for (const f of stale) draftSource.removeFeature(f);
			}
		};
		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
			resizeObserver.disconnect();
			disposeDrawSession();
			disposeModifySession();
			disposeExtrudeSession();
			map.setTarget(undefined);
			map.dispose();
		};
	};
</script>

<div
	class={[
		'h-full min-h-0 w-full overflow-hidden',
		tool !== 'navigate' && canEdit ? 'map-tool-active' : null,
		className
	]}
	role="application"
	aria-label="Indoor map"
	{@attach mapAttach}
></div>

<style>
	/* OL default canvas needs explicit size from flex parent */
	div :global(.ol-viewport) {
		height: 100%;
		width: 100%;
	}
</style>
