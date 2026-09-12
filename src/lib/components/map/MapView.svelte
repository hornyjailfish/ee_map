<script lang="ts">
	/**
	 * Client-only OpenLayers map on an identity metric XY plane (no Web Mercator).
	 * Layers are DB-backed MapViewModel features loaded via VectorSource.loader.
	 * Parent should mount this only when `browser` is true (same pattern as GraphView).
	 *
	 * C4.1 create: optional Draw + Snap when `tool` is draw-polygon / draw-point.
	 * Modify interaction hooks are reserved (tool === 'modify') for the next slice.
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
	import Draw from 'ol/interaction/Draw';
	import Snap from 'ol/interaction/Snap';
	import type { Type as GeometryType } from 'ol/geom/Geometry';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import {
		normalizedToOl,
		olToWritableGeoJSON,
		type MapToolMode,
		type WritableGeoJSON
	} from '$lib/client/map';
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
		/** Fired when a draw tool completes a writable Point/Polygon. */
		onDrawEnd?: (geometry: WritableGeoJSON) => void;
		class?: string;
	};

	let {
		view,
		canEdit = false,
		tool = 'navigate',
		draftGeometry = null,
		draftStyleKey = 'draw-draft',
		onDrawEnd,
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
			const drawActive = Boolean(drawBox.interaction);
			if (drawActive) return;

			const hit = map.forEachFeatureAtPixel(
				evt.pixel,
				(f) => f,
				{
					hitTolerance: 4,
					layerFilter: (layer) => layer !== draftLayer
				}
			);
			if (hit) {
				const id = hit.getId();
				appUi.focusRecord(id != null ? String(id) : null);
			} else {
				appUi.focusRecord(null);
			}
		});

		let lastExtentKey = initialExtent.join(',');
		/** Mutable so OL style fn can read focus without subscribing the layer $effect. */
		const focusBox: { id: string | null } = { id: untrack(() => appUi.focusedId) };
		/** Latest draw callback without rebinding interaction on every render. */
		const drawCb: { onDrawEnd?: (geometry: WritableGeoJSON) => void } = {
			onDrawEnd: untrack(() => onDrawEnd)
		};
		const drawBox: { interaction: Draw | null } = { interaction: null };
		/** One Snap per vector source so draw vertices stick to existing geometry. */
		const snapBox: { interactions: Snap[] } = { interactions: [] };

		function clearSnaps() {
			for (const snap of snapBox.interactions) {
				map.removeInteraction(snap);
			}
			snapBox.interactions = [];
		}

		/** Install OL Snap against draft + all live vector layers (call after Draw is on). */
		function installSnaps() {
			clearSnaps();
			if (!drawBox.interaction) return;

			const sources = new Set<VectorSource>();
			sources.add(draftSource);
			for (const layer of map.getLayers().getArray()) {
				if (!(layer instanceof VectorLayer)) continue;
				const source = layer.getSource();
				if (source instanceof VectorSource) sources.add(source);
			}

			for (const source of sources) {
				const snap = new Snap({
					source,
					pixelTolerance: 12,
					vertex: true,
					edge: true
				});
				// After Draw so pointer coords are adjusted before the vertex is committed.
				map.addInteraction(snap);
				snapBox.interactions.push(snap);
			}
		}

		// Keep callback pointer fresh
		$effect(() => {
			drawCb.onDrawEnd = onDrawEnd;
		});

		// Layers + fit when MapViewModel changes (level navigation etc.)
		$effect(() => {
			const v = view;

			const existing = [...map.getLayers().getArray()];
			for (const layer of existing) {
				if (layer === draftLayer) continue;
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
					style: (olFeature: FeatureLike) => {
						const id = olFeature.getId();
						const styleKey =
							(olFeature.get('styleKey') as string | undefined) ?? layerView.styleKey;
						const focused = id != null && String(id) === focusBox.id;
						return styleFor(styleKey, { focused });
					},
					properties: {
						table: layerView.table,
						styleKey: layerView.styleKey
					}
				});

				map.addLayer(vector);
			}

			// Keep draft on top after layer rebuild
			draftLayer.setZIndex(10_000);
			// Layer sources changed — rebind Snap while a draw tool is active.
			installSnaps();

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

		// Draw interaction — create tools only; modify reserved for next slice
		$effect(() => {
			const mode = tool;
			const edit = canEdit;

			clearSnaps();
			if (drawBox.interaction) {
				map.removeInteraction(drawBox.interaction);
				drawBox.interaction = null;
			}

			const geomType = edit ? drawTypeForTool(mode) : null;
			if (!geomType) {
				element.style.cursor = '';
				return;
			}

			const draw = new Draw({
				source: draftSource,
				type: geomType
			});

			draw.on('drawend', (evt) => {
				const feature = evt.feature;
				feature.set('styleKey', draftStyleKey);
				const writable = olToWritableGeoJSON(feature.getGeometry() ?? null);
				// Draw already added the feature; parent will set draftGeometry
				queueMicrotask(() => {
					if (draftSource.hasFeature(feature)) draftSource.removeFeature(feature);
				});
				if (writable) drawCb.onDrawEnd?.(writable);
			});

			map.addInteraction(draw);
			drawBox.interaction = draw;
			installSnaps();
			element.style.cursor = 'crosshair';

			return () => {
				clearSnaps();
				map.removeInteraction(draw);
				if (drawBox.interaction === draw) drawBox.interaction = null;
				element.style.cursor = '';
			};
			});

		// Esc cancels in-progress draw (modify will share this later)
		const onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key !== 'Escape') return;
			if (drawBox.interaction) {
				drawBox.interaction.abortDrawing();
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
			clearSnaps();
			if (drawBox.interaction) {
				map.removeInteraction(drawBox.interaction);
				drawBox.interaction = null;
			}
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
