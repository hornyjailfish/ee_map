--- SEED
# Additive patch: enable levels floor-plan layer when overlay already exists (INSERT IGNORE skipped).
# Safe to re-run — only touches map.layers.levels / entities.levels.table presentation fields.
# v3 shape: participation lives in map.layers.

UPDATE app_config:main SET
	map.layers.levels = {
		geometryField: 'geometry',
		layerGroup: 'background',
		styleKey: 'levels',
		zIndex: 0
	},
	entities.levels.table = {
		order: ['ord', 'name', 'geometry'],
		sort: 'ord'
	}
WHERE id = app_config:main;