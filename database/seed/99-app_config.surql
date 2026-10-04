--- SEED
# EE presentation deltas for resolveAppConfig → merge(auto, overlay).
# Sparse only — field inventories come from live INFO STRUCTURE.
# INSERT IGNORE keeps local OWNER edits if the record already exists.
# v3: the embedding dataset is split across `markers` (geo + context) and
# `marker_views` (userfacing description); `embedding_queue` belongs to the
# separate embedding pipeline and is excluded from this app.

INSERT IGNORE INTO app_config [
	{
		id: app_config:main,
		version: 3,
		excludeTables: [
			'__entity',
			'__rollout',
			'app_config',
			'embedding_queue'
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
			transformers: {
				label: 'Transformers',
				display: { field: 'name' },
				table: {
					order: ['name', 'room']
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
			markers: {
				label: 'Markers',
				# Dotted accessor: a marker labels itself through its level link.
				display: { field: 'level.name' },
				table: {
					order: ['level', 'zone', 'closest_shop', 'geometry']
				}
			},
			marker_views: {
				label: 'Marker views',
				display: { field: 'generated_description' },
				table: {
					order: ['user_description', 'marker', 'image_url', 'version'],
					hide: ['text_embedding', 'image_embedding'],
					readOnly: ['generated_description', 'version'],
					sort: 'generated_description'
				}
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
				},
				transformers: {
					role: 'input',
					parentField: 'room',
					labelField: 'name'
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
				},
				markers: {
					levelField: 'level',
					geometryField: 'geometry',
					layerGroup: 'markers',
					styleKey: 'point',
					zIndex: 60
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
				shops: ['name', 'aliases'],
				marker_views: ['generated_description', 'user_description']
			}
		}
	}
];
