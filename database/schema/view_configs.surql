# Sparse app presentation overlay (ResolvedConfig input). One doc: app_config:main.
# SCHEMALESS so OWNER UI / seeds can evolve nested keys without DEFINE FIELD churn.
DEFINE TABLE app_config TYPE NORMAL SCHEMALESS;
DEFINE FIELD version ON app_config TYPE int DEFAULT 1;
DEFINE FIELD excludeTables ON app_config TYPE array<string> | none;
DEFINE FIELD entities ON app_config TYPE object | none;
DEFINE FIELD edges ON app_config TYPE object | none;
DEFINE FIELD graph ON app_config TYPE object | none;
DEFINE FIELD map ON app_config TYPE object | none;
DEFINE FIELD search ON app_config TYPE object | none;
