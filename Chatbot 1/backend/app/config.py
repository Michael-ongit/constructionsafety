"""
Central configuration. Everything is read from environment variables (a .env
file is loaded automatically via python-dotenv) so nothing production-related
is hard-coded. There is exactly one LLM provider (OpenAI) and exactly one
database backend (SQL Server / SSMS) -- no other option is exposed, by design.
"""
from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: str) -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# SQL Server (SSMS) connection
# ---------------------------------------------------------------------------
MSSQL_SERVER = os.environ.get("MSSQL_SERVER", "")
MSSQL_DATABASE = os.environ.get("MSSQL_DATABASE", "")
MSSQL_USERNAME = os.environ.get("MSSQL_USERNAME", "")   # blank -> Windows/trusted auth
MSSQL_PASSWORD = os.environ.get("MSSQL_PASSWORD", "")
MSSQL_DRIVER = os.environ.get("MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
MSSQL_ENCRYPT = _bool("MSSQL_ENCRYPT", "yes")
MSSQL_TRUST_SERVER_CERT = _bool("MSSQL_TRUST_SERVER_CERT", "yes")
MSSQL_CONN_TIMEOUT = _int("MSSQL_CONN_TIMEOUT", 10)
MSSQL_POOL_SIZE = _int("MSSQL_POOL_SIZE", 8)

# Restrict schema profiling / SQL generation to exactly these tables (your 4
# SSMS tables). Leave blank to auto-discover every base table in the database.
MSSQL_INCLUDE_TABLES = [
    t.strip() for t in os.environ.get(
        "MSSQL_INCLUDE_TABLES",
        "safety_model,uauc_evidence,uauc_rejection_history,compliance",
    ).split(",") if t.strip()
]

# ---------------------------------------------------------------------------
# OpenAI (only LLM provider) -- works with plain OpenAI or Azure OpenAI.
# Azure is auto-detected from OPENAI_BASE_URL (contains "azure.com"); you
# don't need to set anything extra to switch between them besides the URL.
# ---------------------------------------------------------------------------
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
OPENAI_IS_AZURE = "azure.com" in OPENAI_BASE_URL.lower() or "cognitiveservices" in OPENAI_BASE_URL.lower()
AZURE_OPENAI_API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-08-01-preview")
# For Azure, these are your DEPLOYMENT names (not base model names).
OPENAI_SQL_MODEL = os.environ.get("OPENAI_SQL_MODEL", "gpt-4o-mini")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
OPENAI_TIMEOUT_SECONDS = _float("OPENAI_TIMEOUT_SECONDS", 45.0)
OPENAI_MAX_RETRIES = _int("OPENAI_MAX_RETRIES", 2)
SQL_GEN_MAX_TOKENS = _int("SQL_GEN_MAX_TOKENS", 220)
ANSWER_MAX_TOKENS = _int("ANSWER_MAX_TOKENS", 420)

# ---------------------------------------------------------------------------
# Embeddings / vector memory. No Docker required either way.
# EMBED_DEVICE: "cpu" (default, always works) | "cuda" (use GPU) |
# "auto" (use a GPU automatically if one is available, else CPU).
# ---------------------------------------------------------------------------
CHROMA_DIR = os.environ.get("CHROMA_DIR", os.path.join(BASE_DIR, "chroma_db"))
EMBED_MODEL_NAME = os.environ.get("EMBED_MODEL_NAME", "all-MiniLM-L6-v2")
EMBED_DEVICE = os.environ.get("EMBED_DEVICE", "cpu").strip().lower()  # cpu | cuda | auto
SCHEMA_CACHE_PATH = os.path.join(BASE_DIR, "data", "schema_cache.json")

# How many highest-frequency values to store per column in schema memory.
# Applied uniformly to every column (no type-based grouping).
SCHEMA_TOP_N_VALUES = _int("SCHEMA_TOP_N_VALUES", 3)

# ---------------------------------------------------------------------------
# Retrieval / generation tuning
# ---------------------------------------------------------------------------
TOP_K = _int("TOP_K", 2)
SQL_MAX_ROWS = _int("SQL_MAX_ROWS", 25)
SQL_RETRY_ON_ERROR = _bool("SQL_RETRY_ON_ERROR", "true")

ENABLE_SQL_CACHE = _bool("ENABLE_SQL_CACHE", "true")
SQL_CACHE_SIMILARITY = _float("SQL_CACHE_SIMILARITY", 0.92)

# Conversation is stateless on the server: the client sends its own recent
# history with every request. This is what prevents "history bleeding"
# between unrelated users/tabs/sessions in a multi-user deployment -- there
# is no shared server-side session object for two users to collide on.
MAX_HISTORY_TURNS_FOR_SQL = _int("MAX_HISTORY_TURNS_FOR_SQL", 2)
MAX_HISTORY_TURNS_FOR_ANSWER = _int("MAX_HISTORY_TURNS_FOR_ANSWER", 6)

# ---------------------------------------------------------------------------
# API / CORS / auth
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()
]
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")  # required to call /api/schema/refresh
API_HOST = os.environ.get("API_HOST", "0.0.0.0")
API_PORT = _int("API_PORT", 8000)

# Statuses considered "open/pending" vs "closed/done" in the compliance
# table. Sensible defaults only -- schema_profiler always reads the real
# stored values live, so SQL generation never depends on this list.
OPEN_STATUSES = {"OPEN", "AWAITING_APPROVAL", "IN_PROGRESS", "REWORK", "REWORK_REQUIRED", "PENDING"}
CLOSED_STATUSES = {"CLOSED", "APPROVED", "ACCEPTED", "COMPLETED"}


def validate() -> list[str]:
    """Returns a list of human-readable problems with the current config.
    Called at startup so misconfiguration fails loudly instead of causing a
    mysterious timeout/500 on the first real chat request."""
    problems = []
    if not OPENAI_API_KEY:
        problems.append("OPENAI_API_KEY is not set.")
    if not MSSQL_SERVER:
        problems.append("MSSQL_SERVER is not set.")
    if not MSSQL_DATABASE:
        problems.append("MSSQL_DATABASE is not set.")
    if not MSSQL_USERNAME and not MSSQL_PASSWORD:
        # Not an error -- trusted/Windows auth is valid -- but worth a note.
        pass
    return problems
