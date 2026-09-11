"""
One-shot diagnostic: checks every moving part of the stack and prints a
clear PASS/FAIL for each, plus what currently exists on disk (schema
cache, Chroma collections/vector counts). Run this whenever something
"isn't working" and you don't know which layer is broken.

Usage (from the backend/ folder, with the virtualenv active):
    python scripts/diagnose.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config  # noqa: E402

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"

results = []


def check(label, fn):
    print(f"\n--- {label} " + "-" * max(1, 60 - len(label)))
    t0 = time.time()
    try:
        status, detail = fn()
    except Exception as e:
        status, detail = FAIL, f"unhandled exception: {e}"
    elapsed = round(time.time() - t0, 2)
    print(f"[{status}] ({elapsed}s) {detail}")
    results.append((label, status))
    return status


# ---------------------------------------------------------------------------
def check_config():
    problems = config.validate()
    lines = [
        f"MSSQL_SERVER={config.MSSQL_SERVER or '(blank)'}",
        f"MSSQL_DATABASE={config.MSSQL_DATABASE or '(blank)'}",
        f"MSSQL_USERNAME={'(set)' if config.MSSQL_USERNAME else '(blank -> Windows auth)'}",
        f"MSSQL_DRIVER={config.MSSQL_DRIVER}",
        f"MSSQL_INCLUDE_TABLES={config.MSSQL_INCLUDE_TABLES}",
        f"OPENAI_BASE_URL={config.OPENAI_BASE_URL}",
        f"OPENAI_IS_AZURE={config.OPENAI_IS_AZURE}",
        f"OPENAI_SQL_MODEL={config.OPENAI_SQL_MODEL}  OPENAI_CHAT_MODEL={config.OPENAI_CHAT_MODEL}",
        f"OPENAI_API_KEY={'(set, ' + str(len(config.OPENAI_API_KEY)) + ' chars)' if config.OPENAI_API_KEY else '(blank)'}",
        f"ALLOWED_ORIGINS={config.ALLOWED_ORIGINS}",
        f"EMBED_DEVICE={config.EMBED_DEVICE}",
    ]
    print("\n".join("  " + l for l in lines))
    if problems:
        return FAIL, "; ".join(problems)
    return PASS, "required config values are present"


def check_odbc_driver():
    try:
        import pyodbc
    except ImportError:
        return FAIL, "pyodbc is not installed (pip install pyodbc)"
    drivers = pyodbc.drivers()
    if not drivers:
        return FAIL, "no ODBC drivers registered on this machine at all -- install 'ODBC Driver 18 for SQL Server'"
    match = [d for d in drivers if config.MSSQL_DRIVER.lower() in d.lower()]
    if not match:
        return FAIL, f"MSSQL_DRIVER='{config.MSSQL_DRIVER}' not found. Installed drivers: {drivers}"
    return PASS, f"found: {match}"


def check_mssql_connection():
    from app import db

    ok, msg = db.get_pool().test_connection()
    return (PASS if ok else FAIL), msg


def check_mssql_tables():
    from app import db

    tables = db.list_tables()
    if not tables:
        return WARN, "no tables resolved (check MSSQL_INCLUDE_TABLES or DB permissions)"
    lines = []
    all_ok = True
    for t in tables:
        try:
            cols = db.get_columns(t)
            count_df = db.read_sql(f"SELECT COUNT_BIG(*) AS n FROM {db.quote_ident(t)}")
            n = int(count_df.iloc[0]["n"])
            lines.append(f"{t}: OK, {len(cols)} columns, {n} rows")
        except Exception as e:
            all_ok = False
            lines.append(f"{t}: FAILED -> {e}")
    print("\n".join("  " + l for l in lines))
    return (PASS if all_ok else FAIL), f"{len(tables)} table(s) checked"


def check_openai():
    from app import llm_client

    if not config.OPENAI_API_KEY:
        return FAIL, "OPENAI_API_KEY not set"
    try:
        text = llm_client.chat(
            [{"role": "user", "content": "Reply with exactly: OK"}],
            model=config.OPENAI_CHAT_MODEL,
            stream=False,
            temperature=0.0,
            max_tokens=10,
        )
        return PASS, f"model responded: {text.strip()!r}"
    except Exception as e:
        return FAIL, str(e)


def check_embedding_model():
    from app import vector_store

    fn = vector_store.get_embed_fn()
    vec = fn(["test sentence"])
    dims = len(vec[0]) if vec else 0
    device = vector_store._resolve_device()
    return PASS, f"model={config.EMBED_MODEL_NAME}, device={device}, embedding_dims={dims}"


def check_schema_cache_file():
    if not os.path.exists(config.SCHEMA_CACHE_PATH):
        return WARN, f"not found at {config.SCHEMA_CACHE_PATH} -- run scripts/refresh_schema.py"
    import json

    with open(config.SCHEMA_CACHE_PATH) as f:
        cache = json.load(f)
    built_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(cache.get("built_at", 0)))
    tables = list(cache.get("profiles", {}).keys())
    ok_tables = [t for t, p in cache.get("profiles", {}).items() if "error" not in p]
    return PASS, f"built at {built_at}; tables in cache: {tables}; profiled OK: {ok_tables}"


def check_chroma_collections():
    from app import vector_store

    if not os.path.exists(config.CHROMA_DIR):
        return WARN, f"Chroma directory not found yet at {config.CHROMA_DIR} -- run scripts/refresh_schema.py"
    client = vector_store.get_client()
    lines = []
    for name in (
        vector_store.SCHEMA_COLLECTION,
        vector_store.SCHEMA_COLUMN_COLLECTION,
        vector_store.SQL_CACHE_COLLECTION,
    ):
        try:
            coll = client.get_or_create_collection(name=name, embedding_function=vector_store.get_embed_fn())
            lines.append(f"{name}: {coll.count()} vectors")
        except Exception as e:
            lines.append(f"{name}: error -> {e}")
    print("\n".join("  " + l for l in lines))
    return PASS, f"Chroma dir: {config.CHROMA_DIR}"


def check_cors():
    return PASS, f"backend will accept requests from: {config.ALLOWED_ORIGINS}"


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 70)
    print("EHS CHATBOT - CONNECTION DIAGNOSTIC")
    print("=" * 70)

    check("Configuration", check_config)
    check("ODBC driver installed", check_odbc_driver)
    check("SQL Server connection", check_mssql_connection)
    check("SQL Server tables (your 4 tables)", check_mssql_tables)
    check("OpenAI / Azure OpenAI connectivity", check_openai)
    check("Embedding model (CPU/GPU)", check_embedding_model)
    check("Schema cache file (data/schema_cache.json)", check_schema_cache_file)
    check("Chroma vector collections", check_chroma_collections)
    check("CORS / allowed origins", check_cors)

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    for label, status in results:
        print(f"  [{status}] {label}")

    failed = [r for r in results if r[1] == FAIL]
    if failed:
        print(f"\n{len(failed)} check(s) FAILED -- fix those first, in the order listed above.")
        sys.exit(1)
    else:
        print("\nAll checks passed (or only non-fatal warnings).")
