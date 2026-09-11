<script lang="ts">
	/**
	 * Client-only OpenLayers map on an identity metric XY plane (no Web Mercator).
	 * Layers are DB-backed MapViewModel features loaded via VectorSource.loader.
	 * Parent should mount this only when `browser` is true (same pattern as GraphView).
	 */
	import type { Attachment } from 'svelte/attachments';
	import { untrack } from 'svelte';
	import Map from 'ol/Map';
	import View from 'ol/View';
	import VectorLayer from 'ol/layer/Vector';
	import VectorSource from 'ol/source/Vector';
	import Feature from 'ol/Feature';
	import type { FeatureLike } from 'ol/Feature';
	import Point from 'ol/geom/Point';
	import Polygon from 'ol/geom/Polygon';
	import LineString from 'ol/geom/LineString';
	import MultiLineString from 'ol/geom/MultiLineString';
	import Projection from 'ol/proj/Projection';
	import { getCenter } from 'ol/extent';
	import { all as loadAll } from 'ol/loadingstrategy';
	import { appUi } from '$lib/client/state/app-ui.svelte';
	import { styleFor } from '$lib/client/registries/styles';
	import type { MapFeature, MapViewModel, NormalizedGeometry } from '$lib/transform/to-map';
	import 'ol/ol.css';

	type Props = {
		view: MapViewModel;
		class?: string;
	};

	let { view, class: className = '' }: Props = $props();

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

	function geometryToOl(
		geometry: NormalizedGeometry
	): Point | Polygon | LineString | MultiLineString | null {
		if (geometry.kind === 'point') {
			return new Point([geometry.x, geometry.y]);
		}
		if (geometry.kind === 'polygon') {
			return new Polygon(geometry.rings);
		}
		if (geometry.kind === 'line') {
			if (geometry.paths.length === 1) {
				return new LineString(geometry.paths[0]!);
			}
			return new MultiLineString(geometry.paths);
		}
		return null;
	}

	function featureToOl(mf: MapFeature): Feature | null {
		const geom = geometryToOl(mf.geometry);
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

	/**
	 * Attachment owns the OL Map lifecycle.
	 * Nested effects track `view` (layers + extent) and `focusedId` (restyle only).
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

		map.on('singleclick', (evt) => {
			const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => f, { hitTolerance: 4 });
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

		// Layers + fit when MapViewModel changes (level navigation etc.)
		$effect(() => {
			const v = view;

			const existing = [...map.getLayers().getArray()];
			for (const layer of existing) {
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
				layer.changed();
			}
		});

		return () => {
			resizeObserver.disconnect();
			map.setTarget(undefined);
			map.dispose();
		};
	};
</script>

<div
	class={['h-full min-h-0 w-full overflow-hidden', className]}
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
