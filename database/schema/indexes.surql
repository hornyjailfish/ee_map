DEFINE INDEX unique_electric_room_name
    ON TABLE electric_rooms
    COLUMNS name
    UNIQUE;

DEFINE INDEX unique_rent_name
    ON TABLE rents
    COLUMNS name, level
    UNIQUE;

DEFINE INDEX unique_geometry
    ON TABLE rents
    COLUMNS geometry
    UNIQUE;

DEFINE INDEX unique_shops
    ON TABLE shops
    COLUMNS area
    UNIQUE;

DEFINE INDEX unique_boards_per_room
    ON boards FIELDS name, room
    UNIQUE;

DEFINE INDEX unique_breakers
    ON breakers FIELDS name, board
    UNIQUE;

DEFINE INDEX unique_trans_name
    ON transformers FIELDS name, room
    UNIQUE;

DEFINE INDEX one_edge
    ON connects FIELDS in, out
    UNIQUE;

DEFINE INDEX unique_marker_data
    ON embedding_queue FIELDS data
    UNIQUE;

# embedding indexes dimension uncompressed jinav5
DEFINE INDEX idx_text
    ON marker_views COLUMNS text_embedding HNSW DIMENSION 768 DIST COSINE;
DEFINE INDEX idx_image
    ON marker_views COLUMNS image_embedding HNSW DIMENSION 768 DIST COSINE;
