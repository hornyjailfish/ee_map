import logging
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Проверяем доступность CUDA через внутренний движок PyTorch
def check_cuda():
    device = "cpu"

    import torch
    if torch.cuda.is_available():
        device = "cuda"
        logger.info(f"Найдена видеокарта: {torch.cuda.get_device_name(0)}. Переключаемся на CUDA!")
    else:
        logger.info("CUDA не найдена. Работаем в режиме CPU.")
    return device

class Settings(BaseSettings):
    # Описываем ваши аргументы/настройки
    fastapi_port: int
    model: str = "jinaai/jina-embeddings-v5-omni-nano-retrieval"
    modalities: str = "vision"

    ws_db: str
    surrealdb_user: str
    surrealdb_password: str
    surrealdb_namespace: str
    surrealdb_name: str
    hf_home: str = "D:/models/"
    device: str = check_cuda()
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )


# for caching settings
@lru_cache
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue]
