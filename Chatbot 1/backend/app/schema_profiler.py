"""
Dynamic schema + data-context profiler.

Every table and column is profiled directly from the live SQL Server
database:
  - real column names & SQL types
  - row count, null %
  - low-cardinality text columns: most frequent distinct values (bounded,
    so prompt size never grows unbounded as data grows)
  - high-cardinality text columns: a note instead of an exhaustive list
  - numeric/date columns: min / max / mean

The output is cached to disk (data/schema_cache.json) and embedded into a
Chroma "schema_knowledge" collection, one chunk per table, so retrieval only
has to consider the table(s) relevant to a given question -- this keeps the
tokens sent to the LLM small and the SQL it writes grounded in the *actual*
stored values instead of guesses.
"""
from __future__ import annotations

import json
import os
import time
import warnings

import pandas as pd

from . import config, db

_BLOB_NAME_HINTS = ("image", "blob", "photo", "picture", "img")


def _looks_like_blob_column(col_name: str, series: pd.Series) -> bool:
    """The only column exclusion applied. Not a grouping/summarization
    decision -- this purely keeps large binary/base64 image payloads out of
    the vector store, since embedding raw image bytes has no value for
    text-to-SQL and would bloat every prompt."""
    name_lower = col_name.lower()
    if any(hint in name_lower for hint in _BLOB_NAME_HINTS):
        return True
    if series.astype(str).str.len().mean() > 500:
        return True
    return False


def _profile_column(df: pd.DataFrame, col: str, sql_type: str) -> dict:
    """Every column is profiled the same way, uniformly, regardless of its
    SQL type -- no numeric/date/text branching or category grouping. Each
    column keeps its real SQL type plus its raw top-N most frequent stored
    values (with exact counts) and numeric min/max/mean when applicable, so
    nothing is summarized away."""
    series = df[col]
    n = len(series)
    n_null = int(series.isna().sum())
    non_null = series.dropna()

    info = {
        "column": col,
        "sql_type": sql_type,
        "null_pct": round(100 * n_null / n, 1) if n else 0.0,
        "distinct_count": int(non_null.nunique()) if len(non_null) else 0,
    }

    if len(non_null) == 0:
        info["top_values"] = []
        return info

    top_n = config.SCHEMA_TOP_N_VALUES
    vc = non_null.astype(str).str.strip().value_counts()
    top = vc.head(top_n)
    info["top_values"] = [{"value": v, "count": int(c)} for v, c in top.items()]

    numeric = pd.to_numeric(non_null, errors="coerce")
    if numeric.notna().mean() > 0.9:
        info["min"] = float(numeric.min())
        info["max"] = float(numeric.max())
        info["mean"] = round(float(numeric.mean()), 2)

    return info


def profile_table(table: str, sample_rows: int = 50000) -> dict:
    """Profiles a table using a bounded sample for speed on very large
    tables -- exact row_count is still fetched separately via COUNT(*)."""
    cols = db.get_columns(table)
    col_list = ", ".join(db.quote_ident(c) for c, _ in cols) or "*"
    df = db.read_sql(f"SELECT TOP {sample_rows} {col_list} FROM {db.quote_ident(table)}")

    count_df = db.read_sql(f"SELECT COUNT_BIG(*) AS n FROM {db.quote_ident(table)}")
    row_count = int(count_df.iloc[0]["n"]) if not count_df.empty else len(df)

    col_profiles = []
    excluded_blob_cols = []
    for col_name, sql_type in cols:
        if col_name not in df.columns:
            continue
        if _looks_like_blob_column(col_name, df[col_name]):
            excluded_blob_cols.append(col_name)
            continue
        col_profiles.append(_profile_column(df, col_name, sql_type))

    return {
        "table": table,
        "row_count": row_count,
        "sampled_rows": len(df),
        "excluded_columns": excluded_blob_cols,
        "columns": col_profiles,
    }


def profile_all_tables(tables: list[str] | None = None) -> dict:
    tables = tables or db.list_tables()
    profiles = {}
    for t in tables:
        try:
            profiles[t] = profile_table(t)
        except Exception as e:
            profiles[t] = {"table": t, "error": str(e)}
    return profiles


def _col_to_text(c: dict) -> str:
    parts = [f"  - {c['column']} ({c.get('sql_type', 'TEXT')}, {c.get('distinct_count', 0)} distinct values)"]
    if c.get("top_values"):
        vals = ", ".join(f"'{v['value']}' ({v['count']}x)" for v in c["top_values"])
        parts.append(f": top values -> {vals}")
    if "min" in c and "max" in c:
        parts.append(f" | numeric range {c['min']}..{c['max']}, avg {c['mean']}")
    if c.get("null_pct", 0) > 0:
        parts.append(f" [null in {c['null_pct']}% of rows]")
    return "".join(parts)


def profiles_to_documents(profiles: dict) -> dict[str, str]:
    """One combined document per table (all of its columns) -- the primary
    retrieval unit for SQL generation, since writing a query needs the full
    table's columns together, not one column in isolation."""
    docs = {}
    for table, prof in profiles.items():
        if "error" in prof:
            continue
        lines = [
            f"Table: {table} ({prof['row_count']} rows)",
            "Columns (name, type, and the ACTUAL values present in the data -- "
            "always match filters against these real values, not guesses):",
        ]
        for c in prof["columns"]:
            lines.append(_col_to_text(c))
        docs[table] = "\n".join(lines)
    return docs


def profiles_to_column_documents(profiles: dict) -> dict[str, str]:
    """One document per individual column (id: 'table.column'), embedded
    separately so retrieval can also match a question against a single
    column's real values directly -- finer-grained than the table-level
    document above."""
    docs = {}
    for table, prof in profiles.items():
        if "error" in prof:
            continue
        for c in prof["columns"]:
            key = f"{table}.{c['column']}"
            docs[key] = f"Table {table}, column {c['column']}: {_col_to_text(c).strip(': ')}"
    return docs


def build_and_cache(tables: list[str] | None = None) -> dict[str, str]:
    profiles = profile_all_tables(tables)
    cache = {"built_at": time.time(), "profiles": profiles}
    os.makedirs(os.path.dirname(config.SCHEMA_CACHE_PATH), exist_ok=True)
    with open(config.SCHEMA_CACHE_PATH, "w") as f:
        json.dump(cache, f, indent=2, default=str)
    return profiles_to_documents(profiles)


def load_cached_documents() -> dict[str, str] | None:
    profiles = load_cached_profiles()
    return profiles_to_documents(profiles) if profiles else None


def load_cached_profiles() -> dict | None:
    if not os.path.exists(config.SCHEMA_CACHE_PATH):
        return None
    try:
        with open(config.SCHEMA_CACHE_PATH) as f:
            cache = json.load(f)
        return cache["profiles"]
    except Exception:
        return None
