DEFINE INDEX unique_electric_room_name
    ON TABLE electric_rooms
    COLUMNS name
    UNIQUE;

DEFINE INDEX unique_areas
    ON TABLE rents
    COLUMNS name, geometry
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

DEFINE INDEX one_edge
    ON connects FIELDS in, out
    UNIQUE;
