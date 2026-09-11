"""
FastAPI entrypoint.

Run with:
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2

Endpoints:
    GET  /api/health           -- liveness + config sanity check
    POST /api/chat             -- SSE stream of the answer pipeline
    POST /api/schema/refresh   -- rebuild schema memory (requires ADMIN_TOKEN)
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import config, db, llm_client, rag_engine, vector_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("chatbot")

app = FastAPI(title="EHS Safety Text-to-SQL Chatbot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)


@app.on_event("startup")
async def on_startup():
    problems = config.validate()
    if problems:
        logger.warning("Configuration issues detected: %s", "; ".join(problems))
    else:
        logger.info("Configuration looks complete.")

    # Warm the schema cache in the background so the first real user request
    # doesn't have to wait for a full profiling pass.
    async def _warm():
        try:
            existing = vector_store.query_schema("startup check")
            if "No schema memory found" in existing:
                await asyncio.to_thread(vector_store.build_schema_knowledge)
                logger.info("Schema memory built at startup.")
        except Exception as e:
            logger.warning("Schema warm-up skipped: %s", e)

    asyncio.create_task(_warm())


@app.get("/api/health")
async def health():
    problems = config.validate()
    db_ok, db_msg = await asyncio.to_thread(db.get_pool().test_connection) if not problems else (False, "not configured")
    return {
        "status": "ok" if not problems and db_ok else "degraded",
        "config_issues": problems,
        "database": {"connected": db_ok, "detail": db_msg},
        "llm": {"provider": "openai", "configured": llm_client.is_reachable()},
    }


def _sse_format(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    history = [m.model_dump() for m in req.history]

    async def event_stream():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()

        def _produce():
            try:
                for event in rag_engine.answer_events(req.message, history):
                    if request.client is None:
                        pass
                    asyncio.run_coroutine_threadsafe(queue.put(event), loop)
            except Exception as e:
                asyncio.run_coroutine_threadsafe(queue.put({"type": "error", "content": str(e)}), loop)
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(SENTINEL), loop)

        loop.run_in_executor(None, _produce)

        while True:
            if await request.is_disconnected():
                break
            item = await queue.get()
            if item is SENTINEL:
                break
            yield _sse_format(item)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/schema/refresh")
async def refresh_schema(x_admin_token: str = Header(default="")):
    if not config.ADMIN_TOKEN or x_admin_token != config.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing admin token.")
    report = await asyncio.to_thread(vector_store.build_schema_knowledge)
    return {"status": "ok", **report}
