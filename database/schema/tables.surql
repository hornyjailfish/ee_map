DEFINE TABLE levels SCHEMAFULL;
DEFINE FIELD name ON levels TYPE string;
DEFINE FIELD ord ON levels TYPE int DEFAULT 1;

# only rentable areas
DEFINE TABLE rents SCHEMAFULL;
DEFINE FIELD name ON rents TYPE string;
DEFINE FIELD level ON rents TYPE record<levels>;
DEFINE FIELD geometry ON rents TYPE geometry<polygon>;

# actual brand names that rent this areas
DEFINE TABLE shops SCHEMAFULL;
DEFINE FIELD name ON shops TYPE string;
DEFINE FIELD aliases ON shops TYPE array<string> | none;
DEFINE FIELD area ON shops TYPE record<rents>;

DEFINE TABLE electric_rooms SCHEMAFULL;
DEFINE FIELD name ON electric_rooms TYPE string;
DEFINE FIELD level ON electric_rooms TYPE record<levels>;
DEFINE FIELD geometry ON electric_rooms TYPE geometry<polygon> | none;

DEFINE TABLE boards SCHEMAFULL;
DEFINE FIELD name ON boards TYPE string;
DEFINE FIELD room ON boards TYPE record<electric_rooms>;

DEFINE TABLE breakers SCHEMAFULL;
DEFINE FIELD name ON breakers TYPE string ASSERT $value = <regex>/^Q[0-9]+$/;
DEFINE FIELD description ON breakers TYPE string | none;
DEFINE FIELD value ON breakers TYPE number | none;
DEFINE FIELD board ON breakers TYPE record<boards>;

# main graph for electric connections
DEFINE TABLE connects TYPE RELATION IN breakers OUT breakers | rents SCHEMALESS;
DEFINE FIELD cable ON connects TYPE string | none;

# zones for description generation
DEFINE TABLE zones SCHEMAFULL;
DEFINE FIELD name ON zones TYPE string;
DEFINE FIELD level ON zones TYPE record<levels>;
DEFINE FIELD geometry ON zones TYPE geometry<polygon>;


DEFINE TABLE embeddings SCHEMAFULL;
DEFINE FIELD description ON embeddings TYPE string | none;
DEFINE FIELD text_embedding ON embeddings TYPE array<float> | none;
DEFINE FIELD image_embedding ON embeddings TYPE array<float> | none;
DEFINE FIELD marker ON embeddings TYPE geometry<point>;
DEFINE FIELD image ON embeddings TYPE string | none ASSERT $value IS NONE OR <regex> '^f"images:/.*"$' = $value;

# Sparse app presentation overlay (ResolvedConfig input). One doc: app_config:main.
# SCHEMALESS so OWNER UI / seeds can evolve nested keys without DEFINE FIELD churn.
DEFINE TABLE app_config TYPE NORMAL SCHEMALESS;
DEFINE FIELD version ON app_config TYPE int DEFAULT 1;
DEFINE FIELD excludeTables ON app_config TYPE array<string> | none;
DEFINE FIELD entities ON app_config TYPE object | none;
DEFINE FIELD edges ON app_config TYPE object | none;
DEFINE FIELD map ON app_config TYPE object | none;
DEFINE FIELD search ON app_config TYPE object | none;
