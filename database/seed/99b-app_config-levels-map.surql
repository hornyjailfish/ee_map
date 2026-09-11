--- SEED
# Additive patch: enable levels floor-plan layer when overlay already exists (INSERT IGNORE skipped).
# Safe to re-run — only touches entities.levels.map / table presentation fields.

UPDATE app_config:main SET
	entities.levels.map = {
		enabled: true,
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
