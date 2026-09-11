"""
Orchestrates the answer pipeline:

  question
    -> retrieve relevant table profiles from schema_knowledge (structure +
       schema + REAL per-column data, auto-profiled -- see schema_profiler.py)
    -> check semantic SQL cache (skip the LLM entirely for repeat/near-repeat
       questions -- faster + cheaper)
    -> OpenAI writes a single T-SQL SELECT grounded in that real schema
    -> sql_guard validates it's read-only, single-statement, row-capped
    -> execute against SQL Server (SSMS)
    -> on failure, feed the error back to the model once and retry
    -> OpenAI turns the result set into a conversational answer (streamed)

Statelessness / no history bleeding: this module takes the conversation
history as a plain argument on every call. Nothing is cached server-side per
user or per session, so there is no shared state two different browser tabs
or two different users could ever collide on. The client is expected to send
only the last few clean (role, content) turns -- never raw SQL/result text --
which is also enforced again here as a second safeguard.
"""
from __future__ import annotations

import time
from typing import Generator, Optional

import pandas as pd

from . import config, db, sql_guard, vector_store, llm_client

SQL_SYSTEM_PROMPT_TEMPLATE = """Write one valid Microsoft SQL Server (T-SQL) SELECT query for the question below.

Schema context (real tables, columns, and real stored values):
{schema_context}

Rules:
- Output ONLY the raw SQL query, starting with SELECT. No markdown, no comments, no explanation.
- Only SELECT statements are allowed. Never write INSERT/UPDATE/DELETE/DROP/ALTER/EXEC.
- Use square-bracket identifiers, e.g. [Status], only where the name needs escaping.
- Join tables on Audit_Id when columns from multiple tables are needed.
- Match filters against the exact real stored values shown above -- never invent values.
- For fuzzy text search use LIKE '%keyword%' with one simple keyword.
- Use exact column names given. Do not add extra WHERE clauses not implied by the question."""

ANSWER_SYSTEM_PROMPT = """You are an EHS Safety assistant. Answer using ONLY the database results provided.
Be concise, use bullet points where useful, mention Audit_Id when referring to specific findings,
and explain results in plain language. Never show raw SQL or stack traces to the user."""

SQL_FIX_PROMPT = """Fix the following T-SQL query based on the database error and schema context.

Query:
{sql}

Error:
{error}

Schema context:
{schema_context}

Output ONLY the corrected SELECT query."""

SCHEMA_QUESTION_KEYWORDS = (
    "what tables", "list tables", "what columns", "schema", "table structure",
    "database structure", "database schema", "describe table", "columns of",
    "what fields", "available tables", "structure of the database",
)


def is_schema_question(question: str) -> bool:
    q = question.lower()
    return any(kw in q for kw in SCHEMA_QUESTION_KEYWORDS)


def _get_schema_context(question: str) -> str:
    try:
        return vector_store.query_schema(question, top_k=config.TOP_K)
    except Exception as e:
        return f"Error retrieving schema memory: {e}"


def _clean_history(history: Optional[list[dict]], limit: int) -> list[dict]:
    """Keeps only role/content -- drops any other keys a client might
    accidentally include (e.g. sql_query, sql_result) so internal debug
    data can never leak into a prompt."""
    if not history:
        return []
    trimmed = history[-limit:]
    return [{"role": m.get("role", "user"), "content": str(m.get("content", ""))} for m in trimmed]


def generate_sql_stream(question: str, schema_context: str, history: Optional[list[dict]]):
    system_prompt = SQL_SYSTEM_PROMPT_TEMPLATE.format(schema_context=schema_context)
    messages = [{"role": "system", "content": system_prompt}]

    clean_hist = _clean_history(history, config.MAX_HISTORY_TURNS_FOR_SQL)
    if clean_hist:
        history_text = "\n".join(f"{m['role'].capitalize()}: {m['content']}" for m in clean_hist)
        messages.append({
            "role": "system",
            "content": (
                "Previous conversation, for reference only -- use it just to resolve "
                "pronouns/follow-ups in the latest question, never to answer an older question:\n"
                f"{history_text}"
            ),
        })

    messages.append({
        "role": "user",
        "content": f'Write the SQL query for this latest question only: "{question}"',
    })
    return llm_client.chat(
        messages, model=config.OPENAI_SQL_MODEL, stream=True,
        temperature=0.0, max_tokens=config.SQL_GEN_MAX_TOKENS,
    )


def _fix_sql(sql: str, error: str, schema_context: str) -> str:
    prompt = SQL_FIX_PROMPT.format(sql=sql, error=error, schema_context=schema_context)
    return llm_client.chat(
        [{"role": "user", "content": prompt}], model=config.OPENAI_SQL_MODEL,
        stream=False, temperature=0.0, max_tokens=config.SQL_GEN_MAX_TOKENS,
    )


def execute_sql(query: str) -> tuple[bool, pd.DataFrame | str]:
    try:
        df = db.read_sql(query)
        return True, df
    except Exception as e:
        return False, str(e)


def answer_events(question: str, history: Optional[list[dict]] = None) -> Generator[dict, None, None]:
    """Yields SSE-ready event dicts:
      {"type": "status",   "content": str}
      {"type": "sql",      "content": str}
      {"type": "token",    "content": str}
      {"type": "done",     "sql_query": str, "row_count": int, "routing_method": str}
      {"type": "error",    "content": str}
    """
    t0 = time.time()
    question = (question or "").strip()
    if not question:
        yield {"type": "error", "content": "Empty question."}
        return

    yield {"type": "status", "content": "Searching schema memory..."}
    schema_context = _get_schema_context(question)

    if is_schema_question(question):
        outcome = {"sql": None, "result_df": None, "error": None, "from_cache": False, "is_schema_only": True}
    else:
        yield {"type": "status", "content": "Checking SQL cache..."}
        cached_sql = vector_store.cache_lookup(question)
        outcome = None

        if cached_sql:
            yield {"type": "status", "content": "Running cached query..."}
            ok, df_or_err = execute_sql(cached_sql)
            if ok:
                outcome = {"sql": cached_sql, "result_df": df_or_err, "error": None, "from_cache": True}
                yield {"type": "sql", "content": cached_sql}

        if outcome is None:
            yield {"type": "status", "content": "Generating SQL..."}
            try:
                compiled_sql = ""
                for chunk in generate_sql_stream(question, schema_context, history):
                    compiled_sql += chunk
                sql = sql_guard.sanitize(compiled_sql, config.SQL_MAX_ROWS)
            except Exception as e:
                yield {"type": "error", "content": f"Could not generate a valid SQL query: {e}"}
                return

            yield {"type": "sql", "content": sql}
            yield {"type": "status", "content": "Running query..."}
            ok, df_or_err = execute_sql(sql)

            if not ok and config.SQL_RETRY_ON_ERROR:
                yield {"type": "status", "content": "Query failed, retrying with a correction..."}
                try:
                    fixed_raw = _fix_sql(sql, str(df_or_err), schema_context)
                    fixed_sql = sql_guard.sanitize(fixed_raw, config.SQL_MAX_ROWS)
                    ok2, df_or_err2 = execute_sql(fixed_sql)
                    if ok2:
                        sql, ok, df_or_err = fixed_sql, ok2, df_or_err2
                        yield {"type": "sql", "content": sql}
                except Exception:
                    pass

            if ok:
                vector_store.cache_store(question, sql)
                outcome = {"sql": sql, "result_df": df_or_err, "error": None, "from_cache": False}
            else:
                outcome = {"sql": sql, "result_df": None, "error": str(df_or_err), "from_cache": False}

    sql_query = outcome.get("sql") or ""
    result_df = outcome.get("result_df")

    if outcome.get("is_schema_only"):
        user_content = (
            f'User\'s question: "{question}"\n\n'
            "Using the schema context below, answer the question about the database "
            "structure. Do not write SQL. Just explain what tables/columns/values exist.\n\n"
            f"Schema context:\n{schema_context}"
        )
        row_count = 0
    elif outcome.get("error"):
        user_content = (
            f'User\'s question: "{question}"\n\nSQL executed:\n{sql_query}\n\n'
            f"The query failed with this error: {outcome['error']}\n\n"
            "Explain this to the user conversationally, without showing the raw error or SQL."
        )
        row_count = 0
    elif result_df is not None and not result_df.empty:
        row_count = len(result_df)
        result_text = result_df.to_markdown(index=False)
        user_content = (
            f'User\'s question: "{question}"\n\nSQL executed:\n{sql_query}\n\n'
            f"Query results:\n{result_text}\n\n"
            "Answer the question conversationally for an EHS safety officer using only these results."
        )
    else:
        row_count = 0
        user_content = (
            f'User\'s question: "{question}"\n\nSQL executed:\n{sql_query}\n\n'
            "No rows matched. Explain this conversationally to the user."
        )

    routing_method = (
        "schema-only" if outcome.get("is_schema_only")
        else ("cache" if outcome.get("from_cache") else "schema-rag-sql")
    )

    messages = [{"role": "system", "content": ANSWER_SYSTEM_PROMPT}]
    messages.extend(_clean_history(history, config.MAX_HISTORY_TURNS_FOR_ANSWER))
    messages.append({"role": "user", "content": user_content})

    try:
        for chunk in llm_client.chat(
            messages, model=config.OPENAI_CHAT_MODEL, stream=True,
            temperature=0.2, max_tokens=config.ANSWER_MAX_TOKENS,
        ):
            yield {"type": "token", "content": chunk}
    except Exception as e:
        yield {"type": "error", "content": f"Could not generate a response: {e}"}
        return

    yield {
        "type": "done",
        "sql_query": sql_query,
        "row_count": row_count,
        "routing_method": routing_method,
        "elapsed_seconds": round(time.time() - t0, 2),
    }
