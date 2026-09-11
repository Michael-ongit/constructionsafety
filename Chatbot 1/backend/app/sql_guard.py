"""
Validates and hardens LLM-generated T-SQL before it ever touches SQL Server.
The model must never be able to run anything other than a single read-only
SELECT, no matter how it's prompted or what the question says.
"""
from __future__ import annotations

import re

FORBIDDEN_KEYWORDS = (
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
    "MERGE", "EXEC", "EXECUTE", "GRANT", "REVOKE", "ATTACH", "DETACH",
    "PRAGMA", "REPLACE", "VACUUM", "OPENROWSET", "OPENQUERY", "BULK",
    "SHUTDOWN", "--", "/*", "xp_", "sp_",
)

# Image/blob columns are excluded from schema memory entirely (see
# schema_profiler.py) so the model shouldn't reference them -- this is a
# second, independent check in case a column name is ever hallucinated.
BLOB_COLUMN_NAME_HINTS = ("image", "blob", "photo", "picture")

MAX_QUERY_LENGTH = 4000


class SQLValidationError(Exception):
    pass


def clean_sql(raw: str) -> str:
    """Strip markdown fences / preamble text an LLM might add."""
    q = raw.strip()
    if "```sql" in q:
        q = q.split("```sql", 1)[1].split("```")[0]
    elif "```" in q:
        q = q.split("```", 1)[1].split("```")[0]
    idx = q.upper().find("SELECT")
    if idx == -1:
        raise SQLValidationError("No SELECT statement found in model output.")
    q = q[idx:].strip()
    # Drop a trailing semicolon and anything after it (defends against
    # stacked/second statements).
    q = q.split(";")[0].strip()
    return q


def validate_readonly(query: str) -> None:
    if len(query) > MAX_QUERY_LENGTH:
        raise SQLValidationError("Generated query is too long.")
    if not query.upper().lstrip().startswith("SELECT"):
        raise SQLValidationError("Only SELECT statements are permitted.")
    if query.count("SELECT") > 6:
        # Reasonable ceiling for nested subqueries/CTEs; blocks pathological output.
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
    """SQL Server uses TOP N right after SELECT (and after DISTINCT), not a
    trailing LIMIT."""
    upper = query.upper()
    if re.search(r"\bTOP\s+\d+\b", upper):
        return query
    if re.match(r"^\s*SELECT\s+DISTINCT\b", query, flags=re.IGNORECASE):
        return re.sub(r"(?i)^(\s*SELECT\s+DISTINCT\s+)", rf"\1TOP {max_rows} ", query, count=1)
    return re.sub(r"(?i)^(\s*SELECT\s+)", rf"\1TOP {max_rows} ", query, count=1)


def sanitize(raw_sql: str, max_rows: int) -> str:
    """Full pipeline: clean -> validate -> cap rows. Raises
    SQLValidationError on anything unsafe."""
    q = clean_sql(raw_sql)
    validate_readonly(q)
    q = enforce_row_limit(q, max_rows)
    return q
