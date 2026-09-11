"""
Chatbot FastAPI sub-application.

Mounted in the main app at /chat-api, so endpoints become:
    GET  /chat-api/api/health
    POST /chat-api/api/chat
    POST /chat-api/api/schema/refresh
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import config, db, llm_client, rag_engine, vector_store

logger = logging.getLogger("chatbot")

chatbot_app = FastAPI(title="EHS Safety Text-to-SQL Chatbot API", version="1.0.0")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)


@chatbot_app.on_event("startup")
async def on_startup():
    problems = config.validate()
    if problems:
        logger.warning("Configuration issues detected: %s", "; ".join(problems))
    else:
        logger.info("Chatbot configuration looks complete.")

    async def _warm():
        try:
            existing = vector_store.query_schema("startup check")
            if "No schema memory found" in existing:
                await asyncio.to_thread(vector_store.build_schema_knowledge)
                logger.info("Schema memory built at startup.")
        except Exception as e:
            logger.warning("Schema warm-up skipped: %s", e)

    asyncio.create_task(_warm())


@chatbot_app.get("/api/health")
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


@chatbot_app.post("/api/chat")
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


@chatbot_app.post("/api/schema/refresh")
async def refresh_schema(x_admin_token: str = Header(default="")):
    if not config.ADMIN_TOKEN or x_admin_token != config.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing admin token.")
    report = await asyncio.to_thread(vector_store.build_schema_knowledge)
    return {"status": "ok", **report}
