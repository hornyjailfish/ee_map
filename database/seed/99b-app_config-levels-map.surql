--- SEED
# Additive patch: enable levels floor-plan layer when overlay already exists (INSERT IGNORE skipped).
# Safe to re-run — only touches map.layers.levels + entities.levels.table.
# v2 shape (N13): map membership lives in map.layers.<table>.

UPDATE app_config:main SET
	version = 2,
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
