"""Database access used by the Text-to-SQL chatbot.

The chatbot deliberately uses the same SQLAlchemy engine as the main API.
That keeps local development on the same SQLite file and avoids requiring an
ODBC driver just to import or start the application. SQL Server remains
available when ``DB_BACKEND=sqlserver`` is selected.
"""
from __future__ import annotations

import contextlib
import queue
import threading

import pandas as pd
from sqlalchemy import inspect, text

from database import engine
from . import config


class SQLitePool:
    """Small compatibility wrapper around the shared SQLAlchemy SQLite engine."""

    def __init__(self, size: int = 1):
        self._engine = engine

    @contextlib.contextmanager
    def get(self):
        with self._engine.connect() as conn:
            yield conn

    def test_connection(self) -> tuple[bool, str]:
        try:
            with self.get() as conn:
                conn.execute(text("SELECT 1"))
            return True, "ok"
        except Exception as e:
            return False, str(e)


class MSSQLPool:
    """Thread-safe pool for the optional SQL Server chatbot backend."""

    def __init__(self, size: int):
        try:
            import pyodbc
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "pyodbc is required for DB_BACKEND=sqlserver. "
                "Use DB_BACKEND=sqlite for local development."
            ) from exc

        self._pyodbc = pyodbc
        self._size = size
        self._pool = queue.Queue(maxsize=size)

    def _conn_str(self) -> str:
        auth = (
            f"UID={config.MSSQL_USERNAME};PWD={config.MSSQL_PASSWORD};"
            if config.MSSQL_USERNAME
            else "Trusted_Connection=yes;"
        )
        encrypt = "Encrypt=yes;" if config.MSSQL_ENCRYPT else "Encrypt=no;"
        trust = "TrustServerCertificate=yes;" if config.MSSQL_TRUST_SERVER_CERT else ""
        return (
            f"DRIVER={{{config.MSSQL_DRIVER}}};"
            f"SERVER={config.MSSQL_SERVER};"
            f"DATABASE={config.MSSQL_DATABASE};"
            f"{auth}{encrypt}{trust}"
            f"Connection Timeout={config.MSSQL_CONN_TIMEOUT};"
        )

    def _new_connection(self):
        return self._pyodbc.connect(
            self._conn_str(),
            autocommit=True,
            timeout=config.MSSQL_CONN_TIMEOUT,
        )

    @contextlib.contextmanager
    def get(self):
        conn = None
        try:
            conn = self._pool.get_nowait()
            conn.cursor().execute("SELECT 1")
        except (queue.Empty, self._pyodbc.Error):
            conn = self._new_connection()
        try:
            yield conn
        finally:
            try:
                self._pool.put_nowait(conn)
            except queue.Full:
                conn.close()

    def test_connection(self) -> tuple[bool, str]:
        try:
            with self.get() as conn:
                conn.cursor().execute("SELECT 1").fetchall()
            return True, "ok"
        except Exception as e:
            return False, str(e)


_pool = None


def get_pool():
    global _pool
    if _pool is None:
        if config.DB_BACKEND in {"sqlite", "local", "local_sqlite"}:
            _pool = SQLitePool()
        else:
            _pool = MSSQLPool(config.MSSQL_POOL_SIZE)
    return _pool


def list_tables() -> list[str]:
    configured = list(config.MSSQL_INCLUDE_TABLES)
    if configured:
        available = set(inspect(engine).get_table_names())
        return [table for table in configured if table in available]
    return inspect(engine).get_table_names()


def get_columns(table: str) -> list[tuple[str, str]]:
    return [
        (column["name"], str(column["type"]))
        for column in inspect(engine).get_columns(table)
    ]


def read_sql(query: str) -> pd.DataFrame:
    with get_pool().get() as conn:
        return pd.read_sql_query(query, conn)


def quote_ident(name: str) -> str:
    # SQL Server and SQLite both accept bracket-delimited identifiers.
    return f"[{name.replace(']', ']]')}]"


name = config.DB_BACKEND
