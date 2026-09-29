import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager

from companion.utils import check_deps, setup_logging, setup_process_prio

setup_logging(logging.INFO)
check_deps()

logger = logging.getLogger(__name__)
import uvicorn
from fastapi import FastAPI
from surrealdb import AsyncSurreal

from companion.config import get_settings


def main():
    settings = get_settings()
    os.environ["HF_HOME"] = settings.hf_home

    # Применяем оптимизации для CPU только в том случае, если CUDA недоступна
    if settings.device == "cpu":
        # Ограничиваем количество потоков для CPU
        os.environ["OMP_NUM_THREADS"] = "4"
        os.environ["MKL_NUM_THREADS"] = "4"

        # Для Windows: выставляем процессу фоновый приоритет (IDLE), чтобы ПК не тормозил
        if sys.platform == "win32":
            setup_process_prio()
    uvicorn.run(app, host="0.0.0.0", port=get_settings().fastapi_port)

HEALTH_STATUS = {
    "status": "starting",          # starting, idle, processing, error
    "device_used": get_settings().device,
    "modalities": get_settings().modalities,
    "last_seen_db": None,
    "processed_count": 0,
    "errors_count": 0,
    "current_record_id": None,
    "uptime_start": time.time()
}

# logger.info(f"Загрузка модели jina-embeddings-v5-omni-nano на устройство [{get_settings().device.upper()}]...")
# logger.info(f"Выбранные модальности: {get_settings().modalities}")
# Инициализируем модель на выбранном устройстве
# model = SentenceTransformer("jinaai/jina-embeddings-v5-omni-nano-retrieval",
#     device=device,
#     trust_remote_code=True,
#     model_kwargs={"modality": args.modalities})
# logger.info(f"Модель успешно загружена на {get_settings().device.upper()}.")
HEALTH_STATUS["status"] = "idle"


@asynccontextmanager
async def lifecycle(app: FastAPI):
    args = get_settings()
    logger.info(f"Попытка подключения к SurrealDB по адресу {args.ws_db}...")
    async with AsyncSurreal(args.ws_db) as db:
        await db.signin({"username": args.surrealdb_user, "password": args.surrealdb_password})
        await db.use(namespace=args.surrealdb_namespace, database=args.surrealdb_name)

        HEALTH_STATUS["last_seen_db"] = time.time()
        HEALTH_STATUS["status"] = "idle"

        logger.info(f" Успешное подключение к SurrealDB ({args.surrealdb_namespace}/{args.surrealdb_name})")
        # query = "LIVE SELECT id, description, image FROM embeddings"
        query = "LIVE SELECT DIFF FROM embeddings"
        # query_uuid = await db.live(query, diff=True)
        # query_uuid =  await db.live(query, diff=True)
        # query_uuid = await db.query(query)
        # query_uuid = await db.live(table=Table(args.db_table), diff=True)
        # notification = await asyncio.wait(live_stream.__anext__(), timeout=None)
        res = await db.query(query)
        live_stream = db.subscribe_live(res)  # pyright: ignore[reportArgumentType]
        task_handler = asyncio.create_task(live_stream)
        # async for notification in live_stream:
        #     logger.info(f"Получено событие: {notification}")
    yield
    task_handler.cancel()
    await asyncio.gather(task_handler, return_exceptions=True)

        # except Exception as conn_error:
        #     HEALTH_STATUS["status"] = "error"
        #     HEALTH_STATUS["errors_count"] += 1
        #     print(f"Сбой подключения к SurrealDB: {conn_error}. Повтор через 5 секунд...")
        #     await asyncio.sleep(5)
#                 async for notification in db.subscribe_live(query_uuid):
#
#                     print(f"Получено событие: {notification['action']} {notification['result']}")
#
#                     HEALTH_STATUS["last_seen_db"] = time.time()
#                     if not isinstance(notification, dict):
#                         continue

                    # record = notification
                    # record_id = notification.get("id")

                    # if not record_id:
                    #     continue
                    # Обрабатываем ТОЛЬКО событие CREATE (создание новой записи)
#                     if notification["action"] == "CREATE":
#                         record = notification["result"]
#                         record_id = record["id"]
#
#                         HEALTH_STATUS["status"] = "processing"
#                         HEALTH_STATUS["current_record_id"] = str(record_id)
#
#                         try:
#                             text_vec = None
                            # if record.get('description'):
                                # text_vec = model.encode(f"document: {record['description']}")
                                # text_vec = text_vec.tolist()

                            # image_vec = None
                            # if record.get('image'):
                                # 💡 Сюда вы вставите вашу логику скачивания картинки из бакета SurrealDB
                                # pass -> чтение байт -> PIL.Image.open() -> resize до 448x448
                                # image_vec = model.encode(loaded_image).tolist()
                                # pass

                            # await db.query("""
                            #     UPDATE $id SET
                            #         text_embedding = $text_vec,
                            #         image_embedding = $image_vec,
                            #         embedding_status = 'completed',
                            #         embedding_model = 'jina-v5-nano-q8'
                            # """, {"id": record_id, "text_vec": text_vec, "image_vec": image_vec})

#                             HEALTH_STATUS["processed_count"] += 1
#
#                         except Exception as eval_error:
#                             HEALTH_STATUS["errors_count"] += 1
#                             print(f"Ошибка инференса для записи {record_id}: {eval_error}")
#                             await db.query("""
#                                 UPDATE $id SET
#                                     embedding_status = 'failure',
#                                     error_message = $msg
#                             """, {"id": record_id, "msg": str(eval_error)})
#
#                         finally:
#                             HEALTH_STATUS["status"] = "idle"
#                             HEALTH_STATUS["current_record_id"] = None
#

# =====================================================================
# 5. ЗАПУСК ПРИЛОЖЕНИЯ
# =====================================================================

# @app.on_event("startup")
# async def startup_event():
#     asyncio.create_task(surreal_worker_loop())

app = FastAPI(title="Jina Worker Health Monitor", lifespan=lifecycle)

@app.get("/health")
async def get_health():
    uptime = time.time() - HEALTH_STATUS["uptime_start"]
    db_ok = False
    if HEALTH_STATUS["last_seen_db"]:
        db_ok = (time.time() - HEALTH_STATUS["last_seen_db"] < 30)
    return {
        "worker_status": HEALTH_STATUS["status"],
        "device": HEALTH_STATUS["device_used"],
        "uptime_seconds": int(uptime),
        "tracked_table": get_settings().surrealdb_name,
        "metrics": {
            "total_processed": HEALTH_STATUS["processed_count"],
            "total_errors": HEALTH_STATUS["errors_count"]
        },
        "current_task": HEALTH_STATUS["current_record_id"],
        "db_connected": db_ok
    }

if __name__ == "__main__":
    main()
