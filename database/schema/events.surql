DEFINE EVENT OVERWRITE add_embedding_task ON TABLE marker_views
    WHEN $event != "DELETE"
        AND ($before.generated_description != $after.generated_description
        OR $before.image_url != $after.image_url)
    THEN {
        LET $version = $after.version ?? 1;
        # FIXME: version not generated properly still
        UPSERT type::record("embedding_queue", record::id($after.id)) SET
            data = $after.id,
            version_snapshot = $version
    };

DEFINE EVENT OVERWRITE remove_embedding_task ON TABLE marker_views WHEN $event == "DELETE" THEN {
    DELETE type::record('embedding_queue', $before.id.id);
};
