"""
SQLAlchemy database engine and session factory.

Connection strategy:
  - DB_BACKEND=sqlite uses the local SQLite database without probing SQL Server.
  - DB_BACKEND=sqlserver uses SQL Server and can optionally fall back to SQLite
    when USE_SQLITE_FALLBACK=1.

The .env file is read manually to preserve whitespace in values (some DB names
contain leading spaces in the production environment).
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
import re
from dotenv import load_dotenv

try:
    import pyodbc
except ModuleNotFoundError:
    pyodbc = None

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

# ---------------------------------------------------------------------------
# .env reading helpers (preserve whitespace)
# ---------------------------------------------------------------------------

def clean_value(val, default):
    """Strip quotes and surrounding whitespace; return default if empty."""
    if val is None:
        return default
    val = val.strip()
    if val.startswith('"') and val.endswith('"'):
        val = val[1:-1]
    if val.startswith("'") and val.endswith("'"):
        val = val[1:-1]
    return val.strip() if val.strip() else default


def read_env_file():
    """Read .env line-by-line to avoid losing leading/trailing whitespace."""
    env_file = os.path.join(os.path.dirname(__file__), '.env')
    if not os.path.exists(env_file):
        return {}
    values = {}
    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, value = line.split('=', 1)
                values[key.strip()] = value
    return values


env_values = read_env_file()


def read_env_value(key, default):
    """Read a value WITHOUT stripping leading/trailing whitespace."""
    val = env_values.get(key) or os.getenv(key)
    if val is None:
        return default
    if val.startswith('"') and val.endswith('"'):
        val = val[1:-1]
    if val.startswith("'") and val.endswith("'"):
        val = val[1:-1]
    return val if val.strip() else default


# ---------------------------------------------------------------------------
# Connection parameters
# ---------------------------------------------------------------------------
DB_DRIVER   = clean_value(env_values.get("DB_DRIVER") or os.getenv("DB_DRIVER"), "ODBC Driver 18 for SQL Server")
DB_SERVER   = clean_value(env_values.get("DB_SERVER") or os.getenv("DB_SERVER"), "")
DB_DATABASE = read_env_value("DB_DATABASE", "")
DB_USERNAME = clean_value(env_values.get("DB_USERNAME") or os.getenv("DB_USERNAME"), "")
DB_PASSWORD = clean_value(env_values.get("DB_PASSWORD") or os.getenv("DB_PASSWORD"), "")
DB_PORT     = clean_value(env_values.get("DB_PORT") or os.getenv("DB_PORT"), "1433")
DB_TRUST_CERT = clean_value(env_values.get("DB_TRUST_SERVER_CERT") or os.getenv("DB_TRUST_SERVER_CERT"), "no")
DB_BACKEND  = clean_value(env_values.get("DB_BACKEND") or os.getenv("DB_BACKEND"), "sqlite").lower()
SQLITE_DB_PATH = clean_value(
    env_values.get("SQLITE_DB_PATH") or os.getenv("SQLITE_DB_PATH"),
    os.path.join(os.path.dirname(__file__), "local_dev.db"),
)

# ---------------------------------------------------------------------------
# Driver auto-detection — pick first available if the configured one is missing
# ---------------------------------------------------------------------------
available_drivers = []
if pyodbc is not None:
    try:
        available_drivers = pyodbc.drivers()
    except Exception:
        available_drivers = []

if pyodbc is not None and DB_DRIVER not in available_drivers:
    for candidate in ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server",
                       "SQL Server Native Client 11.0", "SQL Server"]:
        if candidate in available_drivers:
            print(f"Configured driver '{DB_DRIVER}' not found. Using installed driver '{candidate}'.")
            DB_DRIVER = candidate
            break

conn_str = (
    f"DRIVER={{{DB_DRIVER}}};"
    f"SERVER={DB_SERVER};"
    f"DATABASE={DB_DATABASE};"
    f"UID={DB_USERNAME};"
    f"PWD={DB_PASSWORD};"
    f"TrustServerCertificate={'yes' if DB_TRUST_CERT.lower() in ('yes', 'true', '1') else 'no'};"
    f"Connection Timeout=30;"
)

safe_conn_str = re.sub(r"PWD=[^;]*", "PWD=***", conn_str) if "re" in globals() else conn_str.replace(f"PWD={DB_PASSWORD}", "PWD=***")
if DB_BACKEND in {"sqlserver", "mssql", "azure_sql"}:
    print(f"DB_DATABASE raw value: [{DB_DATABASE}]")
    print(f"ODBC Connection String: {safe_conn_str}")


def get_connection():
    """Return a raw pyodbc connection (used by SQLAlchemy creator)."""
    if pyodbc is None:
        raise RuntimeError("pyodbc is not installed")
    return pyodbc.connect(conn_str)


USE_SQLITE_FALLBACK = os.getenv("USE_SQLITE_FALLBACK", "1").strip().lower() not in {"0", "false", "no"}
driver_missing = pyodbc is not None and DB_DRIVER not in available_drivers
engine = None


def _make_sqlite_engine():
    """Create a SQLite engine using SQLITE_DB_PATH (relative to backend)."""
    sqlite_path = SQLITE_DB_PATH
    if not os.path.isabs(sqlite_path):
        sqlite_path = os.path.join(os.path.dirname(__file__), sqlite_path)
    sqlite_url_path = os.path.abspath(sqlite_path).replace("\\", "/")
    os.makedirs(os.path.dirname(os.path.abspath(sqlite_path)), exist_ok=True)
    print(f"Using SQLite database at {sqlite_path}.")
    return create_engine(
        f"sqlite:///{sqlite_url_path}",
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )


# ---------------------------------------------------------------------------
# Engine selection
# ---------------------------------------------------------------------------
if DB_BACKEND in {"sqlite", "local", "local_sqlite"}:
    engine = _make_sqlite_engine()
elif DB_BACKEND in {"sqlserver", "mssql", "azure_sql"}:
    if (pyodbc is None or driver_missing) and USE_SQLITE_FALLBACK:
        reason = "pyodbc is not installed" if pyodbc is None else f"{DB_DRIVER} is not installed"
        print(f"{reason}. Using local SQLite fallback.")
        engine = _make_sqlite_engine()
    elif USE_SQLITE_FALLBACK:
        try:
            test_conn = pyodbc.connect(conn_str, timeout=5)
            test_conn.close()
            engine = create_engine(
                "mssql+pyodbc://",
                creator=get_connection,
                pool_pre_ping=True,
                pool_size=20, max_overflow=30, pool_timeout=60, pool_recycle=300,
            )
        except Exception as e:
            print(f"SQL Server connection failed: {e}. Falling back to SQLite.")
            engine = _make_sqlite_engine()
    else:
        engine = create_engine(
            "mssql+pyodbc://",
            creator=get_connection,
            pool_pre_ping=True,
            pool_size=20, max_overflow=30, pool_timeout=60, pool_recycle=300,
        )
else:
    raise ValueError(
        f"Unsupported DB_BACKEND={DB_BACKEND!r}. Use 'sqlite' or 'sqlserver'."
    )

# ---------------------------------------------------------------------------
# Session factory + declarative base
# ---------------------------------------------------------------------------
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a DB session, closed after request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
