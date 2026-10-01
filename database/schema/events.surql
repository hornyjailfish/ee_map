# DEFINE EVENT IF NOT EXISTS add_embedding_task ON TABLE marker_views
#     WHEN $event != "DELETE"
#         OR $before.generated_description != $after.generated_description
#         OR $before.image_url != $after.image_url
#     THEN {
#
#     };
#
