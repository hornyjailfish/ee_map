--- SEED
# Optional v2 config variant (N13), stored as a SEPARATE record so the live
# `app_config:main` (v1) is never touched. Other machines keep their v1 main;
# opt into v2 by pointing OVERLAY_DOC_ID at `app_config:v2` (or flipping the id
# of the main seed after migration). INSERT IGNORE keeps existing edits on re-run.
# v2 shape: entities = identity + grid; participation lives in
#   graph.nodes.<table>, graph.edges.<relation>, map.layers.<table>.

INSERT IGNORE INTO app_config [
	{
		id: app_config:v2,
		version: 2,
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
				table: {
					order: ['name', 'room'],
					# Room first, then board name within room
					sort: [{ field: 'room' }, { field: 'name' }]
				}
			},
			breakers: {
				label: 'Breakers',
				display: { field: 'name' },
				table: {
					order: ['name', 'board', 'description', 'value'],
					# Q1 < Q2 < Q10 (natural); then board for ties across panels
					sort: [{ field: 'board' }, { field: 'name' }]
				}
			},
			rooms: {
				label: 'Other rooms',
				display: { field: 'name' }
			},
			rents: {
				label: 'Rents',
				display: { field: 'name' }
			},
			zones: {
				label: 'Zones',
				display: { field: 'name' }
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
				table: {
					order: ['ord', 'name', 'geometry'],
					sort: 'ord'
				}
			}
		},
		graph: {
			nodes: {
				electric_rooms: {
					role: 'room',
					labelField: 'name'
				},
				boards: {
					role: 'board',
					parentField: 'room',
					labelField: 'name'
				},
				breakers: {
					role: 'breaker',
					parentField: 'board',
					labelField: 'name',
					subtitleField: 'description'
				}
			},
			edges: {
				connects: {
					role: 'feeds',
					labelField: 'cable'
				}
			}
		},
		map: {
			units: 'm',
			plane: 'xy-meters',
			levelsTable: 'levels',
			levelOrderField: 'ord',
			layers: {
				levels: {
					geometryField: 'geometry',
					layerGroup: 'background',
					styleKey: 'levels',
					zIndex: 0
				},
				zones: {
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'zones',
					styleKey: 'zones',
					zIndex: 5
				},
				electric_rooms: {
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'rooms',
					styleKey: 'electric_rooms',
					zIndex: 10
				},
				rooms: {
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'rooms',
					styleKey: 'rooms',
					zIndex: 20
				},
				rents: {
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'tenancy',
					styleKey: 'rents',
					zIndex: 20
				}
			}
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
