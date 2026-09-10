<script lang="ts">
	/**
	 * Client-only OpenLayers map for geometry assignment (metric XY, no basemap).
	 * Parent mounts only when `browser` is true.
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
	import Projection from 'ol/proj/Projection';
	import { getCenter } from 'ol/extent';
	import { styleFor } from '$lib/client/registries/styles';
	import type { GeoAssignFeature, GeoAssignLayer } from '$lib/geo-assign-types';
	import type { NormalizedGeometry } from '$lib/transform/to-map';
	import 'ol/ol.css';

	type Props = {
		layer: GeoAssignLayer;
		/** Currently selected source feature id (`geo:…`). */
		selectedId?: string | null;
		onSelect?: (featureId: string | null) => void;
		class?: string;
	};

	let { layer, selectedId = null, onSelect, class: className = '' }: Props = $props();

	const FALLBACK_EXTENT: [number, number, number, number] = [-1000, -1000, 1000, 1000];

	function resolveExtent(l: GeoAssignLayer): [number, number, number, number] {
		if (l.extent && l.extent.length === 4) {
			const [a, b, c, d] = l.extent;
			if ([a, b, c, d].every((n) => typeof n === 'number' && Number.isFinite(n))) {
				if (a === c || b === d) {
					const pad = 10;
					return [a - pad, b - pad, c + pad, d + pad];
				}
				return [a, b, c, d];
			}
		}
		return FALLBACK_EXTENT;
	}

	function geometryToOl(geometry: NormalizedGeometry): Point | Polygon | null {
		if (geometry.kind === 'point') return new Point([geometry.x, geometry.y]);
		if (geometry.kind === 'polygon') return new Polygon(geometry.rings);
		return null;
	}

	function featureToOl(mf: GeoAssignFeature): Feature | null {
		const geom = geometryToOl(mf.geometry);
		if (!geom) return null;
		const f = new Feature({ geometry: geom });
		f.setId(mf.id);
		if (mf.label !== undefined) f.set('label', mf.label);
		return f;
	}

	const mapAttach: Attachment<HTMLDivElement> = (element) => {
		const initialExtent = untrack(() => resolveExtent(layer));
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
				center: getCenter(initialExtent),
				zoom: 2,
				multiWorld: false
			})
		});

		map.getView().fit(initialExtent, {
			padding: [24, 24, 24, 24],
			maxZoom: 8,
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
				onSelect?.(id != null ? String(id) : null);
			} else {
				onSelect?.(null);
			}
		});

		let lastExtentKey = initialExtent.join(',');
		const selectBox: { id: string | null } = { id: untrack(() => selectedId) };

		$effect(() => {
			const l = layer;

			const existing = [...map.getLayers().getArray()];
			for (const olLayer of existing) {
				map.removeLayer(olLayer);
			}

			const source = new VectorSource();
			for (const mf of l.features) {
				const olFeature = featureToOl(mf);
				if (olFeature) source.addFeature(olFeature);
			}

			const vector = new VectorLayer({
				source,
				zIndex: 1,
				style: (olFeature: FeatureLike) => {
					const id = olFeature.getId();
					const focused = id != null && String(id) === selectBox.id;
					// Use rents palette — assign source geometries are often shop/rent polygons
					return styleFor('rents', { focused });
				}
			});
			map.addLayer(vector);

			const nextExtent = resolveExtent(l);
			const key = nextExtent.join(',');
			if (key !== lastExtentKey) {
				lastExtentKey = key;
				projection.setExtent(nextExtent);
				map.getView().fit(nextExtent, {
					padding: [24, 24, 24, 24],
					maxZoom: 8,
					duration: 0
				});
			}
		});

		$effect(() => {
			selectBox.id = selectedId ?? null;
			for (const olLayer of map.getLayers().getArray()) {
				olLayer.changed();
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
	aria-label="Geometry source map"
	{@attach mapAttach}
></div>

<style>
	div :global(.ol-viewport) {
		height: 100%;
		width: 100%;
	}
</style>
