DEFINE TABLE levels SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON levels TYPE string;
DEFINE FIELD ord ON levels TYPE int DEFAULT 1;
# Floor-plan background (base.geojson linework collapsed to MultiLineString).
# polygon variant allows OWNER to hand-draw level footprints straight on the map.
DEFINE FIELD OVERWRITE geometry ON levels TYPE geometry<multiline> | geometry<polygon> | none;

# only rentable areas
DEFINE TABLE rents SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON rents TYPE string;
DEFINE FIELD level ON rents TYPE record<levels> | none;
DEFINE FIELD geometry ON rents TYPE geometry<polygon> | none;

# other rooms not rent nor electric
DEFINE TABLE rooms SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON rooms TYPE option<string>;
DEFINE FIELD level ON rooms TYPE record<levels> | none;
DEFINE FIELD geometry ON rooms TYPE geometry<polygon> | none;

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
DEFINE FIELD name ON breakers TYPE string ASSERT string::matches($value, '^(Q|K)[0-9]+(\\.[0-9]+)?$');
DEFINE FIELD description ON breakers TYPE string | none;
DEFINE FIELD value ON breakers TYPE number | none;
DEFINE FIELD board ON breakers TYPE record<boards>;

DEFINE TABLE transformers SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON transformers TYPE string;
DEFINE FIELD room ON transformers TYPE record<electric_rooms>;

# main graph for electric connections
DEFINE TABLE connects TYPE RELATION IN breakers | transformers OUT breakers | rents SCHEMALESS PERMISSIONS FULL;
DEFINE FIELD cable ON connects TYPE string | none;

# zones for description generation
DEFINE TABLE zones SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD name ON zones TYPE string;
DEFINE FIELD level ON zones TYPE record<levels>;
DEFINE FIELD geometry ON zones TYPE geometry<polygon>;

DEFINE TABLE markers SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD level ON markers TYPE record<levels>;
DEFINE FIELD zone ON markers TYPE record<zones>;
DEFINE FIELD closest_shop ON markers TYPE record<shops> | none;
# The physical point on the indoor XY plane (map layer reads this).
DEFINE FIELD geometry ON markers TYPE geometry<point>;


DEFINE TABLE marker_views SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD marker ON marker_views TYPE record<markers> REFERENCE;
DEFINE FIELD user_description ON marker_views TYPE string | none;
DEFINE FIELD generated_description ON marker_views TYPE string VALUE {
    LET $aliases = IF marker.closest_shop.aliases THEN marker.closest_shop.aliases.join(', ') ELSE none END;
    LET $parts = [
        marker.level.name,
        marker.zone.name,
        marker.closest_shop.area.name,
        marker.closest_shop.name,
        $aliases,
        user_description
    ].filter(|$v| $v IS NOT NONE).join(', ');
    RETURN $parts;
};
DEFINE FIELD text_embedding ON marker_views TYPE array<float> | none;
DEFINE FIELD image_embedding ON marker_views TYPE array<float> | none;
DEFINE FIELD image_url ON marker_views TYPE string | none ;
# DEFINE FIELD image_url ON marker_views TYPE string | none ASSERT $value IS NONE OR <regex> '^f"images:/.*"$' = $value;
-- СЧЕТЧИК ВЕРСИЙ: при любом реальном изменении текста/картинки число растет на 1
DEFINE FIELD version ON marker_views TYPE int
    VALUE  ($value ?? 0) + 1;

DEFINE TABLE embedding_queue SCHEMAFULL PERMISSIONS FULL;
DEFINE FIELD data ON embedding_queue TYPE record<marker_views> | none;
DEFINE FIELD version_snapshot ON embedding_queue TYPE int;
DEFINE FIELD status ON embedding_queue TYPE 'pending' | 'processing' | 'failed' | 'done' DEFAULT 'pending';
DEFINE FIELD error_message ON embedding_queue TYPE string | none;
DEFINE FIELD updated_at ON embedding_queue VALUE time::now();

# app_config lives in view_configs.surql (SCHEMALESS overlay document).

DEFINE TABLE debug SCHEMALESS PERMISSIONS FULL;
