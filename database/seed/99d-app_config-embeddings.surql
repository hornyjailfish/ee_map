--- SEED
# Additive patch: enable the embeddings marker (point) map layer on an existing
# app_config overlay. 99-app_config uses INSERT IGNORE, so it won't touch a record
# that already exists — this UPDATE is what actually activates markers on a live DB.
# Safe to re-run: array::difference is idempotent; entity/map keys are overwritten.

UPDATE app_config:main SET
	excludeTables = array::difference(excludeTables, ['embeddings']),
	entities.embeddings = {
		label: 'Markers',
		display: { field: 'description' },
		map: {
			enabled: true,
			levelField: 'level',
			geometryField: 'marker',
			layerGroup: 'markers',
			styleKey: 'point',
			zIndex: 60
		},
		table: {
			order: ['description', 'level', 'zone', 'shop', 'marker', 'embedding_status']
		}
	}
WHERE id = app_config:main;
