--- SEED
# Migration to v3 for databases that already have an app_config row (the 99 seed
# uses INSERT IGNORE and won't touch it). Adds the split marker model
# (`markers` + `marker_views`) and drops the obsolete `app_config:v2` variant
# that an earlier N13 pass used. Idempotent — safe to re-run.
#
# Stale `entities.embeddings` / `map.layers.embeddings` keys are left as-is here;
# `liftOverlayToV3` removes them at read time and the next OWNER save writes the
# clean v3 shape back.

UPDATE app_config:main SET
	version = 3,
	excludeTables = array::union(
		array::difference(excludeTables ?? [], ['embeddings']),
		['embedding_queue']
	),
	entities.markers = {
		label: 'Markers',
		display: { field: 'level.name' },
		table: { order: ['level', 'zone', 'closes_shop', 'geometry'] }
	},
	entities.marker_views = {
		label: 'Marker views',
		display: { field: 'generated_description' },
		table: {
			order: ['user_description', 'marker', 'image_url', 'version'],
			hide: ['text_embedding', 'image_embedding'],
			readOnly: ['generated_description', 'version'],
			sort: 'generated_description'
		}
	},
	map.layers.markers = {
		levelField: 'level',
		geometryField: 'geometry',
		layerGroup: 'markers',
		styleKey: 'point',
		zIndex: 60
	},
	search.fieldsByTable.marker_views = ['generated_description', 'user_description']
WHERE id = app_config:main;
