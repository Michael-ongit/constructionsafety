"""
Dynamic schema + data-context profiler.
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
    name_lower = col_name.lower()
    if any(hint in name_lower for hint in _BLOB_NAME_HINTS):
        return True
    if series.astype(str).str.len().mean() > 500:
        return True
    return False


def _profile_column(df: pd.DataFrame, col: str, sql_type: str) -> dict:
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
    cols = db.get_columns(table)
    col_list = ", ".join(db.quote_ident(c) for c, _ in cols) or "*"
    if db.name in {"sqlite", "local", "local_sqlite"}:
        sample_query = f"SELECT {col_list} FROM {db.quote_ident(table)} LIMIT {sample_rows}"
        count_query = f"SELECT COUNT(*) AS n FROM {db.quote_ident(table)}"
    else:
        sample_query = f"SELECT TOP {sample_rows} {col_list} FROM {db.quote_ident(table)}"
        count_query = f"SELECT COUNT_BIG(*) AS n FROM {db.quote_ident(table)}"

    df = db.read_sql(sample_query)

    count_df = db.read_sql(count_query)
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
