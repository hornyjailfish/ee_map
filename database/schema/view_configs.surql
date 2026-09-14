# Sparse app presentation overlay (ResolvedConfig input). One doc: app_config:main.
#
# Soft contract intentionally:
# - Table is SCHEMALESS + only top-level keys are typed loosely.
# - Nested entity/edge/map/graph/search objects stay free-form so OWNER UI
#   and seeds can evolve without DEFINE FIELD churn or hard seed types.
# - Runtime TypeScript (AppConfigOverlay) + soft parse on write gate shape.
# - Seed uses INSERT IGNORE so local OWNER edits are preserved on re-seed.
#
DEFINE TABLE app_config TYPE NORMAL SCHEMALESS;
DEFINE FIELD version ON app_config TYPE int DEFAULT 1;
DEFINE FIELD excludeTables ON app_config TYPE array<string> | none;
DEFINE FIELD entities ON app_config TYPE object | none;
DEFINE FIELD edges ON app_config TYPE object | none;
DEFINE FIELD graph ON app_config TYPE object | none;
DEFINE FIELD map ON app_config TYPE object | none;
DEFINE FIELD search ON app_config TYPE object | none;
