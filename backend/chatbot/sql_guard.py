"""
Validates and hardens LLM-generated read-only SQL before it reaches the database.
"""
from __future__ import annotations

import re

FORBIDDEN_KEYWORDS = (
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
    "MERGE", "EXEC", "EXECUTE", "GRANT", "REVOKE", "ATTACH", "DETACH",
    "PRAGMA", "REPLACE", "VACUUM", "OPENROWSET", "OPENQUERY", "BULK",
    "SHUTDOWN", "--", "/*", "xp_", "sp_",
)

BLOB_COLUMN_NAME_HINTS = ("image", "blob", "photo", "picture")

MAX_QUERY_LENGTH = 4000


class SQLValidationError(Exception):
    pass


def clean_sql(raw: str) -> str:
    q = raw.strip()
    if "```sql" in q:
        q = q.split("```sql", 1)[1].split("```")[0]
    elif "```" in q:
        q = q.split("```", 1)[1].split("```")[0]
    idx = q.upper().find("SELECT")
    if idx == -1:
        raise SQLValidationError("No SELECT statement found in model output.")
    q = q[idx:].strip()
    q = q.split(";")[0].strip()
    return q


def validate_readonly(query: str) -> None:
    if len(query) > MAX_QUERY_LENGTH:
        raise SQLValidationError("Generated query is too long.")
    if not query.upper().lstrip().startswith("SELECT"):
        raise SQLValidationError("Only SELECT statements are permitted.")
    if query.count("SELECT") > 6:
        raise SQLValidationError("Query is too complex to execute safely.")
    upper = query.upper()
    for kw in FORBIDDEN_KEYWORDS:
        if kw.isalpha() or kw.endswith("_"):
            if re.search(rf"\b{re.escape(kw)}\b", upper):
                raise SQLValidationError(f"Forbidden keyword detected: {kw}")
        elif kw in query:
            raise SQLValidationError(f"Forbidden pattern detected: {kw}")
    lower = query.lower()
    for hint in BLOB_COLUMN_NAME_HINTS:
        if hint in lower:
            raise SQLValidationError(
                f"Query references what looks like an image/blob column ('{hint}') -- "
                "this chatbot does not return images."
            )


def enforce_row_limit(query: str, max_rows: int) -> str:
    upper = query.upper()
    from . import db

    if db.name in {"sqlite", "local", "local_sqlite"}:
        # Be tolerant if an LLM still emits SQL Server-style TOP syntax.
        top_match = re.match(
            r"^(\s*SELECT\s+(?:DISTINCT\s+)?)(?:TOP\s+(\d+)\s+)",
            query,
            flags=re.IGNORECASE,
        )
        if top_match:
            query = top_match.group(1) + query[top_match.end():]
        if re.search(r"\bLIMIT\s+\d+\b", query, flags=re.IGNORECASE):
            return query
        return f"{query.rstrip()} LIMIT {max_rows}"

    if re.search(r"\bTOP\s+\d+\b", upper):
        return query
    if re.match(r"^\s*SELECT\s+DISTINCT\b", query, flags=re.IGNORECASE):
        return re.sub(r"(?i)^(\s*SELECT\s+DISTINCT\s+)", rf"\1TOP {max_rows} ", query, count=1)
    return re.sub(r"(?i)^(\s*SELECT\s+)", rf"\1TOP {max_rows} ", query, count=1)


def sanitize(raw_sql: str, max_rows: int) -> str:
    q = clean_sql(raw_sql)
    validate_readonly(q)
    q = enforce_row_limit(q, max_rows)
    return q
