--- SEED
# EE presentation deltas for resolveAppConfig → merge(auto, overlay).
# Sparse only — field inventories come from live INFO STRUCTURE.
# INSERT IGNORE keeps local OWNER edits if the record already exists.
# Additive levels.map patch: 99b-app_config-levels-map.surql

INSERT IGNORE INTO app_config [
	{
		id: app_config:main,
		version: 1,
		excludeTables: [
			'__entity',
			'__rollout',
			'app_config',
			'embeddings'
		],
		entities: {
			electric_rooms: {
				label: 'Electric rooms',
				# When referenced (e.g. boards.room): show room name
				display: { field: 'name' },
				graph: {
					role: 'room',
					labelField: 'name'
				},
				map: {
					enabled: true,
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'rooms',
					styleKey: 'electric_rooms',
					zIndex: 10
				},
				table: {
					order: ['name', 'level', 'geometry'],
					# Natural string order (1.1 < 1.2 < 1.10 …)
					sort: 'name'
				}
			},
			boards: {
				label: 'Boards',
				# Board names collide across rooms — composite when referenced from breakers
				display: {
					parts: [{ path: 'room.name' }, { path: 'name' }],
					sep: ' · '
				},
				graph: {
					role: 'board',
					parentField: 'room',
					labelField: 'name'
				},
				table: {
					order: ['name', 'room'],
					# Room first, then board name within room
					sort: [{ field: 'room' }, { field: 'name' }]
				}
			},
			breakers: {
				label: 'Breakers',
				display: { field: 'name' },
				graph: {
					role: 'breaker',
					parentField: 'board',
					labelField: 'name',
					subtitleField: 'description'
				},
				table: {
					order: ['name', 'board', 'description', 'value'],
					# Q1 < Q2 < Q10 (natural); then board for ties across panels
					sort: [{ field: 'board' }, { field: 'name' }]
				}
			},
			rents: {
				label: 'Rents',
				display: { field: 'name' },
				graph: {
					role: 'ignore'
				},
				map: {
					enabled: true,
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'tenancy',
					styleKey: 'rents',
					zIndex: 20
				}
			},
			zones: {
				label: 'Zones',
				display: { field: 'name' },
				graph: {
					role: 'ignore'
				},
				map: {
					enabled: true,
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'zones',
					styleKey: 'zones',
					zIndex: 5
				}
			},
			shops: {
				label: 'Shops',
				display: { field: 'name' }
			},
			levels: {
				label: 'Levels',
				display: {
					field: 'name'
				},
				# Floor plan background — no levelField (row id is the level)
				map: {
					enabled: true,
					geometryField: 'geometry',
					layerGroup: 'background',
					styleKey: 'levels',
					zIndex: 0
				},
				table: {
					order: ['ord', 'name', 'geometry'],
					sort: 'ord'
				}
			}
		},
		edges: {
			connects: {
				role: 'feeds',
				labelField: 'cable'
			}
		},
		map: {
			units: 'm',
			plane: 'xy-meters',
			levelsTable: 'levels',
			levelOrderField: 'ord'
		},
		search: {
			fieldsByTable: {
				electric_rooms: ['name'],
				boards: ['name'],
				breakers: ['name', 'description'],
				rents: ['name'],
				zones: ['name'],
				shops: ['name', 'aliases']
			}
		}
	}
];
