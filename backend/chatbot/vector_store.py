"""
Two Chroma collections for schema memory and SQL cache.
"""
from __future__ import annotations

import chromadb
from chromadb.utils import embedding_functions

from . import config

SCHEMA_COLLECTION = "schema_knowledge"
SCHEMA_COLUMN_COLLECTION = "schema_column_knowledge"
SQL_CACHE_COLLECTION = "sql_query_cache"

_client = None
_embed_fn = None


def get_client():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=config.CHROMA_DIR)
    return _client


def _resolve_device() -> str:
    setting = config.EMBED_DEVICE
    if setting in ("cpu", "cuda"):
        return setting
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def get_embed_fn():
    global _embed_fn
    if _embed_fn is None:
        _embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=config.EMBED_MODEL_NAME, device=_resolve_device()
        )
    return _embed_fn


def _replace_collection(name: str, ids: list[str], documents: list[str], metadatas: list[dict]):
    client = get_client()
    collection = client.get_or_create_collection(name=name, embedding_function=get_embed_fn())
    try:
        existing = collection.get(include=[])
        if existing.get("ids"):
            collection.delete(ids=existing["ids"])
    except Exception:
        pass
    if ids:
        collection.add(ids=ids, documents=documents, metadatas=metadatas)
    return collection


def build_schema_knowledge() -> dict:
    from . import schema_profiler

    table_docs = schema_profiler.build_and_cache()
    profiles = schema_profiler.load_cached_profiles()
    column_docs = schema_profiler.profiles_to_column_documents(profiles)

    _replace_collection(
        SCHEMA_COLLECTION,
        ids=[f"{t}_schema" for t in table_docs.keys()],
        documents=list(table_docs.values()),
        metadatas=[{"table": t} for t in table_docs.keys()],
    )
    _replace_collection(
        SCHEMA_COLUMN_COLLECTION,
        ids=[k.replace(" ", "_") for k in column_docs.keys()],
        documents=list(column_docs.values()),
        metadatas=[{"table": k.split(".")[0], "column": k.split(".", 1)[1]} for k in column_docs.keys()],
    )

    return {"tables_profiled": list(table_docs.keys()), "columns_profiled": len(column_docs)}


def query_schema(question: str, top_k: int = config.TOP_K) -> str:
    client = get_client()
    collection = client.get_or_create_collection(
        name=SCHEMA_COLLECTION, embedding_function=get_embed_fn()
    )
    count = collection.count()
    if count == 0:
        return "No schema memory found -- run scripts/refresh_schema.py first."
    res = collection.query(query_texts=[question], n_results=min(top_k, count))
    docs = res.get("documents", [[]])[0]
    context = "\n\n".join(docs) if docs else ""

    try:
        col_collection = client.get_or_create_collection(
            name=SCHEMA_COLUMN_COLLECTION, embedding_function=get_embed_fn()
        )
        col_count = col_collection.count()
        if col_count:
            col_res = col_collection.query(query_texts=[question], n_results=min(5, col_count))
            col_docs = col_res.get("documents", [[]])[0]
            if col_docs:
                context += "\n\nMost relevant individual columns:\n" + "\n".join(col_docs)
    except Exception:
        pass

    return context if context else "No matching tables found."


def _cache_collection():
    client = get_client()
    return client.get_or_create_collection(
        name=SQL_CACHE_COLLECTION, embedding_function=get_embed_fn()
    )


def cache_lookup(question: str) -> str | None:
    if not config.ENABLE_SQL_CACHE:
        return None
    try:
        coll = _cache_collection()
        if coll.count() == 0:
            return None
        res = coll.query(query_texts=[question], n_results=1)
        dists = res.get("distances", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        if not dists:
            return None
        similarity = 1 - (dists[0] / 2)
        if similarity >= config.SQL_CACHE_SIMILARITY:
            return metas[0].get("sql")
    except Exception:
        return None
    return None


def cache_store(question: str, sql: str) -> None:
    if not config.ENABLE_SQL_CACHE:
        return
    try:
        import hashlib
        coll = _cache_collection()
        doc_id = hashlib.md5(question.strip().lower().encode()).hexdigest()
        coll.upsert(ids=[doc_id], documents=[question], metadatas=[{"sql": sql}])
    except Exception:
        pass
