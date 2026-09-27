import argparse
import asyncio
import os
import sys
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from sentence_transformers import SentenceTransformer
from surrealdb import AsyncSurreal, Table

# =====================================================================
# 1. РАЗБОР НАСТРОЕК (ПРИОРИТЕТ: CLI -> ENV -> DEFAULT)
# =====================================================================
parser = argparse.ArgumentParser(description="Jina v5 Omni Embedding & SurrealDB Worker")

# Добавляем аргумент для настройки модальностей (по умолчанию оставляем только текст и картинки)
parser.add_argument("--modalities", type=str, default="vision",
                    help="Доступные модальности: omni, vision, audio, video (default: vision)")

parser.add_argument("--db-url", type=str,
                    default=os.environ.get("DB_URL", "ws://localhost:8008/rpc"),
                    help="URL подключения к SurrealDB (ENV: DB_URL)")
parser.add_argument("--db-user", type=str,
                    default=os.environ.get("DB_USER", "root"),
                    help="Пользователь базы данных (ENV: DB_USER)")
parser.add_argument("--db-pass", type=str,
                    default=os.environ.get("DB_PASS", "root"),
                    help="Пароль базы данных (ENV: DB_PASS)")
parser.add_argument("--db-ns", type=str,
                    default=os.environ.get("DB_NS", "main"),
                    help="Namespace в SurrealDB (ENV: DB_NS)")
parser.add_argument("--db-db", type=str,
                    default=os.environ.get("DB_DB", "main"),
                    help="Имя базы данных в SurrealDB (ENV: DB_DB)")
parser.add_argument("--db-table", type=str,
                    default=os.environ.get("DB_TABLE", "embeddings"),
                    help="Таблица для отслеживания (ENV: DB_TABLE)")

# Путь внутри контейнера Docker обычно фиксирован, но оставим настраиваемым
parser.add_argument("--model-path", type=str,
                    default=os.environ.get("HF_HOME", "D:/models/"),
                    help="Путь кэширования модели (ENV: HF_HOME)")
parser.add_argument("--api-port", type=int,
                    default=int(os.environ.get("API_PORT", 8050)),
                    help="Порт для HTTP Health API (ENV: API_PORT)")

args = parser.parse_args()

# Укажите здесь желаемый путь для сохранения весов модели
os.environ["HF_HOME"] = args.model_path

# Проверяем доступность CUDA через внутренний движок PyTorch
device = "cpu"
try:
    import torch
    if torch.cuda.is_available():
        device = "cuda"
        print(f"🔥 Найдена видеокарта: {torch.cuda.get_device_name(0)}. Переключаемся на CUDA!")
    else:
        print("ℹ️ CUDA не найдена. Работаем в режиме CPU.")
except ImportError:
    print("⚠️ Библиотека torch не импортировалась напрямую. Дефолт на CPU.")

# Применяем оптимизации для CPU только в том случае, если CUDA недоступна
if device == "cpu":
    # Жестко ограничиваем математические библиотеки Windows 1 потоком для защиты i7-2600
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"

    # Для Windows: выставляем процессу фоновый приоритет (IDLE), чтобы ПК не тормозил
    if sys.platform == "win32":
        try:
            import win32api
            import win32con
            import win32process
            pid = win32api.GetCurrentProcessId()
            handle = win32api.OpenProcess(win32con.PROCESS_ALL_ACCESS, True, pid)
            win32process.SetPriorityClass(handle, win32process.IDLE_PRIORITY_CLASS)
            print("Системный приоритет процесса успешно снижен до IDLE.")
        except ImportError:
            pass

# =====================================================================
# 2. ИНИЦИАЛИЗАЦИЯ И СТАТУСЫ
# =====================================================================


HEALTH_STATUS = {
    "status": "starting",          # starting, idle, processing, error
    "device_used": device,
    "modalities": args.modalities,         # Сохраняем тип устройства для API
    "last_seen_db": None,
    "processed_count": 0,
    "errors_count": 0,
    "current_record_id": None,
    "uptime_start": time.time()
}

print(f"Загрузка модели jina-embeddings-v5-omni-nano на устройство [{device.upper()}]...")
print(f"Выбранные модальности: {args.modalities}")
# Инициализируем модель на выбранном устройстве
# model = SentenceTransformer("jinaai/jina-embeddings-v5-omni-nano-retrieval",
#     device=device,
#     trust_remote_code=True,
#     model_kwargs={"modality": args.modalities})
print(f"Модель успешно загружена на {device.upper()}.")
HEALTH_STATUS["status"] = "idle"


# =====================================================================
# 4. ОСНОВНОЙ АСИНХРОННЫЙ ВОРКЕР (LIVE QUERY LOOP)
# =====================================================================
@asynccontextmanager
async def surreal_worker_loop(app: FastAPI):
    # while True:
        # try:
    print(f"Попытка подключения к SurrealDB по адресу {args.db_url}...")
    async with AsyncSurreal(args.db_url) as db:
        await db.signin({"username": args.db_user, "password": args.db_pass})
        await db.use(namespace=args.db_ns, database=args.db_db)

        HEALTH_STATUS["last_seen_db"] = time.time()
        HEALTH_STATUS["status"] = "idle"
        print(f" Успешное подключение к SurrealDB ({args.db_ns}/{args.db_db}). Слушаем Live Query для таблицы '{args.db_table}'...")

        # query = "LIVE SELECT id, description, image FROM embeddings"
        query = "LIVE SELECT DIFF FROM embeddings"
        # query_uuid = await db.live(query, diff=True)
        # query_uuid =  await db.live(query, diff=True)
        # query_uuid = await db.query(query)
        res = await db.query(query)
        query_uuid = await db.live(table=Table(args.db_table), diff=True)
        live_stream = await db.subscribe_live(res)
        # notification = await asyncio.wait(live_stream.__anext__(), timeout=None)
        async for notification in live_stream:
            print(f"{res}, {notification}")
        # print(f"{res}, {notification}")
        # print(f"Получено событие: {res} {notification.get('action')} {notification.get('result')} full {notification}")

    yield
    await db.kill(query_uuid)
    await db.close()

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

app = FastAPI(title="Jina Worker Health Monitor", lifespan=surreal_worker_loop)

# =====================================================================
# HTTP API ДЛЯ МОНИТОРИНГА (ДЛЯ ВАШЕГО РЕДАКТОРА)
# =====================================================================

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
        "tracked_table": args.db_table,
        "metrics": {
            "total_processed": HEALTH_STATUS["processed_count"],
            "total_errors": HEALTH_STATUS["errors_count"]
        },
        "current_task": HEALTH_STATUS["current_record_id"],
        "db_connected": db_ok
    }

if __name__ == "__main__":
     uvicorn.run(app, host="0.0.0.0", port=args.api_port)
