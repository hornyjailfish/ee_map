# добавляет задачу в очередь на генерацию эмбеддингов
DEFINE EVENT OVERWRITE add_embedding_task ON TABLE marker_views
    WHEN $event != "DELETE"
        AND ($before.generated_description != $after.generated_description
        OR $before.image_url != $after.image_url)
    THEN {
        LET $version = $after.version ?? ($before.version + 1) ?? 1;
        UPSERT type::record("embedding_queue", record::id($after.id)) SET
            data = $after.id,
            version_snapshot = $version
    };

# генерирует описание и увеличивает версию при изменении в таблице markers
DEFINE EVENT OVERWRITE regen_description ON TABLE markers
    WHEN $event != "DELETE"
        AND ($before.level != $after.level OR $before.zone != $after.zone OR $before.closest_shop != $after.closest_shop)
    THEN {
        UPDATE marker_views
            SET version = $this.version + 1
            WHERE marker = $after.id
    };
# генерирует обновление в таблице marker_views при изменении в связаных с маркерами (изменилось название магазина, зоны итд)
DEFINE EVENT OVERWRITE regen_description ON TABLE levels
    WHEN $event != "DELETE"
        AND ($before.name != $after.name)
    THEN {
        LET $markers = (SELECT VALUE id FROM markers WHERE level = $after.id);
        # huge update whole level contains many markers
        UPDATE marker_views
            SET version = $this.version + 1
            WHERE marker IN $markers
    };
DEFINE EVENT OVERWRITE regen_description ON TABLE zones
    WHEN $before.name != $after.name
    THEN {
        LET $markers = (SELECT VALUE id FROM markers WHERE zone = $after.id);
        UPDATE marker_views
            SET version = $this.version + 1
            WHERE marker IN $markers
    };
DEFINE EVENT OVERWRITE regen_description ON TABLE shops
    WHEN $before.name != $after.name OR $before.rent != $after.rent OR $before.aliases != $after.aliases
    THEN {
        LET $markers = (SELECT VALUE id FROM markers WHERE closest_shop = $after.id);
        UPDATE marker_views
            SET version = $this.version + 1
            WHERE marker IN $markers
    };

# автоматически удаляет задачу из очереди при удалении из таблицы markers
DEFINE EVENT OVERWRITE remove_embedding_task ON TABLE marker_views WHEN $event == "DELETE" THEN {
    DELETE type::record('embedding_queue', $before.id.id);
};
