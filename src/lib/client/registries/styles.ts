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
};

export type MapStyleFactory = (opts?: MapStyleOptions) => Style;

function polygonStyle(
	fill: string,
	stroke: string,
	focusedFill: string,
	focusedStroke: string
): MapStyleFactory {
	return (opts = {}) => {
		const focused = Boolean(opts.focused);
		return new Style({
			fill: new Fill({ color: focused ? focusedFill : fill }),
			stroke: new Stroke({
				color: focused ? focusedStroke : stroke,
				width: focused ? 2.5 : 1.5
			})
		});
	};
}

function pointStyle(
	fill: string,
	stroke: string,
	focusedFill: string,
	focusedStroke: string
): MapStyleFactory {
	return (opts = {}) => {
		const focused = Boolean(opts.focused);
		return new Style({
			image: new CircleStyle({
				radius: focused ? 7 : 5,
				fill: new Fill({ color: focused ? focusedFill : fill }),
				stroke: new Stroke({
					color: focused ? focusedStroke : stroke,
					width: focused ? 2 : 1.25
				})
			})
		});
	};
}

/** Fallback when styleKey is unknown — neutral gray. */
const defaultFactory: MapStyleFactory = polygonStyle(
	'rgba(148, 163, 184, 0.25)',
	'#94a3b8',
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
		'rgba(37, 99, 235, 0.45)',
		'#1d4ed8'
	),
	/** Rented areas — amber */
	rents: polygonStyle(
		'rgba(245, 158, 11, 0.22)',
		'#f59e0b',
		'rgba(217, 119, 6, 0.45)',
		'#b45309'
	),
	/** Zones / annotations — green, under rooms (lower z) */
	zones: polygonStyle(
		'rgba(34, 197, 94, 0.18)',
		'#22c55e',
		'rgba(22, 163, 74, 0.4)',
		'#15803d'
	),
	/** Generic points if a layer later uses them */
	point: pointStyle(
		'rgba(59, 130, 246, 0.7)',
		'#1d4ed8',
		'rgba(37, 99, 235, 0.95)',
		'#1e3a8a'
	)
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
