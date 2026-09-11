"""
SQL Server (SSMS) access layer -- the only database backend this build
supports. A small thread-safe connection pool is used because pyodbc
connections are blocking/synchronous; FastAPI's async endpoints hand this
work off to a thread pool (see main.py / rag_engine.py) so a slow query never
blocks the event loop.

Connection identity in one place, exactly as you'd expect from SSMS:
    server, database, username, password, ODBC driver name.
"""
from __future__ import annotations

import queue
import threading
import contextlib

import pandas as pd
import pyodbc

from . import config


class MSSQLPool:
    def __init__(self, size: int):
        self._size = size
        self._pool: "queue.Queue[pyodbc.Connection]" = queue.Queue(maxsize=size)
        self._lock = threading.Lock()
        self._created = 0

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

    def _new_connection(self) -> pyodbc.Connection:
        conn = pyodbc.connect(self._conn_str(), autocommit=True, timeout=config.MSSQL_CONN_TIMEOUT)
        return conn

    @contextlib.contextmanager
    def get(self):
        conn = None
        try:
            conn = self._pool.get_nowait()
            # cheap liveness check
            conn.cursor().execute("SELECT 1")
        except (queue.Empty, pyodbc.Error):
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


_pool: MSSQLPool | None = None


def get_pool() -> MSSQLPool:
    global _pool
    if _pool is None:
        _pool = MSSQLPool(config.MSSQL_POOL_SIZE)
    return _pool


def list_tables() -> list[str]:
    if config.MSSQL_INCLUDE_TABLES:
        return list(config.MSSQL_INCLUDE_TABLES)
    with get_pool().get() as conn:
        rows = conn.cursor().execute(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"
        ).fetchall()
    return [r[0] for r in rows]


def get_columns(table: str) -> list[tuple[str, str]]:
    with get_pool().get() as conn:
        rows = conn.cursor().execute(
            "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            table,
        ).fetchall()
    return [(r[0], r[1]) for r in rows]


def read_sql(query: str) -> pd.DataFrame:
    with get_pool().get() as conn:
        return pd.read_sql_query(query, conn)


def quote_ident(name: str) -> str:
    return f"[{name}]"


name = "mssql"
