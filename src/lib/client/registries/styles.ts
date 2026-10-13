/**
 * styleKey → OpenLayers style factory.
 * Config never embeds ol/style objects — only string keys resolved here.
 */

import Style from 'ol/style/Style';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import CircleStyle from 'ol/style/Circle';

export type MapStyleOptions = {
	/** Primary selection / keyboard focus highlight */
	focused?: boolean;
	/** Already used / assigned — muted so free features stand out */
	assigned?: boolean;
	/**
	 * Optional behavior key that refines the base style per feature — e.g. a
	 * marker's embedding status (`done` / `active` / `stale` / `failed` / `empty`)
	 * recolours the point. Unknown / absent → the style's default look.
	 */
	variant?: string;
};

export type MapStyleFactory = (opts?: MapStyleOptions) => Style;

const ASSIGNED_FILL = 'rgba(148, 163, 184, 0.12)';
const ASSIGNED_STROKE = '#94a3b8';
const ASSIGNED_FOCUSED_FILL = 'rgba(100, 116, 139, 0.28)';
const ASSIGNED_FOCUSED_STROKE = '#64748b';

function polygonStyle(
	fill: string,
	stroke: string,
	width: number,
	focusedFill: string,
	focusedStroke: string
): MapStyleFactory {
	return (opts = {}) => {
		const focused = Boolean(opts.focused);
		const assigned = Boolean(opts.assigned);
		const f = assigned
			? focused
				? ASSIGNED_FOCUSED_FILL
				: ASSIGNED_FILL
			: focused
				? focusedFill
				: fill;
		const s = assigned
			? focused
				? ASSIGNED_FOCUSED_STROKE
				: ASSIGNED_STROKE
			: focused
				? focusedStroke
				: stroke;
		return new Style({
			fill: new Fill({ color: f }),
			stroke: new Stroke({
				color: s,
				width: focused ? 2.5 : assigned ? 1 : width,
				lineDash: assigned && !focused ? [6, 4] : undefined
			})
		});
	};
}

/**
 * Marker embedding-status palette. Each variant is one pin colour:
 *   done (green) · active (blue) · stale (orange) · failed (red) · empty (gray).
 */
type PointPalette = {
	fill: string;
	stroke: string;
	focusedFill: string;
	focusedStroke: string;
};

const MARKER_VARIANTS: Record<string, PointPalette> = {
	/** All views embedded and current — green */
	done: {
		fill: 'rgba(34, 197, 94, 0.8)',
		stroke: '#15803d',
		focusedFill: 'rgba(22, 163, 74, 0.95)',
		focusedStroke: '#14532d'
	},
	/** Any view queued / processing — blue */
	active: {
		fill: 'rgba(59, 130, 246, 0.8)',
		stroke: '#1d4ed8',
		focusedFill: 'rgba(37, 99, 235, 0.95)',
		focusedStroke: '#1e3a8a'
	},
	/** Any view embedded at a stale version — orange */
	stale: {
		fill: 'rgba(245, 158, 11, 0.85)',
		stroke: '#b45309',
		focusedFill: 'rgba(217, 119, 6, 0.95)',
		focusedStroke: '#78350f'
	},
	/** Any view failed — red */
	failed: {
		fill: 'rgba(239, 68, 68, 0.85)',
		stroke: '#b91c1c',
		focusedFill: 'rgba(220, 38, 38, 0.95)',
		focusedStroke: '#7f1d1d'
	},
	/** Marker has no views at all — gray */
	empty: {
		fill: 'rgba(148, 163, 184, 0.7)',
		stroke: '#64748b',
		focusedFill: 'rgba(100, 116, 139, 0.9)',
		focusedStroke: '#334155'
	}
};

/** Unknown / absent variant → the generic blue point (matches legacy `point`). */
const MARKER_DEFAULT = MARKER_VARIANTS.active!;

/**
 * Variant-aware point style. Reads `opts.variant` as an embedding-status key
 * (falls back to {@link MARKER_DEFAULT}) and honours focus / assigned overlays.
 */
function markerStyle(): MapStyleFactory {
	return (opts = {}) => {
		const focused = Boolean(opts.focused);
		const assigned = Boolean(opts.assigned);
		const palette = (opts.variant ? MARKER_VARIANTS[opts.variant] : null) ?? MARKER_DEFAULT;
		const fill = assigned
			? focused
				? ASSIGNED_FOCUSED_FILL
				: ASSIGNED_FILL
			: focused
				? palette.focusedFill
				: palette.fill;
		const stroke = assigned
			? focused
				? ASSIGNED_FOCUSED_STROKE
				: ASSIGNED_STROKE
			: focused
				? palette.focusedStroke
				: palette.stroke;
		return new Style({
			image: new CircleStyle({
				radius: focused ? 6 : 4,
				fill: new Fill({ color: fill }),
				stroke: new Stroke({
					color: stroke,
					width: focused ? 2.25 : 1.25
				})
			})
		});
	};
}

/** Fallback when styleKey is unknown — neutral gray. */
const defaultFactory: MapStyleFactory = polygonStyle(
	'rgba(148, 163, 184, 0.25)',
	'#94a3b8',
	1.5,
	'rgba(100, 116, 139, 0.45)',
	'#475569'
);

/**
 * Known EE style keys from app_config overlay.
 * Colors are distinct on light/dark UI chrome without being neon.
 */
const styles: Record<string, MapStyleFactory> = {
	/** Electric rooms — blue */
	electric_rooms: polygonStyle(
		'rgba(59, 130, 246, 0.22)',
		'#3b82f6',
		2,
		'rgba(37, 99, 235, 0.45)',
		'#1d4ed8'
	),
	/** Rented areas — amber */
	rents: polygonStyle(
		'rgba(245, 158, 11, 0.22)',
		'#f59e0b',
		1.5,
		'rgba(217, 119, 6, 0.45)',
		'#b45309'
	),
	/** Zones / annotations — green, under rooms (lower z) */
	zones: polygonStyle(
		'rgba(34, 197, 94, 0.10)',
		'#22c55e88',
		1,
		'rgba(22, 163, 74, 0.4)',
		'#15803d'
	),
	/** Marker pins — recoloured per-feature by embedding-status variant */
	marker: markerStyle(),
	/** Generic points (kept variant-aware so legacy marker layers colour too) */
	point: markerStyle(),
	/** In-progress / pending draw sketch (C4.1 create) */
	'draw-draft': polygonStyle(
		'rgba(168, 85, 247, 0.28)',
		'#a855f7',
		3.5,
		'rgba(147, 51, 234, 0.45)',
		'#7e22ce'
	),
	/** Floor-plan linework */
	levels: polygonStyle('rgba(100, 116, 139, 0.1)', '#64748b', 5, 'rgba(71, 85, 105, 1)', '#475569')
};

/** Resolve a style factory by config styleKey. */
export function getStyleFactory(styleKey: string): MapStyleFactory {
	return styles[styleKey] ?? defaultFactory;
}

/** Build an OL Style for a feature. */
export function styleFor(styleKey: string, opts?: MapStyleOptions): Style {
	return getStyleFactory(styleKey)(opts);
}

export { styles as mapStyles };
