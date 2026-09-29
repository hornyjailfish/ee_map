from dataclasses import dataclass, field


@dataclass
class ModalityFields:
    """Defines which fields store the generated embeddings for each modality."""
    text: str | None = None
    image: str | None = None
    # You can easily add audio, video, etc., here later

@dataclass
class TableWatcherConfig:
    """Configuration for an individual table being watched for patches."""
    table_name: str

    # The fields from which raw data is read to generate embeddings
    source_fields: list[str]

    # Destination fields where the resulting multimodal embeddings are stored
    embedding_targets: ModalityFields

    # Fields that the patch watcher should completely ignore when looking for updates
    ignored_fields: list[str] = field(default_factory=list)

@dataclass
class PatchWatcherRegistry:
    """The master structure holding configuration for all watched tables."""
    # Maps a table name to its specific watcher configuration
    tables: dict[str, TableWatcherConfig] = field(default_factory=dict)
