DEFINE TABLE levels SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON levels TYPE string;
DEFINE FIELD ord ON levels TYPE int DEFAULT 1;
# Floor-plan background (base.geojson linework collapsed to MultiLineString)
DEFINE FIELD OVERWRITE geometry ON levels TYPE geometry<multiline> | none;

# only rentable areas
DEFINE TABLE rents SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON rents TYPE string;
DEFINE FIELD level ON rents TYPE record<levels> | none;
DEFINE FIELD geometry ON rents TYPE geometry<polygon> | none;

# actual brand names that rent this areas
DEFINE TABLE shops SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON shops TYPE string;
DEFINE FIELD aliases ON shops TYPE array<string> | none;
DEFINE FIELD area ON shops TYPE record<rents> | none;

DEFINE TABLE electric_rooms SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON electric_rooms TYPE string;
DEFINE FIELD level ON electric_rooms TYPE record<levels>;
DEFINE FIELD geometry ON electric_rooms TYPE geometry<polygon> | none;

DEFINE TABLE boards SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON boards TYPE string;
DEFINE FIELD room ON boards TYPE record<electric_rooms>;

DEFINE TABLE breakers SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON breakers TYPE string ASSERT $value = <regex>/^Q[0-9]+$/;
DEFINE FIELD description ON breakers TYPE string | none;
DEFINE FIELD value ON breakers TYPE number | none;
DEFINE FIELD board ON breakers TYPE record<boards>;

# main graph for electric connections
DEFINE TABLE connects TYPE RELATION IN breakers OUT breakers | rents SCHEMALESS PERMISSIONS FULL;
DEFINE FIELD cable ON connects TYPE string | none;

# zones for description generation
DEFINE TABLE zones SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON zones TYPE string;
DEFINE FIELD level ON zones TYPE record<levels>;
DEFINE FIELD geometry ON zones TYPE geometry<polygon>;


DEFINE TABLE embeddings SCHEMAFULL;
DEFINE FIELD description ON embeddings TYPE string | none;
DEFINE FIELD text_embedding ON embeddings TYPE array<float> | none;
DEFINE FIELD image_embedding ON embeddings TYPE array<float> | none;
DEFINE FIELD marker ON embeddings TYPE geometry<point>;
DEFINE FIELD image ON embeddings TYPE string | none ASSERT $value IS NONE OR <regex> '^f"images:/.*"$' = $value;

# app_config lives in view_configs.surql (SCHEMALESS overlay document).

